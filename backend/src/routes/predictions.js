/**
 * /api/predictions — Reality Index Phase 1 read APIs.
 *
 * Routes:
 *   GET  /api/predictions                        list active markets
 *   GET  /api/predictions/movers                 biggest 24h price moves
 *   GET  /api/predictions/clusters/:clusterId    markets bound to a cluster
 *   GET  /api/predictions/article/:articleId     markets bound to an article's cluster(s)
 *   GET  /api/predictions/badges?ids=a,b,c       bulk per-article RI badges (Phase 4i)
 *   GET  /api/predictions/:id                    single market w/ confidence
 *   GET  /api/predictions/:id/history            time-series snapshots
 *
 * All endpoints serve from SQLite — no external API calls in the request path.
 * The fetcher cron keeps the data fresh (every 15 min for active markets).
 */

import express from "express";
import {
  listMarkets,
  getMarketById,
  listTopMovers,
  countActiveMarkets,
} from "../realityIndex/dal/marketsDao.js";
import {
  getSnapshotHistory,
  getLatestSnapshot,
} from "../realityIndex/dal/snapshotsDao.js";
import { listClusterMarkets } from "../realityIndex/dal/linksDao.js";
import { scoreMarketConfidence } from "../realityIndex/intelligence/confidenceScorer.js";
import { getDb } from "../models/database.js";
import { logger } from "../services/logger.js";

const router = express.Router();

// ─── Serializers ───────────────────────────────────────────────────────────

function publicMarket(m, { withConfidence = false } = {}) {
  if (!m) return null;
  const out = {
    id:               m.id,
    source:           m.source,
    source_market_id: m.source_market_id,
    question:         m.question,
    description:      m.description,
    slug:             m.slug,
    category:         m.category,
    tags:             m.tags ? safeJson(m.tags) : null,
    end_date:         m.end_date,
    resolved:         !!m.resolved,
    outcome:          m.outcome,
    active:           !!m.active,
    yes_price:        m.yes_price,
    no_price:         m.no_price,
    volume_24h:       m.volume_24h,
    liquidity:        m.liquidity,
    spread:           m.spread,
    url:              m.url,
    icon_url:         m.icon_url,
    updated_at:       m.updated_at,
  };
  if (withConfidence) {
    const snapCount = countSnapshots(m.id);
    out.confidence = scoreMarketConfidence(m, { snapshotCount: snapCount });
  }
  return out;
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

function countSnapshots(marketId) {
  try {
    return getDb().prepare(
      `SELECT COUNT(*) AS n FROM prediction_market_snapshots WHERE market_id = ?`
    ).get(marketId).n;
  } catch { return 0; }
}

// ─── Routes ────────────────────────────────────────────────────────────────

// GET /api/predictions
//   ?source=polymarket&category=Politics&minVolume=1000&limit=50&offset=0
router.get("/", (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
    const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);
    const minVolume = Math.max(parseFloat(req.query.minVolume || "0"), 0);
    const rows = listMarkets({
      source:   req.query.source || null,
      category: req.query.category || null,
      minVolume,
      limit,
      offset,
    });
    res.json({
      success: true,
      data: rows.map(r => publicMarket(r)),
      total_active: countActiveMarkets({ source: req.query.source || null }),
      limit, offset,
      disclaimer: "Market-implied probability. Not a prediction guarantee.",
    });
  } catch (err) {
    logger.error("predictions list failed", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to list markets" });
  }
});

