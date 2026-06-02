/**
 * combination.js — the score-COMBINATION function.
 *
 * Blends the five component sub-scores (each 0–100) into one 0–100 quality
 * score, per methodology §3.1: a weighted sum, then a floor-rule cap.
 *
 * Scope (B.6.1): combination ONLY. This function does NOT gather evidence,
 * score sub-criteria, or assign posture — those are later sprints (B.6.2+).
 * It takes the five component sub-scores AS GIVEN (exactly as the calibration
 * does) and proves the combination math against the 15-source ground truth
 * before any evidence-gathering exists.
 *
 * Posture does NOT enter the combination. Per the methodology, posture shapes
 * the component INPUTS (it sets the Independence component's expected band and
 * substitutes the Aggregator ET sub-criteria) but is not a term in the
 * weighted sum — so this function takes no posture argument.
 *
 * Domain expertise (DE) is a category-mix-weighted aggregate upstream
 * (methodology §2.3); for B.6.1 the DE sub-score is accepted as given, exactly
 * as the calibration provides it. The category-weighting FUNCTION is later
 * work (B.6.2+).
 *
 * Pure function — no I/O, no DB, deterministic.
 */

import { RUBRIC, COMPONENT_KEYS } from "./rubric.js";

export class ScoringInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ScoringInputError";
  }
}

/**
 * combineScore — (componentScores) → { score, raw, floorTriggered }
 *
 * @param {{ET:number,MT:number,DE:number,Ind:number,HA:number}} components
 *        Each sub-score is a number in [0,100].
 * @param {object} [rubric=RUBRIC] Weights + floor (defaults to the committed rubric).
 * @returns {{score:number, raw:number, floorTriggered:boolean}}
 *          score = final 0–100 (integer, floor-capped); raw = pre-round
 *          weighted sum; floorTriggered = whether the floor cap applied.
 */
export function combineScore(components, rubric = RUBRIC) {
  if (!components || typeof components !== "object") {
    throw new ScoringInputError("components must be an object keyed by component name");
  }
  for (const key of COMPONENT_KEYS) {
    const v = components[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) {
      throw new ScoringInputError(
        `component "${key}" must be a number in [0,100] (got ${JSON.stringify(v)})`,
      );
    }
  }

  const w = rubric.weights;
  // Weighted sum. Weights are integer percents → divide by 100.
  let weightedSum = 0;
  for (const key of COMPONENT_KEYS) {
    weightedSum += components[key] * w[key];
  }
  weightedSum = weightedSum / 100;

  let score = Math.round(weightedSum);

  // Floor rule: any single component below threshold caps the overall score.
  const minComponent = Math.min(...COMPONENT_KEYS.map((k) => components[k]));
  const floorTriggered = minComponent < rubric.floor.threshold;
  if (floorTriggered) {
    score = Math.min(score, rubric.floor.cap);
  }

  return { score, raw: weightedSum, floorTriggered };
}
