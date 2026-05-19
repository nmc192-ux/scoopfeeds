// X-Posting Queue post generator.
//
// Phase B Sprint 2.x.1. Generates X-ready posts from published articles and
// queues them into the x_post_queue table for later delivery via daily email
// digest (Sprint 2.x.2) so the founder can manually paste to @scoop_feeds.
// Architecture commitment per DrJ Path α: completely free; no X API costs.
//
// Single-post path REUSES socialComposer.composeX (already implemented;
// returns { caption, url, characterCount }). Thread path is net-new in this
// module — for articles with sufficiently long descriptions, generate a
// 2-4 tweet sequence at sentence boundaries, each part ≤ 280 chars with
// " (N/M)" suffix.
//
// Threshold for thread vs single: description.length > 250.
// Length-only — credibility filter already applied upstream in candidate
// selection (findArticlesPendingXQueue uses minCredibility ≥ 7).
//
// Maximum thread depth: 4 parts. News-thread fatigue is real; 4 is the
// honest cap before threads start to feel like spam.

import crypto from "crypto";
import { composeAllPlatforms } from "./socialComposer.js";
import {
  findArticlesPendingXQueue,
  enqueueXPosts,
} from "../models/database.js";
import { logger } from "./logger.js";

// Tunables — kept as module-level constants for legibility + easy adjustment.
const SITE = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");
const THREAD_LENGTH_THRESHOLD = 250;    // description chars above which we thread
const THREAD_MAX_PARTS        = 4;      // hard cap on thread depth
const CHUNK_MAX_CHARS         = 274;    // 280 - len(" (X/Y)") suffix buffer
const TWEET_HARD_CAP          = 280;

