/**
 * Migration 008: article_entities + surface_qid_cache + article_entity_processed.
 *
 * Entity-matching build, STEP 1 (extraction at ingest). Persists canonicalized
 * (Wikidata QID) entities per article so the matcher (STEP 3) can use rarity-weighted
 * shared-entity overlap — the signal validated to separate same-story from
 * distinct-story where cosine and title overlapped. This migration is SCHEMA ONLY;
 * population happens in the enrich batch behind ENTITY_EXTRACTION_ENABLED (default OFF),
 * and nothing reads these tables yet.
 *
 *  - article_entities: one row per (article, distinct entity). qid NULL = unresolved
 *    mention kept by surface form (surfaces still carry matching value; the probe
 *    separated on surfaces alone). Dedup per article on the canonical key
 *    COALESCE(qid, surface_norm) via an expression UNIQUE index.
 *  - surface_qid_cache: surface_norm → QID, POSITIVE and NEGATIVE (qid NULL) cached,
 *    so an unresolvable surface isn't re-queried against Wikidata.
 *  - article_entity_processed: idempotency marker so re-runs don't re-extract/dup.
 */

export const id = "008_article_entities";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS article_entities (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id    TEXT NOT NULL,
      surface       TEXT NOT NULL,           -- as detected (display)
      surface_norm  TEXT NOT NULL,           -- lowercased, accent-folded, punctuation-stripped
      qid           TEXT,                    -- Wikidata QID; NULL = unresolved (kept by surface)
      entity_type   TEXT,                    -- person | org | place | unknown
      label         TEXT,                    -- Wikidata label when resolved
      created_at    INTEGER NOT NULL
    );
    -- dedup per article on the canonical key: QID if resolved, else the normalized surface.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_article_entities_canon
      ON article_entities(article_id, COALESCE(qid, surface_norm));
    CREATE INDEX IF NOT EXISTS idx_article_entities_article ON article_entities(article_id);
    CREATE INDEX IF NOT EXISTS idx_article_entities_qid     ON article_entities(qid);
    CREATE INDEX IF NOT EXISTS idx_article_entities_norm    ON article_entities(surface_norm);

    CREATE TABLE IF NOT EXISTS surface_qid_cache (
      surface_norm  TEXT PRIMARY KEY,
      qid           TEXT,                    -- NULL = negative cache (unresolvable)
      label         TEXT,
      resolved_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS article_entity_processed (
      article_id    TEXT PRIMARY KEY,
      processed_at  INTEGER NOT NULL,
      entity_count  INTEGER NOT NULL DEFAULT 0
    );
  `);
}
