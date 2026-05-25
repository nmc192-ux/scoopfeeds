# Phase B Retrospective Inputs

**Document type:** Internal institutional memory — Phase B progress journal
**Owner:** DrJ (Founder)
**Companion documents:** [Phase B Kickoff Brief v1.0](phase_b_kickoff_brief.md), [Strategic-Tactical Reconciliation v1.0](../strategy/strategic_tactical_reconciliation_v1.md), [Strategic Plan v6.0](../strategy/strategic_plan_v6.md), [Decisions Log v1.0](../strategy/decisions_log_v1.md), [Phase A Retrospective v1.1](phase_a_retrospective.md), [Phase A Retrospective Inputs](phase_a_retrospective_inputs.md) (institutional history through session 31)
**Audience:** Internal — founder + AI collaborators
**Phase B opens:** 2026-05-18

---

## 0. About this document

Phase B's Pace Tracker journal. Sessions during Phase B execution record their work, findings, decisions, and progress here. Mirrors the [Phase A Retrospective Inputs](phase_a_retrospective_inputs.md) document structure that proved load-bearing across Phase A's 22 substantive execution sessions.

Phase B Retrospective document (final synthesis) will be drafted at Phase B close-out per Execution Method v1 §7. This document is the input journal that feeds that synthesis.

### Duration and cadence expectations

Phase B duration estimate per [reconciliation v1 §8.4](../strategy/strategic_tactical_reconciliation_v1.md):

- **Estimated:** Months 4–7
- **Realistic** (1.3–1.8× per Execution Method v1 §2): Months 6–9

At Phase A observed velocity (~2-4 hour sessions, ~3–5 per week with bursts), this maps to approximately **25–40 Phase B sessions**. Phase B is materially larger than Phase A both in execution scope and in exit-criterion count (22 conditions across 4 groups per Phase B Brief §8).

### Three-track structure

Phase B operates with three parallel tracks per [Phase B Kickoff Brief §2](phase_b_kickoff_brief.md):

- **Track 1 — Source services + Comprehension Layer + Distribution + Search + Entertainment + Foundation** (Brief §2.2). Six work areas per Strategic Plan v6 §9 Phase B. Source services subset detailed in Brief §3.
- **Track 2 — Architecture** (Brief §2.3). B.1 codebase reorganization by skill + B.2 skill contract documentation + B.3 skill boundaries enforcement + B.4 first skill-isolation POC + BullMQ migrations (5 queues) + source scoring service implementation.
- **Track 3 — Infrastructure performance** (Brief §2.4). Sprint 0–6 from Comparative Analysis v1 §7: Cache-Control immutable, CDN edge, SWR HTML headers, SWR persistent cache pattern, SSR for hot routes.

Ops work runs as cross-track operational discipline per Brief §2.4 final paragraph — not a dedicated track. Future Phase B execution sessions should preserve this distinction (per the §2.4 inline note about earlier informal "Track 3 = ops" references; reconciliation v1 §8.1 locks Track 3 = infrastructure performance, ops is cross-track).

### No-track-dark rule

Per reconciliation v1 §8.5: **no track goes more than 4 consecutive sessions without a contribution.** Per-session track tagging happens in this journal in each Pace Tracker entry. Track conflicts (e.g., when Track 1 and Track 2 want to touch the same files during B.1 reorganization) surface in retrospective rather than silently absorbed.

### Phase A history preserved

Phase A retrospective inputs ([phase_a_retrospective_inputs.md](phase_a_retrospective_inputs.md)) is preserved read-only as institutional record. 89 cumulative findings and Pace Tracker entries through session 31 live there. No further Phase A Pace Tracker entries; Phase B starts the journal fresh from this document.

---

## Phase B sessions

Sessions logged chronologically. Latest at bottom. Pace Tracker entries follow the Phase A pattern (work shipped + sprint progress + counters + production state + next-session candidates + honest accounting).

### Session 1 — May 18, 2026 — Phase B opening + Track 1 first sprint scoping

**Type:** Phase B opening ceremony. Same session as Phase A formal close. Documentation only. Folded into the Phase A close commit chain so the day's commits cleanly express the boundary.

**Output:**

- DrJ judgment on Phase A binding kickoff gate condition 6 (time/energy budget) — **MET**.
- Phase B Kickoff Brief §6.4 Track 1 first-work recommendation (Tracker Auto-Detection Engine v1) — **CONFIRMED by DrJ.**
- First Phase B sprint (Sprint 1.1 — Tracker Auto-Detection Engine v1) scoping begins; investigation + execution plan deferred to session 32.

**Phase A close artifacts referenced:**

