/**
 * sentimentScorer — fans out to enabled social sources for each active event,
 * scores returned posts with simpleSentiment, persists per-source snapshots.
 *
 * Sources are feature-flag gated:
 *   ENABLE_SOCIAL_BLUESKY   (default on)
 *   ENABLE_SOCIAL_REDDIT    (default on)
 *   ENABLE_SOCIAL_MASTODON  (default on)
 *   ENABLE_SOCIAL_HN        (default on)
 *   ENABLE_TREND_WIKIPEDIA  (default on)
 *   ENABLE_SOCIAL_X         (default OFF — feature-flagged per plan §1C)
 *   ENABLE_SOCIAL_THREADS   (default OFF)
 *
 * The cycle is bounded per run by RI_SENTIMENT_EVENTS_PER_CYCLE so a noisy
 * upstream never blocks the loop.
 */

import { getDb } from "../../models/database.js";
import { logger } from "../../services/logger.js";
import { aggregateScores } from "./simpleSentiment.js";
import { upsertSentimentSnapshot } from "../dal/sentimentDao.js";
import { buildQuery } from "../ingest/social/baseSocialFetcher.js";

import * as bluesky  from "../ingest/social/blueskyFetcher.js";
import * as reddit   from "../ingest/social/redditFetcher.js";
import * as mastodon from "../ingest/social/mastodonFetcher.js";
import * as hn       from "../ingest/social/hnFetcher.js";
import { pageviewSignal } from "../ingest/trends/wikipediaPageviewsFetcher.js";

const EVENTS_PER_CYCLE = parseInt(process.env.RI_SENTIMENT_EVENTS_PER_CYCLE || "20", 10);

const flag = (name, dflt) => {
  const v = process.env[name];
  if (v == null) return dflt;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
};

function enabledSources() {
  return {
    bluesky:   flag("ENABLE_SOCIAL_BLUESKY",  true),
    reddit:    flag("ENABLE_SOCIAL_REDDIT",   true),
    mastodon:  flag("ENABLE_SOCIAL_MASTODON", true),
    hn:        flag("ENABLE_SOCIAL_HN",       true),
    wikipedia: flag("ENABLE_TREND_WIKIPEDIA", true),
  };
}

const FETCHERS = { bluesky, reddit, mastodon, hn };

function eventActors(db, eventId) {
  return db.prepare(
    "SELECT actor_name FROM event_actors WHERE event_id = ? ORDER BY mentions DESC LIMIT 5"
  ).all(eventId);
}

async function scoreEventForSource(eventId, source, query) {
  try {
    const fetcher = FETCHERS[source];
    if (!fetcher) return null;
    const posts = await fetcher.fetchMentions(query, { limit: 30 });
    const agg   = aggregateScores(posts);
    return { ...agg, source };
  } catch (err) {
    logger.warn(`sentiment ${source} ${eventId}: ${err.message}`);
    return null;
  }
}

async function recordWikipediaSignal(eventId, query, ts) {
  const sig = await pageviewSignal(query);
  if (!sig) return null;
  // Polarity is undefined for pageviews; we record volume + intensity from
  // the recent/baseline ratio so the UI can show "attention spike".
  const intensity = Math.min(1, Math.max(0, (sig.ratio - 1) / 5));
  upsertSentimentSnapshot({
    scope:     "event",
    scope_id:  eventId,
    ts,
    source:    "wikipedia",
    polarity:  null,
    intensity,
    volume:    sig.recent ?? 0,
    raw_meta:  { title: sig.title, baseline: sig.baseline, ratio: sig.ratio },
  });
  return sig;
}

/** Score one event across all enabled sources, persist all snapshots. */
export async function scoreEvent(eventId, ts = Date.now()) {
  const db      = getDb();
  const event   = db.prepare("SELECT id, title FROM events WHERE id = ?").get(eventId);
  if (!event) return { skipped: "no_event" };

  const actors  = eventActors(db, eventId);
  const query   = buildQuery(event, actors);
  const enabled = enabledSources();

  const ranSources = [];
  // Run enabled social sources in parallel (each is bounded by its own timeout).
  const tasks = Object.entries(enabled)
    .filter(([k, on]) => on && k !== "wikipedia")
    .map(async ([source]) => {
      const out = await scoreEventForSource(eventId, source, query);
      if (out && out.volume > 0) {
        upsertSentimentSnapshot({
          scope:     "event",
          scope_id:  eventId,
          ts,
          source,
          polarity:  out.polarity,
          intensity: out.intensity,
          volume:    out.volume,
          raw_meta:  { samples: out.samples },
        });
        ranSources.push({ source, polarity: out.polarity, volume: out.volume });
      }
    });

  if (enabled.wikipedia) {
    tasks.push(recordWikipediaSignal(eventId, event.title, ts).then(sig => {
      if (sig) ranSources.push({ source: "wikipedia", volume: sig.recent });
    }));
  }

  await Promise.allSettled(tasks);
  return { eventId, query, sources: ranSources };
}

/** Score a bounded batch of active events per cycle. */
export async function runSentimentCycle({ limit = EVENTS_PER_CYCLE } = {}) {
  const db = getDb();
  const events = db.prepare(`
    SELECT id FROM events
    WHERE status='active'
    ORDER BY last_activity_at DESC
    LIMIT ?
  `).all(limit);

  if (!events.length) return { scored: 0 };
  const ts = Date.now();
  let scored = 0;
  for (const ev of events) {
    const out = await scoreEvent(ev.id, ts);
    if (out?.sources?.length) scored++;
  }
  logger.info(`💬 sentiment cycle: ${scored}/${events.length} events scored across enabled social sources`);
  return { scored, attempted: events.length };
}
