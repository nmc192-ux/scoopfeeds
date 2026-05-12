/**
 * lib/api.js — Phase S2b: persistent tiered cache with verified sentinels.
 *
 * Builds on Phase S2 (commit cf0f16f) which shipped a global axios 429
 * interceptor. S2 alone returned `data: null` on cold-start 429, which the
 * cf0f16f verification revealed still causes React #300 hook-count crashes
 * (finding #57) in components that early-return on undefined data.
 *
 * S2b closes the gap by making the cache survive page reloads (the dominant
 * real-world scenario: a user reloads during a rate-limit window, the
 * sessionStorage cache has the previous response, the interceptor returns
 * that cached data, components see real data and don't crash). For returning
 * visitors, localStorage carries cache across sessions so the first request
 * after returning is instant — Yahoo/Bloomberg-class resilience.
 *
 * ─── Tiered cache ─────────────────────────────────────────────────────────
 *
 *   READ order (cacheGet):
 *     1. In-memory Map (fastest; primary path for repeated reads)
 *     2. sessionStorage (covers same-session reloads; user-specific OK)
 *     3. localStorage (covers cross-session warmth; non-user-specific only)
 *
 *   WRITE order (cacheSet):
 *     - Always: in-memory
 *     - Always: sessionStorage
 *     - Conditional: localStorage (skipped for SESSION_ONLY_PATTERNS)
 *
 *   On localStorage hit, the in-memory cache is populated so subsequent
 *   reads short-circuit at tier 1.
 *
 * ─── Per-endpoint TTL ─────────────────────────────────────────────────────
 *
 *   DEFAULT_TTL_MS = 15 min. HARD_CEILING_TTL_MS = 60 min (no entry, however
 *   configured, lives longer than 1 hour). Overrides in ENDPOINT_TTL_MS keyed
 *   by URL substring:
 *
 *   - Volatile (5 min):     /market, /live-events, /events
 *   - Near-live (10 min):   /weather
 *   - Standard (15 min):    /news, /featured, /analysis/stories,
 *                           /predictions/badges
 *   - Stable (60 min):      /public-config, /geo, /health
 *   - Session-only (5 min): /auth/me  ← sessionStorage only, never local
 *   - Uncached (0 min):     /watchlists  ← user-specific, no cache resilience
 *   - Other:                30 min for /affiliate/*
 *
 * ─── Verified sentinels (the deliberately-narrow set) ────────────────────
 *
 *   Phase S2b originally specified type-aware sentinels for ~10 endpoints to
 *   handle cold-start 429 (no cache yet + rate-limited). Investigation during
 *   implementation revealed (a) hook unwrap patterns are inconsistent across
 *   the codebase (`data.data || []`, `data.data || null`, `data.data` with
 *   no fallback, `return data` raw, custom `if (!data.success) throw`), and
 *   (b) a wrong-shape sentinel recreates the same React #300 cascade we're
 *   trying to prevent. Per session 19 decision, only sentinels with
 *   unambiguous, verified shapes ship in this commit:
 *
 *     /health  → { status: "ok", articles: 0 }   (useHealth: `return data`)
 *     /auth/me → { user: null }                  (useAuth:  `r.data.user || null`)
 *
 *   The other endpoints (/news, /featured, /events, /weather, /market, /geo,
 *   /predictions, /live-events) DEFER to Phase S4. Until S4 ships component-
 *   level defensive patterns, cold-start 429 on those endpoints returns
 *   `data: null` (current Phase S2 behavior). This is honest scope reduction
 *   — the remaining ~5% of crash scenarios persist until S4. The much more
 *   common case (warm cache from sessionStorage/localStorage) is fully fixed
 *   in this commit.
 *
 * ─── Privacy split ────────────────────────────────────────────────────────
 *
 *   User-specific endpoints (SESSION_ONLY_PATTERNS) never write to local-
 *   Storage. Personal data doesn't outlive the browser tab:
 *
 *     /auth/me   → sessionStorage only (5 min)
 *     /watchlists → no cache at all (TTL 0)
 *
 *   Non-user-specific endpoints (news, weather, events, etc.) use full
 *   tiered cache.
 *
 * ─── Defensive storage ────────────────────────────────────────────────────
 *
 *   All Web Storage operations wrapped try/catch:
 *
 *   - Private browsing (Safari): setItem throws → degrade to in-memory only
 *   - Quota exceeded: setItem throws → evict ~20 oldest entries, retry once;
 *     if still failing, drop the write (in-memory still has the data)
 *   - Disabled storage (rare): all reads return null, writes are no-ops
 *   - SSR / undefined window: storage refs are null at module load
 *
 *   No storage error ever propagates to the caller.
 *
 * ─── Cache versioning ─────────────────────────────────────────────────────
 *
 *   Every persisted entry carries the current CACHE_VERSION. On read,
 *   mismatched-version entries are treated as missing AND removed from
 *   storage (gradual cleanup of old-version litter). Bump CACHE_VERSION on
 *   any schema-affecting change (entry shape, sentinel shape change, etc.)
 *   to safely invalidate old client caches without breaking returning users.
 *
 * ─── Hydration on module load ─────────────────────────────────────────────
 *
 *   When this module is first imported (from main.jsx, before App), we walk
 *   localStorage, find entries with our prefix that match CACHE_VERSION and
 *   aren't expired, and seed the in-memory cache with the top 50 (sorted by
 *   timestamp, newest first). Returning users see warm in-memory cache from
 *   the first React render, no waiting on storage reads.
 *
 *   Hydration runs synchronously on import and is capped at 50 entries to
 *   bound the cost on slow devices. Older entries stay in localStorage and
 *   get pulled into in-memory on demand via cacheGet's tier-3 lookup.
 *
 * ─── Known uncovered paths (unchanged from S2) ───────────────────────────
 *
 *   Raw fetch() callers in lib/track.js, lib/push.js, components/reader/
 *   ReaderModal.jsx (related-stories), and admin pages (RealityIndexOps,
 *   BriefsReview, SyntheticReview). These bypass axios and aren't 429-
 *   protected. Captured as finding for future work.
 *
 * Refs: finding #46 (useHealth origin), finding #53 (useHealth confirmation),
 * finding #56 (cascade root cause + two-track plan), finding #57 (React #300
 * mechanism), commit cf0f16f (Phase S2 base), session 19 verification gap
 * + Path B scope decision, session 19 sentinel-correctness audit.
 */