- [Phase A Retrospective v1.1 final addendum](phase_a_retrospective.md#final-addendum--phase-a-formal-close-may-18-2026): sessions 28-30 close-out trajectory, three findings #87/#88/#89, sprint final state, binding kickoff gate final state (6 of 8 substantively MET).
- [Phase A Retrospective Inputs session 31 entry](phase_a_retrospective_inputs.md): Phase A formal close + Phase B kickoff confirmation. That entry is the final Phase A Pace Tracker write; from this session forward Phase B Pace Tracker entries live in this document.

#### Track 1 first sprint: Tracker Auto-Detection Engine v1

**Reason for prioritization (per Phase B Brief §6.4):** Trackers produce ground-truth that Reality Index v1 (Brief §3.5) consumes downstream. Reality Index v1 cannot operate without Tracker ground-truth across the 8 signal types named in Strategic Plan v6 Capability 2:

- Major war / armed conflict (ACLED-anchored)
- Epidemic / outbreak (WHO surveillance-anchored)
- Major accident / crash (aviation, maritime, industrial)
- Sports event (scheduled fixture + interest indicator)
- Wildfire / environmental event (NOAA / USGS / ACLED)
- Election / poll / referendum (scheduled date + competitive race)
- Major study release (journal publication + media pickup)
- Entertainment release (release date + opening signal)

**Sprint 1.1 scoping notes (investigation-before-execution per Phase A pattern):**

Sprint 1.1 begins next session with codebase verification of current Tracker infrastructure before drafting execution plan. Per Phase A's investigation-before-conclusion pattern (10 of 11 inspected Brief items had wrong premises), Sprint 1.1 kickoff prompt will start with state verification rather than execution. Specific investigation scope determined at Sprint 1.1 kickoff.

Phase A Sprint 5.8 was specced to design 8 tracker templates as a Sprint 5 deliverable but was BRIDGED to Phase B Track 1 with no concrete templates shipped — investigation will need to identify what tracker plumbing exists in the codebase today and what's net-new build vs extension.

#### Track 2 + Track 3 first work (parallel-ready but not started this session)

Per Phase B Brief §6.4 Track 2 + Track 3 first works:

- **Track 2 first work:** B.1 codebase reorganization (Brief §4.1). Pure refactor, no behavioral change. Sets up `skills/` folder taxonomy for Track 1 and Track 3 to work within. 4-8 sessions estimated.
- **Track 3 first work:** Sprint 0 Cache-Control immutable on hashed static assets (Brief §5.1). 1-session hygiene win.

Both can start in parallel with Track 1 once Sprint 1.1 investigation surfaces direction. Recommended Phase B opening sprint sequence per Brief §6.3:

1. **Track 2 B.1 codebase reorganization start** (1 session) — unblocks subsequent Track 2 work.
2. **Track 3 Sprint 0** (1 session) — near-zero risk; ship-and-forget.
3. **Track 1 source discovery service design** (1-2 sessions) — doesn't block on Track 2; produces design artifact that feeds scoring-service implementation context.
4. **Track 3 Sprint 1 CDN edge** (2-3 sessions) — high user-visible payoff; independent of Track 1.

Track 1 work in this opening sequence is *source discovery service design*, not Tracker Auto-Detection Engine v1. The Brief §6.4 recommendation prioritizes Tracker Engine for Track 1 first-work; the §6.3 "recommended early sessions" list shows a parallel-execution sequence that touches all three tracks early. **Both can coexist** — the Tracker Engine work is Track 1's *first feature deliverable*; the source discovery service is Track 1's *first source-services deliverable*. Phase B Sprint 1.1 takes the §6.4 recommendation (Tracker Engine) per DrJ confirmation this session; later sessions sequence Track 2 B.1 + Track 3 Sprint 0 + source discovery service design per the §6.3 parallel-work guidance, respecting the no-track-dark rule (no track goes more than 4 consecutive sessions without a contribution).

#### Counters at Phase B opening

| Counter | Value |
|---|---|
| Phase B session count | 1 (this session) |
| Phase B findings | 0 (none yet) |
| Phase A findings (read-only institutional record) | 89 |
| Sprint count (Phase B) | 0 — Sprint 1.1 scoping begins session 32 |
| Phase B commits this session | 2 (Phase A close + Phase B open; shared across the two-commit chain) |
| Production HEAD | `6278ab6` (unchanged from session 30 close) |
| Migrations applied in production | 002 + 003 |
| Three-track contribution count this session | All three tracks touched by virtue of Phase B opening (Track 1 first-sprint confirmation; Track 2 + Track 3 first-work plans referenced) |

#### Phase B Track 1 followup work inherited from Phase A close-out

Five items deferred from Phase A to Phase B Track 1 with concrete scope already captured in Phase A close-out documentation:

1. **Sprint 4.7 source priority list** — Phase B Track 1 source discovery service per Decision 16 weekly batch proposes candidates iteratively.
2. **Sprint 5.x social audit, search audit, tracker template library** — Phase B Track 1 Social Engine v2 + Search Upgrade + Tracker Engine work covers experientially. The tracker template library piece is *directly relevant* to Sprint 1.1 (Tracker Auto-Detection Engine v1 needs the 8 templates).
3. **metrics-ops endpoint scheduler `last*Run` filter type fix** (finding #89 followup) — ~1-2 sessions when Phase B picks it up. Not blocking Sprint 1.1.
4. **metrics-ops endpoint `background_job_runs` population semantics investigation** (finding #89 followup) — 3 remediation options pending decision.
5. **Returning user rate Layer 1 analytics infrastructure** (session 28-extension DEC1) — Phase B Track 1 Distribution scope.

Items 1, 2, and 5 are core Track 1 work items folded into the Phase B execution plan. Items 3 and 4 are Track 1 followup that should be sequenced when convenient (likely after Sprint 1.1 ships, when the Tracker Engine work has an operational baseline to measure against).

#### Next session candidate

**Session 32 — Phase B Sprint 1.1 investigation phase.** Codebase verification of existing Tracker infrastructure per the 7-point checklist above. No execution work this session; output is a scoping report that informs Sprint 1.1 execution plan. Estimated 1 session for investigation + scoping.

After scoping, Sprint 1.1 execution begins session 33 or later, depending on what investigation surfaces. If investigation reveals that existing event-tracker infrastructure already handles most of what Tracker Auto-Detection Engine v1 needs, Sprint 1.1 collapses to a smaller extension sprint (2-3 sessions). If net-new infrastructure, Sprint 1.1 expands to a multi-sprint build (5-8 sessions).

#### Honest scoping note for Phase B execution

Phase A demonstrated that Brief premises often need pre-execution verification (10 of 11 Brief items wrong premises). Phase B sessions should preserve that discipline:

- Brief §6.4 recommends Tracker Auto-Detection Engine v1 — confirmed.
- Brief §6.3 recommends a parallel opening sequence — adopted as guidance, not binding sequence.
- Brief §3 details source services — those work areas wait until source discovery design ships.
- Brief §4 details Track 2 — B.1 reorganization starts when convenient.
- Brief §5 details Track 3 — Sprint 0 cache-control ships when convenient.

The Brief is the structural commitment defining Phase B. Sprint plans inside Phase B fill in the inside. Phase A retrospective findings — particularly **D1 (Brief written without inspecting current code state), D5 (tactical estimates systematically undercounted ~2×), and D6 (Sprint 4-5 audit work displaced by emergent stabilization)** in [Phase A Retrospective §4](phase_a_retrospective.md#4-what-didnt-work) — should inform Phase B's discipline on premise verification, estimate honesty, and scope discipline against emergent work.

---

### Session 2 — May 18, 2026 — Sprint 1.1 investigation + decomposition (Tracker Engine v1 is XL epic, not single sprint)

**Type:** Phase B execution session. Investigation + decomposition planning. Scope B per pre-execution constraint — investigation revealed XL scope; execution defers to session 33+.

**Output:** Sprint 1.1 investigation findings + Sprint 1.1 decomposed to 5 sub-sprints + Finding #90 (naming collision) + Sprint 1.1 plan section narrowed to template-library design (Phase A Sprint 5.8 carryover).

#### Investigation findings summary

The full investigation findings live in this session's commit message + conversation history. Compact summary of the 5 sections:

**1. Tracker definition.** Per Strategic Plan v6 §3 Capability 2 + Decision 12: a Tracker is a **per-event quantitative scorecard** (structured metadata attached to an event, not a separate entity). Examples: conflict tracker = `{casualties, hardware_loss, territorial_control, refugee_flows}`. The **Tracker Auto-Detection Engine** monitors event signals and auto-proposes which events warrant trackers based on event-type signals (8 signal types: conflict, outbreak, incident, sports, environmental, election, study, entertainment). Templates derived from validated journalism conventions (Reuters Graphics, WHO surveillance, ACLED, Box Office Mojo, Our World in Data). Phase B target: ≥10 active trackers across the 8 signal types.

**2. Existing infrastructure.** Naming collision flagged. `backend/src/realityIndex/intelligence/eventTracker.js` exists but does cluster→event promotion (NOT the strategic Tracker concept). Events table exists with `category`, `severity`, `meta` (JSON) columns — foundation for tracker metadata but no tracker schema yet. **NO `tracker_template` column, NO `tracker_instance` table, NO template library, NO auto-detection mechanism for trackers.** Anomaly detection pattern (`anomalyDetector.js`, ~200 lines) provides adaptable signal→detection→record shape. Frontend has zero tracker components. Honest assessment: **~0% of strategic Tracker concept exists in code.** Net-new infrastructure on top of existing events table.

**3. Phase A Sprint 5.8 context.** Phase A Kickoff Brief Issue 5.8 specced "Design tracker template library" — 8 markdown docs at `docs/content/tracker_templates/<type>.md`. Same concept as Brief §6.4 Tracker Engine (Decision 12 is authoritative for both). **Artifacts produced before BRIDGE: zero.** No `docs/content/tracker_templates/` directory; no template files. Sprint 5.8 was BRIDGED to Phase B Track 1 per session 28-extension DEC2 with no Phase A output.

**4. Auto-detection mechanism candidates.** Existing `anomalyDetector.js` pattern is the right analog — scheduled detector, scans recent data, applies threshold-based rules per type, writes records. Signal sources already ingested cover 6 of 8 strategic signal types (conflict via ACLED+GDELT, environmental via NOAA+USGS, sports via SportsDB, entertainment via TMDB; outbreak indirectly via news; incident indirectly). **2 of 8 signal types lack clear ingester paths:** election (no scheduled-elections feed), study (no journal-publication feed). Those 2 templates would have manual-creation paths until Phase B Track 1 onboards relevant sources.

**5. Decision 12.** Binding decision: AI-generated trackers using validated templates + human review on each instantiation; platform intelligence auto-detects which events warrant trackers. Hand-curation explicitly rejected. Templates + auto-detection are the architectural commitment.

#### Sprint 1.1 → 1.5 decomposition

Sprint 1.1 as initially framed (Brief §6.4) is XL scope — 8-13 sessions, not a single sprint. Brief framing was **correct in intent** (Tracker Engine v1 is the right Track 1 first work) but **underspecified actual scope.** Honest correction:

| Sub-sprint | Work | Estimate |
|---|---|---|
| **Sprint 1.1** (narrowed) | **Template library design** — 8 markdown template docs at `docs/content/tracker_templates/*.md`. Phase A Sprint 5.8 carryover. Encodes Reuters Graphics, WHO surveillance, ACLED, Box Office Mojo, Our World in Data conventions per Decision 12. | 2-3 sessions (M) |
| Sprint 1.2 | **Tracker data model** — Migration for `tracker_instances` table (event_id, template_type, metrics JSON, last_updated, status). Schema design informed by Sprint 1.1 templates. | 1-2 sessions |
| Sprint 1.3 | **Auto-detection mechanism** — new module `trackerDetector.js` scanning events + signal-source data, applying per-signal-type rules. Pattern from `anomalyDetector.js`. **Naming-collision rename of existing `eventTracker.js` happens here** (Track 2 cleanup folded in to avoid further confusion compounding — see finding #90). | 2-3 sessions |
| Sprint 1.4 | **Scheduler wiring + integration** — wire `runTrackerDetector()` into `scheduler.js`; integration tests against seeded events. | 1-2 sessions |
| Sprint 1.5 | **Frontend tracker display** — Layer 1 (1-2 key metrics on event card) + Layer 2 (full scorecard on dossier) per Capability 2. New components, EventsPage integration. | 2-3 sessions |

**Total Tracker Engine v1 = 8-13 sessions.** Sequenced post-templates so schema design (1.2) follows from template requirements; auto-detection (1.3) follows from schema; scheduler (1.4) follows from detection; frontend (1.5) follows from data.

#### Naming collision — see finding #90 below

Cross-reference: finding #90 captures the institutional context. Renaming `eventTracker.js` (cluster→event promotion) before Sprint 1.3 ships Tracker Engine code prevents the dual-meaning from compounding. Rename is Track 2 cleanup folded into Sprint 1.3 scope.

#### Risks and uncertainties (4 surfaced during investigation)

1. **Naming collision** — existing `eventTracker.js` vs strategic Tracker Engine. Track 2 cleanup, addressed in Sprint 1.3. See finding #90.
2. **Signal source coverage gap** — 2 of 8 signal types (election, study) lack clear ingester paths. Templates for those 2 types will document the gap; full operation depends on Phase B Track 1 onboarding relevant sources downstream.
3. **Decision 16 weekly batch interaction** — auto-detection produces tracker proposals that need founder review (Decision 12: "human review on each instantiation"). The editorial review interface (Brief §3.4) needs to handle tracker-proposal review alongside source-onboarding review. Likely shareable infrastructure; surface this when Sprint 1.4 designs the review workflow.
4. **Template format ambiguity** — Strategic Plan v6 + Decision 12 say "validated templates" without specifying whether the template is the *visual display structure*, the *data schema*, both, or something else. **Sprint 1.1 must resolve this** — the template author has to make the call, and the call shapes Sprint 1.2 schema design.

#### Honest scope correction

Brief §6.4 framing ("Tracker Auto-Detection Engine v1 as Track 1 first work") was correct in intent but underspecified actual scope. Investigation revealed the engine is a 5-sub-sprint epic (8-13 sessions), not a single sprint. This is the second Phase B scope correction in 2 sessions (Session 1 surfaced Brief §6.3 vs §6.4 framing harmonization; Session 2 surfaces Brief §6.4 vs actual-scope correction). Phase A's D5 finding (estimates systematically undercounted ~2×) is already visible in Phase B Brief authoring discipline — a useful early signal that the Brief authored at session 28 needs the same investigation-before-execution discipline that Phase A finally adopted.

Per Decision 12 framing, the work isn't ambiguous — templates + auto-detection are clearly committed. The "v1 as Track 1 first work" framing collapsed the multi-phase nature of the build. Today's decomposition is the honest correction.

---

### Phase B Sprint 1.1 plan — Tracker template library design

**Type:** Phase B Track 1 first sprint (narrowed from Brief §6.4 "Tracker Engine v1" framing per session 2 decomposition).

**Goal:** Ship 8 markdown template documents at `docs/content/tracker_templates/<type>.md`, one per strategic signal type per Strategic Plan v6 §3 Capability 2 + Decision 12. Templates encode validated journalism conventions and specify tracker structure (metrics, data sources, update cadence, display considerations) for each signal type.

**Scope estimate:** M (2-3 sessions).

**Investigation premise verification:** Per Phase A pattern (10 of 11 wrong Brief premises), investigation already happened in Session 2 of this Phase B journal. Findings (existing eventTracker.js naming collision, Sprint 5.8 zero-artifact bridge, signal-source coverage gap for 2 of 8 types, template-format ambiguity) incorporated into this plan rather than rediscovered mid-execution.

**Inputs:**

- Strategic Plan v6 §3 Capability 2 Tracker Auto-Detection Engine spec (8 signal types + their data-source signals)
- Decision 12 (validated templates from trusted sources, human review on each instantiation)
- External journalism conventions referenced in Strategic Plan v6 + Decision 12:
  - **Conflict templates:** Reuters Graphics methodology + ACLED reporting standards
  - **Outbreak templates:** WHO surveillance formats
  - **Environmental templates:** Our World in Data conventions
  - **Entertainment templates:** Box Office Mojo presentation patterns
  - **Sports, election, incident, study:** conventions to be researched per category
- Existing codebase context: events table schema (foundation for tracker_instances data model in Sprint 1.2)

**Outputs:**

8 markdown template documents:

1. `docs/content/tracker_templates/conflict.md` — for major war / armed conflict events
2. `docs/content/tracker_templates/outbreak.md` — for epidemic / outbreak events
3. `docs/content/tracker_templates/incident.md` — for major accident / crash events (aviation, maritime, industrial)
4. `docs/content/tracker_templates/sports.md` — for sports events (tournament, championship, major game)
5. `docs/content/tracker_templates/environmental.md` — for wildfire / environmental events
6. `docs/content/tracker_templates/election.md` — for election / poll / referendum events
7. `docs/content/tracker_templates/study.md` — for major study release events
8. `docs/content/tracker_templates/entertainment.md` — for entertainment release events

Each template specifies (consistent structure across all 8):

- Tracker purpose + when this template applies (detection-signal trigger conditions)
- Core metrics (the quantitative scorecard fields — what data the tracker holds)
- Data sources (which ingesters/feeds populate each metric)
- Update cadence (how often the tracker refreshes; ties to scheduler design in Sprint 1.4)
- Display considerations (Layer 1 1-2-key-metrics view + Layer 2 full-scorecard view per Capability 2)
- Validation source (the journalism convention this template is grounded in)
- Open questions / honest limitations (gaps the v1 template doesn't resolve)

**Mechanism:** Design work — research validated journalism conventions for each signal type, document tracker template structure consistently across all 8. Pure documentation. No code, no schema, no scheduler wiring.

**Milestones:**

- **Sprint 1.1.1** (session 33): Ship **2 templates first** for pattern establishment — recommend **conflict** + **outbreak**. These have the most-studied conventions (Reuters/ACLED for conflict; WHO surveillance for outbreak), so they're the lowest-risk starting pair. Each ~80-150 lines.
- **Sprint 1.1.2** (session 34, optional gate): Review the 2-template pattern. Refine template structure if review surfaces ambiguity. If pattern holds, proceed; if not, revise before scaling.
- **Sprint 1.1.3** (session 34 or 35): Remaining 6 templates — incident, sports, environmental, election, study, entertainment. Each ~80-150 lines.

Total per-template authoring time is the major cost; pattern verification at milestone 1.1.2 protects against rework on 6 templates if 2-template review surfaces structural issues.

**Verification approach:**

- Templates align with cited journalism conventions (Reuters Graphics / WHO / ACLED / Our World in Data / Box Office Mojo). DrJ review at milestone 1.1.2 catches conventions-alignment issues before they propagate.
- Structure is consistent across all 8 templates (same section headings, same metric-format conventions, same data-source documentation pattern).
- Templates are concrete enough to inform Sprint 1.2 data-model design (i.e., the `tracker_instances.metrics JSON` schema can be derived from the template metric specifications).
- Output is browsable by future readers as design reference, not just internal scratch.

**Out of scope for Sprint 1.1 (deferred to later sub-sprints):**

- No code changes (Sprint 1.3 ships engine code)
- No database schema (Sprint 1.2 ships migration for `tracker_instances`)
- No scheduler wiring (Sprint 1.4)
- No frontend (Sprint 1.5)
- No `eventTracker.js` rename (Sprint 1.3 folds in as Track 2 cleanup before Tracker Engine code lands)
- No specific signal-source operationalization beyond what Strategic Plan v6 names (templates document the signal sources but don't implement them; Sprint 1.3 + future Track 1 source-onboarding work do that)

**Risks:**

- **Template format ambiguity** (risk 4 from investigation) — partly resolved by concrete template authoring at milestone 1.1.1. The act of writing 2 templates forces the format decision.
- **Signal source coverage gap** (risk 2 from investigation) — election + study templates may need source-onboarding context before being complete. Templates can document the data-source gap explicitly ("currently no scheduled-elections feed; Phase B Track 1 source-onboarding will land this") so the gap is visible rather than hidden.
- **Convention-alignment drift** — without academic peer review, templates may diverge slightly from cited conventions. Mitigation: cite specific source documents and quote relevant rubric/methodology language where possible.
- **Scope creep into Sprint 1.2 data model design** — easy to start sketching the schema during template authoring. Discipline: keep Sprint 1.1 markdown-only. Schema sketches that emerge get logged in this journal for Sprint 1.2 inheritance, not shipped as code in Sprint 1.1.

#### Counters at session 2 close

| Counter | Value |
|---|---|
| Phase B session count | 2 |
| Phase B findings | 1 (#90 added this session) |
| Phase A findings (read-only) | 89 |
| Sprints in flight | Sprint 1.1 plan published; execution begins session 33 |
| Production HEAD | `6278ab6` (unchanged) |
| Migrations applied in production | 002 + 003 |

#### Three-track contribution this session

- **Track 1:** Sprint 1.1 plan + 1.2-1.5 decomposition (Track 1 feature work). Investigation discipline applied.
- **Track 2:** Finding #90 names the eventTracker.js rename as Track 2 cleanup folded into Sprint 1.3. No Track 2 work shipped today but Track 2 is acknowledged + sequenced.
- **Track 3:** Not touched. Per no-track-dark rule (max 4 consecutive sessions per Brief §2.5), Track 3 has 4 sessions before it must be touched — Sprint 1.1.1 + 1.1.2 + 1.1.3 covers the upcoming 3 sessions, so Track 3 (Sprint 0 Cache-Control immutable, 1-session hygiene win per Brief §5.1) should land by session 35-36 latest.

#### Next session candidate

**Session 33 — Sprint 1.1.1: ship 2 templates (conflict + outbreak)** for pattern establishment. Plan to author ~80-150 lines per template; review pattern in same session if budget allows, or defer pattern review to milestone 1.1.2 in a separate session.

---

### Session 3 — May 18, 2026 — Pinterest sandbox integration + production 503 incident + X-Posting Queue scope plan

**Type:** Phase B Track 1 work + production incident response. ~4 hours of work across investigation, code change, deployment, debugging, recovery. Pre-empted Sprint 1.1.1 (Tracker templates) which remains the next-session candidate.

**Output:**

- Pinterest integration architecture verified — implementation pre-existed (`pinterestClient.js` + `pinterest-auth.mjs` + `socialPublisher` adapter all in codebase pre-session). Phase B-S33.A investigation pivoted the session from "build" to "config + verify + deploy" within minutes of discovery.
- Pinterest API base URL configurability fix shipped (commit `e8966ba`). Single-edit `pinterestClient.js` + `.env.example` Pinterest section addition.
- Pinterest sandbox endpoint deployed to Hostinger production via `PINTEREST_API_BASE_URL=https://api-sandbox.pinterest.com`.
- Pinterest sandbox-specific token requirement discovered as blocker (separate from production OAuth token).
- Admin token rotated for security hygiene (previous accidentally leaked into conversation).
- Production HTTP 503 incident encountered and resolved.
- DrJ Path α decision locked for X work: free email-digest delivery (no paid X API).

**Commits this session:** 1 (`e8966ba` — Pinterest endpoint fix).

#### Pinterest state at Session 3 close

| Surface | State |
|---|---|
| Endpoint routing | Production URL → sandbox URL (env-driven; verified via error message change from `403 Apps with Trial access may not create Pins in production` to sandbox-side `401 Authentication failed`) |
| Token state | Production OAuth token deployed in `PINTEREST_ACCESS_TOKEN`; sandbox endpoint rejects with 401 (production tokens don't authenticate against sandbox endpoint) |
| Adapter enabled in `/auto-status` | Yes (`enabled: ["...", "pinterest", "..."]` confirmed via curl) |
| Pin creation | Blocked on sandbox-specific token retrieval |
| Next-session work | Retrieve sandbox token via Pinterest Developer dashboard "Generate Test Token" flow (or whichever sandbox-token-issuance mechanism Pinterest provides) |

#### Production 503 incident

**Timeline.** Late afternoon UTC May 18:
- Admin token rotated (security hygiene after accidental conversation exposure).
- Pinterest sandbox env var added (`PINTEREST_API_BASE_URL=https://api-sandbox.pinterest.com`).
- Restart triggered.
- HTTP 503 returned by production.
- Second restart executed.
- Production recovered: HTTP 200 + fresh uptime.

**Downtime:** approximately 5–10 minutes. **No data loss.** Migrations 002 + 003 stayed applied (verified via `/api/health.sourceCount: 110` post-recovery). Article ingestion resumed cleanly post-restart.

**Root cause:** undetermined. Hostinger logs not accessible to DrJ during the incident. Possible causes (ranked):
1. **Hostinger save-and-apply race condition** — env-var change saved but restart triggered before the new env propagated into the process's environment. Plausible given Hostinger's UI sometimes splits "save" from "apply."
2. **First restart didn't actually trigger** — token rotated but the running app kept old admin-token state in memory; second restart was the real restart.
3. **Transient platform issue** — Hostinger node went briefly unhealthy unrelated to our changes; second restart re-established health on a different node.

Captured as finding #93 below.

#### Operational mitigation pattern established this session

For future production env changes:
- Push env var to Hostinger
- Trigger restart
- Verify `/api/health` shows fresh low uptime (< 60s)
- If uptime didn't refresh → restart again
- Treat HTTP 503 as expected-during-transition (≤ 5 min) rather than as outage signal until two restarts have occurred

This "second-restart-confirmation" pattern is operational discipline going forward; not a code change.

#### Phase B retrospective findings count

1 (Session 2 added #90) → **4** (Session 3 adds #91, #92, #93 — see Phase B findings section below).

**Brief inaccuracy count:** 10 of 11 → **11 of 12** inspected items (advanced by #91 — Pinterest implementation pre-existed prompt premise).

#### DrJ decisions captured this session

- **X work — Path α confirmed.** Scoopfeeds X-Posting Queue Sprint 2.x with email-digest delivery. Completely free; manual paste step. Path β (direct X API at $200–300/month) ruled out. Path γ (third-party wrapper at $2.99–30/month) ruled out per "completely free" constraint. Sprint 2.x plan section below details the architecture.

#### Known followup work added this session

- **Sandbox token retrieval** — Session 35 (next-after-next). Phase B Track 1.
- **Token-refresh rotation in `pinterestClient.js`** — 30-day operational debt. Currently no refresh logic; tokens just expire silently. Phase B Track 1.
- **Instagram failure rate diagnosis** — 77 failures in 24h per `/auto-errors`; error string "Application request limit reached." Phase B Track 1. Independent of Pinterest work.
- **Production observability improvement** — Hostinger logs access OR external logging service (Sentry / BetterStack / equivalent) to make incidents like #93 diagnosable. Phase B Track 3 candidate (cross-track operational discipline rather than dedicated Track 3 work).
- **`.env\r` cruft housekeeping** — Windows line-ending artifact in repo, untracked. Low priority. Defer to separate investigation; not blocking.
- **Pinterest Standard access demo video** — after sandbox works, DrJ records demo per Pinterest's Standard-access application requirements. DrJ executes; not code work.

#### Production state at Session 3 close

| Field | Value |
|---|---|
| Production HEAD | `6278ab6` — unchanged for user-facing behaviour. Session 3's `e8966ba` is a backend-config change that takes effect via Hostinger env; the user-facing code surface is unchanged. |
| Uptime at capture | ~6.5 min (393s — fresh post-second-restart) |
| Articles | 26,087 |
| Videos | 2,237 |
| sourceCount | 110 |
| Scheduler started | true |
| Memory | 53 MB / 58 MB (~91%) — up from 86% at session 30 close. Operational drift worth watching; not blocking. Worth a separate Phase B Track 3 followup if it crosses 95% sustained. |
| Migrations applied | 002 + 003 (plus `e8966ba` config-only change that doesn't introduce a new migration) |
| No outstanding production incidents | True (503 resolved at session ~mid-point) |

#### Three-track contribution this session

- **Track 1:** Pinterest integration verification + sandbox endpoint deployment + `e8966ba` config fix + sandbox-token-blocker discovery (all Track 1 source/distribution work — Pinterest is a Distribution surface per Phase B Kickoff Brief §2.2).
- **Track 2:** None this session.
- **Track 3:** Production observability gap surfaced via 503 incident (finding #93) — flagged as Phase B Track 3 followup candidate. No Track 3 code work shipped. Track 3 has not been touched in Phase B sessions 1–3. The no-track-dark guidance from Brief §2.4 suggests Track 3 work should appear before too many consecutive Track-1-only sessions. Sprint 0 (Cache-Control immutable) is the natural first Track 3 work; appropriate timing is DrJ judgment based on Track 1 momentum vs Track 3 lapse.

#### Next session candidate

**Session 35 — Pinterest sandbox token retrieval + verification.** Sandbox token from Pinterest Developer dashboard → Hostinger env → restart → re-test `/auto-post?platform=pinterest&dry=1` (expecting 200 with mock pin response from sandbox; sandbox doesn't create real pins) → flip to non-dry run if dry succeeds.

If sandbox token retrieval is blocked by Pinterest Developer dashboard UX issues (which would be Pinterest's gap, not ours), session 35 could pivot to:
- Sprint 1.1.1 — ship 2 Tracker templates (conflict + outbreak) per Sprint 1.1 plan from Session 2
- Sprint 2.x.1 — start X-Posting Queue work (data model + post generator)

---

### Phase B Sprint 2.x plan — Scoopfeeds X-Posting Queue

**Type:** Phase B Track 1 distribution sprint, locked by DrJ Path α decision (Session 3). Architecture finalized below; execution begins when DrJ schedules.

**Goal:** Generate X-ready posts from published articles; deliver to DrJ via email digest; DrJ manually copy-pastes posts to the `@scoop_feeds` X account.

**Architectural commitment:**

- **Free, no recurring cost.** X API direct integration ($200–300/month) ruled out. Third-party wrappers (Buffer / Hootsuite tier) ruled out per "completely free" constraint.
- **Email digest delivery** replaces the admin dashboard from earlier Sprint 2.x decomposition. Email is the operationally-cheapest delivery surface (reuses existing newsletter infrastructure).
- **Manual paste step** is the trade-off accepted for $0/month cost. ~5–15 min/day for DrJ depending on article volume.
- **80–90% automation:** generation, formatting, delivery all automated; only the paste itself is manual.

**Sub-sprint decomposition:**

| Sub-sprint | Work | Estimate |
|---|---|---|
| **Sprint 2.x.1** | **Data model + post generator** — Migration for `x_post_queue` table (article_id FK, post_text, post_type ∈ {single, thread}, status ∈ {pending, sent_in_digest, marked_posted}, generated_at, sent_in_digest_at, marked_posted_at). Post generator integrated with article publish pipeline. Generator handles X's 280-char limit + thread composition for high-value articles (multi-tweet format with "1/3", "2/3", "3/3" markers). Test against sample articles. | 1 session |
| **Sprint 2.x.2** | **Email digest delivery** — Email template (HTML + plaintext fallback). Scheduled job at DrJ-configurable cadence (default daily 9am UTC). Renders pending queue as numbered list with copy-friendly formatting; threads formatted with sequence markers for clean sequential copy. Integrates with existing newsletter sending infrastructure (reuses transport + delivery DAOs). Mark-as-sent logic prevents same posts repeating across digests. | 1 session |
| **Sprint 2.x.3** | **Workflow refinement** — Lightweight mark-as-posted endpoint (POST confirming "I posted this") so the queue knows what actually landed on X. Optional: regenerate-draft button if email content is bad (operator escape hatch). | ~0.5 session |
| **Total** | | **~2.5 sessions** |

**DrJ workflow once shipped:**

1. Scoopfeeds publishes article (existing pipeline).
2. Post generator queues an X-ready version (single tweet or thread per article value).
3. Daily 9am UTC digest email delivers to DrJ inbox.
4. DrJ reads email, copies posts (or thread sequences in order), pastes to `@scoop_feeds` X account via X mobile or web.
5. Optionally: DrJ marks as posted via lightweight endpoint (mostly for analytics; the queue functions without this step).

**Out of scope for Sprint 2.x v1:**

- Admin dashboard (deliberately omitted per Path α refinement)
- Auto-posting to X (rules out X API costs)
- Per-post analytics on X engagement (Phase C concern when Scoopfeeds has volume that makes this useful)
- Browser automation against X UI (ToS violation, account-lock risk; explicitly rejected)

**Trade-off honestly documented:**

| Dimension | Trade |
|---|---|
| Recurring cost | $0/month |
| DrJ time per day | ~5–15 min manual paste step |
| Automation depth | 80–90% (generation + formatting + delivery automated; posting manual) |
| Future migration path | If DrJ later wants full automation: IFTTT Pro (~$3/month) bridges Threads → X automatically; add-on, doesn't require Sprint 2.x rewrite. If X API pricing changes: direct API integration replaces the manual paste step; existing generator + queue absorb without rebuild. If volume scales: admin dashboard added in a later sprint with the queue table already populated. |

**Sequencing relative to Sprint 1.1:**

Sprint 2.x runs in parallel with Sprint 1.1 (Tracker templates) at DrJ's discretion. They have no dependency between them. DrJ chooses per-session which track-1 sprint to feed.

**Why Sprint 2.x is captured now (Session 3) before execution:**

Path α decision was made this session as the response to "X work" surfacing. Capturing the plan now while the decision rationale is fresh — per Phase A finding #76 architectural breadcrumb pattern (document parallel infrastructure so future readers see structure explicitly). Execution begins when DrJ schedules.

---

## Phase B findings

Findings captured here are Phase B-specific, beginning with #90. Phase A findings 1-89 are preserved read-only in [Phase A Retrospective Inputs](phase_a_retrospective_inputs.md).

### Finding #90 — Naming collision: "tracker" terminology has multiple operational meanings in codebase

**Discovery context.** Phase B Session 2 Sprint 1.1 investigation (May 18, 2026). Investigating "Tracker Auto-Detection Engine v1" as Phase B Track 1 first work (Brief §6.4). Found that **two unrelated concepts share the word "tracker"** in the codebase, one of them load-bearing today.

**Existing operational meaning.** `backend/src/realityIndex/intelligence/eventTracker.js` (~180 lines) does **cluster→event promotion**: scans `story_clusters` table, promotes clusters with ≥5 articles or ≥1 matched market into `events` table rows (upsert, with severity heuristic + slug + hero image). Runs every 30 min via scheduler. The function `runEventTracker()` is wired into the cron sequence. This is foundational pipeline plumbing — events table is downstream of this; Reality Index snapshots, anomaly detection, sentiment scoring all consume events. The "tracker" here means "the thing that *tracks* (i.e., promotes) story clusters into events."

**Strategic concept (not yet built).** Per Strategic Plan v6 §3 Capability 2 + Decision 12, a **Tracker** is a **per-event quantitative scorecard** — structured metadata attached to events (conflict tracker = `{casualties, hardware_loss, territorial_control, refugee_flows}`; outbreak tracker = `{cases, deaths, vaccinations, regional_spread}`; etc., 8 signal types). The **Tracker Auto-Detection Engine** auto-proposes which events warrant trackers + which template to apply based on event-type signals. Targets ≥10 active trackers across the 8 types as Phase B exit criterion. Not yet built (Phase B Sprint 1.1-1.5 ships this).

**Sub-pattern (new, distinct from #87/#88/#89):**

- **#87 sub-pattern:** Brief premise valid at authoring, invalidated by intervening work.
- **#88 sub-pattern:** Design choice assumed convention was stylistic preference when it was structural constraint.
- **#89 sub-pattern:** Dev verification with seeded test data masks production data-path divergence.
- **#90 sub-pattern (new):** **Terminology collision — same word with multiple unrelated operational meanings within the same codebase.** Different from #88 (where the convention was structural but the design ignored it) because here both meanings independently make sense; the collision arose from the strategic concept being named "Tracker" after the operational module was already named `eventTracker`. The pattern surfaces during execution-planning investigation, not during design or build.

**Mitigation: rename `eventTracker.js` as Track 2 cleanup folded into Sprint 1.3.**

The rename must happen **before** Sprint 1.3 ships Tracker Engine code under the strategic name. The dual usage will compound otherwise — readers landing in Sprint 1.3+ code will conflate the cluster-promotion module with the per-event-scorecard engine. Renaming after the strategic Tracker code lands becomes a harder commit (touches more files, requires backwards-compat consideration if any downstream code references the renamed module).

**Sprint 1.3 will have dual scope — Track 2 rename (cluster→event promoter) + Track 1 Tracker Engine code.** The dual-track contribution is intentional per Phase B no-track-dark rule applying per-session not per-sprint. Rename commit precedes Tracker Engine code commit within Sprint 1.3 so the new code lands under the strategic name from its first line.

**Renaming candidates** (DrJ decides at rename time in Sprint 1.3):

- `clusterPromoter.js` — names the operation directly (promotes clusters)
- `eventPromoter.js` — names the result (events get promoted)
- `clusterToEventPromoter.js` — explicit but verbose

**Why this matters.**

1. Future readers/agents seeing "tracker" in code will conflate the two concepts. The longer the dual usage persists, the harder the rename becomes (more file references, more cognitive accumulation).
2. Documentation referring to "tracker" can mean either concept — Sprint 1.1 template documents must explicitly name the strategic concept to avoid carrying the ambiguity forward.
3. Phase B Brief §3.5 says "Trackers produce ground-truth that Reality Index v1 consumes downstream" — this uses the strategic meaning. A reader who first encounters the term in `eventTracker.js` will not understand Brief §3.5 correctly.
4. The pattern argues for terminology consistency checks during Brief authoring (Phase B Track 1 Brief refinements should scan codebase for any term they introduce that's already in use).

**Refs:**

- `backend/src/realityIndex/intelligence/eventTracker.js` (existing module, cluster→event promotion)
- `backend/src/realityIndex/schema.js` lines 155+ (Phase 2: Event Tracker tables — events / event_articles / event_actors / event_timeline / event_market_links)
- `backend/src/services/scheduler.js` lines 27, 220, 270, 333-339 (scheduler wiring for `runEventTracker`)
- Strategic Plan v6 §3 Capability 2 (strategic Tracker definition)
- Decisions Log Decision 12 (Tracker build strategy)
- Phase B Kickoff Brief §6.4 + §3.5 (strategic Tracker first-work framing)
- Phase B retrospective inputs Session 2 entry (this commit; Sprint 1.1 decomposition references #90)

### Finding #91 — Brief premise invalidated by intervening implementation (Pinterest integration pre-existed prompt assumption)

**Discovery context.** Phase B-S33.A investigation (May 18, 2026). Session 33 prompt framed Pinterest integration as greenfield implementation work — "verifies existing social-poster pattern (FB, IG, Threads, Bluesky already operational) before drafting Pinterest implementation." Investigation revealed `pinterestClient.js` (85 lines, fully implemented Pinterest API v5 publisher), `pinterest-auth.mjs` (193-line OAuth helper), and the Pinterest adapter in `socialPublisher.js` (lines 213-232) all already existed in the codebase. The prompt's premise was wrong at moment of execution.

**The actual session pivoted from build to verify within minutes of discovery.** Phase B-S33.A surfaced the existing implementation, Phase B-S33.B did OAuth + Hostinger config + deploy, Phase B-S33.B.3 verified end-to-end (which surfaced finding #92 below), Phase B-S33.B.4 shipped the sandbox-routing config fix (`e8966ba`).

**Sub-pattern (new, distinct from #87/#88/#89/#90):**

- **#87 sub-pattern:** Brief premise valid at authoring, invalidated by intervening **work** on the same code (isUrdu propagated across files after Brief was written).
- **#88 sub-pattern:** Design choice assumed convention was stylistic preference when it was structural constraint (SPA-route collision).
- **#89 sub-pattern:** Dev verification with seeded test data masks production data-path divergence (metrics-ops null returns).
- **#90 sub-pattern:** Terminology collision (same word, multiple unrelated operational meanings in same codebase).
- **#91 sub-pattern (new):** **Brief premise invalidated by intervening implementation.** Distinct from #87 because in #87 the Brief item was authored before the relevant work landed (work invalidated the premise *after* Brief was written). In #91 the relevant implementation was already in the codebase *when* the prompt was authored — the prompt author didn't know it existed. Different vector for staleness: prompt author can't be expected to know every existing implementation, but the codebase has the truth.

**Investigation-before-execution discipline caught this immediately.** Phase B-S33.A pivoted Session 33 within ~15 minutes of script-existence discovery. Pattern continues to validate the discipline established by findings #15, #75, #81, #82, #83, #84.

**Brief inaccuracy count progression:** 10 of 11 → **11 of 12** inspected Brief items with wrong premises (advanced by #91).

**Mitigation already in place** — investigation-before-execution discipline. Possible enhancement: Brief / prompt authors who don't have full codebase context should explicitly defer "what exists vs what's new" to the executing agent's investigation phase, rather than committing to a build/verify framing pre-investigation. This was already implicit in DrJ's prompts (which include "investigation first" framing); finding #91 just makes the implicit principle explicit.

**Refs:**

- Phase B-S33.A investigation findings (Session 3 entry above)
- `backend/src/services/pinterestClient.js` (existing implementation)
- `backend/scripts/pinterest-auth.mjs` (existing OAuth helper)
- `backend/src/services/socialPublisher.js` lines 213-232 (existing adapter)
- Commit `f5fd14f` (Phase A session ~26 era — when Pinterest implementation was added, predating Session 33's prompt by weeks)
- Finding #87 (sibling sub-pattern; #91 distinguishes from it)
- Finding #84 (Sprint 4.4 Brief premise errors — origin of the Brief-discipline pattern)

### Finding #92 — Pinterest sandbox endpoint requires sandbox-specific access token (not the OAuth user-auth token)

**Discovery context.** Phase B-S33.B.5 production verification after `e8966ba` deployed sandbox endpoint routing. Expected outcome: pin creation succeeds against sandbox endpoint. Actual outcome: pin creation now reaches the sandbox endpoint (proven by error message changing from production-403 to sandbox-401) but the sandbox rejects authentication with `401 Authentication failed`.

**The two-layer Trial-access requirement** wasn't obvious from Pinterest's initial documentation discovered during Phase B-S33.A:

1. **Sandbox endpoint URL** — `https://api-sandbox.pinterest.com` (documented in the production-API 403 error message that motivated `e8966ba`).
2. **Sandbox-specific access token** — generated separately from the OAuth user-auth flow. The OAuth flow run via `pinterest-auth.mjs` generates a **production** token (it authenticates against the production OAuth server at `pinterest.com/oauth/...` and exchanges via the production token endpoint at `api.pinterest.com/v5/oauth/token`). The token works against production but not against sandbox.

This was discovered via Pinterest community forum + Medium documentation searches after the 401, not from Pinterest's official API docs which were silent on the dual-token requirement.

**Sub-pattern:** Platform documentation incomplete on tier-specific authentication. Trial access vs Standard access isn't just an endpoint switch — it's a **token-generation-flow switch too.** The Pinterest Developer dashboard likely has a "Generate Test Token" button or equivalent sandbox-token-issuance mechanism that wasn't part of the OAuth flow the auth script implemented.

**Mitigation paths (ranked):**

1. **Retrieve sandbox token from Pinterest Developer dashboard** — Session 35 work. Pinterest's UI for the "Scoopfeeds Autoposter" app should expose a test-token generator alongside or distinct from the OAuth flow.
2. **Skip sandbox entirely — apply for Standard access.** Standard access removes the sandbox requirement; production endpoint + production token = working. The application requires a demo video showing the Pinterest integration working (catch-22: needs sandbox to work first to record demo). Path 2 is what eventually lands; Path 1 unblocks the path-2 demo recording.
3. **Defer Pinterest to Phase C and ship other Distribution surfaces first.** Acceptable but un-needed given Path 1 is a small unblock.

**Phase B Track 1 followup work added:**

- Sandbox token retrieval via Pinterest Developer dashboard (Session 35 work — Phase B Track 1 distribution; ~30 min if dashboard UX is clear, longer if Pinterest's dashboard requires support contact).
- Post-sandbox-token-works: record demo video + apply for Standard access. DrJ executes; not code work.
- Post-Standard-access-granted: unset `PINTEREST_API_BASE_URL` in Hostinger env to revert to production routing. `e8966ba` already supports this (env-driven default).

**Refs:**

- Phase B-S33.B.3 verification (production endpoint 403 — original Trial-access discovery)
- Phase B-S33.B.5 verification (sandbox endpoint 401 — sandbox-token-discovery surfaced here)
- `backend/scripts/pinterest-auth.mjs` (OAuth user-auth flow — generates production token)
- Commit `e8966ba` (sandbox endpoint routing — works as designed; orthogonal to token issue)
- Pinterest community + Medium documentation (external sources that surfaced the dual-token requirement; not in official API docs at investigation time)

### Finding #93 — Production HTTP 503 during admin token rotation; resolved by second restart; root cause undiagnosed due to no Hostinger log access

**Discovery context.** Phase B-S33 admin token rotation. Late afternoon UTC May 18.

**Incident timeline:**

1. Admin token rotated in Hostinger production env (security hygiene response after previous admin token accidentally leaked into conversation).
2. Pinterest sandbox env var added in same env-edit batch (`PINTEREST_API_BASE_URL=https://api-sandbox.pinterest.com`).
3. Restart triggered via Hostinger control panel.
4. Production returned HTTP 503 for approximately 5–10 minutes.
5. Second restart executed.
6. Production recovered: HTTP 200, fresh low uptime confirming new process, sourceCount and article counts preserved post-recovery.

**No data loss.** Migrations 002 + 003 stayed applied; article ingestion resumed cleanly; admin token rotation did not lose any persistent state.

**Root cause undetermined.** Hostinger logs were not accessible to DrJ during incident. Three plausible causes (ranked by likelihood):

1. **Hostinger save-and-apply race condition.** Env-var changes saved in Hostinger UI but restart triggered before propagation completed → process restarted with mid-update env state → new admin-auth middleware threw on token mismatch → 503 → second restart picked up fully-propagated env → recovery. Most plausible given Hostinger's UI split between "save" and "apply" operations.
2. **First restart didn't actually trigger.** Token rotated in env but the running Node process never received the restart signal → app kept old admin-token state in memory → first user request to admin endpoint failed with token mismatch → 503 → second (real) restart picked up new state. Less likely given the visible restart-button click but possible if Hostinger queued the restart silently.
3. **Transient platform issue.** Hostinger node went briefly unhealthy unrelated to our changes; second restart re-established health on a different node. Lowest probability given timing correlation with our env edit.

**Sub-pattern:** Hostinger platform behavior is opaque to DrJ. Production debugging requires more diagnostic surface area than currently available. The 5–10 minute window of 503 wasn't catastrophic (DrJ was actively monitoring and triggered the second restart promptly) but a future incident at the same diagnostic depth could be much harder to recover from if DrJ isn't actively watching.

**Phase B Track 3 followup candidate (cross-track operational discipline):**

- **Get Hostinger log access** if Hostinger's support tier permits → cheapest fix, leverages existing platform.
- **OR migrate logging to external service** — Sentry / BetterStack / Logtail / equivalent. Backend already has Sentry SDK installed per `package.json` dependencies (`@sentry/node`, `@sentry/profiling-node`) but `SENTRY_DSN` is unset in production. Setting `SENTRY_DSN` and enabling Sentry crash + breadcrumb capture would have made finding #93's root cause traceable. ~30 min config + Sentry dashboard signup.

**Recommendation:** Sentry path. Sentry is already wired up in code; just unset in env. The cost is one Sentry-account-setup session.

**Mitigation pattern for now (no Sentry yet) — second-restart-confirmation:**

- Push env var change to Hostinger.
- Trigger restart.
- Verify `/api/health` shows fresh low uptime (< 60s).
- If uptime didn't refresh on the first attempt → restart again.
- Treat HTTP 503 as expected-during-env-transition (≤ 5 min) rather than as outage signal until two restarts have occurred.

This is operational discipline going forward — no code change required.

**Refs:**

- Phase B-S33.B.4.3 operational step (admin token rotation + sandbox env var deploy that triggered 503)
- `package.json` dependencies (Sentry SDK already present; just unconfigured in production env)
- Phase B Kickoff Brief §10.7 (Phase A close-out audit deferrals — production observability is implicitly an inherited gap, now made explicit by #93)
- Sentry config in `backend/src/config/observability.js` (if present — Sentry initialization wiring is already in code; finding #93's remediation is config-only)

---

### Session 4 — May 19, 2026 — Three-session day: Pinterest sandbox token retrieved + Sprint 2.x.1 shipped + Pinterest Standard access deferred

**Type:** Three Phase B sessions in one calendar day per DrJ 3×2h structure (extended to ~6–6.5h total). Sessions 34, 35, 36. This Session 4 entry captures the day's chronology, Sprint 2.x.1 retrospective, Pinterest deferral decision, and finding #94 candidate evaluation.

**Output across three sessions:**

- **Session 34 — Phase B Session 3 institutional capture** (commit `0a7df19`). Three findings #91/#92/#93 + Sprint 2.x scope plan + Pace Tracker Session 3 entry. Locked the prior day's Pinterest sandbox integration + 503 incident + X-Posting Queue scoping into institutional memory. ~1.5h.
- **Session 35 — Pinterest sandbox token end-to-end.** Sandbox token retrieved from Pinterest Developer dashboard, deployed to Hostinger production env, verified end-to-end via dry-run + cadence-blocked-confirmed pin creation. First Scoopfeeds Pinterest pin (Sony headphones tech article) live in business Pinterest account on Main board. Trial-mode visibility (account-only, not public audience). ~1.5–2h. No commits this session (configuration + verification work, no code change).
- **Session 36 Track A — Sprint 2.x.1 X-Posting Queue foundation** (commit `95189fe`). Migration 004 + `xPostGenerator.js` + scheduler hook + 4 DAO functions. Existing `composeX` from `socialComposer.js` reused for single-post path; thread composition (250-char threshold, max 4 parts, sentence-boundary splits, ellipsis on mid-clause truncation) net-new. Tests verified.
- **Session 36 Track B — Pinterest Standard access demo script** (commit `b04a3dc`). Demo script written and committed; recording + Standard access application submission deferred indefinitely. Pinterest auto-cycle disabled in production after recording deferral decision.

**Commits this day:** 3 — `0a7df19`, `95189fe`, `b04a3dc`.

**Sprint trajectory at day close:**

- Sprint 2.x.1 (X-Posting Queue foundation): **COMPLETE** (shipped commit `95189fe`)
- Sprint 2.x.2 (email digest delivery): pending next session
- Sprint 2.x.3 (mark-as-posted workflow): pending after 2.x.2
- Sprint 2.x.1b (X queue from analytical posts): pending analytical post investigation
- Sprint 1.1 (Tracker templates): plan-only, awaiting execution
- Sprint 1.2–1.5 (Tracker Engine sub-sprints): plan-only
- Sprint 0 (Cache-Control immutable, Track 3): plan-only

**Pinterest state at day close:**

| Surface | State |
|---|---|
| Code | Shipped and complete (`pinterestClient.js` + `pinterest-auth.mjs` + `socialPublisher` adapter + Migration 003 all in place) |
| Production env | `PINTEREST_ACCESS_TOKEN` **deleted** (auto-cycle disabled) |
| Auto-cycle behavior | Skips Pinterest; adapter reports `not_configured` via `/scoop-ops/auto-status` |
| Sandbox token | Saved in DrJ password manager for future re-enable |
| Standard access application | Deferred indefinitely per "Trial pin visibility insufficient for audience reach" |
| Demo video | Script committed (`b04a3dc`); recording deferred indefinitely |
| Re-enable path | ~2 min — Hostinger token restore + restart, no code work |

**DrJ decisions captured this day:**

- Path α confirmed for X distribution; Sprint 2.x.1 shipped this day per that plan.
- Path C-Full attempted for Pinterest Standard access (disable-record-enable-rotate-submit); pivoted at the recording phase to "skip Standard access for now."
- Pinterest auto-cycle disabled given Trial-mode visibility is account-only (no public audience reach).
- Sprint 2.x.2 (email digest) deferred to next session.
- Phase B Session 4 institutional capture taken immediately at day close (this session).

**Time accounting:**

| Session | Approx. hours | Output |
|---|---|---|
| 34 | ~1.5h | Phase B Session 3 institutional capture |
| 35 | ~1.5–2h | Pinterest sandbox token end-to-end (live pin) |
| 36 | ~3h | Sprint 2.x.1 + Pinterest demo script + production state cleanup |
| **Total** | **~6–6.5h** | 3 commits + Pinterest operationalization-then-deferral |

Initially planned 3×2h (=6h) per DrJ structure; extended modestly per DrJ confirm. Within the "open-ended" willingness window.

**Production state at Session 4 open:**

- `status`: ok
- Articles: **27097**
- Source count: **110**
- Uptime: 179s (fresh restart visible at health check, ~3 min before Session 4 began)
- Migrations applied: 001 + 002 + 003 + 004 (Sprint 2.x.1's Migration 004 auto-applied on Hostinger restart)
- Social platforms enabled: bluesky, threads, facebook (Pinterest disabled per Session 36 Track B close; Instagram still failing per Session 33 pattern)

**Phase B retrospective findings count:** 4 (`#90`, `#91`, `#92`, `#93`) at start of day → **4 at end** (finding #94 candidate evaluated below and declined).

**Brief inaccuracy count:** 11 of 12 (unchanged this day; no new Brief-codebase-state errors surfaced).

**Three-track contribution this day:**

- **Track 1 (Phase B execution):** Heavy contribution. Sprint 2.x.1 shipped end-to-end. Pinterest sandbox operationalized (first live pin) then strategically disabled. Demo script written and deferred.
- **Track 2 (Phase A close-out followups):** No contribution this day. Status unchanged from session 30.
- **Track 3 (infrastructure performance per Brief §5.1):** No contribution this day. Sprint 0 (Cache-Control immutable) untouched. Per softened Track 3 framing per Session 34: timing remains DrJ judgment; Track 3 lapse since Phase B start is growing but not at a critical threshold yet.

**Known followup work added/refreshed this day:**

- **Sprint 2.x.2 (email digest delivery)** — next-session candidate, ~1 session.
- **Sprint 2.x.3 (mark-as-posted workflow)** — after 2.x.2.
- **Sprint 2.x.1b (X queue from analytical posts)** — pending analytical-post investigation, ~1–1.5 sessions.
- **Frontend bug (analytical posts cannot be opened)** — pending investigation, Phase B Track 1.
- **Pinterest Standard access demo video recording + application** — deferred indefinitely; revisit when Pinterest distribution priority changes.
- **Finding #94 candidate (Pinterest sandbox intermittent auth)** — evaluated and declined as new finding (see below); captured as Session 4 observation.
- **Sentry configuration (~30 min)** — Phase B Track 1/3 candidate per finding #93 cheap-mitigation path.
- **Instagram failure rate diagnosis** (77+ failures/24h pattern) — Phase B Track 1.
- **`.env\r` cruft housekeeping** — Phase B Track 3 followup.

**Next-session candidates:**

1. **Phase B Sprint 2.x.2 — Email digest delivery** (~1 session). Completes X-Posting Queue end-to-end. Renders pending posts to email digest delivered daily.
2. **Phase B Sprint 1.1.1 — Tracker template library start** (conflict + outbreak templates). M scope, 2–3 sessions for full library.
3. **Sentry configuration (~30 min)** — cheap finding #93 mitigation. Could fold into any session.
4. **Track 3 Sprint 0 — Cache-Control immutable hygiene** (1 session per Brief §5.1). DrJ judgment on timing.
5. **Instagram failure diagnosis** — Phase B Track 1 followup.

#### Finding #94 candidate evaluation — declined as new finding

**Pattern observed this day:** 60 failures + 1 success per 24h on Pinterest sandbox endpoint with sandbox-specific token. Failures all `401 Authentication failed`. Pattern surfaced when Pinterest auto-cycle was running with sandbox token deployed (Session 35 close → Session 36 Track B close).

**Honest read:** This is **Pinterest sandbox behavior**, not a distinct Scoopfeeds finding. Per Pinterest developer community reports and Medium documentation, the sandbox endpoint is known to be less reliable than the production endpoint. The intermittent 401s are environmental, not bugs in `pinterestClient.js` and not misconfiguration in our setup. The single successful pin per 24h (Sony headphones article, Session 35) confirms the token and request shape are valid; intermittency is on Pinterest's side.

**Why not a new finding:**

- **Not a code/Brief premise error** (no Brief or codebase claim contradicted) → not the `#87`/`#88`/`#91` pattern shape.
- **Not a verification-discipline failure** (no premature "shipped/verified" claim contradicted by reality) → not the `#89`/`#90` pattern shape.
- **Not a production incident pattern** (no Scoopfeeds outage; pin creation simply rate-limited by sandbox) → not the `#93` pattern shape.
- **Is environmental Pinterest sandbox behavior**, observable but not actionable for Scoopfeeds work without Standard access.

**Disposition:** Captured as Session 4 observation. If/when Pinterest Standard access becomes priority and intermittent 401s **persist against the production endpoint**, that would be a real finding `#94`. For now: observation only.

**Phase B findings count stays at 4 (`#90`/`#91`/`#92`/`#93`). Brief inaccuracy stays at 11 of 12.**

#### Sprint 2.x.1 — X-Posting Queue foundation (retrospective)

**Shipped:** Commit `95189fe` (5 files, +402 / −1 lines).

**Scope per Sprint 2.x plan (locked in Session 34 institutional capture):**

- **Migration 004:** `x_post_queue` table with `article_id` FK (CASCADE on delete), `post_text`, `post_type`, thread metadata, `status`, timestamps, 4 indexes.
- **`xPostGenerator.js`:** `shouldThread()` length-only threshold (>250 chars), `composeThread()` with sentence-boundary splits + ellipsis on mid-clause truncation + max 4 parts, `composeSingle()` delegating to existing `socialComposer.composeX`.
- **Scheduler hook:** `runXQueueGenerationCycle()` called after `runAllPlatformsCycle` in `runIngestionCycle`, graceful try/catch.
- **4 DAO functions:** `findArticlesPendingXQueue`, `enqueueXPosts`, `countPendingXPosts`, `listPendingXPosts` (the last is a bonus for Sprint 2.x.2).

**Scope corrections during Sprint 2.x.1:**

- `composeX` from `socialComposer.js` already existed: reused for the single-post path (saved ~15–20 min). Folded into commit body; not a new finding (#91 sub-pattern of pre-existing implementation already documented).
- Thread threshold refined from "description > 200 chars AND credibility ≥ 8" to "description > 250 chars" (length-only). The AND condition was too restrictive; the credibility filter is applied upstream.
- Mid-clause truncation gets ellipsis (U+2026) for reader signal; sentence-boundary truncation does not.

**Test coverage:** Migration applied cleanly. 4 sample articles (short, medium, long, duplicate-flagged): single-vs-thread logic correctly routed; long article produced a 4-part thread; final thread part had ellipsis + URL within the 280-char cap. Dedup via LEFT JOIN against `x_post_queue` verified. Cascade delete from `articles` → `x_post_queue` verified.

**Production state:** Migration 004 auto-applied on next Hostinger restart (production restart happened ~25 min before Session 34 began per Session 34's health check). Queue should be filling with pending posts as auto-cycle fires every ~30 min.

**Out of scope (Sprint 2.x.2 + 2.x.3 work):**

- Email digest delivery (Sprint 2.x.2)
- Admin endpoint to view queue
- Mark-as-posted workflow (Sprint 2.x.3)
- Analytical posts as queue source (Sprint 2.x.1b)

**Architectural decision recorded:** X-Posting Queue uses a dedicated tracking surface (`status` column on the queue table) rather than the shared `social_posts` table. `social_posts` gets populated only at actual X delivery (Sprint 2.x.3 mark-as-posted endpoint). Clean separation: queue tracks **generation** lifecycle, `social_posts` tracks **delivery** lifecycle.

**Refs:**

- Sprint 2.x scope plan in Session 3 entry (Session 34 institutional capture; commit `0a7df19`)
- Commit `95189fe` (the implementation itself)
- `xPostGenerator.js` (net-new module)
- Migration `backend/src/db/migrations/004_x_post_queue.js` (auto-applied on production restart)
- `socialComposer.composeX` (pre-existing; reused for single-post path)

#### Session 4 references

- Day's commits: `0a7df19` (Session 34), `95189fe` (Session 36 Track A), `b04a3dc` (Session 36 Track B)
- Session 3 entry above (this file, line 299) — provides yesterday's narrative that Session 35 builds on
- Sprint 2.x scope plan (this file, in Session 3 entry "X-Posting Queue scope plan" subsection)
- `docs/audits/pinterest_standard_access_demo_script.md` (committed `b04a3dc`)
- Pinterest auto-cycle disable: Hostinger production env (`PINTEREST_ACCESS_TOKEN` removed at Session 36 close)
- Production health endpoint: `/api/health` (verified Session 4 open: status ok, 27097 articles, 110 sources)

### Session 5 — May 21–26, 2026 — Sprint 2.x completion + curation + Tracker Engine begins

**Type:** Consolidated capture covering a multi-calendar-day arc. Sprint 2.x.2 (digest delivery) and 2.x.2b (curation) shipped on May 21–22; Sprint 1.1.1 (first two Tracker templates) shipped May 26 after a deliberate critical-path pivot. Four commits, two new findings, one validated end-to-end workflow.

**Output across the arc:**

- **Sprint 2.x.2 — Email digest delivery shipped** (commit `2a1ab1a`, May 21). `xPostDigest.js` (renderer + sender), `/scoop-ops/x-digest/*` admin routes (`status`, `preview`, `send-now`), 09:00 UTC daily cron, recipient `info.scoopfeeds@gmail.com`. Completes the queue→inbox half of Path α (free X distribution; manual paste step preserves $0 cost).
- **Analytics endpoint shipped** (commit `a6a3857`, May 21). `/scoop-ops/x-digest/analytics` exposed status breakdown, post-type split, distinct-article count, age buckets, credibility distribution, per-day enqueue rate. Surfaced the volume problem within hours.
- **Volume discovery via analytics:** 2,241 pending rows; **all at credibility 9–10**; ~700 articles/day across 110 sources producing ~1,000 queue rows/day (thread multiplication). The credibility threshold — the assumed curation lever — was a no-op because the ingestion pipeline already filters hard on credibility upstream. The problem was volume of *good* content, not noise.
- **Sprint 2.x.2b — Curation shipped** (commit `06b6fa3`, May 22). Article-level recency cap (top-15 by `published_at`), dry-run-safe `clear-backlog` admin endpoint, daily 02:00 UTC stale sweep rejecting `pending` > 24h. Backlog cleared (~2,069 rows rejected, plus an earlier ~200 rows effectively cleared by the deploy-gap incident below).
- **Workflow validated end-to-end (headline win):** DrJ received a curated digest in inbox, manually posted to `@scoop_feeds`. The full chain — queue → curate → digest → inbox → manual post → X audience — works in production autonomously: 09:00 UTC delivery + 02:00 UTC sweep self-maintaining, $0 recurring cost, zero X API dependency.
- **Sprint 1.1.1 — First Tracker templates shipped** (commit `faddf16`, May 26). `conflict.md` (ACLED / Reuters Graphics / UN OCHA-grounded) and `outbreak.md` (WHO surveillance / DON / ProMED-grounded). Pure markdown design specs — schema follows Sprint 1.2, derived from these. Shared 7-section structure (purpose+trigger, metrics, sources, cadence, display, validation, open-questions) reusable for the remaining 6 templates.

**Commits this arc:** 4 — `2a1ab1a`, `a6a3857`, `06b6fa3`, `faddf16`.

**Sprint trajectory at arc close:**

- Sprint 2.x.1 (X-Posting Queue foundation): COMPLETE (prior arc)
- Sprint 2.x.2 (email digest delivery): **COMPLETE** (commit `2a1ab1a`)
- Sprint 2.x.2b (curation correction): **COMPLETE** (commit `06b6fa3`)
- Sprint 2.x.3 (mark-as-posted workflow): pending; completes Sprint 2.x trilogy
- Sprint 2.x.1b (X queue from analytical posts): pending analytical-post investigation; DrJ-flagged twice
- Sprint 1.1.1 (first 2 Tracker templates): **COMPLETE** (commit `faddf16`)
- Sprint 1.1.2 (template pattern review): effectively folded into DrJ's MPH review of `outbreak.md` this arc
- Sprint 1.1.3 (remaining 6 templates: incident, sports, environmental, election, study, entertainment): pending; ~1–2 sessions
- Sprint 1.2–1.5 (Tracker schema, detection mechanism, scheduler, frontend): plan-only
- Sprint 0 (Cache-Control immutable, Track 3): plan-only

**Operational notes (one-liners):**

- **Deploy-gap incident:** a `send-now` fired old code during a Hostinger deploy lag, sending a 200-post email + marking 200 rows `sent_in_digest`. Harmless (those 200 effectively cleared). Root pattern: Hostinger deploy lag means new routes 404 until pull+restart — bit the project 3× this arc.
- **Auth-header drift:** Claude Code repeatedly drafted run-curls with `x-admin-token`; correct header is `Authorization: Bearer`. Corrected each time; not yet a calcified habit warranting a finding.
- **SSH to Hostinger blocked:** connection drops after password prompt even with correct port 65002 / username `u503692993` (SSH password likely never set). Worked around entirely via admin endpoints — which is the better tool anyway.
- **`gh` CLI auth expired** (PR-status only). `git push` via SSH unaffected; non-blocking.

#### Finding #95 — Volume-curation design miss

**Pattern:** Sprint 2.x assumed "handful of posts/day." Reality: ~700 articles/day at credibility 9–10 across 110 sources, ~1,000 queue rows/day after thread multiplication. The credibility threshold — the planned curation lever — was useless because the ingestion pipeline already hard-filters on credibility upstream; essentially everything entering the queue is 9–10.

**Resolution:** Curation pivoted from quality-based (raise threshold) to recency+cap based (top-15 by recency + daily stale-sweep). Shipped as Sprint 2.x.2b commit `06b6fa3`.

**Lesson:** When a pipeline already filters on a variable upstream, downstream curation using that *same* variable is a no-op. Verify the **distribution** of your filter variable before designing curation around it. Cost: shipped 2.x.1 + 2.x.2 on the wrong assumption, needed 2.x.2b to correct.

**Cumulative findings:** `#95` is added; brought count from 4 (`#90`–`#93`) to 5.

#### Finding #96 — Track imbalance / dark-track rule violation

**Pattern:** Phase B's first 5 sessions went entirely to Distribution (Sprint 2.x). Track 2 (scoring service / critical path to 150 sources) and Track 3 (perf infrastructure) both received zero contribution. Brief §2.5 (no track > 4 consecutive sessions without contribution) was therefore **violated for both** Track 2 and Track 3 at the close of Session 4 and remained violated through Session 5's first three commits. The headline capability (Tracker Auto-Detection Engine) also remained at 0% until the Sprint 1.1.1 pivot mid-arc.

**Mechanism:** Visible, satisfying, fast-feedback work (a digest you can see in your inbox) crowded out slower critical-path work (intelligence layer; perf foundations). The pull toward visible wins is strong and silent — there was no explicit decision to defer Tracks 2/3, just a series of locally-rational "ship the digest first" calls that compounded.

**Resolution:** Corrected partially this arc by pivoting to Sprint 1.1.1 (Tracker templates — Track 1, but the *headline capability* part of Track 1, not the distribution part). Track 2 and Track 3 dark-track violation remain open.

**Lesson:** Track-balance discipline needs *active* enforcement. The no-dark-track rule is not self-enforcing — at minimum, every session-close should explicitly check track contributions over the trailing window, not rely on the next-session candidate list to surface it.

**Note:** This is a *process-discipline* finding, distinct in kind from the codebase/Brief-premise findings `#87`–`#95`. Captured here because the pattern is now twice-observed (Phase A had a related pattern around Sprint 5/6 quality-vs-shipping tension) and worth naming.

**Cumulative findings:** `#96` is added; count is now 6 (`#90`–`#93`, `#95`, `#96`).

#### Sprint 1.1.1 — Tracker templates (retrospective)

**Shipped:** Commit `faddf16` (2 files, +450 lines).

**Scope:**

- `conflict.md` (180 lines) — casualties (killed/wounded/missing), displacement, event count, geographic scope, escalation. Confidence vocabulary `provisional` / `disputed` / `confirmed`. Disputed party-figures shown side-by-side, never averaged.
- `outbreak.md` (270 lines) — WHO-aligned `suspected` / `probable` / `confirmed` as *distinct case counts*, not three views of one figure. Layer 1 deliberately surfaces confirmed-only as headline (conservative against early-outbreak suspected-count inflation).

**DrJ (MPH) review produced three epidemiological decisions:**

1. **CFR is relay-only** (never Scoopfeeds-computed). Live `deaths÷confirmed` is structurally misleading. Display only when an official body has published a CFR estimate, as an attributed relay. Schema implication for Sprint 1.2: CFR is an attributed-relayed field, not a derived field.
2. **Rₜ / R₀ is relay-only** (official sources only). Modeling preprints not relayed regardless of plausibility. One of the most-misread epidemiological figures.
3. **Testing / surveillance intensity** added as Layer-2 metric. Rationale: confirmed-case counts are uninterpretable without a testing denominator. Explicitly excluded from Layer 1 cards (figure requires context; headline real-estate hostile to caveats).

**Confidence model (Option 3, DrJ decision):** headline figure + confidence flag + source attribution. Mirrors how Reuters Graphics and WHO actually present uncertain data; rejected the alternatives of (a) single-number-with-error-bar (loses provenance), (b) single-number-no-flag (loses uncertainty signal), (c) range-only (loses headline anchor).

**Sprint 1.1.2 status:** Pattern review effectively folded into DrJ's review this session — the conflict / outbreak pair stress-tested the 7-section structure under two very different epistemic regimes (party-disputed event counts vs WHO-classified case counts). No structural changes needed.

**Out of scope (Sprint 1.1.3 and onward):**

- Remaining 6 templates (incident, sports, environmental, election, study, entertainment) — Sprint 1.1.3.
- Schema derivation from the template set — Sprint 1.2.
- Auto-detection mechanism + `eventTracker.js` rename per finding `#90` — Sprint 1.3.
- Scheduler wiring — Sprint 1.4.
- Frontend display (Layer 1 cards + Layer 2 pages) — Sprint 1.5.

**Phase B retrospective findings count:** 4 (`#90`–`#93`) at arc start → **6 at arc close** (`#95`, `#96` added).

**Brief inaccuracy count:** unchanged at 11 of 12.

**Three-track contribution this arc:**

- **Track 1 (Phase B execution):** Heavy contribution. Sprint 2.x.2 + 2.x.2b distribution shipped, Sprint 1.1.1 tracker templates shipped (both Track 1 — distribution and headline capability respectively).
- **Track 2 (Phase A close-out followups):** **Zero** — dark-track violation, per finding `#96`.
- **Track 3 (infrastructure performance per Brief §5.1):** **Zero** — dark-track violation, per finding `#96`. Sprint 0 (Cache-Control immutable) untouched since Phase B start.

**Known followup work added/refreshed this arc:**

- **Sprint 1.1.3** — remaining 6 tracker templates; finishes Sprint 1.1; ~1–2 sessions.
- **Sprint 2.x.3** — mark-as-posted workflow; completes Sprint 2.x trilogy.
- **Sprint 2.x.1b** — analytical-section posts as queue source; DrJ-flagged twice; pending analytical-post investigation.
- **Frontend bug** — analytical posts cannot be opened to reveal full analysis; Phase B Track 1.
- **Sentry configuration (~30 min)** — cheap finding `#93` mitigation; foldable into any session.
- **Track 3 Sprint 0** — Cache-Control immutable (1 session); now part of breaking dark-track violation per `#96`.
- **Instagram failure rate diagnosis** — long-standing ~77 fails/24h pattern; Phase B Track 1.
- **Sprint 1.2** — tracker schema; gated on Sprint 1.1.3 template-set completion.
- **`.env\r` cruft housekeeping** — Phase B Track 3 followup; still deferred.

**Next-session candidates (priority order):**

1. **Sprint 1.1.3** — remaining 6 tracker templates (incident, sports, environmental, election, study, entertainment); finishes Sprint 1.1; ~1–2 sessions.
2. **Break the Track 2/3 dark-track violation:** Sentry config (~30 min, Track 1/3, finding `#93` mitigation) and/or Track 3 Sprint 0 Cache-Control (1 session). Direct response to finding `#96`.
3. **Sprint 2.x.3** — mark-as-posted workflow; completes Sprint 2.x trilogy.
4. **Sprint 2.x.1b** — analytical-section posts as queue source (DrJ flagged twice).
5. **Instagram failure diagnosis** (long-standing ~77 fails/24h).
6. **Sprint 1.2** — tracker schema (after Sprint 1.1.3 template-set complete).

#### Session 5 references

- Arc commits: `2a1ab1a` (Sprint 2.x.2), `a6a3857` (analytics), `06b6fa3` (Sprint 2.x.2b), `faddf16` (Sprint 1.1.1)
- Session 4 entry above (this file, line 620) — provides the Sprint 2.x.1 foundation that Sprint 2.x.2 / 2.x.2b extend
- Sprint 2.x scope plan (Session 3 entry, "X-Posting Queue scope plan" subsection)
- `backend/src/services/xPostDigest.js` (Sprint 2.x.2)
- `backend/src/routes/x-digest-ops.js` (admin routes incl. analytics + curation)
- `docs/content/tracker_templates/conflict.md` and `outbreak.md` (Sprint 1.1.1 deliverables)
- Curation backlog clear: ~2,069 rows rejected via `/scoop-ops/x-digest/clear-backlog?confirm=1`
