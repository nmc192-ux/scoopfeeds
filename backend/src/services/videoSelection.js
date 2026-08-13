/**
 * videoSelection.js — the blocking gates between a fresh article and a video.
 *
 * Every gate here is a REFUSAL, and §6.2's posture is that the pipeline should
 * prefer publishing nothing. Each returns a reason rather than a boolean so a
 * skipped article can be explained in the cycle log without re-deriving why.
 *
 * ORDER MATTERS AND IS NOT ALPHABETICAL. Rule 0 (videoPakistanBlock) runs
 * AHEAD of everything here, in the caller — it is absolute, it has no override,
 * and it must not be reachable only after some cheaper gate happened to pass.
 * Within this module the cheap deterministic tests run before anything that
 * touches the database.
 *
 * WHY THESE FOUR (DrJ, 2026-08-02), all blocking:
 *   - SPORT — out of scope for the news channel; D1 already excludes it from
 *     the social path for the same reason.
 *   - LIVE BLOGS — rolling updates have no stable narrative, so there are no
 *     beats to enumerate. Measured: the flat-beat investigation's worst case
 *     was a 30-source live blog.
 *   - INDIVIDUAL STOCK COMMENTARY — "Forget Nvidia, buy these 3 stocks" is
 *     not news, and a video of it is indistinguishable from the finance-spam
 *     genre YouTube's mass-produced-content policy targets. eventsDao's
 *     backtest found exactly this shape at the top of its idf ranking.
 *   - ONE PER PUBLISHER PER ROLLING 24h — four videos a day from one masthead
 *     reads as a syndication feed, and it concentrates the copyright surface
 *     §3b exists to spread.
 *
 * Plus the 48h EVENT COOLDOWN, with a title-similarity fallback where an
 * article has no event linkage — most do not, and without the fallback the
 * cooldown would silently cover only the minority that do.
 */

import { logger } from "./logger.js";
import {
  publisherPublishedSince, eventPublishedSince, recentPublishedTitles,
} from "../models/database.js";
import { resolveEventForArticle } from "../realityIndex/dal/eventsDao.js";

export const PUBLISHER_COOLDOWN_MS =
  Number.parseInt(process.env.VIDEO_PUBLISHER_COOLDOWN_MS || "", 10) || 24 * 60 * 60 * 1000;
export const EVENT_COOLDOWN_MS =
  Number.parseInt(process.env.VIDEO_EVENT_COOLDOWN_MS || "", 10) || 48 * 60 * 60 * 1000;

// Same shape as the live-blog exclusion the harness has been running since the
// Trump/Iran pick — a rolling liveblog was selected precisely because nothing
// filtered it.
const LIVE_BLOG_RE =
  /\blive\b\s*[:|]|\blive\s+(updates?|blog|coverage)\b|\bas it happened\b|\bliveblog\b|\brolling\s+coverage\b/i;

const SPORT_CATEGORIES = new Set(["sports", "sport", "football", "cricket", "tennis", "f1", "nfl", "nba"]);

// Individual-security commentary. Deliberately reaching for the GENRE, not for
// finance as a subject: "Fed holds rates" is news, "3 stocks to buy before
// December" is not, and the difference is whether a specific security is being
// recommended to the viewer.
const STOCK_COMMENTARY_RE = new RegExp([
  /\b(buy|sell|hold|short|dump|load up on)\b.{0,30}\b(stock|shares|ticker)\b/,
  /\b(stock|shares)\b.{0,30}\b(to buy|to sell|to watch|worth buying|a buy|a sell)\b/,
  // 1-3 stacked adjectives, not one: "5 undervalued dividend stocks" has two,
  // and a single-adjective pattern let it through. Anchored on the ADJECTIVE
  // list rather than on \w+ so "5 million stocks traded" is still news.
  /\b\d+\s+(?:(?:best|top|hot|cheap|undervalued|overvalued|dividend|growth|ai|penny|value|blue.?chip|magnificent)\s+){1,3}stocks?\b/,
  /\b\d+\s+stocks?\s+(to buy|to watch|to own|to avoid)\b/,
  /\bforget\b.{0,40}\b(buy|stock|shares)\b/,
  /\b(price target|analyst rating|upgraded to|downgraded to|outperform|underperform)\b/,
  /\b(is|are)\s+\w+\s+stock\s+(a\s+)?(buy|sell|worth)\b/,
  /\bmy top\s+\d*\s*(stock|pick)/,
].map(r => r.source).join("|"), "i");

