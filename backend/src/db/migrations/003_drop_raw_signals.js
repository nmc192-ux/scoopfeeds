/**
 * Migration 003: drop unused `raw_signals` table.
 *
 * Sprint 3.1 (Phase A close-out). The `raw_signals` table was created in
 * `backend/src/realityIndex/schema.js` as a "generic landing zone for
 * non-market ingester payloads" but never received any writes — ingesters
 * write directly to their own tables (events, macro_indicators, etc.).
 *
 * Phase 29.A verification (session 29) confirmed zero INSERT / SELECT /
 * UPDATE / DELETE references in all of `backend/src/`; the only references
 * were the CREATE TABLE statement and its two indexes inside `schema.js`.
 *
 * This migration drops the table + its two indexes. The companion edit to
 * `realityIndex/schema.js` removes the CREATE statements so fresh DBs no
 * longer recreate the table after this migration runs.
 *
 * `DROP TABLE IF EXISTS` is safe regardless of whether the table contains
 * rows or not — included for the unlikely case that some out-of-band ingester
 * wrote rows we did not detect. SQLite DROP TABLE is atomic and reclaims
 * storage on the next VACUUM.
 *
 * Refs: Phase A Kickoff Brief Sprint 3 Issue 3.1; Phase 29.A investigation
 * findings (raw_signals reservation pattern confirmed dead code); session 29
 * Sprint 3 batch close-out.
 */

export const id = "003_drop_raw_signals";

export function up(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_raw_unprocessed;
    DROP INDEX IF EXISTS idx_raw_external;
    DROP TABLE IF EXISTS raw_signals;
  `);
}
