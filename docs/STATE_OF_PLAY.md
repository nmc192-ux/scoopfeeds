# State of play — 2026-07-23

Orientation for a fresh context (or future-you). Last docs sync: **`a42e681`** (2026-07-23).
This field names the last docs reconciliation, not necessarily current HEAD — to check that all
three checkouts agree, run `git fetch && git status -sb` on the Mac and on `/opt/scoopfeeds`.

- What the system actually does: [`docs/architecture/dossier_and_event_graph.md`](architecture/dossier_and_event_graph.md)
- Every flag, default, and prod value: [`docs/reference/env_reference.md`](reference/env_reference.md)
- How work is run (gates, COW discipline): [`docs/agentic-workflow.md`](agentic-workflow.md)
- Decision drift since May: [`docs/strategy/decisions_log_amendments_2026-07.md`](strategy/decisions_log_amendments_2026-07.md)
- **Where the strategic plan stands now:** [`docs/strategy/strategic_plan_v6_delta_2026-08.md`](strategy/strategic_plan_v6_delta_2026-08.md) — read before v6
- Code-vs-docs reconciliation (2026-08): [`docs/audits/code_vs_docs_reconciliation_2026-08.md`](audits/code_vs_docs_reconciliation_2026-08.md)
- Phase A exit-criteria correction (Jul 2026): [`docs/phases/phase_a_exit_criteria_correction_2026-07.md`](phases/phase_a_exit_criteria_correction_2026-07.md)
- **Why the video/social calls went the way they did (Aug 2026):** [`docs/phases/video_premium_track_2026-08.md`](phases/video_premium_track_2026-08.md) — rationale, measurements, and what is still unfinished

## Where things stand

**Shipped and default (reader-visible):** Tracker Auto-Detection Engine (all 8 detectors,
cron + API + `/trackers` page — previously mis-filed as deferred) · 10-locale UI with RTL for
ur/ar (previously described as Phase E) · A2 restructured dossier · A6 occurrence timeline
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
- **I2. Finish the monitoring wiring** `[queued]` — **the code is done; the wiring is not.**
Re-grounded 2026-08 after `feat/deadman-switches` merged (`cc59772`). Built and live:
`services/heartbeatPing.js` with start/success/fail on all three scheduled cycles —
ingestion (`scheduler.js:1015,1055,1060`), social (`socialPublisher.js:757,783,785,802`),
video (`videoAutopost.js:376,675,676`) — plus `uniformFailure` to catch the case a dead-man
switch structurally misses (cycle green, every unit of work inside it failing). Documented in
`env_reference.md:233-235`. Nothing further to build here.

  What remains is **not code**: (a) the three checks do not exist in any monitoring account,
so all three URLs are unset and every ping is a no-op — `env_reference` marks social
*unverified* and video/ingestion *set at ship*, which needs confirming against the real prod
`.env`; (b) **nothing watches the web process** — the switches cover scheduled cycles, not
"is the site reachable", which is exactly what the 45-minute Caddy outage was.
`/api/healthz` exists (`server.js:329`) and now reports `degraded`, so there is something
worth polling; (c) `docs/ops/runbooks/` is still empty — no runbook says what to do when one
fires. Deliverable: three Healthchecks-style checks created and their URLs confirmed in prod,
one external uptime check on `/api/healthz`, alerts landing in Slack, and
`docs/ops/runbooks/monitoring.md`. **Do not rebuild `heartbeatPing.js`.**
- **I3. Run the test suite in CI** `[queued]` — `execution_method_v1.md` §6 Level 1 states
"If CI is red, work doesn't merge", but CI runs only install, frontend build, and
`node --check`. The 464-test suite runs on whichever laptop remembers. This is how 64
failures sat on `main` for weeks. Deliverable: `node --test "src/**/*.test.js"` in
`.github/workflows/node.js.yml`, green, with the docs' claim made true.

- **I4. Close the gate (a) LLM budget bypass** `[queued]` — three services call Gemini
directly without `consumeLlmBudget`: `videoSpecWriter.js:85`, `scriptWriter.js:64`,
`igSummaryService.js:37`. Investigated 2026-08 (`code_vs_docs_reconciliation_2026-08.md`):
**oversight, not design** — the 2026-07-15 rail commit swept two call sites and there were
three; the two later services copied the module's model-pin helpers but not the budget call.
`videoSpecWriter` is the biggest single-call spender (8192 output tokens vs 512-1536 metered)
and is not memoized, so a rejected candidate is re-paid hourly. Deliverable: budget call at
each of the three sites tagged distinctly, spec-rejection memoized per article, and
`getLlmBudgetStatus()` (currently **zero callers**) surfaced on `/scoop-ops` — an uncounted
rail with no readout is how this recurs.

