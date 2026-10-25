/**
 * sourceAdmission.js — who may join config/sources.js in a source step (#251, plan v7 source steps).
 *
 * full-throttle.md §4: new sources need no approval, but every one must be scored and clear a
 * stated quality floor; English only. This module is the rule, kept pure so it is testable and
 * so scripts/sources/source-step.mjs and any later runner apply the same one.
 *
 * Two gates, both fail closed:
 *   1. probeVerdict()     — the feed works: HTTP 200 and parses, ≥ MIN_ITEMS items, newest item
 *                           under MAX_AGE_HOURS old, reads as English, host not already listed.
 *   2. admissionVerdict() — the scorer measured it (status "scored", at least N_COMPONENTS
 *                           components at or above MIN_COVERAGE) AND quality_score >= floor.
 *                           Unscored or insufficient-data is NOT admitted: unmeasured is not a pass.
 *
 * The floor is SOURCE_QUALITY_FLOOR (code default 60). The spec asks that, if the 25th percentile
 * of the current active sources is above 60, that percentile be used instead; floorFromScores()
 * computes it from measured scores, and returns the default (with the reason) when too few exist.
 */

import { MIN_COVERAGE, N_COMPONENTS } from "./scorer.js";

export const DEFAULT_SOURCE_QUALITY_FLOOR = 60;
export const MIN_ITEMS = 5;
export const MAX_AGE_HOURS = 72;
export const ENGLISH_SAMPLE = 5;
export const MIN_SCORES_FOR_PERCENTILE = 20;

/** SOURCE_QUALITY_FLOOR when it is an integer 0..100, else the code default. */
export function sourceQualityFloor(env = process.env) {
  const n = Number.parseInt(env.SOURCE_QUALITY_FLOOR ?? "", 10);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : DEFAULT_SOURCE_QUALITY_FLOOR;
}

/** Nearest-rank 25th percentile of finite numbers; null when empty. */
export function percentile25(values) {
  const v = (values || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.max(0, Math.ceil(0.25 * v.length) - 1)];
}

/**
 * floorFromScores(scores, { base }) → { floor, p25, measured, reason }
 * The floor is max(base, p25) when at least MIN_SCORES_FOR_PERCENTILE scores were measured.
 */
export function floorFromScores(scores, { base = DEFAULT_SOURCE_QUALITY_FLOOR } = {}) {
  const measured = (scores || []).filter((x) => Number.isFinite(x)).length;
  if (measured < MIN_SCORES_FOR_PERCENTILE) {
    return { floor: base, p25: null, measured, reason: `only ${measured} active source(s) scored (need ${MIN_SCORES_FOR_PERCENTILE}); default floor` };
  }
  const p25 = percentile25(scores);
  return p25 > base
    ? { floor: p25, p25, measured, reason: `25th percentile of current active sources (${p25}) is above ${base}` }
    : { floor: base, p25, measured, reason: `25th percentile (${p25}) is not above ${base}; default floor` };
}

// The 40 most frequent English words; a real English headline set hits several per line.
const EN_WORDS = new Set(("the of and to a in is for on that with as at by from it be are was this an " +
  "has have will its after over new more says said about into than not who but up out his her their").split(" "));

/** Share of words in `text` that are common English function words (0..1); null when no words. */
export function englishShare(text) {
  const words = String(text || "").toLowerCase().match(/[\p{L}']+/gu) || [];
  if (!words.length) return null;
  return words.filter((w) => EN_WORDS.has(w)).length / words.length;
}

/** English when the first ENGLISH_SAMPLE items read as English (share >= 0.12) and are mostly Latin script. */
export function looksEnglish(items) {
  const text = (items || []).slice(0, ENGLISH_SAMPLE).map((i) => `${i.title || ""} ${i.contentSnippet || i.description || ""}`).join(" ");
  const letters = text.match(/\p{L}/gu) || [];
  if (letters.length < 40) return false;   // too little text to tell: unmeasured is not English
  const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length / letters.length;
  const share = englishShare(text);
  return latin >= 0.9 && share !== null && share >= 0.12;
}

export function hostOf(url) {
  try { return new URL(url).host.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

/**
 * probeVerdict({ candidate, feed, error, now, existingHosts }) → { ok, reason, items, newestAgeHours }
 * `feed` is a parsed rss-parser result (or null with `error`).
 */
export function probeVerdict({ candidate, feed, error = null, now = Date.now(), existingHosts = new Set() }) {
  const host = hostOf(candidate?.url);
  if (!host) return { ok: false, reason: "bad url" };
  if (existingHosts.has(host)) return { ok: false, reason: `host already listed (${host})` };
  if (error || !feed) return { ok: false, reason: `fetch/parse failed: ${String(error || "no feed").slice(0, 120)}` };
  const items = Array.isArray(feed.items) ? feed.items : [];
  if (items.length < MIN_ITEMS) return { ok: false, reason: `only ${items.length} item(s)`, items: items.length };
  const times = items.map((i) => Date.parse(i.isoDate || i.pubDate || "")).filter(Number.isFinite);
  if (!times.length) return { ok: false, reason: "no item dates (freshness unmeasured)", items: items.length };
  const newestAgeHours = Math.round(((now - Math.max(...times)) / 3600e3) * 10) / 10;
  if (newestAgeHours > MAX_AGE_HOURS) return { ok: false, reason: `newest item ${newestAgeHours} h old`, items: items.length, newestAgeHours };
  if (!looksEnglish(items)) return { ok: false, reason: "not English (or too little text to tell)", items: items.length, newestAgeHours };
  return { ok: true, reason: "ok", items: items.length, newestAgeHours };
}

/**
 * admissionVerdict({ quality_score, status, coverage }, { floor }) → { admit, reason }
 *   status   — the scorer card status ("scored" | "insufficient-data")
 *   coverage — { ET: 0..1, MT: …, … } per component, as written to the audit row
 */
export function admissionVerdict(score, { floor = sourceQualityFloor() } = {}) {
  if (!score || score.status !== "scored") return { admit: false, reason: "unscored or insufficient data (unmeasured is not admitted)" };
  const q = score.quality_score;
  if (!Number.isFinite(q)) return { admit: false, reason: "no quality_score" };
  const covered = Object.values(score.coverage || {}).filter((c) => Number.isFinite(c) && c >= MIN_COVERAGE).length;
  if (covered < N_COMPONENTS) return { admit: false, reason: `coverage: ${covered} component(s) at or above ${MIN_COVERAGE} (need ${N_COMPONENTS})` };
  if (q < floor) return { admit: false, reason: `quality_score ${q} below floor ${floor}` };
  return { admit: true, reason: `quality_score ${q} >= floor ${floor}` };
}
