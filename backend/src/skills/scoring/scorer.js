/**
 * scorer.js — evidence → component scorer (B.6.5 Phase 1).
 *
 * The missing seam between the evidence layer (per-sub-criterion Evidence rows)
 * and combineScore (5 component scores). Per the B.6.5 design
 * (docs/phases/b6_5_scoring_design.md):
 *   - roll up ONLY `evidenced` sub-criteria, renormalized over what's observed;
 *   - absent states (pending/pending-llm/unavailable/blocked) contribute NOTHING
 *     and are NEVER treated as level[0] (honesty-of-derivation);
 *   - per-component coverage gate (MIN_COVERAGE) → else component `insufficient`;
 *   - source emits a quality_score only if ≥ N_COMPONENTS present, else
 *     `insufficient-data` (no number);
 *   - the <30→cap 50 floor applies only over PRESENT components;
 *   - down-weight (never exclude) by confidence; temper thin samples (#110).
 *
 * Pure/compute-only: no DB writes, no audit insert (Phase 2). Takes the hydrated
 * evidence rows (listEvidenceForSource output) and returns the scorecard.
 */

import { RUBRIC, COMPONENT_KEYS } from "./rubric.js";

// Version of the AUTOMATED operationalization (the evidence→component mapping),
// tied to methodology RUBRIC.methodology_version (currently "v1.1"). PROVISIONAL:
// the bucket→numeric anchors + within-component weights are not yet GT-calibrated
// (the holistic v1.0 ground truth currently measures the evidence-coverage gap, not
// the mapping). Phase 2 threads this into writeSourceScore + scoring_audit_log.
export const SCORER_VERSION = `${RUBRIC.methodology_version}-scorer-p1-provisional`;

// ── Calibration constants (set in B.6.5 Phase 1 calibration) ─────────────────
export const MIN_COVERAGE = 0.25;  // a component needs ≥25% of its built sub-criteria evidenced
export const N_COMPONENTS = 3;     // a source needs ≥3 present components to emit a score
const THIN_FACTOR = 0.6;           // confidence multiplier for single-article judgments (#110)
const PRESENCE_ANCHOR = 67;          // presence-yes is positive but NOT maximal (fix C)
const SUSTAINED_MIN_WINDOW_DAYS = 180; // below this we CAN'T assess "≥12mo sustained" → 2.3.c insufficient (fix B, revised)

// ── Per-sub-criterion scorer config (the rubric mapping; calibratable) ───────
// type: ordinal | presence | ratio | graduated | ownership.  weight = within-component.
const L = {
  "2.1.d": ["no corrections process", "corrections issued but not transparent", "transparent corrections within reasonable timeframe", "public corrections log"],
  "2.2.a": ["unattributed", "mostly unattributed", "mostly attributed", "fully attributed + anonymity justified"],
  "2.2.c": ["no disclosure", "partial", "most elements", "full (method+N+MoE+limits)"],
  "2.2.d": ["no disclosure", "vague", "disclosed", "prominently disclosed"],
  "2.3.d": ["only other news", "mostly secondary", "mixed", "experts/primary sources"],
  "2.4.b": ["opaque", "disclosed in aggregate", "disclosed by category", "disclosed by named funder"],
  "2.5.b": ["substantive errors common", "some substantive", "mixed", "mostly cosmetic"],
};
export const SCORER_CONFIG = {
  // ET (§2.1) — 2.1.c/2.1.d weighted heavier per methodology emphasis.
  "2.1.a": { component: "ET", type: "presence", weight: 1 },
  "2.1.b": { component: "ET", type: "presence", weight: 1 },
  "2.1.c": { component: "ET", type: "ratio", weight: 2 },
  "2.1.d": { component: "ET", type: "ordinal", weight: 2, levels: L["2.1.d"] },
  // MT (§2.2)
  "2.2.a": { component: "MT", type: "ordinal", weight: 1, levels: L["2.2.a"] },
  "2.2.b": { component: "MT", type: "ratio", weight: 1 },
  "2.2.c": { component: "MT", type: "ordinal", weight: 1, levels: L["2.2.c"] },
  "2.2.d": { component: "MT", type: "ordinal", weight: 1, levels: L["2.2.d"] },
  "2.2.e": { component: "MT", type: "presence", weight: 1 },
  // DE (§2.3)
  "2.3.c": { component: "DE", type: "graduated", weight: 1 },
  "2.3.d": { component: "DE", type: "ordinal", weight: 1, levels: L["2.3.d"] },
  // Ind (§2.4)
  "2.4.a": { component: "Ind", type: "ownership", weight: 1 },
  "2.4.b": { component: "Ind", type: "ordinal", weight: 1, levels: L["2.4.b"] },
  // HA (§2.5)
  "2.5.b": { component: "HA", type: "ordinal", weight: 1, levels: L["2.5.b"] },
};
// Applicable (built) sub-criteria per component → coverage denominator.
export const APPLICABLE = COMPONENT_KEYS.reduce((m, c) => { m[c] = 0; return m; }, {});
for (const cfg of Object.values(SCORER_CONFIG)) APPLICABLE[cfg.component] += 1;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round2 = (n) => Math.round(n * 100) / 100;

