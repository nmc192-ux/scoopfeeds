/**
 * coherenceGuard — Phase 1 (DRY-RUN, PURE). Plans the split of an over-merged "blob" event by
 * re-clustering its members through the EXISTING clusterWindow path (greedy @0.78 + merge guard
 * @0.84), UNMODIFIED. Returns a PLAN object; mutates NOTHING (no inserts/updates/schema).
 *
 * The load-and-cluster operation is lifted verbatim from _overmerge_repro.mjs (Phase 0):
 * window = [min,max published_at] of the members; excludeIds = the window's other is_dup=0
 * articles → clusterWindow sees exactly the members. Introduces NO new clustering math, and is
 * NOT wired into any scheduler/promotion path in this phase.
 */
import { clusterWindow } from "../clustering/semanticClusterer.js";

// ── tunable constants ───────────────────────────────────────────────────────
export const KEEP_CORE_SHARE      = 0.60; // largest sub-cluster ≥ this share of members → keep-core; else dissolve
export const GUARD_MAX_ARTICLES   = 50;   // candidate predicate: size threshold
export const GUARD_MAX_CATEGORIES = 5;    // candidate predicate: distinct-category threshold

// Live singleton behavior (verified in code): semanticClusterArticles clusters at minSize=2, so
// a non-clustering article is never persisted as a story_cluster; eventPromoter promotes only
// clusters with article_count >= MIN_ARTICLES (5). → a singleton gets NO event; it stays a plain
// unclustered article. The plan mirrors this for ejected singletons — it invents no new behavior.
const SINGLETON_HANDLED_AS =
  "unclustered — no event (clusterWindow drops size<2; eventPromoter promotes only clusters >= MIN_ARTICLES)";

function domCategory(members) {
  const counts = {};
  for (const m of members) counts[m.category] = (counts[m.category] || 0) + 1;
  let best = null, bestN = -1;
  for (const [cat, n] of Object.entries(counts)) if (n > bestN) { bestN = n; best = cat; }
  return best;
}

/** Lifted Phase-0 op: run the members through the EXISTING clusterWindow over exactly that set. */
function clusterMembers(db, memberIds) {
  if (!memberIds.length) return null;
  const memberSet = new Set(memberIds);
  const ph = memberIds.map(() => "?").join(",");
  const span = db.prepare(`SELECT MIN(published_at) lo, MAX(published_at) hi FROM articles WHERE id IN (${ph})`).get(...memberIds);
  const windowStart = span.lo, windowEnd = span.hi + 1;
  const winIds = db.prepare("SELECT id FROM articles WHERE published_at >= ? AND published_at < ? AND is_duplicate = 0").all(windowStart, windowEnd).map(r => r.id);
  const excludeIds = new Set(winIds.filter(id => !memberSet.has(id)));
  return clusterWindow({ db, windowStart, windowEnd, excludeIds }); // UNMODIFIED clusterer
}

/**
 * planEventSplit(eventId, db, memberIdsOverride?) → PLAN (pure; no writes).
 *   - memberIdsOverride (optional) drives a synthetic member set (harness use); otherwise members
 *     come from event_articles.
 *   - largestShare = largest sub-cluster size / total members. >= KEEP_CORE_SHARE → 'keep-core'
 *     (largest keeps the original id/URL, every other sub-cluster is a new event); else 'dissolve'
 *     (retire the original id, EVERY sub-cluster incl. the largest becomes a new event).
 *   - dominantCategory is recomputed from each resulting event's OWN members (plurality), not
 *     inherited from the founding category. Recorded only — category-recompute wiring is Phase 3.
 * Describes what a split WOULD do; inserts/updates nothing.
 */
export function planEventSplit(eventId, db, memberIdsOverride = null) {
  const memberIds = memberIdsOverride
    ?? db.prepare("SELECT article_id FROM event_articles WHERE event_id = ?").all(eventId).map(r => r.article_id);
  const totalMembers = memberIds.length;

  const res = clusterMembers(db, memberIds);
  const subs = res ? res.clusters : [];              // size>=2, sorted size desc (post-guard)
  const membersFed = res ? res.stats.windowArticles : 0;
  const grouped = res ? res.stats.grouped : 0;
  const singletons = membersFed - grouped;            // fed members that didn't land in a >=2 cluster
  const largest = subs[0]?.size ?? 0;
  const largestShare = totalMembers ? largest / totalMembers : 0;
  const caseLabel = largestShare >= KEEP_CORE_SHARE ? "keep-core" : "dissolve";

  const mkEvent = (cl) => ({ memberCount: cl.size, sources: cl.sources, dominantCategory: domCategory(cl.members), sampleTitle: cl.members[0]?.title ?? null });

  let keptEventId = null, keptCore = null, newEvents;
  if (caseLabel === "keep-core") {
    keptEventId = eventId;                 // largest sub-cluster keeps the original id/URL
    keptCore = mkEvent(subs[0]);
    newEvents = subs.slice(1).map(mkEvent);   // every OTHER sub-cluster → new event
  } else {
    keptEventId = null;                    // dissolve: retire the original id
    newEvents = subs.map(mkEvent);            // EVERY sub-cluster (largest included) → new event
  }

  return {
    eventId,
    case: caseLabel,
    totalMembers,
    membersFed,
    subClusters: subs.length,
    largestSharePct: Math.round(largestShare * 1000) / 10,
    keptEventId,
    keptCore,
    newEvents,
    singletonDisposition: { count: singletons, handledAs: SINGLETON_HANDLED_AS },
  };
}

/** isGuardCandidate(eventStats) → bool. Detection predicate ONLY (not wired live this phase).
 *  eventStats: { n_articles, n_cats }. */
export function isGuardCandidate({ n_articles = 0, n_cats = 0 } = {}) {
  return n_articles > GUARD_MAX_ARTICLES || n_cats > GUARD_MAX_CATEGORIES;
}
