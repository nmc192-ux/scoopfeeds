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
//      (permissions needed: pages_manage_posts, pages_read_engagement)
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

const API_BASE = "https://graph.facebook.com/v19.0";

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
