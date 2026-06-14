/**
 * /api/events — Reality Index Phase 2 + 3 read APIs.
 *
 * Routes:
 *   GET  /api/events                          list active events (filterable)
 *   GET  /api/events/:slug                    full event dossier
 *   GET  /api/events/:slug/timeline           chronological entries
 *   GET  /api/events/:slug/markets            bound markets w/ live prices
 *   GET  /api/events/:slug/articles           all articles, paginated
 *   GET  /api/events/:slug/actors             key actors
 *   GET  /api/events/:slug/perspectives       article sources for comparison
 *   GET  /api/events/:slug/sentiment          per-source sentiment time-series   (Phase 3)
 *   GET  /api/events/:slug/reality-index      composite + breakdown              (Phase 3)
 *
 * All reads come from SQLite — no upstream API calls in the request path.
 */

import express from "express";
import { getDb } from "../models/database.js";
import { logger } from "../services/logger.js";
import { latestSnapshotsByScope, snapshotHistory } from "../realityIndex/dal/sentimentDao.js";
import { latestRealityIndex, realityIndexHistory } from "../realityIndex/dal/realityIndexDao.js";
import { listTrackersByEvent } from "../models/trackers.js";
import { publicTracker } from "./trackers.js";

const router = express.Router();

// ─── Serializers ───────────────────────────────────────────────────────────

function publicEvent(ev) {
  if (!ev) return null;
  // Inline freshest unack anomaly for the EventCard chip (Phase 4f).
  const latestAnomaly = ev.anom_id ? {
    id:          ev.anom_id,
    type:        ev.anom_type,
    severity:    ev.anom_severity,
    detected_at: ev.anom_detected_at,
    payload:     safeJsonParse(ev.anom_payload),
  } : null;
  return {
    id:               ev.id,
    slug:             ev.slug,
    title:            ev.title,
    summary:          ev.summary,
    category:         ev.category,
    status:           ev.status,
    severity:         ev.severity,
    hero_image_url:   ev.hero_image_url,
    article_count:    ev.article_count ?? 0,
    source_count:     ev.source_count ?? 0,
    market_count:     ev.market_count ?? 0,
    top_probability:  ev.top_probability ?? null,
    truth_gap:        ev.truth_gap ?? null,
    reality_score:    ev.reality_score ?? null,
    latest_anomaly:   latestAnomaly,
    started_at:       ev.started_at,
    last_activity_at: ev.last_activity_at,
    created_at:       ev.created_at,
  };
}

function publicTimelineEntry(e) {
  return {
    id:          e.id,
    ts:          e.ts,
    kind:        e.kind,
    ref_id:      e.ref_id,
    headline:    e.headline,
    body:        e.body,
    source_name: e.source_name,
    importance:  e.importance,
  };
}

function publicMarket(m) {
  return {
    id:          m.id,
    question:    m.question,
    source:      m.source,
    yes_price:   m.yes_price,
    no_price:    m.no_price,
    volume_24h:  m.volume_24h,
    liquidity:   m.liquidity,
    url:         m.url,
    icon_url:    m.icon_url,
    weight:      m.weight,
    rank:        m.rank,
    resolved:    m.resolved,
    outcome:     m.outcome,
  };
}

