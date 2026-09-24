/**
 * shotResolver.js — the resolver ladder (shot-engine brief, Phase 3). DARK:
 * nothing calls this unless VIDEO_SHOT_ENGINE_ENABLED=1.
 *
 * For each shot the spec writer emitted ({anchor, kind, subject, source_intent}),
 * walk the ladder and stop at the FIRST REAL FIT:
 *
 *   reuse (shot_assets) → incident media candidates → Commons video →
 *   open-web news photos (date-restricted to the story) → Commons/Wikidata
 *   photos → Esri satellite → Natural Earth map → stock (abstract only) → card
 *
 * The output is a RECORD — URL, licence, credit, in-points, crop, coordinates —
 * never media. The renderer fetches at render time (Phase 4) and only the
 * finished MP4 is kept. Every record is written to shot_assets so the next
 * short on the same subject asks the table first.
 *
 * HARD RULES, each enforced here and named in the trail when it bites:
 *  - NEVER the publisher's own article photo: not article.image_url, not any
 *    rendition of it (URL identity), not anything hosted on the publisher's
 *    domain (DrJ, 24 Sep 2026).
 *  - NEVER a private individual's personal photo or a social-media screenshot,
 *    especially in crime stories: social hosts are excluded, a crime story
 *    takes NO open-web photo of a person, and every photo passes the vision
 *    screen for screenshots and private individuals (DrJ, 24 Sep 2026).
 *  - NO casualties, bodies or violence against people in any selected frame:
 *    clips and photos pass the vision sensitivity check on the frames that
 *    would be used; an explicit-harm headline takes no third-party imagery at
 *    all, only maps, satellite and type.
 *  - Stock only for ABSTRACT beats, never a named subject.
 *  - A licence that cannot be read is a refusal, not a pass.
 */

import path from "path";
import { readFileSync, existsSync } from "fs";
import { logger } from "../logger.js";
import { isSensitiveHeadline, isExplicitHarmHeadline } from "../editorialSensitivity.js";
import { imageIdentity } from "../videoImageIdentity.js";
import { registrableDomain } from "../videoAttribution.js";
import { findCity } from "../videoSubjectVisual.js";
import { looksNamed, isAbstractQuery } from "../videoImageRelevance.js";
import { findRecords, isRejected, upsertRecord, markUsed, subjectKey } from "./shotAssets.js";
import * as commons from "./commons.js";
import * as media from "./media.js";
import * as vision from "./vision.js";
import { cropFor } from "./bannerCrops.js";
import { scanArtifactForPakistan } from "../videoPakistanBlock.js";

export const RUNGS = Object.freeze([
  "reuse", "incident", "commons-video", "web-photo", "commons-photo", "esri", "natural-earth", "stock", "card",
]);
const PICTURE_KINDS = new Set(["clip", "photo", "quote"]);
const TYPE_KINDS = new Set(["headline", "punch", "count", "graphic"]);
export const ESRI_CREDIT = "Imagery: Esri World Imagery (Maxar, Earthstar Geographics)";
export const ESRI_TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const MIN_CLIP_SECS = 4;
// Commons' standard WebM transcode heights, largest first. Only those at or
// below the source's height exist for a given file.
export const TRANSCODE_HEIGHTS = Object.freeze([1080, 720, 480, 360]);
export const MAX_VIDEO_CANDIDATES = 2;   // per shot: each costs a probe, ~16 seeks and one vision call
// THE WHOLE VIDEO'S RESOLVE BUDGET. A Commons clip costs 20–190 s (measured
// 24 Sep: 16 polite seeks plus one vision call), and the render job holds a
// 10-minute queue lock. Past the budget the expensive rung is skipped and the
// cheaper ones still run — the table (reuse) is what makes later shorts fast.
export const RESOLVE_BUDGET_MS = () => Math.max(30, Number(process.env.VIDEO_SHOT_RESOLVE_BUDGET_S) || 300) * 1000;

