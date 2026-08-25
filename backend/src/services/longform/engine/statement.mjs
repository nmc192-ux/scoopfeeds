// Statement capture — tweets as verbatim evidence (#82).
//
// The films' evidence register is "dates and declarations, attributed". A
// principal's tweet IS a dated declaration — but a tweet is also the most
// forgeable, deletable, context-collapsible artifact in journalism, so the
// rules here are hard ones:
//
//   1. EVIDENCE ENTERS ONLY THROUGH THIS MODULE. There is deliberately no
//      path that accepts a pre-existing screenshot image. Capture fetches
//      the live endpoints at production time and archives what they said.
//   2. VERBATIM OR NOTHING. The card renders from the archive; QC re-checks
//      the card text byte-against the archive. No paraphrase, no composite.
//   3. A REPLY WITHOUT ITS PARENT IS REJECTED. Quoting a reply out of its
//      thread misrepresents it. Capture the parent first, then the reply
//      with `parent` pointing at it.
//   4. RE-VERIFY BEFORE PUBLISH. Films sit private until their publishAt; a
//      statement deleted in between is an editorial event. verifyStatement
//      answers exists/changed, and the publish flow decides (default: hold).
//
// Endpoints (both free, no auth — X's paid API is deliberately NOT used;
// discovery is the event graph's job, this module only retrieves specific
// known statements):
//   - syndication (cdn.syndication.twimg.com/tweet-result) — primary: real
//     created_at, full text, user, and in_reply_to detection. The `token`
//     parameter is the documented-by-use derivation the official embed
//     runtime (react-tweet) sends.
//   - oEmbed (publish.twitter.com/oembed) — fallback + secondary record.
//
// Everything network-touching takes an injectable `fetchImpl` so the tests
// run offline against recorded fixtures.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

const SYNDICATION = "https://cdn.syndication.twimg.com/tweet-result";
const OEMBED = "https://publish.twitter.com/oembed";

/** Tweet id from any of the URL shapes X serves. */
export function tweetIdFromUrl(url) {
  const m = String(url).match(/(?:twitter\.com|x\.com)\/[^/]+\/status(?:es)?\/(\d+)/);
  return m ? m[1] : null;
}

/** The token the official embed runtime derives from the id. */
export function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

/**
 * Fetch one statement from the live endpoints. Returns the normalized record
 * or throws with a reason. Network only — no disk.
 */
export async function fetchStatement(url, { fetchImpl = fetch } = {}) {
  const id = tweetIdFromUrl(url);
  if (!id) throw new Error(`fetchStatement: not a recognisable tweet URL: ${url}`);

  // Primary: syndication — the record of substance.
  let syn = null;
  try {
    const r = await fetchImpl(`${SYNDICATION}?id=${id}&token=${syndicationToken(id)}&lang=en`);
    if (r.ok) syn = await r.json();
    else if (r.status === 404) throw new Error(`statement ${id}: not found (deleted, private, or never existed)`);
  } catch (e) {
    if (/not found/.test(e.message)) throw e;
    // network/shape failure — fall through to oEmbed
  }

  // Secondary/fallback: oEmbed.
  let oembed = null;
  try {
    const r = await fetchImpl(`${OEMBED}?url=${encodeURIComponent(url)}&omit_script=true&dnt=true`);
    if (r.ok) oembed = await r.json();
    else if (r.status === 404 && !syn) throw new Error(`statement ${id}: not found (deleted, private, or never existed)`);
  } catch (e) {
    if (/not found/.test(e.message)) throw e;
  }

  if (!syn && !oembed) throw new Error(`statement ${id}: both endpoints unreachable — capture needs the network`);

  // Normalise. Syndication wins on every field it has; oEmbed fills gaps.
  const oembedText = oembed ? oembedTextFromHtml(oembed.html) : null;
  const rec = {
    id,
    url,
    text: syn?.text ?? oembedText,
    name: syn?.user?.name ?? oembed?.author_name ?? null,
    handle: syn?.user?.screen_name
      ?? (oembed?.author_url ? oembed.author_url.split("/").filter(Boolean).pop() : null),
    createdAt: syn?.created_at ?? null,
    inReplyToId: syn?.in_reply_to_status_id_str ?? null,
    fetchedAt: new Date().toISOString(),
    // The raw responses ARE the provenance — archived verbatim.
    raw: { syndication: syn, oembed },
  };
  if (!rec.text) throw new Error(`statement ${id}: no text recoverable from either endpoint`);
  return rec;
}

