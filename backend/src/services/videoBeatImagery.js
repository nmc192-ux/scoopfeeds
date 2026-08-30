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
import { execFileSync } from "child_process";
import { getFFmpegPath } from "./videoGenerator.js";
import { logger } from "./logger.js";
import {
  tryFetchImage, extractImageCandidatesFromHtml, upscaleKnownThumbnailUrl,
  readImageDimensions, MIN_PHOTO_WIDTH, MIN_PHOTO_HEIGHT,
} from "./cardRenderer.js";
import { isExplicitHarmHeadline, isSensitiveHeadline } from "./editorialSensitivity.js";
import { isAbstractQuery, candidateMatches } from "./videoImageRelevance.js";
import { imageIdentity } from "./videoImageIdentity.js";

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
/**
 * Cards whose LAYOUT already declares an underlay, and which therefore get
 * their picture from the existing path rather than from this resolver.
 *
 * `photo` is here for a reason found by rendering, not by reading: the
 * resolver was assigning a pool image to every photo beat (they carry a
 * `subject`, so they always have an intent), and produceVideo then DISCARDED
 * that pick because the beat already had an underlay from
 * choosePhotoUnderlay. On a 2-image pool that silently spent the whole pool on
 * beats that never showed it, and every type card rendered bare — which is
 * exactly what the first sample renders looked like.
 *
 * Only `photo` and `map` declare an underlay (videoSlideRendererVertical);
 * everything else takes its picture through #121's cutaway seam.
 */
const SELF_IMAGED_TYPES = new Set(["map", "photo"]);

export const TIERS = Object.freeze({ WEB: "web", BODY: "body", ENTITY: "entity", STOCK: "stock", CARD: "card" });
/** Confidence is a label for WHICH TIER ANSWERED, never a computed score. */
export const CONFIDENCE = Object.freeze({
  // The web tier carries the confidence its SOURCE earned, so it is resolved
  // per candidate rather than per tier — a publisher photograph is "high", a
  // generic web hit "low". Everything else is a property of the tier itself.
  body: "high", entity: "high", stock: "medium", card: null,
});

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
 * The per-video image ledger — one record of every photograph already spent,
 * written to and read by BOTH imagery paths.
 *
 * WHY IT IS SHARED RATHER THAN ONE-WAY (DrJ, 2026-08-30). The strip of a
 * rendered video showed the same Netanyahu portrait three times: mounted by
 * choosePhotoUnderlay, full-bleed by the resolver, halftoned by the mount
 * rotation. Perceptual dedupe inside the pool could not see it, because the
 * duplication was ACROSS two subsystems that each believed they had used one
 * picture once. Having the resolver read the photo path's output would fix
 * today's ordering and break the moment that order changes — so neither path
 * is the authority. Both claim here, and whoever asks first gets the picture.
 *
 * KEYED ON SOURCE BYTES, before treatment. Treatment is precisely what makes
 * one photograph look like three: mounted, full-bleed and halftoned versions
 * of one image hash differently at every stage and are one photograph to a
 * viewer.
 */
export function createImageLedger({ _hash = averageHash, _log = logger } = {}) {
  const spent = [];
  const labels = [];
  return {
    /** True when this picture is new and now claimed; false when already spent. */
    claim(buf, { label = "" } = {}) {
      const h = _hash(buf);
      // An unhashable image is ALLOWED THROUGH. "We could not tell" must never
      // silently cost a beat its picture — the same rule the pool follows.
      if (h === null) return true;
      if (spent.some((prev) => hashDistance(prev, h) <= DUPLICATE_BITS)) {
        _log.info(`🖼 ledger: already used this photograph — ${String(label).slice(0, 70)}`);
        return false;
      }
      spent.push(h);
      labels.push(String(label || "unlabelled"));
      return true;
    },
    /** Claim without a caller — used to hold the article photo for its card. */
    reserve(buf, label = "reserved") { return this.claim(buf, { label }); },
    get size() { return spent.length; },
    /**
     * Every distinct photograph this video actually placed, by SOURCE bytes.
     *
     * This is the trustworthy count, and the reason it exists: counting
     * distinct pictures off the FINAL FRAMES is measuring the layout. Measured
     * 2026-08-30 on a real render — two different photographs sharing a mount
     * hashed 4 bits apart (below the duplicate threshold) while one photograph
     * at two crops hashed 27 bits apart. Both readings backwards. The ledger
     * hashes the source before any treatment, which is the only place the
     * picture is still the picture.
     */
    entries() { return labels.map((label, i) => ({ label, hash: spent[i] })); },
  };
}

