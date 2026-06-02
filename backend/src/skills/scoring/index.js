/**
 * skills/scoring — Source Scoring Service (Track 2; Capability 1 data spine).
 *
 * The FIRST skill folder in the codebase. Skill entry point: re-exports the
 * skill's public surface so consumers import from one place
 * (`skills/scoring/index.js`) rather than reaching into internal files.
 *
 * Minimal contract per Q2: folder isolation only — no event-bus / cross-skill
 * machinery until skill #2 exists to justify the abstraction. See README.md
 * for the precedent decisions this folder sets.
 *
 * B.6.0/B.6.1 surface: the committed rubric + the combination function + the
 * sources-table DAO. Evidence-gathering (B.6.2+), runtime/cadence (B.6.4), and
 * full-corpus scoring (B.6.5) are later sprints and not exported yet.
 */

export { RUBRIC, COMPONENT_KEYS } from "./rubric.js";
export { combineScore, ScoringInputError } from "./combination.js";
export { getSourceForScoring, writeSourceScore } from "./scoringDao.js";