/** Extract the quoted text from oEmbed's blockquote HTML. */
export function oembedTextFromHtml(html) {
  const m = String(html || "").match(/<p[^>]*>([\s\S]*?)<\/p>/);
  if (!m) return null;
  return m[1]
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<a[^>]*>([\s\S]*?)<\/a>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .trim();
}

/**
 * Capture a statement into a project's evidence archive.
 *
 * THE THREAD RULE LIVES HERE: a reply is only accepted when `parent` names an
 * already-archived statement that IS its parent. Rejected otherwise —
 * repairing context is not this module's job, refusing to lose it is.
 *
 * @param {string} url        the tweet URL
 * @param {object} opts
 * @param {(...a) => string} opts.P  project path helper (from _deps.mjs)
 * @param {string} [opts.parent]     archived id of the parent, for replies
 * @param {function} [opts.fetchImpl]
 * @returns the archived record; writes out/evidence/<id>.json
 */
export async function captureStatement(url, { P, parent = null, fetchImpl = fetch } = {}) {
  if (!P) throw new Error("captureStatement: P (project path helper) required");
  const rec = await fetchStatement(url, { fetchImpl });

  if (rec.inReplyToId) {
    if (!parent) {
      throw new Error(
        `statement ${rec.id} is a REPLY (to ${rec.inReplyToId}) — capture the parent first and pass `
        + `parent: "<its id>". A reply quoted without its thread misrepresents it.`);
    }
    const parentPath = P(`out/evidence/${parent}.json`);
    if (!existsSync(parentPath)) {
      throw new Error(`statement ${rec.id}: parent ${parent} is not archived (expected ${parentPath})`);
    }
    if (parent !== rec.inReplyToId) {
      throw new Error(
        `statement ${rec.id}: declared parent ${parent} is not its actual parent ${rec.inReplyToId}`);
    }
    rec.parent = parent;
  }

  const dir = P("out/evidence");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${rec.id}.json`);
  writeFileSync(file, JSON.stringify(rec, null, 2));
  return rec;
}

/** Load an archived statement; throws (never repairs) when absent. */
export function loadStatement(id, { P }) {
  const file = P(`out/evidence/${id}.json`);
  if (!existsSync(file)) {
    throw new Error(`statement ${id}: not in the archive (${file}) — capture it first; `
      + `evidence enters only through captureStatement`);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * The verbatim gate: the text a card is about to render must byte-match the
 * archive. Called by the card itself, so a hand-edited spec cannot drift a
 * quotation — a mismatch is a QC failure, not a warning.
 */
export function assertVerbatim(cardText, rec) {
  if (cardText !== rec.text) {
    throw new Error(
      `statement ${rec.id}: card text differs from the archive.\n`
      + `  archive: ${JSON.stringify(rec.text)}\n`
      + `  card:    ${JSON.stringify(cardText)}\n`
      + `The archive is the record; edit nothing.`);
  }
}

/**
 * Publish-time re-verification. Films sit private until their slot; the
 * statement must still exist and still say the same thing. Never throws on a
 * finding — returns { status: "ok" | "deleted" | "changed" | "unreachable" }
 * and lets the publish flow decide (its default is HOLD).
 */
export async function verifyStatement(rec, { fetchImpl = fetch } = {}) {
  try {
    const live = await fetchStatement(rec.url, { fetchImpl });
    if (live.text !== rec.text) return { status: "changed", live: live.text, archived: rec.text };
    return { status: "ok" };
  } catch (e) {
    if (/not found/.test(e.message)) return { status: "deleted" };
    return { status: "unreachable", reason: e.message };
  }
}