/**
 * What the page SAYS each image is — alt text and figcaption, keyed by URL.
 *
 * This exists because "twelve beats got A story photo" is not "twelve beats
 * got the RIGHT one" (DrJ, ruling 2): the pool used to be consumed in slide
 * order, which assigned the article's fourth photograph to whatever beat came
 * fourth. Matching needs candidate TEXT, and news CMSes do ship it — alt
 * attributes and <figcaption> are the publisher's own description of the
 * picture, written by the same editors the body tier's trust rests on.
 *
 * Kept OUT of cardRenderer's miner on purpose: that function's candidate
 * ordering is the shipped card cascade, and reshaping its return type to add
 * text would touch a path this change has no business touching.
 */
export function extractImageContexts(html) {
  const map = new Map();
  if (!html || typeof html !== "string") return map;
  const put = (url, text) => {
    if (!url || !text) return;
    const u = String(url).trim();
    const t = String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!t) return;
    map.set(u, map.has(u) ? `${map.get(u)} ${t}` : t);
  };
  const urlsOf = (tag) => {
    const out = [];
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (src) out.push(src[1]);
    const ss = tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i);
    if (ss) for (const entry of ss[1].split(",")) {
      const u = entry.trim().split(/\s+/)[0];
      if (u) out.push(u);
    }
    return out;
  };
  // alt text, attached to every URL the tag can resolve to (src and srcset —
  // the miner picks the largest srcset entry, so the text must follow it).
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const alt = m[0].match(/\balt\s*=\s*["']([^"']*)["']/i);
    if (alt?.[1]) for (const u of urlsOf(m[0])) put(u, alt[1]);
  }
  // figcaption, attached to every image inside its <figure>.
  for (const m of html.matchAll(/<figure\b[\s\S]*?<\/figure>/gi)) {
    const cap = m[0].match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
    if (!cap?.[1]) continue;
    for (const img of m[0].matchAll(/<img\b[^>]*>/gi)) {
      for (const u of urlsOf(img[0])) put(u, cap[1]);
    }
  }
  return map;
}

/**
 * A 64-bit average hash of the picture ITSELF, so the same photograph cannot
 * enter the pool twice wearing different clothes.
 *
 * FOUND BY RENDERING (2026-08-30). Two dedupe layers already existed and both
 * missed it: the URL set, because a CDN serves one photo at many URLs
 * (`.../LANDSCAPE_120` and `.../LANDSCAPE_660`, `?w=` variants, srcset
 * renditions), and the size signature, because those renditions genuinely have
 * different dimensions. The result was the SAME Netanyahu portrait on two beats
 * of one video and the same CNBC illustration on three of another — the exact
 * "one photograph presented as several" complaint this whole programme exists
 * to end, returning in a subtler form.
 *
 * aHash rather than a byte hash: different renditions are different bytes by
 * definition. Decode to 8x8 grey, compare each cell to the mean, and two
 * renditions of one photo agree within a few bits while two genuinely
 * different pictures do not. ffmpeg does the decode, so there is no new
 * dependency.
 *
 * Returns null when the decode fails, and the caller treats null as "not
 * provably a duplicate" — a hash we could not compute must never silently
 * discard a usable picture.
 */
