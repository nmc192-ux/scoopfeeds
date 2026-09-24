/**
 * commons.js — a polite Wikimedia Commons / Wikidata client for the shot resolver.
 *
 * THE HARD-WON FACTS (brief, Phase 3), all enforced here:
 *  - Commons returns 429 on ORIGINAL files, so video is fetched as a transcode:
 *      upload.wikimedia.org/wikipedia/commons/transcoded/{h0}/{h0h1}/{name}/{name}.{h}p.vp9.webm
 *    where h is the md5 of the underscored filename.
 *  - One request at a time, 1.5–4 s apart, descriptive User-Agent. The spacing
 *    is a process-wide queue, not a per-call sleep, so two resolvers in one
 *    process cannot double the rate.
 *  - Error pages arrive as HTML saved under the media filename, so every
 *    download is verified by content (magic bytes / ffprobe) — see verifyMedia.
 *
 * Licence and author come from imageinfo extmetadata (LicenseShortName, Artist,
 * Credit, UsageTerms). A file whose licence cannot be read is NOT used: an
 * unverifiable licence is a failed check, not a pass (agentic-workflow §5).
 * Verified reachable from the prod VPS on 24 Sep 2026 (search, extmetadata,
 * transcodes, Wikidata).
 */

import { createHash } from "crypto";

export const UA = "Scoopfeeds-ShotEngine/1.0 (+https://scoopfeeds.com; contact: ops@scoopfeeds.com)";
const API = "https://commons.wikimedia.org/w/api.php";
const WD_API = "https://www.wikidata.org/w/api.php";
export const MIN_GAP_MS = 1500;
export const MAX_GAP_MS = 4000;

// ─── The polite queue ───────────────────────────────────────────────────────
let _tail = Promise.resolve();
let _last = 0;
let _gap = MIN_GAP_MS;

/**
 * Run `fn` when it is this process's turn: strictly one at a time, at least
 * `_gap` after the previous request finished. A 429 widens the gap to the max
 * and retries once; a clean response narrows it back toward the min.
 */
export function politely(fn, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  const run = async () => {
    const wait = _last + _gap - now();
    if (wait > 0) await sleep(wait);
    try {
      const out = await fn();
      if (out?.status === 429) {
        _gap = MAX_GAP_MS;
        _last = now();
        await sleep(MAX_GAP_MS * 2);
        const retry = await fn();
        return retry;
      }
      _gap = Math.max(MIN_GAP_MS, _gap - 500);
      return out;
    } finally {
      _last = now();
    }
  };
  const p = _tail.then(run, run);
  _tail = p.catch(() => {});
  return p;
}

export function _resetQueue() { _tail = Promise.resolve(); _last = 0; _gap = MIN_GAP_MS; }

async function getJson(url, params, { fetchImpl = fetch } = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries({ format: "json", ...params })) u.searchParams.set(k, v);
  const res = await politely(() => fetchImpl(u, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20000) }));
  if (!res.ok) throw new Error(`${u.host} ${res.status}`);
  return res.json();
}

// ─── Transcode URLs ─────────────────────────────────────────────────────────

/** "File:Foo bar.webm" / "Foo bar.webm" → "Foo_bar.webm" */
export const underscored = (title) => String(title).replace(/^File:/i, "").trim().replace(/ /g, "_");

export function transcodeUrl(title, height = 1080) {
  const name = underscored(title);
  const h = createHash("md5").update(name).digest("hex");
  const enc = encodeURIComponent(name);
  return `https://upload.wikimedia.org/wikipedia/commons/transcoded/${h[0]}/${h.slice(0, 2)}/${enc}/${enc}.${height}p.vp9.webm`;
}