- **I5. SIGABRT in the test suite — identify the addon** `[queued]` — 6-9 files fail as a
whole with no stack and `signal: SIGABRT`; subtests pass; the total test count varies between
runs. Cause is `Assertion failed: (env) != nullptr` — a native addon called during environment
teardown. Ruled out: concurrency, ulimit, `.env`, the Sentry profiler. Two attempted fixes did
not resolve it (one *introduced* an instance of the same abort by calling `db.close()` from an
exit hook). Reproduces on the Mac Mini build worker, not on the MacBook — it is timing
dependent. **This blocks I3**: putting the suite in CI before this is fixed makes every PR go
red intermittently. Next step is cheap: the native frames beneath `node::Assert` name the
addon. Full context in `CLAUDE.md` under "Known-flaky".

## 2026-08-24 — the shorts got pictures, and two more channels

**The finding that reframes the rest of this entry:** `VIDEO_SUBJECT_VISUALS_ENABLED`
was **off in production the whole time**. With it off the spec writer strips `photo`
and `map` from the card types the model is offered, so no underlay was ever
requested, no photo was ever fetched, and footage — which only runs inside the
photo branch — could never fire. Every visual improvement below shipped, deployed,
and did nothing, on a channel publishing 12 videos a day. It was found by DrJ
watching a published video and saying "it still does not show any visuals".

It was not undocumented: `env_reference.md` carried it, and
`phases/video_premium_track_2026-08.md` said in bold that it had never been
switched on in a live cycle. Four PRs were built on top of it without reading
that line. **Verify the gate above the feature is open before building on it.**

