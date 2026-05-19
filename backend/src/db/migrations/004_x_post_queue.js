/**
 * Migration 004: x_post_queue table.
 *
 * Phase B Sprint 2.x.1. Foundation for the X-Posting Queue per Sprint 2.x
 * plan (Phase B retrospective inputs) and DrJ Path α decision (Session 3):
 * generate X-ready posts from published articles, deliver to founder via
 * daily email digest, founder manually pastes to @scoop_feeds. Completely
 * free — no X API costs.
 *
 * Schema:
 *
 * - article_id      — FK to articles. CASCADE on parent delete means queue
 *                     entries get pruned automatically when articles age out
 *                     of the TTL window (per database.js:911 DELETE FROM
 *                     articles WHERE fetched_at < ?). Sprint 2.x.2 digest
 *                     delivery must fire frequently enough that queue
 *                     entries don't expire before reaching the founder.
 * - post_text       — the X-ready post content (≤ 280 chars per X limit).
 *                     Single-post entries store the full caption from
 *                     socialComposer.composeX. Thread entries store one
 *                     chunk per row.
 * - post_type       — 'single' or 'thread'.
 * - thread_group_id — UUID grouping all parts of one thread together. NULL
 *                     for single posts.
 * - thread_position — 1-indexed position within thread (1, 2, 3, ...). NULL
 *                     for single posts. Pairs with thread_total to render
 *                     "1/3", "2/3", "3/3" markers.
 * - thread_total    — total part count for this thread. NULL for single.
 * - status          — 'pending'        : generated, not yet in digest
 *                     'sent_in_digest' : included in a digest delivery
 *                     'marked_posted'  : founder confirmed post landed on X
 *                     'rejected'       : founder flagged content as bad
 * - generated_at    — when the post-generation cycle queued this entry
 * - sent_in_digest_at — set by digest cycle (Sprint 2.x.2)
 * - marked_posted_at  — set by mark-as-posted endpoint (Sprint 2.x.3)
 *
 * Indexes:
 * - idx_x_post_queue_article  : article_id lookup (dedup check during generation)
 * - idx_x_post_queue_status   : status + generated_at filter (digest pull)
 * - idx_x_post_queue_thread   : thread_group_id partial index (thread reassembly)
 * - idx_x_post_queue_pending  : partial index on status='pending' (most common
 *                               query — what's awaiting delivery)
 *
 * Refs: Phase B Sprint 2.x plan (retrospective inputs Session 3); DrJ Path α
 * decision; existing socialComposer.composeX reused for single-post generation;
 * Phase B-S36.A.1 investigation findings.
 */

export const id = "004_x_post_queue";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS x_post_queue (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id          TEXT NOT NULL,
      post_text           TEXT NOT NULL,
      post_type           TEXT NOT NULL CHECK (post_type IN ('single', 'thread')),
      thread_group_id     TEXT,
      thread_position     INTEGER,
      thread_total        INTEGER,
      status              TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'sent_in_digest', 'marked_posted', 'rejected')),
      generated_at        INTEGER NOT NULL,
      sent_in_digest_at   INTEGER,
      marked_posted_at    INTEGER,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
      CHECK (
        (post_type = 'single' AND thread_group_id IS NULL  AND thread_position IS NULL  AND thread_total IS NULL) OR
        (post_type = 'thread' AND thread_group_id IS NOT NULL AND thread_position IS NOT NULL AND thread_total IS NOT NULL AND thread_position >= 1 AND thread_position <= thread_total)
      )
    );

    CREATE INDEX IF NOT EXISTS idx_x_post_queue_article    ON x_post_queue(article_id);
    CREATE INDEX IF NOT EXISTS idx_x_post_queue_status     ON x_post_queue(status, generated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_x_post_queue_thread_grp ON x_post_queue(thread_group_id) WHERE thread_group_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_x_post_queue_pending    ON x_post_queue(generated_at DESC) WHERE status = 'pending';
  `);
}
