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

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from "fs";
import { fetchTimeout } from "./httpRetry.js";
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

/**
 * The account's PDS DID, from its DID document.
 *
 * `did:web:<host>` of the AtprotoPersonalDataServer service entry. Not
 * derivable from BLUESKY_PDS_URL: that is the entryway (bsky.social) which
 * every account logs in through, while the PDS that actually holds the repo is
 * assigned per account.
 */
function pdsDidFrom(didDoc) {
  const svc = (didDoc?.service || []).find(x => x?.type === "AtprotoPersonalDataServer");
  const ep = svc?.serviceEndpoint;
  if (!ep) return null;
  try { return "did:web:" + new URL(ep).host; } catch { return null; }
}

let session = null; // { did, accessJwt, refreshJwt, createdAt, handle }

export function isBlueskyConfigured() {
  return Boolean(getHandle() && getAppPassword());
}

function _loadSessionFromDisk() {
  try {
    if (!existsSync(SESSION_PATH)) return null;
    const raw = JSON.parse(readFileSync(SESSION_PATH, "utf8"));
    // A session written before the pdsDid fix has no audience to sign video
    // uploads with. Treat it as unusable so the next call creates a fresh one
    // (createSession returns the DID document) rather than reviving a session
    // that can log in fine and fail every upload — which is exactly the failure
    // mode this fix exists to end.
    if (raw && raw.pdsDid === undefined) return null;
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

/**
 * `baseUrl` and `query` were added for the VIDEO service (see the video section
 * at the bottom): uploads go to video.bsky.app rather than the PDS, and both
 * uploadVideo and getJobStatus take query parameters. Optional and defaulted, so
 * every existing caller is unchanged — the alternative was a second fetch
 * wrapper that would not share this one's error shaping, and `statusCode` /
 * `body.error` are exactly what the ExpiredToken recovery reads.
 */
async function call(path, { method = "POST", body, headers = {}, blob = null, query = null, baseUrl = null } = {}) {
  const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
  const url = `${baseUrl || getPDS()}/xrpc/${path}${qs}`;
  const init = { method, headers: { ...headers } };
  if (blob) {
    init.headers["Content-Type"] = blob.contentType || "application/octet-stream";
    init.body = blob.data;
  } else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  // Node's fetch has no timeout; without this a stalled connection parks the
  // whole cross-post chain and starves every channel after it.
  const res = await fetch(url, { ...init, signal: fetchTimeout() });
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
      // CARRIED FORWARD, because refreshSession does not return a DID document.
      // Rebuilding the session without this silently erased the video upload
      // audience on every refresh — which is most cycles, since refresh is
      // preferred over createSession to stay under the 30/5min limit. The fix
      // that added pdsDid shipped and changed nothing for exactly this reason:
      // the createSession path set it, and the refresh path threw it away
      // minutes later.
      pdsDid:     pdsDidFrom(out.didDoc) || prev.pdsDid || null,
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
      // THE PDS THIS ACCOUNT ACTUALLY LIVES ON, not the entryway we log in
      // through. getPDS() is bsky.social for everyone; the real host is in the
      // DID document and differs per account (ours is jellybaby.us-east...).
      // The video service needs it — see uploadVideo.
      pdsDid:     pdsDidFrom(out.didDoc),
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

// ─── Video ──────────────────────────────────────────────────────────────────
//
// Bluesky video is a THREE-STEP flow against a DIFFERENT host, and none of the
// three looks like the link-card path above.
//
//   1. getServiceAuth on the PDS — a short-lived token scoped to one method
//      (lxm=com.atproto.repo.uploadBlob) and one audience (the video service).
//      The session accessJwt is NOT accepted by video.bsky.app.
//   2. uploadVideo to the video service — RAW BYTES, in-band. This is the
//      important difference from Instagram and Threads: nothing fetches a public
//      URL from us, so no MP4 on disk needs protecting after the call returns,
//      and migration 026 deliberately has no 'pending' state.
//   3. getJobStatus, polled, until the transcode produces a blob — which is then
//      embedded in an ordinary app.bsky.feed.post record.
//
// THE POLL IS BOUNDED BY WALL CLOCK, NOT BY ITERATIONS (DrJ, 2026-08-14: "I
// don't want a cycle hanging on a stuck transcode"). A count-based bound is not
// a timeout: N slow responses take N x however-long-the-server-feels. The
// deadline is fixed before the first request and every sleep is clamped to it.
//
// On timeout we throw and DO NOT post. The transcode may well finish afterwards
// server-side, leaving an orphan blob — which is the safe direction: an orphan
// blob is invisible, whereas retrying into a completed job risks a duplicate
// post. The jobId is named in the error so a manual check is possible.

const VIDEO_SERVICE_URL = () => (process.env.BLUESKY_VIDEO_SERVICE_URL || "https://video.bsky.app").trim();
const VIDEO_SERVICE_DID = () => (process.env.BLUESKY_VIDEO_SERVICE_DID || "did:web:video.bsky.app").trim();

/**
 * Strict integer env read. Deliberately NOT `parseInt(x) || default` — that
 * idiom is banned in this codebase because it cannot distinguish 0 from
 * unparseable, and it is not reused from videoVoice.js's `envNumber` because
 * importing that here would drag the whole TTS module into the social client for
 * six lines of arithmetic.
 *
 * Falls back LOUDLY: a mistyped byte ceiling that silently reverts to the
 * default is how a guard stops guarding without anyone noticing.
 */
function envInt(name, def, { min = 1 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) {
    logger.warn(`blueskyClient: ${name}="${raw}" is not an integer >= ${min} — using the default ${def}`);
    return def;
  }
  return n;
}

// The two hard platform limits, asserted rather than assumed. Our own format
// runs 60-100s and a few MB, so NEITHER of these is close to binding today —
// they exist because the format is the thing most likely to change underneath
// this code, and finding out from a 400 mid-cycle is worse than finding out
// from a refusal that names the number.
export const BLUESKY_VIDEO_MAX_BYTES = () => envInt("BLUESKY_VIDEO_MAX_BYTES", 100 * 1024 * 1024);
export const BLUESKY_VIDEO_MAX_SECS  = () => envInt("BLUESKY_VIDEO_MAX_SECS", 180);
export const BLUESKY_VIDEO_POLL_TIMEOUT_MS  = () => envInt("BLUESKY_VIDEO_POLL_TIMEOUT_MS", 120_000);
export const BLUESKY_VIDEO_POLL_INTERVAL_MS = () => envInt("BLUESKY_VIDEO_POLL_INTERVAL_MS", 3_000);

// A file this small is not a video. Same floor and same reasoning as the
// Facebook Reels path: it catches a truncated or zero-byte render before it
// becomes a platform error.
const MIN_PLAUSIBLE_BYTES = 10 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll getJobStatus until the transcode completes, fails, or the deadline
 * passes. Returns the blob ref for the embed.
 */
/**
 * The job status, wrapped or flat.
 *
 * uploadVideo returns { did, jobId, state } at the TOP LEVEL. This code read
 * `up.jobStatus.jobId`, so a successful upload was rejected with "returned no
 * jobId" — and the error printed the jobId it had just been given. getJobStatus
 * is read the same way and gets the same treatment, because a shape that moved
 * once on one endpoint will have moved on its sibling.
 *
 * Both forms are accepted rather than swapping one guess for another: the
 * lexicon documents `jobStatus`, the service currently answers flat, and being
 * wrong in either direction costs another silent channel outage.
 */
function jobOf(res) {
  if (res?.jobStatus?.jobId || res?.jobStatus?.state) return res.jobStatus;
  if (res?.jobId || res?.state) return res;
  return {};
}

async function _awaitVideoJob(jobId, serviceToken) {
  const timeoutMs = BLUESKY_VIDEO_POLL_TIMEOUT_MS();
  const intervalMs = BLUESKY_VIDEO_POLL_INTERVAL_MS();
  const deadline = Date.now() + timeoutMs;
  let lastState = "(none)", polls = 0;

  while (Date.now() < deadline) {
    polls += 1;
    const out = await call("app.bsky.video.getJobStatus", {
      method: "GET",
      baseUrl: VIDEO_SERVICE_URL(),
      query: { jobId },
      headers: { Authorization: `Bearer ${serviceToken}` },
    });
    const js = jobOf(out);
    if (js.state) lastState = js.state;

    if (js.state === "JOB_STATE_COMPLETED") {
      if (!js.blob) {
        throw new Error(`bluesky video job ${jobId} reported COMPLETED with no blob — nothing was posted`);
      }
      logger.info(`🦋 bluesky video job ${jobId} completed after ${polls} poll(s)`);
      return js.blob;
    }
    if (js.state === "JOB_STATE_FAILED") {
      throw new Error(
        `bluesky video job ${jobId} FAILED: ${js.error || "unknown"}${js.message ? ` — ${js.message}` : ""}`
      );
    }
    // Clamp the sleep to the deadline so the bound is the bound.
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  }

  throw new Error(
    `bluesky video job ${jobId} did not finish within ${timeoutMs}ms (${polls} poll(s), last state ` +
    `${lastState}) — NOTHING WAS POSTED. The transcode may still complete server-side; that blob is ` +
    `orphaned rather than published, which is the safe direction.`
  );
}

/**
 * Post a video to Bluesky. Throws on every failure path — there is no degrade
 * to a text-only or link post, for the same reason the Facebook Reels fallback
 * was removed: a caller cannot tell a silent downgrade from a success, and the
 * row would record `posted` for something nobody can watch.
 *
 * @param {object} o
 * @param {string} o.text        post text (Bluesky's limit is 300 graphemes)
 * @param {string} o.filePath    the rendered MP4 — read as bytes, never a URL
 * @param {{width:number,height:number}} [o.aspectRatio]
 * @param {number} [o.durationSecs] measured upstream; skips the probe when given
 */
export async function postVideoToBluesky({ text, filePath, aspectRatio = null, durationSecs = null, langs = ["en"] }) {
  if (!isBlueskyConfigured()) throw new Error("bluesky not configured");
  if (!filePath) throw new Error("bluesky video: no filePath given");

  // ── The two platform ceilings, checked BEFORE the bytes are read ──
  // statSync throws ENOENT on a missing file, which is what the Rule 0 fixtures
  // rely on to prove the refusal happened first.
  const stat = statSync(filePath);
  if (!stat.isFile()) throw new Error(`bluesky video: ${filePath} is not a file`);

  const maxBytes = BLUESKY_VIDEO_MAX_BYTES();
  if (stat.size > maxBytes) {
    throw new Error(
      `bluesky video: ${filePath} is ${(stat.size / 1048576).toFixed(1)}MB, over the ` +
      `${(maxBytes / 1048576).toFixed(0)}MB ceiling — nothing was uploaded`
    );
  }
  if (stat.size < MIN_PLAUSIBLE_BYTES) {
    throw new Error(`bluesky video: ${filePath} is ${stat.size} bytes — implausible for a video`);
  }

  const maxSecs = BLUESKY_VIDEO_MAX_SECS();
  let secs = durationSecs;
  if (secs === null) {
    const { probeDurationSecs } = await import("./videoVoice.js");
    secs = probeDurationSecs(filePath);
  }
  if (Number.isFinite(secs) && secs > maxSecs) {
    throw new Error(
      `bluesky video: ${secs.toFixed(1)}s is over the ${maxSecs}s ceiling — nothing was uploaded`
    );
  }

  const s = await ensureSession();

  // ── 1. Service auth, scoped to one method and one audience ──
  // Through authed() so an ExpiredToken here gets the same recovery as any
  // other PDS call — this is the first request of the cycle for this client and
  // therefore the most likely one to meet a two-hour-old accessJwt.
  // THE AUDIENCE IS THE PDS, NOT THE VIDEO SERVICE.
  //
  // This read `aud: VIDEO_SERVICE_DID()` — the audience Bluesky's own video
  // documentation specified — and it failed 116 consecutive times over weeks
  // with a 401 nobody read:
  //
  //   invalid token audience "did:web:video.bsky.app", should be the user's
  //   PDS DID "did:web:jellybaby.us-east.host.bsky.network"
  //
  // The endpoint is still video.bsky.app and the method is still
  // com.atproto.repo.uploadBlob; only the audience moved. Established by
  // probing all four combinations against the live service (2026-08-24): only
  // aud=<PDS DID> + lxm=uploadBlob returns 200 and a jobId. aud=video service
  // gives the error above; lxm=app.bsky.video.uploadVideo is rejected in turn
  // for the method rather than the audience.
  //
  // BLUESKY_VIDEO_SERVICE_DID is left in place but is no longer the audience —
  // it stays only so an override can still redirect the SERVICE, which is what
  // it was really for.
  const aud = s.pdsDid;
  if (!aud) {
    // Loudly, rather than falling back to the value that produced 116 silent
    // failures. A missing DID document is a different problem and deserves to
    // look like one.
    throw new Error(
      "bluesky video: could not determine the account's PDS DID from its DID document — " +
      "the service-auth audience would be wrong and every upload would 401"
    );
  }
  const auth = await authed("com.atproto.server.getServiceAuth", {
    method: "GET",
    query: {
      aud,
      lxm: "com.atproto.repo.uploadBlob",
      exp: String(Math.floor(Date.now() / 1000) + 30 * 60),
    },
  });
  if (!auth?.token) throw new Error("bluesky video: getServiceAuth returned no token");

  // ── 2. Raw bytes to the video service ──
  const bytes = readFileSync(filePath);
  const up = await call("app.bsky.video.uploadVideo", {
    baseUrl: VIDEO_SERVICE_URL(),
    query: { did: s.did, name: path.basename(filePath) },
    headers: { Authorization: `Bearer ${auth.token}` },
    blob: { data: bytes, contentType: "video/mp4" },
  });

  const job = jobOf(up);
  if (!job.jobId) throw new Error(`bluesky video: uploadVideo returned no jobId (${JSON.stringify(up).slice(0, 200)})`);

  // An already-complete job comes back immediately when the same bytes were
  // uploaded before — handled by the poll rather than special-cased, since its
  // first iteration sees COMPLETED and returns without sleeping.
  const blob = await _awaitVideoJob(job.jobId, auth.token);

  // ── 3. The post record ──
  const record = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
    langs,
    embed: {
      $type: "app.bsky.embed.video",
      video: blob,
      ...(aspectRatio ? { aspectRatio } : {}),
    },
  };
  const out = await authed("com.atproto.repo.createRecord", {
    body: { repo: s.did, collection: "app.bsky.feed.post", record },
  });

  const rkey = String(out.uri || "").split("/").pop();
  return {
    uri: out.uri,                 // at://<did>/app.bsky.feed.post/<rkey> — stored
    cid: out.cid,
    url: rkey ? `https://bsky.app/profile/${getHandle()}/post/${rkey}` : "",
    jobId: job.jobId,
    bytes: stat.size,
    seconds: secs,
  };
}

/** Exported for test: the audience derivation that 116 failures turned on. */
export const _internals = { pdsDidFrom, jobOf };
