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
import { fetchTimeout } from "./httpRetry.js";
import { isTokenFresh } from "./tokenCache.js";

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

/**
 * CONFIGURED MEANS "CAN OBTAIN A TOKEN", NOT "ALREADY HOLDS ONE".
 *
 * This required TIKTOK_ACCESS_TOKEN and TIKTOK_OPEN_ID — neither of which is a
 * thing anyone sets, because this client MINTS an access token from the refresh
 * token and caches it. The result was a permanent "tiktok not configured" skip
 * on a correctly-credentialled account: the check asked for the output of the
 * step it was gating.
 *
 * Found in production after the channel was enabled: every video recorded
 * `tiktok_status='skipped'`, reason "tiktok not configured", with the client
 * key, secret and refresh token all present.
 *
 * The real precondition is the refresh triple. An access token or open id in
 * the environment still counts — some deployments pin them — but neither is
 * required.
 */
export function isTikTokConfigured() {
  const canMint = getClientKey() && getClientSecret() && getRefreshToken();
  const alreadyHas = getClientKey() && getAccessToken() && getOpenId();
  return Boolean(canMint || alreadyHas);
}

// ─── Token management ────────────────────────────────────────────────────────
// TikTok access tokens expire in 24h. We try to refresh via the refresh token
// (which lasts 365 days) before the access token expires.

let _cached = null;

function _readCached() {
  // Same fix as youtubeClient, same bug, found by auditing for the shape rather
  // than by anything failing: the in-memory hit ignored `expiresAt` while the
  // disk read checked it. TikTok access tokens last 24h (and the env-token path
  // below pins 23h), so a worker that outlives a day would have held a dead
  // token indefinitely. Latent only because nothing publishes here often enough
  // to have hit it yet.
  if (isTokenFresh(_cached)) return _cached;
  _cached = null;
  try {
    if (!existsSync(TOKEN_PATH)) return null;
    const raw = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
    if (isTokenFresh(raw)) {
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
    signal: fetchTimeout(),
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
  // FLAT, NOT WRAPPED. TikTok's v2 /oauth/token/ returns the token fields at the
  // top level: { access_token, expires_in, open_id, refresh_token, ... }. Only
  // v1 nested them under `data`, and this was written to the v1 shape — so a
  // PERFECTLY SUCCESSFUL refresh was read as a failure and thrown, with the
  // valid token printed inside the error message. Every TikTok post failed on
  // it. Both shapes are accepted now so a future move back is not another
  // outage.
  const d = body?.data?.access_token ? body.data : body;
  if (!res.ok || !d?.access_token) {
    throw new Error(`TikTok token refresh failed: ${body.message || body.error_description || JSON.stringify(body).slice(0, 200)}`);
  }
  const tok = {
    accessToken: d.access_token,
    expiresAt:   Date.now() + ((d.expires_in || 86400) - 60) * 1000,
    openId:      d.open_id || getOpenId(),
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
/**
 * THE PRIVACY LEVEL IS NOW A CHOICE, AND IT WAS NOT ALWAYS.
 *
 * This was hardcoded to SELF_ONLY with the note "upload as private first;
 * approve before making public". That was not caution — an unaudited client is
 * REFUSED any other value by TikTok (`unaudited_client_can_only_post_to_private
 * _accounts`), so the constant recorded a restriction rather than a decision.
 *
 * The app has since been approved: creator_info now returns
 * ["PUBLIC_TO_EVERYONE","MUTUAL_FOLLOW_FRIENDS","SELF_ONLY"] (verified live,
 * 2026-08-24). So the restriction is gone and the value becomes a real editorial
 * choice — which means it belongs in configuration, not in a literal.
 *
 * The DEFAULT STAYS SELF_ONLY. Nothing that has only ever posted privately
 * should start posting publicly because a constant became a variable.
 */
export const TIKTOK_PRIVACY_LEVELS = Object.freeze([
  "PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY",
]);

export function tiktokPrivacyLevel() {
  const v = String(process.env.VIDEO_TIKTOK_PRIVACY || "").trim().toUpperCase();
  // An unrecognised value falls back to the private default rather than being
  // passed through. A typo in an env var must not publish to everyone.
  return TIKTOK_PRIVACY_LEVELS.includes(v) ? v : "SELF_ONLY";
}

export async function uploadToTikTok({ filePath, title, description = "", tags = [], privacyLevel = tiktokPrivacyLevel() } = {}) {
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
    signal: fetchTimeout(),
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type":  "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title:          caption,
        privacy_level:  privacyLevel,
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
  // The bytes themselves get a longer budget than a JSON call.
  const uploadRes = await fetch(uploadUrl, {
    signal: fetchTimeout(5 * 60_000),
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
      signal: fetchTimeout(),
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
