/**
 * providers.mjs — Pexels and Pixabay video search, ported to Node.
 *
 * Logic ported from MoneyPrinterTurbo (https://github.com/harry0703/MoneyPrinterTurbo),
 * `app/services/material.py`, which is MIT licensed — Copyright (c) 2024 harry0703.
 * The MIT licence permits this use and asks that the notice travel with the code
 * (brief §2f). Nothing from that project is installed, vendored or executed: this
 * is a reading of its approach, rewritten in JavaScript, and no MPT code appears
 * in package.json (§2b).
 *
 * Ported ideas: best-rendition selection among a result's several video URLs,
 * aspect filtering, Pixabay Cloudflare-challenge detection, rate-limit handling,
 * multi-key rotation and per-clip provenance capture.
 *
 * NOTE ON TRUST: the endpoints and the response field names below are UNVERIFIED
 * (see endpoints.mjs). Every reader here is therefore defensive — a missing or
 * unexpected field produces a named refusal, never a plausible default. If the
 * real payload differs from what this expects, the tool says so rather than
 * quietly writing a manifest full of nulls.
 */

import { PEXELS, PIXABAY } from "./endpoints.mjs";

/** A provider failure with a stable, reportable reason. */
export class ProviderError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "ProviderError";
    this.reason = reason;
  }
}

