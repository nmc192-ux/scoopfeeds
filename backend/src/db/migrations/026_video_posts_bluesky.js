/**
 * 026 — Bluesky columns on video_posts.
 *
 * The fourth channel, and the same trio as 023/024, once more:
 *   bluesky_post_id  the AT-URI of the record (at://did/app.bsky.feed.post/<rkey>)
 *   bluesky_status   NULL | 'posted' | 'failed' | 'skipped'
 *   bluesky_error    the reason, when status is failed or skipped
 *
 * NO 'pending' STATE HERE, AND THAT IS THE POINT. 024 introduced 'pending' for
 * Instagram and Threads because Meta FETCHES a public URL from our own server
 * asynchronously, opening a window in which deleting the MP4 breaks a publish
 * that has already been accepted. Bluesky does not work that way: the bytes are
 * uploaded to the video service in-band, and once `uploadVideo` returns, the
 * file on disk is irrelevant — the same shape as Facebook Reels.
 *
 * So `hasPendingUrlFetchPublish` is deliberately NOT widened to include this
 * column. Adding bluesky to that query would pin every MP4 for the full
 * post-retention hold in exchange for protecting a window that does not exist.
 * The name of that function is the contract: URL-FETCH publishes only.
 *
 * `bluesky_post_id` stores the AT-URI rather than the rkey. The rkey alone is
 * not addressable without the handle, and the handle can change (this account
 * has already moved between nmc192.bsky.social and a custom domain — see
 * blueskyClient's session note). The AT-URI carries the DID, which cannot.
 *
 * NULL still means "never attempted", exactly as 023 and 024 established: a
 * channel that was dark for a period must not have rows claiming it was skipped,
 * or the column lies about a decision nobody took.
 *
 * IDEMPOTENT BY CONSTRUCTION, following 010/023/024's PRAGMA idiom rather than a
 * bare ALTER — a migration that is only safe because of schema_migrations is one
 * restore-from-partial-backup away from failing.
 */

export const id = "026_video_posts_bluesky";

export function up(db) {
  const existing = new Set(db.prepare("PRAGMA table_info(video_posts)").all().map((c) => c.name));

  const columns = [
    ["bluesky_post_id", "TEXT"],   // at:// URI, not the bare rkey
    ["bluesky_status",  "TEXT"],   // NULL | posted | failed | skipped
    ["bluesky_error",   "TEXT"],
  ];

  for (const [name, type] of columns) {
    if (existing.has(name)) continue;
    db.exec(`ALTER TABLE video_posts ADD COLUMN ${name} ${type}`);
  }

  // Backs the rolling-24h cap: WHERE bluesky_status = 'posted' AND published_at > ?.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_video_posts_bluesky
      ON video_posts(bluesky_status, published_at DESC);
  `);
}
