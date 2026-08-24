// Open-source footage for the AUTOMATED shorts.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS NARROWER THAN THE SKILL'S footage-search TOOL, ON PURPOSE
//
// `.claude/skills/video-factory/engine/footage-search.mjs` searches five sources
// and ranks them verified → declared → unverified. It downloads NOTHING, because
// its closing line is the whole design: "provenance is a human decision; this
// only assembles the evidence." A person reads the licence and decides.
//
// This loop runs at :12 past every hour with nobody watching. There is no human
// to read a licence, so a tier that NEEDS one read cannot be used here at all.
// That is not caution for its own sake — publishing someone's photograph on a
// monetised channel because a search tool guessed is the exact failure the other
// file was written to prevent.
//
// So: VERIFIED ONLY. Sources where the rights holder is established by
// construction rather than by an uploader's claim.
//
//   NASA    — 17 U.S.C. §105. US Government works are public domain. NASA's own
//             media guidelines confirm it; attribution is courtesy, not law, and
//             we render it anyway.
//   DVIDS   — same statute, but ONLY when the crediting branch is a US service.
//             DVIDS also carries allied and contractor material which is NOT
//             automatically public domain. The branch field is the test.
//
// Wikimedia Commons is DELIBERATELY ABSENT, and the reason is worth recording
// because it looks like an oversight. Commons files carry real, machine-readable
// licences — but only via `commons.wikimedia.org/w/api.php` with
// `iiprop=extmetadata`. That host resets the connection from our networks
// (measured: `curl: (35) Recv failure: Connection reset by peer`; the same
// failure the skill tool documents). The REST endpoint that IS reachable,
// `api.wikimedia.org/core/v1/commons/file/…`, returns URLs and an uploader name
// and NO licence field at all. Shipping a rights check against an endpoint we
// cannot reach, or inferring a licence we were never served, is not a check.
// Commons stays in the human-reviewed tool until that endpoint is reachable.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS IS FOR
//
// FALLBACK, never substitution. The article's own photograph is always
// preferred: it was chosen by the publisher to illustrate this story, and no
// keyword search beats that. This fires when the article has no image, or when
// its image would not mount — the slides that were previously rendering as bare
// type on black.
//
// Ships dark behind VIDEO_FOOTAGE_ENABLED.

import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { logger } from "./logger.js";
import { getFFmpegPath } from "./videoGenerator.js";

export const footageEnabled = () => process.env.VIDEO_FOOTAGE_ENABLED === "1";

const CACHE_HOURS = Number.parseFloat(process.env.VIDEO_FOOTAGE_CACHE_HOURS || "24");
const UA = "ScoopFeeds-Footage/1.0 (https://scoopfeeds.com; hello@scoopfeeds.com)";
const TIMEOUT_MS = 12_000;

// ─── query shaping ──────────────────────────────────────────────────────────

// Words that match everything and therefore establish nothing. A search for
// "the new report on the crisis" must not be satisfied by a NASA image whose
// title happens to contain "new".
const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "over", "after",
  "amid", "says", "said", "new", "how", "why", "what", "who", "its", "his", "her",
  "their", "have", "has", "was", "were", "will", "would", "could", "about",
  "more", "than", "been", "are", "not", "but", "out", "off", "day", "days",
  "year", "years", "first", "last", "next", "one", "two", "top", "big",
]);

/** Significant lowercase tokens — the only ones allowed to establish relevance. */
export function tokens(s) {
  return [...new Set(String(s || "").toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || [])]
    .filter(t => t.length >= 4 && !STOP.has(t));
}

/**
 * THE RELEVANCE GUARD.
 *
 * Every one of these APIs returns its best effort for any string, and "best
 * effort" for an unrelated query is a confidently irrelevant picture. NASA will
 * answer a question about semiconductor tariffs with a nebula. Nothing
 * downstream can see an image, so an irrelevant one is invisible until it is on
 * the channel.
 *
 * The test is deliberately crude and deliberately strict: the candidate's own
 * TITLE must share a significant word with the query. Descriptions are excluded
 * — they are paragraphs, and a paragraph matches anything.
 */