// GET /api/predictions/movers?windowHours=24&limit=20
router.get("/movers", (req, res) => {
  try {
    const windowHours = Math.min(parseInt(req.query.windowHours || "24", 10), 168);
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const rows = listTopMovers({ windowMs: windowHours * 60 * 60 * 1000, limit });
    res.json({
      success: true,
      data: rows.map(r => ({
        ...publicMarket(r),
        delta_yes: Number((r.latest_yes - r.earliest_yes).toFixed(4)),
        latest_yes: r.latest_yes,
        earliest_yes: r.earliest_yes,
      })),
      window_hours: windowHours,
      disclaimer: "Market-implied probability. Not a prediction guarantee.",
    });
  } catch (err) {
    logger.error("predictions movers failed", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to compute movers" });
  }
});

// GET /api/predictions/article/:articleId
//
// Reverse lookup: find the cluster(s) this article belongs to, then return
// the markets bound to those clusters. Used by ReaderModal so the UI doesn't
// need to know the cluster_id up front.
router.get("/article/:articleId", (req, res) => {
  try {
    const articleId = req.params.articleId;
    const limit = Math.min(parseInt(req.query.limit || "5", 10), 20);

    // story_clusters.article_ids is a JSON array of article IDs. SQLite
    // doesn't have great native JSON contains for that shape, so we LIKE-
    // match the quoted form. False positives are vanishingly unlikely
    // because article IDs are URL-derived strings.
    const needle = `%"${articleId}"%`;
    const clusterIds = getDb().prepare(`
      SELECT id FROM story_clusters
      WHERE article_ids LIKE ?
      ORDER BY updated_at DESC
      LIMIT 5
    `).all(needle).map(r => r.id);

    if (!clusterIds.length) {
      return res.json({
        success: true,
        article_id: articleId,
        cluster_ids: [],
        data: [],
        disclaimer: "Market-implied probability. Not a prediction guarantee.",
      });
    }

    // Aggregate markets across all matching clusters; dedupe by market id
    // and keep the highest weight per market.
    const byMarket = new Map();
    for (const cid of clusterIds) {
      for (const r of listClusterMarkets(cid, { limit })) {
        const prev = byMarket.get(r.id);
        if (!prev || (r.weight ?? 0) > (prev.weight ?? 0)) {
          byMarket.set(r.id, r);
        }
      }
    }
    const merged = [...byMarket.values()]
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
      .slice(0, limit);

    res.json({
      success: true,
      article_id: articleId,
      cluster_ids: clusterIds,
      data: merged.map(r => ({
        ...publicMarket(r, { withConfidence: true }),
        link: { weight: r.weight, rank: r.rank, matcher: r.matcher, reason: r.reason },
      })),
      disclaimer: "Market-implied probability. Not a prediction guarantee.",
    });
  } catch (err) {
    logger.error("predictions article lookup failed", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to load article markets" });
  }
});

// GET /api/predictions/clusters/:clusterId
//
// Returns the prediction markets bound to a story cluster, ordered by rank.
// Includes the LLM rationale ("reason") so the UI can show "why this market".
router.get("/clusters/:clusterId", (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "5", 10), 20);
    const rows = listClusterMarkets(req.params.clusterId, { limit });
    res.json({
      success: true,
      cluster_id: req.params.clusterId,
      data: rows.map(r => ({
        ...publicMarket(r, { withConfidence: true }),
        link: { weight: r.weight, rank: r.rank, matcher: r.matcher, reason: r.reason },
      })),
      disclaimer: "Market-implied probability. Not a prediction guarantee.",
    });
  } catch (err) {
    logger.error("predictions cluster lookup failed", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to load cluster markets" });
  }
});

// GET /api/predictions/:id
// ─── GET /api/predictions/badges?ids=a,b,c ─────────────────────────────────
//
// Bulk per-article RI badges for the home news feed (Phase 4i). For each
// article id, returns a compact payload — or null when the article isn't
// bound to a tracked event/market — so the NewsCard can render
// ProbabilityBar / TruthGapBadge / AnomalyChip inline:
//
//   {
//     [articleId]: {
//       event_slug, event_title, top_yes, source,
//       truth_gap, latest_anomaly: { type, severity, payload }|null
//     } | null
//   }
//
// MUST be declared before the catch-all "/:id" route below or Express will
// route /badges to the market-by-id handler.
const BADGE_IDS_MAX = 60;
const BADGE_ANOM_FRESH_MS = 6 * 60 * 60 * 1000;

