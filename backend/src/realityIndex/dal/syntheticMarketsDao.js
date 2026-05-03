/**
 * syntheticMarketsDao — read/write helpers for synthetic_markets,
 * synthetic_market_trades, user_reputation.
 *
 * Trade execution is wrapped in a single transaction so the market state
 * + the trade row are always consistent.
 */

import crypto from "crypto";
import { getDb } from "../../models/database.js";
import { quote } from "../syntheticMarkets/ammEngine.js";

export function createMarket({
  question, description = null, cluster_id = null, event_id = null,
  generated_by = "editor", created_by = null, end_date = null,
  initial_liquidity = 100, meta = null,
}) {
  const id = crypto.randomUUID();
  const yes_pool = initial_liquidity, no_pool = initial_liquidity;
  const k = yes_pool * no_pool;
  const yes_price = 0.5;
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO synthetic_markets
      (id, question, description, cluster_id, event_id, generated_by,
       yes_pool, no_pool, k, yes_price, total_volume, resolved,
       created_by, created_at, end_date, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
  `).run(
    id, question, description, cluster_id, event_id, generated_by,
    yes_pool, no_pool, k, yes_price,
    created_by, now, end_date,
    meta ? JSON.stringify(meta) : null,
  );
  return { id, yes_pool, no_pool, k, yes_price, created_at: now };
}

export function getMarket(id) {
  return getDb().prepare("SELECT * FROM synthetic_markets WHERE id = ?").get(id);
}

export function listMarkets({ resolved = 0, limit = 50 } = {}) {
  return getDb().prepare(`
    SELECT * FROM synthetic_markets
    WHERE resolved = ?
    ORDER BY total_volume DESC, created_at DESC
    LIMIT ?
  `).all(resolved ? 1 : 0, limit);
}

/**
 * Execute a trade atomically. Returns the inserted trade row + new market state.
 * Rejects if the market is resolved, has expired, or the AMM math fails.
 */
export function executeTrade({ market_id, user_id = null, agent_id = null, side, amount, rationale = null }) {
  const db = getDb();
  const tx = db.transaction(() => {
    const m = db.prepare("SELECT * FROM synthetic_markets WHERE id = ?").get(market_id);
    if (!m)               throw new Error("market not found");
    if (m.resolved)       throw new Error("market is resolved");
    if (m.end_date && m.end_date < Date.now()) throw new Error("market has expired");

    const q = quote({ yes_pool: m.yes_pool, no_pool: m.no_pool, side, amount });

    db.prepare(`
      UPDATE synthetic_markets
      SET yes_pool = ?, no_pool = ?, yes_price = ?, total_volume = total_volume + ?
      WHERE id = ?
    `).run(q.new_yes_pool, q.new_no_pool, q.yes_price_after, amount, market_id);

    const r = db.prepare(`
      INSERT INTO synthetic_market_trades
        (market_id, user_id, agent_id, side, amount, shares, avg_price, yes_price_after, ts, rationale)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      market_id, user_id, agent_id, side, amount, q.shares,
      q.avg_price, q.yes_price_after, Date.now(), rationale,
    );

    return {
      trade_id:           r.lastInsertRowid,
      market_id,
      side, amount,
      shares:             q.shares,
      avg_price:          q.avg_price,
      yes_price_before:   q.yes_price_before,
      yes_price_after:    q.yes_price_after,
      slippage:           q.slippage,
    };
  });
  return tx();
}

export function listTrades(market_id, { limit = 50 } = {}) {
  return getDb().prepare(`
    SELECT * FROM synthetic_market_trades
    WHERE market_id = ? ORDER BY ts DESC LIMIT ?
  `).all(market_id, limit);
}

export function listUserTrades(user_id, { limit = 100 } = {}) {
  return getDb().prepare(`
    SELECT t.*, m.question, m.resolved, m.outcome
    FROM synthetic_market_trades t
    JOIN synthetic_markets m ON m.id = t.market_id
    WHERE t.user_id = ?
    ORDER BY t.ts DESC LIMIT ?
  `).all(user_id, limit);
}

export function leaderboard({ limit = 50 } = {}) {
  return getDb().prepare(`
    SELECT u.id AS user_id, u.email, r.brier_score, r.trades_resolved, r.reputation, r.updated_at
    FROM user_reputation r
    JOIN users u ON u.id = r.user_id
    WHERE r.trades_resolved >= 3
    ORDER BY r.reputation DESC, r.brier_score ASC
    LIMIT ?
  `).all(limit);
}