// Crime and legal stories — the private-individual rule bites hardest here.
const CRIME_RE = /\b(arrest(?:ed|s)?|charged|indict(?:ed|ment)|convict(?:ed|ion)|sentenced|fraud|scam(?:med|s)?|murder(?:ed)?|kill(?:ed|ing)|stabb(?:ed|ing)|assault(?:ed)?|robbery|theft|stole|police|suspect(?:s|ed)?|alleged(?:ly)?|court|trial|prosecut(?:or|ors|ion)|lawsuit|sued|jail(?:ed)?|prison|smuggl(?:e|ed|er|ers|ing)|poach(?:er|ers|ing|ed)?|traffick(?:ed|er|ers|ing)|cartel|gang|illegal(?:ly)?)\b/i;
export const isCrimeStory = (article) => CRIME_RE.test(`${article?.title || ""} ${article?.description || ""}`);

// ─── Country names → ISO3, from the shipped Natural Earth geometry ─────────
const GEO_PATH = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../assets/geo/countries-50m.geo.json");
let _countries = null;
function countryByName(name) {
  if (!_countries) {
    _countries = new Map();
    try {
      if (existsSync(GEO_PATH)) for (const f of JSON.parse(readFileSync(GEO_PATH, "utf8")).features || []) {
        if (f.id && f.properties?.name) _countries.set(String(f.properties.name).toLowerCase(), f.id);
      }
    } catch { /* no atlas → no country match; the map rung says so */ }
  }
  const n = String(name || "").toLowerCase().replace(/^the /, "").trim();
  return _countries.get(n) || COUNTRY_ALIASES[n] || null;
}

// ─── Seas, straits and canals ──────────────────────────────────────────────
// Natural Earth 1:10m marine label points, plus the news-critical passages it
// does not carry, hand-added and marked `hand` (Hormuz, Kerch, Suez, Panama).
const MARINE_PATH = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../assets/geo/marine-10m.json");
let _marine = null;
export function marinePlace(name) {
  if (!_marine) {
    _marine = new Map();
    try {
      for (const m of JSON.parse(readFileSync(MARINE_PATH, "utf8")).places || []) {
        for (const n of [m.n, ...(m.alt || [])]) {
          const k = String(n).toLowerCase().replace(/^the /, "").trim();
          if (!_marine.has(k)) _marine.set(k, m);
        }
      }
    } catch { /* no file → no marine match; the map rung says so */ }
  }
  const k = String(name || "").toLowerCase().replace(/^the /, "").trim();
  const m = _marine.get(k);
  return m ? { name: m.n, lat: m.o[1], lon: m.o[0], kind: m.k, hand: Boolean(m.hand) } : null;
}

// The names people write that Natural Earth spells differently.
const COUNTRY_ALIASES = {
  "united states": "USA", "us": "USA", "u.s.": "USA", "usa": "USA", "america": "USA",
  "uk": "GBR", "u.k.": "GBR", "britain": "GBR", "great britain": "GBR", "england": "GBR",
  "czech republic": "CZE", "ivory coast": "CIV", "democratic republic of the congo": "COD", "drc": "COD",
  "republic of the congo": "COG", "bosnia": "BIH", "bosnia and herzegovina": "BIH", "central african republic": "CAF",
  "south sudan": "SSD", "dominican republic": "DOM", "uae": "ARE", "emirates": "ARE", "macedonia": "MKD",
  "eswatini": "SWZ", "swaziland": "SWZ", "burma": "MMR", "east timor": "TLS", "vatican": "VAT",
};

/**
 * Split a subject naming several places into its parts: "United States and
 * China", "Nepal, Tibet and Bhutan", "India & Pakistan". A subject that is
 * one name containing "and" ("Bosnia and Herzegovina", "Trinidad and Tobago")
 * is tried WHOLE first by the caller, so the split never breaks a real name.
 */
export function splitPlaces(subject) {
  return String(subject || "").split(/\s*,\s*|\s+and\s+|\s*&\s*/i).map((x) => x.trim()).filter(Boolean);
}

// ─── Context ─────────────────────────────────────────────────────────────────

/**
 * The real dependencies. Web search is on only when its key AND flag are set
 * (videoWebImageSearch.webImageSearchEnabled), exactly as the beat path gates it.
 */
