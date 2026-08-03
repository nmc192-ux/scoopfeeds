/**
 * Migration 023: the Facebook cross-post's record on video_posts.
 *
 * video_posts is ONE PERMANENT ROW PER ARTICLE with UNIQUE(article_id) (022),
 * which forces attempt history into COLUMNS rather than rows. The Facebook
 * cross-post is strictly 1:1 with the video — same article, same MP4, same
 * cycle — so it belongs on that row rather than in social_posts. Keeping it
 * here also means "published to YouTube but not to Facebook" is one predicate
 * on one table rather than a join, which is the query ops will actually run.
 *
 * Columns:
 *   facebook_post_id  the Page post id Meta returns, `{page-id}_{post-id}`
 *   facebook_status   NULL | 'posted' | 'failed' | 'skipped'
 *   facebook_error    the failure message, truncated, for 'failed'
 *
 * NULLABLE, NO DEFAULT, NO BACKFILL. Every row written before this migration
 * predates the feature, and a DEFAULT 'skipped' would assert something false
 * about them — that the cross-post ran and declined. NULL means "never
 * attempted", which is exactly what is true of them and of every row written
 * while VIDEO_FACEBOOK_ENABLED is 0.
 *
 * 'skipped' is a distinct outcome from 'failed' on purpose. A day that produces
 * twelve videos and nine Facebook posts should say whether the other three hit
 * the daily cap, found the client unconfigured, or actually failed at Meta —
 * one status column answers that without reading logs.
 *
 * NO SEPARATE TIMESTAMP, and this is load-bearing: the rolling-24h Facebook cap
 * counts `facebook_status = 'posted' AND published_at > ?`, reusing the YouTube
 * publish time. That is sound ONLY because the cross-post happens in the same
 * cycle, milliseconds after markVideoPublished sets published_at. If the
 * cross-post is ever moved out of that cycle — a retry sweep, a backfill, a
 * separate queue — published_at stops standing in for "when we posted to
 * Facebook" and the cap silently counts the wrong window. Add
 * facebook_posted_at at that point; do not reinterpret this column.
 *
 * IDEMPOTENT BY CONSTRUCTION, following 010's PRAGMA idiom rather than 019's
 * bare ALTER. schema_migrations already prevents a second run, but a migration
 * that is only safe because of the ledger is one restore-from-partial-backup
 * away from failing, and this one lands on a table holding the only permanent
 * record that an article was ever published.
 */

export const id = "023_video_posts_facebook";

export function up(db) {
  const existing = new Set(db.prepare("PRAGMA table_info(video_posts)").all().map((c) => c.name));

  const columns = [
    ["facebook_post_id", "TEXT"],
    ["facebook_status", "TEXT"],   // NULL | posted | failed | skipped
    ["facebook_error", "TEXT"],
  ];

  for (const [name, type] of columns) {
    if (existing.has(name)) continue;
    db.exec(`ALTER TABLE video_posts ADD COLUMN ${name} ${type}`);
  }

  // The rolling-24h Facebook cap: WHERE facebook_status = 'posted' AND published_at > ?.
  // Mirrors idx_video_posts_status, which serves the same shape for the YouTube gate.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_video_posts_facebook
      ON video_posts(facebook_status, published_at DESC);
  `);
}