export function relevant(query, candidateTitle) {
  const q = new Set(tokens(query));
  if (!q.size) return false;
  return tokens(candidateTitle).some(t => q.has(t));
}

/**
 * THE SECOND GATE: is it a PHOTOGRAPH?
 *
 * Found by looking at the first live result. A search for "Hurricane Michael"
 * returned, top-ranked and perfectly relevant, a SMAP radiometer wind-speed
 * GRID — a data plot. Mounted on torn paper it is a chart on a slide, which is
 * the exact complaint this whole workstream exists to fix. Relevance was never
 * the problem; the archive is half instrument output.
 *
 * NASA's library mixes three things: real photography and satellite imagery,
 * instrument data products, and artists' concepts. Only the first is "real event
 * footage" in any sense a viewer would accept, and the last is a painting —
 * putting one in a news short under a credit line would be a misrepresentation.
 *
 * A word test on title and description is crude, and it is the honest amount of
 * certainty available from metadata: nothing here inspects pixels. It rejects
 * rather than ranks, because a false accept ships and a false reject just means
 * the slide renders exactly as it does today.
 */
const NOT_A_PHOTOGRAPH = new RegExp([
  "artist'?s? (concept|impression|rendering)", "illustration", "concept art",
  "\\brender(ing|ed)?\\b", "simulat(ion|ed)", "\\bmodel(ed|led|ling|ing)?\\b",
  "schematic", "diagram", "infographic", "\\bchart\\b", "\\bgraph\\b",
  "\\bplot\\b", "\\bcurve\\b", "spectrum", "spectra", "\\bdata\\b",
  "\\bgrid\\b", "\\bmap of\\b", "time series", "\\bobservation of\\b",
  "measurement",
].join("|"), "i");

export function looksPhotographic({ title, description } = {}) {
  return !NOT_A_PHOTOGRAPH.test(`${title || ""} ${String(description || "").slice(0, 300)}`);
}

// ─── cache ──────────────────────────────────────────────────────────────────
//
// The loop runs hourly and the same story stays in the window for hours, so an
// uncached search would re-ask the same question all day. MISSES are cached too,
// and matter more: most news topics have no NASA or DVIDS coverage at all, so
// the miss is the common answer and the one worth not re-asking.