export function averageHash(buf, { _ff = getFFmpegPath, _run = execFileSync } = {}) {
  try {
    const ff = _ff();
    if (!ff) return null;
    const raw = _run(ff, ["-loglevel", "error", "-i", "pipe:0", "-frames:v", "1",
      "-vf", "format=gray,scale=8:8:flags=area", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"],
      { input: buf, maxBuffer: 1 << 20 });
    if (!raw || raw.length < 64) return null;
    const px = [...raw.slice(0, 64)];
    const mean = px.reduce((a, b) => a + b, 0) / 64;
    let bits = 0n;
    px.forEach((v, i) => { if (v >= mean) bits |= (1n << BigInt(i)); });
    return bits;
  } catch { return null; }
}

/** Hamming distance between two aHashes. <= 5 bits of 64 is the same picture. */
export function hashDistance(a, b) {
  let x = a ^ b, n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}
export const DUPLICATE_BITS = 5;

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

  const contexts = new Map();
  const absorb = (html) => { for (const [u, t] of extractImageContexts(html)) contexts.set(u, contexts.has(u) ? `${contexts.get(u)} ${t}` : t); };

  if (article?.image_url) {
    push(upscaleKnownThumbnailUrl(article.image_url));
    push(article.image_url);
  }
  for (const c of extractImageCandidatesFromHtml(article?.content || "")) push(c);
  absorb(article?.content || "");

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
      absorb(html);
    }
  }

  // The upscale rewrite changes the URL, so context recorded against the
  // original must follow the rewritten candidate too.
  if (article?.image_url) {
    const up = upscaleKnownThumbnailUrl(article.image_url);
    if (up !== article.image_url && contexts.has(article.image_url) && !contexts.has(up)) {
      contexts.set(up, contexts.get(article.image_url));
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
    // THE PICTURE, not the URL and not the dimensions. A CDN serves one photo
    // at many URLs and many sizes, and both of those dedupe layers wave the
    // renditions straight through — see averageHash.
    const hash = averageHash(got.buf);
    if (hash !== null && pool.some((p) => p.hash !== null && p.hash !== undefined
        && hashDistance(p.hash, hash) <= DUPLICATE_BITS)) {
      _log.info(`🖼 body pool: skipping a re-encoding of a picture already held — ${String(url).slice(0, 70)}`);
      continue;
    }
    sigs.add(sig);
    pool.push({ url, buf: got.buf, dims, hash, text: contexts.get(url) || "" });
  }
  const described = pool.filter((p) => p.text).length;
  _log.info(`🖼 body pool: ${pool.length} usable of ${urls.length} candidate(s) ` +
    `(live page contributed ${live}; ${described}/${pool.length} carry alt/figcaption text)`);
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
  slide, article, entities = [], pool, poolCursor, ledger = null, webDays = 14,
  _entityImage, _stockImage, _webSearch = null, _fetchImage = tryFetchImage, _log = logger,
} = {}) {
  const { intent, source, reason, qid } = intentForBeat(slide, { entities });
  const base = { slideIndex: slide?._i ?? null, intent, intentSource: source };

  if (!intent) return { ...base, tier: TIERS.CARD, confidence: null, reason: reason || "no-intent" };

  const publisherAllowed = !isExplicitHarmHeadline(article?.title);
  const thirdPartyAllowed = !isSensitiveHeadline(article?.title);

  // ── 0. THE OPEN WEB — above body, because it is where the EVENT is ───────
  //
  // The pool-depth ceiling that capped a typical short at ONE photograph was an
  // artefact of where this function was allowed to look. Measured across ten
  // real stories: the open web yields 5.7 usable photographs per story, 2.6 of
  // them from news publishers, against 2.2 from the article page.
  //
  // It sits ABOVE body because a searched publisher photograph is of THE EVENT,
  // while the article's own picture is frequently a file photo — and the whole
  // point of the date-proximate query is to prefer the former.
  //
  // Candidates are FETCHED AND MEASURED here, never trusted on reported size:
  // Serper's dimensions are the thumbnail's often enough to have discarded the
  // actual AP photograph of Federer's induction.
  if (_webSearch && _fetchImage) {
    try {
      const cands = await _webSearch(intent, { headline: article?.title || "", days: webDays });
      for (const c of cands) {
        // A low-confidence hit is a real photograph from a source nobody
        // vouched for. It is allowed, but only where the BROAD sensitivity bar
        // already permits third-party imagery.
        if (!thirdPartyAllowed) break;
        const got = await _fetchImage(c.imageUrl, c.pageUrl ? `https://${c.host}/` : undefined);
        if (!got?.buf) continue;
        const dims = readImageDimensions(got.buf);
        if (!dims || dims.width < MIN_PHOTO_WIDTH || dims.height < MIN_PHOTO_HEIGHT) continue;
        if (ledger && !ledger.claim(got.buf, { label: c.imageUrl })) continue;
        return { ...base, tier: TIERS.WEB, confidence: c.confidence,
                 imageUrl: c.imageUrl, buffer: got.buf,
                 credit: c.host || null, sourcePage: c.pageUrl || null, webTitle: c.title };
      }
    } catch (err) { _log.warn(`🔎 web tier failed for "${String(intent).slice(0, 40)}" — ${String(err.message).slice(0, 80)}`); }
  }

  // ── ENTITY FIRST for a NAMED subject — the tier is ADDITIVE, not a fallback.
  //
  // Measured (DrJ, 2026-08-30): the entity tier fired once across twenty
  // articles, because body ran first and exhausted the pool. But P18 is
  // available for 27 of 45 extracted entities, and an exact QID -> portrait
  // beats "whatever photograph the article happened to carry" on relevance for
  // the one thing it names. Running it ahead of body for named subjects turns
  // it from a fallback nobody reaches into a SECOND picture on the same
  // article — which is the pool-depth lever, not a re-ordering nicety.
  //
  // Abstract beats are untouched: they go body-first exactly as before.
  const namedEntity = qid ? { qid, label: intent }
    : entities.find((e) => {
        const label = norm(e.label || e.surface);
        return label.length >= 4 && (norm(intent).includes(label) || label.includes(norm(intent)));
      });
  if (thirdPartyAllowed && _entityImage && namedEntity?.qid) {
    try {
      const got = await _entityImage(namedEntity);
      if (got && (!ledger || ledger.claim(got.buf, { label: `P18 ${namedEntity.qid}` }))) {
        return { ...base, tier: TIERS.ENTITY, confidence: CONFIDENCE.entity,
                 imageUrl: got.url, buffer: got.buf, credit: got.credit,
                 entity: namedEntity.label || intent, qid: namedEntity.qid };
      }
    } catch (err) { _log.warn(`🖼 entity tier failed for ${namedEntity.qid} — ${String(err.message).slice(0, 80)}`); }
  }

  // ── 1. BODY — MATCHED, then slide order as the tiebreak only ─────────────
  //
  // The pool used to be consumed strictly in slide order, which handed the
  // article's fourth photograph to whatever beat came fourth — "twelve beats
  // getting A story photo is not twelve beats getting the RIGHT one" (DrJ,
  // ruling 2). Candidates now try to MATCH the beat's intent first, through
  // the same conjunctive gate stock uses, against the publisher's own
  // description of the picture (alt / figcaption). Only when no description
  // matches does the old order-based assignment apply — every image is still
  // used at most once, and a beat never goes empty because matching exists.
  if (publisherAllowed && pool?.length && poolCursor.used.size < pool.length) {
    const unused = pool.map((img, idx) => ({ img, idx })).filter(({ idx }) => !poolCursor.used.has(idx));
    const hit = unused.find(({ img }) => img.text && candidateMatches(intent, img.text));
    const { img, idx } = hit || unused[0];
    poolCursor.used.add(idx);
    if (ledger && !ledger.claim(img.buf, { label: img.url })) {
      // Already on screen somewhere in this video. Fall through to the next
      // tier rather than showing it twice.
      return { ...base, tier: TIERS.CARD, confidence: null,
               reason: "this photograph is already used in this video" };
    }
    return { ...base, tier: TIERS.BODY, confidence: CONFIDENCE.body,
             bodyMatch: hit ? "intent" : "order",
             imageUrl: img.url, buffer: img.buf, credit: article?.source_name || null };
  }

  // ── 2. A NAMED SUBJECT NEVER FALLS TO STOCK ──────────────────────────────
  //
  // The entity attempt above already ran and found nothing usable. Stock is
  // forbidden here whatever it might return: a plausible stock "school gate"
  // for the Qalandiya Training Centre is plausible, wrong, and the exact
  // failure this rule exists to prevent.
  if (thirdPartyAllowed && (namedEntity?.qid || !isAbstractQuery(intent))) {
    return { ...base, tier: TIERS.CARD, confidence: null,
             reason: "named subject, no exact image — stock is forbidden here" };
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
  slides = [], article, entities = [], ledger = null, webDays = 14, deps = {},
} = {}) {
  const { _pool, _entityImage, _stockImage, _webSearch, _fetchImage, _log = logger } = deps;

  const pool = _pool !== undefined ? _pool
    : (isExplicitHarmHeadline(article?.title) ? [] : await buildBodyPool(article, { _log }));
  const poolCursor = { used: new Set() };
  const picks = [];
  const stockCreators = new Set();

  // HOLD THE ARTICLE'S OWN PHOTOGRAPH for its photo card when the spec has one:
  // that card exists to show it, and the resolver runs before the slide loop,
  // so without this a type beat takes the picture and the card renders bare.
  //
  // THE HOLD IS ON THE POOL, NOT THE LEDGER. Claiming it here marked the
  // photograph as spent, so the photo path's own claim then came back
  // "already used" and the video rendered with NO pictures at all — worse than
  // the repetition this was fixing. The reservation's job is to stop the
  // RESOLVER taking it; the photo path still claims it normally, and if that
  // path fails the picture is simply unspent.
  if (slides.some((sl) => sl?.t === "photo") && pool.length) {
    const own = pool.find((p) => p.url === article?.image_url) || pool[0];
    if (own) poolCursor.used.add(pool.indexOf(own));
  }

  for (let i = 0; i < slides.length; i++) {
    const slide = { ...slides[i], _i: i };
    let pick = await resolveBeat({ slide, article, entities, pool, poolCursor, ledger, webDays,
      _entityImage, _stockImage, _webSearch, _fetchImage, _log });

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

  // LEFTOVERS, for the pacing pass (DrJ defect 5): a beat longer than ~3s cuts
  // to a second visual, and the first place to find one is the pool images no
  // beat consumed. Returned as-is — the caller claims through the ledger at
  // the moment of use, not before, so an unused leftover stays available to
  // the photo path.
  const leftovers = pool.filter((_, idx) => !poolCursor.used.has(idx));
  return { picks, poolSize: pool.length, leftovers, ...coverageOf(picks) };
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
  const by = { web: 0, body: 0, entity: 0, stock: 0, card: 0 };
  for (const p of picks) by[p.tier] = (by[p.tier] || 0) + 1;
  const eligible = picks.filter((p) => p.intent || p.tier !== TIERS.CARD).length;
  // `web` was missing here, so the log line read "0% of eligible beats carry a
  // picture" on a video that had just placed three. The PICTURES PLACED line
  // (source bytes) was right; this one was not.
  const withImage = by.web + by.body + by.entity + by.stock;
  return {
    bySource: by,
    beats: picks.length,
    eligible,
    imageryShare: picks.length ? withImage / picks.length : 0,
    eligibleShare: eligible ? withImage / eligible : 0,
  };
}
