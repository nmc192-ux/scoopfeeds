/**
 * 043 — event_what_we_know (#250, "What we know" block on dossiers).
 *
 * One row per event: the latest generation attempt and, when it passed
 * validation, the stored block. The row is also the cost ledger (content hash
 * of the article ids sent, attempts, last attempt), the same rails as
 * actor_extraction_attempts (016).
 *
 * Additive: a new table and an index. Nothing existing is read, changed or
 * removed. Idempotent.
 */

export const id = "043_event_what_we_know";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_what_we_know (
      event_id         TEXT PRIMARY KEY,
      content_hash     TEXT,
      body_json        TEXT,
      model            TEXT,
      generated_at     INTEGER,
      attempts         INTEGER NOT NULL DEFAULT 0,
      last_attempt_at  INTEGER,
      status           TEXT NOT NULL,
      refusal_reason   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_event_what_we_know_status ON event_what_we_know(status);
  `);
}