// CONTENT-LEVEL rating language. The title patterns above are a genre filter on
// PHRASING, and phrasing is endlessly re-skinnable: "SoundHound AI Stock: Why
// Analysts Predict 100% Gains" passed every one of them on 2026-08-03, and its
// beats were analyst price targets and buy ratings. Under a live loop that
// publishes investment promotion under the brand.
//
// So this reads the BODY for the vocabulary of a rating note, which is much
// harder to paraphrase away than a headline formula — you cannot write about
// price targets without naming them.
const RATING_LANGUAGE_RE = new RegExp([
  /\bprice target(?:s)?\b/,
  /\bprice forecast(?:s)?\b/,
  /\banalyst(?:s)?['’]? (?:rating|consensus|estimate|target|price)/,
  /\bconsensus (?:rating|target|estimate)\b/,
  /\b(?:buy|hold|sell|strong buy|strong sell) rating\b/,
  /\brated (?:a )?(?:buy|hold|sell|outperform|underperform)\b/,
  /\b(?:overweight|underweight|outperform|underperform|market perform)\b/,
  /\banalysts? (?:covering|who cover) (?:the )?(?:stock|shares|company)\b/,
  /\b(?:upgraded|downgraded) (?:the stock )?to\b/,
  /\b(?:average|median|mean) (?:analyst )?(?:price )?target\b/,
  /\bwall street (?:analysts|consensus|price target)/,
].map(r => r.source).join("|"), "i");

// SINGLE-TICKER FOCUS, read off the TITLE. This is the half that protects
// finance as a SUBJECT: an earnings report or a recall whose body happens to
// quote an analyst is not a stock tip. It requires the headline itself to be
// about one security — a named company's "stock"/"shares", or an explicit
// exchange ticker.
//
// Deliberately SINGULAR. "European stocks fall after the ECB decision" is
// market coverage and must survive, so the plural generic never matches.
// Applied to TITLE AND BODY — an exchange ticker is unambiguous wherever it
// appears, and in practice it appears in the first body paragraph far more
// often than in the headline.
const EXCHANGE_TICKER_RE = /\((?:NASDAQ|NYSE|NYSEARCA|NYSEAMERICAN|AMEX|LSE|TSX|TSXV|ASX|OTC|OTCMKTS|BSE|NSE)\s*:\s*[A-Z.]{1,6}\)/;

const TICKER_FOCUS_RE = new RegExp([
  // The leading token stays case-SENSITIVE (a proper noun is what makes this
  // single-ticker), but "stock"/"shares" must match either case: the live miss
  // was "SoundHound AI Stock: Why Analysts Predict 100% Gains", title-cased.
  /\b[A-Z][\w.&'’-]*(?:\s+[A-Z][\w.&'’-]*){0,3}\s+(?:[Ss]tock|[Ss]hares)\b/,
  /\b(?:[Ss]tock|[Ss]hares)\s+of\s+[A-Z]/,
].map(r => r.source).join("|"));

