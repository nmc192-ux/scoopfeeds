/**
 * rubric.js — Source Credibility scoring rubric config (committed, PUBLIC).
 *
 * Single source of truth for the score-COMBINATION parameters: the five
 * component weights + the floor rule + the methodology version they apply to.
 *
 * Position-C ruling (DrJ, Track 2 B.6.0): the headline component weights are
 * PUBLIC and committed. They are already published in the repo —
 * docs/audits/phase_a_source_audit_phase2_calibration.md §1.2 — and the
 * coherence test (coherence.test.js) binds THIS file to that document so the
 * two can never silently drift. The competitive moat is the evidence-gathering
 * (per-sub-criterion data assembly, the DE category-weighting function, LLM
 * prompts, and the "small set of additional rules" of methodology §3.1), NOT
 * these five numbers.
 *
 * Provenance:
 *   - Weights + floor: calibration §1.2 — validated 15/15 within expected
 *     ranges under methodology v1.0 (calibration §1.4).
 *   - Combination shape: docs/content/source_credibility_methodology.md §3
 *     (weighted sum → floor cap; DE input is a category-mix aggregate).
 *   - Weights are STABLE across v1.0 → v1.1: the three v1.1 refinements
 *     (calibration §4) are RUBRIC sub-criteria changes, not weight changes —
 *     so tagging these weights "v1.1" is correct.
 *
 * Weights are integer percents, MUST sum to 100, and each sits within the
 * methodology §3.1 published bound of 5–40%. (Asserted by coherence.test.js.)
 */

export const RUBRIC = Object.freeze({
  methodology_version: "v1.1",

  // The five methodology §2 components:
  //   ET  = Editorial track record   (§2.1)
  //   MT  = Methodology transparency  (§2.2)
  //   DE  = Domain expertise          (§2.3) — category-mix aggregate upstream
  //   Ind = Independence              (§2.4)
  //   HA  = Historical accuracy       (§2.5)
  weights: Object.freeze({
    ET: 25,
    Ind: 25,
    HA: 20,
    MT: 15,
    DE: 15,
  }),

  // Floor rule (methodology §3.1; calibration §1.2): if ANY single component
  // scores below `threshold`, the overall score is capped at `cap`.
  floor: Object.freeze({
    threshold: 30,
    cap: 50,
  }),
});

// Canonical component order for downstream surfaces (audit log, Layer 2
// scorecard). Combination is order-independent — it keys by name.
export const COMPONENT_KEYS = Object.freeze(["ET", "MT", "DE", "Ind", "HA"]);
