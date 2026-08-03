// Facebook Page Graph API client.
//
// Posts a photo (our branded OG card) with caption to a Facebook Page.
// Photo posts outperform link-only posts on reach; the article URL is
// embedded in the caption so it still drives clicks.
//
// Auth model:
//   A Page Access Token retrieved from a long-lived User token does NOT
//   expire — Meta calls these "permanent page tokens". We persist it to
//   data/facebook-token.json alongside the other social tokens.
//
// Required env vars on first install:
//   FACEBOOK_PAGE_ID    — numeric ID of the Facebook Page (not the username)
//   FACEBOOK_PAGE_TOKEN — permanent page access token (see setup guide below)
//
// How to get the token (one-time, takes ~5 min):
//   1. Go to developers.facebook.com → create / select your app
//   2. Add "Facebook Login" + "Pages API" products
//   3. Graph API Explorer → select your app → Generate User Token
//      (permissions needed: pages_manage_posts, pages_read_engagement,
//       pages_show_list — the third is required by POST /{page-id}/videos and
//       its absence surfaces as an OAuthException at upload time, not at mint
//       time, so mint with all three even if you only intend to post photos)
//   4. Exchange for long-lived token:
//      GET https://graph.facebook.com/oauth/access_token
//        ?grant_type=fb_exchange_token
//        &client_id={APP_ID}
//        &client_secret={APP_SECRET}
//        &fb_exchange_token={SHORT_LIVED_TOKEN}
//   5. GET /me/accounts?access_token={long-lived-user-token}
//      → find your page → copy its `access_token` — this is permanent.
//   6. Set FACEBOOK_PAGE_TOKEN to that value.
//
// Optional: FACEBOOK_HANDLE — username shown after facebook.com/ in post URLs.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");

// Token cache directory. Defaults to backend/data/, but can be overridden
// via SCOOP_PERSISTENT_DATA_DIR — point that at a path OUTSIDE the deploy
// directory (e.g. ~/.scoopfeeds-data) so the cached page token survives
// Hostinger redeploys that wipe untracked files. See backend/start.js for
// the matching env-file persistence pattern.
const PERSIST_DIR = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
  : path.join(BACKEND_ROOT, "data");
const TOKEN_PATH = path.join(PERSIST_DIR, "facebook-token.json");

// v19.0 was released 2024-01-23 and EXPIRED 2026-05-21. Meta does not hard-fail
// an expired version — it silently routes the call to the oldest version still
// live, so behaviour can change under us with no code change and no error. That
// is the failure mode this pin exists to prevent, so it has to be maintained:
// current is v26.0 (2026-07-29), and versions live roughly two years.
const API_BASE = "https://graph.facebook.com/v26.0";

// Graph enforces Business Use Case limits per Page: 4800 × engaged users per
// rolling 24h, signalled by error 80001 and, on EVERY response, this header.
// Logged rather than parsed: at a dozen posts a day the limit is nowhere near
// binding, so the value of the number is that it is visible in the logs BEFORE
// the day it matters, not that anything branches on it.
function _logBucUsage(res, label) {
  const raw = res.headers?.get?.("x-business-use-case-usage");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    for (const entries of Object.values(parsed)) {
      for (const e of entries || []) {
        const pct = Math.max(e.call_count || 0, e.total_time || 0, e.total_cputime || 0);
        const line =
          `📘 FB usage ${label}: calls ${e.call_count ?? "?"}% time ${e.total_time ?? "?"}% ` +
          `cpu ${e.total_cputime ?? "?"}%` +
          (e.estimated_time_to_regain_access ? ` · THROTTLED, ${e.estimated_time_to_regain_access}m to regain` : "");
        // 75% is the point at which a day's growth would reach the limit; below
        // that it is background telemetry and does not deserve a warning.
        if (pct >= 75 || e.estimated_time_to_regain_access) logger.warn(line);
        else logger.info(line);
      }
    }
  } catch {
    logger.info(`📘 FB usage ${label}: ${String(raw).slice(0, 200)}`);
  }
}

// Read env vars lazily so they work whether loaded by backend/.env (via
// start.js pre-loader or server.js body) or set at the process level.
const getEnvPageToken = () => process.env.FACEBOOK_PAGE_TOKEN || "";
const getEnvPageId    = () => process.env.FACEBOOK_PAGE_ID    || "";

// In-memory cache. Shape: { pageToken, pageId }
let cached = null;

export function isFacebookConfigured() {
  return Boolean((getEnvPageToken() || _readDiskToken()?.pageToken) && getEnvPageId());
}

