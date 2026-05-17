# Phase A Baseline Metrics Snapshot

**Document type:** Operational baseline snapshot (Sprint 6.3 deliverable)
**Version:** 1.0
**Owner:** DrJ (Founder)
**Companion documents:** [Phase A Retrospective v1.0](../phases/phase_a_retrospective.md), [Phase B Kickoff Brief v1.0](../phases/phase_b_kickoff_brief.md), [Source Credibility Methodology v1.1](../content/source_credibility_methodology.md), [Phase A Source Audit Phase 2 Calibration](phase_a_source_audit_phase2_calibration.md), [Phase A Retrospective Inputs](../phases/phase_a_retrospective_inputs.md)
**Audience:** Internal — founder + AI implementers; Phase B Track 1 execution context
**Snapshot date:** 2026-05-17 (UTC)
**Methodology version active in production at capture:** v1.1
**Sprint 6.3 status post-snapshot:** Substantively DONE (1 of 4 metrics captured; 3 deferred to Phase B Track 1 followup with diagnostic data captured; 1 bridged per session 28-extension DEC1)

---

## 0. About this document

This is the Sprint 6.3 baseline snapshot deliverable per the Phase A close-out classification (session 28-extension Path 2). Sprint 6.3's purpose was to capture the values of the four in-Phase-A baseline metrics that Sprint 3.4's `/scoop-ops/metrics-ops` endpoint produces, against live production data, as the operational baseline that Phase B Track 1 work measures progress against.

The snapshot honestly captures what was available at production capture time:

- **One metric captured cleanly** (source diversity index — 43 cells across 154 sources).
- **Three metrics blocked by endpoint design bugs** discovered at production verification (uptime, scheduler last-run age, BullMQ failure rate). Dev verification with seeded test data didn't reveal that the underlying production data path differs from the test fixture. Diagnostic findings are documented in §4 so Phase B Track 1 has scoped followup work, not rediscovery.
- **One metric bridged by design** (Layer 1 returning user rate, per session 28-extension DEC1) — no analytics instrumentation in repo yet.

This snapshot does not soften. It captures honest baseline state including what is not yet measurable, with diagnostic data that lets Phase B Track 1 close the measurement gap deliberately.

---

## 1. Snapshot capture context

| Field | Value |
|---|---|
| Capture date | 2026-05-17 |
| Capture timestamp (UTC) | `2026-05-17T19:37:05.171Z` (from `computed_at` field in endpoint response) |
| Production HEAD at time of capture | Post-session-29 deploy with Sprint 28 + 29 commit chain applied (commits `3d935ef` methodology v1.1, `2c67764` Migration 002 sources table, `c823dee` Migration 003 raw_signals drop, `078159a` Sprint 3.4 metrics dashboard, plus others). Production code last touched at `6278ab6` for user-facing behavior; subsequent commits are documentation, dev-env, and admin-page work. |
| sourceCount (from `/api/health`) | 110 |
| Articles at capture | 25,378 |
| Videos at capture | 2,226 |
| Scheduler started | true |
| Backend uptime at capture | Post-deploy steady state (a few hours after restart) |
| Memory at capture | 54MB / 63MB (~86%) |
| Methodology version active in metrics-ops response | v1.1 |
| Migration 002 (sources table) | Applied; seeded with 154 sources (110 RSS + 44 YouTube) |
| Migration 003 (raw_signals drop) | Implicitly applied; backend started cleanly post-deploy |

---

## 2. Captured baselines

### 2.1 Source diversity index

| Field | Value |
|---|---|
| **Cells (distinct category × region combinations)** | **43** |
| Total sources | 154 |
| Distinct categories present | 20 |
| Distinct regions present | 19 |
| Theoretical max with current taxonomy (20 × 19) | 380 possible cells |
| Coverage against current taxonomy max | 43 / 380 = **~11%** |

**Interpretation.**

The corpus has meaningful diversity (43 distinct cells) but with significant clustering — only 11% of the theoretical maximum (using the 20 categories × 19 regions actually present in the sources table). Phase B Track 1 source onboarding will track this value over time; growth in **cells** reflects diversity expansion, not just source-count growth. Adding 10 sources all into one cell increases sources by 10 but cells by 0 — the metric explicitly rewards filling gap cells.

