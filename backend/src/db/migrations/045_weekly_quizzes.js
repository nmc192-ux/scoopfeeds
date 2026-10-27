/**
 * 045 — weekly_quizzes (#271, "Did you scoop it?" weekly quiz on Originals).
 *
 * One row per week (week_start = the Monday, YYYY-MM-DD, UTC). The weekly job
 * writes a row once ('published' or 'refused') and never rewrites it.
 * refusal_reason is internal and is never served by the API.
 *
 * Additive: a new table and an index. Nothing existing is read or changed.
 * Idempotent.
 */

export const id = "045_weekly_quizzes";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_quizzes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start      TEXT NOT NULL UNIQUE,
      generated_at    INTEGER NOT NULL,
      status          TEXT NOT NULL,
      body_json       TEXT,
      model           TEXT,
      refusal_reason  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_weekly_quizzes_status_week ON weekly_quizzes(status, week_start DESC);
  `);
}
