// YouTube Data API v3 client — video upload for Shorts.
//
// Required env vars:
//   YOUTUBE_CLIENT_ID      — OAuth2 client ID (Google Cloud Console)
//   YOUTUBE_CLIENT_SECRET  — OAuth2 client secret
//   YOUTUBE_REFRESH_TOKEN  — long-lived refresh token (one-time browser auth)
//
// Optional env vars:
//   YOUTUBE_PRIVACY        — "public" (default) | "unlisted" | "private"
//   YOUTUBE_CHANNEL_ID     — if absent, the API uses the authed account's default channel
//
// One-time setup (run locally, NOT on the server):
//   1. Go to Google Cloud Console → APIs & Services → Credentials
//   2. Create an "OAuth 2.0 Client ID" (Desktop App type)
//   3. Download the client_secret JSON → note client_id + client_secret
//   4. Enable "YouTube Data API v3" for the project
//   5. Run: node scripts/youtube-auth.mjs to get the refresh token
//   6. Set all three env vars in Hostinger → redeploy

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");

// Token cache — persist alongside other social tokens so a redeploy doesn't
// lose the access token mid-upload and force another refresh immediately.
const PERSIST_DIR  = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
  : path.join(BACKEND_ROOT, "data");
const TOKEN_PATH   = path.join(PERSIST_DIR, "youtube-token.json");

const TOKEN_URL   = "https://oauth2.googleapis.com/token";
const UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3/videos";
const API_BASE    = "https://www.googleapis.com/youtube/v3";

// Lazy getters so env vars read at call time (Hostinger injects them before
// the server starts, but hot-reload in dev populates them mid-process).
const getClientId     = () => (process.env.YOUTUBE_CLIENT_ID     || "").trim();
const getClientSecret = () => (process.env.YOUTUBE_CLIENT_SECRET || "").trim();
const getRefreshToken = () => (process.env.YOUTUBE_REFRESH_TOKEN || "").trim();
const getPrivacy      = () => (process.env.YOUTUBE_PRIVACY       || "public").trim();

export function isYouTubeConfigured() {
  return Boolean(getClientId() && getClientSecret() && getRefreshToken());
}

// ─── Token management ────────────────────────────────────────────────────────

let _cached = null; // { accessToken, expiresAt }

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
    logger.warn(`youtubeClient: failed to cache token: ${e.message}`);
  }
}

async function _getAccessToken() {
  const cached = _readCached();
  if (cached) return cached.accessToken;

  const res = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     getClientId(),
      client_secret: getClientSecret(),
      refresh_token: getRefreshToken(),
      grant_type:    "refresh_token",
    }).toString(),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    const msg = body.error_description || body.error || JSON.stringify(body).slice(0, 200);
    throw new Error(`YouTube token refresh failed: ${msg}`);
  }
  const tok = {
    accessToken: body.access_token,
    expiresAt:   Date.now() + (body.expires_in - 60) * 1000, // subtract 60s buffer
  };
  _writeCached(tok);
  return tok.accessToken;
}

// ─── Video upload ─────────────────────────────────────────────────────────────
//
// Uploads a local MP4 file to YouTube using the resumable upload protocol.
// Returns { videoId, videoUrl, title }.
//
// Params:
//   filePath    — absolute path to the .mp4 file
//   title       — video title (max 100 chars)
//   description — video description (max 5000 chars)
//   tags        — string[] (up to 500 chars total)
//   category    — numeric YouTube category ID (default 25 = News & Politics)
//   isShort     — if true, appends #Shorts to description
//
export async function uploadToYouTube({ filePath, title, description = "", tags = [], category = 25, isShort = true } = {}) {
  if (!isYouTubeConfigured()) throw new Error("YouTube not configured (YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN missing)");
  if (!filePath || !existsSync(filePath)) throw new Error(`YouTube upload: file not found at ${filePath}`);

  const accessToken = await _getAccessToken();
  const fileBytes   = readFileSync(filePath);
  const fileSizeBytes = fileBytes.length;

  // Truncate to API limits
  const cleanTitle = String(title || "Scoop News").replace(/[<>]/g, "").slice(0, 99);
  let cleanDesc = String(description || "").slice(0, 4900);
  if (isShort) cleanDesc = (cleanDesc + "\n\n#Shorts #News #BreakingNews").slice(0, 5000);

  const metadata = {
    snippet: {
      title:       cleanTitle,
      description: cleanDesc,
      tags:        tags.slice(0, 30).map(t => String(t).slice(0, 30)),
      categoryId:  String(category),
    },
    status: {
      privacyStatus:           getPrivacy(),
      selfDeclaredMadeForKids: false,
      // Required AI-generated content disclosure (YouTube policy since 2024).
      containsSyntheticMedia:  true,
    },
  };

  // Step 1: initiate resumable upload — tells YouTube the file size + metadata.
  const initRes = await fetch(
    `${UPLOAD_BASE}?uploadType=resumable&part=snippet,status`,
    {
      method:  "POST",
      headers: {
        "Authorization":       `Bearer ${accessToken}`,
        "Content-Type":        "application/json",
        "X-Upload-Content-Type":   "video/mp4",
        "X-Upload-Content-Length": String(fileSizeBytes),
      },
      body: JSON.stringify(metadata),
    }
  );
  if (!initRes.ok) {
    const errBody = await initRes.text().catch(() => "");
    throw new Error(`YouTube initiate upload ${initRes.status}: ${errBody.slice(0, 300)}`);
  }
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube initiate upload: no Location header in response");

  // Step 2: stream the file bytes to the upload URI.
  const uploadRes = await fetch(uploadUrl, {
    method:  "PUT",
    headers: {
      "Content-Type":   "video/mp4",
      "Content-Length": String(fileSizeBytes),
    },
    body: fileBytes,
  });
  const uploadBody = await uploadRes.json().catch(() => ({}));

  // 200 or 201 = success.
  if (uploadRes.status !== 200 && uploadRes.status !== 201) {
    const msg = uploadBody?.error?.message || JSON.stringify(uploadBody).slice(0, 300);
    throw new Error(`YouTube upload failed (${uploadRes.status}): ${msg}`);
  }

  const videoId  = uploadBody.id;
  if (!videoId) throw new Error("YouTube upload: response missing video ID");
  const videoUrl = `https://www.youtube.com/shorts/${videoId}`;

  logger.info(`📺 YouTube Shorts uploaded: ${videoId} — "${cleanTitle}"`);
  return { videoId, videoUrl, title: cleanTitle };
}

// ─── Channel info ─────────────────────────────────────────────────────────────

export async function getChannelInfo() {
  if (!isYouTubeConfigured()) return null;
  const accessToken = await _getAccessToken();
  const res = await fetch(`${API_BASE}/channels?part=snippet,statistics&mine=true`, {
    headers: { "Authorization": `Bearer ${accessToken}` },
  });
  const body = await res.json();
  const ch = body?.items?.[0];
  if (!ch) return null;
  return {
    channelId:    ch.id,
    title:        ch.snippet?.title,
    description:  ch.snippet?.description,
    customUrl:    ch.snippet?.customUrl,
    subscriberCount: ch.statistics?.subscriberCount,
    videoCount:   ch.statistics?.videoCount,
    viewCount:    ch.statistics?.viewCount,
  };
}
