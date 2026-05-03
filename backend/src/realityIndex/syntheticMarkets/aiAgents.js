/**
 * aiAgents — three baseline personas that trade open synthetic markets.
 *
 * Per plan §6: "skeptic / optimist / contrarian" baseline traders. They run
 * with a small bankroll and conservative trade sizes so they make markets
 * lively without dominating any pool. Agents trade with NULL user_id and
 * a populated agent_id, so they show up in trade history but never affect
 * the human leaderboard.
 *
 * Personas:
 *   skeptic     — bets against the side currently dominant (mean-reversion).
 *                 Buys NO when yes_price > 0.6, YES when yes_price < 0.4.
 *   optimist    — looks at the bound event's reality_score; buys YES if
 *                 RI > 0.6, NO if RI < 0.4. Untrained on no-event markets.
 *   contrarian  — fades fresh anomalies. If the bound event has an
 *                 odds_shift anomaly in the last 6h, buys the OPPOSITE
 *                 direction of the shift on the bet that markets overshoot.
 *
 * Per cycle, each agent considers up to AGENTS_MAX_PER_CYCLE markets,
 * with at most one trade per (agent, market) per AGENTS_COOLDOWN_MS so
 * a single market never gets spammed.
 */

import { getDb } from "../../models/database.js";
import { executeTrade } from "../dal/syntheticMarketsDao.js";
import { logger } from "../../services/logger.js";

const AGENTS = ["skeptic", "optimist", "contrarian"];
const AGENTS_MAX_PER_CYCLE = parseInt(process.env.AGENTS_MAX_PER_CYCLE || "12", 10);
const AGENTS_COOLDOWN_MS   = parseInt(process.env.AGENTS_COOLDOWN_MS   || String(6 * 60 * 60 * 1000), 10);
const ENABLED              = String(process.env.ENABLE_AI_AGENTS ?? "true").toLowerCase() !== "false";

// Conservative: 0.5–3 USD-equivalent per trade.
function tradeSize(agent, marketLiquidity) {
  const liq = Math.max(1, marketLiquidity || 100);
  // Scale with √liquidity but cap so we never blow the pool.
  const base = Math.min(3, Math.max(0.5, Math.sqrt(liq) / 10));
  return Math.round(base * 100) / 100;
}

function pickOpenMarkets(db, limit) {
  const cutoff = Date.now() - AGENTS_COOLDOWN_MS;
  // Include event metadata for personas that need it.
  return db.prepare(`
    SELECT m.id, m.yes_pool, m.no_pool, m.yes_price, m.event_id, m.end_date,
      (SELECT r.reality_score FROM reality_index_snapshots r
        WHERE r.scope='event' AND r.scope_id = m.event_id ORDER BY r.ts DESC LIMIT 1) AS reality_score,
      (SELECT a.payload FROM anomaly_alerts a
        WHERE a.event_id = m.event_id AND a.type = 'odds_shift' AND a.detected_at >= ?
        ORDER BY a.detected_at DESC LIMIT 1) AS recent_shift
    FROM synthetic_markets m
    WHERE m.resolved = 0 AND (m.end_date IS NULL OR m.end_date > ?)
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(Date.now() - 6 * 60 * 60 * 1000, Date.now(), limit * AGENTS.length);
}

function lastAgentTradeMs(db, agent_id, market_id) {
  return db.prepare(
    "SELECT MAX(ts) AS ts FROM synthetic_market_trades WHERE agent_id = ? AND market_id = ?"
  ).get(agent_id, market_id)?.ts ?? 0;
}

function decide(agent, m) {
  const yp = m.yes_price;
  switch (agent) {
    case "skeptic":
      if (yp > 0.6)  return { side: "no",  rationale: `mean-reversion: yes_price ${yp.toFixed(2)} > 0.6` };
      if (yp < 0.4)  return { side: "yes", rationale: `mean-reversion: yes_price ${yp.toFixed(2)} < 0.4` };
      return null;
    case "optimist": {
      if (m.reality_score == null) return null;
      if (m.reality_score > 0.6) return { side: "yes", rationale: `RI ${m.reality_score.toFixed(2)} > 0.6` };
      if (m.reality_score < 0.4) return { side: "no",  rationale: `RI ${m.reality_score.toFixed(2)} < 0.4` };
      return null;
    }
    case "contrarian": {
      if (!m.recent_shift) return null;
      try {
        const p = JSON.parse(m.recent_shift);
        if (!Number.isFinite(p?.delta_pp)) return null;
        // Fade the shift: if market jumped UP, sell YES (buy NO). If down, buy YES.
        const side = p.delta_pp > 0 ? "no" : "yes";
        return { side, rationale: `fade ${p.delta_pp >= 0 ? "+" : ""}${p.delta_pp}pp shift` };
      } catch { return null; }
    }
    default: return null;
  }
}

export function runAiAgentsCycle({ limit = AGENTS_MAX_PER_CYCLE } = {}) {
  if (!ENABLED) return { skipped: "ENABLE_AI_AGENTS=false" };
  const db = getDb();
  const candidates = pickOpenMarkets(db, limit);
  if (!candidates.length) return { traded: 0, considered: 0 };

  // Dedupe by market id (we joined wide for cooldown lookup; just need unique markets).
  const seen = new Set();
  const markets = [];
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    markets.push(c);
    if (markets.length >= limit) break;
  }

  let traded = 0, skipped = 0;
  const now = Date.now();
  for (const m of markets) {
    for (const agent of AGENTS) {
      try {
        const last = lastAgentTradeMs(db, agent, m.id);
        if (now - last < AGENTS_COOLDOWN_MS) { skipped++; continue; }
        const decision = decide(agent, m);
        if (!decision) { skipped++; continue; }
        const amount = tradeSize(agent, (m.yes_pool + m.no_pool) / 2);
        executeTrade({
          market_id: m.id,
          agent_id:  agent,
          side:      decision.side,
          amount,
          rationale: decision.rationale,
        });
        traded++;
      } catch (err) {
        // executeTrade can reject for valid reasons (slippage cap, expired,
        // liquidity); log at warn so we notice systemic issues but don't spam.
        if (!/slippage|expired|resolved/i.test(err.message)) {
          logger.warn(`agent ${agent} ${m.id}: ${err.message}`);
        }
        skipped++;
      }
    }
  }
  if (traded) logger.info(`🤖 AI agents: ${markets.length} markets considered, ${traded} trades placed, ${skipped} skipped`);
  return { traded, skipped, considered: markets.length };
}
