/**
 * baseSocialFetcher — shared scaffolding for per-event social mention fetchers.
 *
 * Each concrete fetcher exports an async `fetchMentions(query, opts)` that
 * returns an array of normalized post objects:
 *
 *   { source, text, ts, author?, url?, engagement? }
 *
 * The orchestrator (sentimentScorer.runForEvent) decides which queries to
 * issue per event (title + top actors) and aggregates mentions across sources
 * into a per-source polarity/intensity/volume snapshot.
 *
 * Fetchers must:
 *  - Time-box network calls (5–8s).
 *  - Cap result count to keep memory bounded.
 *  - NEVER throw past their own catch — return `[]` on failure.
 *  - Tag each post with the right `source` string.
 */

import { logger } from "../../../services/logger.js";

export const SOCIAL_DEFAULTS = {
  maxPerQuery: 30,
  timeoutMs:   8000,
};

/** Helper: fetch with timeout that resolves to null on failure. */
export async function safeFetchJson(url, { headers = {}, timeoutMs = SOCIAL_DEFAULTS.timeoutMs, label = "social" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      logger.warn(`[social/${label}] HTTP ${res.status} from ${url}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    if (err.name !== "AbortError") {
      logger.warn(`[social/${label}] fetch failed: ${err.message}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Normalize a post into the shape the scorer expects. */
export function normalizePost({ source, text, ts, author, url, engagement }) {
  return {
    source,
    text:       String(text ?? "").slice(0, 600),
    ts:         Number.isFinite(ts) ? ts : Date.now(),
    author:     author ? String(author).slice(0, 80) : null,
    url:        url ? String(url).slice(0, 400) : null,
    engagement: Number.isFinite(engagement) ? engagement : 0,
  };
}

/** Build a query string from event title + top actors (caller-side helper). */
export function buildQuery(event, actors = []) {
  const parts = [event.title];
  // Add up to 2 distinguishing actors as quoted disambiguators
  for (const a of actors.slice(0, 2)) {
    if (a.actor_name && a.actor_name.length > 1) parts.push(`"${a.actor_name}"`);
  }
  return parts.join(" ").slice(0, 200);
}