**Taxonomy note vs Strategic Plan v6.** Strategic Plan v6 §3 Capability 1 defines the strategic source matrix as 17 categories × 10 regions = 170 cells. The production corpus presents 20 distinct categories and 19 distinct regions — finer-grained than the strategic taxonomy. This is because `sources.js` uses operational category/region slugs (e.g., `top`, `international`, `politics`, `pakistan`, etc.) rather than the strategic Capability 1 taxonomy. The 11% coverage number is against the corpus's own observed taxonomy max (380), not the strategic 170-cell target. For Phase B Track 1 measurement, both framings are valid — corpus-self growth (cells / 380) and strategic-target progress (cells / 170, where >1 means the corpus covers the matrix multiple times via finer categories).

**Canonical framing for Phase B Track 1 progress measurement: the 170-cell Strategic Plan v6 target matrix is the canonical denominator.** The 380-cell corpus-observed denominator is descriptive context only; it changes as categories and regions populate over time, making longitudinal comparison less stable.

### 2.2 Methodology version (operational confirmation)

| Field | Value |
|---|---|
| Active methodology version in production endpoint | v1.1 |

**Interpretation.**

The `methodology_version: "v1.1"` field in the production `/scoop-ops/metrics-ops` JSON response confirms that the session 28.A methodology v1.1 ship (commit `3d935ef`) is operational. This is a soft confirmation rather than a numeric baseline — it tells Phase B Track 1 that the Reality Index integration described in methodology v1.1 §10 (Migration 002 columns populated against this methodology via the Phase B Track 1 scoring service) can read this version from the endpoint metadata when it eventually integrates.

---

## 3. Bridged metric (per session 28-extension DEC1)

### 3.1 Layer 1 returning user rate (7-day)

| Field | Value |
|---|---|
| Status | **Bridged** to Phase B Track 1 Distribution / Layer 1 analytics infrastructure |
| Why bridged | Anonymous-visitor return rate requires analytics instrumentation (GA / Plausible / equivalent) not currently in the repo |
| When baseline captured | When Phase B Track 1 ships analytics |
| Endpoint reports | `value: null`, `display: "—"`, `bridged_to: "Phase B Track 1 Distribution (Layer 1 analytics infrastructure)"`, plus note text explaining the bridge |

**Interpretation.**

This is the deliberate, designed bridge — not a discovered bug. Per session 28-extension DEC1, this metric was classified as "bridge to Phase B" rather than backfilled in Phase A. The MetricsOpsPage UI renders this as a distinct `BridgedStub` component (BRIDGED badge + dash + bridge-target footer) so dashboard readers cannot confuse the missing metric for "0%" or "n/a" — the absence is communicated as an architectural commitment, not a measurement failure.

---

## 4. Metrics-ops endpoint bugs (NEW — discovered during Sprint 6.3)

Three metrics returned `null` at production capture time despite active production scheduler and healthy backend. The endpoint design is sound; the diagnostic findings below indicate where the production data path diverges from what dev verification with seeded test data exercised.

### 4.1 Production uptime (job success ratio, 24h)

| Field | Value at capture |
|---|---|
| `value` | `null` |
| `display` | `"n/a"` |
| `numerator` (completed) | 0 |
| `denominator` (total including in-flight) | 0 |
| `status_breakdown.total` | 0 |

**Likely root cause.**

`background_job_runs` table appears empty for the last 24h window. Production scheduler is active (per `/api/health.scheduler.started: true` and 14 of 28 `last*Run` timestamps populated at the same query time), so this is not a "scheduler isn't running" condition. The population semantics of `background_job_runs` are unclear at this snapshot — possibly the table tracks only specific BullMQ work and not all scheduler ticks, or the rows aren't written under the production code paths exercised by the active scheduler types.

Dev verification (Phase 29.B.2 inline Node test) used a seeded `background_job_runs` table with hand-crafted rows representing realistic activity (1,450 completed, 32 failed, 8 running, 10 queued = 1,500 total). The query mechanics worked correctly against that fixture and produced the expected `0.9667` uptime / `0.0213` failure rate. The fixture did not match what production produces.

### 4.2 Scheduler last-run age

| Field | Value at capture |
|---|---|
| `value_seconds` | `null` |
| `display` | `"—"` |
| `most_recent_ts` | `null` |
| `observed_job_types` | 0 |

**Likely root cause — type mismatch.**

