// Auto-posting the X text queue.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT WAS ALREADY HERE, AND WHY IT COULD NOT SIMPLY BE SWITCHED ON
//
// x_post_queue has generated X-ready text from published articles for months —
// 5,511 rows — and delivered it to the founder by email to paste by hand. That
// was a deliberate cost decision when the X API had no affordable write tier.
//
// Three things make "just post the queue" wrong:
//
//   1. EVERY SINGLE POST CARRIES A LINK. The composer appends
//      `https://scoopfeeds.com/article/…?utm_source=social_x`, which is correct
//      for a pasted post and ruinous for an automated one: X charges $0.20 for a
//      post containing a link against $0.015 without, and downranks it besides.
//      xClient.assertNoLink would refuse every one of them.
//
//   2. VOLUME. 785 posts were generated in a single day and 1,203 are pending.
//      Posting the backlog is a bill and a spam flag at once.
//
//   3. STALENESS. A six-hour-old take on a news story is worth nothing. The
//      backlog is not a queue to drain; it is a record of what was offered.
//
// So this posts a SMALL NUMBER OF FRESH items, with the link removed and the
// same one-or-two-tag rule the video captions use.

import { logger } from "./logger.js";
import {
  listFreshPendingXPosts, markXPostsPosted, countXTextPostsSince,
  getArticleEntitiesForTagging,
} from "../models/database.js";
import { isXConfigured, postToX, fitPost } from "./xClient.js";
import { hashtagsFor, withHashtags } from "./xHashtags.js";

export const xTextEnabled = () => process.env.X_TEXT_POST_ENABLED === "1";

const MAX_PER_DAY = () => Math.max(0, Number.parseInt(process.env.X_TEXT_MAX_PER_DAY || "8", 10));
const MAX_AGE_HOURS = () => Math.max(1, Number.parseFloat(process.env.X_TEXT_MAX_AGE_HOURS || "6"));
const ARTICLES_PER_CYCLE = () => Math.max(1, Number.parseInt(process.env.X_TEXT_ARTICLES_PER_CYCLE || "2", 10));

/**
 * Remove the tracking link the composer added for the paste workflow.
 *
 * Deliberately targeted at OUR url rather than any link: a post whose text
 * genuinely quotes a URL is a different thing, and assertNoLink will refuse it
 * downstream rather than this silently rewriting it.
 */
export function stripOwnLink(text) {
  return String(text || "")
    .replace(/https?:\/\/(?:www\.)?scoopfeeds\.com\/\S*/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Thread parts grouped and ordered; singles as groups of one. */
export function groupPosts(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.thread_group_id || `single:${r.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const parts of groups.values()) {
    parts.sort((a, b) => (a.thread_position ?? 0) - (b.thread_position ?? 0) || a.id - b.id);
  }
  return [...groups.values()];
}

/** A thread must be whole. A half-posted thread reads worse than none. */
export function isComplete(parts) {
  const total = parts[0]?.thread_total;
  if (!total || total <= 1) return parts.length === 1;
  if (parts.length !== total) return false;
  return parts.every((p, i) => (p.thread_position ?? i + 1) === i + 1);
}

export async function runXTextCycle({ now = Date.now(), deps = {} } = {}) {
  const {
    _postToX = postToX,
    _list = listFreshPendingXPosts,
    _mark = markXPostsPosted,
    _count = countXTextPostsSince,
    _entities = getArticleEntitiesForTagging,
  } = deps;

  if (!xTextEnabled()) return { status: "off" };
  if (!isXConfigured()) {
    logger.warn("𝕏 text: X_TEXT_POST_ENABLED=1 but the client is not configured — nothing posted");
    return { status: "not-configured" };
  }

  const max = MAX_PER_DAY();
  const already = _count(now - 24 * 3600_000);
  if (already >= max) {
    logger.info(`𝕏 text: cap ${already}/${max} in the last 24h — nothing posted`);
    return { status: "capped", already, max };
  }

  const sinceMs = now - MAX_AGE_HOURS() * 3600_000;
  const rows = _list({ sinceMs, articleLimit: ARTICLES_PER_CYCLE() });
  if (!rows.length) {
    logger.info(`𝕏 text: nothing fresh in the last ${MAX_AGE_HOURS()}h`);
    return { status: "idle", posted: 0 };
  }

  let posted = 0;
  const results = [];
  for (const parts of groupPosts(rows)) {
    if (already + posted >= max) {
      // NO SILENT CAP. Say what was left rather than implying the queue was empty.
      logger.info(`𝕏 text: budget reached at ${already + posted}/${max} — ${rows.length - posted} item(s) left for the next cycle`);
      break;
    }
    if (!isComplete(parts)) {
      logger.info(`𝕏 text: skipping an incomplete thread (${parts.length}/${parts[0]?.thread_total ?? "?"} parts present)`);
      continue;
    }
    // A whole thread must fit the remaining budget, or it is not started.
    if (already + posted + parts.length > max) {
      logger.info(`𝕏 text: a ${parts.length}-part thread does not fit the remaining budget — left for the next cycle`);
      continue;
    }

    const tags = hashtagsFor({
      title: parts[0].article_title || "",
      entities: _entities(parts[0].article_id),
    });

    let replyToId = null;
    const doneIds = [];
    try {
      for (let i = 0; i < parts.length; i++) {
        const body = fitPost(stripOwnLink(parts[i].post_text), 280 - 40);
        // Tags go on the FIRST part only: repeating them down a thread is the
        // multi-tag penalty paid several times over.
        const text = i === 0 ? withHashtags(body, tags) : body;
        const res = await _postToX({ text, replyToId });
        replyToId = res.id;
        doneIds.push(parts[i].id);
        posted += 1;
      }
      _mark(doneIds, now);
      results.push({ ids: doneIds, url: `https://x.com/i/status/${replyToId}`, parts: parts.length });
      logger.info(`𝕏 TEXT POSTED ${parts.length === 1 ? "single" : parts.length + "-part thread"}` +
        `${tags.length ? ` tags=${tags.join(" ")}` : ""} (${already + posted}/${max} today)`);
    } catch (err) {
      // Whatever went out stays marked, so a retry cannot repeat it. The rest of
      // the thread is left pending rather than forced.
      //
      // The mark is itself wrapped: it threw once (a status the CHECK
      // constraint rejected), and because THIS call is the recovery path, its
      // throw escaped the loop and killed the whole cycle after one post. A
      // recovery path that can fail the same way as the thing it recovers from
      // is not a recovery path.
      try { if (doneIds.length) _mark(doneIds, now); }
      catch (markErr) {
        logger.error(`𝕏 text: posted ${doneIds.length} part(s) and could NOT record it — ` +
          `they may be reposted. ${markErr.message.slice(0, 160)}`);
      }
      logger.error(`𝕏 text post failed after ${doneIds.length}/${parts.length} part(s): ${err.message.slice(0, 200)}`);
    }
  }

  return { status: "ok", posted, cap: max, results };
}
