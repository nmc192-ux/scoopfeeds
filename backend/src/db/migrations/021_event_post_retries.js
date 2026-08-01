/**
 * Migration 021: allow failed event-post attempts to accumulate.
 *
 * The retire rule for event-first IG selection is changing from "any
 * social_posts row retires the event" to "retire on a posted row, or after
 * 2+ failed attempts" (DrJ, 2026-07-31): we just had 5 days where every IG
 * post failed, and under the old rule that would have silently retired ~23
 * events/day permanently, with no signal. Deterministic failures should
 * still retire; transient outages should recover.
 *
 * That rule is UNREPRESENTABLE under migration 020's index: UNIQUE(event_id,
 * platform) WHERE event_id IS NOT NULL blocks the SECOND failed row for an
 * event, so the insert throws from inside runPlatformCycle's catch handler,
 * attempt #2 is never recorded, and the picker retries the event every cycle
 * forever at exactly 1 recorded failure — an infinite retry loop of a
 * deterministic failure, which is precisely what the rule exists to prevent.
 *
 * Fix: uniqueness applies to SUCCESSES only. One posted row per (event,
 * platform) is the real dedupe invariant; failed rows are attempt history
 * and may accumulate (each failed attempt uses a different lead article, so
 * they never collide on the (article_id, platform) upsert either).
 */

export const id = "021_event_post_retries";

export function up(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_social_event_platform;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_social_event_platform
      ON social_posts(event_id, platform)
      WHERE event_id IS NOT NULL AND status = 'posted';
  `);
}