router.get("/badges", (req, res) => {
  try {
    const raw = String(req.query.ids ?? "").trim();
    if (!raw) return res.json({ badges: {} });
    const ids = raw.split(",").map(s => s.trim()).filter(Boolean).slice(0, BADGE_IDS_MAX);
    if (!ids.length) return res.json({ badges: {} });

    const db = getDb();
    const cutoff = Date.now() - BADGE_ANOM_FRESH_MS;

    // Per-article: find the most-recently-active event the article belongs to,
    // then pull its top market + freshest unack anomaly + latest RI snapshot.
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT
        a.id AS article_id,
        e.slug AS event_slug, e.title AS event_title,
        (SELECT pm.yes_price FROM event_market_links eml
          JOIN prediction_markets pm ON pm.id = eml.market_id
          WHERE eml.event_id = e.id ORDER BY eml.rank LIMIT 1) AS top_yes,
        (SELECT pm.source    FROM event_market_links eml
          JOIN prediction_markets pm ON pm.id = eml.market_id
          WHERE eml.event_id = e.id ORDER BY eml.rank LIMIT 1) AS source,
        (SELECT r.truth_gap FROM reality_index_snapshots r
          WHERE r.scope='event' AND r.scope_id = e.id ORDER BY r.ts DESC LIMIT 1) AS truth_gap,
        (SELECT al.id       FROM anomaly_alerts al
          WHERE al.event_id = e.id AND al.acknowledged = 0 AND al.detected_at >= ?
          ORDER BY al.detected_at DESC LIMIT 1) AS anom_id,
        (SELECT al.type     FROM anomaly_alerts al
          WHERE al.event_id = e.id AND al.acknowledged = 0 AND al.detected_at >= ?
          ORDER BY al.detected_at DESC LIMIT 1) AS anom_type,
        (SELECT al.severity FROM anomaly_alerts al
          WHERE al.event_id = e.id AND al.acknowledged = 0 AND al.detected_at >= ?
          ORDER BY al.detected_at DESC LIMIT 1) AS anom_severity,
        (SELECT al.payload  FROM anomaly_alerts al
          WHERE al.event_id = e.id AND al.acknowledged = 0 AND al.detected_at >= ?
          ORDER BY al.detected_at DESC LIMIT 1) AS anom_payload
      FROM articles a
      JOIN event_articles ea ON ea.article_id = a.id
      JOIN events e          ON e.id = ea.event_id AND e.status = 'active'
      WHERE a.id IN (${placeholders})
      ORDER BY a.id, e.last_activity_at DESC
    `).all(cutoff, cutoff, cutoff, cutoff, ...ids);

    const seen = new Set();
    const badges = {};
    for (const id of ids) badges[id] = null;
    for (const r of rows) {
      if (seen.has(r.article_id)) continue;
      seen.add(r.article_id);
      const hasMarket   = r.top_yes != null;
      const hasAnomaly  = r.anom_id != null;
      const hasTruthGap = Number.isFinite(r.truth_gap) && Math.abs(r.truth_gap) > 0.15;
      if (!hasMarket && !hasAnomaly && !hasTruthGap) continue;
      let payload = null;
      if (r.anom_payload) { try { payload = JSON.parse(r.anom_payload); } catch { /* ignore */ } }
      badges[r.article_id] = {
        event_slug:    r.event_slug,
        event_title:   r.event_title,
        top_yes:       r.top_yes,
        source:        r.source,
        truth_gap:     hasTruthGap ? r.truth_gap : null,
        latest_anomaly: hasAnomaly ? {
          id: r.anom_id, type: r.anom_type, severity: r.anom_severity, payload,
        } : null,
      };
    }
    res.json({ badges });
  } catch (err) {
    logger.error("predictions badges failed", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to load badges" });
  }
});

router.get("/:id", (req, res) => {
  try {
    const m = getMarketById(req.params.id);
    if (!m) return res.status(404).json({ success: false, error: "Market not found" });
    res.json({
      success: true,
      data: publicMarket(m, { withConfidence: true }),
      latest_snapshot: getLatestSnapshot(m.id),
      disclaimer: "Market-implied probability. Not a prediction guarantee.",
    });
  } catch (err) {
    logger.error("predictions detail failed", { id: req.params.id, error: err.message });
    res.status(500).json({ success: false, error: "Failed to load market" });
  }
});

// GET /api/predictions/:id/history?hours=168&limit=2000
router.get("/:id/history", (req, res) => {
  try {
    const hours = Math.min(parseInt(req.query.hours || "168", 10), 24 * 365);
    const limit = Math.min(parseInt(req.query.limit || "2000", 10), 10_000);
    const m = getMarketById(req.params.id);
    if (!m) return res.status(404).json({ success: false, error: "Market not found" });
    const sinceMs = Date.now() - hours * 60 * 60 * 1000;
    const points = getSnapshotHistory(m.id, { sinceMs, limit });
    res.json({
      success: true,
      market: publicMarket(m),
      window_hours: hours,
      points,
      count: points.length,
      disclaimer: "Market-implied probability. Not a prediction guarantee.",
    });
  } catch (err) {
    logger.error("predictions history failed", { id: req.params.id, error: err.message });
    res.status(500).json({ success: false, error: "Failed to load history" });
  }
});

export default router;
