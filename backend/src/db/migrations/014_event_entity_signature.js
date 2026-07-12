/**
 * Migration 014: event_entity_signature — R2a of the retention & storyline architecture.
 *
 * An event's matching identity is its entity core (rarity-weighted keys shared by its
 * member articles) — but that core is computed live from article_entities, and articles
 * prune at 7 days. Once members age out, the event's identity evaporates: it can never
 * be compared to anything again. That killed matching for hollow events (see the
 * cluster-id squatting fix) and blocks R2b's storyline chaining (a new episode of a
 * story must be comparable to CLOSED prior episodes months later).
 *
 * This table is the durable copy: the promoter upserts an event's signature (top-K
 * entity keys + idf weights as JSON) every time it matches or creates the event, while
 * the members are still alive. Write-only until R2b consumes it for chaining.
 * SCHEMA ONLY — population happens in the promoter (same commit).
 */

export const id = "014_event_entity_signature";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_entity_signature (
      event_id   TEXT PRIMARY KEY,
      keys       TEXT NOT NULL,        -- JSON [{k, idf}] — top-K canonical entity keys with weights
      updated_at INTEGER NOT NULL
    );
  `);
}