function cacheDir() {
  const base = process.env.SCOOP_PERSISTENT_DATA_DIR || path.resolve(process.cwd(), "data");
  const dir = path.join(base, "footage-cache");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// BUMP THIS WHENEVER THE CACHED RECORD'S SHAPE CHANGES.
//
// Caught in testing: `screenCredit` was added, and a cache entry written an hour
// earlier came back without it. The reader fell back to the long credit, which
// is exactly the field that overruns the wordmark — so the bug the new field
// fixes would have persisted for a day, on some videos and not others, with
// nothing in the log to say why. A cache keyed only on the question cannot
// notice that the answer's shape has changed.
const CACHE_VERSION = 2;

const cacheKey = (q) => createHash("sha1")
  .update(`v${CACHE_VERSION}:${String(q).toLowerCase().trim()}`).digest("hex").slice(0, 16);

function cacheRead(q) {
  if (!(CACHE_HOURS > 0)) return undefined;
  try {
    const f = path.join(cacheDir(), `${cacheKey(q)}.json`);
    if (!existsSync(f)) return undefined;
    const ageH = (Date.now() - statSync(f).mtimeMs) / 3_600_000;
    if (ageH > CACHE_HOURS) return undefined;
    // `hit` distinguishes a cached miss (null) from no cache entry (undefined).
    return JSON.parse(readFileSync(f, "utf8")).hit ?? null;
  } catch { return undefined; }
}

function cacheWrite(q, hit) {
  if (!(CACHE_HOURS > 0)) return;
  try {
    writeFileSync(path.join(cacheDir(), `${cacheKey(q)}.json`),
      JSON.stringify({ query: q, at: new Date().toISOString(), hit }));
  } catch (err) {
    logger.warn(`🎬 footage: cache write failed — ${err.message.slice(0, 100)}`);
  }
}

const getJson = async (url, headers = {}) => {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// ─── the pixel gate ─────────────────────────────────────────────────────────
//
// The word test above cannot catch everything, and the first live run proved it:
// "SMAP captures Hurricane Michael" is a wind-speed GRID, and nothing in its
// title or description says so. A second search returned a four-panel AVIRIS
// figure with a spectrum plot and a caption block — 48% of its pixels white.
//
// MEASURED, on those four results: scientific figures ran 32% and 48% near-white
// pixels; genuine satellite imagery ran 0.8% and 2.0%. That gap is not subtle,
// and it is not really measuring "chartness" — it is measuring FIGURE LAYOUT,
// a picture set on a white page with labels around it. Which is the thing to
// reject, whatever it is a picture of.
//
// Fails OPEN. If ffmpeg cannot decode the candidate this returns true, because
// an unmeasured image is not a proven bad one — and buildMount will fail on the
// same file moments later anyway, which costs a slide, not a video.

const MAX_WHITE = Number.parseFloat(process.env.VIDEO_FOOTAGE_MAX_WHITE || "0.20");
const MAX_PROBES = Number.parseInt(process.env.VIDEO_FOOTAGE_MAX_PROBES || "3", 10);
const MAX_AGE_DAYS = Number.parseInt(process.env.VIDEO_FOOTAGE_MAX_AGE_DAYS || "0", 10);

export function whiteFraction(rgb) {
  let white = 0, n = 0;
  for (let i = 0; i + 2 < rgb.length; i += 3, n++) {
    if (rgb[i] > 236 && rgb[i + 1] > 236 && rgb[i + 2] > 236) white++;
  }
  return n ? white / n : 0;
}

function notAFigure(imageUrl) {
  const ff = getFFmpegPath();
  if (!ff) return true;
  try {
    // ffmpeg reads the URL directly, so this costs one decode of a 128×128
    // downscale — not a full download kept on disk.
    const raw = execFileSync(ff, [
      "-v", "error", "-i", imageUrl, "-vf", "scale=128:128,format=rgb24",
      "-frames:v", "1", "-f", "rawvideo", "pipe:1",
    ], { maxBuffer: 1 << 20, timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] });
    const w = whiteFraction(raw);
    if (w > MAX_WHITE) {
      logger.info(`🎬 footage: rejected — ${(100 * w).toFixed(0)}% white, reads as a figure not a photograph`);
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Newest first, undated last.
 *
 * ISO dates sort correctly as strings, which is the only reason this is a
 * one-liner. An undated candidate sorts to the BOTTOM rather than the top —
 * "" would otherwise win a descending comparison against every real date.
 */
export const newestFirst = (a, b) =>
  String(b?.date || "").localeCompare(String(a?.date || ""));

// ─── NASA ───────────────────────────────────────────────────────────────────

async function nasaCandidates(query) {
  const out = [];
  const j = await getJson(`https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=image`);
  for (const item of (j.collection?.items || []).slice(0, 12)) {
    const d = item.data?.[0] || {};
    if (!relevant(query, d.title)) continue;
    if (!looksPhotographic({ title: d.title, description: d.description })) continue;
    out.push({ date: String(d.date_created || "").slice(0, 10) || null, resolve: async () => {
      // `item.href` is a manifest, not a picture: a collection.json listing the
      // rendition URLs. The original is the only one worth mounting — thumbs are
      // a few hundred pixels and the mount crops to 5:6 before scaling to 1080.
      const assets = await getJson(item.href);
      const orig = (assets || []).find(u => /~orig\.(jpe?g|png)$/i.test(u))
                || (assets || []).find(u => /~large\.(jpe?g|png)$/i.test(u));
      if (!orig) return null;
      return {
        // The manifest serves http:// URLs. Upgrading is not cosmetic — the
        // mount fetch runs in production and would otherwise go in the clear.
        imageUrl: String(orig).replace(/^http:\/\//i, "https://"),
        credit: d.center ? `NASA / ${d.center}` : "NASA",
        screenCredit: d.center ? `NASA / ${d.center}` : "NASA",
        sourceUrl: d.nasa_id ? `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}` : null,
        licence: "Public domain — US Government work (17 U.S.C. §105)",
        source: "NASA", title: d.title || null,
        date: String(d.date_created || "").slice(0, 10) || null,
      };
    } });
  }
  // NASA's API has no sort parameter, so recency is applied to the candidates
  // that already PASSED both gates — never as a filter. Preferring a newer
  // acceptable picture is a tiebreak; preferring a newer one over a relevant
  // one would be a downgrade.
  out.sort(newestFirst);
  return out;
}

// ─── DVIDS ──────────────────────────────────────────────────────────────────

// UNEXERCISED PATH. There is no DVIDS_API_KEY on any env file in this project,
// so this branch has never run against the live API — it is written to the
// documented shape and it fails closed. Stated plainly rather than implied,
// because "implemented" and "works" are different claims. A free key is
// self-signup at api.dvidshub.net; the first real run is its first test.
const DOW_DISCLAIMER =
  "The appearance of U.S. Department of War (DoW) visual information does not imply or constitute DoW endorsement.";

const US_BRANCH = /^(Army|Navy|Air Force|Marines|Marine Corps|Coast Guard|Space Force|DoD)\b/i;

async function dvidsCandidates(query) {
  const key = process.env.DVIDS_API_KEY;
  if (!key) return [];
  const out = [];
  // RECENCY IS THE POINT, for news imagery. DVIDS exposes `sort=date` and
  // from/to windows (their own tutorial examples), so ask the server for newest
  // first rather than re-ranking whatever relevance happened to return. The
  // relevance and figure gates still run on top: newest is a tiebreak among
  // acceptable pictures, never a reason to accept an unacceptable one.
  const params = new URLSearchParams({
    q: query, type: "image", max_results: "15", sort: "date", api_key: key,
  });
  // An explicit window is opt-in. Left unset because a hard cutoff turns "old
  // picture" into "no picture", and a five-year-old photograph of the right
  // place beats a black slide.
  if (MAX_AGE_DAYS > 0) {
    params.set("from_date", new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z"));
  }
  const j = await getJson(`https://api.dvidshub.net/search?${params}`);
  for (const it of (j.results || []).slice(0, 15)) {
    // THE BRANCH TEST IS THE LICENCE TEST. DVIDS hosts allied and contractor
    // material that is not a US Government work and carries no §105 exemption;
    // treating the whole site as public domain is the mistake this guards.
    if (!US_BRANCH.test(it.branch || "")) continue;
    if (!relevant(query, it.title)) continue;
    if (!looksPhotographic({ title: it.title, description: it.description })) continue;
    out.push({ resolve: async () => {
      const asset = await getJson(
        `https://api.dvidshub.net/asset?id=${encodeURIComponent(it.id)}&api_key=${key}`).catch(() => null);
      const url = asset?.results?.image || asset?.results?.url || it.image || null;
      if (!url || !/^https?:\/\//i.test(url)) return null;
      return {
        imageUrl: String(url).replace(/^http:\/\//i, "https://"),
        // TWO FORMS, BOTH TRUE, BECAUSE THEY GO TO DIFFERENT PLACES.
        //
        // The full credit names the photographer and belongs in the
        // description, where there is room and where crediting a named person
        // for their work is the decent thing to do.
        //
        // The corner badge is a different surface: it was sized for "REUTERS",
        // and "AIR FORCE / DVIDS · SSGT STACEY THORNBURG" rendered straight
        // through the SCOOPFEEDS wordmark. Truncating a credit risks
        // misattributing it, so the short form is composed rather than cut —
        // still an accurate statement of the source, just not the whole one.
        credit: `${it.branch} / DVIDS${it.credit ? ` · ${it.credit}` : ""}`,
        screenCredit: `${it.branch} / DVIDS`,
        sourceUrl: it.url || null,
        licence: "Public domain — US Government work (17 U.S.C. §105)",
        // DVIDS' OWN TERMS ASK FOR THIS, and §105 does not cover it.
        // dvidshub.net/about/copyright: "All users of DoW VI must display this
        // non-DoW endorsement disclaimer". News use is explicitly authorised
        // ("historical and newsworthy purposes"), the disclaimer is REQUIRED for
        // commercial use and REQUESTED otherwise — and a monetised channel is
        // not the place to argue the difference. So it travels with the asset
        // rather than being someone's job to remember.
        disclaimer: DOW_DISCLAIMER,
        source: "DVIDS", title: it.title || null,
        date: String(it.date_published || it.date || "").slice(0, 10) || null,
      };
    } });
  }
  return out;
}

// ─── the one entry point ────────────────────────────────────────────────────

/**
 * A rights-clean photograph for a slide that would otherwise render bare type.
 *
 * `subject` is the spec's own statement of what the picture should show, which
 * is a better query than the headline: it was written to describe an image.
 * The headline is the fallback.
 *
 * Returns null for every failure — no image is a rendering outcome, never a
 * reason to lose a video. Same contract as buildMount.
 */
export async function findFootageStill({ subject, title } = {}) {
  if (!footageEnabled()) return null;
  const query = [subject, title].map(s => String(s || "").trim()).find(s => tokens(s).length);
  if (!query) return null;

  const cached = cacheRead(query);
  if (cached !== undefined) {
    if (cached) logger.info(`🎬 footage: cached hit for "${query.slice(0, 60)}" — ${cached.source}`);
    return cached;
  }

  const candidates = [];
  // DVIDS first when configured: news imagery beats earth science for most
  // stories, and NASA is the broader net underneath it.
  for (const [name, fn] of [["DVIDS", dvidsCandidates], ["NASA", nasaCandidates]]) {
    try { candidates.push(...await fn(query)); }
    catch (err) { logger.warn(`🎬 footage: ${name} search failed — ${err.message.slice(0, 100)}`); }
  }

  let hit = null, probes = 0;
  for (const c of candidates) {
    if (probes >= MAX_PROBES) {
      // NO SILENT CAP. Say what was left unexamined rather than implying the
      // pool was exhausted.
      logger.info(`🎬 footage: probe budget ${MAX_PROBES} reached — ${candidates.length - probes} candidate(s) not examined`);
      break;
    }
    let r = null;
    try { r = await c.resolve(); } catch { r = null; }
    if (!r) continue;
    probes++;
    if (!notAFigure(r.imageUrl)) continue;
    hit = r;
    break;
  }

  cacheWrite(query, hit);
  logger.info(hit
    ? `🎬 footage: "${query.slice(0, 60)}" → ${hit.source} · ${String(hit.title).slice(0, 60)} · ${hit.credit}`
    : `🎬 footage: "${query.slice(0, 60)}" → no verified match`);
  return hit;
}

// ─── what the description has to say ────────────────────────────────────────

/**
 * Credit lines for every piece of footage a video used.
 *
 * Public domain does not mean unattributed. NASA asks for credit as a courtesy
 * and we give it; DVIDS attaches an actual condition, and a condition that only
 * gets met when someone remembers is not met. De-duplicated, because one video
 * can draw several stills from the same source and the disclaimer is a
 * statement about the channel, not about each picture.
 */
export function footageCreditLines(footage = []) {
  const items = (footage || []).filter(f => f && f.credit);
  if (!items.length) return [];
  const credits = [...new Set(items.map(f =>
    `Imagery: ${f.credit}${f.licence ? ` — ${f.licence}` : ""}${f.sourceUrl ? ` ${f.sourceUrl}` : ""}`))];
  const disclaimers = [...new Set(items.map(f => f.disclaimer).filter(Boolean))];
  return [...credits, ...disclaimers];
}
