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

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
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
    // Never clobber a NEWER session file with an older in-memory one. Two
    // processes (web + worker) share this file; if the other process already
    // recovered and wrote a fresh session, overwriting it with our stale one
    // would re-break BOTH processes on the next post.
    try {
      const existing = JSON.parse(readFileSync(SESSION_PATH, "utf8"));
      if (existing?.createdAt && s?.createdAt && existing.createdAt > s.createdAt) {
        logger.warn("blueskyClient: NOT persisting session — file on disk is newer than this one");
        return;
      }
    } catch { /* no readable existing file — write freely */ }
    writeFileSync(SESSION_PATH, JSON.stringify(s, null, 2), { mode: 0o600 });
  } catch (e) {
    logger.warn(`blueskyClient: failed to persist session: ${e.message}`);
  }
}

// Drop the session EVERYWHERE — memory and disk. Used by expired-token
// recovery: an ExpiredToken from the PDS means this session chain is dead,
// and keeping either copy would just replay the failure on the next post
// (the exact bug: a stale in-memory session held forever, 400 ExpiredToken
// every cycle after ~2h, permanently, since nothing ever dropped it).
function _dropSession(reason) {
  const deadCreatedAt = session?.createdAt ?? Infinity;
  session = null;
  try {
    if (existsSync(SESSION_PATH)) {
      // Two processes share this file. If it is NEWER than the session that
      // just failed, the other process has already recovered — deleting its
      // fresh session would re-break both sides. Keep it; recovery below will
      // load it instead of spending a createSession.
      let fileCreatedAt = 0;
      try { fileCreatedAt = JSON.parse(readFileSync(SESSION_PATH, "utf8"))?.createdAt || 0; } catch { /* unreadable -> droppable */ }
      if (fileCreatedAt > deadCreatedAt) {
        logger.warn(`blueskyClient: session dropped from memory (${reason}) — keeping NEWER session file (another process recovered)`);
        return;
      }
      unlinkSync(SESSION_PATH);
    }
  } catch (e) {
    logger.warn(`blueskyClient: failed to delete session file: ${e.message}`);
  }
  logger.warn(`blueskyClient: session dropped (${reason}) — next call will createSession fresh`);
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
    // Classify: an ExpiredToken here is the same evidence as on createRecord —
    // the chain WAS real and has aged out. The follow-up createSession is
    // legitimate recovery and must not be swallowed by a stale cooldown.
    // (This is the cold-path twin of the in-memory bug: process restarts with
    // a dead disk session + an old cooldown file would otherwise stay dark.)
    return err?.body?.error === "ExpiredToken" || /ExpiredToken/i.test(String(err?.message || ""))
      ? { expired: true }
      : null;
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

async function _createSession({ ignoreCooldown = false } = {}) {
  // Circuit-breaker: skip if we're inside a recent 429 cooldown window.
  //
  // ignoreCooldown is used ONLY by expired-token recovery. An ExpiredToken on
  // createRecord proves credentials and the session flow were WORKING two
  // hours ago — the cooldown state is stale history, not a live rate-limit,
  // and letting it swallow the recovery would turn a routine token expiry
  // into permanent silence (one recovery createSession per ~2h is nowhere
  // near the 30/5min limit). A 429 on the recovery attempt itself still
  // writes cooldown state below, so a genuinely rate-limited account is
  // still protected.
  const { until: cooldownUntil, failCount } = _readCooldown();
  if (cooldownUntil && Date.now() < cooldownUntil && !ignoreCooldown) {
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
      // ±15% jitter so our single probe per window doesn't keep aligning with
      // Bluesky's server-side rate-limit cycle (landing inside a still-hot window
      // and re-arming the cap indefinitely — the pattern that kept us dark).
      const base   = COOLDOWN_BACKOFF_STEPS_MS[stepIdx];
      const waitMs  = Math.round(base * (0.85 + Math.random() * 0.30));
      _writeCooldown(Date.now() + waitMs, newFailCount);
      logger.warn(
        `blueskyClient: createSession 429 (fail #${newFailCount}), ` +
        `cooling down for ${Math.round(waitMs / 60000)} min`
      );
    }
    throw err;
  }
}

// Do the actual establishment: prefer the cheap refreshSession, fall back to a
// full createSession only as a last resort. NOT called directly — always via the
// single-flight ensureSession() below so concurrent callers can't each start one.
async function _establishSession({ force = false, createIfMissing = true, recovery = false } = {}) {
  // Expired-token recovery: the caller has already dropped memory+disk state
  // because the PDS told us the chain is dead. Skip refresh (its tokens came
  // from the same dead chain) and go straight to a fresh login, past any
  // stale cooldown.
  if (recovery) {
    // A session file that SURVIVED _dropSession is by construction newer than
    // the dead one — another process already logged in fresh. Use it rather
    // than spending a second createSession on the same account.
    const survivor = _loadSessionFromDisk();
    if (survivor) {
      logger.info("blueskyClient: recovery adopting fresh session from disk (written by the other process)");
      return (session = survivor);
    }
    return (session = await _createSession({ ignoreCooldown: true }));
  }
  // Disk cache → try the leniently-limited refreshSession first. A refresh
  // that fails with ExpiredToken proves the chain aged out — the follow-up
  // createSession is recovery, not a cold login, and may pass the cooldown.
  let refreshExpired = false;
  if (!session) {
    const onDisk = _loadSessionFromDisk();
    if (onDisk) {
      const refreshed = await _refreshSession(onDisk);
      if (refreshed?.accessJwt) return (session = refreshed);
      if (refreshed?.expired) refreshExpired = true;
      // Refresh failed — the on-disk session is dead; fall through to createSession.
    }
  } else if (force) {
    // Forced refresh of an existing in-memory session — refresh first before
    // reaching for createSession (which costs us 1/30 per 5min).
    const refreshed = await _refreshSession(session);
    if (refreshed?.accessJwt) return (session = refreshed);
    if (refreshed?.expired) refreshExpired = true;
  }
  // Search opts out here: it must never initiate the heavily-limited createSession
  // (see ensureSession note). Return null so the frequent caller degrades to [].
  if (!createIfMissing) return null;
  // Last resort: full login (heavily rate-limited — see cooldown breaker).
  return (session = await _createSession({ ignoreCooldown: refreshExpired }));
}