export async function defaultDeps() {
  const { tryFetchImage } = await import("../cardRenderer.js");
  const { webImageSearchEnabled, searchEventImages } = await import("../videoWebImageSearch.js");
  const { makeStockImageFetcher } = await import("../videoBeatSources.js");
  return {
    fetchImage: tryFetchImage,
    webSearch: webImageSearchEnabled() ? searchEventImages : null,
    stockImage: process.env.PEXELS_API_KEY ? makeStockImageFetcher() : null,
  };
}

export function contextFor(article, { db, deps = {}, webDays = 7 } = {}) {
  const publisherDomain = registrableDomain(article?.url || "") || null;
  return {
    db, deps, webDays, article,
    publisherDomain,
    articleImageId: article?.image_url ? imageIdentity(article.image_url) : null,
    explicitHarm: isExplicitHarmHeadline(article?.title || ""),
    sensitive: isSensitiveHeadline(article?.title || ""),
    crime: isCrimeStory(article),
    used: new Set(),           // media_url already placed in THIS video
    deadline: Date.now() + RESOLVE_BUDGET_MS(),
    wikidata: new Map(),       // subject → {qid, facts} memo for this video
  };
}

/** Is this URL the publisher's own photo, or hosted on the publisher's domain? */
export function isPublisherImage(url, pageUrl, ctx) {
  if (ctx.articleImageId && imageIdentity(url) === ctx.articleImageId) return "the article's own photo";
  if (ctx.publisherDomain) {
    for (const u of [url, pageUrl]) {
      if (u && registrableDomain(u) === ctx.publisherDomain) return `hosted on the publisher's domain (${ctx.publisherDomain})`;
    }
  }
  return null;
}

/**
 * RULE 0 ON EVERY CANDIDATE (the Pakistan KILL applies to every shot). The
 * story text passing is not enough: a Nepal glacier short once picked a Commons
 * clip titled "... Himalayas from Khyber Pakhtunkhwa". The candidate's OWN
 * metadata — title, description, author, credit, page URL — is scanned with the
 * same term list the publish gate uses. Returns a reason string, or null.
 */
export function rule0Blocks(meta) {
  const hits = scanArtifactForPakistan(meta, "shot-candidate");
  return hits.length ? `Rule 0: ${hits.map((h) => h.signal).slice(0, 3).join(", ")}` : null;
}

/**
 * The named core of a subject: its run of capitalised words. "Andaman Islands
 * coastline" → "Andaman Islands"; "Joint Base Andrews tarmac" → "Joint Base
 * Andrews". Lookups try the full subject first and fall back to this, so a
 * descriptive tail does not make a well-known place unfindable. null when the
 * subject names nothing, or when the core IS the subject.
 */
export function namedCore(subject) {
  const words = String(subject || "").trim().split(/\s+/);
  let best = [], cur = [];
  for (const w of words) {
    if (/^[A-Z0-9]/.test(w) || (cur.length && /^(of|the|de|la|and)$/i.test(w))) cur.push(w);
    else { if (cur.length > best.length) best = cur; cur = []; }
  }
  if (cur.length > best.length) best = cur;
  while (best.length && /^(of|the|de|la|and)$/i.test(best[best.length - 1])) best.pop();
  const core = best.join(" ");
  return core && core !== String(subject).trim() ? core : null;
}
const variants = (subject) => [subject, namedCore(subject)].filter(Boolean);

async function wikidataFor(subject, ctx) {
  const k = subjectKey(subject);
  if (ctx.wikidata.has(k)) return ctx.wikidata.get(k);
  let out = null;
  try {
    const hit = await (ctx.deps.wikidataSearch || commons.wikidataSearch)(subject);
    if (hit) out = { ...hit, facts: await (ctx.deps.wikidataFacts || commons.wikidataFacts)(hit.qid) };
  } catch (err) { out = { error: err.message }; }
  ctx.wikidata.set(k, out);
  return out;
}

// ─── Rungs ─────────────────────────────────────────────────────────────────────
// Each returns { record } on a fit, or { miss: "why" }. A rung never throws.

