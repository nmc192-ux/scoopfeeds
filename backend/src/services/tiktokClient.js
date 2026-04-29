// TikTok Content Posting API client — uploads short-form MP4 clips.
//
// Required env vars (after app approval + OAuth flow):
//   TIKTOK_CLIENT_KEY       — from TikTok Developer Portal → App → Key & Secret
//   TIKTOK_CLIENT_SECRET    — same location
//   TIKTOK_ACCESS_TOKEN     — OAuth2 access token (obtained via PKCE auth flow)
//   TIKTOK_OPEN_ID          — TikTok user's open_id (returned with the access token)
//
// Optional:
//   TIKTOK_REFRESH_TOKEN    — refresh token to rotate the access token automatically
//   TIKTOK_HANDLE           — public @handle, used to construct post URLs
//
// TikTok Content Posting API requires:
//   - App Review approval (submit at developers.tiktok.com → Apply for Product Access)
//   - Required permission scope: video.publish (+ video.upload for direct post)
//   - Creativity Program threshold for monetisation: 10k followers + 100k views/30d
//
// One-time setup (run locally):
//   1. Create an app at https://developers.tiktok.com
//   2. Add "Login Kit" + "Content Posting API" products
//   3. Submit for App Review (1–2 weeks)
//   4. Once approved, run: node scripts/tiktok-auth.mjs to get the access token
//   5. Set env vars in Hostinger and redeploy
//
// Upload flow (Direct Post):
//   1. POST /v2/post/publish/video/init/  — initialise, get upload URL + publish_id
//   2. PUT  <upload_url>                  — upload raw MP4 bytes
//   3. GET  /v2/post/publish/status/fetch/ — poll until status=PUBLISH_COMPLETE
//
// The simpler "Creator Post" (inbox-draft) uses SEND_TO_USER_INBOX which allows
// the creator to review before posting — we use DIRECT_POST for automation.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");

const PERSIST_DIR = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
  : path.join(BACKEND_ROOT, "data");
const TOKEN_PATH  = path.join(PERSIST_DIR, "tiktok-token.json");

const API_BASE = "https://open.tiktokapis.com";

const getClientKey    = () => (process.env.TIKTOK_CLIENT_KEY    || "").trim();
const getClientSecret = () => (process.env.TIKTOK_CLIENT_SECRET || "").trim();
const getAccessToken  = () => (process.env.TIKTOK_ACCESS_TOKEN  || "").trim();
const getRefreshToken = () => (process.env.TIKTOK_REFRESH_TOKEN || "").trim();
const getOpenId       = () => (process.env.TIKTOK_OPEN_ID       || "").trim();
const getHandle       = () => (process.env.TIKTOK_HANDLE        || "").trim();

export function isTikTokConfigured() {
  return Boolean(getClientKey() && getAccessToken() && getOpenId());
}

// ─── Token management ────────────────────────────────────────────────────────
// TikTok access tokens expire in 24h. We try to refresh via the refresh token
// (which lasts 365 days) before the access token expires.

let _cached = null;

function _readCached() {
  if (_cached) return _cached;
  try {
    if (!existsSync(TOKEN_PATH)) return null;
    const raw = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
    if (raw?.accessToken && raw?.expiresAt > Date.now() + 60_000) {
      _cached = raw;
      return raw;
    }
  } catch {}
  return null;
}

function _writeCached(tok) {
  _cached = tok;
  try {
    if (!existsSync(PERSIST_DIR)) mkdirSync(PERSIST_DIR, { recursive: true });
    writeFileSync(TOKEN_PATH, JSON.stringify(tok, null, 2), { mode: 0o600 });
  } catch (e) {
    logger.warn(`tiktokClient: failed to cache token: ${e.message}`);
  }
}