export function filePageUrl(title) {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(underscored(title))}`;
}

// ─── Search and file info ───────────────────────────────────────────────────

/** Commons file search. `mime` narrows to video/webm or image. Titles only. */
export async function searchFiles(query, { mime = "video/webm", limit = 8, deps = {} } = {}) {
  const q = `${query} filemime:${mime}`;
  const d = await getJson(API, { action: "query", list: "search", srsearch: q, srnamespace: "6", srlimit: String(limit) }, deps);
  return (d?.query?.search || []).map((r) => r.title);
}

const stripHtml = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/**
 * Licence, author, dimensions and duration for a batch of titles.
 * Returns [{title, licence, author, credit, usageTerms, width, height, duration, mime, size, date, url, descUrl}].
 * A title whose licence is unreadable comes back with licence: null — callers refuse it.
 */
export async function fileInfo(titles, { deps = {} } = {}) {
  if (!titles.length) return [];
  const d = await getJson(API, {
    action: "query", titles: titles.join("|"), prop: "imageinfo",
    iiprop: "extmetadata|url|size|mime|dimensions",
    iiextmetadatafilter: "LicenseShortName|Artist|Credit|UsageTerms|DateTimeOriginal|ImageDescription",
  }, deps);
  return Object.values(d?.query?.pages || {}).filter((p) => p.imageinfo?.[0]).map((p) => {
    const ii = p.imageinfo[0], m = ii.extmetadata || {};
    return {
      title: p.title,
      licence: stripHtml(m.LicenseShortName?.value) || null,
      author: stripHtml(m.Artist?.value) || null,
      credit: stripHtml(m.Credit?.value) || null,
      usageTerms: stripHtml(m.UsageTerms?.value) || null,
      description: stripHtml(m.ImageDescription?.value).slice(0, 300) || null,
      date: stripHtml(m.DateTimeOriginal?.value) || null,
      width: ii.width ?? null, height: ii.height ?? null, duration: ii.duration ?? null,
      mime: ii.mime ?? null, size: ii.size ?? null, url: ii.url ?? null, descUrl: ii.descriptionurl ?? filePageUrl(p.title),
    };
  });
}

/** Licences the shot engine may use without a human in the loop. */
export function licenceUsable(licence) {
  const l = String(licence || "").toLowerCase();
  if (!l) return false;
  if (/\bnc\b|non-?commercial|\bnd\b|no ?deriv|fair use|all rights reserved/.test(l)) return false;
  return /public domain|^pd|cc0|cc[- ]by(?:[- ]sa)?\b/.test(l);
}

/** The on-screen credit line: "Video: <author>, <licence>" (the reference's format). */
export function creditLine(info, what = "Video") {
  const who = String(info.author || "Wikimedia Commons").slice(0, 60);
  return `${what}: ${who}, ${info.licence}`;
}

// ─── Wikidata ───────────────────────────────────────────────────────────────

/** Name → best Wikidata item {qid, label, description} or null. */
export async function wikidataSearch(name, { deps = {} } = {}) {
  const d = await getJson(WD_API, { action: "wbsearchentities", search: String(name).slice(0, 100), language: "en", limit: "1" }, deps);
  const hit = d?.search?.[0];
  return hit ? { qid: hit.id, label: hit.label, description: hit.description || "" } : null;
}

/** P18 (image file), P625 (coordinates) and P31 (instance of) for a QID. */
export async function wikidataFacts(qid, { deps = {} } = {}) {
  const d = await getJson(WD_API, { action: "wbgetentities", ids: qid, props: "claims" }, deps);
  const c = d?.entities?.[qid]?.claims || {};
  const val = (p) => c[p]?.[0]?.mainsnak?.datavalue?.value;
  const coord = val("P625");
  return {
    iso3: typeof val("P298") === "string" ? val("P298") : null,            // set on country items
    countryQid: val("P17")?.id || null,                                       // the country a place is in
    image: typeof val("P18") === "string" ? val("P18") : null,
    coords: coord ? { lat: coord.latitude, lon: coord.longitude } : null,
    instanceOf: (c.P31 || []).map((s) => s.mainsnak?.datavalue?.value?.id).filter(Boolean),
    isHuman: (c.P31 || []).some((s) => s.mainsnak?.datavalue?.value?.id === "Q5"),
  };
}

// ─── Verification ───────────────────────────────────────────────────────────

/**
 * Is this buffer the media it claims to be? Error pages arrive as HTML under a
 * media filename (brief), so the first bytes decide, never the URL or header.
 */
export function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "webm";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.slice(4, 8).toString() === "ftyp") return "mp4";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "webp";
  const head = buf.slice(0, 64).toString().toLowerCase();
  if (head.includes("<html") || head.includes("<!doctype")) return "html";
  return null;
}

/**
 * Fetch a Commons image (a Special:FilePath thumbnail) politely, with our UA,
 * and verify it by content. Returns {buf, mime} or null.
 */
export async function fetchCommonsImage(url, { deps = {} } = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  try {
    const res = await politely(() => fetchImpl(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20000) }));
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const kind = sniff(buf);
    if (kind !== "jpeg" && kind !== "png") return null;
    return { buf, mime: `image/${kind}` };
  } catch { return null; }
}
