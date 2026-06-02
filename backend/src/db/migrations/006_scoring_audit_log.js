/**
 * Migration 006: scoring_audit_log.
 *
 * Track 2 Sprint B.6.0 — the audit-trail table for the Source Scoring Service
 * (docs/specs/source_scoring_service.md §6.4). One row per (source, scoring
 * run): the five component sub-scores, posture label, combined score, and
 * per-sub-criterion reasoning/confidence captured at scoring time, plus the
 * founder-override fields (methodology §6.5).
 *
 * Mirrors the §6.4 suggested schema. Per the house pattern (Migration 005),
 * SQL enforces only the envelope (FK integrity; override_present is 0/1);
 * richer shape rules — e.g. override_rationale being required when
 * override_present = 1 — are DAO-enforced rather than SQL CHECK, consistent
 * with the trackers DAO-validation precedent (locked decision 1, Migration 005).
 *
 * source_id → sources(id) (INTEGER AUTOINCREMENT PK, Migration 002); CASCADE
 * on delete so a removed source takes its audit history with it.
 *
 * Retention: unbounded for now; the spec (§6.4) flags retention policy as
 * later implementation work — not decided here.
 */

export const id = "006_scoring_audit_log";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scoring_audit_log (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id                   INTEGER NOT NULL,
      scoring_run_id              TEXT NOT NULL,
      methodology_version         TEXT NOT NULL,
      component_scores            TEXT,
      posture_label               TEXT,
      combined_score              INTEGER,
      reasoning_per_subcriterion  TEXT,
      confidence_per_subcriterion TEXT,
      override_present            INTEGER NOT NULL DEFAULT 0 CHECK (override_present IN (0, 1)),
      override_rationale          TEXT,
      created_at                  INTEGER NOT NULL,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scoring_audit_source  ON scoring_audit_log(source_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scoring_audit_run     ON scoring_audit_log(scoring_run_id);
    CREATE INDEX IF NOT EXISTS idx_scoring_audit_created ON scoring_audit_log(created_at DESC);
  `);
}