// "...Could Send the Stock Soaring" — the real 2026-08-03 evasion. The company
// is named at the START of the headline and referred to as "the Stock" later,
// so nothing is ADJACENT and the pattern above cannot fire. Requires both a
// proper noun in the title and a bare definite-article reference to a single
// security, and excludes "the stock market/exchange/index", which is
// market-wide coverage rather than one company.
const THE_STOCK_RE = /\bthe\s+(?:[Ss]tock|[Ss]hares)\b(?!\s+(?:market|markets|exchange|exchanges|index|indexes|indices))/;
const TITLE_PROPER_NOUN_RE = /\b[A-Z][A-Za-z.&'’-]{2,}\b/;

/** Does the TITLE single out one security, adjacently or by definite article? */
function titleTickerFocus(title) {
  const direct = title.match(TICKER_FOCUS_RE);
  if (direct) return direct[0];
  if (THE_STOCK_RE.test(title) && TITLE_PROPER_NOUN_RE.test(title)) {
    return title.match(THE_STOCK_RE)[0].trim();
  }
  return null;
}

// Words that start sentences or head lists and are not company names. Without
// this the "dominant company" count is won by "The" on every article.
const NOT_A_COMPANY = new Set([
  "the", "a", "an", "and", "but", "for", "it", "its", "this", "that", "these",
  "those", "he", "she", "they", "we", "you", "i", "in", "on", "at", "by", "to",
  "of", "as", "if", "so", "then", "there", "here", "what", "when", "while",
  "after", "before", "since", "however", "meanwhile", "still", "analysts",
  "investors", "shares", "stock", "wall", "street", "monday", "tuesday",
  "wednesday", "thursday", "friday", "saturday", "sunday", "reuters", "bloomberg",
]);

/**
 * Is one company the subject of this text?
 *
 * Counts capitalised tokens that are not sentence-scaffolding and asks whether
 * a single one dominates. Crude on purpose — it is a FOCUS signal, not entity
 * extraction, and it is never trusted alone (see isRatingNote).
 */
export function dominantCompany(text) {
  const counts = new Map();
  for (const m of String(text || "").matchAll(/\b[A-Z][A-Za-z.&'’-]{1,}\b/g)) {
    const w = m[0];
    const k = w.toLowerCase();
    if (NOT_A_COMPANY.has(k) || k.length < 3) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  let total = 0, top = null, topN = 0;
  for (const [w, n] of counts) { total += n; if (n > topN) { top = w; topN = n; } }
  // No high "total" floor. Text that mentions ONE company four times and
  // almost nothing else is the strongest dominance signal there is, and an
  // earlier total>=6 guard rejected exactly that case.
  if (!top || total < 4 || topN < 4) return null;
  const share = topN / total;
  return share >= 0.35 ? { name: top, count: topN, share } : null;
}

/**
 * The genre, caught by SHAPE rather than by phrasing.
 *
 * TICKER FOCUS IS READ FROM THE BODY TOO (DrJ, 2026-08-03). Title-only was
 * always going to lose this race — a headline is the most re-skinnable surface
 * in a news article, and the SoundHound piece evaded the title pattern twice.
 * Three ways to establish focus, in descending strength:
 *
 *   STRONG  an exchange ticker anywhere — "(NASDAQ: SOUN)". Unambiguous.
 *   STRONG  the title names one company's stock/shares.
 *   WEAK    one company dominates the body's mentions.
 *
 * A STRONG focus needs one rating signal. A WEAK focus needs TWO DISTINCT ones,
 * and that asymmetry is what protects finance as a subject: an earnings report
 * is dominated by its company and mentions a price target once in passing,
 * whereas a rating note is BUILT out of rating language. Without the asymmetry,
 * "Nvidia reports record quarterly revenue" would be blocked by a single
 * analyst quote in its body.
 */
export function isRatingNote(article) {
  const title = String(article?.title || "");
  const body = `${article?.description || ""} ${article?.content || ""}`;
  const all = `${title} ${body}`;

  const exchange = all.match(EXCHANGE_TICKER_RE);
  const titleFocus = titleTickerFocus(title);
  const strong = exchange || titleFocus;
  const weak = strong ? null : dominantCompany(body);
  if (!strong && !weak) return null;

  const hits = [...new Set(
    [...all.matchAll(new RegExp(RATING_LANGUAGE_RE.source, "gi"))].map(m => m[0].toLowerCase())
  )];
  const need = strong ? 1 : 2;
  if (hits.length < need) return null;

  return {
    ticker: (exchange?.[0] || titleFocus || weak?.name || "").trim(),
    focus: strong ? (exchange ? "exchange-ticker" : "title") : "body-dominant",
    rating: hits.slice(0, 2).join(", "),
    signals: hits.length,
  };
}

/**
 * PUBLISHER DIVERSITY AT SELECTION (DrJ, 2026-08-03).
 *
 * Length-first ordering handed the window to whoever writes longest: Yahoo
 * Finance took 5 of 7 candidates, then 2 of 2. The publish-time cooldown cannot
 * help — it only refuses the SECOND video, after the whole cycle has already
 * spent its attempts inside one masthead and found nothing.
 *
 * Order is preserved; the surplus is dropped, not reshuffled, so the substance
 * ordering still decides WHICH two survive from each publisher.
 */
export const MAX_PER_PUBLISHER = Number.parseInt(process.env.VIDEO_MAX_PER_PUBLISHER_PER_CYCLE || "", 10) || 2;

export function diversifyByPublisher(articles, { max = MAX_PER_PUBLISHER } = {}) {
  // Pass 1 — cap per publisher, preserving the substance ordering WITHIN each
  // publisher's bucket. This decides WHICH of a publisher's articles survive.
  const buckets = new Map();
  const dropped = [];
  for (const a of articles || []) {
    const key = String(a?.source_name || "").toLowerCase() || "(none)";
    if (!buckets.has(key)) buckets.set(key, []);
    const b = buckets.get(key);
    if (b.length >= max) { dropped.push(a); continue; }
    b.push(a);
  }

  // Pass 2 — ROUND-ROBIN across publishers (DrJ, 2026-08-03). Capping the
  // COUNT was not enough: both Yahoo Finance survivors were still attempts 1
  // and 2, so a cycle that found its video early never reached BBC, The Hindu
  // or ABC at all. The cap decided who was in the room; it did not stop one
  // masthead owning the front of the queue.
  //
  // Bucket ORDER is the order publishers first appear, so the article the
  // substance ordering ranked highest overall still goes first. After that it
  // is one per publisher before anyone gets a second.
  const kept = [];
  const lists = [...buckets.values()];
  for (let round = 0; round < max; round++) {
    for (const list of lists) {
      if (list[round]) kept.push(list[round]);
    }
  }
  return { kept, dropped };
}

/**
 * Near-duplicate check, RECOVERED VERBATIM from videoSourceBundle (01638c7)
 * rather than rewritten. It was built and tested for exactly this question —
 * "is this the same story I already have?" — and a second, subtly different
 * similarity measure is how the create-merge-split treadmill started on the
 * event graph. One measure, reused.
 *
 * MOVED to textSimilarity.js (unchanged) so videoSpecSchema's arc checks can
 * share it: that module is pure by contract, and this one reaches into
 * eventsDao. Re-exported here because this is where every existing caller and
 * `videoSelection.test.js` look for it — the move must not become a rename.
 */
export { tooSimilar, normText as norm } from "./textSimilarity.js";
// BOTH NAMES MUST BE IMPORTED, NOT JUST RE-EXPORTED. `export { x } from "…"` is
// a pure re-export: it makes `x` available to importers of this module and does
// NOT bind it in local scope. #11 replaced tooSimilar's local definition with
// the re-export above and imported only `normText`, so `cooldownGate`'s
// title-similarity fallback has thrown `ReferenceError: tooSimilar is not
// defined` ever since — see videoSelection.test.js for the regression test.
import { normText as norm, tooSimilar } from "./textSimilarity.js";

/** Cheap, deterministic, no database. Runs first. */
export function staticGate(article) {
  const cat = String(article?.category || "").toLowerCase();
  if (SPORT_CATEGORIES.has(cat)) return { ok: false, gate: "sport", reason: `category "${cat}"` };

  const title = String(article?.title || "");
  if (LIVE_BLOG_RE.test(title)) {
    return { ok: false, gate: "live-blog", reason: "rolling updates carry no stable narrative" };
  }
  const haystack = `${title} ${article?.description || ""}`;
  const m = haystack.match(STOCK_COMMENTARY_RE);
  if (m) return { ok: false, gate: "stock-commentary", reason: `matched "${m[0].slice(0, 48)}"` };

  // The content-level signal, after the cheap title patterns.
  const note = isRatingNote(article);
  if (note) {
    return {
      ok: false, gate: "stock-commentary",
      reason: `${note.focus} focus ("${note.ticker}") with ${note.signals} rating signal(s): ${note.rating}`,
    };
  }

  return { ok: true };
}

/**
 * PUBLISHER COOLDOWN AS A SET-LEVEL PREFILTER (DrJ, 2026-08-13).
 *
 * `publisherPublishedSince(source, now - 24h)` is a fact about a PUBLISHER, not
 * about an article: `now` is fixed for the cycle and the attempt loop breaks the
 * moment it publishes, so within one cycle every article from a masthead gets
 * the same answer. Asked once per article it was the same query 7 times, and —
 * because it ran inside the attempt loop — it spent 7 of the cycle's 8 attempts
 * to learn at most 4 facts. The live symptom was `tried 8, produced 0 · spec
 * spend $0.00000`: the whole budget consumed without one Gemini call.
 *
 * This is the same correction `diversifyByPublisher` already carries one layer
 * up — "the publish-time cooldown cannot fix that: it refuses the second VIDEO,
 * long after the cycle has spent all eight attempts inside one masthead". The
 * cooldown is the same class of predicate and was left behind in the loop.
 *
 * ORDER: this runs before diversifyByPublisher, and — measured, not assumed —
 * the order is NOT load-bearing today. Diversity caps per publisher and has no
 * global cap, so removing a whole masthead before or after it yields the same
 * list in the same order. It is placed first because it is the coarser and
 * cheaper filter (one query per publisher, shrinking diversity's input), and
 * because reading order should follow cost order.
 *
 * That equivalence is PINNED BY A TEST. Give diversifyByPublisher a global cap
 * — a total ceiling on eligible articles — and the order becomes load-bearing
 * immediately: diversity-first would spend the ceiling on mastheads that are
 * wholly cooled down. The test fails at that moment, which is the point.
 *
 * Memoised on the RAW `source_name`, matching `publisherPublishedSince`'s
 * case-sensitive `WHERE source_name = ?`. Note that `diversifyByPublisher`
 * buckets case-INSENSITIVELY, so the two disagree about what one publisher is —
 * pre-existing, not introduced here, and left alone because changing it would
 * move which articles survive in the same commit that moves where they are
 * filtered.
 */
export function publisherCooldownFilter(articles, { now = Date.now() } = {}) {
  const verdict = new Map();     // source_name -> reason string | null
  const kept = [], dropped = [];
  for (const a of articles || []) {
    const source = a?.source_name || null;
    // No publisher name means nothing to cool down — the gate has always let
    // these through, and the prefilter must not become a stricter rule than the
    // gate it is hoisting.
    if (!source) { kept.push(a); continue; }
    if (!verdict.has(source)) {
      verdict.set(
        source,
        publisherPublishedSince(source, now - PUBLISHER_COOLDOWN_MS) > 0
          ? `${source} already published inside ${(PUBLISHER_COOLDOWN_MS / 3600000).toFixed(0)}h`
          : null,
      );
    }
    const reason = verdict.get(source);
    if (reason) dropped.push({ article: a, reason });
    else kept.push(a);
  }
  return { kept, dropped, queries: verdict.size };
}

/**
 * The published-title corpus for the similarity fallback, built ONCE per cycle.
 *
 * `recentPublishedTitles` is a query plus an N-way Set build, and `cooldownGate`
 * ran it per article — on the ~92% of candidates with no event linkage (measured:
 * only 8.4% of prod candidates link to an event), for a result that cannot change
 * while the cycle is scanning. Hoisting it is what makes a wide scan cheap enough
 * to be worth doing.
 */
export function buildRecentTitleCorpus({ now = Date.now() } = {}) {
  return recentPublishedTitles(now - EVENT_COOLDOWN_MS)
    .map(t => new Set(norm(t).split(" ").filter(w => w.length > 4)));
}

/**
 * Database-backed gates: publisher cadence, then event cooldown, then the
 * title-similarity fallback for articles with no event.
 *
 * The publisher check is RETAINED here even though `publisherCooldownFilter`
 * now removes those articles upstream. This function is the definition of the
 * gate, and a caller that has not run the prefilter must still get the whole
 * rule; the prefilter is an optimisation on top, not a relocation of the
 * contract. In the video cycle it is therefore unreachable — which is the point.
 *
 * `titleCorpus` is accepted so the cycle can build it once. Omit it and it is
 * built here, exactly as before.
 */
export function cooldownGate(article, { now = Date.now(), titleCorpus = null } = {}) {
  const source = article?.source_name || null;
  if (source && publisherPublishedSince(source, now - PUBLISHER_COOLDOWN_MS) > 0) {
    return {
      ok: false, gate: "publisher-24h",
      reason: `${source} already published inside ${(PUBLISHER_COOLDOWN_MS / 3600000).toFixed(0)}h`,
    };
  }

  let eventId = null;
  try { eventId = resolveEventForArticle(article.id)?.id || null; }
  catch (err) { logger.warn(`🎬 selection: event lookup failed for ${article?.id}: ${err.message}`); }

  if (eventId) {
    if (eventPublishedSince(eventId, now - EVENT_COOLDOWN_MS) > 0) {
      return {
        ok: false, gate: "event-48h", eventId,
        reason: `event ${eventId} already covered inside ${(EVENT_COOLDOWN_MS / 3600000).toFixed(0)}h`,
      };
    }
    return { ok: true, eventId };
  }

  // NO EVENT LINKAGE — the common case, and the reason the cooldown needs a
  // fallback at all. Without it the 48h rule would cover only the minority of
  // articles the graph happened to link, and the same story under two
  // mastheads would publish twice.
  const seen = titleCorpus || buildRecentTitleCorpus({ now });
  if (seen.length && tooSimilar(article.title, seen)) {
    return { ok: false, gate: "title-similarity", reason: "a near-identical headline published inside the cooldown" };
  }
  return { ok: true, eventId: null };
}

/**
 * Every gate, in order, for one article. Rule 0 is the caller's job and runs
 * before this — see the module header for why it is not folded in here.
 */
export function selectionGate(article, opts = {}) {
  const s = staticGate(article);
  if (!s.ok) return s;
  return cooldownGate(article, opts);
}

export const _internals = { LIVE_BLOG_RE, STOCK_COMMENTARY_RE, SPORT_CATEGORIES, norm, RATING_LANGUAGE_RE, TICKER_FOCUS_RE, EXCHANGE_TICKER_RE, NOT_A_COMPANY, THE_STOCK_RE, titleTickerFocus };
