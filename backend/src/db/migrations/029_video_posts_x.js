/**
 * 029 — X columns on video_posts.
 *
 * The sixth channel, same trio as 023/024/026/028:
 *   x_post_id   the post id from POST /2/tweets
 *   x_status    NULL | 'posted' | 'failed' | 'skipped'
 *   x_error     the reason, when status is failed or skipped
 *
 * WHY A COLUMN RATHER THAN x_post_queue. That table already exists and holds
 * 5,490 rows — but it is the MANUAL-PASTE system: text generated from articles,
 * emailed to the founder, pasted by hand. It is keyed on article and knows
 * nothing about a rendered MP4, and its statuses describe a digest workflow
 * ('sent_in_digest'), not a publish. Overloading it would conflate two
 * different questions: "has this article's text been mailed out" and "has this
 * video been posted".
 *
 * The autopost loop's re-entry guards are all `video_posts.<channel>_status`,
 * and the reason is Instagram: a crashed run replayed itself and published a
 * second copy (#46). Per-article, per-channel status checked before upload is
 * what prevents that.
 *
 * NO 'pending' STATE. X takes the bytes in-band — INIT/APPEND/FINALIZE then a
 * processing poll — so the file on disk is irrelevant once uploadVideo returns.
 * Same as Facebook Reels, Bluesky and TikTok. `hasPendingUrlFetchPublish` stays
 * untouched; its name is the contract.
 *
 * NULL means "never attempted". A channel that was dark must not have rows
 * claiming it was skipped, or the column lies about a decision nobody took.
 *
 * IDEMPOTENT BY CONSTRUCTION via PRAGMA rather than a bare ALTER.
 */

export const id = "029_video_posts_x";

export function up(db) {
  const existing = new Set(db.prepare("PRAGMA table_info(video_posts)").all().map((c) => c.name));

  const columns = [
    ["x_post_id", "TEXT"],
    ["x_status",  "TEXT"],
    ["x_error",   "TEXT"],
  ];

  for (const [name, type] of columns) {
    if (existing.has(name)) continue;
    db.exec(`ALTER TABLE video_posts ADD COLUMN ${name} ${type}`);
  }

  // Backs the rolling-24h cap: WHERE x_status = 'posted' AND published_at > ?.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_video_posts_x
      ON video_posts(x_status, published_at DESC);
  `);
}
