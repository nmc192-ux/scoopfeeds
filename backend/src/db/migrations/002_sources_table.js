/**
 * Migration 002: sources table + seed
 *
 * Sprint 4.4 (Phase A): quality scoring infrastructure foundation.
 *
 * Creates the `sources` table with:
 * - Identity: name, url (RSS only), channel_id (YouTube only), source_type
 * - Taxonomy: category, region, credibility_legacy, is_video
 * - Quality scoring (Sprint 4.4, all nullable until Sprint 4.5 backfill):
 *   quality_score, quality_score_components (JSON), source_posture,
 *   quality_score_methodology_version, quality_score_last_updated
 *
 * Schema design (Path B per DrJ Phase 26.A.2 decision):
 * - `url` is populated for RSS sources, NULL for YouTube sources
 * - `channel_id` is populated for YouTube sources, NULL for RSS sources
 * - CHECK constraint enforces exactly one identifier per source_type
 * - Partial UNIQUE indexes on `url` and `channel_id` (SQLite UNIQUE on a
 *   NULL-bearing column would allow multiple NULLs anyway, but the partial
 *   indexes make the intent explicit and provide efficient lookups)
 *
 * Seeds 154 sources from backend/src/config/sources.js (110 RSS + 44 YouTube
 * channels at the time of this migration's authoring, 2026-05-16).
 *
 * Architecture note: backend/src/config/sources.js remains the canonical
 * source-of-truth for INGESTION (scheduler.js, videoFetcher.js import from it).
 * This DB table is parallel infrastructure for SCORING. Phase B Track 2
 * (architecture) will decide whether ingestion migrates to DB-canonical.
 * Until then: sources.js for ingestion, DB table for scoring.
 *
 * Refs: Strategic Plan v6 §3 Capability 1; Decision 7 (open methodology +
 * proprietary weights); Decision 16 (source onboarding); Phase A Kickoff Brief
 * Sprint 4 Issue 4.4; finding #82 UNCLEAR-D (source posture surfacing);
 * finding #84 (Brief inaccuracies: no sources table existed; credibility_legacy
 * NOT NULL was incompatible with YouTube entries lacking credibility values).
 *
 * Honest deviations from Brief spec, documented:
 * - credibility_legacy is nullable (Brief said NOT NULL). YouTube entries in
 *   sources.js lack a credibility field; legacy scoring never applied to them.
 *   NULL accurately reflects "legacy system did not score this."
 * - Schema models URL vs channel_id separately rather than deriving YouTube
 *   URLs from channel IDs. Matches data semantics; Phase B-friendly.
 */

import { RSS_SOURCES, YOUTUBE_SOURCES } from "../../config/sources.js";

export const id = "002_sources_table";

export function up(db) {
  // Schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id                                INTEGER PRIMARY KEY AUTOINCREMENT,
      name                              TEXT NOT NULL,
      url                               TEXT,
      channel_id                        TEXT,
      source_type                       TEXT NOT NULL CHECK (source_type IN ('rss', 'youtube')),
      category                          TEXT NOT NULL,
      region                            TEXT NOT NULL,
      credibility_legacy                INTEGER,
      is_video                          INTEGER NOT NULL DEFAULT 0,

      quality_score                     INTEGER,
      quality_score_components          TEXT,
      source_posture                    TEXT,
      quality_score_methodology_version TEXT,
      quality_score_last_updated        INTEGER,

      created_at                        INTEGER NOT NULL,
      updated_at                        INTEGER NOT NULL,

      CHECK (
        (source_type = 'rss' AND url IS NOT NULL AND channel_id IS NULL) OR
        (source_type = 'youtube' AND url IS NULL AND channel_id IS NOT NULL)
      )
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sources_url_unique_idx        ON sources(url)        WHERE url        IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS sources_channel_id_unique_idx ON sources(channel_id) WHERE channel_id IS NOT NULL;
    CREATE INDEX        IF NOT EXISTS idx_sources_source_type       ON sources(source_type);
    CREATE INDEX        IF NOT EXISTS idx_sources_category          ON sources(category);
    CREATE INDEX        IF NOT EXISTS idx_sources_region            ON sources(region);
    CREATE INDEX        IF NOT EXISTS idx_sources_quality_score     ON sources(quality_score)  WHERE quality_score  IS NOT NULL;
    CREATE INDEX        IF NOT EXISTS idx_sources_posture           ON sources(source_posture);
  `);

  // Seed
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sources (
      name, url, channel_id, source_type, category, region,
      credibility_legacy, is_video, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = Date.now();

  for (const source of RSS_SOURCES) {
    insert.run(
      source.name,
      source.url,
      null,
      "rss",
      source.category,
      source.region,
      source.credibility ?? null,
      0,
      now,
      now
    );
  }

  for (const source of YOUTUBE_SOURCES) {
    insert.run(
      source.name,
      null,
      source.channelId,
      "youtube",
      source.category,
      source.region,
      null,
      1,
      now,
      now
    );
  }
}