Shipped and merged (#60–#66), all live in prod at `83ae3f7`:

- **Source credit on the picture** (#60) — `sourceBadge` existed but rendered only
  on the TITLE card, the one whose imagery is ours. Photo and map cards, which
  carry someone else's picture, carried nothing. Now credited from the first
  frame, on a chip that carries its own contrast.
- **Open-licence footage** (#61, #62, #64) — NASA + US-service-branch DVIDS only.
  Verified provenance ONLY, because nothing reads a licence at :12 past the hour.
  Two gates: relevance, then a **pixel** gate (figures ran 32%/48% near-white,
  real satellite imagery 0.8%/2.0%) after the first live result for "Hurricane
  Michael" turned out to be a data grid. Archive material is dated on screen.
  Wikimedia Commons is excluded because the only endpoint with machine-readable
  licence data ECONNRESETs from our networks — a rights check against an
  unreachable endpoint is not a check.
- **One photo shown once** (#61) — `MAX_CONSECUTIVE_SAME_TYPE` is 2, and every
  photo card was drawing the SAME `article.image_url` on the SAME mount. The
  repetition complaint from the long-form film, living in the automated loop.
- **C2PA broke every DVIDS photo, silently** (#62) — DoD imagery embeds a second
  image in its content-credentials block, ffmpeg saw a two-frame input and died
  writing the mount intermediate. Fixed by normalising the source to one frame,
  which also covers animated-GIF article images (always possible, never handled).
- **The rights decision became testable** (#63) — `choosePhotoUnderlay` decides
  whose name goes on a picture and had never executed outside production.
- **TikTok** (#65) and **X** (#66) as the sixth and seventh surfaces. See
  `video-pipeline.md` §7 for the fan-out rules and why each needed its own column.

Enabled in prod the same day: `VIDEO_SUBJECT_VISUALS_ENABLED`, `VIDEO_MUSIC_BED_ENABLED`,
`VIDEO_IMAGE_MOTION_ENABLED`, `VIDEO_FOOTAGE_ENABLED`, `VIDEO_TIKTOK_ENABLED`
(`PUBLIC_TO_EVERYONE`, DrJ's call), `VIDEO_X_ENABLED`.

**Unverified at end of day:** no render has happened since any of it was switched
on — the 12/12 daily cap was spent on old-code output. TikTok and X have both
executed **zero** posts; their upload paths are written from documentation and
have never run. `VIDEO_IMAGE_ZOOM` (6%) is still un-eyeballed.

**Found in passing, unaddressed, and bigger than anything above:** `news.db` is
**18.6 GB**. A backup takes ~25 minutes, needs 18.6 GB of free space, and failed
once today at 7.9 GB. That constrains every recovery option, including the COW
restore point this project's own workflow requires before event-table migrations.

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
- **Long-form production is now a skill (2026-08-19).** `.claude/skills/video-factory/` —
a 13-script engine plus house style, quality gates, sourcing and platform references.
Renders locally (ffmpeg + satori); no paid video generation. Per topic it produces a
7–10 min film, five vertical Shorts, a thumbnail and an SRT, then schedules YouTube,
Facebook and Instagram. Only two files are authored per video (`script.md`,
`storyboard.mjs`); everything else is reusable. Three films made under it:
  - *Who's Actually Paying for AI?* — live, **2 views**. The topic had zero search demand,
    which is why demand validation is now the first gate, before scripting.
  - *Why There Are No Entry-Level Jobs Anymore* — scheduled 19–23 Aug.
  - *What Happens If The Strait Of Hormuz Closes* — scheduled 26–30 Aug.

  Quality is measured, not asserted: 7 gates (loudness, clipping, stereo width, median
  shot ≤6s, ≥8% shots under 2s, Shorts count and dimensions). Anything unmeasurable
  reports **UNVERIFIED**, never "pass". Details in the skill's `references/`.
- **Rebrand (Decision 9 amended)** — "editorial disruption" direction locked; asset
production in progress; name and handles unchanged.

## Resolved 2026-08 (see the v6 delta)

- **Telegram — dropped.** No backend code ever existed; the July amendment recorded it as
unstable in Pakistan. The three Phase B exit criteria and the ≥5,000/≥25,000 subscriber
targets that named it are void. Web push + email digest carry the free-tier role.
- **Source-matrix criterion — rewritten** to "≥150 active sources with a populated
`quality_score`". The 17×10×10 taxonomy had zero of three axes in the schema; it moves to
Deferred below rather than remaining an assumed-done axis.

## Deferred capabilities — deliberate, not forgotten (Decision 34)

Parked behind graph cleanup; each re-opens with a fresh kickoff brief once Wave 3 and
machine-event quarantine ship:

- **Source matrix expansion** (~110 active vs ≥150 Phase B target) + onboarding workflow
- **Breaking news engine** and alert engine v1 (channel mix under review — Decision 13 flag)
- **Newsletter products**
- **Scoop search** (internal upgrade, Brave preview)
- **Multi-source predictions** (blocked until the *existing* single-source module is
trustworthy — open item 1)
- **Source-matrix taxonomy** (17 categories × 10 regions × 10 types) — no axis exists in the
schema today. Region is the highest-value slice if this re-opens.
- **Source discovery / enrichment / editorial-review services** (Phase B brief §3.1, §3.2,
§3.4) — the Decision-16 weekly onboarding loop. No code.
- **Op-ed aggregation MVP** — exit criterion "op-eds on ≥80% of major events". No
ideological-tagging or op-ed-ingest code.
- **Track 2 architectural criteria** (§8.2: skill-contract docs, lint-enforced skill
boundaries, image/video isolation POC). `backend/src/skills/` contains only `scoring/`.
- **Track 3 performance sprints 0–3** (Cache-Control immutable, CDN edge, s-maxage/SWR).

*The five above were surfaced by the 2026-08 reconciliation: required by the plan, absent
from code, and absent from this list. Deferring is a decision; forgetting is not.*

## Known-good but worth watching

- **Narrow-title corollary** — third live sighting ("G.O.P. Boxed In…" titling a 300-article
event). Facet structure can detect it; treatment deferred to A5 v2 (matcher-adjacent).
- **One config hazard** in prod `.env`: a duplicated `STORYLINE_ENABLED` (lines 53/59).
Documented in the env reference; unchanged. Needs eyes on the prod file — the code side is
clean (exactly one reader). The `EVENT_ENTITY_MAX_CATSPAN` hazard was **resolved 2026-07-20**
by splitting the signature path onto its own `EVENT_SIGNATURE_MAX_CATSPAN`.
- **`GEMINI_GENERATION_MODEL` has two different code defaults** across six call sites —
`gemini-2.5-flash` in `llmQueue.js:183`/`analysisService.js:47`/`liveEvents.js:42`,
`gemini-3.1-flash-lite` in `videoSpecWriter.js:82`/`igSummaryService.js:35`/`scriptWriter.js:62`.
Prod's single line masks it; without it the platform runs two generation models at once.
Same bug class as the catspan hazard.
