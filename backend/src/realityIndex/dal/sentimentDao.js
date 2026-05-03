/**
 * sentimentDao — read/write helpers for sentiment_snapshots.
 *
 * Conventions:
 *   scope    = 'event' | 'cluster' | 'article' | 'topic'
 *   scope_id = the ID in that namespace
 *   source   = 'media' | 'bluesky' | 'reddit' | 'mastodon' | 'hn' | 'wikipedia' | 'x' | 'threads'
 *   polarity in [-1, +1]; intensity in [0, 1]; volume = mention/post count.
 *
 * One row per (scope, scope_id, ts, source). The same scorer cycle should
 * write all sources at the same `ts` so the time-series lines up.
 */

import { getDb } from "../../models/database.js";

export function upsertSentimentSnapshot({
  scope, scope_id, ts, source, polarity, intensity, volume = 0, raw_meta = null,
}) {
  return getDb().prepare(`
    INSERT INTO sentiment_snapshots
      (scope, scope_id, ts, source, polarity, intensity, volume, raw_meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, scope_id, ts, source) DO UPDATE SET
      polarity   = excluded.polarity,
      intensity  = excluded.intensity,
      volume     = excluded.volume,
      raw_meta   = excluded.raw_meta
  `).run(
    scope, scope_id, ts, source,
    polarity, intensity, volume,
    raw_meta ? JSON.stringify(raw_meta) : null,
  );
}

/** Latest snapshot per source for a given scope_id. */
export function latestSnapshotsByScope(scope, scope_id) {
  return getDb().prepare(`
    SELECT s.*
    FROM sentiment_snapshots s
    JOIN (
      SELECT source, MAX(ts) AS max_ts
      FROM sentiment_snapshots
      WHERE scope = ? AND scope_id = ?
      GROUP BY source
    ) latest
      ON latest.source = s.source AND latest.max_ts = s.ts
    WHERE s.scope = ? AND s.scope_id = ?
  `).all(scope, scope_id, scope, scope_id);
}

/** Time-series for a scope, optionally filtered by source. */
export function snapshotHistory(scope, scope_id, { source = null, sinceMs = null, limit = 500 } = {}) {
  let sql = "SELECT * FROM sentiment_snapshots WHERE scope = ? AND scope_id = ?";
  const params = [scope, scope_id];
  if (source) { sql += " AND source = ?"; params.push(source); }
  if (sinceMs) { sql += " AND ts >= ?"; params.push(sinceMs); }
  sql += " ORDER BY ts DESC LIMIT ?";
  params.push(limit);
  return getDb().prepare(sql).all(...params);
}

/** Aggregate baseline volume per source over a window for anomaly detection. */
export function baselineVolume(scope, scope_id, source, { sinceMs, untilMs }) {
  const row = getDb().prepare(`
    SELECT AVG(volume) AS avg_vol, COUNT(*) AS n
    FROM sentiment_snapshots
    WHERE scope = ? AND scope_id = ? AND source = ?
      AND ts >= ? AND ts < ?
  `).get(scope, scope_id, source, sinceMs, untilMs);
  return { avg: row?.avg_vol ?? 0, samples: row?.n ?? 0 };
}

/** Used by anomalyDetector to detect a polarity sign-flip. */
export function previousPolarity(scope, scope_id, source, beforeTs) {
  const row = getDb().prepare(`
    SELECT polarity, intensity, ts FROM sentiment_snapshots
    WHERE scope = ? AND scope_id = ? AND source = ? AND ts < ?
    ORDER BY ts DESC LIMIT 1
  `).get(scope, scope_id, source, beforeTs);
  return row ?? null;
}
