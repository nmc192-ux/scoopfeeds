/**
 * /api/v1/* — public read-only API per plan §5N.
 *
 * Auth: API key passed as either `?key=...` query param OR
 *       `Authorization: Bearer <key>` header. Keys minted by editor at
 *       /scoop-ops/ri-ops/api-keys.
 *
 * Rate limit: per-key, tier-based (free 60 RPM, pro 600, enterprise 6000).
 * Rate-limit headers (RateLimit-Remaining etc.) included in every response
 * so consumers can self-throttle.
 *
 * Endpoints (all read-only, all cached `medium`):
 *   GET /api/v1/events                     — list active events
 *   GET /api/v1/events/:slug               — single event dossier
 *   GET /api/v1/predictions                — list active markets
 *   GET /api/v1/predictions/:id            — single market detail
 *   GET /api/v1/truth-gap                  — top divergences
 *   GET /api/v1/anomalies                  — recent anomaly alerts
 *   GET /api/v1/briefs                     — published analyst briefs
 *   GET /api/v1/synthetic-markets          — open synthetic markets
 *   GET /api/v1/macro/indicators           — FRED macro indicators
 *
 * NOT exposed: writes, watchlists (per-user), brief drafts, /scoop-ops/*.
 *
 * NOTE: /v1/* routes proxy directly to the existing internal routers'
 * handler logic. We don't re-mount the routers — each endpoint here calls
 * the same DAL functions to keep the v1 contract decoupled from internal
 * route shapes (so we can rev internal APIs without breaking v1).
 */

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getDb } from "../models/database.js";
import { logger } from "../services/logger.js";
import { getApiKey, touchApiKey } from "../realityIndex/dal/apiKeysDao.js";
import { listMarkets as listPmMarkets, getMarketById } from "../realityIndex/dal/marketsDao.js";
import { topTruthGap, listAnomalies } from "../realityIndex/dal/realityIndexDao.js";
import { listBriefs } from "../realityIndex/dal/briefsDao.js";
import { listMarkets as listSyntheticMarkets } from "../realityIndex/dal/syntheticMarketsDao.js";

const router = Router();

// ─── Auth + rate-limit middleware ──────────────────────────────────────────

function extractKey(req) {
  if (req.query.key) return String(req.query.key);
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

function requireApiKey(req, res, next) {
  const key = extractKey(req);
  if (!key) return res.status(401).json({ error: "API key required (?key= or Authorization: Bearer)" });
  const row = getApiKey(key);
  if (!row) return res.status(401).json({ error: "Invalid or revoked API key" });
  req.apiKey = row;
  // Fire-and-forget last-used update; don't block the response.
  try { touchApiKey(key); } catch { /* ignore */ }
  next();
}

// One limiter shared across the v1 namespace, keyed by API key. Per-key cap
// is read from the api_keys.rpm column at evaluation time.
const v1Limiter = rateLimit({
  windowMs: 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.apiKey?.key || req.ip,
  max: (req) => req.apiKey?.rpm ?? 60,
  message: { error: "Rate limit exceeded for this API key" },
});

router.use(requireApiKey);
router.use(v1Limiter);

// Echo back the caller's tier + remaining quota so SDKs can self-throttle.
router.use((req, res, next) => {
  res.setHeader("X-RateLimit-Tier", req.apiKey?.tier ?? "free");
  next();
});

// ─── Endpoints ─────────────────────────────────────────────────────────────

router.get("/events", (req, res) => {
  try {
    const status   = req.query.status   ?? "active";
    const category = req.query.category ?? null;
    const limit    = Math.min(parseInt(req.query.limit  ?? "30", 10), 100);
    const offset   = parseInt(req.query.offset ?? "0", 10);

    let sql = `
      SELECT id, slug, title, summary, category, status, severity,
             geo_lat, geo_lng, started_at, last_activity_at,
        (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id = e.id)       AS article_count,
        (SELECT COUNT(*) FROM event_market_links eml WHERE eml.event_id = e.id) AS market_count,
        (SELECT pm.yes_price
         FROM event_market_links eml JOIN prediction_markets pm ON pm.id = eml.market_id
         WHERE eml.event_id = e.id ORDER BY eml.rank LIMIT 1) AS top_probability
      FROM events e
      WHERE status = ?
    `;
    const params = [status];
    if (category) { sql += " AND category = ?"; params.push(category); }
    sql += " ORDER BY last_activity_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    res.json({ events: getDb().prepare(sql).all(...params), limit, offset });
  } catch (err) { fail(res, err); }
});

router.get("/events/:slug", (req, res) => {
  try {
    const ev = getDb().prepare("SELECT * FROM events WHERE slug = ?").get(req.params.slug);
    if (!ev) return res.status(404).json({ error: "Event not found" });
    res.json({ event: ev });
  } catch (err) { fail(res, err); }
});

router.get("/predictions", (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? "30", 10), 100);
    res.json({ markets: listPmMarkets({ limit, activeOnly: true }) });
  } catch (err) { fail(res, err); }
});

router.get("/predictions/:id", (req, res) => {
  try {
    const m = getMarketById(req.params.id);
    if (!m) return res.status(404).json({ error: "Market not found" });
    res.json({ market: m });
  } catch (err) { fail(res, err); }
});

router.get("/truth-gap", (req, res) => {
  try {
    const windowMs = parseInt(req.query.windowMs ?? String(24 * 60 * 60 * 1000), 10);
    const limit    = Math.min(parseInt(req.query.limit ?? "25", 10), 100);
    const direction = ["over", "under", "both"].includes(req.query.direction) ? req.query.direction : "both";
    res.json({ items: topTruthGap({ windowMs, limit, direction, scope: "event" }) });
  } catch (err) { fail(res, err); }
});

router.get("/anomalies", (req, res) => {
  try {
    const limit   = Math.min(parseInt(req.query.limit   ?? "50", 10), 200);
    const sinceMs = parseInt(req.query.sinceMs ?? String(Date.now() - 24 * 60 * 60 * 1000), 10);
    const type    = req.query.type ?? null;
    res.json({ items: listAnomalies({ limit, sinceMs, type }) });
  } catch (err) { fail(res, err); }
});

router.get("/briefs", (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? "20", 10), 50);
    const items = listBriefs({ status: "published", limit }).map(b => ({
      id: b.id, slug: b.slug, event_id: b.event_id, title: b.title,
      thesis: b.thesis, body_md: b.body_md, confidence: b.confidence,
      published_at: b.published_at, evidence: safeJson(b.evidence_json),
    }));
    res.json({ items });
  } catch (err) { fail(res, err); }
});

router.get("/synthetic-markets", (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? "30", 10), 100);
    const resolved = req.query.resolved === "1";
    res.json({ items: listSyntheticMarkets({ resolved, limit }) });
  } catch (err) { fail(res, err); }
});

router.get("/macro/indicators", (req, res) => {
  try {
    const provider = req.query.provider ?? null;
    let sql = "SELECT * FROM macro_indicators";
    const params = [];
    if (provider) { sql += " WHERE provider = ?"; params.push(provider); }
    sql += " ORDER BY label ASC";
    res.json({ indicators: getDb().prepare(sql).all(...params) });
  } catch (err) { fail(res, err); }
});

// ─── Helpers ───────────────────────────────────────────────────────────────
function fail(res, err) {
  logger.error(`v1 error: ${err.message}`);
  res.status(500).json({ error: "Internal server error" });
}
function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

export default router;
