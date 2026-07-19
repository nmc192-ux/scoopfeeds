/**
 * videoEditorialPolicy.js — editorial boundary for public video channels.
 *
 * Decision D1 (docs/content/video_channel_tracker.md, 2026-07-19):
 *   Pakistani domestic and political news is out of scope for the public
 *   video channels unless explicitly directed. The channels target a global
 *   audience with topics of wider public interest.
 *
 * Why this lives in its own module rather than inline in the SQL selection:
 *   1. The same boundary has to apply at three different points — queue
 *      selection, auto-approve, and publish — and a single source of truth
 *      is the only way those three stay in agreement.
 *   2. It is an *editorial* rule, not a technical one. Editorial rules change
 *      by founder decision, so they belong somewhere a non-specialist can
 *      read, audit, and amend without touching query logic.
 *   3. Keyword lists are the kind of thing that quietly rots. Isolated and
 *      commented, it stays reviewable.
 *
 * Scope note — this filter governs what becomes VIDEO. It does not touch
 * ingestion, the website, or text social posts. Pakistani domestic coverage
 * continues to be collected and published on scoopfeeds.com as normal.
 *
 * Override: set VIDEO_ALLOW_PK_DOMESTIC=1 to disable the filter for a run
 * (the "unless specifically directed by me" branch of D1). Any article can
 * also be force-allowed by passing { force: true }.
 */

import { logger } from "./logger.js";

// ─── Boundary configuration ─────────────────────────────────────────────────

// Categories that are domestic-politics by definition in our taxonomy.
// Matched case-insensitively against article.category.
const PK_DOMESTIC_CATEGORIES = [
  "pakistan",
  "pakistan-politics",
  "national",
  "punjab",
  "sindh",
  "balochistan",
  "kpk",
  "khyber-pakhtunkhwa",
  "gilgit-baltistan",
  "azad-kashmir",
];

// Institutional and political terms whose presence in a headline reliably
// signals Pakistani domestic politics rather than a story of global interest.
//
// Deliberately NARROW. Terms like "Pakistan" alone are excluded, because
// "Pakistan and India agree ceasefire" or "Pakistan floods displace millions"
// are exactly the globally-relevant stories the channel should cover. We are
// filtering domestic *politics and administration*, not the country.
const PK_DOMESTIC_TERMS = [
  // Institutions
  "national assembly", "senate of pakistan", "provincial assembly",
  "punjab assembly", "sindh assembly", "election commission of pakistan",
  "ecp", "nab ", "national accountability bureau", "fbr",
  "federal board of revenue", "ogra", "nepra", "wapda",
  // Offices
  "prime minister of pakistan", "chief minister", "governor punjab",
  "governor sindh", "deputy commissioner", "commissioner ",
  "chief secretary", "dc office",
  // Parties
  "pti ", "pml-n", "pml n", "ppp ", "jui-f", "mqm", "tehreek-e-insaf",
  "muslim league", "peoples party", "jamaat-e-islami",
  // Domestic political process
  "by-election", "no-confidence motion", "senate election",
  "local bodies election", "nazim", "tehsil council", "union council",
];

// Categories that are always in scope — global by nature. Used to short-circuit
// keyword scanning, since a term like "commissioner " has innocent uses
// (e.g. "European Commissioner", "NFL commissioner").
const ALWAYS_GLOBAL_CATEGORIES = [
  "world", "international", "business", "markets", "technology",
  "science", "health", "climate", "sports", "entertainment",
];

// ─── Evaluation ─────────────────────────────────────────────────────────────

function norm(s) {
  return String(s || "").toLowerCase();
}

/**
 * Decide whether an article may become a public video.
 *
 * @param {object} article  { title, description, category, source_name }
 * @param {object} opts     { force }
 * @returns {{ allowed: boolean, reason: string|null, rule: string|null }}
 */
export function isVideoEligible(article, opts = {}) {
  if (!article) return { allowed: false, reason: "no article", rule: "invalid" };

  // Explicit direction overrides the boundary — the D1 escape hatch.
  if (opts.force) {
    return { allowed: true, reason: null, rule: "forced" };
  }
  if (process.env.VIDEO_ALLOW_PK_DOMESTIC === "1") {
    return { allowed: true, reason: null, rule: "override:VIDEO_ALLOW_PK_DOMESTIC" };
  }

  const category = norm(article.category);

  // Global-by-nature categories skip keyword scanning entirely.
  if (ALWAYS_GLOBAL_CATEGORIES.includes(category)) {
    return { allowed: true, reason: null, rule: "global-category" };
  }

  // Category-level exclusion.
  if (PK_DOMESTIC_CATEGORIES.includes(category)) {
    return {
      allowed: false,
      reason: `category "${article.category}" is PK-domestic (D1)`,
      rule: "d1:category",
    };
  }

  // Headline-level exclusion. Title + description only — scanning full body
  // text produces false positives on passing mentions, and a story about
  // Pakistani domestic politics will say so in its headline.
  const haystack = `${norm(article.title)} ${norm(article.description)}`;
  const hit = PK_DOMESTIC_TERMS.find(term => haystack.includes(term));
  if (hit) {
    return {
      allowed: false,
      reason: `matched PK-domestic term "${hit.trim()}" (D1)`,
      rule: "d1:term",
    };
  }

  return { allowed: true, reason: null, rule: "default-allow" };
}

/**
 * Filter a candidate list, logging each exclusion so the tracker can report
 * honestly on how much the boundary is actually removing.
 */
export function filterVideoEligible(articles = [], opts = {}) {
  const kept = [];
  let dropped = 0;
  for (const a of articles) {
    const verdict = isVideoEligible(a, opts);
    if (verdict.allowed) {
      kept.push(a);
    } else {
      dropped++;
      logger.debug(`🎬 D1 skip [${a.id}] ${verdict.reason} — "${String(a.title || "").slice(0, 70)}"`);
    }
  }
  if (dropped > 0) {
    logger.info(`🎬 Editorial boundary (D1) excluded ${dropped} of ${articles.length} video candidates`);
  }
  return kept;
}

export const _internals = { PK_DOMESTIC_CATEGORIES, PK_DOMESTIC_TERMS, ALWAYS_GLOBAL_CATEGORIES };