function rungReuse(shot, ctx) {
  if (!ctx.db) return { miss: "no db" };
  // A picture shot may have been answered by a lower rung last time (a place
  // shot that ended on Esri): look those up too, in ladder order, or the whole
  // ladder re-runs for nothing (measured 24 Sep: 216 s for one warm shot).
  const kinds = shot.kind === "satellite" ? ["satellite", "map"] : shot.kind === "map" ? ["map"] : ["clip", "photo", "satellite", "map"];
  for (const k of kinds) {
    for (const r of findRecords(ctx.db, shot.subject, k)) {
      if (ctx.used.has(r.media_url)) continue;
      // A stored record was judged for ANOTHER story. The rules that depend on
      // THIS story are re-applied: it may be this article's publisher photo, and
      // a crime story takes no open-web photo of anyone.
      if (isPublisherImage(r.media_url, r.source_url, ctx)) continue;
      if (ctx.crime && r.rung === "web-photo") continue;
      if (ctx.explicitHarm && !["satellite", "map"].includes(r.kind)) continue;
      if (rule0Blocks({ subject: r.subject, source_url: r.source_url, credit: r.credit, author: r.author })) continue;
      return { record: { ...r, reused: true } };
    }
  }
  return { miss: "no stored record" };
}

async function rungIncident(shot, ctx) {
  if (!ctx.db || !ctx.article?.id) return { miss: "no db/article" };
  try {
    const { renderableCandidates } = await import("../incident/incidentQueue.js");
    const rows = renderableCandidates(ctx.db, { storyKind: "article", storyId: ctx.article.id, limit: 10 });
    const row = rows.find((c) => !ctx.used.has(c.treated_path || c.local_path || c.post_url));
    if (!row) return { miss: `${rows.length} renderable candidate(s), none unused` };
    return { record: {
      subject: shot.subject, kind: row.media_type === "video" ? "clip" : "photo", rung: "incident",
      source_url: row.post_url, media_url: row.treated_path || row.local_path || row.post_url,
      licence: row.clearance_basis || null, credit: row.credit_text || row.platform, author: row.platform,
    } };
  } catch (err) { return { miss: `incident lookup failed: ${String(err.message).slice(0, 60)}` }; }
}

