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

// APPEND accepts up to 5MB; 4MB keeps a margin and turns a 47MB render into 12
// requests instead of 47.
const CHUNK = 4 * 1024 * 1024;

/**
 * THE CHUNKED UPLOAD USES DEDICATED ENDPOINTS, NOT command= ON /2/media/upload.
 *
 * The first implementation followed the v1.1-shaped documentation — one URL,
 * `command=INIT|APPEND|FINALIZE` as a QUERY parameter — and X rejected every
 * call with a message that says exactly what is wrong if you read it:
 *
 *     "The query parameter [command] is not one of []"
 *
 * An empty allowed-set: that endpoint takes no query parameters at all. Four
 * shapes were probed against the live API before this was rewritten:
 *
 *   /2/media/upload?command=INIT           -> 400, query parameter not allowed
 *   /2/media/upload  (multipart body)      -> 400, "Missing media field" (that
 *                                             is the SIMPLE upload, not chunked)
 *   /2/media/upload  (form-urlencoded)     -> 400, same as the first
 *   /2/media/upload/initialize (JSON body) -> 200 + media id                ✓
 *
 * Verified end to end on a real 47MB render: initialize 200, all 12 appends
 * accepted, finalize 200 with processing_info, and STATUS reporting
 * state=succeeded.
 *
 * STATUS is the one call that DOES take query parameters, on the base path.
 * That asymmetry is not a mistake here — it is what the API does.
 */
async function xJson(url, { method = "POST", query = {}, body = null, headers = {} } = {}) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(qs ? `${url}?${qs}` : url, {
    method,
    headers: { Authorization: oauthHeader(method, url, query, creds()), ...headers },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* X returns HTML on some errors */ }
  if (!res.ok) throw new Error(`X ${method} ${url.replace(API, "")} ${res.status}: ${(text || "").slice(0, 300)}`);
  return json;
}

export async function uploadVideo(filePath, { onStep = () => {} } = {}) {
  if (!existsSync(filePath)) throw new Error(`X upload: file not found at ${filePath}`);
  const bytes = readFileSync(filePath);
  const total = statSync(filePath).size;

  onStep("initialize");
  const init = await xJson(`${API}/2/media/upload/initialize`, {
    body: JSON.stringify({ media_type: "video/mp4", total_bytes: total, media_category: "tweet_video" }),
    headers: { "Content-Type": "application/json" },
  });
  const mediaId = init?.data?.id;
  if (!mediaId) throw new Error(`X initialize returned no media id: ${JSON.stringify(init).slice(0, 200)}`);

  for (let i = 0, off = 0; off < total; i++, off += CHUNK) {
    const form = new FormData();
    form.append("segment_index", String(i));
    // The filename is required — an unnamed part is not treated as a file.
    form.append("media", new Blob([bytes.subarray(off, Math.min(off + CHUNK, total))]), "chunk");
    onStep(`append ${i + 1}`);
    await xJson(`${API}/2/media/upload/${mediaId}/append`, { body: form });
  }

  onStep("finalize");
  const fin = await xJson(`${API}/2/media/upload/${mediaId}/finalize`);

  // POLL. finalize returns before transcoding completes, and attaching a
  // media_id that is still processing produces a post with no video on it.
  let info = fin?.data?.processing_info;
  const deadline = Date.now() + 5 * 60_000;
  while (info && info.state !== "succeeded") {
    if (info.state === "failed") {
      throw new Error(`X video processing failed: ${JSON.stringify(info.error || info).slice(0, 200)}`);
    }
    if (Date.now() > deadline) throw new Error(`X video processing did not finish within 5 minutes (media ${mediaId})`);
    await new Promise(r => setTimeout(r, Math.max(1, info.check_after_secs || 5) * 1000));
    onStep(`processing ${info.state || "?"}`);
    const st = await xJson(`${API}/2/media/upload`, { method: "GET", query: { command: "STATUS", media_id: mediaId } });
    info = st?.data?.processing_info;
  }
  return mediaId;
}

/**
 * An image, in one call.
 *
 * Video needs the chunked dance — initialize / append / finalize / poll. An
 * image does not: POST the bytes to /2/media/upload with a `media` part and it
 * comes back with an id. That endpoint is the SIMPLE upload, which is why the
 * first attempt at video against it returned "Missing media field in JSON".
 *
 * Verified live: a 567KB 1200x630 PNG returned 200 and a media id; X
 * transcoded it to JPEG server-side, which is its business rather than ours.
 */
export async function uploadImage(bytes, { filename = "card.png", contentType = "image/png" } = {}) {
  const url = `${API}/2/media/upload`;
  const form = new FormData();
  form.append("media", new Blob([bytes], { type: contentType }), filename);
  form.append("media_category", "tweet_image");
  const res = await xJson(url, { body: form });
  const id = res?.data?.id;
  if (!id) throw new Error(`X image upload returned no id: ${JSON.stringify(res).slice(0, 200)}`);
  return id;
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

/**
 * `replyToId` chains a post onto another, which is how a thread is built. X has
 * no thread endpoint: each part is an ordinary post whose reply target is the
 * previous part's id.
 */
export async function postToX({ text, filePath = null, imageBytes = null, replyToId = null, onStep = () => {} } = {}) {
  if (!isXConfigured()) throw new Error("X not configured (X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET)");
  const body = fitPost(assertNoLink(text));

  let mediaIds = null;
  if (filePath) mediaIds = [await uploadVideo(filePath, { onStep })];
  // A card for text posts — the same OG bytes Bluesky attaches to its link
  // cards. Video posts already carry the video and never take one.
  //
  // A failed picture must not cost the post: an image-less post is worse than
  // one with a card, a post that never happened is worse than both.
  else if (imageBytes) {
    try {
      onStep("image");
      mediaIds = [await uploadImage(imageBytes)];
    } catch (err) {
      logger.warn(`𝕏 card image skipped, posting text only — ${err.message.slice(0, 140)}`);
    }
  }

  onStep("post");
  const payload = { text: body };
  if (mediaIds) payload.media = { media_ids: mediaIds };
  if (replyToId) payload.reply = { in_reply_to_tweet_id: String(replyToId) };
  const res = await xJson(TWEETS, {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  });
  const id = res?.data?.id;
  if (!id) throw new Error(`X create post returned no id: ${JSON.stringify(res).slice(0, 200)}`);
  logger.info(`𝕏 posted ${id}${mediaIds ? " with video" : ""}`);
  return { id, url: `https://x.com/i/status/${id}` };
}
