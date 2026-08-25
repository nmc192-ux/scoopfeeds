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
import { withNetworkRetry, fetchTimeout } from "./httpRetry.js";

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
  // Retry a dropped connection; never retry an answer the server gave.
  const res = await withNetworkRetry(() => fetch(url, { ...init, signal: fetchTimeout() }), { label: `threads ${pathPart}` });
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

/**
 * TWO SURFACES, TWO BUDGETS — deliberately not one default with a call-site
 * override (DrJ, 2026-08-16).
 *
 * The video path used to call waitForFinished() with no arguments, so it ran on
 * the IMAGE path's stopwatch: 8 x 1500ms = 12000ms, sized by the comment "most
 * posts go FINISHED within 1-2 seconds" — true of a container fetching a JPEG,
 * false of one fetching AND TRANSCODING an MP4. Every Threads video failed
 * "container not ready after 12000ms".
 *
 * Passing `maxAttempts` at the video call site would fix today and leave the
 * trap: one stopwatch still serving two surfaces with different physics, and the
 * next person tuning images would move video without knowing. This codebase has
 * had that exact shape before — MAX_ATTEMPTS sized both the spec budget and the
 * candidate pool, so widening the editorial sample silently widened the spend.
 * The fix there was to split the budgets and name them, and it is the fix here.
 *
 * THE VIDEO CEILING IS A GUESS, AND THE LOG IS HOW IT STOPS BEING ONE. Nobody
 * has measured what Meta actually takes, because the poll never once succeeded.
 * 120s is deliberately generous; waitForFinished logs the elapsed time on
 * success, so the next few videos report the real distribution and the number
 * can be narrowed from data rather than from another guess.
 *
 * The image budget is UNCHANGED at 8 x 1500. That is the point of splitting.
 */
const intEnv = (name, fallback, min) => {
  const raw = process.env[name];
  // No `parseInt(x) || fallback` — that reads a deliberate 0 as absent.
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) {
    logger.warn(`🧵 ${name}="${raw}" is not an integer >= ${min} — using ${fallback}`);
    return fallback;
  }
  return n;
};

export const THREADS_IMAGE_POLL = () => ({
  label: "image",
  maxAttempts: intEnv("THREADS_IMAGE_POLL_ATTEMPTS", 8, 1),
  gapMs: intEnv("THREADS_IMAGE_POLL_GAP_MS", 1500, 0),
  attemptsVar: "THREADS_IMAGE_POLL_ATTEMPTS",
});

export const THREADS_VIDEO_POLL = () => ({
  label: "video",
  maxAttempts: intEnv("THREADS_VIDEO_POLL_ATTEMPTS", 24, 1),
  // A slower cadence as well as a longer ceiling: 24 x 5s reaches 120s in 24
  // calls, where the image gap would need 80 to cover the same window.
  gapMs: intEnv("THREADS_VIDEO_POLL_GAP_MS", 5000, 0),
  attemptsVar: "THREADS_VIDEO_POLL_ATTEMPTS",
});

