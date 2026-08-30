/**
 * videoBeatSources.js — the two tiers that reach outside for a picture.
 *
 * Kept apart from videoBeatImagery.js on purpose: that file decides WHICH tier
 * answers and is pure enough to test without a network, while this one is the
 * network. The resolver takes both as injected functions.
 *
 * FETCH AT RENDER, NO LIBRARY. Nothing here keeps an image. The only durable
 * state is a 24h cache of SEARCH ANSWERS — small JSON, the pattern
 * videoFootage.js already uses, and it caches MISSES too because for most news
 * topics "nothing suitable exists" is the common answer and the one most worth
 * not re-asking twelve times a day.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import path from "path";
import { logger } from "./logger.js";
import { tryFetchImage } from "./cardRenderer.js";
import { candidateMatches, firstRelevant } from "./videoImageRelevance.js";

/**
 * READ AT CALL TIME, not at module load. Two reasons, one of them a real bug
 * this codebase has hit before: env.js may not have run when this module is
 * first imported (the "import env before anything that reads process.env" rule
 * in CLAUDE.md), and a module-level constant would freeze whatever was set then.
 */
const cacheHours = () => Number(process.env.VIDEO_BEAT_CACHE_HOURS ?? 24);

// BUMP WHEN THE CACHED RECORD'S SHAPE CHANGES. A cache keyed only on the
// question cannot notice that the answer's shape has moved on — the lesson
// videoFootage.js records at its own CACHE_VERSION.
const CACHE_VERSION = 1;

function cacheDir() {
  const base = process.env.SCOOP_PERSISTENT_DATA_DIR || path.resolve(process.cwd(), "data");
  const dir = path.join(base, "beat-imagery-cache");
  mkdirSync(dir, { recursive: true });
  return dir;
}
const cacheKey = (ns, q) => createHash("sha1")
  .update(`v${CACHE_VERSION}:${ns}:${String(q).toLowerCase().trim()}`).digest("hex").slice(0, 16);

export function cacheRead(ns, q) {
  if (!(cacheHours() > 0)) return undefined;
  try {
    const f = path.join(cacheDir(), `${cacheKey(ns, q)}.json`);
    if (!existsSync(f)) return undefined;
    if ((Date.now() - statSync(f).mtimeMs) / 3_600_000 > cacheHours()) return undefined;
    return JSON.parse(readFileSync(f, "utf8")).hit ?? null;   // null = cached miss
  } catch { return undefined; }
}
export function cacheWrite(ns, q, hit) {
  if (!(cacheHours() > 0)) return;
  try {
    writeFileSync(path.join(cacheDir(), `${cacheKey(ns, q)}.json`),
      JSON.stringify({ query: q, at: new Date().toISOString(), hit }));
  } catch (err) { logger.warn(`🖼 beat cache write failed — ${String(err.message).slice(0, 90)}`); }
}

const UA = "Scoopfeeds/1.0 (+https://scoopfeeds.com; contact: ops@scoopfeeds.com)";

/**
 * TIER 2 — a named subject's own portrait, by exact identifier.
 *
 * QID → Wikidata P18 → Commons. There is NO TEXT MATCHING anywhere in this
 * path: the entity extractor already resolved the surface form to a QID, and
 * P18 is that entity's designated image. That is why this tier carries "high"
 * confidence while stock does not — it cannot return a picture of something
 * else, only no picture at all.
 */
/**
 * Is this P18 file an actual PHOTOGRAPH of the thing?
 *
 * Measured against real entities on 2026-08-30, and the reason this exists:
 *
 *   Dolly Parton      -> Young-Dolly-Parton.jpg              a portrait ✓
 *   West Bank         -> Qalandia checkpoint - panoramio.jpg a place ✓
 *   India             -> India-locator-map-blank.svg         A BLANK LOCATOR MAP
 *   Russia            -> Russia 87.74494E 66.20034N.jpg      a satellite tile
 *
 * Commons rasterises SVG when a width is requested, so the locator map fetches
 * perfectly happily as a PNG and lands on a beat — a blank outline map, next to
 * the map card already drawing the same country. The satellite tile illustrates
 * nothing a viewer can read at all.
 *
 * Filename-based and deliberately over-broad, the same posture as
 * videoFootage's looksPhotographic and editorialSensitivity: a false reject
 * costs one beat a picture it can get from another tier, a false accept puts a
 * blank map on screen. Countries and other geographies are exactly where P18 is
 * least photographic, which is also where the map card already serves.
 */
