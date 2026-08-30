/**
 * videoBeatImagery.js — one picture per beat, chosen by WHO VOUCHED FOR IT.
 *
 * The format's old shape was a slideshow: one article photo, reused on rotated
 * mounts, everything else type on black. Adding more pictures to that produces
 * the same slideshow with better pictures. The target (DrJ, 2026-08-30) inverts
 * it — imagery is the DEFAULT and a card is what happens when nothing
 * trustworthy was found.
 *
 * ─── The tier order is a TRUST order, not a quality order ───────────────────
 *
 *   1 BODY     the images the article itself carries. A picture editor chose
 *              them FOR THIS STORY, which no search result can claim. The card
 *              cascade already fetches up to six of these and throws five away
 *              (measured: it stops at the first acceptable one). This tier is
 *              those five.
 *   2 ENTITY   a named person / place / org → its Wikidata QID → P18. An EXACT
 *              identifier match, so there is no free-text relevance to get
 *              wrong. A miss falls through silently.
 *   3 STOCK    platform stock, ABSTRACT BEATS ONLY. "winter landscape" has no
 *              wrong answer; "Qalandiya Training Centre" does, and a plausible
 *              stock school gate is the exact failure this must never produce.
 *   4 CARD     the honest fallback, and at 12 renders a day unattended this is
 *              the path that matters most.
 *
 * CONFIDENCE IS NOT A SCORE. Nothing here judges an image against an intent —
 * that is the machinery that produced the polar bear (see relevance.js's
 * acceptance test). Confidence falls out of WHICH TIER ANSWERED: body and
 * entity mean "we found THIS thing", stock means "we found something matching
 * the words", and anything below that is a card rather than a gamble.
 *
 * ─── Sensitivity: both tiers apply, per provenance ──────────────────────────
 *
 * Body imagery is publisher-vetted, so it takes the NARROW bar
 * (isExplicitHarmHeadline). Entity and stock were vetted against this story by
 * nobody, so they take the BROAD one. See editorialSensitivity.js.
 *
 * ─── No library ─────────────────────────────────────────────────────────────
 *
 * Everything is fetched at render time into the job's temp dir and swept with
 * it. The only durable state is a 24h query cache of SEARCH RESULTS (small
 * JSON), which is the pattern videoFootage.js already uses — never the images.
 */

import path from "path";
import { logger } from "./logger.js";
import {
  tryFetchImage, extractImageCandidatesFromHtml, upscaleKnownThumbnailUrl,
  readImageDimensions, MIN_PHOTO_WIDTH, MIN_PHOTO_HEIGHT,
} from "./cardRenderer.js";
import { isExplicitHarmHeadline, isSensitiveHeadline } from "./editorialSensitivity.js";
import { isAbstractQuery, candidateMatches } from "./videoImageRelevance.js";

/** Default OFF. The merge is inert until DrJ has ruled on a sample. */
export const beatImageryEnabled = () => process.env.VIDEO_BEAT_IMAGERY_ENABLED === "1";

/**
 * Ken Burns on a still is OFF by default and deliberately so: the slide pan was
 * removed for eye strain (videoAssembler's header), and a drifting photo is the
 * same complaint wearing a different hat. A static, well-cropped photo beats a
 * moving one until DrJ says otherwise on a sample.
 */
export const beatImageryMotionEnabled = () => process.env.VIDEO_BEAT_IMAGERY_MOTION === "1";

/** Wrappers carry the format, not the story. They never take a picture. */
const WRAPPER_TYPES = new Set(["title", "kicker"]);
/** These already carry imagery of their own; a second picture would replace it. */
const SELF_IMAGED_TYPES = new Set(["map"]);

