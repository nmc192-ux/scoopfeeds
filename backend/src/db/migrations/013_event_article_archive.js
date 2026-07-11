/**
 * Migration 013: event_article_archive — R1 of the retention & storyline architecture
 * (decided direction, 2026-07-08; see phase_b_go_live_runbook.md).
 *
 * ScoopFeeds' product promise is day-1-to-now story coverage, but articles live on a
 * 7-day TTL: when pruneOldArticles() deletes an event-linked article (and the orphan
 * sweep removes its event_articles link), the event goes hollow — its history is gone
 * for good. Research convergence (Google News / GDELT / Event Registry / TDT): nobody
 * keeps full bodies long-term; the durable record is the event + article METADATA/
 * references. This table is that durable record: before the prune deletes an
 * event-linked article, its reference metadata is snapshotted here (exactly the fields
 * named in the decided direction: title / source / url / date / category / credibility).
 *
 * Write-only for now (~250 MB/yr at current volume). R2's storyline layer is the
 * consumer — durable dossiers render from archive rows after the live articles age out.
 * PK (event_id, article_id) + INSERT OR IGNORE make the archive step idempotent.
 * SCHEMA ONLY — population happens in pruneOldArticles() (same commit).
 */

export const id = "013_event_article_archive";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_article_archive (
      event_id     TEXT NOT NULL,
      article_id   TEXT NOT NULL,
      title        TEXT NOT NULL,
      source_name  TEXT NOT NULL,
      url          TEXT NOT NULL,
      category     TEXT,
      published_at INTEGER NOT NULL,
      credibility  INTEGER,
      archived_at  INTEGER NOT NULL,
      PRIMARY KEY (event_id, article_id)
    );
    CREATE INDEX IF NOT EXISTS idx_eaa_event ON event_article_archive(event_id, published_at);
  `);
}
