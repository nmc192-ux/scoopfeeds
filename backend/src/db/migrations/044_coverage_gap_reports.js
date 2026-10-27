/**
 * 044 — coverage_gap_reports (#262, Coverage Gaps weekly Gap Report).
 *
 * One row per week (week_start = the Monday, YYYY-MM-DD, UTC). The weekly job
 * inserts a row once and never rewrites it, so a published week keeps its numbers.
 * body_json holds the top gaps; method_json the thresholds, the region bases and
 * the share of outlets with no known region.
 *
 * Additive: a new table and an index. Nothing existing is read or changed.
 * Idempotent.
 */

export const id = "044_coverage_gap_reports";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coverage_gap_reports (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start    TEXT NOT NULL UNIQUE,
      generated_at  INTEGER NOT NULL,
      body_json     TEXT NOT NULL,
      method_json   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coverage_gap_reports_generated ON coverage_gap_reports(generated_at DESC);
  `);
}
