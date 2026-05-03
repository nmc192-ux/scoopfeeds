/**
 * resolver — settles a synthetic market and updates per-user reputation.
 *
 * On resolve:
 *   1. Mark the market resolved with outcome ∈ {yes, no, cancel}.
 *   2. For each trade on the market, compute:
 *        payout = shares × payoutPerShare(outcome, side)   (cancel → refund amount)
 *        brier  = (avg_price - actual)^2  where actual ∈ {0,1} or skipped on cancel
 *   3. Aggregate per user_id:
 *        net_pnl  = sum(payout - amount)
 *        new_brier = average of trade-level briers
 *        trades_resolved += count
 *   4. Update user_reputation. reputation = clamp(0.5 + (1-new_brier) * 0.5, 0, 1) —
 *      simple smooth ranking signal; lower Brier → higher reputation.
 *
 * Atomic: market state, payouts, reputation all in one transaction. AI-agent
 * trades (user_id IS NULL) skip reputation updates but still book payouts.
 */

import { getDb } from "../../models/database.js";
import { payoutPerShare } from "./ammEngine.js";
import { logger } from "../../services/logger.js";

export function resolveMarket({ market_id, outcome }) {
  if (!["yes", "no", "cancel"].includes(outcome)) {
    throw new Error("outcome must be yes|no|cancel");
  }
  const db = getDb();

  return db.transaction(() => {
    const m = db.prepare("SELECT * FROM synthetic_markets WHERE id = ?").get(market_id);
    if (!m) throw new Error("market not found");
    if (m.resolved) return { alreadyResolved: true, outcome: m.outcome };

    const trades = db.prepare("SELECT * FROM synthetic_market_trades WHERE market_id = ?").all(market_id);

    const perUser = new Map();   // user_id → { trades: [], pnl: 0 }
    let totalPaid = 0;

    for (const t of trades) {
      let payout, brier;
      if (outcome === "cancel") {
        payout = t.amount;        // full refund
        brier  = null;            // canceled trades don't score
      } else {
        const pps = payoutPerShare(outcome, t.side);    // 1 if winning side else 0
        payout = t.shares * pps;
        const actual = (outcome === t.side) ? 1 : 0;
        brier = Math.pow(t.avg_price - actual, 2);
      }
      totalPaid += payout;

      if (t.user_id) {
        if (!perUser.has(t.user_id)) perUser.set(t.user_id, { trades: 0, pnl: 0, brierSum: 0, brierCount: 0 });
        const r = perUser.get(t.user_id);
        r.trades += 1;
        r.pnl    += payout - t.amount;
        if (brier != null) { r.brierSum += brier; r.brierCount += 1; }
      }
    }

    db.prepare(`
      UPDATE synthetic_markets
      SET resolved = 1, outcome = ?, resolved_at = ?
      WHERE id = ?
    `).run(outcome, Date.now(), market_id);

    // Per-user reputation update. Smooths against existing reputation:
    //   new_brier_avg = (oldSum + thisSum) / (oldCount + thisCount)
    //   reputation = 0.5 + (1 - new_brier_avg) * 0.5  → in [0.5, 1.0] for any
    //   non-zero coverage; 0.5 floor signals "minimal evidence yet".
    const upsertRep = db.prepare(`
      INSERT INTO user_reputation (user_id, brier_score, trades_resolved, reputation, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        brier_score      = ?,
        trades_resolved  = trades_resolved + ?,
        reputation       = ?,
        updated_at       = excluded.updated_at
    `);
    const fetchRep = db.prepare("SELECT brier_score, trades_resolved FROM user_reputation WHERE user_id = ?");

    for (const [user_id, r] of perUser.entries()) {
      const existing = fetchRep.get(user_id);
      const oldCount = existing?.trades_resolved ?? 0;
      const oldBrier = existing?.brier_score ?? null;
      const newCount = oldCount + r.trades;
      // Weighted Brier average. Maximum-likelihood-style.
      const oldSum = (oldBrier != null ? oldBrier * oldCount : 0);
      const newBrier = newCount > 0 ? (oldSum + r.brierSum) / newCount : null;
      const reputation = newBrier != null
        ? Math.max(0, Math.min(1, 0.5 + (1 - newBrier) * 0.5))
        : 0.5;
      const now = Date.now();
      upsertRep.run(
        user_id, newBrier, r.trades, reputation, now,
        newBrier, r.trades, reputation,
      );
    }

    logger.info(`🎲 synth resolve ${market_id}: outcome=${outcome}, paid=$${totalPaid.toFixed(2)}, users=${perUser.size}`);
    return {
      market_id, outcome, paid: Number(totalPaid.toFixed(2)),
      trades_settled: trades.length, users_updated: perUser.size,
    };
  })();
}
