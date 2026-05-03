/**
 * socialCaptionEnricher — derives a short "Reality Index" callout line for
 * an article so the existing social composers can inject it into captions.
 *
 * Output is intentionally bounded:
 *   • ≤ 120 chars
 *   • Plain text, no emoji-heavy decoration (composer adds its own)
 *   • NEVER asserts certainty — always carries an attribution + hedge
 *
 * Returns `null` when the article isn't bound to any event with a recent
 * Reality Index snapshot, so callers can drop the line cleanly.
 */

import { getDb } from "../../models/database.js";

const CALLOUT_TEMPLATES = {
  // Strong divergence — the most newsworthy framing
  diverging_over: ({ pct, gap }) =>
    `📊 Markets price this at ${pct}% — well above the media tone (truth gap ${gap >= 0 ? "+" : ""}${gap}). Source: Polymarket.`,
  diverging_under: ({ pct, gap }) =>
    `📊 Markets price this at ${pct}% — below where media coverage suggests (truth gap ${gap}). Source: Polymarket.`,
  // Aligned — mention the probability cleanly without the gap framing
  aligned: ({ pct }) =>
    `📊 Markets price this at ${pct}% (market-implied probability, Polymarket).`,
  // Anomaly callouts (override the price line when present)
  odds_shift: ({ pct, deltaPp }) =>
    `📊 Market YES moved ${deltaPp >= 0 ? "+" : ""}${deltaPp}pp in the last hour — now ${pct}%. Source: Polymarket.`,
};

const MAX_LEN = 180;
const MIN_CONFIDENCE = 0.30;     // skip callouts where the composite is still uncertain
const MIN_AGE_MS  = 60 * 60 * 1000;  // ignore RI snapshots older than 1h

function clip(s) {
  if (!s) return null;
  return s.length <= MAX_LEN ? s : s.slice(0, MAX_LEN - 1) + "…";
}

/**
 * Look up the freshest Reality Index snapshot for the event(s) this article
 * is linked to and synthesise a callout line.
 *
 * articleId may be a string (matches articles.id which is TEXT).
 */
export function realityIndexCallout(articleId) {
  if (!articleId) return null;
  const db = getDb();

  // Articles can belong to multiple events; pick the most-recently-active.
  const ev = db.prepare(`
    SELECT e.id, e.slug
    FROM event_articles ea
    JOIN events e ON e.id = ea.event_id
    WHERE ea.article_id = ? AND e.status = 'active'
    ORDER BY e.last_activity_at DESC
    LIMIT 1
  `).get(String(articleId));
  if (!ev) return null;

  const ri = db.prepare(`
    SELECT * FROM reality_index_snapshots
    WHERE scope = 'event' AND scope_id = ?
    ORDER BY ts DESC LIMIT 1
  `).get(ev.id);
  if (!ri || ri.market_probability == null) return null;
  if ((Date.now() - ri.ts) > MIN_AGE_MS) return null;
  if (ri.confidence != null && ri.confidence < MIN_CONFIDENCE) return null;

  const pct = Math.round(ri.market_probability * 100);

  // Anomaly check — if a recent odds_shift fired for this event, lead with it.
  const recentShift = db.prepare(`
    SELECT payload FROM anomaly_alerts
    WHERE event_id = ? AND type = 'odds_shift' AND detected_at >= ?
    ORDER BY detected_at DESC LIMIT 1
  `).get(ev.id, Date.now() - MIN_AGE_MS);
  if (recentShift) {
    try {
      const p = JSON.parse(recentShift.payload);
      if (Number.isFinite(p?.delta_pp)) {
        return clip(CALLOUT_TEMPLATES.odds_shift({ pct, deltaPp: Number(p.delta_pp.toFixed(0)) }));
      }
    } catch { /* fall through */ }
  }

  // Truth gap framing — only when meaningful and confidence is solid.
  if (Number.isFinite(ri.truth_gap) && Math.abs(ri.truth_gap) >= 0.25) {
    const gap = Number(ri.truth_gap.toFixed(2));
    return clip(ri.truth_gap > 0
      ? CALLOUT_TEMPLATES.diverging_over({ pct, gap })
      : CALLOUT_TEMPLATES.diverging_under({ pct, gap }));
  }

  return clip(CALLOUT_TEMPLATES.aligned({ pct }));
}