function _readDiskToken() {
  try {
    if (!existsSync(TOKEN_PATH)) return null;
    const raw = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
    if (raw?.pageToken) return raw;
  } catch (e) {
    logger.warn(`facebookClient: token file unreadable: ${e.message}`);
  }
  return null;
}

function _writeDiskToken(data) {
  try {
    const dir = path.dirname(TOKEN_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(TOKEN_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch (e) {
    logger.warn(`facebookClient: failed to persist token: ${e.message}`);
  }
}

function _loadToken() {
  if (cached) return cached;
  const onDisk = _readDiskToken();
  if (onDisk) { cached = onDisk; return cached; }
  const tok = getEnvPageToken();
  const pid = getEnvPageId();
  if (tok && pid) {
    cached = { pageToken: tok, pageId: pid };
    _writeDiskToken(cached);
    return cached;
  }
  return null;
}

async function _call(pathPart, { method = "GET", params = {}, formData } = {}) {
  const t = _loadToken();
  if (!t) throw new Error("facebook not configured");
  const qs = new URLSearchParams({ ...params, access_token: t.pageToken });
  const url = `${API_BASE}${pathPart}?${qs.toString()}`;
  const init = { method };
  if (formData) {
    init.body = formData;
  }
  const res = await fetch(url, init);
  _logBucUsage(res, pathPart);
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) {
    const msg = json?.error?.message || text || "unknown";
    const err = new Error(`facebook ${pathPart} → ${res.status} ${msg}`);
    err.statusCode = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// Post a photo from a public URL with a caption. Returns { id, postUrl }.
// This gives better reach than a plain link post and uses our branded OG card.
async function _postPhoto({ imageUrl, caption }) {
  const t = _loadToken();
  if (!t) throw new Error("facebook not configured");
  const res = await _call(`/${t.pageId}/photos`, {
    method: "POST",
    params: { url: imageUrl, caption, published: "true" },
  });
  if (!res?.id) throw new Error(`facebook photo post returned no id: ${JSON.stringify(res).slice(0, 200)}`);
  // res.id is "{page-id}_{object-id}"; post_id may also be present.
  const postId = res.post_id || res.id;
  const postUrl = `https://www.facebook.com/${t.pageId}/posts/${postId.split("_").pop()}`;
  return { id: postId, url: postUrl };
}

// Upload an in-memory image buffer (multipart/form-data) instead of giving
// Facebook a URL. Far more reliable than _postPhoto because:
//   - No dependency on FB's URL fetcher (which can timeout, follow redirects
//     incorrectly, or get blocked by edge caches between FB → our origin)
//   - Works even when the public card URL is on cold cache (every redeploy
//     wipes the disk-rendered cards on Hostinger; first FB fetch after deploy
//     would trigger a fresh render and FB would frequently time out)
//   - We already have the bytes in memory after ensureCard() — zero extra cost
async function _postPhotoBuffer({ buffer, caption, contentType = "image/png" }) {
  const t = _loadToken();
  if (!t) throw new Error("facebook not configured");
  const fd = new FormData();
  // Node 18+ ships globalThis.Blob — wrap the Node Buffer for multipart upload.
  fd.append("source", new Blob([buffer], { type: contentType }), "card.png");
  fd.append("caption", caption);
  fd.append("published", "true");
  fd.append("access_token", t.pageToken);
  const res = await fetch(`${API_BASE}/${t.pageId}/photos`, { method: "POST", body: fd });
  _logBucUsage(res, "/photos");
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) {
    const msg = json?.error?.message || text || "unknown";
    const err = new Error(`facebook /photos (multipart) → ${res.status} ${msg}`);
    err.statusCode = res.status;
    err.body = json;
    throw err;
  }
  if (!json?.id) throw new Error(`facebook multipart photo post returned no id: ${JSON.stringify(json).slice(0, 200)}`);
  const postId  = json.post_id || json.id;
  const postUrl = `https://www.facebook.com/${t.pageId}/posts/${postId.split("_").pop()}`;
  return { id: postId, url: postUrl };
}

// Fallback: plain link post (no image). Used if the image URL is not available.
async function _postLink({ message, link }) {
  const t = _loadToken();
  if (!t) throw new Error("facebook not configured");
  const res = await _call(`/${t.pageId}/feed`, {
    method: "POST",
    params: { message, link },
  });
  if (!res?.id) throw new Error(`facebook link post returned no id: ${JSON.stringify(res).slice(0, 200)}`);
  const postUrl = `https://www.facebook.com/${res.id.replace("_", "/posts/")}`;
  return { id: res.id, url: postUrl };
}

// ─── Page-feed video (the autopost cross-post) ────────────────────────────────
//
// POST /{page-id}/videos with the MP4 as multipart `source` — a NATIVE video
// post on the page's feed. Not a link share: Facebook demotes posts whose
// payload is a YouTube URL, which is the entire reason this exists. Not a Reel
// either: /video_reels is vertical short-form and these renders are 1920×1080,
// so posting them there would need a second, vertical render path.
//
// Permissions on the page token: pages_manage_posts, pages_read_engagement AND
// pages_show_list. The third is easy to miss — the setup notes at the top of
// this file predate it — and its absence shows up as an OAuthException at
// upload time rather than at token-mint time.
//
// NO FALLBACK, DELIBERATELY. Every other function in this file degrades: photo
// → photo-by-URL → link post. postReelToFacebook does the same, which means a
// "success" from it may well be the suppressed link share we were avoiding, and
// is why there is no evidence in social_posts that it ever uploaded a video. A
// failure here is a failure. The caller records it and moves on; nothing is
// salvaged into a worse post.
//
// Single-request upload, not the Resumable Upload API. Meta's publishing guide
// leads with resumable (POST /{app-id}/uploads → POST /upload:{session}), which
// exists for large files; measured renders from this pipeline are ~1.9 MB. The
// guard below is what makes that assumption fail loudly instead of turning into
// a mysterious 400 if renders ever grow by two orders of magnitude.
// parseFloat and an explicit finite/non-negative check, not `parseInt(...) || default`:
// that idiom silently turns both `0.5` (parses to 0) and a deliberate `0` into
// the default, so the one setting an operator would reach for to clamp this
// hard is the one that does nothing.
const FB_VIDEO_MAX_BYTES = (() => {
  const raw = process.env.FACEBOOK_VIDEO_MAX_MB;
  const n = raw === undefined || raw === "" ? NaN : Number.parseFloat(raw);
  return Math.round((Number.isFinite(n) && n >= 0 ? n : 200) * 1048576);
})();

const FB_VIDEO_TIMEOUT_MS =
  Number.parseInt(process.env.FACEBOOK_VIDEO_TIMEOUT_MS || "", 10) || 120_000;

/**
 * Upload an MP4 as a native page video post. Returns { id, url }.
 * Throws on anything less than a published video.
 *
 * @param {{ filePath: string, title?: string, description?: string }} args
 */
export async function postVideoToFacebook({ filePath, title = "", description = "" }) {
  const t = _loadToken();
  if (!t) throw new Error("facebook not configured");
  if (!filePath) throw new Error("postVideoToFacebook: filePath is required");
  if (!existsSync(filePath)) throw new Error(`postVideoToFacebook: file not found: ${filePath}`);

  const bytes = readFileSync(filePath);
  if (bytes.length < 10_000) {
    throw new Error(`postVideoToFacebook: implausibly small MP4 (${bytes.length} bytes): ${filePath}`);
  }
  if (bytes.length > FB_VIDEO_MAX_BYTES) {
    throw new Error(
      `postVideoToFacebook: ${(bytes.length / 1048576).toFixed(1)} MB exceeds the ` +
      `${(FB_VIDEO_MAX_BYTES / 1048576).toFixed(0)} MB single-request ceiling. Renders were ~2 MB when ` +
      `this path was written; at this size it needs Meta's Resumable Upload API ` +
      `(POST /{app-id}/uploads), not a bigger ceiling.`
    );
  }

  const fd = new FormData();
  fd.append("source", new Blob([bytes], { type: "video/mp4" }), path.basename(filePath));
  if (title) fd.append("title", title);
  if (description) fd.append("description", description);
  fd.append("published", "true");
  fd.append("access_token", t.pageToken);

  // fetch() has no default timeout. Without this a stalled upload holds the
  // render cycle open until the 60-minute hang guard notices, and the cycle is
  // the thing that publishes the NEXT video.
  const res = await fetch(`${API_BASE}/${t.pageId}/videos`, {
    method: "POST",
    body: fd,
    signal: AbortSignal.timeout(FB_VIDEO_TIMEOUT_MS),
  });
  _logBucUsage(res, "/videos");

  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) {
    const msg = json?.error?.message || text || "unknown";
    const err = new Error(`facebook /videos → ${res.status} ${msg}`);
    err.statusCode = res.status;
    err.body = json;
    throw err;
  }
  if (!json?.id) {
    throw new Error(`facebook /videos returned no id: ${JSON.stringify(json).slice(0, 200)}`);
  }

  const url = `https://www.facebook.com/${t.pageId}/videos/${json.id}`;
  logger.info(`📘 Facebook page video published: ${json.id} (${(bytes.length / 1048576).toFixed(1)} MB)`);
  return { id: json.id, url };
}

// ─── Facebook Reels ───────────────────────────────────────────────────────────
// Uploads a short-form video as a Facebook Reel.
//
// Flow (server-upload variant):
//   1. POST /{page-id}/video_reels?upload_phase=start  → { video_id, upload_url }
//   2. POST {upload_url} with raw MP4 bytes             → HTTP 200
//   3. POST /{page-id}/video_reels?upload_phase=finish  → success object
//
// Required: same FACEBOOK_PAGE_TOKEN + FACEBOOK_PAGE_ID as image posts.
// The video must be H.264 MP4 (9:16 preferred), ≤ 90s.
//
// If the upload_phase API is unavailable (requires business verification in some
// regions), we fall back to posting via `link` (sharing the public video URL as
// a standard feed post) rather than throwing.
export async function postReelToFacebook({ filePath, videoUrl, caption = "" }) {
  const t = _loadToken();
  if (!t) throw new Error("facebook not configured");

  // We need raw bytes to do a server-side upload. If the caller passes only
  // a videoUrl (public link) and no filePath, fall back to a plain link post.
  const { readFileSync, existsSync } = await import("fs");
  let bytes = null;
  if (filePath) {
    try {
      if (!existsSync(filePath)) throw new Error(`file not found: ${filePath}`);
      bytes = readFileSync(filePath);
    } catch (err) {
      logger.warn(`facebookClient: could not read reel file (${err.message}), will use link fallback`);
    }
  }

  if (bytes) {
    try {
      // Step 1: initialise the upload session.
      const init = await _call(`/${t.pageId}/video_reels`, {
        method: "POST",
        params: {
          upload_phase:  "start",
          file_size:     String(bytes.length),
        },
      });
      if (!init?.video_id || !init?.upload_url) {
        throw new Error(`FB reels start missing video_id/upload_url: ${JSON.stringify(init).slice(0, 200)}`);
      }

      // Step 2: upload raw MP4 bytes.
      const upRes = await fetch(init.upload_url, {
        method:  "POST",
        headers: {
          "Authorization": `OAuth ${t.pageToken}`,
          "offset":        "0",
          "file_size":     String(bytes.length),
          "Content-Type":  "application/octet-stream",
        },
        body: bytes,
      });
      if (!upRes.ok) {
        const errTxt = await upRes.text().catch(() => "");
        throw new Error(`FB reels upload → ${upRes.status}: ${errTxt.slice(0, 200)}`);
      }

      // Step 3: finalise and publish.
      const finish = await _call(`/${t.pageId}/video_reels`, {
        method: "POST",
        params: {
          upload_phase:  "finish",
          video_id:      init.video_id,
          video_state:   "PUBLISHED",
          description:   caption,
        },
      });

      const postUrl = `https://www.facebook.com/reel/${init.video_id}`;
      logger.info(`📘 Facebook Reel published: ${init.video_id}`);
      return { id: init.video_id, url: postUrl };

    } catch (err) {
      logger.warn(`facebookClient: Reel binary upload failed (${err.message}), falling back to link post`);
    }
  }

  // Fallback: plain link post with the video URL.
  const msg = caption + (videoUrl ? `\n\n${videoUrl}` : "");
  return await _postLink({ message: msg, link: videoUrl || "" });
}

// Update the stored page token (call after a manual token refresh).
// Clears the in-memory cache so the very next post uses the new token.
export function updateStoredFbToken(pageToken, pageId) {
  cached = null;
  _writeDiskToken({ pageToken, pageId: pageId || getEnvPageId() });
  cached = { pageToken, pageId: pageId || getEnvPageId() }; // pre-warm
  logger.info("facebookClient: stored page token updated");
}

// Public API: post text + optional image (buffer preferred; URL as fallback).
// Strategy:
//   1. If imageBuffer is provided → upload bytes directly (most reliable).
//   2. Else if imageUrl is provided → tell FB to fetch the URL.
//   3. Either of the photo paths failing → fall back to a plain link post.
// Returns { id, url }.
export async function postToFacebook({ text, imageBuffer, imageUrl, link }) {
  if (!_loadToken()) throw new Error("facebook not configured");
  if (imageBuffer) {
    try {
      return await _postPhotoBuffer({ buffer: imageBuffer, caption: text });
    } catch (err) {
      logger.warn(`facebookClient: multipart photo upload failed (${err.message}), trying URL`);
    }
  }
  if (imageUrl) {
    try {
      return await _postPhoto({ imageUrl, caption: text });
    } catch (err) {
      logger.warn(`facebookClient: URL photo post failed (${err.message}), falling back to link post`);
    }
  }
  return await _postLink({ message: text, link });
}
