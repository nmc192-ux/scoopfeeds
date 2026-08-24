// X (Twitter) posting — OAuth 1.0a, chunked video upload, no links.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THERE IS NO LINK IN ANYTHING THIS FILE POSTS
//
// X abolished its free tier in February 2026. Everything is pay-per-use, and
// the price list has one line that dominates every design decision here:
//
//     $0.015 per post — or $0.20 per post CONTAINING A LINK.
//
// A 13x surcharge. At ~313 videos/month that is $4.70 against $63, and the
// article queue would multiply it again. X also downranks link posts in its own
// algorithm, so the expensive option is also the worse-performing one.
//
// So: the site lives in the profile bio, and nothing composed here carries a
// URL. `assertNoLink` enforces it at the call boundary rather than trusting
// every caller to remember, because the failure is silent — a post with a link
// succeeds exactly like one without, and the difference only appears on a bill.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY OAUTH 1.0a AND NOT OAUTH 2.0
//
// X supports both. OAuth 2.0 user-context tokens expire and their refresh
// tokens ROTATE on every use, so each refresh must be persisted before the next
// call or the credential is dead. This runs in three containers off one env
// file; a rotating secret that must be written back is the shape that has
// already bitten this project once (TikTok's refresh token landed in the wrong
// env file). OAuth 1.0a access tokens do not expire and never rotate. For a
// daemon posting as itself, that is the right trade.

import { createHmac, randomBytes } from "crypto";
import { readFileSync, statSync, existsSync } from "fs";
import { logger } from "./logger.js";

const API = "https://api.x.com";
const UPLOAD = `${API}/2/media/upload`;
const TWEETS = `${API}/2/tweets`;

export const isXConfigured = () => Boolean(
  process.env.X_API_KEY && process.env.X_API_SECRET &&
  process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_SECRET
);

// ─── OAuth 1.0a ─────────────────────────────────────────────────────────────

/**
 * RFC 3986, not encodeURIComponent.
 *
 * `encodeURIComponent` leaves ! * ' ( ) alone; OAuth requires them encoded, and
 * a single unencoded character anywhere in the base string produces a signature
 * that is wrong in a way the server reports only as 401. This function is the
 * difference between "it works" and an afternoon.
 */
export function pct(s) {
  return encodeURIComponent(String(s)).replace(/[!*'()]/g, c =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * The signature base string and the Authorization header.
 *
 * `params` must contain every query parameter AND, for form-encoded bodies,
 * every body parameter — but NOT multipart or JSON bodies, which OAuth 1.0a
 * deliberately excludes from the signature. Passing the wrong set is the other
 * way to get a 401 that looks like bad credentials.
 */
export function oauthHeader(method, url, params = {}, creds = {}, nonce = null, ts = null) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce || randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(ts || Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all).sort()
    .map(k => `${pct(k)}=${pct(all[k])}`).join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramString)].join("&");
  const key = `${pct(creds.apiSecret)}&${pct(creds.accessSecret)}`;
  oauth.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.keys(oauth).sort()
    .map(k => `${pct(k)}="${pct(oauth[k])}"`).join(", ");
}

