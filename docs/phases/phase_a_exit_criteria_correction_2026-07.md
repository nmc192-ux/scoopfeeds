# Phase A Exit-Criteria Correction — July 2026

**Document type:** Exit-criteria correction (addendum to the Phase A Exit Criteria assessment)
**Owner:** DrJ
**Date:** 2026-07-23
**Scope:** Corrects the exit-criteria *assessment* only. Does **not** reopen Phase A, and does
**not** supersede [`phase_a_retrospective.md`](phase_a_retrospective.md) (FINAL v1.0, signed off
2026-05-15) or its sign-off record. Phase A remains formally closed (2026-05-18).

---

## What this corrects

The May retrospective's **§2 Exit Criteria Status** marked criteria **6, 7, 8** (source /
social / search audits) **NOT MET** because it checked for these paths:

- `docs/ops/runbooks/source_audit_phase_a.md`
- `docs/ops/runbooks/social_audit_phase_a.md`
- `docs/ops/runbooks/search_audit_phase_a.md`

That `docs/ops/runbooks/` path **never existed** (the directory holds only a `.gitkeep`). The
assessment was a path check, not a content check.

## Correction — criterion 6 (source audit): satisfied

The source audit was in fact completed; it was filed under `docs/audits/`, not the runbooks
path the kickoff brief prescribed. All three required components are present:

- **(a) active/dead source inventory** — [`docs/audits/phase_a_source_audit_phase1.md`](../audits/phase_a_source_audit_phase1.md)
  §1 *Inventory Totals* (source counts; category / region / credibility distribution) and
  §4 *Dead / Duplicate Candidates*.
- **(b) category × region × type matrix gap analysis** — same file §2 *Matrix Categorization
  (119 RSS Rows)* and §3 *Coverage Analysis* (3.1 category, 3.2 region, 3.3 source-type
  coverage vs Plan v6), synthesized in
  [`docs/audits/phase_a_source_audit_phase2_gap_analysis.md`](../audits/phase_a_source_audit_phase2_gap_analysis.md)
  §1 *Coverage Gap Summary*.
- **(c) Phase B priority source list (~30–40 candidates)** — the gap-analysis file §2 *Phase B
  Track 1 Source Priority Ranking* (Tier 1/2/3, against a "40 net new" budget) and §5 *Specific
  Source Candidates* (region- and category-grouped candidate list).

Note: the third audits file,
[`docs/audits/phase_a_source_audit_phase2_calibration.md`](../audits/phase_a_source_audit_phase2_calibration.md),
is a **different artifact** — source *credibility-scoring methodology* calibration (the B.6
evidence-layer / Phase B Track 1 Source Scoring Service work). It does not contribute to this
criterion and is not counted toward it; (a)(b)(c) are satisfied by the two files above alone.

## Unchanged — still Not Met, carried forward

- **Criterion 7 (social audit)** — no social-audit artifact exists anywhere in the repo.
  **Not Met — carried forward.**
- **Criterion 8 (search audit)** — no search-audit artifact exists anywhere in the repo.
  **Not Met — carried forward.**

These match the May retrospective (bridged to Phase B Track 1). No change.

## Other exit-criteria evidence recorded (July 2026 re-verification)

- **CSP still disabled in production code.** `backend/server.js:153` is verbatim
  `app.use(helmet({ contentSecurityPolicy: false }));`. Criterion "CSP enabled in production"
  remains **Not Met — carried forward**.
- **`docs/dependencies.md` still has ~18 `TBD` markers** (cost, registrar, renewal-date, and
  several API-access fields). "dependencies.md complete with no TBD markers" remains
  **Not Met — carried forward**.
- **Metrics dashboard: 4 of 5 wired.** `backend/src/routes/metrics-ops.js` wires #1 uptime,
  #2 scheduler last-run age, #3 BullMQ failure rate, and #5 source-diversity index against real
  queries; **#4 Layer 1 returning-user rate is an explicit stub** (`value: null`, bridged to
  Phase B Track 1 analytics). This corroborates the May retrospective's final addendum, which
  already recorded criterion 5 as *partially met* (4 of 5). **Partial — carried forward.**

## What this document does not do

It does not reopen Phase A, does not alter the FINAL v1.0 retrospective or its sign-off record,
and does not change any criterion other than the source-audit path assessment above. Social and
search audits, CSP, dependencies TBDs, and the returning-user metric remain carried forward into
the Phase B / remediation track exactly as before.
