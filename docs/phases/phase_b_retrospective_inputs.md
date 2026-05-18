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

---

*Phase B Retrospective Inputs document — institutional memory journal for Phase B sessions. Phase B opens 2026-05-18.*
