/**
 * mediaSentimentScorer — derives a numeric polarity for the "media" lane of
 * an event's Reality Index.
 *
 * Pulls articles linked to the event, joins to article_analysis_cache.tone
 * (the existing Gemini-classified tone), maps categorical tone → numeric
 * polarity, and weights by recency + credibility.
 *
 * Output:
 *   { polarity: -1..+1, intensity: 0..1, volume: int, breakdown }
 *
 * Falls back to scoring article TITLES with simpleSentiment when the
 * analysis cache is empty (cold-start case).
 */

import { getDb } from "../../models/database.js";
import { upsertSentimentSnapshot } from "../dal/sentimentDao.js";
import { scoreText } from "./simpleSentiment.js";
import { logger } from "../../services/logger.js";

// Tone -> polarity. Calibrated against the existing prompt's category labels.
const TONE_POLARITY = {
  alarming:   -0.7,
  critical:   -0.3,
  neutral:     0.0,
  analytical:  0.1,
  optimistic:  0.6,
};

const TONE_INTENSITY = {
  alarming:   0.85,
  critical:   0.6,
  neutral:    0.2,
  analytical: 0.3,
  optimistic: 0.7,
};

function recencyWeight(publishedMs, nowMs) {
  // 1.0 for fresh-today, 0.5 at 3d, 0.25 at 7d, 0.1 at 14d.
  const ageDays = Math.max(0, (nowMs - publishedMs) / 86_400_000);
  return Math.exp(-ageDays / 4);
}

/** Score one event using its linked articles. */
export function scoreEventMediaSentiment(eventId) {
  const db   = getDb();
  const now  = Date.now();

  const rows = db.prepare(`
    SELECT a.id, a.title, a.published_at, a.credibility,
           c.tone, c.tone_reason
    FROM event_articles ea
    JOIN articles a              ON a.id = ea.article_id
    LEFT JOIN article_analysis_cache c ON c.article_id = a.id
    WHERE ea.event_id = ?
    ORDER BY a.published_at DESC
    LIMIT 80
  `).all(eventId);

  if (!rows.length) return { polarity: 0, intensity: 0, volume: 0, breakdown: {} };

  let weightSum = 0, polWeighted = 0, intSum = 0, withTone = 0;
  const toneCounts = {};

  for (const r of rows) {
    let polarity, intensity;
    if (r.tone && TONE_POLARITY[r.tone] != null) {
      polarity  = TONE_POLARITY[r.tone];
      intensity = TONE_INTENSITY[r.tone] ?? 0.4;
      withTone++;
      toneCounts[r.tone] = (toneCounts[r.tone] ?? 0) + 1;
    } else {
      // Fallback: lex-score the title as a weak signal.
      const s = scoreText(r.title);
      if (s.polarity === 0 && s.intensity === 0) continue;
      polarity  = s.polarity;
      intensity = Math.max(0.15, s.intensity * 0.6);  // dampen vs explicit tone
    }

    const recency  = recencyWeight(r.published_at ?? now, now);
    // credibility is on a 1-10 scale; map to a 0.6–1.0 weight multiplier.
    const credBoost = 0.6 + 0.4 * Math.min(1, Math.max(0, (r.credibility ?? 5) / 10));
    const w        = recency * credBoost;
    polWeighted   += polarity * w;
    intSum        += intensity * w;
    weightSum     += w;
  }

  if (weightSum === 0) return { polarity: 0, intensity: 0, volume: rows.length, breakdown: { tones: toneCounts, withTone } };
  const polarity  = polWeighted / weightSum;
  const intensity = Math.min(1, intSum / weightSum);
  return {
    polarity:  Number(polarity.toFixed(3)),
    intensity: Number(intensity.toFixed(3)),
    volume:    rows.length,
    breakdown: { tones: toneCounts, withTone, totalArticles: rows.length },
  };
}

/** Persists a media snapshot for the event at `ts`. */
export function recordEventMediaSnapshot(eventId, ts = Date.now()) {
  const out = scoreEventMediaSentiment(eventId);
  upsertSentimentSnapshot({
    scope:     "event",
    scope_id:  eventId,
    ts,
    source:    "media",
    polarity:  out.polarity,
    intensity: out.intensity,
    volume:    out.volume,
    raw_meta:  out.breakdown,
  });
  return out;
}

/** Run for all active events; returns count. */
export function runMediaSentimentForActiveEvents() {
  const db   = getDb();
  const ts   = Date.now();
  const ids  = db.prepare("SELECT id FROM events WHERE status='active'").all();
  let scored = 0;
  for (const { id } of ids) {
    try { recordEventMediaSnapshot(id, ts); scored++; }
    catch (err) { logger.warn(`mediaSentiment ${id}: ${err.message}`); }
  }
  if (scored) logger.info(`📰 media-sentiment recorded for ${scored} events`);
  return { scored, totalActive: ids.length };
}
