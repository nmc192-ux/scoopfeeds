/**
 * realityIndexDao — read/write helpers for reality_index_snapshots and
 * anomaly_alerts.
 *
 * One row per (scope, scope_id, ts). Composite recomputed on schedule by
 * intelligence/realityIndex.js.
 */

import { getDb } from "../../models/database.js";

export function upsertRealityIndexSnapshot({
  scope, scope_id, ts,
  market_probability,
  media_sentiment,
  social_sentiment,
  economic_signal,
  truth_gap,
  reality_score,
  confidence,
  components = null,
}) {
  return getDb().prepare(`
    INSERT INTO reality_index_snapshots
      (scope, scope_id, ts, market_probability, media_sentiment, social_sentiment,
       economic_signal, truth_gap, reality_score, confidence, components)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, scope_id, ts) DO UPDATE SET
      market_probability = excluded.market_probability,
      media_sentiment    = excluded.media_sentiment,
      social_sentiment   = excluded.social_sentiment,
      economic_signal    = excluded.economic_signal,
      truth_gap          = excluded.truth_gap,
      reality_score      = excluded.reality_score,
      confidence         = excluded.confidence,
      components         = excluded.components
  `).run(
    scope, scope_id, ts,
    market_probability, media_sentiment, social_sentiment,
    economic_signal, truth_gap, reality_score, confidence,
    components ? JSON.stringify(components) : null,
  );
}

export function latestRealityIndex(scope, scope_id) {
  return getDb().prepare(`
    SELECT * FROM reality_index_snapshots
    WHERE scope = ? AND scope_id = ?
    ORDER BY ts DESC LIMIT 1
  `).get(scope, scope_id);
}

export function realityIndexHistory(scope, scope_id, { sinceMs = null, limit = 500 } = {}) {
  let sql = "SELECT * FROM reality_index_snapshots WHERE scope = ? AND scope_id = ?";
  const params = [scope, scope_id];
  if (sinceMs) { sql += " AND ts >= ?"; params.push(sinceMs); }
  sql += " ORDER BY ts DESC LIMIT ?";
  params.push(limit);
  return getDb().prepare(sql).all(...params);
}

/**
 * Top truth-gap stories — events with the largest absolute divergence between
 * market-implied probability and media tone in the last `windowMs` window.
 *
 * direction:
 *   'over'   = media more alarmed than market (truth_gap > 0 means market HIGHER than media tone normalized)
 *   'under'  = media more confident than market
 *   'both'   = sort by absolute value
 */
export function topTruthGap({ windowMs = 24 * 60 * 60 * 1000, limit = 25, direction = "both", scope = "event" } = {}) {
  const since = Date.now() - windowMs;
  // For each scope_id, take the latest snapshot in window, then rank.
  let orderBy;
  if (direction === "over")  orderBy = "truth_gap DESC";
  else if (direction === "under") orderBy = "truth_gap ASC";
  else orderBy = "ABS(truth_gap) DESC";

  return getDb().prepare(`
    SELECT r.*
    FROM reality_index_snapshots r
    JOIN (
      SELECT scope, scope_id, MAX(ts) AS max_ts
      FROM reality_index_snapshots
      WHERE scope = ? AND ts >= ? AND truth_gap IS NOT NULL
      GROUP BY scope, scope_id
    ) latest
      ON latest.scope = r.scope AND latest.scope_id = r.scope_id AND latest.max_ts = r.ts
    WHERE r.confidence >= 0.3
    ORDER BY ${orderBy}
    LIMIT ?
  `).all(scope, since, limit);
}

// ─── Anomalies ──────────────────────────────────────────────────────────────

export function recordAnomaly({
  event_id = null, cluster_id = null, market_id = null,
  type, severity, payload,
}) {
  // De-dupe within the same hour for the same target+type (avoid alert spam).
  const since = Date.now() - 60 * 60 * 1000;
  const dupe = getDb().prepare(`
    SELECT 1 FROM anomaly_alerts
    WHERE type = ? AND detected_at >= ?
      AND COALESCE(event_id, '')   = COALESCE(?, '')
      AND COALESCE(cluster_id, '') = COALESCE(?, '')
      AND COALESCE(market_id, '')  = COALESCE(?, '')
    LIMIT 1
  `).get(type, since, event_id, cluster_id, market_id);
  if (dupe) return { skipped: true };

  const info = getDb().prepare(`
    INSERT INTO anomaly_alerts
      (event_id, cluster_id, market_id, type, severity, payload, detected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    event_id, cluster_id, market_id, type, severity,
    JSON.stringify(payload), Date.now()
  );
  return { inserted: true, id: info.lastInsertRowid };
}

export function listAnomalies({ limit = 50, sinceMs = null, type = null, includeAcknowledged = false } = {}) {
  let sql = "SELECT * FROM anomaly_alerts WHERE 1=1";
  const params = [];
  if (sinceMs) { sql += " AND detected_at >= ?"; params.push(sinceMs); }
  if (type)    { sql += " AND type = ?";        params.push(type); }
  if (!includeAcknowledged) sql += " AND acknowledged = 0";
  sql += " ORDER BY detected_at DESC LIMIT ?";
  params.push(limit);
  return getDb().prepare(sql).all(...params);
}

export function acknowledgeAnomaly(id) {
  return getDb().prepare("UPDATE anomaly_alerts SET acknowledged = 1 WHERE id = ?").run(id);
}
