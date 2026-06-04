/**
 * httpFetch.js — the scoring skill's own HTTP/HTML fetch substrate (B.6.2b-1).
 *
 * Ported from the PATTERN in routes/reader.js (NOT imported — reader.js's
 * helpers are route-private and its goal differs: it extracts article content
 * via @mozilla/readability; we detect page structure). Skill-isolation (Q1):
 * the scoring skill owns its fetch substrate; reader.js is untouched.
 *
 * Ported faithfully: the SSRF guard (isSafeUrl — MANDATORY, we fetch arbitrary
 * source domains), the browser-like UA-rotation strategies, the 15s timeout,
 * the 5MB content cap, maxRedirects 5, Referer=origin, the bot-block retry
 * policy, and the error taxonomy. NOT ported: @mozilla/readability and the
 * in-memory CACHE (durable caching is scoring_evidence_cache).
 *
 * Thread/process safety: axios = sockets; linkedom = in-process JS DOM (no JS
 * execution, no headless browser). Nothing here forks a process or a worker
 * thread — ceiling-safe.
 *
 * Testability: fetchRaw takes an optional ctx.transport so tests inject canned
 * responses and run fully offline. Default transport is a thin axios wrapper.
 */

import axios from "axios";
import { parseHTML } from "linkedom";

// ─── SSRF guard (ported verbatim from reader.js) ─────────────────────────────
// Rejects non-http(s), localhost, and RFC-1918 / link-local private ranges so a
// malicious/compromised source URL can't pivot to internal services.
export function isSafeUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false; // link-local
    if (/^0\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

// ─── Browser-like fetch strategies (ported from reader.js) ───────────────────
export const FETCH_STRATEGIES = Object.freeze([
  {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
  },
  {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
  },
  {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
  },
]);

const TIMEOUT_MS = 15_000;
const MAX_CONTENT = 5 * 1024 * 1024; // 5MB
const RETRIABLE_STATUS = new Set([403, 429, 503, 520, 521, 522]);

async function defaultTransport(url, opts) {
  const resp = await axios.get(url, opts);
  return {
    status: resp.status,
    data: resp.data,
    headers: resp.headers || {},
    finalUrl: resp.request?.res?.responseUrl || url,
  };
}

/**
 * fetchRaw(url, ctx) — fetch a URL with UA-rotation + bot-block retries.
 * SSRF-guarded. Returns { status, body, finalUrl, contentType } on success;
 * throws the (raw) error after exhausting strategies. Inject ctx.transport for
 * offline tests.
 */
export async function fetchRaw(url, ctx = {}) {
  if (!isSafeUrl(url)) {
    const e = new Error("unsafe-url");
    e.code = "UNSAFE_URL";
    throw e;
  }
  const transport = ctx.transport || defaultTransport;
  const timeout = ctx.timeoutMs ?? TIMEOUT_MS;
  const origin = new URL(url).origin;

  let lastErr;
  for (const headers of FETCH_STRATEGIES) {
    try {
      const r = await transport(url, {
        timeout,
        maxContentLength: MAX_CONTENT,
        maxRedirects: 5,
        responseType: "text",
        validateStatus: (s) => s >= 200 && s < 400,
        headers: { ...headers, Referer: origin + "/" },
      });
      return {
        status: r.status,
        body: r.data,
        finalUrl: r.finalUrl || url,
        contentType: String(r.headers?.["content-type"] || ""),
      };
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      // Retry only on bot-block signals; bail on genuine network/other errors.
      if (status && !RETRIABLE_STATUS.has(status)) throw err;
      if (!status && err?.code === "UNSAFE_URL") throw err;
    }
  }
  throw lastErr;
}

/**
 * classifyError(err) — map a fetch error to a stable taxonomy. Modules map
 * these to evidence status per the honesty model (e.g. not-found at a GUESSED
 * url → pending, not negative).
 */
export function classifyError(err) {
  const status = err?.response?.status;
  if (err?.code === "UNSAFE_URL") return { kind: "unsafe-url", status: null };
  if (status === 401 || status === 403) return { kind: "blocked", status };
  if (status === 404 || status === 410) return { kind: "not-found", status };
  if (status === 429) return { kind: "rate-limited", status };
  if (status && status >= 500) return { kind: "server-error", status };
  if (err?.code === "ECONNABORTED" || err?.code === "ETIMEDOUT" || /timeout/i.test(err?.message || "")) {
    return { kind: "timeout", status: null };
  }
  if (err?.code === "ENOTFOUND" || err?.code === "EAI_AGAIN") return { kind: "dns", status: null };
  return { kind: "error", status: status ?? null };
}

/** parseHtml(html) — linkedom DOM for querySelector-based detection. */
export function parseHtml(html) {
  const { document } = parseHTML(String(html || ""));
  return document;
}

/**
 * fetchJson(url, ctx) — GET a JSON API (B.6.2c structured-data lookup).
 *
 * Unlike fetchRaw (browser-UA rotation, for scraping outlet sites), this sends
 * a single DESCRIPTIVE user-agent + Accept: application/json — the polite-citizen
 * profile for public APIs (Wikidata/Wikimedia request a contact UA). No linkedom,
 * no robots.txt (fixed trusted API hosts) — but isSafeUrl STILL gates it
 * (defense-in-depth). Result-style (never throws): {ok:true, json, status} or
 * {ok:false, reason}. Inject ctx.transport for offline tests.
 */
export async function fetchJson(url, ctx = {}) {
  if (!isSafeUrl(url)) return { ok: false, reason: "unsafe-url" };
  const transport = ctx.transport || defaultTransport;
  const timeout = ctx.timeoutMs ?? TIMEOUT_MS;
  const userAgent = ctx.userAgent || "Scoopfeeds/1.0";
  try {
    const r = await transport(url, {
      timeout,
      maxContentLength: MAX_CONTENT,
      maxRedirects: 5,
      responseType: "text",
      validateStatus: (s) => s >= 200 && s < 400,
      headers: { "User-Agent": userAgent, Accept: "application/json" },
    });
    let json;
    try { json = JSON.parse(r.data); } catch { return { ok: false, reason: "parse-error", status: r.status }; }
    return { ok: true, json, status: r.status, finalUrl: r.finalUrl || url };
  } catch (err) {
    return { ok: false, reason: classifyError(err).kind, status: err?.response?.status ?? null };
  }
}
