/**
 * eventsDao — event reads for the 7-slide event carousel.
 *
 * Two jobs, both read-only:
 *
 *   1. REVERSE RESOLUTION (article -> parent event). event_articles has had
 *      idx_ea_article since the schema was written, but every existing query
 *      goes the forward way (event -> its articles). The publisher needs the
 *      reverse: given the article the IG picker chose, is there a parent event
 *      worth posting as a dossier? Returning null is the COMMON case and must
 *      stay cheap — most IG-eligible articles have no parent event, and the
 *      publisher falls back to the 3-slide article carousel.
 *
 *   2. QUALIFICATION. Which events can actually fill all seven slides.
 *
 * The bar has a VOLUME floor and a COHERENCE gate, and they are separate ideas.
 *
 * VOLUME. Measured on prod over 7 days (DrJ, 2026-07-28):
 *   >=3 sources 251   >=5 sources 207   >=8 sources 162   >=12 sources 135
 * >=8 was chosen: ~23/day against a 12/day need is ~2x headroom, which is what
 * makes strict refusal affordable — any validation failure downstream can
 * refuse the post outright instead of padding a slide.
 *
 * COHERENCE. Source count ALONE is not just insufficient, it is perverse:
 * over-merging is precisely what accumulates sources, so ranking or selecting
 * by sources actively seeks out the worst-merged buckets. Measured on the top
 * 20 by source count (DrJ, 2026-07-28): 17 had n_keys = 1, one had 0, and only
 * TWO were real events (24 keys / 142.3 idf and 19 / 133.5). The worst example
 * was titled "OpenAI's predictable hack and an AI stock sell-off" under the
 * slug the-case-for-physical-ai-safety-3, spanning the Hugging Face hack, Meta
 * earnings, MCP, skilled trades, Google search, Moonshot, AI drones and China —
 * a topic bucket, not an event.
 *
 * These survive eventBreaker (confirmed EVENT_BREAKER_ENABLED=true) exactly as
 * its design implies: it only spins off a sub-cluster storyAffinity calls
 * FOREIGN relative to the largest sub-cluster's core, and when every thread
 * shares the same degenerate core, nothing is foreign and the event is left
 * whole.
 *
 * The signal is bimodal — either 1 key at 2.4-4.4 idf, or 19-24 keys at
 * 133-142 idf, with nothing in between — so the threshold is not a calibration
 * problem: anything from 5 to 130 separates them. n_keys >= 2 is used because
 * it is the same test storyAffinity.isIncoherent() applies.
 * Yield: of 168 qualifying at >=8 sources, 96 pass n_keys >= 2 (~14/day, still
 * clear of the 12/day target).
 *
 * ORDERING. Recency, not sources and not coherence:
 *   - sources DESC selects for over-merged buckets (above).
 *   - idf DESC selects for OBSCURE ones. High idf means DISTINCTIVE entities,
 *     so the top 3 by idf were an analyst note on Citizens Financial Group, a
 *     "Forget Nvidia, these 5 stocks" listicle, and a TSMC stock piece.
 * Coherence gates; recency ranks.
 *
 * (Titles are not identifying either: "Houthis in Yemen Edge Closer to
 * Entering U.S." appears eight times across eight slugs. Anything keyed on
 * title equality would be wrong.)
 *
 * The >=5 articles clause is kept deliberately even though prod shows it is
 * NOT binding (>=3 sources and ">=3 sources AND >=5 articles" both returned
 * 251). It costs nothing and documents the intent if source-dedup behaviour
 * ever changes such that few articles can span many sources.
 *
 * Slides 4-6 need LLM copy, which is NOT part of qualification: an event
 * qualifies on dossier shape alone, and copy generation happens afterwards for
 * the one event about to be posted. Qualification is cheap and frequent;
 * generation is paid and rare.
 */

import { getDb } from "../../models/database.js";

// Env-tunable so the bar can be moved without a deploy, but defaulted to the
// backtested values rather than to something permissive.
const MIN_SOURCES   = Number.parseInt(process.env.EVENT_CAROUSEL_MIN_SOURCES   || "8", 10);
const MIN_ARTICLES  = Number.parseInt(process.env.EVENT_CAROUSEL_MIN_ARTICLES  || "5", 10);
// Coherence gate. Mirrors AFFINITY_MIN_CORE_KEYS (also 2) — the same quantity
// storyAffinity.isIncoherent() tests — but read from event_entity_signature so
// it costs one JSON count in SQL and does NOT depend on article_entities, which
// prunes at 7 days.
const MIN_CORE_KEYS = Number.parseInt(process.env.EVENT_CAROUSEL_MIN_CORE_KEYS || "2", 10);

export function carouselBar() {
  return { minSources: MIN_SOURCES, minArticles: MIN_ARTICLES, minCoreKeys: MIN_CORE_KEYS };
}

/**
 * Entity-core coherence for an event, from the durable signature the promoter
 * upserts on every match/create. nKeys is the gate; idfMass is diagnostic only
 * (see listQualifyingEvents for why it must NOT rank).
 */
