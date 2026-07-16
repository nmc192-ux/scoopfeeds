/**
 * Migration 017: event_timeline dedup + UNIQUE index — Sprint 2 item 2c.
 *
 * event_timeline never had a unique constraint, so eventTimelineBuilder's
 * INSERT OR IGNORE had no conflict target and ignored nothing — every
 * hourly run re-inserted every article/market_move row for every active
 * event. On the 2026-07-16 COW: 130,555 of 185,487 rows (70%) were
 * duplicates; worst case 89 copies of one entry; the audit's "timeline
 * entries duplicated 2-8x" and inflated article-count badges trace here.
 *
 * The 011 pattern: clean once, guard forever.
 *   1. Delete all but the earliest row (MIN(id)) per (event_id, kind, ref_id).
 *   2. Partial UNIQUE index over ref_id IS NOT NULL rows — the builder's
 *      OR IGNORE becomes genuinely idempotent. Null-ref rows (e.g.
 *      market_attribution passes body-keyed dedup in bayesianUpdater) are
 *      excluded from the constraint and keep their app-level guard.
 */

export const id = "017_timeline_unique";

export function up(db) {
  db.exec(`
    DELETE FROM event_timeline
    WHERE ref_id IS NOT NULL
      AND id NOT IN (
        SELECT MIN(id) FROM event_timeline
        WHERE ref_id IS NOT NULL
        GROUP BY event_id, kind, ref_id
      );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_et_unique_ref
      ON event_timeline(event_id, kind, ref_id)
      WHERE ref_id IS NOT NULL;
  `);
}
