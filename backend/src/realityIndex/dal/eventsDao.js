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
 * The bar is source diversity. Measured on prod over 7 days (DrJ, 2026-07-28):
 *   >=3 sources 251   >=5 sources 207   >=8 sources 162   >=12 sources 135
 * >=8 was chosen: ~23/day against a 12/day need is ~2x headroom, which is what
 * makes strict refusal affordable — any validation failure downstream can
 * refuse the post outright instead of padding a slide.
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
const MIN_SOURCES  = Number.parseInt(process.env.EVENT_CAROUSEL_MIN_SOURCES  || "8", 10);
const MIN_ARTICLES = Number.parseInt(process.env.EVENT_CAROUSEL_MIN_ARTICLES || "5", 10);

export function carouselBar() {
  return { minSources: MIN_SOURCES, minArticles: MIN_ARTICLES };
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

  if (!event)                                        return { ok: false, reason: "no_such_event", event: null, coverage: { articles: 0, sources: 0 } };
  const coverage = coverageForEvent(eventId);
  if (event.status !== "active")                     return { ok: false, reason: "not_active", event, coverage };
  if (!String(event.summary || "").trim())           return { ok: false, reason: "no_summary", event, coverage };
  if (coverage.articles < MIN_ARTICLES)              return { ok: false, reason: "too_few_articles", event, coverage };
  if (coverage.sources  < MIN_SOURCES)               return { ok: false, reason: "too_few_sources", event, coverage };
  return { ok: true, reason: null, event, coverage };
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
             WHERE ea.event_id = e.id) AS sources
    FROM events e
    WHERE e.status = 'active'
      AND COALESCE(TRIM(e.summary), '') <> ''
      AND e.last_activity_at >= ?
      AND (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id = e.id) >= ?
      AND (SELECT COUNT(DISTINCT a.source_name)
             FROM event_articles ea JOIN articles a ON a.id = ea.article_id
            WHERE ea.event_id = e.id) >= ?
    ORDER BY sources DESC, e.last_activity_at DESC
    LIMIT ?
  `).all(cutoff, MIN_ARTICLES, MIN_SOURCES, limit);
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
