/**
 * pageDiscovery.js — homepage-nav-first page discovery (B.6.2b-2a).
 *
 * discoverSite(source, ctx): open the site (B.6.2b-1 openSite), fetch the
 * homepage ONCE (1 budget unit), parse nav/footer/header anchors, and
 * keyword-match each link to the 5 page-types — returning candidate URLs the
 * presence-detector modules (B.6.2b-2b) will confirm + score.
 *
 * Honesty: discovery only ever produces POSITIVE leads. Finding nothing →
 * empty candidates → detectors go `pending`, never a confident negative. A
 * JS-rendered nav (linkedom executes no JS) yields no links → empty → honest.
 *
 * Matching discipline (Q2 hazards + live-validation tuning):
 *   - "ai" matches ONLY as a whole word / exact path segment (never the
 *     substring in email/available/campaign/main/mail).
 *   - "subscribe"/"subscription" is EXCLUDED from funding (paywall ≠ funding).
 *   - TEXT keywords match only on LABEL-like link text (≤ MAX_LABEL_WORDS) via
 *     word-boundary — so a sentence like "Read about our approach…" does NOT
 *     become a bogus "about" leadership candidate (live finding on BBC).
 *   - PATH matching is exact-segment AND includes DE-HYPHENATED variants, so
 *     BBC's /editorialguidelines (no hyphen) matches "editorial-guidelines".
 *   - Candidates resolving to the homepage path "/" are dropped (junk nav
 *     hrefs like Guardian's "Support us" → "/").
 *
 * Candidates carry provenance ({url, source:"nav", linkText}) so detectors can
 * apply the Q1 hybrid. CONVENTION_PATHS (with de-hyphenated variants) is
 * exported for the detectors' fallback (used in 2b).
 */

import { openSite } from "./siteFetch.js";

export const PAGE_TYPES = Object.freeze(["leadership", "standards", "corrections", "funding", "ai"]);

// Nav labels are short; a keyword found in longer text is prose, not a label.
const MAX_LABEL_WORDS = 6;
const AI_WORD = /\bai\b/;

const TYPE_MATCHERS_RAW = {
  leadership: {
    textKeywords: ["about us", "about", "masthead", "our team", "editorial team", "team", "staff", "people", "leadership", "who we are"],
    pathKeywords: ["about", "about-us", "masthead", "team", "our-team", "staff", "people", "leadership", "editorial-team", "who-we-are"],
  },
  standards: {
    textKeywords: ["editorial standards", "editorial guidelines", "editorial policy", "code of ethics", "editorial values", "ethics", "standards", "guidelines", "principles"],
    pathKeywords: ["ethics", "standards", "editorial-standards", "editorial-guidelines", "editorial-policy", "code-of-ethics", "guidelines", "editorial-values", "principles"],
  },
  corrections: {
    textKeywords: ["corrections", "clarifications", "errata", "accuracy", "complaints"],
    pathKeywords: ["corrections", "clarifications", "errata", "accuracy", "complaints"],
  },
  funding: {
    textKeywords: ["how we're funded", "support us", "funding", "donate", "membership", "contribute", "patrons"],
    pathKeywords: ["funding", "support", "support-us", "donate", "membership", "contribute", "patrons"],
    excludeText: ["subscribe", "subscription"],
  },
  ai: {
    textKeywords: ["artificial intelligence", "ai policy", "use of ai", "ai principles", "ai ethics", "ai guidelines"],
    pathKeywords: ["ai", "ai-policy", "artificial-intelligence", "ai-ethics", "ai-principles", "use-of-ai"],
    aiBoundary: true,
  },
};

const CONVENTION_PATHS_RAW = {
  leadership: ["/about", "/about-us", "/masthead", "/staff", "/team", "/our-team", "/people", "/leadership"],
  standards: ["/ethics", "/standards", "/editorial-standards", "/editorial-guidelines", "/editorial-policy", "/code-of-ethics", "/guidelines"],
  corrections: ["/corrections", "/clarifications", "/errata", "/accuracy"],
  funding: ["/funding", "/support", "/support-us", "/donate", "/membership", "/about/funding"],
  ai: ["/ai", "/ai-policy", "/artificial-intelligence", "/about/ai"],
};

const dehyphen = (s) => s.replace(/-/g, "");