function publicActor(a) {
  return {
    actor_name: a.actor_name,
    actor_type: a.actor_type,
    role:       a.role,
    mentions:   a.mentions,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

// Freshest non-acknowledged anomaly per event (last 6h) — used to populate
// the AnomalyChip on cards/headers. Older anomalies live in the dedicated
// /api/ri/anomalies feed.
const ANOM_FRESH_MS = 6 * 60 * 60 * 1000;
// Prominence sort (Phase 5a): rank by (2·source_count + article_count), recency-decayed.
// Divisor 1 + age/HALFLIFE → an event last active PROMINENCE_HALFLIFE_MS ago counts at ~half weight.
const PROMINENCE_HALFLIFE_MS = 24 * 60 * 60 * 1000;

function getEventBySlug(db, slug) {
  const cutoff = Date.now() - ANOM_FRESH_MS;
  return db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id = e.id)     AS article_count,
      (SELECT COUNT(DISTINCT a.source_name) FROM event_articles ea
         JOIN articles a ON a.id = ea.article_id WHERE ea.event_id = e.id)  AS source_count,
      (SELECT COUNT(*) FROM event_market_links eml WHERE eml.event_id = e.id) AS market_count,
      (SELECT pm.yes_price
       FROM event_market_links eml
       JOIN prediction_markets pm ON pm.id = eml.market_id
       WHERE eml.event_id = e.id
       ORDER BY eml.rank LIMIT 1)                                            AS top_probability,
      (SELECT r.truth_gap     FROM reality_index_snapshots r
       WHERE r.scope='event' AND r.scope_id = e.id ORDER BY r.ts DESC LIMIT 1) AS truth_gap,
      (SELECT r.reality_score FROM reality_index_snapshots r
       WHERE r.scope='event' AND r.scope_id = e.id ORDER BY r.ts DESC LIMIT 1) AS reality_score,
      (SELECT a.id           FROM anomaly_alerts a
       WHERE a.event_id = e.id AND a.acknowledged = 0 AND a.detected_at >= ?
       ORDER BY a.detected_at DESC LIMIT 1) AS anom_id,
      (SELECT a.type         FROM anomaly_alerts a
       WHERE a.event_id = e.id AND a.acknowledged = 0 AND a.detected_at >= ?
       ORDER BY a.detected_at DESC LIMIT 1) AS anom_type,
      (SELECT a.severity     FROM anomaly_alerts a
       WHERE a.event_id = e.id AND a.acknowledged = 0 AND a.detected_at >= ?
       ORDER BY a.detected_at DESC LIMIT 1) AS anom_severity,
      (SELECT a.detected_at  FROM anomaly_alerts a
       WHERE a.event_id = e.id AND a.acknowledged = 0 AND a.detected_at >= ?
       ORDER BY a.detected_at DESC LIMIT 1) AS anom_detected_at,
      (SELECT a.payload      FROM anomaly_alerts a
       WHERE a.event_id = e.id AND a.acknowledged = 0 AND a.detected_at >= ?
       ORDER BY a.detected_at DESC LIMIT 1) AS anom_payload
    FROM events e
    WHERE e.slug = ?
  `).get(cutoff, cutoff, cutoff, cutoff, cutoff, slug);
}

function safeJsonParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// ─── Routes ────────────────────────────────────────────────────────────────

/**
 * GET /api/events/world-map
 * Returns active events that have geo coordinates, optionally filtered by
 * category. Response is intentionally compact — the WorldMap component
 * needs id/slug/title/severity/category/lat/lng + last_activity_at and
 * nothing else. Capped at 500 events to keep the SVG manageable.
 */
router.get("/world-map", (req, res) => {
  try {
    const db = getDb();
    const category = req.query.category ?? null;
    const minSeverity = parseFloat(req.query.minSeverity ?? "0");
    const limit = Math.min(parseInt(req.query.limit ?? "300", 10), 500);

    let sql = `
      SELECT id, slug, title, category, severity, geo_lat, geo_lng,
             last_activity_at, status,
             (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id = e.id) AS article_count
      FROM events e
      WHERE status = 'active'
        AND geo_lat IS NOT NULL AND geo_lng IS NOT NULL
        AND severity >= ?
    `;
    const params = [minSeverity];
    if (category) { sql += " AND category = ?"; params.push(category); }
    sql += " ORDER BY severity DESC, last_activity_at DESC LIMIT ?";
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    res.json({ events: rows, count: rows.length });
  } catch (err) {
    logger.error(`GET /api/events/world-map error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/events
 * Query params: category, status (default 'active'), limit (default 30), offset
 */
router.get("/", (req, res) => {
  try {
    const db = getDb();
    const status   = req.query.status   ?? "active";
    const category = req.query.category ?? null;
    const sort     = req.query.sort     ?? "recency"; // "recency" (default, existing callers) | "prominence"
    const limit    = Math.min(parseInt(req.query.limit  ?? "30", 10), 100);
    const offset   = parseInt(req.query.offset ?? "0", 10);

    const cutoff = Date.now() - ANOM_FRESH_MS;
    let sql = `
      SELECT e.*,
        (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id = e.id)       AS article_count,
        (SELECT COUNT(DISTINCT a.source_name) FROM event_articles ea
           JOIN articles a ON a.id = ea.article_id WHERE ea.event_id = e.id)     AS source_count,
        (SELECT COUNT(*) FROM event_market_links eml WHERE eml.event_id = e.id) AS market_count,
        (SELECT pm.yes_price
         FROM event_market_links eml
         JOIN prediction_markets pm ON pm.id = eml.market_id
         WHERE eml.event_id = e.id
         ORDER BY eml.rank LIMIT 1)                                             AS top_probability,
        (SELECT r.truth_gap     FROM reality_index_snapshots r
         WHERE r.scope='event' AND r.scope_id = e.id ORDER BY r.ts DESC LIMIT 1) AS truth_gap,
        (SELECT r.reality_score FROM reality_index_snapshots r
         WHERE r.scope='event' AND r.scope_id = e.id ORDER BY r.ts DESC LIMIT 1) AS reality_score,
        (SELECT a.id           FROM anomaly_alerts a
         WHERE a.event_id = e.id AND a.acknowledged = 0 AND a.detected_at >= ?
         ORDER BY a.detected_at DESC LIMIT 1) AS anom_id,
        (SELECT a.type         FROM anomaly_alerts a
         WHERE a.event_id = e.id AND a.acknowledged = 0 AND a.detected_at >= ?
         ORDER BY a.detected_at DESC LIMIT 1) AS anom_type,
        (SELECT a.severity     FROM anomaly_alerts a
         WHERE a.event_id = e.id AND a.acknowledged = 0 AND a.detected_at >= ?
         ORDER BY a.detected_at DESC LIMIT 1) AS anom_severity,
        (SELECT a.detected_at  FROM anomaly_alerts a
         WHERE a.event_id = e.id AND a.acknowledged = 0 AND a.detected_at >= ?
         ORDER BY a.detected_at DESC LIMIT 1) AS anom_detected_at,
        (SELECT a.payload      FROM anomaly_alerts a
         WHERE a.event_id = e.id AND a.acknowledged = 0 AND a.detected_at >= ?
         ORDER BY a.detected_at DESC LIMIT 1) AS anom_payload,
        (
          (2.0 * (SELECT COUNT(DISTINCT a.source_name) FROM event_articles ea
                    JOIN articles a ON a.id = ea.article_id WHERE ea.event_id = e.id)
           + (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id = e.id))
          / (1.0 + (CAST(? AS REAL) - e.last_activity_at) / ?)
        ) AS prominence
      FROM events e
      WHERE e.status = ?
    `;
    const now = Date.now();
    const params = [cutoff, cutoff, cutoff, cutoff, cutoff, now, PROMINENCE_HALFLIFE_MS, status];

    if (category) {
      sql += " AND e.category = ?";
      params.push(category);
    }

    // recency is the default (existing callers unaffected); prominence leads with the biggest
    // current multi-source stories. ORDER BY references the `prominence` output-column alias.
    sql += sort === "prominence"
      ? " ORDER BY prominence DESC, e.last_activity_at DESC"
      : " ORDER BY e.last_activity_at DESC";
    sql += " LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params);
    res.json({ events: rows.map(publicEvent), limit, offset, sort });
  } catch (err) {
    logger.error(`GET /api/events error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/events/:slug — full event dossier
 */
router.get("/:slug", (req, res) => {
  try {
    const db  = getDb();
    const ev  = getEventBySlug(db, req.params.slug);
    if (!ev) return res.status(404).json({ error: "Event not found" });
    // Phase 4 durable identity: a merged event's old slug is an alias for its survivor.
    // Redirect to the survivor instead of serving the stale merged row. 302 + Location for
    // HTTP clients; the {redirect} body lets the SPA replace its route to the canonical slug.
    if (ev.status === "merged") {
      const meta = safeJsonParse(ev.meta);
      if (meta?.merged_into_slug) {
        return res
          .status(302)
          .set("Location", `/api/ri/events/${meta.merged_into_slug}`)
          .json({ redirect: meta.merged_into_slug, merged_into: meta.merged_into ?? null, status: "merged" });
      }
    }
    res.json(publicEvent(ev));
  } catch (err) {
    logger.error(`GET /api/events/:slug error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/events/:slug/trackers — all Tracker Auto-Detection Engine
 * trackers attached to this event (Sprint 1.5.1).
 *
 * An event can carry multiple trackers of different template_types
 * (multi-template fan-out — e.g. a politics event firing conflict +
 * incident + election). Returns ALL of them; the frontend (Sprint 1.5.2)
 * does any Q1 ranking for which surfaces on the Layer 1 card. Server-side
 * does no ranking. publicTracker includes template_type, status, metrics
 * (with confidence values), and data_source_provenance._origin so the
 * frontend has what it needs to rank + render provenance.
 */
router.get("/:slug/trackers", (req, res) => {
  try {
    const db = getDb();
    const ev = db.prepare("SELECT id FROM events WHERE slug = ?").get(req.params.slug);
    if (!ev) return res.status(404).json({ error: "Event not found" });

    const trackers = listTrackersByEvent(ev.id);
    res.json({ trackers: trackers.map(publicTracker) });
  } catch (err) {
    logger.error(`GET /api/events/:slug/trackers error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/events/:slug/timeline
 * Query params: kind (filter by 'article'|'market_move'), limit, offset
 */
router.get("/:slug/timeline", (req, res) => {
  try {
    const db  = getDb();
    const ev  = db.prepare("SELECT id FROM events WHERE slug = ?").get(req.params.slug);
    if (!ev) return res.status(404).json({ error: "Event not found" });

    const kind   = req.query.kind ?? null;
    const limit  = Math.min(parseInt(req.query.limit  ?? "50", 10), 200);
    const offset = parseInt(req.query.offset ?? "0", 10);

    let sql = "SELECT * FROM event_timeline WHERE event_id = ?";
    const params = [ev.id];
    if (kind) { sql += " AND kind = ?"; params.push(kind); }
    sql += " ORDER BY ts DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params);
    res.json({ timeline: rows.map(publicTimelineEntry), limit, offset });
  } catch (err) {
    logger.error(`GET /api/events/:slug/timeline error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/events/:slug/markets
 */
router.get("/:slug/markets", (req, res) => {
  try {
    const db  = getDb();
    const ev  = db.prepare("SELECT id FROM events WHERE slug = ?").get(req.params.slug);
    if (!ev) return res.status(404).json({ error: "Event not found" });

    const markets = db.prepare(`
      SELECT pm.*, eml.weight, eml.rank
      FROM event_market_links eml
      JOIN prediction_markets pm ON pm.id = eml.market_id
      WHERE eml.event_id = ?
      ORDER BY eml.rank
    `).all(ev.id);

    res.json({ markets: markets.map(publicMarket) });
  } catch (err) {
    logger.error(`GET /api/events/:slug/markets error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/events/:slug/articles
 * Query params: limit, offset
 */
router.get("/:slug/articles", (req, res) => {
  try {
    const db  = getDb();
    const ev  = db.prepare("SELECT id FROM events WHERE slug = ?").get(req.params.slug);
    if (!ev) return res.status(404).json({ error: "Event not found" });

    const limit  = Math.min(parseInt(req.query.limit  ?? "30", 10), 100);
    const offset = parseInt(req.query.offset ?? "0", 10);

    const articles = db.prepare(`
      SELECT a.id, a.title, a.url, a.image_url, a.source_name, a.published_at,
             a.description AS summary, a.credibility, a.category, ea.relevance
      FROM event_articles ea
      JOIN articles a ON a.id = ea.article_id
      WHERE ea.event_id = ?
      ORDER BY a.published_at DESC
      LIMIT ? OFFSET ?
    `).all(ev.id, limit, offset);

    const total = db.prepare(
      "SELECT COUNT(*) AS c FROM event_articles WHERE event_id = ?"
    ).get(ev.id)?.c ?? 0;

    res.json({ articles, total, limit, offset });
  } catch (err) {
    logger.error(`GET /api/events/:slug/articles error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/events/:slug/actors
 */
router.get("/:slug/actors", (req, res) => {
  try {
    const db  = getDb();
    const ev  = db.prepare("SELECT id FROM events WHERE slug = ?").get(req.params.slug);
    if (!ev) return res.status(404).json({ error: "Event not found" });

    const actors = db.prepare(`
      SELECT * FROM event_actors WHERE event_id = ?
      ORDER BY mentions DESC LIMIT 20
    `).all(ev.id);

    res.json({ actors: actors.map(publicActor) });
  } catch (err) {
    logger.error(`GET /api/events/:slug/actors error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/events/:slug/sentiment — per-source sentiment time-series.
 * Query params: sinceMs (default 7d back), source (optional filter), limit (default 500)
 */
router.get("/:slug/sentiment", (req, res) => {
  try {
    const db = getDb();
    const ev = db.prepare("SELECT id FROM events WHERE slug = ?").get(req.params.slug);
    if (!ev) return res.status(404).json({ error: "Event not found" });

    const sinceMs = parseInt(req.query.sinceMs ?? String(Date.now() - 7 * 24 * 60 * 60 * 1000), 10);
    const source  = req.query.source ?? null;
    const limit   = Math.min(parseInt(req.query.limit ?? "500", 10), 2000);

    const latest  = latestSnapshotsByScope("event", ev.id);
    const history = snapshotHistory("event", ev.id, { sinceMs, source, limit });

    res.json({
      latest:  latest.map(s => ({ source: s.source, polarity: s.polarity, intensity: s.intensity, volume: s.volume, ts: s.ts })),
      history: history.map(s => ({ source: s.source, ts: s.ts, polarity: s.polarity, intensity: s.intensity, volume: s.volume })),
    });
  } catch (err) {
    logger.error(`GET /api/events/:slug/sentiment error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/events/:slug/reality-index — composite + breakdown.
 * Query params: history (default false; if true, returns last 100 snapshots)
 */
router.get("/:slug/reality-index", (req, res) => {
  try {
    const db = getDb();
    const ev = db.prepare("SELECT id FROM events WHERE slug = ?").get(req.params.slug);
    if (!ev) return res.status(404).json({ error: "Event not found" });

    const latest = latestRealityIndex("event", ev.id);
    const wantHistory = String(req.query.history ?? "false").toLowerCase() === "true";

    let payload = {
      latest: latest ? {
        ts:                 latest.ts,
        market_probability: latest.market_probability,
        media_sentiment:    latest.media_sentiment,
        social_sentiment:   latest.social_sentiment,
        economic_signal:    latest.economic_signal,
        truth_gap:          latest.truth_gap,
        reality_score:      latest.reality_score,
        confidence:         latest.confidence,
        components:         safeJsonParse(latest.components),
      } : null,
    };

    if (wantHistory) {
      const sinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
      payload.history = realityIndexHistory("event", ev.id, { sinceMs, limit: 200 })
        .map(r => ({
          ts:                 r.ts,
          market_probability: r.market_probability,
          media_sentiment:    r.media_sentiment,
          social_sentiment:   r.social_sentiment,
          truth_gap:          r.truth_gap,
          reality_score:      r.reality_score,
          confidence:         r.confidence,
        }));
    }

    res.json(payload);
  } catch (err) {
    logger.error(`GET /api/events/:slug/reality-index error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/events/:slug/perspectives
 * Returns articles grouped by source for multi-outlet comparison.
 */
router.get("/:slug/perspectives", (req, res) => {
  try {
    const db  = getDb();
    const ev  = db.prepare("SELECT id FROM events WHERE slug = ?").get(req.params.slug);
    if (!ev) return res.status(404).json({ error: "Event not found" });

    const articles = db.prepare(`
      SELECT a.id, a.title, a.url, a.source_name, a.published_at,
             a.description AS summary, a.credibility
      FROM event_articles ea
      JOIN articles a ON a.id = ea.article_id
      WHERE ea.event_id = ?
      ORDER BY a.published_at DESC
      LIMIT 60
    `).all(ev.id);

    // Group by source_name, take top 3 articles each
    const bySource = {};
    for (const a of articles) {
      const key = a.source_name ?? "Unknown";
      if (!bySource[key]) bySource[key] = [];
      if (bySource[key].length < 3) bySource[key].push(a);
    }

    const perspectives = Object.entries(bySource)
      .map(([source, arts]) => ({ source, articles: arts }))
      .sort((a, b) => b.articles.length - a.articles.length)
      .slice(0, 12);

    res.json({ perspectives });
  } catch (err) {
    logger.error(`GET /api/events/:slug/perspectives error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
