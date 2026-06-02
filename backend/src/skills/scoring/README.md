# skills/scoring — Source Scoring Service

The **first skill folder** in the codebase. It applies the Source Credibility
Methodology programmatically to produce a quality score per source. Built
greenfield (Track 2 Sprint B.6.0/B.6.1) — value-first, low-churn — ahead of the
full B.1 codebase reorg, which is deferred.

Because it's first, this folder **sets the precedent** for every future skill.
The precedent decisions are recorded below so skill #2 inherits them
deliberately, not by accident.

## Precedent decisions

1. **Location: `backend/src/skills/<skill>/` (under the existing `src/`).** Not
   the top-level `backend/skills/` from Skills Architecture v1's illustrative
   tree. Rationale: keep it inside the current `src/` so existing tooling,
   imports, and the migration runner work unchanged with zero churn to active
   Track 1. Promotion to a top-level `skills/` happens with the B.1 reorg, when
   the whole tree moves together.

2. **Minimal contract (Q2): folder isolation only.** Skills Architecture v1 §5
   prescribes event-bus communication, dependency declaration, and per-skill
   admin surfaces. With only one skill, that machinery has nothing to talk to,
   so it is **not** built yet. What this skill honors now: its own folder, its
   own files, a single public entry point (`index.js`), self-contained logic +
   tests. The full §5 contract is retrofitted when skill #2 arrives to justify
   the abstraction.

3. **Tests via `node --test` (built-in, zero deps).** The backend had no test
   infrastructure. Rather than add a runner dependency, this skill uses Node's
   built-in test runner. Test files are `*.test.js` colocated in the skill
   folder. This sets the precedent for skill tests. Run:

   ```
   node --test backend/src/skills/scoring/
   ```

4. **Rubric weights are PUBLIC and committed (Position C).** The five component
   weights + floor rule live in `rubric.js`, the single source of truth. They
   are already published in `docs/audits/phase_a_source_audit_phase2_calibration.md`
   §1.2; the moat is the evidence-gathering, not these numbers.
   `coherence.test.js` binds `rubric.js` to that doc so they cannot drift.

5. **The one sanctioned reach out of the folder.** `scoringDao.js` imports the
   shared DB handle (`models/database.js`) and reads/writes the shared `sources`
   table + `scoring_audit_log`. Full physical data isolation (§5 "skills handle
   their own data") is later-phase; for now the skill is folder-isolated but
   uses the canonical DB handle and shared schema.

## Files

| File | Role |
|---|---|
| `index.js` | Skill entry point; re-exports the public surface. |
| `rubric.js` | Committed config: 5 weights (25/25/20/15/15), floor rule (<30 → cap 50), methodology version. SSOT. |
| `combination.js` | The pure score-combination function: weighted sum → floor cap. Posture does not enter it. |
| `scoringDao.js` | `sources`-table read/write (the five Migration 002 quality columns). |
| `fixtures/calibration_v1.js` | The 15-source v1.0 calibration ground-truth (test fixtures). |
| `combination.test.js` | Validation harness: 15 sources within ±5; floor-rule unit tests. |
| `coherence.test.js` | doc↔code coherence: rubric matches calibration §1.2. |

Schema: `scoring_audit_log` is added by `backend/src/db/migrations/006_scoring_audit_log.js`.

## Scope boundary (this sprint = B.6.0 + B.6.1)

**In:** skill scaffold + data layer (rubric, combination, DAO, audit-log
migration) and the combination validated against ground-truth.

**Not yet (later sprints):** evidence-gathering / sub-criterion operationalization
(B.6.2 deterministic, B.6.3 LLM), runtime/cadence (B.6.4), full-corpus scoring
+ ±5 gate on real evidence (B.6.5). The combination is proven against the
calibration's *given* component vectors before any expensive evidence-gathering
is built.
