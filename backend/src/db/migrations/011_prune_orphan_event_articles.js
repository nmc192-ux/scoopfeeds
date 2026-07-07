/**
 * Migration 011: one-time cleanup of orphaned event_articles.
 *
 * ROOT CAUSE (found during the Phase-4c re-validation, 2026-07-07). Articles are
 * pruned on a 7-day TTL by pruneOldArticles() (models/database.js), but
 * event_articles has NO foreign key to articles and the prune never deleted the
 * corresponding links. So every prune cycle orphaned the links of the articles it
 * removed. On the current prod graph this had accumulated to 11,299 / 12,360 links
 * dangling (91.4%) — including the over-merge blob (event 60063595…c3e0), which
 * showed 3,981 links but only 361 LIVE articles. The dangling links inflate the
 * homepage card counts and leave the "dissolved" blob still leading as a mega-card,
 * which is what blocked the naive 4c enable.
 *
 * This migration removes every event_articles row whose article no longer exists.
 * It is a pure hygiene delete (the referenced articles are already gone, so the row
 * carries no information) and is idempotent — re-running deletes nothing new.
 *
 * The recurrence is fixed in pruneOldArticles() (same commit), which now deletes
 * orphaned event_articles on every prune so the graph cannot rot this way again.
 *
 * NOTE: this only removes dangling LINKS. Events that become linkless as a result
 * are left in place (structured live-feed events — e.g. USGS/NOAA — are legitimately
 * linkless; whether to retire aged-out news events is a separate retention decision).
 */

export const id = "011_prune_orphan_event_articles";

export function up(db) {
  db.exec(`
    DELETE FROM event_articles
    WHERE article_id NOT IN (SELECT id FROM articles);
  `);
}
