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

export const RUNGS = Object.freeze([
  "reuse", "incident", "commons-video", "web-photo", "commons-photo", "esri", "natural-earth", "stock", "card",
]);
const PICTURE_KINDS = new Set(["clip", "photo", "quote"]);
const TYPE_KINDS = new Set(["headline", "punch", "count", "graphic"]);
export const ESRI_CREDIT = "Imagery: Esri World Imagery (Maxar, Earthstar Geographics)";
export const ESRI_TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const MIN_CLIP_SECS = 4;
export const MAX_VIDEO_CANDIDATES = 2;   // per shot: each costs a probe, ~16 seeks and one vision call

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
  return _countries.get(n) || null;
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
  const kinds = shot.kind === "satellite" ? ["satellite"] : shot.kind === "map" ? ["map"] : ["clip", "photo"];
  for (const k of kinds) {
    for (const r of findRecords(ctx.db, shot.subject, k)) {
      if (ctx.used.has(r.media_url)) continue;
      // A stored record was judged for ANOTHER story. The rules that depend on
      // THIS story are re-applied: it may be this article's publisher photo, and
      // a crime story takes no open-web photo of anyone.
      if (isPublisherImage(r.media_url, r.source_url, ctx)) continue;
      if (ctx.crime && r.rung === "web-photo") continue;
      if (ctx.explicitHarm && !["satellite", "map"].includes(r.kind)) continue;
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
  const d = ctx.deps;
  let titles;
  try { titles = await (d.searchFiles || commons.searchFiles)(`"${shot.subject}"`, { mime: "video/webm", limit: 6 }); }
  catch (err) { return { miss: `commons search failed: ${err.message}` }; }
  if (!titles.length) {
    try { titles = await (d.searchFiles || commons.searchFiles)(shot.subject, { mime: "video/webm", limit: 6 }); }
    catch { titles = []; }
  }
  if (!titles.length) return { miss: "no Commons video for the subject" };
  const infos = await (d.fileInfo || commons.fileInfo)(titles).catch(() => []);
  const usable = infos.filter((i) => commons.licenceUsable(i.licence) && (i.duration || 0) >= MIN_CLIP_SECS);
  const refused = infos.length - usable.length;
  let tried = 0;
  for (const info of usable) {
    if (tried >= MAX_VIDEO_CANDIDATES) break;
    const renderUrl = commons.transcodeUrl(info.title, Math.min(1080, info.height >= 1080 ? 1080 : 720));
    if (ctx.used.has(renderUrl) || (ctx.db && isRejected(ctx.db, renderUrl))) continue;
    tried++;
    const probeUrl = commons.transcodeUrl(info.title, 480);
    const p = await (d.probeVideo || media.probeVideo)(probeUrl);
    if (!p.ok) { logger.info(`🎞 commons ${info.title.slice(0, 50)}: transcode not verified — ${p.reason}`); continue; }
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
    return { record: { ...base, in_points: v.picks, crop, coveredSecs: s.coveredSecs,
      note: s.coveredSecs < p.duration ? `sampled first ${Math.round(s.coveredSecs)}s of ${Math.round(p.duration)}s` : null } };
  }
  return { miss: `${infos.length} Commons video(s): ${refused} refused on licence/length, ${tried} tried, none fit` };
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
  const wd = await wikidataFor(shot.subject, ctx);
  const titles = [];
  if (wd?.facts?.image) titles.push(`File:${wd.facts.image}`);
  try { for (const t of await (d.searchFiles || commons.searchFiles)(`"${shot.subject}"`, { mime: "image/jpeg", limit: 4 })) titles.push(t); }
  catch { /* the P18 image alone may still serve */ }
  if (!titles.length) return { miss: "no Commons/Wikidata photo" };
  const infos = await (d.fileInfo || commons.fileInfo)([...new Set(titles)].slice(0, 5)).catch(() => []);
  for (const info of infos) {
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
  const iso = countryByName(shot.subject);
  if (iso) return { lat: null, lon: null, codes: [iso], zoom: 4, how: "country" };
  const city = findCity(shot.subject);
  if (city) return { lat: city.o[1], lon: city.o[0], codes: [city.c], zoom: 11, how: "atlas city" };
  const wd = await wikidataFor(shot.subject, ctx);
  if (wd?.facts?.coords) return { ...wd.facts.coords, codes: [], zoom: 13, how: `wikidata ${wd.qid}` };
  return null;
}

async function rungEsri(shot, ctx) {
  const place = await placeFor(shot, ctx);
  if (!place || place.lat === null) return { miss: place ? "a country, not a point — the map rung draws it" : "no coordinates for the subject" };
  return { record: { subject: shot.subject, kind: "satellite", rung: "esri", media_url: `esri:${place.lat.toFixed(4)},${place.lon.toFixed(4)}`,
    source_url: ESRI_TILE, licence: "Esri World Imagery — attribution required", credit: ESRI_CREDIT,
    coords: { lat: place.lat, lon: place.lon, zoom: place.zoom, how: place.how }, found_for: ctx.article?.id } };
}

async function rungNaturalEarth(shot, ctx) {
  const place = await placeFor(shot, ctx);
  if (!place) return { miss: "no country, atlas city or coordinates for the subject" };
  return { record: { subject: shot.subject, kind: "map", rung: "natural-earth", media_url: `ne:${subjectKey(shot.subject)}`,
    licence: "Natural Earth — public domain", credit: "Map: Natural Earth",
    coords: { lat: place.lat, lon: place.lon, codes: place.codes, zoom: place.zoom, how: place.how }, found_for: ctx.article?.id } };
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
  const real = out.filter((r) => r.record && !["card"].includes(r.rung)).length;
  const video = out.filter((r) => r.record?.kind === "clip").length;
  return { shots: out, stats: { shots: out.length, byRung, realShare: out.length ? real / out.length : 0, videoShare: out.length ? video / out.length : 0 },
    context: { crime: ctx.crime, sensitive: ctx.sensitive, explicitHarm: ctx.explicitHarm, publisherDomain: ctx.publisherDomain } };
}
