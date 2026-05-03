/**
 * watchlistPushDispatcher — fans out fresh anomaly_alerts to push subscribers
 * who are watching the affected event with notify_push = 1.
 *
 * Per-cycle steps:
 *   1. Pull anomaly_alerts in the last LOOKBACK_MS (default 30 min).
 *   2. For each anomaly with an event_id:
 *        a. Find user_watchlists where item_type='event' AND item_id=event_id
 *           AND notify_push=1, filtered by alert_types (empty = all types) and
 *           alert_threshold (anomaly.severity must clear it).
 *        b. For each matching user, dedupe via pushed_anomalies (PK).
 *        c. Look up the user's active push subscriptions, send via
 *           pushService.sendToSubscriptions, and record pushed_anomalies.
 *
 * Designed to be cheap: every step is a bounded SQL query; no LLM calls;
 * VAPID setup already happens at boot via pushService.
 */

import { getDb } from "../../models/database.js";
import { listSubscriptionsForUsers } from "../../models/database.js";
import { sendToSubscriptions } from "../../services/pushService.js";
import { logger } from "../../services/logger.js";

const LOOKBACK_MS = parseInt(process.env.WATCHLIST_PUSH_LOOKBACK_MS || String(30 * 60 * 1000), 10);

const TYPE_TITLES = {
  odds_shift:      "Market shift on your watch",
  truth_gap_spike: "Divergence spike on your watch",
  viral_no_react:  "Going viral, market quiet",
  sentiment_flip:  "Sentiment flipped",
};

const TYPE_EMOJI = {
  odds_shift:      "📊",
  truth_gap_spike: "⚖️",
  viral_no_react:  "💬",
  sentiment_flip:  "🔄",
};

function summary(type, payload) {
  if (!payload) return "";
  switch (type) {
    case "odds_shift": {
      const d = payload.delta_pp;
      return `${d > 0 ? "+" : ""}${d}pp in 1h → now ${Math.round((payload.to ?? 0) * 100)}%`;
    }
    case "truth_gap_spike":
      return `Truth Gap ${payload.from?.toFixed?.(2)} → ${payload.to?.toFixed?.(2)}`;
    case "viral_no_react":
      return `${payload.ratio}× normal volume, market unchanged`;
    case "sentiment_flip":
      return `${payload.source}: ${payload.from?.toFixed?.(2)} → ${payload.to?.toFixed?.(2)}`;
    default:
      return "";
  }
}

function buildPayload(anomaly, eventTitle, eventSlug) {
  const emoji = TYPE_EMOJI[anomaly.type] ?? "🔔";
  const title = `${emoji} ${TYPE_TITLES[anomaly.type] ?? "Watchlist alert"}`;
  const body  = `${eventTitle}\n${summary(anomaly.type, anomaly.payload)}`.slice(0, 240);
  return {
    title,
    body,
    url:       `/events/${eventSlug}?source=push`,
    icon:      "/news-icon.svg",
    badge:     "/news-icon.svg",
    timestamp: anomaly.detected_at ?? Date.now(),
    tag:       `anomaly-${anomaly.id}`,
  };
}

function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

function findWatchersForAnomaly(db, anomaly) {
  // Find watchlists for this event with notify_push=1.
  // Filter by alert_types (empty array → all types).
  // Filter by alert_threshold (severity must be >= threshold; null threshold → no floor).
  const rows = db.prepare(`
    SELECT user_id, alert_types, alert_threshold
    FROM user_watchlists
    WHERE item_type = 'event' AND item_id = ? AND notify_push = 1
  `).all(anomaly.event_id);

  return rows.filter(w => {
    if (w.alert_threshold != null && anomaly.severity < w.alert_threshold) return false;
    const types = safeJsonParse(w.alert_types) ?? [];
    if (Array.isArray(types) && types.length > 0 && !types.includes(anomaly.type)) return false;
    return true;
  });
}

export async function runWatchlistPushDispatcher() {
  const db    = getDb();
  const since = Date.now() - LOOKBACK_MS;

  // Anomalies scoped to events (we don't dispatch market-only anomalies here;
  // those wouldn't have a sensible per-user audience without a market watch).
  const anomalies = db.prepare(`
    SELECT a.id, a.event_id, a.type, a.severity, a.payload, a.detected_at,
           e.slug, e.title
    FROM anomaly_alerts a
    JOIN events e ON e.id = a.event_id
    WHERE a.detected_at >= ? AND a.event_id IS NOT NULL
    ORDER BY a.detected_at ASC
  `).all(since);

  if (!anomalies.length) return { anomalies: 0, dispatched: 0, sent: 0 };

  const insertPushed = db.prepare(`
    INSERT OR IGNORE INTO pushed_anomalies (anomaly_id, user_id, pushed_at, sent, failed)
    VALUES (?, ?, ?, ?, ?)
  `);
  const alreadyPushed = db.prepare(
    "SELECT 1 FROM pushed_anomalies WHERE anomaly_id = ? AND user_id = ?"
  );

  let dispatched = 0;
  let totalSent = 0;
  let totalFailed = 0;

  for (const a of anomalies) {
    const parsedPayload = safeJsonParse(a.payload);
    const watchers = findWatchersForAnomaly(db, { ...a, payload: parsedPayload });
    if (!watchers.length) continue;

    // Skip users we already pushed this anomaly to.
    const fresh = watchers.filter(w => !alreadyPushed.get(a.id, w.user_id));
    if (!fresh.length) continue;

    const subs = listSubscriptionsForUsers(fresh.map(w => w.user_id));
    if (!subs.length) {
      // Mark as pushed so we don't retry forever for users without subs.
      const now = Date.now();
      for (const w of fresh) insertPushed.run(a.id, w.user_id, now, 0, 0);
      continue;
    }

    const payload = buildPayload({ ...a, payload: parsedPayload }, a.title, a.slug);

    // Group subscriptions by user_id so we can record pushed_anomalies per user.
    const byUser = new Map();
    for (const s of subs) {
      if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
      byUser.get(s.user_id).push(s);
    }

    for (const [userId, userSubs] of byUser.entries()) {
      try {
        const result = await sendToSubscriptions(userSubs, payload);
        insertPushed.run(a.id, userId, Date.now(), result.sent, result.failed + result.expired);
        totalSent   += result.sent;
        totalFailed += result.failed + result.expired;
        dispatched++;
      } catch (err) {
        logger.warn(`watchlistPush: anomaly ${a.id} → user ${userId} failed: ${err.message}`);
      }
    }
  }

  if (dispatched) {
    logger.info(`🔔 watchlist-push: ${anomalies.length} anomalies scanned, ${dispatched} user-fanouts, ${totalSent} sends, ${totalFailed} failures`);
  }
  return { anomalies: anomalies.length, dispatched, sent: totalSent, failed: totalFailed };
}
