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
import { logger } from "../../services/logger.js";

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

// Every exit is reason-tagged. Without the tags the function had ONE
// observable behaviour — it returned null — so "the callout never fires
// because nothing has a parent event" and "the callout never fires because a
// guard eats it" were indistinguishable in production.
//
// These five are at DEBUG (winston default level is info, so they are silent
// unless LOG_LEVEL=debug): they are the ordinary reasons a callout does not
// apply, and at ~12 posts/day they would be noise. `market_not_live` is
// deliberately louder — see its call site.
function drop(subject, reason) {
  logger.debug(`📊 RI callout skipped for ${subject}: ${reason}`);
  return null;
}

// Market liveness, as ONE count-based statement.
//
// The subquery is eventMarketProbability's contributor query verbatim
// (realityIndex.js) — same join, same filters, same `ORDER BY eml.rank
// LIMIT 5` — so `total` is exactly the set the printed probability was
// averaged from, not a differently-scoped second question.
//
// COUNT vs SUM rather than a filtered SELECT checked for rows: a MIXED
// contributor set is the case that must fail, and "I got rows back" cannot
// detect it. It also handles a NULL end_date by construction — the CASE
// yields 0, dragging `live` below `total` — with no special case.
//
// The predicate is end_date-only for a measured reason: `active` and
// `resolved` are 1 and 0 for 100% of rows in the prod snapshot
// (deactivateMarket() has zero callers; the fetcher never re-reads a closed
// market), so a guard written on those two columns would be a literal no-op.
//
// NAMED parameters, not positional. The outer :now appears in the SQL text
// BEFORE the subquery's :eventId, which is the reverse of the natural reading
// order — bound positionally and swapped, `total` returns 0 for every event
// and the telemetry logs 0/0, indistinguishable from "no linked markets".
// Silent, permanent, and it would survive review because the SQL reads fine.
const MARKET_LIVENESS_SQL = `
  SELECT COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN resolved = 0
                            AND end_date IS NOT NULL
                            AND end_date > :now
                           THEN 1 ELSE 0 END), 0) AS live
  FROM (
    SELECT pm.resolved, pm.end_date
    FROM event_market_links eml
    JOIN prediction_markets pm ON pm.id = eml.market_id
    WHERE eml.event_id = :eventId AND pm.yes_price IS NOT NULL AND pm.active = 1
    ORDER BY eml.rank LIMIT 5
  )
`;

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
  if (!ev) return drop(articleId, "no_event");

  const ri = db.prepare(`
    SELECT * FROM reality_index_snapshots
    WHERE scope = 'event' AND scope_id = ?
    ORDER BY ts DESC LIMIT 1
  `).get(ev.id);
  // Split deliberately: "no snapshot at all" and "a snapshot with no market"
  // are different diagnoses, and one tag for both makes them indistinguishable.
  if (!ri) return drop(ev.slug, "no_snapshot");
  if (ri.market_probability == null) return drop(ev.slug, "no_probability");
  if ((Date.now() - ri.ts) > MIN_AGE_MS) return drop(ev.slug, "stale_snapshot");
  if (ri.confidence != null && ri.confidence < MIN_CONFIDENCE) return drop(ev.slug, "low_confidence");

  // Market liveness — LAST of the gates, so `market_not_live` means precisely
  // "this callout would have rendered and the market set stopped it", never
  // co-firing with low_confidence or stale_snapshot. And BEFORE `pct` and the
  // odds_shift branch below, which has its own early return and also prints a
  // probability — a guard placed after it would leave the anomaly template,
  // the one most likely to fire on a fast-moving question, unguarded.
  const liveness = db.prepare(MARKET_LIVENESS_SQL).get({ now: Date.now(), eventId: ev.id });
  const total = liveness?.total ?? 0;
  const live  = liveness?.live ?? 0;
  if (!(total > 0 && live === total)) {
    // INFO, not debug: the block is already rare, and a guard that silently
    // takes it to zero must be visible rather than inferred. The denominator
    // is what distinguishes "no linked markets" (0/0) from "the guard ate it".
    logger.info(`📊 RI callout dropped for ${ev.slug}: market_not_live (${live}/${total} contributing markets still open)`);
    return null;
  }

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