async function rungCommonsVideo(shot, caption, ctx) {
  if (ctx.explicitHarm) return { miss: "explicit-harm headline — no third-party footage" };
  if (Date.now() > ctx.deadline) return { miss: "resolve budget spent — skipping the slow rung" };
  const d = ctx.deps;
  // Exact phrase, then loose, then the named core — first query with hits wins.
  const queries = [`"${shot.subject}"`, shot.subject, ...(namedCore(shot.subject) ? [`"${namedCore(shot.subject)}"`] : [])];
  let titles = [];
  for (const q of queries) {
    try { titles = await (d.searchFiles || commons.searchFiles)(q, { mime: "video/webm", limit: 6 }); }
    catch (err) { return { miss: `commons search failed: ${err.message}` }; }
    if (titles.length) break;
  }
  if (!titles.length) return { miss: "no Commons video for the subject" };
  const infos = await (d.fileInfo || commons.fileInfo)(titles).catch(() => []);
  let blocked = 0;
  const usable = infos.filter((i) => {
    const why = rule0Blocks({ title: i.title, description: i.description, author: i.author, credit: i.credit, url: i.descUrl });
    if (why) { blocked++; logger.info(`🚫 ${why} — refused Commons ${String(i.title).slice(0, 60)}`); return false; }
    return commons.licenceUsable(i.licence) && (i.duration || 0) >= MIN_CLIP_SECS;
  });
  const refused = infos.length - usable.length;
  let tried = 0;
  for (const info of usable) {
    if (tried >= MAX_VIDEO_CANDIDATES) break;
    // The RENDER transcode must exist, and Commons only makes the standard
    // heights at or below the source's own. So walk down from the largest that
    // fits and keep the first one ffprobe verifies — never assume a height.
    const heights = TRANSCODE_HEIGHTS.filter((h) => h <= (info.height || 0));
    if (!heights.length) continue;
    const first = commons.transcodeUrl(info.title, heights[0]);
    if (ctx.used.has(first) || (ctx.db && isRejected(ctx.db, first))) continue;
    tried++;
    let renderUrl = null, p = null;
    for (const h of heights) {
      const u = commons.transcodeUrl(info.title, h);
      const pr = await (d.probeVideo || media.probeVideo)(u);
      if (pr.ok) { renderUrl = u; p = pr; break; }
    }
    if (!renderUrl) { logger.info(`🎞 commons ${info.title.slice(0, 50)}: no transcode verified at ${heights.join("/")}p`); continue; }
    // Frames for the vision check come from the smallest verified-or-likely
    // transcode: cheaper seeks, and the vision model needs no more than 360 px.
    const probeUrl = heights.includes(360) ? commons.transcodeUrl(info.title, 360) : renderUrl;
    const s = await (d.sampleFrames || media.sampleFrames)(probeUrl, p.duration);
    if (!s.frames.length) continue;
    const v = await (d.pickInPoints || vision.pickInPoints)({ frames: s.frames, subject: shot.subject, caption, clipTitle: info.title });
    const base = { subject: shot.subject, kind: "clip", rung: "commons-video", source_url: info.descUrl, media_url: renderUrl,
      licence: info.licence, author: info.author, credit: commons.creditLine(info, "Video"), width: info.width, height: info.height,
      duration_s: p.duration, found_for: ctx.article?.id };
    if (!v.ok) { logger.info(`🎞 commons ${info.title.slice(0, 50)}: vision unverified — ${v.reason}`); continue; }
    if (v.sensitive) {
      if (ctx.db) upsertRecord(ctx.db, { ...base, status: "rejected", reject_reason: `sensitive frames: ${v.reason}`.slice(0, 200) });
      continue;
    }
    if (!v.picks.length) continue;
    const crop = cropFor({ author: info.author, credit: info.credit, title: info.title }, { bannerSeen: v.picks.some((x) => x.banner) || v.bannerAt !== null });
    // Each in-point carries the only part of the 1080p file the renderer will read.
    const in_points = v.picks.map((x) => ({ ...x, window: media.windowFor(x.t, p.duration) }));
    return { record: { ...base, in_points, crop, coveredSecs: s.coveredSecs,
      note: s.coveredSecs < p.duration ? `sampled first ${Math.round(s.coveredSecs)}s of ${Math.round(p.duration)}s` : null } };
  }
  return { miss: `${infos.length} Commons video(s): ${refused} refused (${blocked} Rule 0, rest licence/length), ${tried} tried, none fit` };
}

async function judgeAndRecord({ shot, caption, ctx, url, pageUrl, buf, base }) {
  const j = await (ctx.deps.judgePhoto || vision.judgePhoto)({ jpeg: buf, subject: shot.subject, caption, crimeStory: ctx.crime });
  if (!j.ok) return { miss: `vision unverified — ${j.reason}` };
  if (!j.usable) {
    const why = [!j.matches && "does not show the subject", j.sensitive && "sensitive", j.screenshot && "social/screen capture", j.privatePerson && "private individual"].filter(Boolean).join(", ");
    if (ctx.db && (j.sensitive || j.screenshot || j.privatePerson)) upsertRecord(ctx.db, { ...base, status: "rejected", reject_reason: why });
    return { miss: why };
  }
  return { record: base };
}

