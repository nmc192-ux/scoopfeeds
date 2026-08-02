/**
 * videoPakistanBlock.js — Rule 0: no Pakistan-related video. Ever.
 *
 * ABSOLUTE. This is not an editorial preference like D1
 * (videoEditorialPolicy.js) — it is a hard rule with:
 *
 *   - NO env flag. There is no VIDEO_ALLOW_* override, and none may be added.
 *   - NO force option. The functions accept no opts that can bypass them.
 *   - NO category bypass. D1's ALWAYS_GLOBAL_CATEGORIES shortcut does not
 *     exist here — a "world"-category story about Pakistan is still blocked.
 *   - OVER-BLOCKING IS CORRECT BEHAVIOUR. A false positive costs one video
 *     out of a daily surplus of candidates; a false negative publishes the
 *     one thing this channel must never publish. Do not narrow a term
 *     because it produced a false positive. ("dawn" blocking "New dawn for
 *     solar power" is the rule working, not a bug — there is a test
 *     asserting exactly that.)
 *
 * DETERMINISTIC MATCHER ONLY — never a prompt instruction. A prompt is a
 * request to a model, and models ignore requests at some nonzero rate; a
 * regex has no failure rate. Nothing in this rule may ever be enforced by
 * adding a line to buildSpecPrompt or any other prompt.
 *
 * THREE ENFORCEMENT LAYERS, each independent — every layer re-runs the full
 * matcher itself and assumes the earlier layers did NOT run:
 *
 *   Layer 1 — SELECTION.        filterAtSelection(candidates) before any
 *                               generation spend.
 *   Layer 2 — POST-GENERATION.  checkPostGeneration(article, artifacts)
 *                               after spec/packaging/narration exist: rescans
 *                               the article AND everything the model
 *                               produced, so enrichment drift (a spec that
 *                               surfaces Pakistan content from a story that
 *                               slipped selection) is caught too.
 *   Layer 3 — PUBLISH.          assertPublishAllowed(article, artifacts)
 *                               immediately before upload. THROWS
 *                               PakistanBlockError — a publish path that
 *                               forgets to check cannot publish, because the
 *                               throw is the check.
 *
 * Relationship to D1: D1 still governs PK-domestic-politics scoping and keeps
 * its override, but Rule 0 sits in front of it and is checked first. Where
 * D1 deliberately allowed "Pakistan and India agree ceasefire" as globally
 * relevant, Rule 0 blocks it. D1's module is untouched.
 *
 * Required fixture: the Geo News Bilawal/JAAC article from the 2026-08-02
 * harness run. It must trip MULTIPLE independent signals (source, category,
 * several terms) so that no single list edit can quietly un-block it.
 */

import { logger } from "./logger.js";

// ─── Matcher configuration ──────────────────────────────────────────────────
// Every entry is a word-boundary regex (multi-word terms tolerate any
// whitespace run). `prefix` entries match the stem and all its inflections —
// \bpakistan catches pakistan / pakistani / pakistanis.

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
const term   = (t) => ({ label: t, re: new RegExp(`\\b${esc(t).replace(/\s+/g, "\\s+")}\\b`, "i") });
const prefix = (t) => ({ label: `${t}*`, re: new RegExp(`\\b${esc(t)}`, "i") });

const TERMS = [
  // The country, all inflections, and its geography. Over-broad on purpose:
  // "punjab*" also matches Indian Punjab, "kashmir*" matches the whole
  // dispute, "hyderabad" matches the Indian city. Sanctioned — see header.
  prefix("pakistan"),
  prefix("punjab"), prefix("sindh"), prefix("baloch"), prefix("kashmir"),
  term("khyber"), term("pakhtunkhwa"), term("gilgit"), term("waziristan"),
  term("swat valley"), term("gwadar"), term("durand line"), term("line of control"),
  term("karachi"), term("lahore"), term("islamabad"), term("rawalpindi"),
  term("peshawar"), term("quetta"), term("faisalabad"), term("multan"),
  term("hyderabad"), term("skardu"),
  // Politics and figures. Surnames alone over-block (any Sharif, any Khan
  // would be too far — "khan" alone is excluded as the one concession to
  // usability, but "imran khan" is in).
  term("bilawal"), term("bhutto"), term("zardari"), term("imran khan"),
  term("nawaz"), term("shehbaz"), term("sharif"), term("maryam nawaz"),
  term("asim munir"), term("bajwa"),
  // Parties, institutions, acronyms. \bnab\b matches "police nab suspect" —
  // sanctioned. "jaac" is from the required Geo News fixture.
  term("pti"), term("pml-n"), term("pml n"), term("ppp"), term("jui-f"),
  term("mqm"), prefix("tehreek"), term("jamaat-e-islami"),
  term("national assembly"), term("senate of pakistan"),
  term("supreme court of pakistan"), term("election commission of pakistan"),
  term("ecp"), term("nab"), term("fbr"), term("ogra"), term("nepra"),
  term("wapda"), term("isi"), term("ispr"), term("jaac"),
  term("cpec"), term("pkr"),
];

