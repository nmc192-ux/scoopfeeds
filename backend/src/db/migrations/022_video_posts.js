/**
 * Migration 022: video_posts — the autopost loop's dedupe key and lasting record.
 *
 * ONE ROW PER ARTICLE, permanently. UNIQUE(article_id) is the dedupe invariant
 * §6.1 asks for, which forces attempt history into COLUMNS rather than rows —
 * social_posts accumulates a row per failed attempt, but that shape is closed
 * to us here, so `attempts` and `status` carry what extra rows would have.
 *
 * ROWS ARE PERMANENT (DrJ, 2026-08-02). No FK, no cascade, and no sweeper —
 * deliberately unlike every other artifact class in this pipeline:
 *   - articles prune at 7 days (pruneOldArticles)
 *   - MP4s sweep at 48h (videoArtifacts.sweepVideos)
 *   - TTS clips sweep at 7 days (videoVoice.sweepTtsCache)
 * but the youtube_id is the only lasting record that a given article was
 * published, and a dedupe key that can be swept is a dedupe key that lets the
 * same story go out twice three weeks later. The row outliving its article is
 * the intended behaviour, not an oversight — which is why there is no FK: a
 * REFERENCES clause would invite a future cascade and quietly re-arm the bug.
 *
 * THE STALE-PENDING RULE, mirroring 021/5fd41c8's "retire on success or two
 * failures". Insert-pending plus UNIQUE(article_id) would otherwise retire an
 * article permanently the first time an upload failed — the same class of
 * silent mass-retirement that cost ~23 events/day for five days on the IG
 * path. So:
 *   - status 'pending' with no youtube_id, older than the hang threshold,
 *     counts as a FAILED attempt (the process died mid-upload)
 *   - an article stays selectable until it is published, or has failed twice
 * One failure is a transient outage; two is the article.
 */

export const id = "022_video_posts";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_posts (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      -- The dedupe key. No FK by design: articles prune at 7 days and these
      -- rows must outlive them.
      article_id     TEXT NOT NULL UNIQUE,
      -- Event linkage at selection time, for the 48h event cooldown. Nullable:
      -- most articles carry no event, and the title-similarity fallback covers
      -- those.
      event_id       TEXT,
      -- Denormalised so the per-publisher 24h gate and the cooldown survive
      -- the article being pruned out from under them.
      source_name    TEXT,
      title          TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',  -- pending|published|failed
      attempts       INTEGER NOT NULL DEFAULT 0,
      youtube_id     TEXT,
      privacy_status TEXT,                              -- public|private|unlisted
      -- §5c hero imagery: which tier produced the image, and what it was. Both
      -- nullable until that path exists; logging the tier is what makes a
      -- spike in typographic fallbacks visible.
      image_tier     TEXT,                              -- stock|generated|typographic
      image_ref      TEXT,
      -- All three Test & Compare variants, so a comparison run is a UI action
      -- rather than a re-render (§5b).
      title_variants TEXT,                              -- JSON array
      error          TEXT,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL,
      published_at   INTEGER
    );

    -- The rolling-24h count gate and the per-publisher gate both scan by time.
    CREATE INDEX IF NOT EXISTS idx_video_posts_published ON video_posts(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_video_posts_source    ON video_posts(source_name, published_at DESC);
    -- The 48h event cooldown.
    CREATE INDEX IF NOT EXISTS idx_video_posts_event     ON video_posts(event_id, published_at DESC);
    -- Selection's NOT EXISTS, and the stale-pending scan.
    CREATE INDEX IF NOT EXISTS idx_video_posts_status    ON video_posts(status, updated_at DESC);
  `);
}