async function rungWebPhoto(shot, caption, ctx) {
  if (ctx.explicitHarm) return { miss: "explicit-harm headline — no third-party photos" };
  const d = ctx.deps;
  if (!d.webSearch) return { miss: "web image search not configured" };
  // CRIME STORY + A PERSON: no open-web photo at all. A news photo of the
  // accused is exactly the private-individual picture the rule forbids.
  if (ctx.crime) {
    const wd = await wikidataFor(shot.subject, ctx);
    if (wd?.facts?.isHuman || (!wd && looksNamed(shot.subject))) return { miss: "crime story, person subject — no open-web photo of people" };
  }
  let results;
  try { results = await d.webSearch(shot.subject, { headline: ctx.article?.title || "", days: ctx.webDays, limit: 8 }); }
  catch (err) { return { miss: `web search failed: ${err.message}` }; }
  const reasons = [];
  for (const c of results || []) {
    if (c.confidence !== "high") { reasons.push("low confidence"); continue; }
    const pub = isPublisherImage(c.imageUrl, c.pageUrl, ctx);
    if (pub) { reasons.push(pub); continue; }
    if (/instagram|facebook|twitter|tiktok|x\.com|screenshot/i.test(`${c.host} ${c.title}`)) { reasons.push("social"); continue; }
    const r0 = rule0Blocks({ title: c.title, url: c.pageUrl, host: c.host });
    if (r0) { reasons.push(r0); continue; }
    if (ctx.used.has(c.imageUrl) || (ctx.db && isRejected(ctx.db, c.imageUrl))) continue;
    const got = await (d.fetchImage)(c.imageUrl, c.pageUrl);
    if (!got?.buf) { reasons.push("fetch failed"); continue; }
    const base = { subject: shot.subject, kind: "photo", rung: "web-photo", source_url: c.pageUrl, media_url: c.imageUrl,
      licence: "news photo — open-web use authorised by DrJ 30 Aug 2026", credit: `Photo: ${c.host}`, author: c.host, found_for: ctx.article?.id };
    const r = await judgeAndRecord({ shot, caption, ctx, url: c.imageUrl, pageUrl: c.pageUrl, buf: got.buf, base });
    if (r.record) return r;
    reasons.push(r.miss);
  }
  return { miss: `no usable web photo (${[...new Set(reasons)].join("; ") || "no results"})` };
}

