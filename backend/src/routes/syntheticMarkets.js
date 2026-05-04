/**
 * /api/synthetic-markets — Phase 6 read + trade.
 *
 *   GET  /                       list active synthetic markets
 *   GET  /:id                    single market + last trades
 *   GET  /leaderboard            top forecasters by reputation (Brier-scored)
 *   POST /:id/quote              quote a hypothetical trade (no DB write)
 *   POST /:id/trade              execute a trade (auth-gated)
 *
 * Trade is auth-gated; quote and reads are public. Market creation lives
 * in /scoop-ops/ri-ops/synthetic for editor control.
 */

import { Router } from "express";
import { z } from "zod";
import { getUserBySession } from "../models/database.js";
import { logger } from "../services/logger.js";
import {
  listMarkets, getMarket, listTrades, executeTrade, leaderboard, agentLeaderboard,
} from "../realityIndex/dal/syntheticMarketsDao.js";
import { quote as ammQuote } from "../realityIndex/syntheticMarkets/ammEngine.js";
import { sendError, sendUnauthorized, sendValidationError } from "../utils/apiResponse.js";

const router = Router();
const COOKIE_NAME = "scoop_session";
const quoteSchema = z.object({
  side: z.enum(["yes", "no"]),
  amount: z.coerce.number().finite().positive().max(1_000_000),
});
const tradeSchema = quoteSchema.extend({
  rationale: z.string().trim().max(2000).optional().nullable(),
});

function getSession(req) {
  const raw = req.headers.cookie || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return m ? m[1] : null;
}
function requireAuth(req, res, next) {
  const sid = getSession(req);
  if (!sid) return sendUnauthorized(res, req, "Not authenticated");
  const u = getUserBySession(sid);
  if (!u) return sendUnauthorized(res, req, "Session expired");
  req.user = u;
  next();
}

function publicMarket(m) {
  if (!m) return null;
  return {
    id: m.id, question: m.question, description: m.description,
    cluster_id: m.cluster_id, event_id: m.event_id,
    yes_price: m.yes_price, total_volume: m.total_volume,
    resolved: !!m.resolved, outcome: m.outcome,
    end_date: m.end_date, created_at: m.created_at,
  };
}

router.get("/", (req, res) => {
  const resolved = req.query.resolved === "1";
  const limit = Math.min(parseInt(req.query.limit ?? "30", 10), 100);
  res.json({ items: listMarkets({ resolved, limit }).map(publicMarket) });
});

router.get("/leaderboard", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 100);
  // Don't leak emails publicly; show user_id-derived handle only.
  const rows = leaderboard({ limit }).map(r => ({
    user_id: r.user_id,
    handle: (r.email || "anon").split("@")[0],
    brier_score: r.brier_score,
    trades_resolved: r.trades_resolved,
    reputation: r.reputation,
    updated_at: r.updated_at,
  }));
  res.json({ items: rows });
});

router.get("/agent-leaderboard", (_req, res) => {
  res.json({ items: agentLeaderboard({ limit: 20 }) });
});

router.get("/:id", (req, res) => {
  const m = getMarket(req.params.id);
  if (!m) return res.status(404).json({ error: "Market not found" });
  res.json({
    market: publicMarket(m),
    trades: listTrades(req.params.id, { limit: 30 }),
  });
});

router.post("/:id/quote", (req, res) => {
  try {
    const m = getMarket(req.params.id);
    if (!m) return res.status(404).json({ error: "Market not found" });
    const parsed = quoteSchema.safeParse(req.body || {});
    if (!parsed.success) return sendValidationError(res, req, parsed.error);
    const { side, amount } = parsed.data;
    const q = ammQuote({ yes_pool: m.yes_pool, no_pool: m.no_pool, side, amount: Number(amount) });
    res.json({ ok: true, quote: q });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/:id/trade", requireAuth, (req, res) => {
  try {
    const parsed = tradeSchema.safeParse(req.body || {});
    if (!parsed.success) return sendValidationError(res, req, parsed.error);
    const { side, amount, rationale } = parsed.data;
    const out = executeTrade({
      market_id: req.params.id,
      user_id: req.user.id,
      side, amount: Number(amount), rationale,
    });
    res.json({ ok: true, trade: out });
  } catch (err) {
    logger.warn(`synthetic trade failed: ${err.message}`);
    sendError(res, req, { status: 400, error: err.message, code: "trade_failed" });
  }
});

export default router;
