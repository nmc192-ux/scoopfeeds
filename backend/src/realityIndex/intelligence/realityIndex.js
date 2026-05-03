/**
 * realityIndex — composes the 4-component composite per active event:
 *
 *   market_probability  ∈ [0, 1]    (weighted top-market YES across event_market_links)
 *   media_sentiment     ∈ [-1, +1]  (latest 'media' sentiment_snapshot)
 *   social_sentiment    ∈ [-1, +1]  (avg of latest 'bluesky'/'reddit'/'mastodon'/'hn')
 *   economic_signal     ∈ [-1, +1]  (placeholder; populated in Phase 5)
 *
 * Derived:
 *   truth_gap     = market_norm - media_norm    (signed; ∈ [-1, +1])
 *   reality_score = weighted average mapped to [0, 1]
 *   confidence    = function of present components + per-component confidence
 *
 * Branding: "Reality Index" is a *data-backed estimate*, not a prediction
 * guarantee. The UI surfaces market_probability with a "Source: Polymarket"
 * line and the disclaimer in copyGuide.js.
 */

import { getDb } from "../../models/database.js";
import { latestSnapshotsByScope } from "../dal/sentimentDao.js";
import { upsertRealityIndexSnapshot } from "../dal/realityIndexDao.js";
import { scoreMarketConfidence } from "./confidenceScorer.js";
import { logger } from "../../services/logger.js";

const W_MARKET   = parseFloat(process.env.RI_W_MARKET   || "0.5");
const W_MEDIA    = parseFloat(process.env.RI_W_MEDIA    || "0.2");
const W_SOCIAL   = parseFloat(process.env.RI_W_SOCIAL   || "0.2");
const W_ECONOMIC = parseFloat(process.env.RI_W_ECONOMIC || "0.1");

const SOCIAL_SOURCES = new Set(["bluesky", "reddit", "mastodon", "hn"]);

// ─── Per-component readers ─────────────────────────────────────────────────

function eventMarketProbability(db, eventId) {
  const rows = db.prepare(`
    SELECT pm.yes_price, pm.volume_24h, pm.liquidity, pm.spread,
           eml.weight, eml.rank
    FROM event_market_links eml
    JOIN prediction_markets pm ON pm.id = eml.market_id
    WHERE eml.event_id = ? AND pm.yes_price IS NOT NULL AND pm.active = 1
    ORDER BY eml.rank
    LIMIT 5
  `).all(eventId);
  if (!rows.length) return { value: null, confidence: 0, marketCount: 0 };

  // Weight by edge_link.weight × per-market confidence
  let wSum = 0, valWeighted = 0, confSum = 0;
  for (const m of rows) {
    const conf = scoreMarketConfidence(m).score;
    const w    = (m.weight ?? 0.5) * Math.max(0.1, conf);
    wSum       += w;
    valWeighted += m.yes_price * w;
    confSum    += conf;
  }
  return {
    value:       Number((valWeighted / wSum).toFixed(4)),
    confidence:  Number((confSum / rows.length).toFixed(3)),
    marketCount: rows.length,
  };
}

function pickSentimentByLane(latest) {
  const out = { media: null, social: null };
  const socialBuckets = [];
  for (const s of latest) {
    if (s.source === "media" && Number.isFinite(s.polarity)) {
      out.media = { polarity: s.polarity, intensity: s.intensity, volume: s.volume };
    } else if (SOCIAL_SOURCES.has(s.source) && Number.isFinite(s.polarity)) {
      socialBuckets.push({ polarity: s.polarity, intensity: s.intensity, volume: s.volume, source: s.source });
    }
  }
  if (socialBuckets.length) {
    // Weight each social source by intensity * log(1 + volume) so high-quality
    // signal beats raw post counts.
    let wSum = 0, polSum = 0, intSum = 0, volSum = 0;
    for (const b of socialBuckets) {
      const w = (b.intensity ?? 0.3) * (1 + Math.log1p(b.volume ?? 0));
      polSum += b.polarity * w;
      intSum += (b.intensity ?? 0) * w;
      volSum += b.volume ?? 0;
      wSum   += w;
    }
    out.social = wSum > 0 ? {
      polarity:  Number((polSum / wSum).toFixed(3)),
      intensity: Number((intSum / wSum).toFixed(3)),
      volume:    volSum,
      sources:   socialBuckets.map(b => b.source),
    } : null;
  }
  return out;
}