export const TIERS = Object.freeze({ BODY: "body", ENTITY: "entity", STOCK: "stock", CARD: "card" });
/** Confidence is a label for WHICH TIER ANSWERED, never a computed score. */
export const CONFIDENCE = Object.freeze({ body: "high", entity: "high", stock: "medium", card: null });

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * The search intent for one beat.
 *
 * MEASURED, and the reason this function exists: the spec writer emits a
 * `visual`/`subject` noun on only about a third of beats — 31 of 48 eligible
 * beats in the 20-article dry run had no intent at all, and that, not image
 * scarcity, was what capped coverage at 33%. Deriving an intent for the rest
 * took the same run to full coverage.
 *
 * The SOURCE of the intent is carried on the result, because a machine-guessed
 * query is a weaker claim than an author-written one and the tiers below treat
 * it as such.
 */
export function intentForBeat(slide = {}, { entities = [] } = {}) {
  if (WRAPPER_TYPES.has(slide.t)) return { intent: null, source: null, reason: "wrapper" };
  if (SELF_IMAGED_TYPES.has(slide.t)) return { intent: null, source: null, reason: "self-imaged" };

  const written = slide.subject || slide.visual;
  if (written) return { intent: String(written), source: "writer", reason: null };

  const caption = String(slide.caption || "");
  // An entity NAMED IN THIS BEAT's caption is a far better guess than keywords,
  // and it is the only derivation that can legitimately reach the entity tier.
  const capNorm = norm(caption);
  const hit = entities.find((e) => {
    const label = norm(e.label || e.surface);
    return label.length >= 4 && capNorm.includes(label);
  });
  if (hit) return { intent: hit.label || hit.surface, source: "derived-entity", qid: hit.qid, reason: null };

  const STOP = new Set(("the a an of to in on for and or but with from into over after before their its his her they "
    + "this that has have had was were are is be been will would could than then now not no more most about across "
    + "against said says say when what which who whom whose it as at by").split(" "));
  const words = caption.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
  if (words.length >= 2) return { intent: words.slice(0, 3).join(" "), source: "derived-caption", reason: null };

  return { intent: null, source: null, reason: "no-intent-derivable" };
}

/**
 * Every usable image the article itself carries, best first.
 *
 * TWO SOURCES OF HTML, and the second is the whole lever. Measured across 20
 * production articles: mining the STORED `content` column yielded ZERO
 * candidates on every single one, because the enricher stores plain text and
 * the miner needs markup. Fetching the live page yielded up to six. Stored
 * content is still mined first — it is free, and one day it may carry markup.
 */
export async function buildBodyPool(article, {
  limit = 6,
  _fetchImage = tryFetchImage,
  _fetchPage = defaultFetchPage,
  _log = logger,
} = {}) {
  const seen = new Set();
  const urls = [];
  const push = (u) => { if (u && !seen.has(u)) { seen.add(u); urls.push(u); } };

  if (article?.image_url) {
    push(upscaleKnownThumbnailUrl(article.image_url));
    push(article.image_url);
  }
  for (const c of extractImageCandidatesFromHtml(article?.content || "")) push(c);

  // EVERY FETCH IS WRAPPED HERE, not only inside the default implementation.
  // This function is on the render path and an injected fetcher is still a
  // fetcher: a throw from one must cost the beat its tier, never the video.
  let live = 0;
  if (article?.url) {
    let html = null;
    try { html = await _fetchPage(article.url); }
    catch (err) { _log.warn(`🖼 body pool: live page threw — ${String(err.message).slice(0, 90)}`); }
    if (html) {
      const found = extractImageCandidatesFromHtml(html);
      live = found.length;
      for (const c of found) push(c);
    }
  }

  let referer = "https://www.google.com/";
  try { referer = new URL(article.url).origin + "/"; } catch { /* keep the default */ }

  const pool = [];
  const sigs = new Set();
  for (const url of urls) {
    if (pool.length >= limit) break;
    let got = null;
    try { got = await _fetchImage(url, referer); }
    catch { continue; }        // one bad URL is not a reason to abandon the pool
    if (!got) continue;
    const dims = readImageDimensions(got.buf);
    if (!dims || dims.width < MIN_PHOTO_WIDTH || dims.height < MIN_PHOTO_HEIGHT) continue;
    // The same picture is routinely served at several URLs (srcset, CDN
    // variants). Without this the pool fills with one image wearing six hats
    // and every beat gets the same photograph — the slideshow, restored.
    const sig = `${dims.width}x${dims.height}:${Math.round(got.buf.length / 4096)}`;
    if (sigs.has(sig)) continue;
    sigs.add(sig);
    pool.push({ url, buf: got.buf, dims });
  }
  _log.info(`🖼 body pool: ${pool.length} usable of ${urls.length} candidate(s) (live page contributed ${live})`);
  return pool;
}

