// Minimal Threads Graph API client. Implements just the calls we need to
// publish a post with an image — the two-step container → publish flow
// described at developers.facebook.com/docs/threads/posts.
//
// Auth model:
//   - Threads uses a long-lived user access token (good for ~60 days).
//   - Meta provides a refresh endpoint that swaps it for another 60-day
//     token. We refresh proactively when < 7 days remain.
//   - Token + expiry persist to data/threads-token.json so restarts pick up
//     where we left off. This file is gitignored alongside vapid.json.
//
// Required env on first install:
//   THREADS_ACCESS_TOKEN  — long-lived user access token (initial bootstrap)
//   THREADS_USER_ID       — numeric Threads user id (returned by /me on token gen)
//
// Threads requires images to be reachable by URL — no binary upload. The
// publisher passes our /api/cards/og/<id>.png URL through.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const TOKEN_PATH = path.join(BACKEND_ROOT, "data", "threads-token.json");

// Lazy getters — read at call time so backend/.env loaded by server.js body is visible.
const getApiBase  = () => process.env.THREADS_API_BASE || "https://graph.threads.net/v1.0";
const getEnvToken = () => process.env.THREADS_ACCESS_TOKEN || "";
const getUserId   = () => process.env.THREADS_USER_ID || "";

// In-memory cache populated from disk on first call.
let cached = null; // { accessToken, expiresAt, userId }

export function isThreadsConfigured() {
  return Boolean((getEnvToken() || readDiskToken()) && getUserId());
}

function readDiskToken() {
  try {
    if (!existsSync(TOKEN_PATH)) return null;
    const raw = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
    if (raw?.accessToken) return raw;
  } catch (e) {
    logger.warn(`threadsClient: token file unreadable: ${e.message}`);
  }
  return null;
}

function writeDiskToken(token) {
  try {
    if (!existsSync(path.dirname(TOKEN_PATH))) mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), { mode: 0o600 });
  } catch (e) {
    logger.warn(`threadsClient: failed to persist token: ${e.message}`);
  }
}

function loadToken() {
  if (cached) return cached;
  const onDisk = readDiskToken();
  if (onDisk) { cached = onDisk; return cached; }
  const envTok = getEnvToken();
  if (envTok) {
    // Bootstrap: take the env token. We don't know the exact expiry so we
    // mark it as 50d out (Meta long-lived = 60d) and rely on refresh.
    cached = { accessToken: envTok, expiresAt: Date.now() + 50 * 24 * 60 * 60 * 1000, userId: getUserId() };
    writeDiskToken(cached);
    return cached;
  }
  return null;
}

// Refresh when < 7d remain. Threads endpoint: GET /refresh_access_token
//   ?grant_type=th_refresh_token&access_token=<current>
async function refreshIfNeeded() {
  const t = loadToken();
  if (!t) return null;
  const remaining = (t.expiresAt || 0) - Date.now();
  if (remaining > 7 * 24 * 60 * 60 * 1000) return t;

  try {
    const url = `${getApiBase().replace(/\/v1\.0$/, "")}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(t.accessToken)}`;
    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      logger.error(`threadsClient: refresh failed: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
      return t; // keep old token; let caller fail and surface auth error
    }
    cached = {
      accessToken: json.access_token,
      expiresAt: Date.now() + (Number(json.expires_in) || 60 * 24 * 60 * 60) * 1000,
      userId: t.userId,
    };
    writeDiskToken(cached);
    logger.info(`threadsClient: refreshed token (good for ${Math.floor((cached.expiresAt - Date.now()) / 86400000)}d)`);
    return cached;
  } catch (err) {
    logger.error(`threadsClient: refresh threw: ${err.message}`);
    return t;
  }
}

async function call(pathPart, { method = "GET", params = {}, body } = {}) {
  const t = await refreshIfNeeded();
  if (!t) throw new Error("threads not configured");
  const qs = new URLSearchParams({ ...params, access_token: t.accessToken });
  const url = `${getApiBase()}${pathPart}?${qs.toString()}`;
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) {
    const err = new Error(`threads ${pathPart} → ${res.status} ${json?.error?.message || text || "unknown"}`);
    err.statusCode = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// Two-step publish: create container → poll status (FINISHED) → publish.
// Most posts go FINISHED within 1-2 seconds. We cap polling at ~10s to
// avoid hanging the cron tail step.
async function waitForFinished(creationId, { maxAttempts = 8, gapMs = 1500 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    const out = await call(`/${creationId}`, { params: { fields: "status,error_message" } });
    // Threads API returns `status`; some older docs called it `status_code` — handle both.
    const s = out.status || out.status_code;
    if (s === "FINISHED") return true;
    if (s === "ERROR" || s === "EXPIRED") {
      const detail = out.error_message ? ` (${out.error_message})` : "";
      throw new Error(`threads container ${creationId} → ${s}${detail}`);
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
  throw new Error(`threads container ${creationId} not ready after ${maxAttempts * gapMs}ms`);
}

// Public: post text + (optional) external image URL. Returns { id, url }.
export async function postToThreads({ text, imageUrl }) {
  const t = loadToken();
  if (!t || !t.userId) throw new Error("threads not configured");
  const params = imageUrl
    ? { media_type: "IMAGE", image_url: imageUrl, text }
    : { media_type: "TEXT", text };

  const create = await call(`/${t.userId}/threads`, { method: "POST", params });
  if (!create?.id) throw new Error(`threads container creation returned no id: ${JSON.stringify(create).slice(0, 200)}`);

  await waitForFinished(create.id);

  const publish = await call(`/${t.userId}/threads_publish`, { method: "POST", params: { creation_id: create.id } });
  if (!publish?.id) throw new Error(`threads publish returned no id: ${JSON.stringify(publish).slice(0, 200)}`);

  // Threads currently doesn't expose a clean public-permalink endpoint in v1.
  // Best effort: construct a /post/<media_id> URL — the front-end resolves
  // it correctly even though docs are sparse on the canonical shape.
  const url = `https://www.threads.net/@${process.env.THREADS_HANDLE || ""}/post/${publish.id}`;
  return { id: publish.id, url };
}
