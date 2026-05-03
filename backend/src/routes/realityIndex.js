/**
 * /api/ri — Reality Index Phase 3 cross-event endpoints.
 *
 * Routes:
 *   GET  /api/ri/truth-gap         top divergences between market and media tone
 *   GET  /api/ri/anomalies         recent anomaly alerts
 *
 * The per-event sentiment + reality-index endpoints live on /api/ri/events
 * (see routes/events.js).
 */

import express from "express";
import { getDb } from "../models/database.js";
import { logger } from "../services/logger.js";
import { topTruthGap, listAnomalies } from "../realityIndex/dal/realityIndexDao.js";

const router = express.Router();

/**
 * GET /api/ri/truth-gap
 * Query: windowMs (default 24h), limit (default 25), direction (over|under|both, default both)
 */
router.get("/truth-gap", (req, res) => {
  try {
    const windowMs  = parseInt(req.query.windowMs ?? String(24 * 60 * 60 * 1000), 10);
    const limit     = Math.min(parseInt(req.query.limit ?? "25", 10), 100);
    const direction = ["over", "under", "both"].includes(req.query.direction) ? req.query.direction : "both";

    const rows = topTruthGap({ windowMs, limit, direction, scope: "event" });
    if (!rows.length) return res.json({ items: [] });

    // Hydrate event title + slug + category from events table.
    const db    = getDb();
    const ids   = rows.map(r => r.scope_id);
    const meta  = db.prepare(
      `SELECT id, slug, title, category, severity, hero_image_url, status,
              last_activity_at
       FROM events WHERE id IN (${ids.map(() => "?").join(",")})`
    ).all(...ids);
    const byId  = new Map(meta.map(m => [m.id, m]));

    const items = rows.map(r => {
      const m = byId.get(r.scope_id);
      return {
        event_id:           r.scope_id,
        slug:               m?.slug,
        title:              m?.title,
        category:           m?.category,
        severity:           m?.severity,
        hero_image_url:     m?.hero_image_url,
        last_activity_at:   m?.last_activity_at,
        ts:                 r.ts,
        market_probability: r.market_probability,
        media_sentiment:    r.media_sentiment,
        social_sentiment:   r.social_sentiment,
        truth_gap:          r.truth_gap,
        reality_score:      r.reality_score,
        confidence:         r.confidence,
      };
    }).filter(i => i.slug);  // drop any orphans

    res.json({ items, windowMs, direction });
  } catch (err) {
    logger.error(`GET /api/ri/truth-gap error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/ri/anomalies
 * Query: limit (default 50), sinceMs (default 24h), type (filter), includeAck (default false)
 */
router.get("/anomalies", (req, res) => {
  try {
    const limit               = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
    const sinceMs             = parseInt(req.query.sinceMs ?? String(Date.now() - 24 * 60 * 60 * 1000), 10);
    const type                = req.query.type ?? null;
    const includeAcknowledged = String(req.query.includeAck ?? "false").toLowerCase() === "true";

    const rows = listAnomalies({ limit, sinceMs, type, includeAcknowledged });

    // Hydrate event slug/title for any event_id present.
    const db = getDb();
    const evIds = [...new Set(rows.map(r => r.event_id).filter(Boolean))];
    const evMeta = evIds.length
      ? new Map(
          db.prepare(`SELECT id, slug, title FROM events WHERE id IN (${evIds.map(() => "?").join(",")})`)
            .all(...evIds)
            .map(e => [e.id, e])
        )
      : new Map();

    const items = rows.map(r => ({
      id:           r.id,
      type:         r.type,
      severity:     r.severity,
      detected_at:  r.detected_at,
      event_id:     r.event_id,
      event_slug:   r.event_id ? evMeta.get(r.event_id)?.slug : null,
      event_title:  r.event_id ? evMeta.get(r.event_id)?.title : null,
      market_id:    r.market_id,
      cluster_id:   r.cluster_id,
      acknowledged: !!r.acknowledged,
      payload:      safeParse(r.payload),
    }));

    res.json({ items });
  } catch (err) {
    logger.error(`GET /api/ri/anomalies error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

function safeParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

export default router;