import axios from "axios";

// ─── Configuration ────────────────────────────────────────────────────────

// Bump on any cache-entry-shape or sentinel-shape change. Old-version
// entries are auto-discarded on read.
const CACHE_VERSION = "s2b-v1";

// Storage key prefix. Combined with cache key (METHOD:URL:params) to form
// the full storage key. All entries are scoped under this prefix so we
// can walk them without colliding with other localStorage users.
const STORAGE_PREFIX = "scoop:api:";

// In-memory cache cap. Same as cf0f16f. Map insertion order = LRU order
// (cacheGet re-inserts on access to move entries to most-recently-used).
const MAX_CACHE_ENTRIES = 200;

// Persistent storage cap PER TIER (sessionStorage and localStorage each).
// 100 entries × ~50KB worst case = ~5MB which is at the typical browser
// quota. Eviction is triggered by QuotaExceededError, not enforced eagerly.
const PERSISTENT_MAX_ENTRIES = 100;

// TTL ceiling. No entry, however its endpoint is configured, lives longer
// than 1 hour. Guards against future ENDPOINT_TTL_MS additions accidentally
// shipping stale data for too long.
const HARD_CEILING_TTL_MS = 60 * 60 * 1000;
const DEFAULT_TTL_MS = 15 * 60 * 1000;

// Endpoint-specific TTLs (substring match on request URL). First match wins.
// TTL = 0 means "don't cache at all" — caller must always hit network.
// See module header for rationale per endpoint.
const ENDPOINT_TTL_MS = {
  "/watchlists":           0,                  // user-specific, no cache
  "/auth/me":              5  * 60 * 1000,     // user-specific, sessionStorage
  "/market":               5  * 60 * 1000,
  "/live-events":          5  * 60 * 1000,
  "/events":               5  * 60 * 1000,
  "/weather":              10 * 60 * 1000,
  "/news":                 15 * 60 * 1000,
  "/featured":             15 * 60 * 1000,
  "/analysis/stories":     15 * 60 * 1000,
  "/predictions/badges":   15 * 60 * 1000,
  "/affiliate":            30 * 60 * 1000,
  "/public-config":        60 * 60 * 1000,
  "/geo":                  60 * 60 * 1000,
  "/health":               60 * 60 * 1000,
};

