/**
 * lib/api.js — Phase S2 global axios layer (finding #56 stabilization track).
 *
 * Single architectural layer that handles 429 rate-limit responses systemically
 * across all data-fetching hooks. Eliminates the cascade pattern that caused
 * React #300 crashes (finding #57) when the backend's apiGlobalLimiter
 * (500 req/15min/IP at backend/server.js:188) trips during normal browsing.
 *
 * USAGE:
 *
 *   // Hooks — preferred path:
 *   import { createApi } from "../lib/api";
 *   const api = createApi({ baseURL: "/api" });
 *   const { data } = await api.get("/news");
 *
 *   // Pages using default axios — covered automatically by the global
 *   // interceptor registered at module load (no per-file change needed):
 *   import axios from "axios";
 *   const { data } = await axios.get("/api/news"); // ← also 429-protected
 *
 * BEHAVIOR (per response status):
 *
 *   2xx  GET   → cache .data with timestamp; enrich response with _meta.fresh
 *   2xx  POST  → don't cache (mutations); enrich response with _meta.fresh
 *   429  GET   → return cached entry if present (_meta.cached), else
 *                synthetic { data: null, _meta.status='rate-limited' }
 *   429  POST  → re-throw (mutations need explicit failure handling so
 *                callers can prompt user to retry — silent recovery is wrong)
 *   4xx  other → re-throw (real client errors)
 *   5xx        → re-throw (real outages — BackendOffline UI still triggers)
 *   network    → re-throw (offline detection still works)
 *
 * DATA MODEL (Philosophy B per session 19 decision):
 *
 *   Successful response object gains an _meta field. Existing code that does
 *   `const { data } = await api.get(...)` continues to work unchanged — they
 *   read .data from a 2xx response or a 429-cached synthetic response and
 *   never need to touch _meta. Future freshness UI hooks (Phase S5/B work)
 *   can opt in by reading _meta:
 *
 *     {
 *       status: 'fresh' | 'cached' | 'rate-limited',
 *       cached: boolean,
 *       staleSeconds: number,     // 0 if fresh, >0 if from cache
 *       timestamp: number,        // when data was originally fetched
 *       retryAfter: number|null,  // seconds, from Retry-After header if present
 *     }
 *
 * CACHE: bounded in-memory Map (no sessionStorage). LRU eviction at 200
 * entries. Keyed by METHOD:URL:JSON(sorted-params). Resets on page reload.
 * Persisting across reloads is future scope (Phase S5/B).
 *
 * KNOWN UNCOVERED PATHS: raw fetch() callers in lib/track.js, lib/push.js,
 * components/reader/ReaderModal.jsx (related-stories fetch), and admin
 * pages (RealityIndexOps, BriefsReview, SyntheticReview). These bypass
 * axios and aren't 429-protected. They mostly don't matter for user-
 * visible cascade — analytics is fire-and-forget, push is one-time setup,
 * admin pages are operator-only. Captured as finding for future work.
 *
 * Refs: finding #56 (cascade root cause + two-track plan); finding #57
 * (React #300 mechanism); commit f34f2bf (the per-hook attempt that
 * exposed this needed to be done at the axios layer instead).
 */

import axios from "axios";

// ─── Cache ────────────────────────────────────────────────────────────────
// Bounded LRU keyed by method+URL+params. Map insertion order = LRU order;
// cacheGet re-inserts (moves to end) on access; cacheSet evicts the first
// key when at capacity. 200 entries is comfortable for normal browsing:
// ~30 unique endpoints × ~5 param variants = 150, leaves headroom.

const MAX_CACHE_ENTRIES = 200;
const _apiCache = new Map();

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

function cacheGet(key) {
  if (!_apiCache.has(key)) return null;
  // LRU: re-insert to move this entry to the end (most-recently-used).
  const entry = _apiCache.get(key);
  _apiCache.delete(key);
  _apiCache.set(key, entry);
  return entry;
}

function cacheSet(key, data) {
  // Evict oldest if at capacity AND this is a new key.
  if (_apiCache.size >= MAX_CACHE_ENTRIES && !_apiCache.has(key)) {
    const oldestKey = _apiCache.keys().next().value;
    _apiCache.delete(oldestKey);
  }
  _apiCache.set(key, { data, timestamp: Date.now() });
}

// ─── Interceptor ──────────────────────────────────────────────────────────

function attachInterceptor(instance) {
  instance.interceptors.response.use(
    // ── 2xx path: cache GETs, enrich with _meta ──
    (response) => {
      const config = response.config || {};
      const method = (config.method || "get").toUpperCase();

      if (method === "GET" && config.url) {
        const key = cacheKey(method, config.url, config.params);
        cacheSet(key, response.data);
      }

      // Attach _meta for future freshness UI. Existing code reads .data
      // and ignores _meta — backward-compatible enrichment.
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
        // Express-rate-limit normally sets Retry-After in seconds (RFC 7231).
        // Capture for future freshness UI. parseInt yields NaN on missing
        // header; convert to null.
        const retryRaw = response.headers?.["retry-after"];
        const retryAfter = Number.parseInt(retryRaw, 10);
        const retryAfterSec = Number.isFinite(retryAfter) ? retryAfter : null;

        // GET 429: return cached or cold-start sentinel.
        if (method === "GET" && config.url) {
          const key = cacheKey(method, config.url, config.params);
          const cached = cacheGet(key);

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

          // Cold-start: no cache yet, can't recover gracefully with data.
          // Return null data so callers don't get an error/crash; components
          // must handle null defensively (Phase S4 work formalizes this).
          return Promise.resolve({
            data: null,
            status: 200,
            statusText: "OK (cold-start, rate-limited)",
            headers: {},
            config,
            _meta: {
              status: "rate-limited",
              cached: false,
              staleSeconds: 0,
              timestamp: Date.now(),
              retryAfter: retryAfterSec,
            },
          });
        }

        // POST/PUT/DELETE/PATCH 429: re-throw. Mutations carry user intent
        // (save, post, vote); silently swallowing "your action didn't go
        // through" is the wrong UX. Callers should catch and prompt retry.
      }

      // All other errors (5xx, network, CORS, 4xx other than 429,
      // POST 429) pass through. react-query / direct callers handle them
      // as normal; App.jsx's BackendOffline UI still triggers on real
      // outages because isError flips true.
      return Promise.reject(error);
    }
  );
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Wrap axios.create() with the 429 interceptor attached. Drop-in replacement
 * for axios.create() in hook files.
 *
 *   // Before:
 *   const api = axios.create({ baseURL: "/api" });
 *
 *   // After:
 *   const api = createApi({ baseURL: "/api" });
 *
 * The returned instance behaves exactly like a normal axios instance for
 * existing call sites (.get/.post/.put/.delete all work, response.data
 * unchanged). 429s are transparently handled per the module header.
 */
export function createApi(config) {
  const instance = axios.create(config);
  attachInterceptor(instance);
  return instance;
}

// Register the same interceptor on the default axios export so direct
// `axios.get/.post(...)` calls in pages (TopicPage, CountryPage, TagPage,
// SearchPage, ArticlePage, RegionPage, SourcePage, WeatherPage, LiveTvPage,
// NewsletterSignup) are also covered without per-file changes. This module
// must be imported from main.jsx before App renders so the interceptor is
// in place before any request fires.
attachInterceptor(axios);

// Exported for future freshness UI hooks (Phase S5/B) and for tests.
// Treating these as internal — name prefix _ signals "don't depend on
// stability of this surface yet."
export { _apiCache };

export function _clearCache() {
  _apiCache.clear();
}
