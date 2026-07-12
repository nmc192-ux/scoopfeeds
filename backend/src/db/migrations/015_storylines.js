/**
 * Migration 015: storylines + storyline_events — R2b of the retention & storyline
 * architecture (decided direction; Decision-32-adjacent sequencing).
 *
 * Long stories are HIERARCHIES: bounded episode-events (R2a closes them after 21d
 * of inactivity) chained into a durable storyline — the multi-year dossier object.
 * When the promoter creates a NEW event whose entity signature strongly overlaps a
 * recent prior event's durable signature (event_entity_signature, R2a), the new
 * event is appended to that prior event's storyline — created on first recurrence.
 *
 * Examples of the intended shape: a years-long conflict = one storyline of many
 * closed episode-events; a tournament = one storyline of match/round episodes.
 *
 * Data-only in R2b (population in the promoter behind STORYLINE_ENABLED, default
 * OFF). Read surfaces (dossier "story so far", storyline pages) come after the
 * chaining quality is proven live. SCHEMA ONLY.
 */

export const id = "015_storylines";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS storylines (
      id         TEXT PRIMARY KEY,
      slug       TEXT UNIQUE NOT NULL,
      title      TEXT NOT NULL,           -- working title = head episode's title (editable later)
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS storyline_events (
      storyline_id TEXT NOT NULL,
      event_id     TEXT NOT NULL,
      position     INTEGER NOT NULL,      -- episode order within the storyline
      added_at     INTEGER NOT NULL,
      PRIMARY KEY (storyline_id, event_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_storyline_events_event ON storyline_events(event_id);
    CREATE INDEX IF NOT EXISTS idx_storyline_events_line ON storyline_events(storyline_id, position);
  `);
}
