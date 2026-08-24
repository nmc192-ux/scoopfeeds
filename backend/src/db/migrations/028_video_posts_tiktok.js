/**
 * 028 — TikTok columns on video_posts.
 *
 * The fifth channel, and the same trio as 023/024/026:
 *   tiktok_post_id   the publish_id returned by /v2/post/publish/video/init/
 *   tiktok_status    NULL | 'posted' | 'failed' | 'skipped'
 *   tiktok_error     the reason, when status is failed or skipped
 *
 * WHY THIS COLUMN EXISTS AT ALL, when videoPublisher has published to TikTok for
 * months without one: that path uses the generic `recordSocialPost`, which is an
 * append-only ledger. It records what happened; it cannot answer "has this
 * article already been posted?" cheaply, and the autopost loop's re-entry
 * guards are all built on `video_posts.<channel>_status`.
 *
 * That distinction is not academic. A crashed run replaying itself and posting a
 * second copy is exactly what happened to Instagram (fix in #46), and the thing
 * that prevents it is a per-article, per-channel status the caller checks before
 * it uploads. Reusing the weaker ledger here to avoid writing a migration would
 * be choosing the shape that already failed once.
 *
 * NO 'pending' STATE. 024 introduced 'pending' for Instagram and Threads because
 * Meta FETCHES a public URL from our server asynchronously, opening a window in
 * which the 48h sweep could delete a file mid-publish. TikTok uploads the bytes
 * in-band — `uploadToTikTok` PUTs the file and then polls a publish_id — so the
 * file on disk is irrelevant the moment the upload returns. Same shape as
 * Facebook Reels and Bluesky. `hasPendingUrlFetchPublish` is therefore
 * deliberately NOT widened; its name is the contract.
 *
 * `tiktok_post_id` stores the publish_id, not the final video id. The publish_id
 * is what the status endpoint accepts and what exists from the first call; the
 * video id only appears once TikTok finishes processing, and may never appear if
 * processing fails. Storing the identifier that is always available beats storing
 * the prettier one that sometimes is not.
 *
 * NULL still means "never attempted", as 023/024/026 established: a channel that
 * was dark for a period must not have rows claiming it was skipped, or the
 * column lies about a decision nobody took.
 *
 * IDEMPOTENT BY CONSTRUCTION, following the PRAGMA idiom rather than a bare
 * ALTER — a migration that is only safe because of schema_migrations is one
 * restore-from-partial-backup away from failing.
 */

export const id = "028_video_posts_tiktok";

export function up(db) {
  const existing = new Set(db.prepare("PRAGMA table_info(video_posts)").all().map((c) => c.name));

  const columns = [
    ["tiktok_post_id", "TEXT"],   // publish_id, not the eventual video id
    ["tiktok_status",  "TEXT"],   // NULL | posted | failed | skipped
    ["tiktok_error",   "TEXT"],
  ];

  for (const [name, type] of columns) {
    if (existing.has(name)) continue;
    db.exec(`ALTER TABLE video_posts ADD COLUMN ${name} ${type}`);
  }

  // Backs the rolling-24h cap: WHERE tiktok_status = 'posted' AND published_at > ?.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_video_posts_tiktok
      ON video_posts(tiktok_status, published_at DESC);
  `);
}