// User-specific endpoints. Never written to localStorage. Reads skip the
// localStorage tier. Substring match on request URL.
const SESSION_ONLY_PATTERNS = ["/auth/me", "/watchlists"];

// Cold-start 429 sentinels. Verified-safe set per session 19 audit. See
// module header for why the broader set was deferred to Phase S4.
const ENDPOINT_SENTINELS = {
  "/health":  { status: "ok", articles: 0 },
  "/auth/me": { user: null },
};

// ─── Storage adapters (defensive) ─────────────────────────────────────────

// Storage references captured once at module load. Module-load-time-null
// covers SSR scenarios (no window). Per-call try/catch covers runtime
// failures (private browsing setItem, disabled storage, quota).
const sessionStore = (typeof window !== "undefined" && window.sessionStorage) || null;
const localStore   = (typeof window !== "undefined" && window.localStorage)   || null;

function safeStorageGet(storage, key) {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSetRaw(storage, key, valueStr) {
  if (!storage) return false;
  try {
    storage.setItem(key, valueStr);
    return true;
  } catch {
    return false;
  }
}

function safeStorageRemove(storage, key) {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// On QuotaExceededError, walk our prefix in `storage`, sort by timestamp,
// and remove the `count` oldest entries. Then the caller retries the set.
// Walk cost is O(n) over our prefix's keys — only fires on quota pressure,
// not on the hot path.
function evictOldestFromStorage(storage, count) {
  if (!storage) return;
  try {
    const entries = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
      const raw = safeStorageGet(storage, k);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        entries.push({ k, ts: parsed.timestamp || 0 });
      } catch {
        // Corrupt entry — evict it preferentially.
        entries.push({ k, ts: 0 });
      }
    }
    entries.sort((a, b) => a.ts - b.ts);
    for (let i = 0; i < count && i < entries.length; i++) {
      safeStorageRemove(storage, entries[i].k);
    }
  } catch {
    /* ignore — eviction is best-effort */
  }
}

function persistEntry(storage, fullKey, entry) {
  if (!storage) return;
  const valueStr = JSON.stringify(entry);
  if (safeStorageSetRaw(storage, fullKey, valueStr)) return;
  // First write failed — most likely QuotaExceededError. Evict and retry.
  evictOldestFromStorage(storage, 20);
  safeStorageSetRaw(storage, fullKey, valueStr);
  // If second write also fails, give up silently. In-memory cache still
  // has the data; persistence is a best-effort layer.
}

// ─── URL classification ───────────────────────────────────────────────────

// First-match-wins substring lookup. URL is whatever axios's response.config
// produces — could be `/health`, `/api/health`, `/123` (for hooks with
// custom baseURL), etc. Substring match handles all variants without
// per-hook normalization.

function getEndpointTTL(url) {
  if (!url) return DEFAULT_TTL_MS;
  for (const pattern in ENDPOINT_TTL_MS) {
    if (url.includes(pattern)) {
      return Math.min(ENDPOINT_TTL_MS[pattern], HARD_CEILING_TTL_MS);
    }
  }
  return DEFAULT_TTL_MS;
}

function getEndpointSentinel(url) {
  if (!url) return null;
  for (const pattern in ENDPOINT_SENTINELS) {
    if (url.includes(pattern)) return ENDPOINT_SENTINELS[pattern];
  }
  return null;  // No verified sentinel → fall back to data:null (Phase S2 behavior)
}

function isSessionOnlyEndpoint(url) {
  if (!url) return false;
  return SESSION_ONLY_PATTERNS.some((p) => url.includes(p));
}

// ─── Cache key construction ──────────────────────────────────────────────

function cacheKey(method, url, params) {
  // Sort param keys so {a:1,b:2} and {b:2,a:1} produce the same key.
  const sortedParams = params && typeof params === "object"
    ? JSON.stringify(
        Object.keys(params).sort().reduce((acc, k) => {
          acc[k] = params[k];
          return acc;
        }, {})
      )
    : "";
  return `${(method || "GET").toUpperCase()}:${url}:${sortedParams}`;
}

function storageKeyFor(cKey) {
  return STORAGE_PREFIX + cKey;
}

// ─── In-memory cache ──────────────────────────────────────────────────────

const _apiCache = new Map();

