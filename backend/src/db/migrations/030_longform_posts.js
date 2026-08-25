/**
 * 030 — longform_posts: one row per long-form film (#80).
 *
 * Deliberately a SEPARATE table from video_posts, not more columns on it.
 * video_posts is keyed `UNIQUE(article_id)` — one row per article, one
 * rendered 60-100s clip. A film is keyed on an EVENT and bundles a 7-10
 * minute upload plus five Shorts plus cross-posts. Overloading video_posts
 * would conflate "has this article been made into a clip" with "has this
 * story been made into a film", and every existing re-entry guard in the
 * shorts loop reads `video_posts.<channel>_status` expecting the former.
 *
 * THE SHAPE FOLLOWS video_posts' HARD-WON RULES:
 *
 *   UNIQUE(event_id) — the re-entry guard. A crashed run replaying itself and
 *   publishing a second copy is exactly how Instagram got a duplicate (#46);
 *   for a film, a second copy is a subscriber notification that cannot be
 *   recalled.
 *
 *   NO FOREIGN KEY, deliberately. video_posts has none for the same reason: a
 *   `REFERENCES` clause invites a future `ON DELETE`, and these rows are
 *   PERMANENT — they are the cooldown record. `event_articles` already has no
 *   cascade and the 7-day prune sweeps orphans itself; a film's record must
 *   outlive both.
 *
 *   DENORMALISED title/slug/topic. Events can be merged, split or absorbed by
 *   the promoter, and articles are pruned at 7 days. A cooldown that depended
 *   on joining back to a live event row would silently stop working after a
 *   merge — the row must answer "have we filmed this" on its own.
 *
 * Per-channel status columns mirror 023/024/026/028/029 so the same
 * check-before-upload guard works, and a partial publish is recoverable
 * channel by channel rather than all-or-nothing.
 */

export const id = "030_longform_posts";

export function up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS longform_posts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id        TEXT NOT NULL,
        slug            TEXT NOT NULL,
        title           TEXT,
        topic_phrase    TEXT,
        demand_breadth  INTEGER,

        status          TEXT NOT NULL DEFAULT 'pending',
        attempts        INTEGER NOT NULL DEFAULT 0,
        stage           TEXT,
        error           TEXT,

        youtube_id      TEXT,
        privacy_status  TEXT,
        publish_at      INTEGER,
        captions_status TEXT,
        thumbnail_status TEXT,

        shorts_json     TEXT,
        facebook_status TEXT,
        facebook_error  TEXT,
        instagram_status TEXT,
        instagram_error TEXT,

        qc_json         TEXT,
        render_secs     INTEGER,

        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        published_at    INTEGER
      );
    `);
    // UNIQUE as an index rather than a column constraint, so it can be
    // rebuilt without recreating the table if the key ever needs widening.
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_longform_posts_event
             ON longform_posts(event_id);`);
    // The rate gate reads a rolling window by published_at, and the health
    // surface reads recent rows by created_at.
    db.exec(`CREATE INDEX IF NOT EXISTS idx_longform_posts_published
             ON longform_posts(published_at DESC);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_longform_posts_status
             ON longform_posts(status, created_at DESC);`);
}
