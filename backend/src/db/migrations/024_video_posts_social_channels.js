/**
 * 024 — Instagram and Threads columns on video_posts.
 *
 * Mirrors 023's Facebook trio exactly, once per channel:
 *   {channel}_post_id  the id the platform returns
 *   {channel}_status   NULL | 'pending' | 'posted' | 'failed' | 'skipped'
 *   {channel}_error    the reason, when status is failed or skipped
 *
 * WHY 'pending' EXISTS HERE AND NOT ON FACEBOOK. Facebook Reels uploads raw
 * bytes: the call either returns a Reel or throws, and the MP4 on disk is
 * irrelevant the moment it returns. Instagram and Threads are different in kind
 * — Meta FETCHES a public URL from our own server, asynchronously, after the
 * container is created. Between "container created" and "published" there is a
 * window in which deleting the file breaks a publish that has already been
 * accepted.
 *
 * The 48h MP4 sweep runs at WORKER STARTUP, not on a clock, so a deploy at the
 * wrong moment triggers it regardless of how much of the window has elapsed.
 * 'pending' is what lets sweepVideos see a publish in flight and leave the file
 * alone — see VIDEO_PENDING_FETCH_HOLD_MS in videoArtifacts.
 *
 * NULL still means "never attempted", exactly as 023 established: a channel
 * that was dark for a period must not have rows claiming it was skipped, or the
 * column lies about a decision nobody took.
 *
 * IDEMPOTENT BY CONSTRUCTION, following 010/023's PRAGMA idiom rather than a
 * bare ALTER. schema_migrations already prevents a second run, but a migration
 * that is only safe because of the ledger is one restore-from-partial-backup
 * away from failing — and this lands on the table holding the only permanent
 * record that an article was ever published.
 */

export const id = "024_video_posts_social_channels";

export function up(db) {
  const existing = new Set(db.prepare("PRAGMA table_info(video_posts)").all().map((c) => c.name));

  const columns = [
    ["instagram_post_id", "TEXT"],
    ["instagram_status",  "TEXT"],   // NULL | pending | posted | failed | skipped
    ["instagram_error",   "TEXT"],
    ["threads_post_id",   "TEXT"],
    ["threads_status",    "TEXT"],
    ["threads_error",     "TEXT"],
  ];

  for (const [name, type] of columns) {
    if (existing.has(name)) continue;
    db.exec(`ALTER TABLE video_posts ADD COLUMN ${name} ${type}`);
  }

  // Per-channel rolling-24h caps: WHERE {channel}_status = 'posted' AND published_at > ?.
  // Same shape as idx_video_posts_facebook and idx_video_posts_status.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_video_posts_instagram
      ON video_posts(instagram_status, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_video_posts_threads
      ON video_posts(threads_status, published_at DESC);
  `);
}
