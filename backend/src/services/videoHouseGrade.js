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

/**
 * INCIDENT_GRADE — deliberately lighter than the library grade, and deliberately
 * a SEPARATE CONSTANT rather than a flag on the one above.
 *
 * THE RULING (DrJ, Gate C): grade lighter on incident footage. Grading a phone
 * clip to the same plate as a curated stock asset reads as *produced*, and
 * produced is what this engine exists to stop looking like. Noise, exposure
 * error and colour cast are credibility signals in eyewitness material — a
 * viewer reads an over-graded clip of a flood as something we made, and the
 * whole point of the grant, the verification and the credit chip is that we did
 * not make it. So: match the black point, then stop.
 *
 * What that means concretely, against LIBRARY_GRADE:
 *   saturation  0.42 → 0.88   the crush is what makes stock read as a plate
 *   contrast    1.14 → 1.04   enough to seat the blacks, not to restyle
 *   brightness -0.10 → -0.06  the black point, which is the part we DO match
 *   gamma       0.94 → 0.98   barely off neutral
 *   colorbalance      dropped  a colour push is a look, not a black point
 *   vignette          dropped  a vignette is unambiguously OUR framing, and
 *                              putting one on somebody else's footage is the
 *                              single most "produced" thing in the chain
 *
 * TWO CONSTANTS, NOT ONE WITH A PARAMETER. A parameterised grade is one
 * definition that both callers share, which means a change made for stock
 * silently lands on incident footage too — and the whole ruling is that they
 * must NOT move together. Separate constants cannot drift into each other;
 * a test asserts they are distinct and that this one carries no vignette.
 *
 * THIS IS STYLE. Like everything else in this file it has no bearing on whether
 * the footage may be used.
 *
 * ⚠️ UNVALIDATED AGAINST REAL FOOTAGE. The Gate C render that prompted this
 * ruling used an ffmpeg test pattern, which has no grain, no exposure error and
 * no colour cast — so it CANNOT show whether these numbers are right. The first
 * real granted clip is the test, and these values are a starting point to be
 * looked at, not a measurement.
 */
export const INCIDENT_GRADE =
  "eq=saturation=0.88:contrast=1.04:brightness=-0.06:gamma=0.98";