// Picks sentence-boundary split points greedily from start of text.
// Returns array of chunks, each ≤ maxChars, preferring "." / "!" / "?" boundaries.
// Falls back to word boundaries when sentence-fit doesn't work.
function chunkAtBoundaries(text, maxChars, maxChunks) {
  if (!text) return [];
  const out = [];
  let remaining = text.trim();
  while (remaining.length > 0 && out.length < maxChunks) {
    if (remaining.length <= maxChars) {
      out.push(remaining);
      break;
    }
    // Search backwards from maxChars for sentence boundary
    let cut = -1;
    const window = remaining.slice(0, maxChars + 1);
    // Prefer ". " > "! " > "? " — order tries strongest stop first
    for (const sep of [". ", "! ", "? "]) {
      const idx = window.lastIndexOf(sep);
      if (idx > 0) {
        cut = Math.max(cut, idx + sep.length);
      }
    }
    // Fallback to last word boundary
    if (cut <= 0) {
      const spaceIdx = window.lastIndexOf(" ");
      if (spaceIdx > 0) cut = spaceIdx + 1;
    }
    // Final fallback: hard cut (rare; only for pathological no-space input)
    if (cut <= 0) cut = maxChars;

    out.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  return out;
}

// Build a thread when an article's description is long enough to be split.
// Returns array of post objects with { post_text, post_type: 'thread',
// thread_group_id, thread_position, thread_total }.
//
// Layout:
//   Tweet 1: emoji + title  +  " (1/N)"
//   Tweet 2..N-1: description chunks + " (i/N)"
//   Tweet N: final chunk + "\n\n" + URL  +  " (N/N)"
function composeThread(article) {
  const url = `${SITE}/article/${encodeURIComponent(article.id)}?utm_source=social_x&utm_medium=social&utm_campaign=scoop_auto`;
  const description = (article.description || "").trim();
  if (!description || description.length < THREAD_LENGTH_THRESHOLD) return [];

  // Reserve space for the URL line in the final tweet: "\n\n<url>" + " (N/N)" suffix
  const urlLineLen   = 2 + url.length; // "\n\n" + url
  const suffixLen    = " (N/N)".length; // ~6 chars; safe upper bound for N ≤ 9

  // First tweet: emoji + title with " (1/N)" suffix. Cap at TWEET_HARD_CAP - suffixLen.
  // Use category-aware emoji from socialComposer's existing logic via composeAllPlatforms,
  // but we have to re-pick emoji here to avoid the composeX URL-inclusion. So mirror
  // the same emoji map; keeping it inline avoids exporting internals from socialComposer.
  const emoji = pickCategoryEmoji(article.category);
  const headBudget = TWEET_HARD_CAP - suffixLen;
  let head = `${emoji} ${article.title}`.trim();
  if (head.length > headBudget) head = head.slice(0, headBudget - 1).trim() + "…";

  // Chunk the description. We need at most THREAD_MAX_PARTS - 1 description chunks
  // (saving slot 1 for the headline). And the last description chunk needs to
  // make room for the URL line at the end.
  const descChunks = chunkAtBoundaries(description, CHUNK_MAX_CHARS, THREAD_MAX_PARTS - 1);
  if (descChunks.length === 0) return []; // nothing chunkable; caller should use single-post path

  // Adjust the LAST chunk to fit the URL line within TWEET_HARD_CAP - suffixLen.
  // last chunk text + (optional "…") + "\n\n" + url + " (N/N)" must ≤ 280.
  // Reserve 1 char for a potential trailing ellipsis (U+2026) — appended when
  // re-chunking truncates mid-clause. If the re-chunk lands cleanly on a
  // sentence boundary the ellipsis is skipped (no signal of truncation needed
  // when the period already conveys end-of-thought).
  const lastChunkBudget = TWEET_HARD_CAP - suffixLen - urlLineLen - 1;
  let lastChunk = descChunks[descChunks.length - 1];
  if (lastChunk.length > lastChunkBudget) {
    const reChunked = chunkAtBoundaries(lastChunk, lastChunkBudget, 2);
    let truncated = reChunked.length > 0
      ? reChunked[0]
      : lastChunk.slice(0, lastChunkBudget).trim();
    // Append ellipsis unless truncation landed at a natural sentence boundary.
    if (!/[.!?]$/.test(truncated)) {
      truncated = truncated + "…";
    }
    descChunks[descChunks.length - 1] = truncated;
  }

  const total = 1 + descChunks.length; // 1 head + N description tweets
  if (total < 2 || total > THREAD_MAX_PARTS) {
    // Defensive: total below 2 makes no sense for a thread; above max means we overshot.
    return [];
  }

  const threadGroupId = crypto.randomUUID();
  const posts = [];

  // Tweet 1: head
  posts.push({
    post_text:        `${head} (1/${total})`,
    post_type:        "thread",
    thread_group_id:  threadGroupId,
    thread_position:  1,
    thread_total:     total,
  });

  // Tweets 2 ... total-1: middle description chunks (if any)
  for (let i = 0; i < descChunks.length - 1; i++) {
    const pos = 2 + i;
    posts.push({
      post_text:        `${descChunks[i]} (${pos}/${total})`,
      post_type:        "thread",
      thread_group_id:  threadGroupId,
      thread_position:  pos,
      thread_total:     total,
    });
  }

  // Tweet total: last description chunk + URL line
  const lastIdx = descChunks.length - 1;
  posts.push({
    post_text:        `${descChunks[lastIdx]}\n\n${url} (${total}/${total})`,
    post_type:        "thread",
    thread_group_id:  threadGroupId,
    thread_position:  total,
    thread_total:     total,
  });

  return posts;
}

// Category-emoji table mirrors socialComposer's CATEGORY_EMOJI. Kept inline to
// avoid exporting socialComposer internals.
function pickCategoryEmoji(category) {
  const map = {
    top: "📰", politics: "🏛️", pakistan: "🇵🇰", international: "🌍",
    science: "🔬", medicine: "💊", "public-health": "🏥", health: "💪",
    environment: "🌱", "self-help": "🌟", sports: "🏆", cars: "🚗", ai: "🤖",
  };
  return map[category] || "📰";
}

// Compose a single-post entry by reusing socialComposer's composeX. Returns a
// one-element array with post_text set to the existing composer's caption.
function composeSingle(article) {
  const composed = composeAllPlatforms(article);
  const x = composed.platforms?.x;
  if (!x?.caption) return [];
  return [{
    post_text:        x.caption,
    post_type:        "single",
    thread_group_id:  null,
    thread_position:  null,
    thread_total:     null,
  }];
}

// Public API. Decides single vs thread based on description length. Returns
// an array of post objects ready to pass to enqueueXPosts(articleId, posts).
//
// Length-only threshold for thread-mode: description.length > 250. Credibility
// filtering already happens upstream in findArticlesPendingXQueue (min ≥ 7).
export function generateXPostsForArticle(article) {
  if (!article || !article.id || !article.title) return [];
  const desc = (article.description || "").trim();
  if (desc.length > THREAD_LENGTH_THRESHOLD) {
    const thread = composeThread(article);
    if (thread.length >= 2) return thread;
    // Thread composition can return empty if chunking failed (very unusual).
    // Fall through to single-post path for safety.
  }
  return composeSingle(article);
}

// Scheduler entry point. Mirrors the runAllPlatformsCycle pattern: find a
// small batch of candidate articles, generate posts, enqueue. Caller wraps
// with try/catch (scheduler.js graceful-failure pattern).
export function runXQueueGenerationCycle({
  minCredibility = 7,
  withinMs       = 12 * 60 * 60 * 1000,
  limit          = 10,
} = {}) {
  const articles = findArticlesPendingXQueue({ minCredibility, withinMs, limit });
  if (articles.length === 0) {
    return { articlesScanned: 0, postsEnqueued: 0, threadsGenerated: 0 };
  }

  let postsEnqueued    = 0;
  let threadsGenerated = 0;

  for (const article of articles) {
    try {
      const posts = generateXPostsForArticle(article);
      if (posts.length === 0) continue;
      const inserted = enqueueXPosts(article.id, posts);
      postsEnqueued += inserted;
      if (posts.length > 1) threadsGenerated += 1;
    } catch (err) {
      // Graceful degradation: log + continue with next article. Queue failures
      // never block article publish (caller wraps this whole cycle in try/catch
      // at the scheduler level too).
      logger.warn(`xQueue: article ${article.id} failed — ${err.message}`);
    }
  }

  const out = { articlesScanned: articles.length, postsEnqueued, threadsGenerated };
  if (postsEnqueued > 0) {
    logger.info(`🧵 X queue: scanned=${out.articlesScanned} posts=${out.postsEnqueued} threads=${out.threadsGenerated}`);
  }
  return out;
}