// Augment path keyword sets with de-hyphenated variants (live finding: BBC's
// real standards page is /editorialguidelines, no hyphen).
const TYPE_MATCHERS = Object.freeze(Object.fromEntries(
  Object.entries(TYPE_MATCHERS_RAW).map(([type, cfg]) => {
    const paths = new Set(cfg.pathKeywords);
    for (const p of cfg.pathKeywords) if (p.includes("-")) paths.add(dehyphen(p));
    return [type, { ...cfg, pathKeywords: [...paths] }];
  }),
));

// Convention fallback lists, also augmented with de-hyphenated variants.
export const CONVENTION_PATHS = Object.freeze(Object.fromEntries(
  Object.entries(CONVENTION_PATHS_RAW).map(([type, paths]) => {
    const set = new Set(paths);
    for (const p of paths) if (p.includes("-")) set.add(p.replace(/-/g, ""));
    return [type, [...set]];
  }),
));

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function wholeWord(text, kw) {
  return new RegExp("\\b" + escapeRegex(kw) + "\\b", "i").test(text);
}
function normalizeText(t) {
  return String(t || "").toLowerCase().replace(/\s+/g, " ").trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}
function pathSegments(href, origin) {
  try {
    return new URL(href, origin).pathname.toLowerCase().split("/").filter(Boolean);
  } catch {
    return [];
  }
}

function matchesType(cfg, textNorm, segs, wordCount) {
  // Funding exclusion (paywall ≠ funding) — applies regardless of label gate.
  if (cfg.excludeText && cfg.excludeText.some((x) => wholeWord(textNorm, x))) return false;

  // PATH: exact segment match (incl. de-hyphenated variants) — always counts.
  if (segs.some((s) => cfg.pathKeywords.includes(s))) return true;

  // TEXT: only for LABEL-like link text (short), via word boundary.
  const isLabel = wordCount > 0 && wordCount <= MAX_LABEL_WORDS;
  if (!isLabel) return false;
  if (cfg.aiBoundary) {
    if (cfg.textKeywords.some((k) => wholeWord(textNorm, k))) return true;
    return AI_WORD.test(textNorm);
  }
  return cfg.textKeywords.some((k) => wholeWord(textNorm, k));
}

/**
 * classifyLink(text, href, origin) → array of page-types this link matches.
 * Exposed for unit-testing the keyword logic + Q2/label hazards directly.
 */
export function classifyLink(text, href, origin = "https://example.com") {
  const textNorm = normalizeText(text);
  const wordCount = textNorm ? textNorm.split(" ").length : 0;
  const segs = pathSegments(href, origin + "/");
  return PAGE_TYPES.filter((type) => matchesType(TYPE_MATCHERS[type], textNorm, segs, wordCount));
}

function emptyCandidates() {
  return { leadership: [], standards: [], corrections: [], funding: [], ai: [] };
}

/**
 * extractCandidates(doc, origin) → {type: [{url, source:"nav", linkText}]}.
 * Parses nav/footer/header anchors, resolves to absolute URLs, dedupes per
 * type, and DROPS candidates that resolve to the homepage path "/" (junk nav
 * hrefs). Exposed for offline unit-testing against an HTML fixture.
 */
export function extractCandidates(doc, origin) {
  const out = emptyCandidates();
  const seen = new Set();
  for (const a of doc.querySelectorAll("nav a, footer a, header a")) {
    const rawText = a.textContent || "";
    const href = a.getAttribute("href");
    if (!href) continue;
    let u;
    try { u = new URL(href, origin + "/"); } catch { continue; }
    if (u.pathname === "/" || u.pathname === "") continue; // homepage / junk
    const absUrl = u.toString();
    for (const type of classifyLink(rawText, href, origin)) {
      const key = type + "|" + absUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      out[type].push({ url: absUrl, source: "nav", linkText: rawText.trim().slice(0, 80) });
    }
  }
  return out;
}

/**
 * discoverSite(source, ctx) → { ok, site, candidates, homepageOk, homepageUrl?, reason? }.
 */
export async function discoverSite(source, ctx = {}) {
  const site = await openSite(source, ctx);
  if (!site.ok) {
    return { ok: false, reason: site.reason || "no-editorial-domain", site, candidates: emptyCandidates(), homepageOk: false };
  }
  const home = await site.fetch("/");
  if (!home.ok) {
    return { ok: false, reason: home.reason, site, candidates: emptyCandidates(), homepageOk: false };
  }
  const candidates = extractCandidates(home.doc, site.origin);
  return { ok: true, site, candidates, homepageOk: true, homepageUrl: home.finalUrl };
}
