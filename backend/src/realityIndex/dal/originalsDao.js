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

export const QUIZ_MAX_AGE_DAYS = 14;

/**
 * The latest PUBLISHED weekly quiz (#271) from the last QUIZ_MAX_AGE_DAYS days,
 * or null. Never reads refused rows or refusal_reason; event ids stay internal.
 */
export function latestWeeklyQuiz({ now = Date.now(), db = getDb() } = {}) {
  const since = new Date(now - QUIZ_MAX_AGE_DAYS * 86400e3).toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT week_start, body_json
    FROM weekly_quizzes
    WHERE status = 'published' AND week_start >= ?
    ORDER BY week_start DESC
    LIMIT 1
  `).get(since);
  if (!row) return null;
  let body;
  try { body = JSON.parse(row.body_json || "{}"); } catch { return null; }
  const questions = (Array.isArray(body.questions) ? body.questions : []).map((x) => ({
    q: x.q, choices: x.choices, answer: x.answer,
    event: { slug: x.event?.slug, title: x.event?.title },
  }));
  if (!questions.length) return null;
  return { week_start: row.week_start, questions, disclosure: body.disclosure };
}

export const NUMBERS_LIMIT = 7;

function numberRow(r) {
  let sources = [];
  try { sources = JSON.parse(r.sources_json || "[]"); } catch { sources = []; }
  return {
    day: r.day, number_text: r.number_text, fact_text: r.fact_text,
    sources: (Array.isArray(sources) ? sources : []).map((x) => ({ source_name: x?.source_name ?? null, url: x?.url ?? null })),
    event: { slug: r.slug, title: r.title },
  };
}

/**
 * "By the numbers" (#272): the latest NUMBERS_LIMIT daily_numbers rows, newest
 * first, with the event's slug/title joined at read time. A row whose event no
 * longer exists is dropped. Event ids stay internal.
 */
export function listDailyNumbers({ limit = NUMBERS_LIMIT, db = getDb() } = {}) {
  return db.prepare(`
    SELECT n.day, n.number_text, n.fact_text, n.sources_json, e.slug, e.title
    FROM daily_numbers n
    JOIN events e ON e.id = n.event_id
    WHERE e.slug IS NOT NULL AND e.slug <> ''
    ORDER BY n.day DESC
    LIMIT ?
  `).all(limit).map(numberRow);
}

/** Today's (UTC) number, or null. */
export function dailyNumberFor(day, { db = getDb() } = {}) {
  const r = db.prepare(`
    SELECT n.day, n.number_text, n.fact_text, n.sources_json, e.slug, e.title
    FROM daily_numbers n
    JOIN events e ON e.id = n.event_id
    WHERE n.day = ? AND e.slug IS NOT NULL AND e.slug <> ''
  `).get(day);
  return r ? numberRow(r) : null;
}

export function listOriginals({ now = Date.now(), db = getDb() } = {}) {
  const quiz = latestWeeklyQuiz({ now, db });
  return {
    analysis:  listOriginalAnalysis({ db }),
    explained: listOriginalExplained({ now, db }),
    stories:   listOriginalStories({ now, db }),
    quiz:      quiz ? { week_start: quiz.week_start, count: quiz.questions.length } : null,
    numbers:   listDailyNumbers({ db }),
  };
}
