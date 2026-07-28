/**
 * Migration 020: event carousel copy cache + event-keyed social posts.
 *
 * Schema-only groundwork for the 7-slide event carousel. Nothing reads or
 * writes these until later commits — this migration is inert on deploy.
 *
 * event_carousel_copy
 *   Caches the ONE LLM call that fills slides 4 (THE DETAILS), 5 (THE NUMBERS)
 *   and 6 (WHY IT MATTERS). Deliberately mirrors actor_extraction_attempts
 *   (migration 016): event-keyed, content-hashed, attempt-capped. That shape
 *   buys two properties we need:
 *     - re-rendering a card NEVER re-calls the model. The renderer reads this
 *       table and nothing else; a cache hit is the only path to slide 4-6 copy.
 *     - a failing event cannot be retried forever. attempts + last_attempt_at
 *       carry the retry cap and spacing; succeeded_at means "never re-pay".
 *   content_hash is the hash of the dossier inputs the copy was generated
 *   from. Inputs change -> hash changes -> fresh copy and a fresh attempt
 *   budget. Payload columns are nullable because a failed attempt records the
 *   attempt without any copy.
 *
 * social_posts.event_id
 *   The carousel posts an EVENT, but the whole publisher path is article-keyed
 *   (findFreshUnpostedArticles, UNIQUE(article_id, platform), getRecentIgPosts
 *   JOINs articles). Rather than fork that, the lead article stays article_id
 *   and event_id records what was actually posted.
 *
 *   The unique index is PARTIAL (WHERE event_id IS NOT NULL) — this is
 *   load-bearing. Every existing and future article-only post carries a NULL
 *   event_id, and a plain UNIQUE(event_id, platform) would collapse all of
 *   them into a single allowed row per platform, breaking all social posting.
 *
 *   Dedupe policy is strict once-per-event (DrJ-approved): an event posts once
 *   per platform, ever. No re-post-on-development machinery — with ~23
 *   qualifying events/day against a 12/day need there is no demand for it, and
 *   adding a development-hash column later is additive whereas unwinding a bad
 *   re-post rule is not.
 */

export const id = "020_event_carousel";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_carousel_copy (
      event_id        TEXT PRIMARY KEY,
      content_hash    TEXT    NOT NULL,     -- hash of the dossier inputs used
      details_json    TEXT,                 -- JSON: [string, string, string]
      figures_json    TEXT,                 -- JSON: [{value,label,source_sentence} x3]
      why_it_matters  TEXT,
      model           TEXT,                 -- provider/model that produced it
      attempts        INTEGER NOT NULL DEFAULT 0,
      last_attempt_at INTEGER NOT NULL,
      succeeded_at    INTEGER,              -- set once valid copy is stored
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );

    ALTER TABLE social_posts ADD COLUMN event_id TEXT;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_social_event_platform
      ON social_posts(event_id, platform)
      WHERE event_id IS NOT NULL;
  `);
}