// ─── Composer ──────────────────────────────────────────────────────────────

function normalize(p) {
  // Polarity[-1..+1] → [0..1]. Used for the truth_gap computation.
  return (Number(p) + 1) / 2;
}

export function composeForEvent(eventId) {
  const db    = getDb();
  const ts    = Date.now();
  const ev    = db.prepare("SELECT id, status FROM events WHERE id = ?").get(eventId);
  if (!ev) return null;

  const market   = eventMarketProbability(db, eventId);
  const senti    = latestSnapshotsByScope("event", eventId);
  const lanes    = pickSentimentByLane(senti);
  const econ     = null;  // Phase 5

  // Build present-components list. Each contributes to weight + confidence.
  const present = [];
  if (market.value != null) present.push({ name: "market", value: market.value,         conf: market.confidence,  w: W_MARKET });
  if (lanes.media)          present.push({ name: "media",  value: normalize(lanes.media.polarity), conf: Math.min(1, lanes.media.intensity * 1.4), w: W_MEDIA });
  if (lanes.social)         present.push({ name: "social", value: normalize(lanes.social.polarity), conf: Math.min(1, lanes.social.intensity * 1.2), w: W_SOCIAL });
  if (econ != null)         present.push({ name: "econ",   value: normalize(econ),       conf: 0.5,                w: W_ECONOMIC });

  let reality_score = null, confidence = 0;
  if (present.length) {
    const wSum = present.reduce((s, c) => s + c.w, 0);
    reality_score = Number((present.reduce((s, c) => s + c.value * c.w, 0) / wSum).toFixed(4));
    // Confidence: weighted geometric mean of per-component confidences,
    // dampened by the *coverage* (how many of the 4 components were present).
    const logConf = present.reduce((s, c) => s + c.w * Math.log(Math.max(0.05, c.conf)), 0) / wSum;
    const coverage = present.length / 4;
    confidence = Number((Math.exp(logConf) * (0.5 + 0.5 * coverage)).toFixed(3));
  }

  // Truth gap: market vs media (normalized to [0..1] to match dimensions).
  // Positive = market more confident than media tone.
  let truth_gap = null;
  if (market.value != null && lanes.media) {
    truth_gap = Number((market.value - normalize(lanes.media.polarity)).toFixed(3));
  }

  const components = {
    market: market.value != null ? { value: market.value, confidence: market.confidence, count: market.marketCount } : null,
    media:  lanes.media,
    social: lanes.social,
    econ:   null,
    weights: { market: W_MARKET, media: W_MEDIA, social: W_SOCIAL, econ: W_ECONOMIC },
  };

  upsertRealityIndexSnapshot({
    scope:              "event",
    scope_id:           eventId,
    ts,
    market_probability: market.value,
    media_sentiment:    lanes.media?.polarity ?? null,
    social_sentiment:   lanes.social?.polarity ?? null,
    economic_signal:    econ,
    truth_gap,
    reality_score,
    confidence,
    components,
  });

  return { eventId, ts, reality_score, truth_gap, confidence, components };
}

/** Compose RI for all active events; returns { written, skipped }. */
export function runRealityIndexCycle() {
  const db = getDb();
  const events = db.prepare("SELECT id FROM events WHERE status='active'").all();
  let written = 0, skipped = 0;
  for (const e of events) {
    try {
      const out = composeForEvent(e.id);
      if (out?.reality_score != null) written++;
      else skipped++;
    } catch (err) {
      logger.warn(`realityIndex compose ${e.id}: ${err.message}`);
      skipped++;
    }
  }
  if (written) logger.info(`📊 reality-index recomposed for ${written}/${events.length} events`);
  return { written, skipped, totalActive: events.length };
}
