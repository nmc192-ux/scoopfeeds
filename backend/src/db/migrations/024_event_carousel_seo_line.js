/**
 * Migration 024: event_carousel_copy.seo_line.
 *
 * NUMBERING. This was approved as "migration 021", but 021, 022 and 023 are
 * already taken (021_event_post_retries, 022_video_posts,
 * 023_video_posts_facebook). 024 is the next free slot. Migrations are a
 * hand-maintained array in db/migrate.js and are keyed by `id`, so the number
 * is an ordering label, not an identifier — but two files claiming 021 would
 * make the ordering ambiguous to a reader, which is the whole value of the
 * number.
 *
 * The column holds the keyword-first caption line for the IG carousel: 3-10
 * words, plain language, naming the actors and the topic — what a person would
 * type into a search box. It is generated as a FOURTH FIELD on the existing
 * slides-4/5/6 copy call, not a second LLM call, so it costs nothing extra and
 * is cached on the same row under the same content_hash.
 *
 * NULLABLE, and deliberately so. seo_line is a SOFT field: unlike details /
 * figures / why_it_matters, a seo_line that fails validation does not refuse
 * the copy. The caller falls back to a deterministic title-derived line, so a
 * post is never blocked by it. A NULL here means "generated before this column
 * existed", which the COPY_RULES_VER v3 -> v4 bump makes unreachable for new
 * rows — every cached event re-generates, because the version is hashed into
 * content_hash. Without that bump this column would stay NULL forever on every
 * event already in the cache.
 *
 * ADDITIVE and reversible in the only sense that matters: nothing reads this
 * column unless IG_CAPTION_V2 is set, so applying the migration changes no
 * behaviour on its own.
 */

export const id = "024_event_carousel_seo_line";

export function up(db) {
  db.exec(`
    ALTER TABLE event_carousel_copy ADD COLUMN seo_line TEXT;
  `);
}