async function defaultFetchPage(url) {
  try {
    const { default: axios } = await import("axios");
    const { data } = await axios.get(url, {
      timeout: 12000, maxRedirects: 5, responseType: "text",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
          + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    return typeof data === "string" ? data : null;
  } catch (err) {
    // A page that will not load costs this article its body tier, not its video.
    logger.warn(`🖼 body pool: live page unavailable — ${String(err.message).slice(0, 90)}`);
    return null;
  }
}

/**
 * Resolve one beat, tier by tier, stopping at the first that answers.
 *
 * Returns a pick or null. NEVER THROWS: this sits on the render path, and a
 * beat with no picture is a card, which is a correct video.
 */
export async function resolveBeat({
  slide, article, entities = [], pool, poolCursor,
  _entityImage, _stockImage, _log = logger,
} = {}) {
  const { intent, source, reason, qid } = intentForBeat(slide, { entities });
  const base = { slideIndex: slide?._i ?? null, intent, intentSource: source };

  if (!intent) return { ...base, tier: TIERS.CARD, confidence: null, reason: reason || "no-intent" };

  const publisherAllowed = !isExplicitHarmHeadline(article?.title);
  const thirdPartyAllowed = !isSensitiveHeadline(article?.title);

  // ── 1. BODY ───────────────────────────────────────────────────────────────
  if (publisherAllowed && pool && poolCursor.i < pool.length) {
    const img = pool[poolCursor.i++];
    return { ...base, tier: TIERS.BODY, confidence: CONFIDENCE.body,
             imageUrl: img.url, buffer: img.buf, credit: article?.source_name || null };
  }

  // ── 2. ENTITY ─────────────────────────────────────────────────────────────
  if (thirdPartyAllowed && _entityImage) {
    const ent = qid ? { qid, label: intent }
      : entities.find((e) => {
          const label = norm(e.label || e.surface);
          return label.length >= 4 && (norm(intent).includes(label) || label.includes(norm(intent)));
        });
    if (ent?.qid) {
      try {
        const got = await _entityImage(ent);
        if (got) {
          return { ...base, tier: TIERS.ENTITY, confidence: CONFIDENCE.entity,
                   imageUrl: got.url, buffer: got.buf, credit: got.credit, entity: ent.label || intent, qid: ent.qid };
        }
      } catch (err) { _log.warn(`🖼 entity tier failed for ${ent.qid} — ${String(err.message).slice(0, 80)}`); }
    }
    // A NAMED SUBJECT WITH NO PORTRAIT DOES NOT FALL TO STOCK. This is the rule
    // that keeps a plausible-but-wrong stock building off a named facility.
    if (ent?.qid || !isAbstractQuery(intent)) {
      return { ...base, tier: TIERS.CARD, confidence: null,
               reason: "named subject, no exact image — stock is forbidden here" };
    }
  }

  // ── 3. STOCK, abstract only ───────────────────────────────────────────────
  if (thirdPartyAllowed && _stockImage && isAbstractQuery(intent)) {
    try {
      const got = await _stockImage(intent);
      if (got) {
        return { ...base, tier: TIERS.STOCK, confidence: CONFIDENCE.stock,
                 imageUrl: got.url, buffer: got.buf, credit: got.credit, stockTitle: got.title };
      }
    } catch (err) { _log.warn(`🖼 stock tier failed for "${intent}" — ${String(err.message).slice(0, 80)}`); }
  }

  const why = !publisherAllowed && !thirdPartyAllowed ? "sensitive headline"
    : !isAbstractQuery(intent) ? "named subject, nothing exact found"
    : "no candidate passed the relevance gate";
  return { ...base, tier: TIERS.CARD, confidence: null, reason: why };
}

/**
 * Resolve a whole spec, in slide order.
 *
 * ─── What the inversion changes in the selection rules ──────────────────────
 *
 * The old rules were written when a cutaway was a rare garnish over a type
 * card. Under imagery-by-default their PREMISE is gone, so they are restated
 * rather than retuned:
 *
 *   MAX_CUTAWAYS = 2        → dropped as a count. It existed so footage read as
 *                             rhythm rather than wallpaper; when imagery IS the
 *                             format, a ceiling of two would cap the format.
 *   never-consecutive       → INVERTED IN SUBJECT. Adjacent beats may both
 *                             carry pictures; what may not repeat is the
 *                             TREATMENT — see `noAdjacentRepeat` below. Five
 *                             identical mounts in a row is the new montage.
 *   one contributor / video → SPLIT BY TIER. The publisher is one contributor
 *                             by definition, so applying it to the body tier
 *                             would outlaw the body pool past image #1. Kept
 *                             for stock, where it was earned (six of one film's
 *                             eight clips came from a single shoot).
 *   sensitive suppression   → now per-tier, per PR #132, rather than whole-video.
 */
export async function resolveSpecImagery({
  slides = [], article, entities = [], deps = {},
} = {}) {
  const { _pool, _entityImage, _stockImage, _log = logger } = deps;

  const pool = _pool !== undefined ? _pool
    : (isExplicitHarmHeadline(article?.title) ? [] : await buildBodyPool(article, { _log }));
  const poolCursor = { i: 0 };
  const picks = [];
  const stockCreators = new Set();

  for (let i = 0; i < slides.length; i++) {
    const slide = { ...slides[i], _i: i };
    let pick = await resolveBeat({ slide, article, entities, pool, poolCursor, _entityImage, _stockImage, _log });

    // ONE CONTRIBUTOR PER VIDEO — stock only. Publisher-owned body imagery is
    // exempt: the publisher IS the single contributor, and the rule would
    // otherwise delete the tier it is supposed to diversify.
    if (pick.tier === TIERS.STOCK && pick.credit) {
      const who = norm(pick.credit);
      if (stockCreators.has(who)) {
        pick = { ...pick, tier: TIERS.CARD, confidence: null, buffer: undefined,
                 reason: `contributor "${pick.credit}" already used in this video` };
      } else { stockCreators.add(who); }
    }
    picks.push(pick);
  }

  return { picks, poolSize: pool.length, ...coverageOf(picks) };
}

/**
 * Treatment must differ between adjacent picture beats.
 *
 * The anti-wallpaper concern SURVIVES the cap inversion, it just moves: with
 * cutaways rare, quantity was the risk; with imagery default, sameness is.
 * Takes the mount rotation the caller already has and guarantees no two
 * neighbouring pictures share one.
 */
export function noAdjacentRepeat(picks = [], mounts = ["cutting", "polaroid", "pinned"]) {
  let last = null, mi = 0;
  return picks.map((p) => {
    if (p.tier === TIERS.CARD) { last = null; return p; }
    let m = mounts[mi % mounts.length];
    if (m === last) { mi += 1; m = mounts[mi % mounts.length]; }
    mi += 1; last = m;
    return { ...p, mount: m };
  });
}

/** The acceptance numbers, computed where the picks are so they cannot drift. */
export function coverageOf(picks = []) {
  const by = { body: 0, entity: 0, stock: 0, card: 0 };
  for (const p of picks) by[p.tier] = (by[p.tier] || 0) + 1;
  const eligible = picks.filter((p) => p.intent || p.tier !== TIERS.CARD).length;
  const withImage = by.body + by.entity + by.stock;
  return {
    bySource: by,
    beats: picks.length,
    eligible,
    imageryShare: picks.length ? withImage / picks.length : 0,
    eligibleShare: eligible ? withImage / eligible : 0,
  };
}
