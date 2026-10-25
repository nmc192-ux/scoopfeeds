/**
 * What a public endpoint may send about an article (issue #176).
 *
 * `articles.content` holds up to ~2,000 characters of the feed's `content:encoded`:
 * multi-paragraph publisher text, and for short pieces the whole article. It never
 * leaves the server. `description` is capped at MAX_SUMMARY_SENTENCES sentences, since
 * some feeds put the full text there too. Internal callers (video queue, social,
 * enrichment) read the DB directly and are unaffected.
 */
import { firstSentences } from "./readerPayload.js";

/** Columns that carry publisher body text and are never sent to a reader. */
export const BODY_FIELDS = ["content", "textContent", "articleBody", "body", "html"];

/** Copy of an article row with body fields removed and the description capped. */
export function toPublicArticle(a) {
  if (!a || typeof a !== "object") return a;
  const out = { ...a };
  for (const k of BODY_FIELDS) delete out[k];
  if (typeof out.description === "string") out.description = firstSentences(out.description) || null;
  return out;
}

export function toPublicArticles(list) {
  return Array.isArray(list) ? list.map(toPublicArticle) : list;
}