// Two-step publish: create container → poll status (FINISHED) → publish.
// The budget is passed in by the caller — there is no default, so a new surface
// has to state which physics it has rather than inheriting another's.
async function waitForFinished(creationId, budget) {
  const { maxAttempts, gapMs, label, attemptsVar } = budget;
  const t0 = Date.now();
  for (let i = 0; i < maxAttempts; i++) {
    const out = await call(`/${creationId}`, { params: { fields: "status,error_message" } });
    // Threads API returns `status`; some older docs called it `status_code` — handle both.
    const s = out.status || out.status_code;
    if (s === "FINISHED") {
      // THE MEASUREMENT. The ceiling above was chosen with no data because the
      // video poll had never succeeded; this line is what replaces the guess.
      logger.info(
        `🧵 threads ${label} container ${creationId} FINISHED after ${Date.now() - t0}ms ` +
        `(attempt ${i + 1}/${maxAttempts}, ceiling ${maxAttempts * gapMs}ms)`
      );
      return true;
    }
    if (s === "ERROR" || s === "EXPIRED") {
      const detail = out.error_message ? ` (${out.error_message})` : "";
      throw new Error(`threads container ${creationId} → ${s}${detail}`);
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
  // Name the budget AND the var that raises it: a timeout that does not say
  // which stopwatch ran is the operational form of a check the prompt never
  // names — the reader cannot act on it without going to the source.
  throw new Error(
    `threads ${label} container ${creationId} not ready after ${maxAttempts * gapMs}ms ` +
    `(${maxAttempts} attempts x ${gapMs}ms — raise ${attemptsVar}). ` +
    `The container may still finish server-side; this gave up waiting.`
  );
}

// Public: post text + (optional) external image URL. Returns { id, url }.
/**
 * THREADS' MANDATORY WAIT BEFORE PUBLISH. Default 30s.
 *
 * Meta's guidance for the Threads publishing flow is to wait ~30 seconds after
 * creating a container before calling threads_publish, so the server has time to
 * fetch and process the media. This is NOT the same thing as polling status:
 * the container can report a usable state and still fail to publish if called
 * immediately, which is why the wait is unconditional rather than a fallback for
 * a slow poll.
 *
 * It is also why the render cycle needed a 10-minute BullMQ lock before this
 * channel could be added — 30 seconds of deliberate sleep inside a job that was
 * losing a 30-second lock is the collision that fix removed.
 */
export const THREADS_VIDEO_WAIT_MS = () =>
  Number.parseInt(process.env.THREADS_VIDEO_WAIT_MS || "", 10) || 30_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Post a VIDEO to Threads.
 *
 * A URL-FETCH SURFACE: Threads does not accept direct file uploads, so the MP4
 * must already be reachable at a public HTTPS URL that survives long enough for
 * Meta to fetch it. The caller owns that lifetime — see the sweep hold in
 * videoArtifacts.
 *
 * NO FALLBACK TO A TEXT POST. The obvious degrade — drop to `media_type: TEXT`
 * with the link in the body — would return an id and a URL indistinguishable at
 * the call site from a published video, which is the same failure that was
 * removed from postReelToFacebook on 2026-08-13. Every path here publishes a
 * video or throws with the reason.
 */
export async function postVideoToThreads({ text, videoUrl }) {
  const t = loadToken();
  if (!t || !t.userId) throw new Error("threads not configured");
  if (!videoUrl) throw new Error("postVideoToThreads requires a videoUrl — there is no upload path");

  const create = await call(`/${t.userId}/threads`, {
    method: "POST",
    params: { media_type: "VIDEO", video_url: videoUrl, text },
  });
  if (!create?.id) {
    throw new Error(`threads video container returned no id: ${JSON.stringify(create).slice(0, 200)}`);
  }

  // Poll first — cheap, and it surfaces a fetch failure with a real reason
  // rather than as a bare publish error half a minute later. THE VIDEO BUDGET,
  // stated explicitly: this call site used to take the image default and that is
  // what made every Threads video fail at 12s.
  await waitForFinished(create.id, THREADS_VIDEO_POLL());

  // THEN the mandatory wait, on top of the poll. See THREADS_VIDEO_WAIT_MS.
  const waitMs = THREADS_VIDEO_WAIT_MS();
  logger.info(`🧵 threads video container ${create.id} ready — waiting ${waitMs}ms before publish`);
  await sleep(waitMs);

  const publish = await call(`/${t.userId}/threads_publish`, {
    method: "POST",
    params: { creation_id: create.id },
  });
  if (!publish?.id) {
    throw new Error(`threads video publish returned no id: ${JSON.stringify(publish).slice(0, 200)}`);
  }

  const url = `https://www.threads.net/@${process.env.THREADS_HANDLE || ""}/post/${publish.id}`;
  logger.info(`🧵 Threads video published: ${publish.id} — ${url}`);
  return { id: publish.id, url };
}

export async function postToThreads({ text, imageUrl }) {
  const t = loadToken();
  if (!t || !t.userId) throw new Error("threads not configured");
  const params = imageUrl
    ? { media_type: "IMAGE", image_url: imageUrl, text }
    : { media_type: "TEXT", text };

  const create = await call(`/${t.userId}/threads`, { method: "POST", params });
  if (!create?.id) throw new Error(`threads container creation returned no id: ${JSON.stringify(create).slice(0, 200)}`);

  // The image budget, unchanged at 8 x 1500ms. Splitting the two is what stops
  // a future video tune from moving this one.
  await waitForFinished(create.id, THREADS_IMAGE_POLL());

  const publish = await call(`/${t.userId}/threads_publish`, { method: "POST", params: { creation_id: create.id } });
  if (!publish?.id) throw new Error(`threads publish returned no id: ${JSON.stringify(publish).slice(0, 200)}`);

  // Threads currently doesn't expose a clean public-permalink endpoint in v1.
  // Best effort: construct a /post/<media_id> URL — the front-end resolves
  // it correctly even though docs are sparse on the canonical shape.
  const url = `https://www.threads.net/@${process.env.THREADS_HANDLE || ""}/post/${publish.id}`;
  return { id: publish.id, url };
}
