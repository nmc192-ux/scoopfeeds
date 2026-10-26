/**
 * originalsDao — read-only lists for the /originals page (#260).
 *
 * Three shelves of what ScoopFeeds itself writes and makes:
 *   analysis  — published generated_briefs
 *   explained — non-expired explained_pieces
 *   stories   — long-form films that are ALREADY PUBLIC on YouTube
 *
 * Every function selects an explicit column list. The stories query in
 * particular must never leak drafts, scheduled (publish_at in the future),
 * private or unlisted films, qc_json, or the per-channel status columns —
 * those are internal pipeline state, not reader content.
 */

import { getDb } from "../../models/database.js";

export const ORIGINALS_LIMITS = Object.freeze({ analysis: 8, explained: 6, stories: 6 });

export function listOriginalAnalysis({ limit = ORIGINALS_LIMITS.analysis, db = getDb() } = {}) {
  return db.prepare(`
    SELECT slug, title, thesis, published_at, created_at
    FROM generated_briefs
    WHERE status = 'published'
    ORDER BY COALESCE(published_at, created_at) DESC
    LIMIT ?
  `).all(limit);
}

export function listOriginalExplained({ limit = ORIGINALS_LIMITS.explained, now = Date.now(), db = getDb() } = {}) {
  return db.prepare(`
    SELECT slug, title, category, summary, image_url, updated_at
    FROM explained_pieces
    WHERE expires_at > ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(now, limit);
}

export function listOriginalStories({ limit = ORIGINALS_LIMITS.stories, now = Date.now(), db = getDb() } = {}) {
  return db.prepare(`
    SELECT slug, title, youtube_id, published_at
    FROM longform_posts
    WHERE youtube_id IS NOT NULL AND youtube_id <> ''
      AND privacy_status = 'public'
      AND published_at IS NOT NULL AND published_at <= ?
      AND (publish_at IS NULL OR publish_at <= ?)
    ORDER BY published_at DESC
    LIMIT ?
  `).all(now, now, limit);
}

export function listOriginals({ now = Date.now(), db = getDb() } = {}) {
  return {
    analysis:  listOriginalAnalysis({ db }),
    explained: listOriginalExplained({ now, db }),
    stories:   listOriginalStories({ now, db }),
  };
}