// Single-flight guard. Concurrent callers MUST share one session establishment:
// without this, N operations racing on a cold (or force-invalidated) session each
// fire their own createSession — a burst that trips Bluesky's strict createSession
// limit (~30/5min), returns 429, and drops the whole account into a multi-hour
// cooldown that blocks ALL Bluesky activity (search AND posting). Collapsing the
// race to a single establishment — then reusing/refreshing it — is the fix.
//
// createIfMissing=false lets the FREQUENT caller (search) use an already-warm or
// disk-refreshable session but NEVER initiate createSession. Search running every
// sentiment cycle is what kept re-firing createSession on each cooldown expiry and
// re-arming the 6h cooldown; createSession is now reserved for the publisher.
let inFlight = null;

async function ensureSession({ force = false, createIfMissing = true, recovery = false } = {}) {
  if (session && !force && !recovery) return session;  // hot in-memory reuse
  if (!isBlueskyConfigured()) throw new Error("bluesky not configured");
  // Join any in-flight establishment instead of starting a competing one.
  // (Recovery starts its own: an in-flight non-recovery run may be refreshing
  // the very chain the PDS just declared dead.)
  if (inFlight && !recovery) {
    const s = await inFlight.catch(() => null);
    if (s) return s;                               // it produced a session → reuse
    if (!createIfMissing) return null;             // no session, and we won't create one
    // an in-flight no-create run yielded nothing — fall through and start our own.
  }
  inFlight = _establishSession({ force, createIfMissing, recovery }).finally(() => { inFlight = null; });
  return inFlight;
}

// Bluesky signals an expired access JWT as HTTP 400 with error "ExpiredToken"
// — NOT as a 401. The old 401-only check is why expiry was never recovered:
// access JWTs last ~2h, so a long-lived process got ~3 half-hourly posts and
// then failed with 400 ExpiredToken every cycle forever, holding the stale
// session in memory the whole time.
function _isExpiredToken(err) {
  if (err?.statusCode === 401) return true;
  return err?.statusCode === 400 &&
    (err?.body?.error === "ExpiredToken" || /ExpiredToken/i.test(String(err?.message || "")));
}

async function authed(path, opts = {}) {
  const s = await ensureSession();
  try {
    return await call(path, { ...opts, headers: { Authorization: `Bearer ${s.accessJwt}` } });
  } catch (err) {
    // Expired/invalid token (401, or Bluesky's 400 ExpiredToken): drop the
    // dead session everywhere, log in fresh, retry ONCE. Bounded — a failure
    // of the retry propagates; there is no loop. Other 400s (bad payload
    // etc.) still throw immediately: retrying those is how we once burned
    // through the 30/5min createSession budget into RateLimitExceeded.
    if (_isExpiredToken(err)) {
      logger.warn(`blueskyClient: ${path} rejected with ${err.statusCode} ${err.body?.error || ""} — recovering with a fresh session`);
      _dropSession(`expired token on ${path}`);
      const fresh = await ensureSession({ recovery: true });
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

/**
 * Search Bluesky for posts via the AppView (api.bsky.app). Requires the
 * authenticated bearer token; the public unauth path returns 403.
 *
 * Returns the raw `posts` array (`AppBskyFeedDefs.PostView[]`) — caller
 * normalizes. Returns `[]` when unconfigured or the search fails so the
 * sentiment pipeline degrades gracefully.
 */
export async function searchBlueskyPosts(query, { limit = 30 } = {}) {
  if (!isBlueskyConfigured() || !query) return [];
  const doSearch = (accessJwt) => {
    const url = `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 100)}&sort=latest`;
    return fetch(url, { headers: { Authorization: `Bearer ${accessJwt}` } });
  };
  try {
    // Search must NEVER initiate createSession (createIfMissing:false) — it is the
    // frequent caller and that pressure is what tripped/kept re-arming the cooldown.
    // No warm/refreshable session → skip this cycle silently (no createSession, no
    // "on cooldown" spam); the publisher establishes the session on its own cycle.
    let s = await ensureSession({ createIfMissing: false });
    if (!s) return [];
    let res = await doSearch(s.accessJwt);
    // 401 = stale accessJwt → refresh (NOT createSession) once and retry.
    if (res.status === 401) {
      s = await ensureSession({ force: true, createIfMissing: false });
      if (!s) return [];
      res = await doSearch(s.accessJwt);
    }
    if (!res.ok) {
      logger.warn(`blueskyClient.searchPosts: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data?.posts) ? data.posts : [];
  } catch (err) {
    logger.warn(`blueskyClient.searchPosts: ${err.message}`);
    return [];
  }
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