const creds = () => ({
  apiKey: process.env.X_API_KEY,
  apiSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

// ─── the link guard ─────────────────────────────────────────────────────────

const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|org|net|io|co|news|tv|me|ly)\b/i;

/** A link costs 13x. Refuse rather than post one by accident. */
export function assertNoLink(text) {
  const m = String(text || "").match(LINK);
  if (m) {
    throw new Error(
      `X post contains a link ("${m[0]}") — that costs $0.20 instead of $0.015. ` +
      `The site belongs in the profile bio, not the post.`
    );
  }
  return text;
}

/**
 * A publisher name X will not bill as a link.
 *
 * Found by testing the guard against real data: "Investing.com" is a genuine
 * masthead in this feed, and "Source: Investing.com" is a $0.20 post by X's
 * reckoning — the biller does not care that it is a company name rather than a
 * destination. One publisher in 78 over a week, which is rare enough to have
 * been discovered in production and common enough to matter.
 *
 * The TLD is dropped rather than the name rewritten: "Investing.com" credits
 * the same organisation as "Investing", and a credit that is slightly shorter
 * is better than a channel that silently fails for one publisher — or a bill
 * thirteen times larger for it.
 */
const TLD = /\.(?:com|org|net|io|co|news|tv|me|ly|uk|edu|gov|info|biz)+$/i;

export function xSafePublisher(name) {
  const s = String(name || "").trim();
  if (!s) return null;
  const stripped = s.replace(TLD, "").trim();
  // If stripping leaves nothing, or the name is still link-shaped (a bare
  // domain with a path, say), credit nothing rather than risk the surcharge.
  return stripped && !LINK.test(stripped) ? stripped : null;
}

// ─── chunked video upload ───────────────────────────────────────────────────

const CHUNK = 1024 * 1024; // 1MB — the size X's own example uses; APPEND caps at 5MB.

async function xFetch(url, { method = "POST", query = {}, body = null, headers = {} } = {}) {
  const qs = new URLSearchParams(query).toString();
  const full = qs ? `${url}?${qs}` : url;
  const res = await fetch(full, {
    method,
    headers: { Authorization: oauthHeader(method, url, query, creds()), ...headers },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* X returns HTML on some errors */ }
  if (!res.ok) {
    throw new Error(`X ${method} ${url.replace(API, "")} ${res.status}: ${(text || "").slice(0, 300)}`);
  }
  return json;
}

/**
 * Upload an MP4 and return its media_id.
 *
 * INIT / APPEND / FINALIZE, then POLL — the poll is not optional. FINALIZE
 * returns before X has transcoded the video, and attaching a media_id that is
 * still processing produces a post with no video on it.
 */
export async function uploadVideo(filePath, { onStep = () => {} } = {}) {
  if (!existsSync(filePath)) throw new Error(`X upload: file not found at ${filePath}`);
  const bytes = readFileSync(filePath);
  const total = statSync(filePath).size;

  onStep("init");
  const init = await xFetch(UPLOAD, {
    query: { command: "INIT", media_type: "video/mp4", total_bytes: String(total), media_category: "tweet_video" },
  });
  const mediaId = init?.data?.id || init?.media_id_string || init?.data?.media_id_string;
  if (!mediaId) throw new Error(`X upload INIT returned no media id: ${JSON.stringify(init).slice(0, 200)}`);

  for (let i = 0, off = 0; off < total; i++, off += CHUNK) {
    const slice = bytes.subarray(off, Math.min(off + CHUNK, total));
    const form = new FormData();
    form.append("media", new Blob([slice]));
    onStep(`append ${i + 1}`);
    await xFetch(UPLOAD, {
      query: { command: "APPEND", media_id: mediaId, segment_index: String(i) },
      body: form,
    });
  }

  onStep("finalize");
  const fin = await xFetch(UPLOAD, { query: { command: "FINALIZE", media_id: mediaId } });

  // POLL. `processing_info` is absent when the media is already usable.
  let info = fin?.data?.processing_info || fin?.processing_info;
  const deadline = Date.now() + 5 * 60_000;
  while (info && info.state !== "succeeded") {
    if (info.state === "failed") {
      throw new Error(`X video processing failed: ${JSON.stringify(info.error || info).slice(0, 200)}`);
    }
    if (Date.now() > deadline) throw new Error("X video processing did not finish within 5 minutes");
    await new Promise(r => setTimeout(r, Math.max(1, info.check_after_secs || 5) * 1000));
    onStep(`processing ${info.state || "?"}`);
    const st = await xFetch(UPLOAD, { method: "GET", query: { command: "STATUS", media_id: mediaId } });
    info = st?.data?.processing_info || st?.processing_info;
  }
  return mediaId;
}

// ─── posting ────────────────────────────────────────────────────────────────

/** 280 characters, counted in GRAPHEMES — an emoji is one character to X. */
export function fitPost(text, max = 280) {
  const s = String(text ?? "").trim();
  const units = typeof Intl?.Segmenter === "function"
    ? [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(s)].map(g => g.segment)
    : Array.from(s);
  return units.length <= max ? s : units.slice(0, max - 1).join("").trimEnd() + "…";
}

export async function postToX({ text, filePath = null, onStep = () => {} } = {}) {
  if (!isXConfigured()) throw new Error("X not configured (X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET)");
  const body = fitPost(assertNoLink(text));

  let mediaIds = null;
  if (filePath) mediaIds = [await uploadVideo(filePath, { onStep })];

  onStep("post");
  const payload = mediaIds ? { text: body, media: { media_ids: mediaIds } } : { text: body };
  const res = await xFetch(TWEETS, {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  });
  const id = res?.data?.id;
  if (!id) throw new Error(`X create post returned no id: ${JSON.stringify(res).slice(0, 200)}`);
  logger.info(`𝕏 posted ${id}${mediaIds ? " with video" : ""}`);
  return { id, url: `https://x.com/i/status/${id}` };
}
