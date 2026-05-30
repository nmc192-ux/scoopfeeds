/**
 * /api/ri/trackers — Tracker Auto-Detection Engine read API (Sprint 1.5.1).
 *
 * Public, reader-facing RI data (mirrors the /api/ri/events router pattern;
 * NOT admin-gated). Mounted under /api/ri/trackers with the same
 * predictionsLimiter + cacheMiddleware("short") boundary as events.
 *
 * Routes:
 *   GET  /api/ri/trackers?type=&status=&limit=   list trackers (optionally
 *                                                filtered by template_type)
 *   GET  /api/ri/trackers/:id                    single tracker + revision
 *                                                history (Layer 2 detail)
 *
 * The third Sprint 1.5 endpoint — GET /api/ri/events/:slug/trackers — lives
 * on the events router as a sub-resource (slug→event resolution is the
 * events router's responsibility), not here.
 *
 * All reads come from SQLite via the Sprint 1.2 DAO (models/trackers.js) —
 * no upstream calls in the request path. The DAO is the API surface; this
 * router does no raw tracker SQL (preserving the Sprint 1.2 DAO boundary).
 *
 * These endpoints also serve as the first HTTP way to inspect what the
 * live detection engine (Sprint 1.3) has created — the production-visibility
 * gap carried since Session 7.
 */

import express from "express";
import { logger } from "../services/logger.js";
import {
  getTracker,
  listTrackersByType,
  listTrackerRevisions,
  TEMPLATE_TYPES,
  TrackerValidationError,
} from "../models/trackers.js";

const router = express.Router();

// ─── Serializers ───────────────────────────────────────────────────────────
// publicTracker exposes domain fields only. Internal audit timestamps
// (created_at / updated_at) are omitted — the domain lifecycle is fully
// described by started_at / last_updated_at / closed_at. The JSON columns
// (metrics / template_meta / data_source_provenance) arrive already hydrated
// from the DAO. data_source_provenance is exposed in full INCLUDING
// _ingester_status + _origin, because the frontend's provenance indicator
// (Sprint 1.5 Q4) reads them.
//
// event_slug (Sprint 1.5.3) lets the Layer 2 tracker page link back to its
// parent event (/events/:slug). It is resolved by getTracker's events JOIN,
// so it is populated on the single-tracker read (GET /trackers/:id) and is
// null on the list reads (GET /trackers, GET /events/:slug/trackers) — those
// consumers don't need it (the event page already knows its own slug). Always
// present in the shape as `event_slug` (null when unresolved); additive.

export function publicTracker(t) {
  if (!t) return null;
  return {
    id:                     t.id,
    event_id:               t.event_id,
    event_slug:             t.event_slug ?? null,
    template_type:          t.template_type,
    status:                 t.status,
    metrics:                t.metrics ?? {},
    template_meta:          t.template_meta ?? null,
    data_source_provenance: t.data_source_provenance ?? null,
    parent_tracker_id:      t.parent_tracker_id ?? null,
    started_at:             t.started_at,
    last_updated_at:        t.last_updated_at,
    closed_at:              t.closed_at ?? null,
  };
}

// publicRevision exposes the metric-change audit fields. Internal
// autoincrement row id is omitted (mirrors events' shapers, which expose
// domain fields, not row ids).
function publicRevision(r) {
  if (!r) return null;
  return {
    metric_name: r.metric_name,
    prev_block:  r.prev_block ?? null,
    new_block:   r.new_block ?? null,
    reason:      r.reason,
    changed_at:  r.changed_at,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────

/**
 * GET /api/ri/trackers — list trackers.
 *
 * Query params:
 *   type   — optional template_type filter (one of the 8). 400 if invalid.
 *   status — 'active' (default) | 'dormant' | 'archived'. 400 if invalid.
 *   limit  — default 50, capped at 200.
 *
 * When `type` is provided, delegates to listTrackersByType. When omitted,
 * iterates all 8 template_types via the DAO (no raw tracker SQL in the
 * router — preserves the Sprint 1.2 DAO boundary), merges, re-sorts by
 * last_updated_at DESC, and applies the limit across the merged set. The
 * trackers table is small, so the 8-query fan is cheap.
 */
router.get("/", (req, res) => {
  try {
    const type   = req.query.type ?? null;
    const status = req.query.status ?? "active";
    const limit  = Math.min(parseInt(req.query.limit ?? "50", 10), 200);

    let rows;
    if (type) {
      // listTrackersByType validates both type and status; a bad value
      // throws TrackerValidationError, caught below → 400.
      rows = listTrackersByType({ template_type: type, status, limit });
    } else {
      // All-types path: merge per-type DAO results, re-sort, re-limit.
      // Merges per-type DAO queries to keep SQL behind the DAO boundary;
      // fine at current table scale. If tracker_instances grows large,
      // replace with a single listAllTrackers DAO query (this fetches
      // `limit` per-type then discards down to `limit` across the merge).
      const merged = [];
      for (const t of TEMPLATE_TYPES) {
        merged.push(...listTrackersByType({ template_type: t, status, limit }));
      }
      merged.sort((a, b) => b.last_updated_at - a.last_updated_at);
      rows = merged.slice(0, limit);
    }

    res.json({ trackers: rows.map(publicTracker), limit });
  } catch (err) {
    if (err instanceof TrackerValidationError) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    logger.error(`GET /api/ri/trackers error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/ri/trackers/:id — single tracker + revision history.
 *
 * Returns { tracker, revisions } for the Layer 2 full tracker page.
 * 404 (mirroring events' shape) when the tracker id doesn't resolve.
 */
router.get("/:id", (req, res) => {
  try {
    const tracker = getTracker(req.params.id);
    if (!tracker) return res.status(404).json({ error: "Tracker not found" });

    const revisions = listTrackerRevisions(req.params.id, { limit: 50 });
    res.json({
      tracker:   publicTracker(tracker),
      revisions: revisions.map(publicRevision),
    });
  } catch (err) {
    logger.error(`GET /api/ri/trackers/:id error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
