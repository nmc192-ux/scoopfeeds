# State of play — 2026-07-23

Orientation for a fresh context (or future-you). Last docs sync: **`a42e681`** (2026-07-23).
This field names the last docs reconciliation, not necessarily current HEAD — to check that all
three checkouts agree, run `git fetch && git status -sb` on the Mac and on `/opt/scoopfeeds`.

- What the system actually does: [`docs/architecture/dossier_and_event_graph.md`](architecture/dossier_and_event_graph.md)
- Every flag, default, and prod value: [`docs/reference/env_reference.md`](reference/env_reference.md)
- How work is run (gates, COW discipline): [`docs/agentic-workflow.md`](agentic-workflow.md)
- Decision drift since May: [`docs/strategy/decisions_log_amendments_2026-07.md`](strategy/decisions_log_amendments_2026-07.md)
- Phase A exit-criteria correction (Jul 2026): [`docs/phases/phase_a_exit_criteria_correction_2026-07.md`](phases/phase_a_exit_criteria_correction_2026-07.md)

## Where things stand

**Shipped and default (reader-visible):** A2 restructured dossier · A6 occurrence timeline
(one row per occurrence, recency-pinned, rows link to the article) · storylines/ANGLES ·
Wave-2 unified affinity (treadmill dead) · gate-(a) LLM cost rails · timeline-writer
starvation fix.

**Shipped dark / disabled (deliberate):** A5 facet shelf behind `?facets=1` — built,
deployed, awaiting eyeball + flip · W2.1 merge floor shipped **disabled** pending
recalibration · sentiment module hidden on comprehensibility grounds.

**Working discipline that keeps paying off:** GROUND before building (read-only on a COW,
verbatim artifacts, 🛑 at the report) → build → COW-validate → dark behind a URL param →
live eyeball → default flip. DrJ deploys; agents never touch prod deploys.

## Operational insurance — ahead of the open items

<!-- /plan drains this section BEFORE the numbered open items below.
     Added 2026-08 after docs_gap_analysis_2026-08.md. Same [queued] markers. -->

These are small, and they are the difference between an incident and a catastrophe.
None of them are features; all of them are things whose absence only shows up on the
worst day.

- **I1. Backup + restore for prod `news.db`** `[queued]` — `npm run db:backup` exists as a
command; nothing documents a schedule, an off-site copy, or a restore path. The event graph
is one SQLite file on one VPS. Deliverable: `docs/ops/runbooks/backup_restore.md`, a scheduled
backup with an off-site target, and **one restore drill actually performed and recorded**.
Un-drilled backups are folklore.
- **I2. Uptime alerting on `/api/healthz`** `[queued]` — nothing pages anyone when prod dies.
The record: a 45-minute Caddy port outage, a worker on month-old code for a week, a dead
YouTube token logged as healthy for weeks. `/api/healthz` now reports `degraded` state
(PR #2), so there is something worth watching. Deliverable: an external check hitting it on
an interval, alerting to Slack, plus the runbook entry for what to do when it fires.
- **I3. Run the test suite in CI** `[queued]` — `execution_method_v1.md` §6 Level 1 states
"If CI is red, work doesn't merge", but CI runs only install, frontend build, and
`node --check`. The 464-test suite runs on whichever laptop remembers. This is how 64
failures sat on `main` for weeks. Deliverable: `node --test "src/**/*.test.js"` in
`.github/workflows/node.js.yml`, green, with the docs' claim made true.

## Open items — roughly in priority order

<!-- J Loop status markers: [queued] available · [proposed] awaiting DrJ approval ·
     [building] in progress · [shipped] merged. /plan reads these; /review updates them.
     Priority order is DrJ's — the loop takes the lowest-numbered [queued] item. -->

1. **Markets GROUND** `[queued]` *(next up)* — a resolved England–France market rendered on the
Argentina event. With sentiment hidden, **prediction markets are the only Intelligence
module left, and it is currently wrong**. Read-only GROUND on binding + staleness, 🛑 at
the report.
2. **Merge-survivor `last_activity_at`** `[queued]` — one-liner. The promoter's merge path links the
absorbed event's articles onto the survivor but never bumps the survivor's
`last_activity_at` (`markMerged` updates the *absorbed* row). Fix:
`touchActivity.run(now, now, survivor)` after the link loop.
3. **Machine-event quarantine at ingest** `[queued]` — USGS/NOAA article-less events have caused
**two** production failures. Quarantine at ingest or distinct status; structural fix.
4. **W2.1 floor recalibration** `[queued]` — re-sweep from the SAME/porous distributions once a week
of 🧭 `promoter-merge` lines has accumulated. "No floor" is an acceptable outcome.
5. **Wave 3** `[queued]` — husk cleanup, blob dissolution, summary repair. Porous-absorb contamination
is **reader-visible** today, which raises its priority. Also improves A5 facet coverage.
6. **Gates (b) routing + (c) accounting** `[queued]` — outstanding from the LLM incident sequence.
7. **Sprint 3 hygiene** `[queued]` — junk faucet, prominence ranking miscalibration, single-source floor.
8. **A4 perf / SSR + SEO** `[queued]` — the site does not surface in search for its own headlines.
Unblocked once the graph settles.

## Active workstreams outside the strategic plan's phase sequence

Running in parallel with the remediation programme above (see Decisions Log amendments
for rationale and dates):

- **Video channel (Decision 19 amended, D32–33)** — Vox-style long-form as primary format;
V1 pipeline live end-to-end (first upload 2026-07-20); V5 production-quality phase specced
and required before scale. Shorts as an independent track. WhatsApp approval loop +
founder topic inbox.
- **Rebrand (Decision 9 amended)** — "editorial disruption" direction locked; asset
production in progress; name and handles unchanged.

## Deferred capabilities — deliberate, not forgotten (Decision 34)

Parked behind graph cleanup; each re-opens with a fresh kickoff brief once Wave 3 and
machine-event quarantine ship:

- **Source matrix expansion** (~110 active vs ≥150 Phase B target) + onboarding workflow
- **Tracker Auto-Detection Engine** and tracker surfaces
- **Breaking news engine** and alert engine v1 (channel mix under review — Decision 13 flag)
- **Newsletter products**
- **Scoop search** (internal upgrade, Brave preview)
- **Multi-source predictions** (blocked until the *existing* single-source module is
trustworthy — open item 1)

## Known-good but worth watching

- **Narrow-title corollary** — third live sighting ("G.O.P. Boxed In…" titling a 300-article
event). Facet structure can detect it; treatment deferred to A5 v2 (matcher-adjacent).
- **Two config hazards** in prod `.env`: a duplicated `STORYLINE_ENABLED`, and
`EVENT_ENTITY_MAX_CATSPAN` read with different defaults in two modules. Both documented in
the env reference; neither changed.
