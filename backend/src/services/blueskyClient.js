// Minimal Bluesky AT Protocol client — just the few endpoints we need to
// post a link card with a thumbnail. Auth is via env vars BLUESKY_HANDLE +
// BLUESKY_APP_PASSWORD; password should be an "app password" (created at
// bsky.app/settings/app-passwords), NEVER the account's main password.
//
// Session model (must avoid 429 RateLimitExceeded on createSession):
//   - Bluesky rate-limits createSession to ~30 per 5 min per account.
//   - Hostinger redeploys wipe in-memory state, so we MUST persist the
//     session to disk (data/bluesky-session.json) and prefer refreshSession
//     over a fresh createSession when possible.
//   - accessJwt expires ~2h, refreshJwt ~90d. Refresh is cheap and
//     rate-limited far more leniently than createSession.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");

// Token cache directory. Defaults to backend/data/, but can be overridden
// via SCOOP_PERSISTENT_DATA_DIR — point that at a path OUTSIDE the deploy
// directory (e.g. ~/.scoopfeeds-data) so the cached session survives
// Hostinger redeploys that wipe untracked files. Without this, every
// redeploy forces a fresh createSession against Bluesky's 30/5min limit.
const PERSIST_DIR = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
  : path.join(BACKEND_ROOT, "data");
const SESSION_PATH  = path.join(PERSIST_DIR, "bluesky-session.json");
const COOLDOWN_PATH = path.join(PERSIST_DIR, "bluesky-cooldown.json");

// Circuit-breaker: when createSession hits 429, persist a "do not try
// before" timestamp so subsequent cron ticks skip the call entirely.
//
// Cooldown strategy (exponential-ish, capped at 6 hours):
//   Bluesky's createSession is rate-limited at 30 calls / 5-minute
//   window per account. But even a single call per 30-min cron tick can
//   trigger persistent 429s if the account already has too many failed
//   attempts in its history window. Recovering requires giving the rate
//   limiter a LONG reset window — we back off by reading how many
//   consecutive 429s have occurred and doubling the cooldown each time.
//
// Retry schedule: 30 min → 2 h → 4 h → 6 h → 6 h → …
// After a successful createSession, the backoff counter resets to 0.
const COOLDOWN_BACKOFF_STEPS_MS = [
  30  * 60 * 1000,   // 1st  429  → wait 30 min
  2   * 60 * 60 * 1000, // 2nd 429  → wait 2 h
  4   * 60 * 60 * 1000, // 3rd 429  → wait 4 h
  6   * 60 * 60 * 1000, // 4th+ 429 → wait 6 h (cap)
];

// Lazy getters — read at call time so backend/.env loaded by server.js body is
// visible. .trim() on every read because copying env values from a panel UI
// (Hostinger) often picks up trailing whitespace/newlines, and a single
// trailing space silently kills auth with no obvious symptom (Bluesky returns
// "AuthenticationRequired", not "your password has whitespace").
const getPDS = () => (process.env.BLUESKY_PDS_URL || "https://bsky.social").trim();
const getHandle = () => (process.env.BLUESKY_HANDLE || "").trim();
const getAppPassword = () => (process.env.BLUESKY_APP_PASSWORD || "").trim();

let session = null; // { did, accessJwt, refreshJwt, createdAt, handle }

export function isBlueskyConfigured() {
  return Boolean(getHandle() && getAppPassword());
}

function _loadSessionFromDisk() {
  try {
    if (!existsSync(SESSION_PATH)) return null;
    const raw = JSON.parse(readFileSync(SESSION_PATH, "utf8"));
    if (raw?.accessJwt && raw?.refreshJwt && raw?.did) {
      // Reject if handles differ AND neither could be a custom-domain alias of
      // the other. Same DID = same account regardless of handle string, so we
      // only reject on an outright mismatch where we have no DID to fall back on.
      // (nmc192.bsky.social ↔ scoopfeeds.com are the same account via DID.)
      if (raw.handle && getHandle() && raw.handle !== getHandle()) {
        // If the DID is present we trust it — different handle strings can still
        // resolve to the same DID (custom domain handles). Keep the session.
        if (!raw.did) return null;
      }
      return raw;
    }
  } catch (e) {
    logger.warn(`blueskyClient: session file unreadable: ${e.message}`);
  }
  return null;
}

