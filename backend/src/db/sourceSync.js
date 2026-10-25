/**
 * sourceSync.js — keep the `sources` scoring table in step with config/sources.js (#251).
 *
 * Migration 002 seeded `sources` from config/sources.js once, on its first run. Entries added
 * to that file afterwards (the #175 and #194 batches, and every later source step) never got a
 * row, so they could not be scored, and "above the quality floor" could not be checked.
 *
 * This runs from bootstrapSchema() after the migrations, so every role that applies migrations
 * and every makeTestDb() gets it. It is INSERT OR IGNORE only, keyed on the partial unique
 * indexes on `url` (RSS) and `channel_id` (YouTube) from migration 002:
 *   - a missing entry gets a row;
 *   - an existing row is never touched (no UPDATE, no DELETE: stop-list item 1).
 * A feed whose URL was later changed in config/sources.js therefore gets a NEW row; the old
 * row stays. Cleaning those up is a data rewrite and is out of scope here.
 */

import { RSS_SOURCES, YOUTUBE_SOURCES } from "../config/sources.js";

/**
 * syncSourcesFromConfig(db, { rss?, youtube?, now? }) → { inserted }
 * `rss` / `youtube` default to the config lists; tests inject their own.
 */
export function syncSourcesFromConfig(db, { rss = RSS_SOURCES, youtube = YOUTUBE_SOURCES, now = Date.now() } = {}) {
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sources'").get();
  if (!hasTable) return { inserted: 0 };
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sources (
      name, url, channel_id, source_type, category, region,
      credibility_legacy, is_video, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  const run = db.transaction(() => {
    for (const s of rss) {
      if (!s?.url) continue;
      inserted += insert.run(s.name, s.url, null, "rss", s.category, s.region, s.credibility ?? null, 0, now, now).changes;
    }
    for (const s of youtube) {
      if (!s?.channelId) continue;
      inserted += insert.run(s.name, null, s.channelId, "youtube", s.category, s.region, null, 1, now, now).changes;
    }
  });
  run();
  return { inserted };
}