async function rungCommonsPhoto(shot, caption, ctx) {
  if (ctx.explicitHarm) return { miss: "explicit-harm headline — no third-party photos" };
  const d = ctx.deps;
  const titles = [];
  for (const v of variants(shot.subject)) {
    const wd = await wikidataFor(v, ctx);
    if (wd?.facts?.image) titles.push(`File:${wd.facts.image}`);
    try { for (const t of await (d.searchFiles || commons.searchFiles)(`"${v}"`, { mime: "image/jpeg", limit: 4 })) titles.push(t); }
    catch { /* the P18 image alone may still serve */ }
    if (titles.length) break;
  }
  if (!titles.length) return { miss: "no Commons/Wikidata photo" };
  const infos = await (d.fileInfo || commons.fileInfo)([...new Set(titles)].slice(0, 5)).catch(() => []);
  for (const info of infos) {
    if (rule0Blocks({ title: info.title, description: info.description, author: info.author, credit: info.credit, url: info.descUrl })) continue;
    if (!commons.licenceUsable(info.licence)) continue;
    if ((info.width || 0) < 800) continue;
    const thumb = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(commons.underscored(info.title))}?width=1280`;
    if (ctx.used.has(thumb) || (ctx.db && isRejected(ctx.db, thumb))) continue;
    const got = await (d.fetchCommonsImage || commons.fetchCommonsImage)(thumb);
    if (!got?.buf) continue;
    const base = { subject: shot.subject, kind: "photo", rung: "commons-photo", source_url: info.descUrl, media_url: thumb,
      licence: info.licence, author: info.author, credit: commons.creditLine(info, "Photo"), width: info.width, height: info.height,
      found_for: ctx.article?.id };
    const r = await judgeAndRecord({ shot, caption, ctx, url: thumb, pageUrl: info.descUrl, buf: got.buf, base });
    if (r.record) return r;
  }
  return { miss: `${infos.length} Commons photo(s), none usable` };
}

async function placeFor(shot, ctx) {
  for (const v of variants(shot.subject)) {
    const iso = countryByName(v);
    if (iso) return { lat: null, lon: null, codes: [iso], zoom: 4, how: "country", name: v };
    const city = findCity(v);
    if (city) return { lat: city.o[1], lon: city.o[0], codes: [city.c], zoom: 11, how: "atlas city", name: v };
    const sea = marinePlace(v);
    if (sea) return { lat: sea.lat, lon: sea.lon, codes: [], zoom: sea.kind === "strait" || sea.kind === "canal" ? 8 : 5,
      how: `marine ${sea.kind}${sea.hand ? " (hand-added)" : ""}`, name: sea.name };
  }
  for (const v of variants(shot.subject)) {
    const wd = await wikidataFor(v, ctx);
    if (wd?.facts?.coords) return { ...wd.facts.coords, codes: [], zoom: 11, how: `wikidata ${wd.qid} (${v})`, name: v };
  }
  return null;
}

async function rungEsri(shot, ctx) {
  if (rule0Blocks({ subject: shot.subject })) return { miss: "Rule 0" };
  const place = await placeFor(shot, ctx);
  if (!place || place.lat === null) return { miss: place ? "a country, not a point — the map rung draws it" : "no coordinates for the subject" };
  if (place.codes?.includes("PAK")) return { miss: "Rule 0 — the place is in Pakistan" };
  return { record: { subject: shot.subject, kind: "satellite", rung: "esri", media_url: `esri:${place.lat.toFixed(4)},${place.lon.toFixed(4)}`,
    source_url: ESRI_TILE, licence: "Esri World Imagery — attribution required", credit: ESRI_CREDIT,
    coords: { lat: place.lat, lon: place.lon, zoom: place.zoom, how: place.how }, found_for: ctx.article?.id } };
}

/** One place → {code, city?, lat?, lon?} using the atlas, then Wikidata's country (P17 → P298). */
async function resolvePlace(name, ctx) {
  for (const v of variants(name)) {
    const iso = countryByName(v);
    if (iso) return { name: v, code: iso };
    const city = findCity(v);
    if (city) return { name: v, code: city.c, city: v, lat: city.o[1], lon: city.o[0] };
    const sea = marinePlace(v);
    if (sea) return { name: sea.name, code: null, lat: sea.lat, lon: sea.lon, marine: sea.kind };
  }
  for (const v of variants(name)) {
    const wd = await wikidataFor(v, ctx);
    if (!wd?.facts) continue;
    if (wd.facts.iso3) return { name: v, code: wd.facts.iso3 };
    if (wd.facts.countryQid) {
      try {
        const cf = await (ctx.deps.wikidataFacts || commons.wikidataFacts)(wd.facts.countryQid);
        if (cf?.iso3) return { name: v, code: cf.iso3, ...(wd.facts.coords || {}), region: true };
      } catch { /* fall through */ }
    }
    if (wd.facts.coords) return { name: v, code: null, ...wd.facts.coords };
  }
  return null;
}

async function rungNaturalEarth(shot, ctx) {
  if (rule0Blocks({ subject: shot.subject })) return { miss: "Rule 0" };
  // The whole subject first (a single place, or a name that contains "and"),
  // then — MULTI-PLACE MAPS — each named part, so "United States and China"
  // draws both countries rather than falling to a card.
  const whole = await placeFor(shot, ctx);
  const parts = splitPlaces(shot.subject);
  let places = [];
  if (parts.length > 1) {
    for (const part of parts) { const p = await resolvePlace(part, ctx); if (p) places.push(p); }
    if (places.length < 2) places = [];
  }
  if (!places.length && !whole) return { miss: "no country, atlas city or coordinates for the subject" };
  if (!places.length && whole.codes?.includes("PAK")) return { miss: "Rule 0 — the place is in Pakistan" };
  const coords = places.length
    ? { codes: [...new Set(places.map((p) => p.code).filter(Boolean))], places, how: `${places.length} places` }
    : { lat: whole.lat, lon: whole.lon, codes: whole.codes, zoom: whole.zoom, how: whole.how };
  if (places.some((p) => rule0Blocks({ code: p.code, name: p.name }) || p.code === "PAK")) return { miss: "Rule 0 — a place in the map is Pakistan" };
  return { record: { subject: shot.subject, kind: "map", rung: "natural-earth", media_url: `ne:${subjectKey(shot.subject)}`,
    licence: "Natural Earth — public domain", credit: "Map: Natural Earth", coords, found_for: ctx.article?.id } };
}

async function rungStock(shot, ctx) {
  if (!ctx.deps.stockImage) return { miss: "stock not configured" };
  // STOCK IS FOR ABSTRACT BEATS ONLY — never a named person or place.
  if (looksNamed(shot.subject) || !isAbstractQuery(shot.subject)) return { miss: "named subject — stock is for abstract beats only" };
  const hit = await ctx.deps.stockImage(shot.subject).catch(() => null);
  if (!hit) return { miss: "no relevant stock" };
  return { record: { subject: shot.subject, kind: "photo", rung: "stock", media_url: hit.url, source_url: hit.url,
    licence: "Pexels licence", credit: `Photo: ${hit.credit}`, found_for: ctx.article?.id } };
}

// ─── The ladder ─────────────────────────────────────────────────────────────

/** Which rungs a shot walks, in order. Type kinds need no search at all. */
export function ladderFor(shot) {
  if (TYPE_KINDS.has(shot.kind)) return ["card"];
  if (shot.kind === "map") return ["reuse", "natural-earth", "card"];
  if (shot.kind === "satellite") return ["reuse", "esri", "natural-earth", "card"];
  return ["reuse", "incident", "commons-video", "web-photo", "commons-photo", "esri", "natural-earth", "stock", "card"];
}

/**
 * Resolve one shot. Returns { rung, record|null, trail:[{rung, outcome}] }.
 * A card is a valid answer; it is not an error.
 */
export async function resolveShot(shot, caption, ctx) {
  const trail = [];
  for (const rung of ladderFor(shot)) {
    let r;
    try {
      switch (rung) {
        case "reuse":         r = rungReuse(shot, ctx); break;
        case "incident":      r = await rungIncident(shot, ctx); break;
        case "commons-video": r = await rungCommonsVideo(shot, caption, ctx); break;
        case "web-photo":     r = await rungWebPhoto(shot, caption, ctx); break;
        case "commons-photo": r = await rungCommonsPhoto(shot, caption, ctx); break;
        case "esri":          r = await rungEsri(shot, ctx); break;
        case "natural-earth": r = await rungNaturalEarth(shot, ctx); break;
        case "stock":         r = await rungStock(shot, ctx); break;
        case "card":          r = { record: null }; break;
      }
    } catch (err) {
      r = { miss: `rung threw: ${String(err.message).slice(0, 80)}` };
    }
    if (r.record !== undefined) {
      trail.push({ rung, outcome: r.record ? (r.record.reused ? "reused" : "found") : "card" });
      if (r.record) {
        ctx.used.add(r.record.media_url);
        if (ctx.db) {
          const id = r.record.reused ? r.record.id : upsertRecord(ctx.db, r.record);
          if (id) markUsed(ctx.db, id);
        }
      }
      return { rung: r.record ? (r.record.reused ? `reuse:${r.record.rung}` : rung) : "card", record: r.record, trail };
    }
    trail.push({ rung, outcome: r.miss });
  }
  return { rung: "card", record: null, trail };
}

/** Resolve every shot of a validated spec, in order. */
export async function resolveSpecShots(spec, article, { db = null, deps = {}, webDays = 7 } = {}) {
  const ctx = contextFor(article, { db, deps, webDays });
  const out = [];
  for (const [i, card] of (spec?.slides || []).entries()) {
    for (const [j, shot] of (card.shots || []).entries()) {
      const res = await resolveShot(shot, card.caption, ctx);
      out.push({ slide: i, shot: j, anchor: shot.anchor, kind: shot.kind, subject: shot.subject, ...res });
      logger.info(`🎯 shot ${i}.${j} ${shot.kind} "${String(shot.subject).slice(0, 40)}" → ${res.rung}` +
        `${res.record?.credit ? ` · ${res.record.credit}` : ""}`);
    }
  }
  const byRung = out.reduce((m, r) => ({ ...m, [r.rung]: (m[r.rung] || 0) + 1 }), {});
  // REAL IMAGERY (DrJ, 24 Sep): a found picture, OR a headline clipping — a
  // real outlet's real headline is real imagery even though it is typeset.
  const real = out.filter((r) => r.record || r.kind === "headline").length;
  const video = out.filter((r) => r.record?.kind === "clip").length;
  return { shots: out, stats: { shots: out.length, byRung, realShare: out.length ? real / out.length : 0, videoShare: out.length ? video / out.length : 0 },
    context: { crime: ctx.crime, sensitive: ctx.sensitive, explicitHarm: ctx.explicitHarm, publisherDomain: ctx.publisherDomain } };
}