// bucket → numeric [0,100] per evidence type. null = uninterpretable (skip).
function numericFor(sub, value) {
  const cfg = SCORER_CONFIG[sub];
  if (!cfg || !value) return null;
  switch (cfg.type) {
    case "presence":
      // A mechanism EXISTING is positive but not maximal (fix C) — anchor < 100.
      return value.found === true ? PRESENCE_ANCHOR : 0;
    case "ordinal": {
      const i = cfg.levels.indexOf(value.bucket);
      return i < 0 ? null : (i / (cfg.levels.length - 1)) * 100;
    }
    case "ratio":
      if (typeof value.ratio !== "number") return null;
      // 2.2.b is a clear-primary LOWER BOUND (design): a 0 means "no primary links
      // CONFIRMED", not "0% transparency" — uninformative → excluded (treated absent),
      // not scored as a real 0 that would tank MT and mis-fire the floor.
      if (sub === "2.2.b" && value.ratio === 0) return null;
      return clamp01(value.ratio) * 100;
    case "graduated": {
      // 2.3.c sustained coverage (≥12 months). Below a minimum observed window we
      // CANNOT assess sustained coverage — crushing continuity to a low number would
      // fabricate a pessimistic signal from "couldn't observe a year" (the same
      // lower-bound error as 2.2.b=0). So short windows → INSUFFICIENT (absent, not
      // scored); un-parks as the ingestion window accumulates past the threshold.
      // Above the threshold, score continuity normally.
      if (typeof value.continuity !== "number") return null;
      if (!value.observationWindowDays || value.observationWindowDays < SUSTAINED_MIN_WINDOW_DAYS) return null;
      return clamp01(value.continuity) * 100;
    }
    case "ownership": {
      const st = (value.structuralType || []).join(" ").toLowerCase();
      if (/nonprofit|public broadcast|charit|cooperative|foundation|university/.test(st)) return 90;
      if (/government|state/.test(st)) return 60;
      if (value.owner?.label || value.parent?.label || value.resolvedOwner?.label || value.resolvedParent?.label) return 70;
      return 50; // resolved but no named owner/type
    }
    default:
      return null;
  }
}

// Confidence used as a weight: row.confidence, tempered for thin samples (#110).
function temperedConfidence(row) {
  let c = typeof row.confidence === "number" ? row.confidence : 0;
  if (row.value && row.value.sampleCommitted === 1) c *= THIN_FACTOR;
  return c;
}

/** Score one component from its evidence rows. */
export function scoreComponent(rows, applicable, minCoverage = MIN_COVERAGE) {
  const ev = (rows || []).filter((r) => r.status === "evidenced" && numericFor(r.sub_criterion, r.value) != null);
  const coverage = applicable > 0 ? round2(ev.length / applicable) : 0;
  if (ev.length === 0 || coverage < minCoverage) {
    return { insufficient: true, coverage, evidencedCount: ev.length, applicable };
  }
  let wsum = 0, vsum = 0, cAcc = 0;
  for (const r of ev) {
    const num = numericFor(r.sub_criterion, r.value);
    const conf = temperedConfidence(r);
    const w = SCORER_CONFIG[r.sub_criterion].weight * (conf > 0 ? conf : 1e-6); // down-weight, never exclude
    wsum += w; vsum += num * w; cAcc += conf;
  }
  return {
    insufficient: false,
    score: Math.round(wsum > 0 ? vsum / wsum : ev.reduce((s, r) => s + numericFor(r.sub_criterion, r.value), 0) / ev.length),
    coverage,
    confidence: round2(cAcc / ev.length),
    evidencedCount: ev.length,
    applicable,
    contributing: ev.map((r) => r.sub_criterion),
  };
}

/**
 * scoreSource(evidenceList, opts) → scorecard
 *   { status:'scored'|'insufficient-data', quality_score|null, components:{ET,…},
 *     presentComponents:[], coverage, confidence, floorTriggered }
 * evidenceList = listEvidenceForSource(sourceId) (hydrated rows).
 */
export function scoreSource(evidenceList, { minCoverage = MIN_COVERAGE, nComponents = N_COMPONENTS } = {}) {
  const byComp = COMPONENT_KEYS.reduce((m, c) => { m[c] = []; return m; }, {});
  for (const r of evidenceList || []) {
    const cfg = SCORER_CONFIG[r.sub_criterion];
    if (cfg) byComp[cfg.component].push(r);
  }
  const components = {};
  for (const c of COMPONENT_KEYS) components[c] = scoreComponent(byComp[c], APPLICABLE[c], minCoverage);
  const present = COMPONENT_KEYS.filter((c) => !components[c].insufficient);

  if (present.length < nComponents) {
    return { status: "insufficient-data", quality_score: null, components, presentComponents: present, presentCount: present.length };
  }

  // Combine over PRESENT components only — renormalize weights, floor over present.
  // (combineScore requires all 5 keys; this is the design's thin renormalizing
  // wrapper, mirroring its weighted-sum + floor math without changing its contract.)
  const w = RUBRIC.weights;
  let wsum = 0, vsum = 0;
  for (const c of present) { wsum += w[c]; vsum += components[c].score * w[c]; }
  let score = Math.round(vsum / wsum);
  const minPresent = Math.min(...present.map((c) => components[c].score));
  const floorTriggered = minPresent < RUBRIC.floor.threshold;
  if (floorTriggered) score = Math.min(score, RUBRIC.floor.cap);

  const confidence = round2(present.reduce((s, c) => s + (components[c].confidence || 0), 0) / present.length);
  return { status: "scored", quality_score: score, components, presentComponents: present, presentCount: present.length, floorTriggered, confidence };
}