// Returns the entry (with data + timestamp + ttl + version) or null. Also
// re-inserts on hit to move the entry to MRU position (Map preserves
// insertion order = LRU order).
function getInMemory(key) {
  if (!_apiCache.has(key)) return null;
  const entry = _apiCache.get(key);
  if (isExpired(entry)) {
    _apiCache.delete(key);
    return null;
  }
  // LRU move-to-end.
  _apiCache.delete(key);
  _apiCache.set(key, entry);
  return entry;
}

function setInMemory(key, entry) {
  // Evict oldest if at capacity and this is a new key.
  if (_apiCache.size >= MAX_CACHE_ENTRIES && !_apiCache.has(key)) {
    const oldestKey = _apiCache.keys().next().value;
    _apiCache.delete(oldestKey);
  }
  _apiCache.set(key, entry);
}

function isExpired(entry) {
  if (!entry || !entry.timestamp || !entry.ttl) return true;
  return Date.now() > entry.timestamp + entry.ttl;
}

// Read a persisted entry from a storage tier. Returns null if missing,
// corrupt, expired, or version-mismatched. Removes invalid entries from
// storage so they don't accumulate.
function getFromStorage(storage, fullKey) {
  const raw = safeStorageGet(storage, fullKey);
  if (!raw) return null;
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    safeStorageRemove(storage, fullKey);
    return null;
  }
  if (entry?.version !== CACHE_VERSION) {
    // Old or unknown version — gradual cleanup.
    safeStorageRemove(storage, fullKey);
    return null;
  }
  if (isExpired(entry)) {
    safeStorageRemove(storage, fullKey);
    return null;
  }
  return entry;
}

// ─── Public cache API (tiered) ────────────────────────────────────────────

function cacheGet(method, url, params) {
  const key = cacheKey(method, url, params);

  // Tier 1: in-memory.
  const mem = getInMemory(key);
  if (mem) return mem;

  // Tier 2: sessionStorage. Covers same-session reloads, includes user-
  // specific data.
  const fullKey = storageKeyFor(key);
  const sess = getFromStorage(sessionStore, fullKey);
  if (sess) {
    // Hydrate in-memory so subsequent reads short-circuit.
    setInMemory(key, sess);
    return sess;
  }

  // Tier 3: localStorage. Skipped for session-only endpoints.
  if (!isSessionOnlyEndpoint(url)) {
    const loc = getFromStorage(localStore, fullKey);
    if (loc) {
      setInMemory(key, loc);
      return loc;
    }
  }

  return null;
}

function cacheSet(method, url, params, data) {
  const ttl = getEndpointTTL(url);
  // TTL 0 → don't cache anywhere. /watchlists is the only such endpoint.
  if (ttl <= 0) return;

  const key = cacheKey(method, url, params);
  const entry = {
    version: CACHE_VERSION,
    data,
    timestamp: Date.now(),
    ttl,
  };

  // In-memory always.
  setInMemory(key, entry);

  // sessionStorage always (covers user-specific data within the tab).
  const fullKey = storageKeyFor(key);
  persistEntry(sessionStore, fullKey, entry);

  // localStorage only for non-user-specific endpoints.
  if (!isSessionOnlyEndpoint(url)) {
    persistEntry(localStore, fullKey, entry);
  }
}

// ─── Hydration on module load ─────────────────────────────────────────────

// Walk localStorage for our-prefix entries, validate, take the top 50 by
// timestamp (newest first), seed in-memory cache. Bounded so this doesn't
// block main thread excessively on slow devices.
function hydrateFromLocalStorage() {
  if (!localStore) return;
  try {
    const candidates = [];
    for (let i = 0; i < localStore.length; i++) {
      const k = localStore.key(i);
      if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
      const raw = safeStorageGet(localStore, k);
      if (!raw) continue;
      let entry;
      try {
        entry = JSON.parse(raw);
      } catch {
        safeStorageRemove(localStore, k);
        continue;
      }
      if (entry?.version !== CACHE_VERSION) {
        safeStorageRemove(localStore, k);
        continue;
      }
      if (isExpired(entry)) {
        safeStorageRemove(localStore, k);
        continue;
      }
      candidates.push({ k, entry });
    }
    candidates.sort((a, b) => b.entry.timestamp - a.entry.timestamp);
    const top = candidates.slice(0, 50);
    for (const c of top) {
      const cKey = c.k.slice(STORAGE_PREFIX.length);
      // Don't override LRU position for entries already in memory (shouldn't
      // happen at module load, but defensive).
      if (!_apiCache.has(cKey)) {
        setInMemory(cKey, c.entry);
      }
    }
  } catch {
    /* hydration is best-effort; degrade silently to cold start */
  }
}
hydrateFromLocalStorage();

