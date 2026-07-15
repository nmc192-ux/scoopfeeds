/**
 * Migration 016: LLM cost rails — 2026-07-15 cost incident (gate a).
 *
 * Two small operational tables, neither touching the event graph:
 *
 * 1. llm_daily_calls — the persistent counter behind llmQueue's global
 *    daily generation-call cap (LLM_DAILY_CALL_CAP). The $25.77/day burn
 *    was only discovered at credit exhaustion because nothing counted
 *    calls; this table makes the ceiling survive restarts and gives ops
 *    a per-task view of today's consumption.
 *
 * 2. actor_extraction_attempts — the actor extractor's negative-cache /
 *    attempts ledger. Pre-incident, an event whose LLM response never
 *    parsed was re-paid EVERY hour forever (event_actors stayed at 0 rows
 *    while $23 of output tokens burned). One row per event: attempt count
 *    (retry cap enforced in code), last attempt time (spacing), and the
 *    content hash of the articles last sent (unchanged articles are never
 *    re-paid, even on success).
 */

export const id = "016_llm_cost_rails";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_daily_calls (
      day   TEXT    NOT NULL,   -- UTC YYYY-MM-DD
      task  TEXT    NOT NULL,   -- e.g. 'actors', 'analysis-brief', 'live-events'
      calls INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, task)
    );

    CREATE TABLE IF NOT EXISTS actor_extraction_attempts (
      event_id          TEXT    PRIMARY KEY,
      attempts          INTEGER NOT NULL DEFAULT 0,
      last_attempt_at   INTEGER NOT NULL,
      last_content_hash TEXT,
      succeeded_at      INTEGER
    );
  `);
}
