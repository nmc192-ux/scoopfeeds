/**
 * Migration 018: event_facets + event_facet_articles — A5 Phase 1 (persistence).
 *
 * The eventBreaker re-clusters each event's member articles into sub-clusters every
 * sweep (the anchor + foreign/kept sub-threads) but throws that topology away — it
 * survives only as ephemeral 🧭 breaker-keep/split log lines. A5 persists it as
 * durable "facets" so a later render layer can surface the sub-threads inside a
 * macro-event (Phase 2, dark behind ?facets=1, its own ship gate).
 *
 * Identity is a STABLE hash of the facet's hub-filtered entity-key set (facet_key),
 * NOT the churning positional sub-index — so the same sub-thread maps to the same row
 * across sweeps and ACCUMULATES (members union, last_seen_at refresh) from day one.
 *
 * Population is behind EVENT_FACETS_PERSIST (default OFF) in the breaker; with the flag
 * off the breaker is byte-identical. SCHEMA ONLY — no render surface reads this yet.
 */

export const id = "018_event_facets";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_facets (
      facet_id     TEXT PRIMARY KEY,        -- deterministic: sha1(event_id | facet_key)
      event_id     TEXT NOT NULL,
      facet_key    TEXT NOT NULL,           -- STABLE identity = hash of hub-filtered core keys
      is_anchor    INTEGER NOT NULL DEFAULT 0,
      size         INTEGER NOT NULL,        -- member article count (latest sweep)
      sources      INTEGER NOT NULL,        -- distinct source_name count (latest sweep)
      ent          REAL,                    -- containment vs anchor core (anchor = 1.0)
      band         TEXT,                    -- AFFINE | AMBIGUOUS | FOREIGN vs anchor
      core_keys    TEXT NOT NULL,           -- JSON array of the facet's entity keys
      label        TEXT,                    -- derived display title (representative member)
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      UNIQUE(event_id, facet_key)
    );
    CREATE INDEX IF NOT EXISTS idx_event_facets_event ON event_facets(event_id, size DESC);

    CREATE TABLE IF NOT EXISTS event_facet_articles (
      facet_id   TEXT NOT NULL,
      article_id TEXT NOT NULL,
      added_at   INTEGER NOT NULL,
      PRIMARY KEY (facet_id, article_id)
    );
    CREATE INDEX IF NOT EXISTS idx_event_facet_articles_facet ON event_facet_articles(facet_id);
  `);
}
