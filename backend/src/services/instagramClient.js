// Instagram Graph API client (Business / Creator account flow).
//
// Posts a feed image with caption to a connected IG Business account.
// Uses the same two-step container → publish pattern as Threads:
//   1. POST /{ig-user-id}/media         { image_url, caption } → creation_id
//   2. Poll  /{creation_id}             until status_code = FINISHED
//   3. POST /{ig-user-id}/media_publish { creation_id }        → media_id
//
// Auth model:
//   IG Business is always connected to a Facebook Page, and the Page Access
//   Token (the same one used by facebookClient.js) is what authorises IG
//   posts. We default to FACEBOOK_PAGE_TOKEN to avoid making the user
//   maintain two tokens, but allow INSTAGRAM_ACCESS_TOKEN to override if a
//   different token is preferred (e.g. a separate dev/test account).
//
// Required env vars:
//   INSTAGRAM_USER_ID         — numeric IG Business account ID
//                              (in Meta Business Suite → Settings → Accounts)
//   FACEBOOK_PAGE_TOKEN       — reused as the IG access token by default
//   (optional) INSTAGRAM_ACCESS_TOKEN — override the default token if needed
//   (optional) INSTAGRAM_HANDLE — public username, used to construct post URLs
//
// Setup checklist (one-time, ~5 min):
//   1. Convert your IG account to Business / Creator (free, in IG app)
//   2. Connect IG Business to your Facebook Page in Meta Business Suite
//   3. Find your IG User ID — easiest path:
//        GET https://graph.facebook.com/v19.0/me/accounts?access_token={page-token}
//        → finds your Page → it has connected_instagram_account.id
//   4. Set INSTAGRAM_USER_ID in the Hostinger env panel.
//   5. Restart Node app — the auto-poster picks IG up on the next cron tick.
//
// Image requirements:
//   - JPEG (PNG works in practice but Meta docs say JPEG-preferred)
//   - Public URL Meta can fetch (we use /api/cards/og/<id>.png — that's PNG;
//     Meta consistently accepts it. Switch to a JPEG card if it ever stops.)
//   - Aspect ratio: 4:5 to 1.91:1. 1080x1080 (square) is the safest choice.
//   - Max size 8MB.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");

// Persist alongside the other social tokens so a redeploy doesn't blow it away.
const PERSIST_DIR = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
  : path.join(BACKEND_ROOT, "data");
const TOKEN_PATH = path.join(PERSIST_DIR, "instagram-token.json");

const API_BASE = "https://graph.facebook.com/v19.0";

// Lazy getters — read at call time so backend/.env loaded by start.js or
// server.js body is visible. .trim() because env values copy-pasted from a
// panel UI often pick up whitespace that silently kills auth.
const getEnvToken  = () => (process.env.INSTAGRAM_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_TOKEN || "").trim();
const getUserId    = () => (process.env.INSTAGRAM_USER_ID || "").trim();
const getHandle    = () => (process.env.INSTAGRAM_HANDLE || "").trim();

// Cache shape: { accessToken, userId }
let cached = null;

export function isInstagramConfigured() {
  return Boolean(getEnvToken() && getUserId());
}

function _readDiskToken() {
  try {
    if (!existsSync(TOKEN_PATH)) return null;
    const raw = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
    if (raw?.accessToken && raw?.userId) return raw;
  } catch (e) {
    logger.warn(`instagramClient: token file unreadable: ${e.message}`);
  }
  return null;
}

