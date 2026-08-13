/**
 * 025 — drop source_health rows for sources that no longer exist.
 *
 * The 2026-05-15 source audit removed nine dead feeds from `sources.js`:
 * `feeds.reuters.com` was decommissioned (NXDOMAIN) and `apnews.com/apf-*`
 * returns an HTML hub page with no RSS replacement. The CONFIG entries went; the
 * `source_health` rows did not, so the table has carried eight rows frozen at
 * ~450 consecutive failures and zero successes ever since, for feeds nothing has
 * fetched in three months.
 *
 * WHY THIS IS WORTH A MIGRATION. `source_health` is the table you read to answer
 * "what is broken?", and it was answering with sources that are not configured.
 * Measured on a snapshot: 41 rows had `last_success IS NULL`, of which 8 were
 * this debris — a fifth of the apparent breakage was bookkeeping. A health table
 * that reads worse than the config is a tax on every future triage.
 *
 * NAMED EXPLICITLY, NOT DERIVED FROM sources.js. A migration is a historical
 * record and must do the same thing forever; importing runtime config would make
 * this delete a different set on every future boot as the source list evolves,
 * and eventually delete a live source's history because someone renamed a feed.
 * The eight names are frozen here.
 *
 * GUARDED ON `last_success IS NULL`. If any of these ever did succeed — a feed
 * revived, a name reused for a working source — the row holds real history and
 * is left alone. The delete only removes rows that have never once recorded a
 * success, which is exactly the debris it is aimed at.
 *
 * This touches TELEMETRY ONLY. No article, video or event row references
 * source_health; nothing downstream reads it except the ops surface.
 */

export const id = "025_prune_stale_source_health";

// Removed from sources.js on 2026-05-15 (Phase A source audit, Phase 2).
const REMOVED_2026_05_15 = [
  "Reuters",
  "Reuters Politics",
  "Reuters World",
  "Reuters Sports",
  "Reuters Health",
  "Reuters Business",
  "Associated Press",
  "WHO Headlines",
];

export function up(db) {
  // The table is created by initializeSchema, which bootstrapSchema guarantees
  // has run first — but a migration that assumes a table it did not create is
  // one restore-from-partial-backup away from failing, so check.
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_health'")
    .get();
  if (!exists) return;

  const stmt = db.prepare(
    "DELETE FROM source_health WHERE source_name = ? AND last_success IS NULL"
  );
  for (const name of REMOVED_2026_05_15) stmt.run(name);
}