The metrics-ops route filters scheduler `last*Run` fields with `typeof v === "number" && v > 0`. At the same query time as the snapshot, `/api/health.scheduler` returned 14 of 28 `last*Run` fields populated — but those values were ISO timestamp strings (e.g., `"2026-05-17T19:36:50.123Z"`), not numeric epoch milliseconds. The numeric-only filter excludes them all, leaving `observed_job_types: 0` and the metric `null`.

Dev verification used `getSchedulerStatus()` against a synthetic in-memory scheduler that had no `last*Run` fields populated (the test scheduler wasn't actually running jobs), so the filter received an empty list either way — the test couldn't distinguish "values are strings, filter rejects" from "no values present." Production divergence in field type was not exercised.

### 4.3 BullMQ failure rate (24h)

| Field | Value at capture |
|---|---|
| `value` | `null` |
| `display` | `"n/a"` |
| `numerator` (failed) | 0 |
| `denominator` (total) | 0 |

**Likely root cause.**

Same as §4.1 — `background_job_runs` table empty for the last 24h window. Both uptime and BullMQ failure rate share that data source, so they fail or succeed together.

### 4.4 Required followup work (Phase B Track 1 scope)

These are real Phase B Track 1 metrics-ops endpoint refinements, not Sprint 6.3 baseline gaps. Captured here with diagnostic data so Phase B execution doesn't rediscover the issue.

- **Investigate scheduler `last*Run` value types.** Determine the actual production type (Date object, ISO string, epoch number, or mix). Update the metrics-ops filter to accept all valid forms — likely:

  ```js
  const lastRunTimestamps = Object.entries(sched)
    .filter(([k]) => k.startsWith("last") && k.endsWith("Run"))
    .map(([, v]) => {
      if (typeof v === "number" && v > 0) return v;
      if (typeof v === "string" && v) { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
      if (v instanceof Date) return v.getTime();
      return null;
    })
    .filter((v) => v && v > 0);
  ```

- **Investigate `background_job_runs` population semantics.** Determine whether the table captures all scheduler ticks or only specific BullMQ workers. Inspect `models/database.js` `insertBackgroundJobRun()` callers and trace which scheduler types actually write rows.
- **If `background_job_runs` doesn't capture all scheduler activity, decide between three remediation options:**
  - **(a)** Switch uptime / failure rate denominator source from `background_job_runs` to scheduler `last*Run` + windowed analysis (count successful ticks within the last 24h per job type, derive ratio from completion vs absence).
  - **(b)** Redefine the metrics to measure BullMQ-specific work only, and add a new metric for general scheduler uptime sourced from `last*Run` windowing.
  - **(c)** Add new instrumentation to write a row to `background_job_runs` (or a new table) on every scheduler tick across all 28 types.
- **Redeploy the fixed metrics-ops endpoint.**
- **Re-capture baseline values** at that point. The Phase B Retrospective should reference this snapshot document and its v1.1 successor with the values that were unavailable at Phase A close.

**Estimated scope.** Phase B Track 1 work item: ~1–2 sessions for the filter type fix + the population-semantics investigation + decision on (a)/(b)/(c) above. The fix is small; the design call between (a)/(b)/(c) needs the population-semantics evidence to make.

---

## 5. What these baselines tell us

At Phase A close-out:

- **Source diversity captured honestly.** 43 cells, 154 sources, 20 categories × 19 regions present. The metric will be the cleanest tracking input for Phase B Track 1 source onboarding work.
- **Three of four measurable metrics blocked by endpoint design bugs discovered at production verification.** Sprint 3.4 dev verification was clean against seeded test fixtures, but the fixtures didn't match production data shapes. This is captured as finding #89 (see Phase A Retrospective Inputs).
- **Returning user rate intentionally bridged** per session 28-extension DEC1. Not a discovered limitation — a designed deferral with explicit Phase B Track 1 owner.
- **Phase B Track 1 has clear, scoped followup work** with diagnostic data already captured. The metrics-ops refinement is a small, well-bounded work item rather than an open-ended investigation.

The metrics-ops endpoint is operationally sound (it deploys, serves 401 unauthed, serves JSON authed, returns one real metric correctly, never crashed). Its limitations are query-design issues in three of the four metric computations — fixable in code, not a re-architecture.

---

## 6. Phase B Track 1 progress measurement

How these baselines will be used during Phase B execution:

- **Source diversity index** — tracked over time as source onboarding proceeds (Phase B Track 1 §3.1–§3.6 in the Phase B Kickoff Brief). Growth in cells reflects diversity expansion, not just source-count growth. Reporting cadence: monthly during Phase B execution (could land in Phase B mid-retrospective).
- **Uptime, scheduler last-run age, BullMQ failure rate** — captured once Phase B Track 1 metrics-ops endpoint refinements ship (per §4.4). The Phase B Retrospective should reference this snapshot as v1.0 baseline and its v1.1 successor with the values that were unavailable here.
- **Layer 1 returning user rate (7-day)** — captured when Phase B Track 1 analytics infrastructure ships (per session 28-extension DEC1 + Phase B Kickoff Brief §10.7 Phase A close-out audit deferrals).

For Phase B Track 2 (architecture) and Track 3 (infrastructure performance), these baselines are not direct measurement targets — they're operational health signals that Track 2/3 work should not regress.

---

## 7. Honest limitations

- **Three of four metrics are unavailable at snapshot capture** due to endpoint bugs discovered at production verification, not at design time. Dev verification used seeded test data that produced expected query behavior; production data path diverged. Captured as finding #89 in Phase A Retrospective Inputs.
- **Single point-in-time snapshot.** Not a longitudinal baseline. Sprint 6.3 scope did not include multi-day capture; that would have required scheduled measurement infrastructure not yet built.
- **24-hour windows may not reflect steady-state operational reality** even once the underlying measurements work. Diurnal patterns in scheduler tick load, weekend-vs-weekday corpus refresh, and seasonal source activity could all produce systematic variation in uptime / failure-rate baselines at different capture times.
- **Methodology v1.1 calibration was on 15 sources** (per `phase_a_source_audit_phase2_calibration.md`). Full corpus scoring happens via the Phase B Track 1 automated scoring service per finding #85 architectural reframing. The source diversity index captured here is independent of methodology version (it's a corpus-shape metric, not a methodology-scored metric).
- **No baseline captured for the bridged metric (returning user rate).** That capture is Phase B Track 1 Distribution work, not Phase A scope.
- **Production verification at snapshot time happened ~3–4 hours after deploy.** Steady-state operational reality may produce different `background_job_runs` populations than the immediately-post-deploy state observed. Phase B Track 1 metrics-ops refinement work should re-investigate after more operational time has elapsed.

---

## 8. Related documents

- **[Phase A Retrospective v1.0](../phases/phase_a_retrospective.md)** — Phase A close-out synthesis. This snapshot is a Sprint 6.3 deliverable within Phase A close-out per the session 28-extension classification.
- **[Phase A Retrospective Inputs](../phases/phase_a_retrospective_inputs.md)** — findings ledger. Finding #89 (this session, dev-verification-with-seeded-data masks production data-path divergence) captures the institutional sub-pattern; Pace Tracker session 30 entry captures the operational close-out work.
- **[Phase B Kickoff Brief v1.0](../phases/phase_b_kickoff_brief.md)** — §10.7 Phase A close-out audit deferrals (which this document closes for the metrics piece), §3.6 corpus growth to ≥150 sources (which uses source diversity index as a tracking signal).
- **[Source Credibility Methodology v1.1](../content/source_credibility_methodology.md)** — operational methodology referenced in the metrics-ops endpoint metadata.
- **[Phase A Source Audit Phase 2 Calibration](phase_a_source_audit_phase2_calibration.md)** — v1.0 calibration of 15 publisher sources; companion to this baseline snapshot for Phase B Track 1 scoring-service ground-truth.
- **Sprint 3.4 implementation:** `backend/src/routes/metrics-ops.js`, `frontend/src/pages/MetricsOpsPage.jsx`, mount at `backend/server.js:283`. Commits `078159a` (Sprint 3.4 ship), `db43b7f` (dev-environment infrastructure).
- **Finding #89:** documented in Phase A Retrospective Inputs alongside this snapshot.

---

## Changelog

**v1.0 — 2026-05-17.** Initial snapshot at Phase A close-out. Source diversity captured (43 cells across 154 sources / 20 categories / 19 regions); methodology v1.1 operational confirmation; three metrics deferred to Phase B Track 1 followup with diagnostic data (finding #89); returning user rate bridged per session 28-extension DEC1.
