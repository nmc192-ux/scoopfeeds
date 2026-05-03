/**
 * watchlistsDao — read/write helpers for user_watchlists.
 *
 * item_type controls hydration semantics:
 *   'event'   → joined to events.slug + title for display
 *   'market'  → joined to prediction_markets.question
 *   'topic'   → free-text slug (matches story_clusters.category)
 *   'ticker'  → free-text symbol (Phase 5+ wiring to /api/finance)
 */

import { getDb } from "../../models/database.js";

export function addToWatchlist({
  user_id, item_type, item_id,
  alert_threshold = null,
  alert_types     = [],
  notify_push     = 1,
  notify_email    = 0,
}) {
  return getDb().prepare(`
    INSERT INTO user_watchlists
      (user_id, item_type, item_id, alert_threshold, alert_types, notify_push, notify_email, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET
      alert_threshold = excluded.alert_threshold,
      alert_types     = excluded.alert_types,
      notify_push     = excluded.notify_push,
      notify_email    = excluded.notify_email
  `).run(
    user_id, item_type, item_id,
    alert_threshold,
    JSON.stringify(Array.isArray(alert_types) ? alert_types : []),
    notify_push ? 1 : 0,
    notify_email ? 1 : 0,
    Date.now(),
  );
}

export function removeFromWatchlist(user_id, item_type, item_id) {
  return getDb().prepare(
    "DELETE FROM user_watchlists WHERE user_id = ? AND item_type = ? AND item_id = ?"
  ).run(user_id, item_type, item_id);
}

export function isWatching(user_id, item_type, item_id) {
  return !!getDb().prepare(
    "SELECT 1 FROM user_watchlists WHERE user_id = ? AND item_type = ? AND item_id = ? LIMIT 1"
  ).get(user_id, item_type, item_id);
}

/** All watchlist entries for a user, hydrated with display metadata. */
export function listForUser(user_id) {
  const db   = getDb();
  const rows = db.prepare(`
    SELECT * FROM user_watchlists WHERE user_id = ? ORDER BY created_at DESC
  `).all(user_id);

  // Hydrate event entries.
  const eventIds = rows.filter(r => r.item_type === "event").map(r => r.item_id);
  const eventMeta = eventIds.length
    ? new Map(
        db.prepare(`
          SELECT e.id, e.slug, e.title, e.category, e.severity, e.status, e.last_activity_at,
            (SELECT pm.yes_price FROM event_market_links eml
             JOIN prediction_markets pm ON pm.id = eml.market_id
             WHERE eml.event_id = e.id ORDER BY eml.rank LIMIT 1) AS top_probability,
            (SELECT r.reality_score FROM reality_index_snapshots r
             WHERE r.scope='event' AND r.scope_id = e.id ORDER BY ts DESC LIMIT 1) AS reality_score,
            (SELECT r.truth_gap FROM reality_index_snapshots r
             WHERE r.scope='event' AND r.scope_id = e.id ORDER BY ts DESC LIMIT 1) AS truth_gap
          FROM events e WHERE e.id IN (${eventIds.map(() => "?").join(",")})
        `).all(...eventIds).map(e => [e.id, e])
      )
    : new Map();

  // Hydrate market entries.
  const marketIds = rows.filter(r => r.item_type === "market").map(r => r.item_id);
  const marketMeta = marketIds.length
    ? new Map(
        db.prepare(`
          SELECT id, question, yes_price, no_price, volume_24h, source, url, end_date
          FROM prediction_markets WHERE id IN (${marketIds.map(() => "?").join(",")})
        `).all(...marketIds).map(m => [m.id, m])
      )
    : new Map();

  return rows.map(r => {
    const base = {
      item_type:       r.item_type,
      item_id:         r.item_id,
      alert_threshold: r.alert_threshold,
      alert_types:     safeJsonArray(r.alert_types),
      notify_push:     !!r.notify_push,
      notify_email:    !!r.notify_email,
      created_at:      r.created_at,
    };
    if (r.item_type === "event") {
      const m = eventMeta.get(r.item_id);
      return { ...base, event: m ?? null };
    }
    if (r.item_type === "market") {
      const m = marketMeta.get(r.item_id);
      return { ...base, market: m ?? null };
    }
    return base;
  });
}

/**
 * Recent activity across a user's watchlist. Combines anomaly_alerts +
 * latest reality_index_snapshots for the watched events.
 */
export function activityForUser(user_id, { sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000, limit = 50 } = {}) {
  const db = getDb();
  const eventIds = db.prepare(
    "SELECT item_id FROM user_watchlists WHERE user_id = ? AND item_type = 'event'"
  ).all(user_id).map(r => r.item_id);

  if (!eventIds.length) return { anomalies: [], snapshots: [] };

  const placeholders = eventIds.map(() => "?").join(",");
  const anomalies = db.prepare(`
    SELECT a.id, a.type, a.severity, a.event_id, a.payload, a.detected_at,
           e.slug, e.title
    FROM anomaly_alerts a
    JOIN events e ON e.id = a.event_id
    WHERE a.event_id IN (${placeholders}) AND a.detected_at >= ?
    ORDER BY a.detected_at DESC
    LIMIT ?
  `).all(...eventIds, sinceMs, limit);

  return {
    anomalies: anomalies.map(a => ({
      id:          a.id,
      event_id:    a.event_id,
      event_slug:  a.slug,
      event_title: a.title,
      type:        a.type,
      severity:    a.severity,
      detected_at: a.detected_at,
      payload:     safeJsonObj(a.payload),
    })),
  };
}

function safeJsonArray(s) {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}
function safeJsonObj(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}