function _writeDiskToken(data) {
  try {
    if (!existsSync(PERSIST_DIR)) mkdirSync(PERSIST_DIR, { recursive: true });
    writeFileSync(TOKEN_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch (e) {
    logger.warn(`instagramClient: failed to persist token: ${e.message}`);
  }
}

function _loadToken() {
  if (cached) return cached;
  const onDisk = _readDiskToken();
  // Trust env over disk so rotating the Page token via Hostinger panel
  // takes effect on next restart without wiping the cache file by hand.
  const envTok = getEnvToken();
  const envUid = getUserId();
  if (envTok && envUid) {
    cached = { accessToken: envTok, userId: envUid };
    _writeDiskToken(cached);
    return cached;
  }
  if (onDisk) { cached = onDisk; return cached; }
  return null;
}

async function _call(pathPart, { method = "GET", params = {} } = {}) {
  const t = _loadToken();
  if (!t) throw new Error("instagram not configured");
  const qs = new URLSearchParams({ ...params, access_token: t.accessToken });
  const url = `${API_BASE}${pathPart}?${qs.toString()}`;
  const res = await fetch(url, { method });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) {
    const msg = json?.error?.message || text || "unknown";
    const err = new Error(`instagram ${pathPart} → ${res.status} ${msg}`);
    err.statusCode = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// Container creation can come back PUBLISHED already on small images, but
// most need 1-3s of processing on Meta's side. We poll until FINISHED with
// a generous-but-bounded budget so a slow status doesn't hang the cron.
async function _waitForFinished(creationId, { maxAttempts = 10, gapMs = 1500 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    const out = await _call(`/${creationId}`, { params: { fields: "status_code" } });
    if (out.status_code === "FINISHED") return true;
    if (out.status_code === "ERROR" || out.status_code === "EXPIRED") {
      throw new Error(`instagram container ${creationId} → ${out.status_code}`);
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
  throw new Error(`instagram container ${creationId} not ready after ${maxAttempts * gapMs}ms`);
}

// ─── Reels (video) upload ────────────────────────────────────────────────────
// Post a short-form video (Reel) to Instagram. Meta must be able to GET the
// video from `videoUrl` server-side — so the URL must be publicly reachable.
// We use: https://scoopfeeds.com/scoop-ops/videos-gen/file/{articleId}
//
// Notes:
//   - Video must be H.264 MP4, ≤ 60s, ≥ 720p, 9:16 aspect ratio preferred.
//   - Processing takes 30–120s — we poll with a generous budget.
//   - `share_to_feed: true` also shows the Reel in the IG grid (recommended).
//   - After publish, permalink lookup gives the final URL.
//
// Required env (same as image posts):
//   INSTAGRAM_USER_ID + FACEBOOK_PAGE_TOKEN (or INSTAGRAM_ACCESS_TOKEN)
export async function postReelToInstagram({ videoUrl, caption = "" }) {
  const t = _loadToken();
  if (!t) throw new Error("instagram not configured");
  if (!videoUrl) throw new Error("postReelToInstagram requires a videoUrl");

  // Step 1: create the media container for the Reel.
  const create = await _call(`/${t.userId}/media`, {
    method: "POST",
    params: {
      media_type:    "REELS",
      video_url:     videoUrl,
      caption,
      share_to_feed: "true",   // also show in main IG feed
      thumb_offset:  "1000",   // ms offset for auto-generated thumbnail
    },
  });
  if (!create?.id) {
    throw new Error(`instagram reel container creation returned no id: ${JSON.stringify(create).slice(0, 200)}`);
  }

  // Step 2: wait for Meta to download + transcode the video.
  // Reels take significantly longer than images — poll with a 5s gap, up to 3 min.
  await _waitForFinished(create.id, { maxAttempts: 36, gapMs: 5000 });

  // Step 3: publish.
  const publish = await _call(`/${t.userId}/media_publish`, {
    method: "POST",
    params: { creation_id: create.id },
  });
  if (!publish?.id) {
    throw new Error(`instagram reel publish returned no id: ${JSON.stringify(publish).slice(0, 200)}`);
  }

  // Best-effort permalink.
  let url = "";
  const handle = getHandle();
  if (handle) {
    url = `https://www.instagram.com/reel/${publish.id}/`;
  } else {
    try {
      const lookup = await _call(`/${publish.id}`, { params: { fields: "permalink" } });
      url = lookup?.permalink || "";
    } catch {}
  }

  logger.info(`📸 Instagram Reel published: ${publish.id} — ${url}`);
  return { id: publish.id, url };
}

// Public: post a single image with caption. Returns { id, url }.
//   text     — caption text (max ~2200 chars; we leave that to the composer)
//   imageUrl — publicly fetchable URL (Meta needs to GET it server-side)
export async function postToInstagram({ text, imageUrl }) {
  const t = _loadToken();
  if (!t) throw new Error("instagram not configured");
  if (!imageUrl) throw new Error("instagram requires an image_url (no text-only posts)");

  // Step 1: create the media container.
  const create = await _call(`/${t.userId}/media`, {
    method: "POST",
    params: { image_url: imageUrl, caption: text || "" },
  });
  if (!create?.id) {
    throw new Error(`instagram container creation returned no id: ${JSON.stringify(create).slice(0, 200)}`);
  }

  // Step 2: wait for processing to finish (Meta downloads + scans the image).
  await _waitForFinished(create.id);

  // Step 3: publish.
  const publish = await _call(`/${t.userId}/media_publish`, {
    method: "POST",
    params: { creation_id: create.id },
  });
  if (!publish?.id) {
    throw new Error(`instagram publish returned no id: ${JSON.stringify(publish).slice(0, 200)}`);
  }

  // Best-effort permalink. Falls back to the IG Graph permalink lookup if
  // we don't know the handle.
  let url = "";
  const handle = getHandle();
  if (handle) {
    url = `https://www.instagram.com/${handle}/`;
  } else {
    try {
      const lookup = await _call(`/${publish.id}`, { params: { fields: "permalink" } });
      url = lookup?.permalink || "";
    } catch {
      url = "";
    }
  }
  return { id: publish.id, url };
}