export function coherenceForEvent(eventId) {
  const row = getDb().prepare(`
    SELECT (SELECT COUNT(*) FROM json_each(COALESCE(s.keys, '[]'))) AS n_keys,
           (SELECT COALESCE(SUM(json_extract(value, '$.idf')), 0)
              FROM json_each(COALESCE(s.keys, '[]'))) AS idf_mass
    FROM event_entity_signature s WHERE s.event_id = ?
  `).get(eventId);
  return { nKeys: row?.n_keys || 0, idfMass: row?.idf_mass || 0 };
}

/**
 * The parent event for an article, or null.
 *
 * An article can belong to several events, so the pick is explicit: highest
 * relevance, then most recently active. Callers should log which event they
 * resolved — a wrong parent produces a plausible-looking but wrong carousel,
 * which is the failure mode hardest to spot after the fact.
 */
export function resolveEventForArticle(articleId) {
  if (!articleId) return null;
  return getDb().prepare(`
    SELECT e.id, e.slug, e.title, e.summary, e.category, e.status, e.last_activity_at,
           ea.relevance
    FROM event_articles ea
    JOIN events e ON e.id = ea.event_id
    WHERE ea.article_id = ?
    ORDER BY ea.relevance DESC, e.last_activity_at DESC
    LIMIT 1
  `).get(articleId) || null;
}

/** Slide 3's numbers: linked article count and distinct source count. */
export function coverageForEvent(eventId) {
  if (!eventId) return { articles: 0, sources: 0 };
  const row = getDb().prepare(`
    SELECT COUNT(*) AS articles, COUNT(DISTINCT a.source_name) AS sources
    FROM event_articles ea
    JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ?
  `).get(eventId);
  return { articles: row?.articles || 0, sources: row?.sources || 0 };
}

/**
 * Does this event clear the bar? Returns { ok, reason, coverage, event } so a
 * caller can log WHY an event was skipped rather than just that it was.
 */
export function qualifiesForCarousel(eventId) {
  const event = getDb().prepare(
    `SELECT id, slug, title, summary, category, status, last_activity_at FROM events WHERE id = ?`
  ).get(eventId);

  if (!event)                              return { ok: false, reason: "no_such_event", event: null, coverage: { articles: 0, sources: 0 }, coherence: { nKeys: 0, idfMass: 0 } };
  const coverage  = coverageForEvent(eventId);
  const coherence = coherenceForEvent(eventId);
  if (event.status !== "active")           return { ok: false, reason: "not_active", event, coverage, coherence };
  if (!String(event.summary || "").trim()) return { ok: false, reason: "no_summary", event, coverage, coherence };
  if (coverage.articles < MIN_ARTICLES)    return { ok: false, reason: "too_few_articles", event, coverage, coherence };
  if (coverage.sources  < MIN_SOURCES)     return { ok: false, reason: "too_few_sources", event, coverage, coherence };
  // Coherence LAST so the reason distinguishes "too small" from "big but
  // incoherent" — the latter is the over-merged bucket and is the interesting
  // rejection to see in the logs.
  if (coherence.nKeys   < MIN_CORE_KEYS)   return { ok: false, reason: "incoherent_core", event, coverage, coherence };
  return { ok: true, reason: null, event, coverage, coherence };
}

/**
 * Every event clearing the bar with activity inside `withinMs`.
 *
 * Deliberately mirrors the shape of the ad-hoc backtest query run against prod
 * so the two are comparable: same predicates, same last_activity_at window.
 * If this stops reproducing the backtest count, the bar has drifted and that
 * is a bug, not a tuning opportunity.
 */
export function listQualifyingEvents({ withinMs = 7 * 24 * 60 * 60 * 1000, limit = 500 } = {}) {
  const cutoff = Date.now() - withinMs;
  return getDb().prepare(`
    SELECT e.id, e.slug, e.title, e.summary, e.category, e.last_activity_at,
           (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id = e.id) AS articles,
           (SELECT COUNT(DISTINCT a.source_name)
              FROM event_articles ea JOIN articles a ON a.id = ea.article_id
             WHERE ea.event_id = e.id) AS sources,
           (SELECT COUNT(*) FROM json_each(COALESCE(s.keys, '[]'))) AS n_keys,
           (SELECT COALESCE(SUM(json_extract(value, '$.idf')), 0)
              FROM json_each(COALESCE(s.keys, '[]'))) AS idf_mass
    FROM events e
    LEFT JOIN event_entity_signature s ON s.event_id = e.id
    WHERE e.status = 'active'
      AND COALESCE(TRIM(e.summary), '') <> ''
      AND e.last_activity_at >= ?
      AND (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id = e.id) >= ?
      AND (SELECT COUNT(DISTINCT a.source_name)
             FROM event_articles ea JOIN articles a ON a.id = ea.article_id
            WHERE ea.event_id = e.id) >= ?
      AND (SELECT COUNT(*) FROM json_each(COALESCE(s.keys, '[]'))) >= ?
    ORDER BY e.last_activity_at DESC
    LIMIT ?
  `).all(cutoff, MIN_ARTICLES, MIN_SOURCES, MIN_CORE_KEYS, limit);
}

/** Per-day qualifying counts — the backtest, callable in-process. */
export function qualifyingCountsByDay({ withinMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
  const rows = listQualifyingEvents({ withinMs, limit: 100000 });
  const byDay = new Map();
  for (const r of rows) {
    const d = new Date(r.last_activity_at).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + 1);
  }
  return { total: rows.length, byDay: [...byDay.entries()].sort().map(([day, n]) => ({ day, n })) };
}
