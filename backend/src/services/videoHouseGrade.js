/**
 * videoHouseGrade.js — the house look, in one place, on the runtime side.
 *
 * WHY THIS FILE EXISTS. The cooled house grade was defined in
 * `scripts/lib/stock/treat.mjs`, which is operator tooling and is deliberately
 * UNREACHABLE from any process that boots on the VPS — `stockLibraryBoundary.test.js`
 * asserts exactly that, and the boundary's own error message states the rule:
 * *import the library FROM the scripts, never the scripts from the runtime.*
 *
 * Incident media is graded at render time, on the server, so it needs the same
 * grade — and importing it from behind that boundary would break the guard.
 * Restating it here instead would leave two copies of one number set to drift
 * apart, which is the failure this repo has already had with the tragedy
 * keywords and with GEMINI_GENERATION_MODEL's two defaults.
 *
 * So the definition moves to the runtime side and the script imports it. That is
 * the direction the boundary permits, it leaves exactly one definition, and
 * `treat.mjs` keeps its public surface by re-exporting.
 *
 * THIS IS STYLE, AND ONLY STYLE. Grading makes a clip look like ours. It has no
 * bearing whatsoever on whether we may use it — that is decided in
 * incidentClearance.js, before anything reaches a filter chain, and no function
 * in this file is an input to that decision.
 */

import { GRADES } from "./longform/storyboardInterpreter.js";

/**
 * Blue lift matching the `marine` grade.
 *
 * The Aug 14 prototype's mixer read strongly olive; the fix was identified as a
 * one-line coefficient change, and this is it. The house default's blue terms
 * are CUTS (bs=-0.08, bm=-0.06), which is what pushed everything green-yellow;
 * taking them positive cools the image back without touching saturation,
 * contrast or the vignette.
 */
export const COOL_BLUE_SHADOWS = "0.04";
export const COOL_BLUE_MIDS = "0.03";

/**
 * Take the blue terms of a colorbalance chain positive.
 *
 * Operates on the chain STRING rather than rebuilding it, so the rest of the
 * house grade — the part nobody is arguing about — cannot be accidentally
 * respecified while changing the two terms that are.
 */
export function coolGrade(chain) {
  return String(chain)
    .replace(/\bbs=-?[\d.]+/, `bs=${COOL_BLUE_SHADOWS}`)
    .replace(/\bbm=-?[\d.]+/, `bm=${COOL_BLUE_MIDS}`);
}

/** The library grade: the house default, cooled. One definition, two consumers. */
export const LIBRARY_GRADE = coolGrade(GRADES.default);