/** Split an env value into a key list — multi-key rotation, single key is normal. */
export function apiKeys(raw) {
  return String(raw || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Cycle through keys, as MPT's get_api_key does. Returns null when there are none. */
export function makeKeyRotator(keys) {
  let i = 0;
  return () => (keys.length ? keys[i++ % keys.length] : null);
}

/**
 * Cloudflare interstitials come back as HTML with a 200 or 403, so a naive
 * `res.json()` throws a syntax error and the real cause is lost. MPT detects this
 * explicitly and so do we.
 */
export function isCloudflareChallenge(bodyText, contentType = "") {
  if (/json/i.test(contentType)) return false;
  return /just a moment|cf-browser-verification|challenge-platform|cf_chl_|attention required/i.test(
    String(bodyText || "").slice(0, 4000)
  );
}

/** Read a response as JSON, converting the known failure modes into named reasons. */
async function readJson(res, provider) {
  if (res.status === 429) {
    const retry = res.headers?.get?.("retry-after");
    throw new ProviderError(
      "rate-limited",
      `${provider} returned 429${retry ? ` (retry-after: ${retry})` : ""}. ` +
        "Stopping rather than hammering the free tier — rerun later; the manifest dedupe makes that safe."
    );
  }
  if (res.status === 401 || res.status === 403) {
    const text = await res.text().catch(() => "");
    if (isCloudflareChallenge(text, res.headers?.get?.("content-type") || "")) {
      throw new ProviderError("cloudflare-challenge", `${provider} served a Cloudflare challenge, not JSON.`);
    }
    throw new ProviderError("unauthorized", `${provider} rejected the API key (HTTP ${res.status}).`);
  }
  const contentType = res.headers?.get?.("content-type") || "";
  const text = await res.text();
  if (isCloudflareChallenge(text, contentType)) {
    throw new ProviderError("cloudflare-challenge", `${provider} served a Cloudflare challenge, not JSON.`);
  }
  if (!res.ok) {
    throw new ProviderError("http-error", `${provider} returned HTTP ${res.status}.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError("bad-response", `${provider} returned a body that is not JSON.`);
  }
}

const pixels = (r) => Number(r.width) * Number(r.height);

/**
 * Highest-resolution mp4 rendition among a Pexels result's video_files.
 *
 * RANKED BY DIMENSIONS, NEVER BY `quality`. Two documented traps make the quality
 * string useless for this:
 *   - "quality" is not resolution. In Pexels' own example payload a 1280×720 file
 *     and a 4096×2160 file are BOTH quality "hd", so ranking "hd" over "sd" picks
 *     720p while a 4K file sits in the same array.
 *   - an "hls" entry has width: null and height: null. Number(null) is 0, so the
 *     dimension filter drops it, but it is also excluded by name so the intent is
 *     legible rather than incidental.
 */
export function pickPexelsRendition(video) {
  const files = Array.isArray(video?.video_files) ? video.video_files : [];
  const usable = files.filter(
    (f) => f?.link &&
      f.quality !== "hls" &&
      (!f.file_type || /mp4/i.test(f.file_type)) &&
      Number(f.width) > 0 && Number(f.height) > 0
  );
  if (!usable.length) return null;
  return usable.reduce((best, f) => (pixels(f) > pixels(best) ? f : best));
}

/**
 * Highest-resolution rendition among a Pixabay hit's `videos` map.
 *
 * TRAP: when no large version exists, `large` is still PRESENT, with an empty url
 * and size 0. Code that reads videos.large.url unconditionally downloads nothing,
 * so presence of the key proves nothing and every rendition is checked.
 */
export function pickPixabayRendition(hit) {
  const videos = hit?.videos && typeof hit.videos === "object" ? hit.videos : {};
  const usable = Object.values(videos).filter((v) => v?.url && Number(v.width) > 0 && Number(v.height) > 0);
  if (!usable.length) return null;
  return usable.reduce((best, v) => (pixels(v) > pixels(best) ? v : best));
}

/** Pexels result → the shape the crop gate and manifest speak. */
export function normalisePexels(video) {
  const rendition = pickPexelsRendition(video);
  if (!rendition) return null;
  if (!video?.id) return null;
  return {
    provider: "pexels",
    providerId: String(video.id),
    creator: video?.user?.name || null,
    sourceUrl: video?.url || null,
    license: PEXELS.license,
    width: Number(rendition.width),
    height: Number(rendition.height),
    durationSec: Number(video?.duration),
    downloadUrl: rendition.link,
    tags: [],
  };
}

/** Pixabay hit → the same shape. */
export function normalisePixabay(hit) {
  const rendition = pickPixabayRendition(hit);
  if (!rendition) return null;
  if (!hit?.id) return null;
  const tags = String(hit?.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    provider: "pixabay",
    providerId: String(hit.id),
    creator: hit?.user || null,
    sourceUrl: hit?.pageURL || null,
    license: PIXABAY.license,
    width: Number(rendition.width),
    height: Number(rendition.height),
    durationSec: Number(hit?.duration),
    downloadUrl: rendition.url,
    tags,
  };
}

/**
 * Search Pexels. `orientation` and `size` are provider-side filters: asking for
 * portrait 4K up front costs one request instead of fetching a page of landscape
 * HD and throwing it away at the crop gate, which matters on 200 requests/hour.
 *   orientation: landscape | portrait | square
 *   size:        large (4K) | medium (Full HD) | small (HD)
 */
export async function searchPexels({
  query, perPage = 15, page = 1, orientation, size, key, fetchImpl = globalThis.fetch,
}) {
  if (!key) throw new ProviderError("no-key", "PEXELS_API_KEY is not set (Mac-local only — brief §2d).");
  const url = new URL(PEXELS.url);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(Math.min(perPage, PEXELS.perPageMax)));
  url.searchParams.set("page", String(page));
  if (orientation) url.searchParams.set("orientation", orientation);
  if (size) url.searchParams.set("size", size);

  const res = await fetchImpl(url, { headers: { Authorization: key } });
  const body = await readJson(res, "Pexels");
  if (!Array.isArray(body?.videos)) {
    throw new ProviderError("bad-response", "Pexels response had no `videos` array — check the endpoint contract (§2a).");
  }
  return body.videos.map(normalisePexels).filter(Boolean);
}

/**
 * Search Pixabay. There is NO orientation parameter for video search (confirmed
 * against the docs 2026-08-27 — image search has one, video search does not), so
 * portrait selection happens downstream on the returned dimensions.
 *
 * `minHeight` is the provider-side stand-in for the crop gate's 4K band: asking
 * for min_height=2160 is far cheaper than filtering a page of 720p locally, on a
 * budget of 100 requests per 60 seconds.
 */
export async function searchPixabay({
  query, perPage = 20, page = 1, minHeight, videoType = "film", key, fetchImpl = globalThis.fetch,
}) {
  if (!key) throw new ProviderError("no-key", "PIXABAY_API_KEY is not set (Mac-local only — brief §2d).");
  if (String(query).length > PIXABAY.queryMaxChars) {
    throw new ProviderError("bad-request", `Pixabay queries are capped at ${PIXABAY.queryMaxChars} characters.`);
  }
  const url = new URL(PIXABAY.url);
  url.searchParams.set("key", key);
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(Math.min(Math.max(perPage, PIXABAY.perPageMin), PIXABAY.perPageMax)));
  url.searchParams.set("page", String(page));
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("video_type", videoType);
  if (minHeight) url.searchParams.set("min_height", String(minHeight));

  const res = await fetchImpl(url, {});
  const body = await readJson(res, "Pixabay");
  if (!Array.isArray(body?.hits)) {
    throw new ProviderError("bad-response", "Pixabay response had no `hits` array — check the endpoint contract (§2a).");
  }
  return body.hits.map(normalisePixabay).filter(Boolean);
}

/**
 * Cache identical queries so the same search is issued once per run.
 *
 * ⚠️ DO NOT REMOVE THIS AS AN OPTIMISATION. Caching is a PIXABAY LICENCE TERM,
 * not a performance nicety: the API terms require that "requests must be cached
 * for 24 hours" and state that "systematic mass downloads are not allowed"
 * (PIXABAY.cacheHours in endpoints.mjs). Deleting this would put the tool out of
 * compliance with the terms the footage is used under, which is a licensing
 * problem rather than a slow one. Classes share query words, so it also happens
 * to save quota — that is the side effect, not the reason.
 *
 * SCOPE: this cache lives for one process run. It satisfies the terms for repeat
 * queries within a run; it does not persist across runs, so a re-run inside 24
 * hours re-issues the searches. If acquisition ever becomes frequent enough for
 * that to matter, this is the place to add a disk-backed cache with the 24-hour
 * TTL the terms name.
 */
export function makeSearchCache() {
  const cache = new Map();
  return async (cacheKey, run) => {
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const value = await run();
    cache.set(cacheKey, value);
    return value;
  };
}