// ─── Interceptor ──────────────────────────────────────────────────────────

function attachInterceptor(instance) {
  instance.interceptors.response.use(
    // ── 2xx path: cache GETs, enrich response with _meta ──
    (response) => {
      const config = response.config || {};
      const method = (config.method || "get").toUpperCase();

      if (method === "GET" && config.url) {
        cacheSet(method, config.url, config.params, response.data);
      }

      response._meta = {
        status: "fresh",
        cached: false,
        staleSeconds: 0,
        timestamp: Date.now(),
        retryAfter: null,
      };

      return response;
    },

    // ── Error path: catch 429, re-throw everything else ──
    (error) => {
      const response = error?.response;
      const config = error?.config || {};
      const method = (config.method || "get").toUpperCase();

      if (response?.status === 429) {
        const retryRaw = response.headers?.["retry-after"];
        const retryAfter = Number.parseInt(retryRaw, 10);
        const retryAfterSec = Number.isFinite(retryAfter) ? retryAfter : null;

        // GET 429: try tiered cache, then verified sentinel, then null.
        if (method === "GET" && config.url) {
          const cached = cacheGet(method, config.url, config.params);

          if (cached) {
            return Promise.resolve({
              data: cached.data,
              status: 200,
              statusText: "OK (cached, upstream rate-limited)",
              headers: {},
              config,
              _meta: {
                status: "cached",
                cached: true,
                staleSeconds: Math.round((Date.now() - cached.timestamp) / 1000),
                timestamp: cached.timestamp,
                retryAfter: retryAfterSec,
              },
            });
          }

          // Cold-start: no cache anywhere. Try verified sentinel; if none
          // configured for this endpoint, fall back to null (Phase S2
          // behavior). Components that early-return on undefined data
          // can still crash on the null path until Phase S4 ships
          // defensive patterns. Documented trade-off.
          const sentinel = getEndpointSentinel(config.url);
          return Promise.resolve({
            data: sentinel,  // either verified shape or null
            status: 200,
            statusText: sentinel
              ? "OK (cold-start sentinel, rate-limited)"
              : "OK (cold-start, rate-limited)",
            headers: {},
            config,
            _meta: {
              status: "rate-limited",
              cached: false,
              staleSeconds: 0,
              timestamp: Date.now(),
              retryAfter: retryAfterSec,
              sentinel: !!sentinel,
            },
          });
        }

        // POST/PUT/DELETE/PATCH 429: re-throw. Mutations carry user intent;
        // silent recovery would lose user actions.
      }

      // All other errors (5xx, network, CORS, 4xx other than 429, mutations
      // hitting 429) pass through. App.jsx's BackendOffline still triggers
      // on real outages.
      return Promise.reject(error);
    }
  );
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Wrap axios.create() with the 429 interceptor attached. Drop-in replacement
 * for axios.create() in hook files. Hook-level config (baseURL, withCreden-
 * tials, etc.) is passed through unchanged.
 *
 *   // Before:
 *   const api = axios.create({ baseURL: "/api" });
 *
 *   // After:
 *   const api = createApi({ baseURL: "/api" });
 */
export function createApi(config) {
  const instance = axios.create(config);
  attachInterceptor(instance);
  return instance;
}

// Register the same interceptor on the default axios export so pages calling
// `axios.get/post(...)` directly are also covered. This module must be
// imported from main.jsx before App.jsx so the interceptor and hydrated
// cache are in place before any request fires.
attachInterceptor(axios);

// Exported for future freshness UI hooks (Phase S5/B) and for tests. The
// _-prefix signals "internal, don't depend on stability."
export { _apiCache, CACHE_VERSION };

export function _clearCache() {
  _apiCache.clear();
  // Also flush both storage tiers for our prefix.
  for (const storage of [sessionStore, localStore]) {
    if (!storage) continue;
    try {
      const toRemove = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(STORAGE_PREFIX)) toRemove.push(k);
      }
      for (const k of toRemove) safeStorageRemove(storage, k);
    } catch {
      /* ignore */
    }
  }
}