// Pakistani outlets. FIELD-SCOPED: these match source-bearing fields ONLY —
// article.source_name, and `source` / `publisher` / sources-card `items`
// inside generated artifacts. They are NEVER matched against title,
// description, body content, or narration.
//
// This is the one narrowing the header's "do not narrow a term" rule does not
// cover, because it is not a narrowing of WHAT counts as an outlet signal —
// it is a correction of WHERE an outlet name is evidence at all. Measured
// 2026-08-02: a USC football story was blocked because its body contained the
// phrase "the nation". "The Nation" as a masthead in source_name is a
// Pakistan signal; "the nation" in prose is English. Scoping preserves every
// true positive (a Pakistani outlet always appears in source_name) while
// removing a class of false positive that has nothing to do with Pakistan.
//
// Topical terms above stay GLOBAL across every field, including content.
const OUTLETS = [
  term("geo news"), term("geo tv"), term("geo.tv"), term("dawn"),
  term("ary news"), term("ary"), term("the news international"),
  term("express tribune"), term("samaa"), term("dunya"), term("bol news"),
  term("92 news"), term("hum news"), term("ptv"), term("the nation"),
];

// Category taxonomy slugs that are Pakistan by definition. Compared exactly
// (lowercased) against article.category.
const CATEGORIES = [
  "pakistan", "pakistan-politics", "national", "punjab", "sindh",
  "balochistan", "kpk", "khyber-pakhtunkhwa", "gilgit-baltistan",
  "azad-kashmir",
];

// ─── Core matcher (pure, deterministic) ─────────────────────────────────────

const norm = (s) => String(s ?? "");

// Keys whose values are source-bearing, inside generated artifacts. The
// attribution card's `outlet` is covered here directly; the legacy plural
// `sources` card's `items` array is still handled in walkArtifact so an
// artifact produced before the §3b rename cannot slip past Rule 0.
const SOURCE_KEY_RE = /^(source|source_name|sources|outlet|outlets|publisher|attribution)$/i;

/**
 * Scan one string for TOPICAL terms. Global — applies to every field
 * including body content and generated narration. Pure.
 */
export function scanTextForPakistan(text, field = "text") {
  const t = norm(text);
  if (!t) return [];
  const out = [];
  for (const { label, re } of TERMS) if (re.test(t)) out.push({ kind: "term", signal: label, field });
  return out;
}

/**
 * Scan one string for OUTLET identifiers. Field-scoped by construction — only
 * ever called on source-bearing fields. Pure.
 */
export function scanSourceForPakistan(text, field = "source_name") {
  const t = norm(text);
  if (!t) return [];
  const out = [];
  for (const { label, re } of OUTLETS) if (re.test(t)) out.push({ kind: "outlet", signal: label, field });
  return out;
}

/**
 * Full article assessment. Scans every text-bearing field, the source_name
 * against the outlet list, and the category against the taxonomy list.
 * Returns every match — redundancy is the point: the required fixture trips
 * source AND category AND multiple terms, so no single list edit un-blocks it.
 */
export function pakistanMatches(article) {
  if (!article || typeof article !== "object") return [];
  const matches = [];

  const category = norm(article.category).toLowerCase().trim();
  if (CATEGORIES.includes(category)) {
    matches.push({ kind: "category", signal: category, field: "category" });
  }

  // Outlet identifiers: source_name ONLY. Never content — see OUTLETS header.
  for (const m of scanSourceForPakistan(article.source_name, "source_name")) {
    matches.push({ ...m, kind: "source" });
  }

  // Topical terms: every field, full body included, unlike D1. A passing
  // mention in paragraph nine blocks the video — the over-block Rule 0
  // sanctions.
  for (const field of ["title", "description", "content", "tags", "source_name", "category"]) {
    matches.push(...scanTextForPakistan(article[field], field));
  }

  return matches;
}

/**
 * Walk a generated artifact, applying topical terms everywhere and outlet
 * identifiers ONLY to source-bearing keys. Strings are scanned for terms
 * alone: plain narration has no field structure, so an outlet name in prose
 * is prose.
 */