async function _refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error("TIKTOK_REFRESH_TOKEN not set — cannot refresh");

  const res = await fetch(`${API_BASE}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key:    getClientKey(),
      client_secret: getClientSecret(),
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  const body = await res.json();
  if (!res.ok || !body.data?.access_token) {
    throw new Error(`TikTok token refresh failed: ${body.message || JSON.stringify(body).slice(0, 200)}`);
  }
  const tok = {
    accessToken: body.data.access_token,
    expiresAt:   Date.now() + (body.data.expires_in - 60) * 1000,
    openId:      body.data.open_id || getOpenId(),
  };
  _writeCached(tok);
  return tok.accessToken;
}

async function _getAccessToken() {
  const cached = _readCached();
  if (cached) return cached.accessToken;
  // Env-set token: use as-is but cache it with a 23h TTL (safe default).
  const envTok = getAccessToken();
  if (envTok) {
    const tok = { accessToken: envTok, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
    _writeCached(tok);
    return envTok;
  }
  if (getRefreshToken()) return _refreshAccessToken();
  throw new Error("TikTok: no access token available");
}

// ─── Video upload ─────────────────────────────────────────────────────────────
//
// Uploads a local MP4 using TikTok's Direct Post API.
// Returns { publishId, videoId, videoUrl }.
//
export async function uploadToTikTok({ filePath, title, description = "", tags = [] } = {}) {
  if (!isTikTokConfigured()) throw new Error("TikTok not configured");
  if (!filePath || !existsSync(filePath)) throw new Error(`TikTok upload: file not found at ${filePath}`);

  const accessToken = await _getAccessToken();
  const fileBytes   = readFileSync(filePath);
  const fileSizeBytes = fileBytes.length;

  // Truncate to TikTok limits
  const cleanTitle = String(title || "Scoop News").slice(0, 90);
  const hashtags   = tags.slice(0, 10).map(t => `#${t.replace(/\s+/g, "").replace(/[^a-zA-Z0-9_]/g, "")}`).join(" ");
  const caption    = `${cleanTitle}\n\n${hashtags}\n\n#Shorts #News #BreakingNews`.slice(0, 2200);

  // Step 1: Initialise the upload + get an upload URL.
  const initRes = await fetch(`${API_BASE}/v2/post/publish/video/init/`, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type":  "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title:          caption,
        privacy_level:  "SELF_ONLY", // upload as private first; approve before making public
        disable_duet:   false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
        is_aigc_content: true, // AI-generated content disclosure (required)
      },
      source_info: {
        source:         "FILE_UPLOAD",
        video_size:     fileSizeBytes,
        chunk_size:     fileSizeBytes, // single-chunk upload (≤64MB)
        total_chunk_count: 1,
      },
    }),
  });

  const initBody = await initRes.json();
  if (!initRes.ok || initBody.error?.code !== "ok") {
    const msg = initBody.error?.message || JSON.stringify(initBody).slice(0, 300);
    throw new Error(`TikTok init upload (${initRes.status}): ${msg}`);
  }

  const publishId = initBody.data?.publish_id;
  const uploadUrl = initBody.data?.upload_url;
  if (!uploadUrl || !publishId) throw new Error("TikTok init upload: missing publish_id or upload_url");

  // Step 2: Upload the raw video bytes.
  const uploadRes = await fetch(uploadUrl, {
    method:  "PUT",
    headers: {
      "Content-Range": `bytes 0-${fileSizeBytes - 1}/${fileSizeBytes}`,
      "Content-Type":  "video/mp4",
    },
    body: fileBytes,
  });
  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "");
    throw new Error(`TikTok video upload (${uploadRes.status}): ${errText.slice(0, 300)}`);
  }

  // Step 3: Poll until publishing completes (usually 5-60s).
  const maxAttempts = 20;
  const gapMs = 5000;
  let videoId = null;
  for (let i = 0; i < maxAttempts; i++) {
    const pollRes = await fetch(`${API_BASE}/v2/post/publish/status/fetch/`, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type":  "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const pollBody = await pollRes.json();
    const status = pollBody.data?.status;

    if (status === "PUBLISH_COMPLETE") {
      videoId = pollBody.data?.publicaly_available_post_id?.[0] || null;
      break;
    }
    if (status === "FAILED" || (pollBody.error?.code && pollBody.error.code !== "ok")) {
      const msg = pollBody.data?.fail_reason || pollBody.error?.message || JSON.stringify(pollBody).slice(0, 300);
      throw new Error(`TikTok publish failed: ${msg}`);
    }
    await new Promise(r => setTimeout(r, gapMs));
  }

  const handle  = getHandle();
  const videoUrl = videoId && handle
    ? `https://www.tiktok.com/@${handle.replace(/^@/, "")}/video/${videoId}`
    : `https://www.tiktok.com/@${handle.replace(/^@/, "")}`;

  logger.info(`📱 TikTok uploaded: publishId=${publishId} videoId=${videoId} — "${cleanTitle}"`);
  return { publishId, videoId, videoUrl, title: cleanTitle };
}