export function looksLikeAPhotograph(file) {
  const f = String(file || "").toLowerCase();
  if (!f) return false;
  // Maps, diagrams, insignia, and vector artwork of any kind.
  if (/\b(locator|location|blank|outline|map|karte|mapa)\b/.test(f)) return false;
  if (/\b(flag|coat[ _-]?of[ _-]?arms|emblem|seal|logo|insignia|crest|banner|arms)\b/.test(f)) return false;
  if (/\b(diagram|chart|graph|schematic|plan|drawing|icon|symbol)\b/.test(f)) return false;
  if (/\.svgs?$/.test(f)) return false;
  // A satellite tile named by its coordinates: "Russia 87.74494E 66.20034N.jpg".
  if (/\d+\.\d+[ _]?[ew]\b.*\d+\.\d+[ _]?[ns]\b/.test(f)) return false;
  return true;
}

export function makeEntityImageFetcher({ _fetchJson = defaultFetchJson, _fetchImage = tryFetchImage } = {}) {
  return async function entityImage(entity) {
    const qid = entity?.qid;
    if (!qid) return null;

    const cached = cacheRead("p18", qid);
    let file = cached;
    if (cached === undefined) {
      const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}`
        + `&props=claims&format=json`;
      const data = await _fetchJson(url);
      file = data?.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value || null;
      cacheWrite("p18", qid, file);
    }
    if (!file) return null;
    // A locator map or a coat of arms is not a picture OF the subject.
    if (!looksLikeAPhotograph(file)) {
      logger.info(`🖼 entity: P18 for ${qid} is "${String(file).slice(0, 50)}" — not a photograph, skipping`);
      return null;
    }

    const url = commonsFilePath(file);
    const got = await _fetchImage(url, "https://commons.wikimedia.org/");
    if (!got) return null;
    return { url, buf: got.buf, credit: "Wikimedia Commons", file };
  };
}

/** Commons serves any file by name through Special:FilePath, at a chosen width. */
export const commonsFilePath = (file, width = 1200) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/`
  + `${encodeURIComponent(String(file).replace(/ /g, "_"))}?width=${width}`;

/**
 * TIER 3 — platform stock, for abstract beats only.
 *
 * The caller has already refused this tier for named subjects (see
 * videoImageRelevance.isAbstractQuery); this function additionally puts every
 * candidate through the REPLACED relevance gate, so a provider returning
 * loosely-tagged results cannot smuggle one through. Provider order is
 * respected and never re-ranked — a ranking function over candidates is a
 * scorer, and the scorer is what produced the polar bear.
 */
export function makeStockImageFetcher({ _search = searchPexelsPhotos, _fetchImage = tryFetchImage } = {}) {
  return async function stockImage(query) {
    const cached = cacheRead("stock", query);
    let chosen = cached;
    if (cached === undefined) {
      const candidates = await _search(query);
      const hit = firstRelevant(query, candidates, (c) => c.alt || c.title || "");
      chosen = hit ? { url: hit.url, credit: hit.credit, title: hit.alt || hit.title || "" } : null;
      cacheWrite("stock", query, chosen);
    }
    if (!chosen) return null;
    // A cached answer is re-checked against the gate: the gate may have been
    // tightened since the entry was written, and a stale pass is exactly the
    // kind of thing nobody would ever notice.
    if (!candidateMatches(query, chosen.title)) return null;
    const got = await _fetchImage(chosen.url, "https://www.pexels.com/");
    if (!got) return null;
    return { url: chosen.url, buf: got.buf, credit: chosen.credit, title: chosen.title };
  };
}

/**
 * Pexels photo search.
 *
 * A SMALL LOCAL CLIENT, AND THE BOUNDARY STAYS SHUT.
 *
 * The plan was to cross the operator/runtime boundary and reuse the existing
 * provider client. On reading it, there was nothing to cross FOR: that client
 * searches VIDEOS — a different endpoint, a different response shape, and a
 * rendition picker for clip resolutions this path has no use for. A photo
 * search is the dozen lines below.
 *
 * So the guard that keeps the operator tooling out of the production image is
 * left exactly as it was, and this file does not name it. A boundary loosened
 * for a reuse that turned out to be imaginary is the worst of both.
 */
export async function searchPexelsPhotos(query, { _fetchJson = defaultFetchJson } = {}) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}`
    + `&per_page=8&orientation=portrait`;
  const data = await _fetchJson(url, { Authorization: key });
  return (data?.photos || []).map((p) => ({
    url: p.src?.large2x || p.src?.large || p.src?.original,
    alt: p.alt || "",
    credit: `${p.photographer || "Pexels contributor"} / Pexels`,
    width: p.width, height: p.height,
  })).filter((c) => c.url);
}

async function defaultFetchJson(url, headers = {}) {
  const { default: axios } = await import("axios");
  const { data } = await axios.get(url, {
    timeout: 15000, headers: { "User-Agent": UA, ...headers },
  });
  return data;
}
