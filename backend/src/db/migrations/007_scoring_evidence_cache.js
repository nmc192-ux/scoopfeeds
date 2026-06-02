/**
 * Migration 007: scoring_evidence_cache.
 *
 * Track 2 Sprint B.6.2a — durable per-sub-criterion evidence store for the
 * Source Scoring Service's evidence-gathering layer.
 *
 * Distinct from scoring_audit_log (Migration 006): the audit log records a
 * SCORING RUN's outputs (component scores, posture, combined score, reasoning);
 * this cache records GATHERED FACTS per sub-criterion so the weekly scoring run
 * re-fetches only stale evidence (per-sub-criterion TTL) rather than re-scraping
 * every source every week. One current row per (source, sub_criterion) — upsert
 * on re-gather (UNIQUE constraint below; the DAO uses ON CONFLICT).
 *
 * B.6.2 is EVIDENCE-ONLY: this table holds evidence; it does NOT hold or imply
 * a sources.quality_score (which stays NULL until B.6.3 completes all
 * components). status carries the gathering outcome:
 *   evidenced   — a real, trustworthy value was computed from available data
 *   pending     — a value was computed but is inconclusive from this source and
 *                 needs deterministic corroboration (e.g. 2.1.c low/absent RSS
 *                 byline → unknown, not negative; awaits B.6.2b page cross-check)
 *   pending-llm — deterministic part done; the judgment part awaits B.6.3
 *   unavailable — data we'd need isn't present (e.g. no ingested articles)
 *   blocked     — an external fetch was refused/timed out (B.6.2b+ only)
 *
 * source_id → sources(id) (INTEGER AUTOINCREMENT PK, Migration 002), CASCADE.
 */

export const id = "007_scoring_evidence_cache";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scoring_evidence_cache (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id           INTEGER NOT NULL,
      sub_criterion       TEXT NOT NULL,
      status              TEXT NOT NULL CHECK (status IN ('evidenced', 'pending', 'pending-llm', 'unavailable', 'blocked')),
      value               TEXT,
      confidence          REAL,
      evidence_url        TEXT,
      gathered_at         INTEGER NOT NULL,
      methodology_version TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
      UNIQUE (source_id, sub_criterion)
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_source        ON scoring_evidence_cache(source_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_subcriterion  ON scoring_evidence_cache(sub_criterion);
    CREATE INDEX IF NOT EXISTS idx_evidence_gathered      ON scoring_evidence_cache(gathered_at);
  `);
}