function walkArtifact(node, label, path, out) {
  if (node === null || node === undefined) return;
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    out.push(...scanTextForPakistan(String(node), `${label}${path}`));
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkArtifact(v, label, `${path}[${i}]`, out));
    return;
  }
  if (typeof node !== "object") return;

  const isSourcesCard = node.t === "sources" || node.t === "attribution";
  for (const [k, v] of Object.entries(node)) {
    const p = `${path}.${k}`;
    // `items` is source-bearing only on a sources card, where it is the outlet
    // list; elsewhere the key is far too generic to treat that way.
    const sourceBearing = SOURCE_KEY_RE.test(k) || (isSourcesCard && k === "items");
    if (sourceBearing) {
      const flat = [];
      const collect = (x) => {
        if (x === null || x === undefined) return;
        if (Array.isArray(x)) { x.forEach(collect); return; }
        if (typeof x === "object") { walkArtifact(x, label, p, out); return; }
        flat.push(String(x));
      };
      collect(v);
      for (const s of flat) {
        out.push(...scanTextForPakistan(s, `${label}${p}`));
        out.push(...scanSourceForPakistan(s, `${label}${p}`));
      }
    } else {
      walkArtifact(v, label, p, out);
    }
  }
}

/** Public artifact scanner — strings get terms; objects get the field-scoped walk. */
export function scanArtifactForPakistan(artifact, label = "artifact") {
  const out = [];
  walkArtifact(artifact, label, "", out);
  return out;
}

/** { blocked, matches } for one article. */
export function isPakistanBlocked(article) {
  const matches = pakistanMatches(article);
  return { blocked: matches.length > 0, matches };
}

const summarize = (matches) =>
  [...new Set(matches.map(m => `${m.kind}:${m.signal}@${m.field}`))].slice(0, 8).join(", ");

// ─── Layer 1 — selection ────────────────────────────────────────────────────

/**
 * Filter a candidate list before any generation spend. No opts parameter —
 * there is deliberately nothing to pass that changes the outcome.
 */
export function filterAtSelection(articles = []) {
  const kept = [];
  for (const a of articles) {
    const { blocked, matches } = isPakistanBlocked(a);
    if (blocked) {
      logger.info(`🚫 Rule 0 [layer1:selection] blocked ${a?.id} — ${summarize(matches)} — "${norm(a?.title).slice(0, 70)}"`);
      continue;
    }
    kept.push(a);
  }
  return kept;
}

// ─── Layer 2 — post-generation ──────────────────────────────────────────────

/**
 * After spec/packaging/narration exist. Re-runs the FULL article matcher
 * (independence from layer 1) and additionally scans every generated
 * artifact — objects are serialized, so a Pakistan signal in any nested
 * field (a caption, a stat source, a hashtag) is caught.
 *
 * @param {object} article
 * @param {Array<string|object>} artifacts — spec, packaging, narration, etc.
 * @returns {{ blocked, matches }}
 */
export function checkPostGeneration(article, artifacts = []) {
  const matches = pakistanMatches(article);
  artifacts.forEach((artifact, i) => {
    matches.push(...scanArtifactForPakistan(artifact, `artifact[${i}]`));
  });
  const blocked = matches.length > 0;
  if (blocked) {
    logger.warn(`🚫 Rule 0 [layer2:post-generation] blocked ${article?.id} — ${summarize(matches)}`);
  }
  return { blocked, matches };
}

// ─── Layer 3 — publish ──────────────────────────────────────────────────────

export class PakistanBlockError extends Error {
  constructor(articleId, matches) {
    super(`Rule 0: Pakistan-related content may not be published as video (article ${articleId}: ${summarize(matches)})`);
    this.name = "PakistanBlockError";
    this.articleId = articleId;
    this.matches = matches;
  }
}

/**
 * The last gate before upload. THROWS on a block — a publish path cannot
 * forget to check this, because calling it IS the check and an uncaught
 * PakistanBlockError aborts the upload. Independent of layers 1 and 2:
 * it re-runs everything itself.
 */
export function assertPublishAllowed(article, artifacts = []) {
  const matches = pakistanMatches(article);
  artifacts.forEach((artifact, i) => {
    matches.push(...scanArtifactForPakistan(artifact, `artifact[${i}]`));
  });
  if (matches.length > 0) {
    logger.error(`🚫 Rule 0 [layer3:publish] BLOCKED ${article?.id} at the publish gate — two earlier layers should have caught this — ${summarize(matches)}`);
    throw new PakistanBlockError(article?.id, matches);
  }
}

export const _internals = { TERMS, OUTLETS, CATEGORIES };
