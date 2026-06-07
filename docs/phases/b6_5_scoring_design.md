# B.6.5 — Source Scoring Design (evidence → component → quality_score)

## Principle
Honesty-of-derivation extends to scoring: never impute a score from absence. Score only observed evidence; decline honestly when too little is observed; carry coverage + confidence so every score is transparent.

## Reuse (do not rebuild)
- `combineScore({ET,MT,DE,Ind,HA})` → weighted sum (ET25/Ind25/HA20/MT15/DE15) → floor (any component <30 caps overall at 50). [combination.js]
- `writeSourceScore` → `sources` quality columns [scoringDao.js, migration 002].
- `scoring_audit_log` (migration 006), incl. `override_present`/`override_rationale`.
- §2 taxonomy: 2.1→ET, 2.2→MT, 2.3→DE, 2.4→Ind, 2.5→HA [rubric.js].
- 15-source calibration ground truth [docs/audits/phase_a_source_audit_phase2_calibration.md].

## Missing seam: evidence → component scorer
Per source: `listEvidenceForSource` → (this scorer) → 5 component scores [0,100] → `combineScore` → `writeSourceScore` + audit insert. Slots after `gatherForAllSources` in runtime/scoringRun.js.

## Component scoring — partial-evidence + insufficient-data (the crux)
- Per component, roll up ONLY evidenced sub-criteria, renormalized over them. Absent states (pending/pending-llm/unavailable/blocked) contribute nothing and are NEVER treated as level[0].
- Record a per-component coverage fraction (evidenced / applicable).
- Emit a component only if coverage ≥ MIN_COVERAGE; else component = `insufficient` (not 0).
- Emit overall `quality_score` only if ≥ N_COMPONENTS clear; else source = `insufficient-data` (no number).
- The `<30→cap 50` floor applies to evidenced-low components, never to `insufficient` ones.
- Cutoffs (MIN_COVERAGE, N_COMPONENTS) set against real per-component coverage + the evidenced-count histogram during calibration.
- Expected v1 outcome: scores ~28 (or fewer); declines the rest. Correct by design. Coverage growth = ingestion (#114) + feeder reliability (#116), not the scorer.

## bucket→numeric mapping
- 4-level ordinal → 0 / 33 / 67 / 100
- presence yes/no → 0 / 100
- frequency/ratio (2.1.c bylines, 2.2.b primary-link) → graduated
- 2.4.a categorical → Independence: public-broadcaster/nonprofit (no corporate owner) → high (~90); transparent named owner/parent → mid (~70); conglomerate or undisclosed owner → low (~40). [TUNE in calibration]
All anchors tuned jointly against the 15-source per-component values.

## Within-component weighting
Equal across sub-criteria, except the methodology's stated emphasis (2.1.c/2.1.d heavier in ET). Calibrate.

## Confidence & flagged handling (#110, #111)
- Down-weight by confidence; do NOT exclude flagged evidence (flag rate too high — would gut coverage).
- Temper confidence for thin samples (sampleCommitted=1) so a one-article judgment doesn't weigh 1.0 (#110).
- Propagate component- and source-level confidence into the audit log.

## Validation
- The 15-source set is hand-rated holistic v1.0; automated v1.1 is sparse → NO universal ±5 gate.
- Use the set's per-component values to CALIBRATE the mapping + weights.
- Apply ±5 as a target only on the subset the scorer covers well; under-evidenced sources DECLINE (insufficient-data), not graded.
- A tight universal gate (re-rated automated-evidence ground truth) is deferred.

## Deferred / parked
- Override-WRITE deferred (storage exists in audit log); scorer HONORS an existing `override_present` row (read-only).
- Language PARKED: `articles.language` is 100% "en" (ingester default, not detection); feeding it = fabricated signal (#105-class). languageFactor neutral/unfed.
- DE category-mix aggregate: deferred (v1 scores DE flat).
- Posture (2.4.d): deferred (no source; v1 writes default/null posture).

## Audit record (per source, per run)
`scoring_audit_log`: component_scores, combined_score, per-component coverage + confidence, reasoning_per_subcriterion, confidence_per_subcriterion, posture (default), override fields (honored if present), methodology_version.

## Build phasing
1. Scorer-core + calibration: evidence→component (partial-evidence/insufficient-data logic, bucket→numeric, within-component roll-up, confidence/flag handling); calibrate against the 15-source set; report per-source and per-component deltas.
2. Orchestration + audit-write: wire into scoringRun.js after gatherForAllSources; combineScore → writeSourceScore + scoring_audit_log insert; honor existing overrides.