function _persistSession(s) {
  try {
    const dir = path.dirname(SESSION_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SESSION_PATH, JSON.stringify(s, null, 2), { mode: 0o600 });
  } catch (e) {
    logger.warn(`blueskyClient: failed to persist session: ${e.message}`);
  }
}

async function call(path, { method = "POST", body, headers = {}, blob = null } = {}) {
  const url = `${getPDS()}/xrpc/${path}`;
  const init = { method, headers: { ...headers } };
  if (blob) {
    init.headers["Content-Type"] = blob.contentType || "application/octet-stream";
    init.body = blob.data;
  } else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* keep raw */ }
  if (!res.ok) {
    const err = new Error(`bluesky ${path} → ${res.status} ${json.error || text || "unknown"}`);
    err.statusCode = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// Try to mint a new accessJwt from the cached refreshJwt. Cheap + lightly
// rate-limited (vs createSession which is heavily limited). Returns the
// updated session on success, null on failure (caller should fall back to
// createSession but only if a fresh login is genuinely needed).
async function _refreshSession(prev) {
  try {
    const out = await call("com.atproto.server.refreshSession", {
      headers: { Authorization: `Bearer ${prev.refreshJwt}` },
      method: "POST",
    });
    const next = {
      did:        out.did || prev.did,
      accessJwt:  out.accessJwt,
      refreshJwt: out.refreshJwt || prev.refreshJwt,
      handle:     getHandle(),
      createdAt:  Date.now(),
    };
    _persistSession(next);
    return next;
  } catch (err) {
    logger.warn(`blueskyClient: refreshSession failed (${err.message}); will need full login`);
    return null;
  }
}

function _readCooldown() {
  try {
    if (!existsSync(COOLDOWN_PATH)) return { until: 0, failCount: 0 };
    const raw = JSON.parse(readFileSync(COOLDOWN_PATH, "utf8"));
    return {
      until:     typeof raw?.until     === "number" ? raw.until     : 0,
      failCount: typeof raw?.failCount === "number" ? raw.failCount : 0,
    };
  } catch { return { until: 0, failCount: 0 }; }
}

function _writeCooldown(untilMs, failCount = 0) {
  try {
    const dir = path.dirname(COOLDOWN_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(COOLDOWN_PATH, JSON.stringify({ until: untilMs, failCount, setAt: Date.now() }));
  } catch (e) {
    logger.warn(`blueskyClient: failed to persist cooldown: ${e.message}`);
  }
}

async function _createSession() {
  // Circuit-breaker: skip if we're inside a recent 429 cooldown window.
  const { until: cooldownUntil, failCount } = _readCooldown();
  if (cooldownUntil && Date.now() < cooldownUntil) {
    const secs = Math.ceil((cooldownUntil - Date.now()) / 1000);
    const err = new Error(`bluesky createSession on cooldown (${secs}s remaining after recent 429)`);
    err.statusCode = 429;
    err.cooldown = true;
    throw err;
  }

  try {
    const out = await call("com.atproto.server.createSession", {
      body: { identifier: getHandle(), password: getAppPassword() },
    });
    const next = {
      did:        out.did,
      accessJwt:  out.accessJwt,
      refreshJwt: out.refreshJwt,
      handle:     getHandle(),
      createdAt:  Date.now(),
    };
    _persistSession(next);
    // Successful login → clear cooldown + reset backoff counter.
    if (cooldownUntil) _writeCooldown(0, 0);
    return next;
  } catch (err) {
    if (err.statusCode === 429) {
      // Exponential backoff — each consecutive 429 doubles the wait, capped
      // at the last step (6 h). This gives Bluesky's rate-limit window a
      // realistic chance to clear before we try again.
      const newFailCount = failCount + 1;
      const stepIdx = Math.min(newFailCount - 1, COOLDOWN_BACKOFF_STEPS_MS.length - 1);
      const waitMs  = COOLDOWN_BACKOFF_STEPS_MS[stepIdx];
      _writeCooldown(Date.now() + waitMs, newFailCount);
      logger.warn(
        `blueskyClient: createSession 429 (fail #${newFailCount}), ` +
        `cooling down for ${Math.round(waitMs / 60000)} min`
      );
    }
    throw err;
  }
}

async function ensureSession({ force = false } = {}) {
  if (session && !force) return session;
  if (!isBlueskyConfigured()) throw new Error("bluesky not configured");

  // 1. Hot in-memory cache (already returned above unless force=true).
  // 2. Disk cache → try refreshSession first.
  if (!session) {
    const onDisk = _loadSessionFromDisk();
    if (onDisk) {
      const refreshed = await _refreshSession(onDisk);
      if (refreshed) {
        session = refreshed;
        return session;
      }
      // Refresh failed — fall through to createSession. The on-disk session
      // is effectively dead at this point.
    }
  } else if (force) {
    // Forced refresh of an existing in-memory session — try refresh first
    // before reaching for createSession (which costs us 1/30 per 5min).
    const refreshed = await _refreshSession(session);
    if (refreshed) {
      session = refreshed;
      return session;
    }
  }

  // Last resort: full login.
  session = await _createSession();
  return session;
}

async function authed(path, opts = {}) {
  const s = await ensureSession();
  try {
    return await call(path, { ...opts, headers: { Authorization: `Bearer ${s.accessJwt}` } });
  } catch (err) {
    // Only 401 = unambiguously expired/invalid token. 400 covers a wide
    // range of validation errors (bad payload, etc) and shouldn't trigger
    // a session refresh — that's how we burned through the 30/5min
    // createSession budget and started getting RateLimitExceeded.
    if (err.statusCode === 401) {
      const fresh = await ensureSession({ force: true });
      return await call(path, { ...opts, headers: { Authorization: `Bearer ${fresh.accessJwt}` } });
    }
    throw err;
  }
}

// Upload a binary blob (the OG card thumbnail). Returns the blob ref shape
// we need to embed in a post record.
async function uploadBlob(buffer, contentType = "image/png") {
  const out = await authed("com.atproto.repo.uploadBlob", {
    blob: { data: buffer, contentType },
  });
  return out.blob; // { $type, ref: { $link }, mimeType, size }
}

// Build the AT Protocol record for a single news post:
//   - text: headline (Bluesky limit 300 graphemes — we slice on chars conservatively)
//   - external embed: link card with thumb, title, description
function buildPostRecord({ text, externalUrl, externalTitle, externalDescription, thumbBlob }) {
  const record = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
    embed: {
      $type: "app.bsky.embed.external",
      external: {
        uri: externalUrl,
        title: externalTitle.slice(0, 200),
        description: (externalDescription || "").slice(0, 240),
        ...(thumbBlob ? { thumb: thumbBlob } : {}),
      },
    },
  };
  return record;
}

export async function postToBluesky({ text, externalUrl, externalTitle, externalDescription, thumbBuffer }) {
  if (!isBlueskyConfigured()) throw new Error("bluesky not configured");
  const s = await ensureSession();
  let thumbBlob = null;
  if (thumbBuffer) {
    try { thumbBlob = await uploadBlob(thumbBuffer, "image/png"); }
    catch (err) {
      logger.warn(`bluesky: thumb upload failed (posting without thumb): ${err.message}`);
    }
  }
  const record = buildPostRecord({ text, externalUrl, externalTitle, externalDescription, thumbBlob });
  const out = await authed("com.atproto.repo.createRecord", {
    body: { repo: s.did, collection: "app.bsky.feed.post", record },
  });
  // out: { uri: "at://did/app.bsky.feed.post/<rkey>", cid }
  // Convert to a public URL (https://bsky.app/profile/<handle>/post/<rkey>).
  const rkey = String(out.uri || "").split("/").pop();
  const publicUrl = rkey ? `https://bsky.app/profile/${getHandle()}/post/${rkey}` : "";
  return { uri: out.uri, cid: out.cid, url: publicUrl };
}
