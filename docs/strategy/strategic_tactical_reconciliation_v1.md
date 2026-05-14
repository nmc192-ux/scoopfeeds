# Scoopfeeds Strategic-Tactical Reconciliation v1.0
## Resolving the Three-Way Phase B Definition Drift

**Document type:** Strategic reconciliation
**Version:** 1.0
**Owner:** DrJ (Founder)
**Date:** 2026-05-15 (Session 22)
**Companion documents:**
- Strategic Plan v6.0 (`docs/strategy/strategic_plan_v6.md`)
- Skills Architecture v1.0 (`docs/strategy/skills_architecture_v1.md`)
- Decisions Log v1.0 (`docs/strategy/decisions_log_v1.md`)
- Execution Method v1.0 (`docs/execution/execution_method_v1.md`)
- Phase A Kickoff Brief (`docs/phases/phase_a_kickoff_brief.md`)
- Phase A Retrospective Inputs (`docs/phases/phase_a_retrospective_inputs.md`) — findings #56, #74, #75, #76, #77 are direct inputs
- Comparative Analysis v1.0 (`docs/research/comparative_analysis_v1.md`)
**Status:** Decisions final unless review triggers fire

---

## 0. Purpose

This document records the resolution of a strategic-tactical drift
that surfaced during session 21 phase 2's Phase A exit audit. The
drift is between three documents in active use that defined Phase B
with non-overlapping scope. Without an explicit reconciliation,
Phase B execution would have been one of three things — depending
on which document the executing operator happened to consult.

This document establishes which definition is authoritative, how
the other definitions are positioned, and what Phase B looks like
under the reconciled framework.

The decisions are final unless documented review triggers fire.

---

## 1. Background — What Triggered This Document

### 1.1 The sequence of events

**Session 21 phase 1 (2026-05-13):** Comparative analysis of
Yahoo News, Bloomberg, X, Apple News produced findings #70-#74 and
recommendations for "Phase B opening sequence" — 5 specific
infrastructure items (Cache-Control immutable, CDN edge, SSR
for hot routes, SWR pattern, s-maxage+SWR headers). Recommendations
positioned as Phase B work without checking against Strategic Plan
v6's Phase B definition.

**Session 21 phase 2 (2026-05-13):** Before approving Sprint 0
(Cache-Control immutable as a 1-session quick win), DrJ paused
and asked *"is this plan in line with the strategic plan?"*

That question triggered a formal Phase A exit criteria audit (per
finding #75) and surfaced that **four** documents defined Phase B
with non-overlapping scope (finding #76). DrJ chose Path 2: stop
session 21 cleanly, defer the reconciliation to a dedicated
session with overnight reflection.

**Session 22 phase 22.A (2026-05-15):** Re-read all source
documents. Reduced the framing from "four-way drift" to "three-way
drift" — finding #56's R1-R4 redesign track and session 21's
Sprint 0-6 opening sequence are the same infrastructure track at
two specificity levels, not two independent definitions.

Three remaining definitions:
1. Strategic Plan v6 Phase B (product features)
2. Skills Architecture v1 Phase B (codebase reorganization)
3. Infrastructure track (Finding #56 R1-R4 + Session 21 Sprint 0-6)

**Session 22 phases 22.B, 22.C, 22.D:** Three decision points
made by DrJ — recorded in §§5-7 below.

### 1.2 Why the drift mattered

The drift was not minor tactical noise. Two of the three
definitions are strategic-tier documents:

- **Strategic Plan v6** is the north-star vision document
  (1,026 lines, May 2026).
- **Skills Architecture v1** is also strategic-tier (382 lines,
  authored session 13).

Both purport to define Phase B. Each version of Phase B has
different exit criteria, different effort estimates, different
sequencing, and different success metrics. The third definition
(infrastructure track) is tactical-tier but explicitly positioned
itself in Phase B scope ("Phase B opening sequence," "Phase B
redesign track threaded through B.1").

Without reconciliation, Phase B execution would proceed against
whichever definition the executing session happened to consult.
The audit risk was 10-13 sessions of infrastructure work that
the strategic plan's Phase B exit criteria do not credit toward
phase exit.

### 1.3 What this document is NOT

- **Not a re-litigation of Strategic Plan v6.** The strategic
  plan remains the authoritative source of long-term direction.
- **Not a deprecation of Skills Architecture v1.** That document
  remains in the repo and carries forward as Phase B architecture
  track guidance.
- **Not a re-design of Phase B.** Phase B's overall purpose
  (launch Layer 1 with comprehension layer, distribution, internal
  Scoop) is unchanged.
- **Not an engineering implementation plan.** Layer 4 (issues +
  JIT prompts) happens at execution time, not in this document.

This document is *only* the reconciliation: which definitions
apply, how they relate, what Phase B looks like as the union of
the three documents' valid contributions.

---

## 2. The Three Definitions (Pre-Reconciliation)

### 2.1 Strategic Plan v6 Phase B

**Source:** `docs/strategy/strategic_plan_v6.md` lines 526-587.

**Phase B title:** "Launch Layer 1 with Comprehension + Distribution + Internal Scoop (Months 1-3)"

**Strategic goal:** *"Layer 1 launches as a coherent product with the comprehension layer (trackers, infographics, perspectives, video, breaking news), upgraded social distribution, internal Scoop search, and Entertainment baked in from day one."*

**Work areas (six):**
- *Comprehension layer:* Mobile-first homepage redesign, Mobile-first Event Dossier, **Tracker Auto-Detection Engine v1** with 8 signal types, first trackers across 8 categories, Op-ed aggregation MVP, Video clip integration, Breaking news engine v1
- *Source matrix:* Source onboarding workflow, expansion to ≥150 active sources, source quality scoring infrastructure, AI translation pipeline (Urdu)
- *Distribution:* **Social Media Engine v2** (existing FB/IG/Bluesky upgrade + new X + LinkedIn), per-platform content templates, UTM tagging, three newsletter products (Daily Brief, Regional Brief, Topic Briefs), **Alert engine v1** (web push + email + Telegram)
- *Search:* **Internal Scoop search upgrade** (entity-aware, semantic, credibility-weighted), Brave Search API preview, Scoop portal page v1
- *Entertainment:* Entertainment topic page, Box office tracker, Streaming charts page, Critical reception aggregator, Regional entertainment landing pages
- *Foundation:* Accessibility audit + WCAG 2.1 AA, brand refresh (per Decision 9), SEO + structured data, **First 5 BullMQ migrations from Claude Code plan**

**Exit criteria (entirely product/metric-oriented):**
- Homepage above the fold = intelligence + comprehension content only
- Mobile Lighthouse ≥90
- Tracker Auto-Detection Engine operational with ≥10 active trackers
- Breaking news alerts live across web push + email + Telegram
- Op-ed perspectives on ≥80% of major events
- Video clips on ≥60% of major events
- 3 newsletter products with ≥30% open rates
- ≥150 active sources with quality scores
- Combined social followers ≥10,000 across X, LinkedIn, Instagram
- ≥3% engagement rate average on social
- ≥10,000 search queries/month on Scoop
- Scoop returns dossiers/trackers as top results for ≥60% of category-relevant queries
- Returning user rate ≥25%
- Telegram channel subscribers ≥5,000

**What is NOT in Strategic Plan v6 Phase B:**
- Codebase reorganization by skill
- Skill contract documentation
- Linter boundaries between skills
- Skill isolation POCs
- Edge caching layer (CDN)
- Server-side rendering for hot routes
- Cache-Control header changes on hashed assets
- Stale-while-revalidate pattern adoption

### 2.2 Skills Architecture v1 Phase B

**Source:** `docs/strategy/skills_architecture_v1.md` (entire document, 382 lines).

**Self-described scope (header line 6):** *"Phase B+ architectural direction"*

**Document hedges (Section 1):**
- *"This document defines the direction. It does not commit to engineering work."*
- *"Phase B execution decisions will happen at the time of execution, informed by user behavior data, team size, and operational pain Phase A has surfaced."*

**Section 3 explicit claim:** *"Phase B's first work item is to reorganize the codebase by skill."*

**Section 7 work items (B.1-B.5+):**
- **B.1 Codebase reorganization** (1-2 dedicated sessions, pure refactor; no behavioral change)
- **B.2 Define skill contract documentation** (1 session)
- **B.3 Establish skill boundaries through code review** (linter rules, isolation tests; 1 session)
- **B.4 First skill isolation POC** (image/video pipeline as cleanest existing boundary; 2-3 sessions)
- **B.5+ Other skill formalization** as time and pressure require

**Section 10 — Phase B Kickoff Criteria (binding, per session 22.A reframing):**
1. Phase A wrapped cleanly. All Sprint 0-2 issues closed. Phase A retrospective written. No outstanding production incidents.
2. Strategic clarity on Reality Index.
3. Operational baseline understood (post-Phase-A observability).
4. Time and energy budget realistic.

*"If any of these aren't true, Phase B waits."*

**Section 8 anti-goals (relevant to this reconciliation):**
- *"Don't build the platform before the application."*
- *"Don't physically separate before pain demands it."*
- *"Don't over-specify the skill contract."*
- *"Don't allow cross-skill coupling to creep in."*
- *"Don't build skills you can't maintain."*
- *"Don't pretend skills are decoupled when they aren't."*

**What is NOT in Skills Architecture v1 Phase B:**
- Specific product feature deliverables (Trackers, op-eds, video integration, alerts)
- Source matrix expansion
- Social Media Engine upgrade
- Newsletter products
- Entertainment surfaces

### 2.3 Infrastructure track (Finding #56 R1-R4 + Session 21 Sprint 0-6)

**Sources:** `docs/phases/phase_a_retrospective_inputs.md` finding #56; `docs/research/comparative_analysis_v1.md` §7.

**Origin:** Emerged from session 18's cascade root-cause analysis
(`~30 API calls per page load × 500-req/15min rate limiter = 429
cascade → React #300 crash`) and was refined in session 21 by
comparing Scoopfeeds against Yahoo, Bloomberg, X, Apple News.

**Finding #56 framing (session 18):** *"REDESIGN TRACK (Phase B opening, threaded through B.1 codebase reorganization)"* — already conceptually linked to Skills Architecture v1's B.1.

**Finding #56 work items (R1-R4, broad categories):**
- **R1** API endpoint consolidation (`/api/bootstrap` returns initial state in one call; ~10-15 calls eliminated per page load)
- **R2** Edge caching layer (Cloudflare or equivalent)
- **R3** Stale-while-revalidate everywhere
- **R4** SSR evaluation

**Session 21 comparative analysis §7 sequence (Sprint 0-6, concrete elaboration of R1-R4):**
- **Sprint 0** — `Cache-Control: public, max-age=31536000, immutable` on hashed static assets (1 session, zero risk). Maps to R2.
- **Sprint 1** — Cloudflare edge in front of `scoopfeeds.com` HTML (2-3 sessions). Maps to R2.
- **Sprint 2** — Apply `s-maxage` + `stale-while-revalidate` on HTML routes (1 session, after Sprint 1). Maps to R2 + R3.
- **Sprint 3** — SWR pattern on content API responses, extending c8917d1 persistent cache (2 sessions). Maps to R3.
- **Sprints 4-6** — Full SSR for hot routes (`/`, `/topic/:slug`) via Vite SSR or small Node SSR (4-6 sessions). Maps to R4.

**Total infrastructure track effort estimate:** ~10-13 sessions in dependency order, with verifiable milestones.

**What is NOT in the infrastructure track:**
- Product features
- Skill-by-skill codebase reorganization (though Sprint 0-6 work may touch files that B.1 will reorganize; this needs coordination — see §8 below)
- Source matrix expansion
- Social/newsletter/alert work

### 2.4 Where the three definitions overlap and diverge

**Overlap:**
- Strategic Plan v6 Phase B Foundation lists *"First 5 BullMQ migrations from Claude Code plan"* — this is the **only** infrastructure-flavored work in Strategic Plan v6 Phase B
- BullMQ migrations (5 queues: ingestion, video, enrichment, analysis, realityIndex) map cleanly to 5 skill boundaries in Skills Architecture v1's taxonomy
- BullMQ migrations also support the infrastructure track's failure-isolation goals
- So **BullMQ migrations are a shared concern across all three definitions**

**Divergence — the genuine three-way drift:**

| Concern | Strategic Plan v6 Phase B | Skills Arch v1 Phase B | Infrastructure track |
|---|---|---|---|
| Code organization | Not addressed | **Owned** (B.1) | Not addressed |
| Product features | **Owned** | Anti-goal (Section 8) | Not addressed |
| Performance infrastructure | "First 5 BullMQ migrations" only | Implicit consequence of skill isolation | **Owned** (R1-R4) |
| Failure isolation | Not addressed | Core value (Section 2.3) | Addressed via R3 SWR |
| Apple News / Yahoo pattern reference | Not referenced | Not referenced | **Owned** (entire study) |
| Phase B duration estimate | Months 1-3 | 5-7 sessions (B.1-B.4 alone) | 10-13 sessions |

**Hard conflict:** Each definition's Phase B duration estimate
assumed itself was the entire scope. Combined across all three,
Phase B would not fit "Months 1-3."

---

## 3. Reading Summary: How Each Document Treats Phase B

(Drawn from Phase 22.A re-reading; full read summaries archived in
session 22 conversation transcript.)

### 3.1 Strategic Plan v6's Phase B is exit-criteria-driven

Phase B success in Strategic Plan v6 is measured by user-facing
outcomes: Lighthouse score, active trackers, op-ed perspective
coverage, video coverage, newsletter products, source count,
social followers, search query volume, returning user rate,
Telegram subscribers. **None of these can be achieved by codebase
reorganization alone or by infrastructure work alone.** They
require shipping product features.

This is the most important fact in the reconciliation: Strategic
Plan v6's Phase B mathematically cannot exit without product
feature delivery. So any reconciliation must include Strategic
Plan v6's product track as load-bearing.

### 3.2 Skills Architecture v1's Phase B is structural and self-hedged

The document explicitly anticipated being over-applied. Its
introduction says it does not commit to engineering work. Its
Section 8 anti-goals warn against "building the platform before
the application." Its Section 11 lists open questions that Phase
B was supposed to answer through experience.

The document is a **direction-setter**, not a work plan. Treating
B.1-B.4 as a binding execution sequence would over-read the
document's own self-described scope.

That said, the document's Phase B Kickoff Criteria (Section 10)
is explicit and rule-shaped — it's the one part of Skills
Architecture v1 that reads as binding-on-Phase-B-execution rather
than direction-setting. Per session 22.A reframing, the kickoff
gate (Sprint 2 closed + Phase A retrospective written) is
treated as **binding for any Phase B start**, regardless of
reconciliation outcome.

### 3.3 The infrastructure track is grounded in concrete observation

Finding #56 emerged from a real production cascade. Session 21's
recommendations were grounded in measurable comparison against
four reference platforms. Both have empirical backing that the
strategic-tier documents lack — Strategic Plan v6 articulates
intent, but the infrastructure track diagnosed reality.

The infrastructure track's claim to Phase B scope is therefore
strong even though it's tactical-tier. The reconciliation should
not dismiss it; it should position it.

### 3.4 BullMQ migrations are the bridge

Strategic Plan v6 named "First 5 BullMQ migrations." Skills
Architecture v1's skill boundaries align with the 5 queue
definitions. The infrastructure track's failure-isolation goal
is partially served by job-queue isolation. This is the work
that all three definitions agree exists, just framed differently.

**Status (per session 22.A direct codebase inspection):**
SCAFFOLDED-NOT-MIGRATED. Foundation code on `main` since
commit `e57c3ca`. Production runs `USE_BULLMQ=false`,
`processRole: "web"`. Migrations remain pending.

---

## 4. The Three Decisions

The reconciliation made three decisions, in order. Each
constrained the next.

| Decision | Question | Choice | Section |
|---|---|---|---|
| **DP1** | Authority resolution: how does Strategic Plan v6 Phase B relate to Skills Architecture v1 Phase B? | **β** Parallel tracks | §5 |
| **DP2** | Infrastructure track disposition: how does Finding #56 + Session 21's Sprint 0-6 fit? | **δ** Parallel supporting track (third track) | §6 |
| **DP3** | Sprint 0 (Cache-Control immutable) specific disposition | **a** Track 3's opening sprint, after binding kickoff gate | §7 |

---

## 5. Decision Point 1 — Authority Resolution

### 5.1 The question

How does Strategic Plan v6 Phase B (product features) relate to
Skills Architecture v1 Phase B (codebase reorganization)?

### 5.2 Options presented

- **α** — Strategic Plan v6 authoritative; Skills Architecture v1 demoted to "ongoing technical work parallel to phased roadmap." Highest product velocity; risk: technical debt accumulation.
- **β** — Parallel tracks within Phase B. Both proceed simultaneously with explicit coordination. Extends Phase B duration; risk: coordination overhead.
- **γ** — Skills Architecture v1 supersedes; product features re-mapped to skills. Most disruptive; weakest defensibility per Skills Architecture v1's own anti-goals.

Claude Code's calibrated recommendation: α (with safeguards),
leaning against γ as weakest option. Recommendation rationale:
Skills Architecture v1's own self-hedges argue against over-
applying it; solo founder + AI execution makes β's coordination
overhead expensive; sessions 18-21 demonstrated reactive
architecture works when problems are concrete; pre-product-
market-fit timing suggests prioritizing user-visible value.

### 5.3 Decision: β (parallel tracks)

**Rationale (DrJ's choice):**

The cascade discovery during sessions 18-21 showed that
architectural work matters and that reactive-only architecture
leaves gaps. Two tracks acknowledge both concerns: ship the
product features Strategic Plan v6 promises AND build the
durable architectural foundation Skills Architecture v1
describes. The cost is real (longer Phase B duration; more
coordination), but the alternative (α) carries technical-debt
risk that the cascade discovery made tangible.

The 3-track scope that emerged via Decision Point 2 (see §6
below) reinforces this — DrJ chose the architecturally-richest
end of the option matrix at both Decision Points 1 and 2.

### 5.4 Implications of β

**Track 1 — Product features (per Strategic Plan v6):**
- Mobile-first homepage redesign
- Mobile-first Event Dossier (Layer 1 view)
- Tracker Auto-Detection Engine v1 + first trackers across 8 categories
- Op-ed aggregation MVP
- Video clip integration with verification labels
- Breaking news engine v1
- Source matrix expansion to ≥150 active sources
- Source onboarding workflow operational
- Source quality scoring infrastructure
- AI translation pipeline (Urdu)
- Social Media Engine v2 (existing FB/IG/Bluesky upgrade + new X + LinkedIn)
- Per-platform content templates and brand voice guidelines
- UTM tagging and social analytics dashboard
- Three newsletter products
- Alert engine v1 (web push + email + Telegram)
- Internal Scoop search upgrade
- Brave Search API preview integration
- Scoop search portal page v1
- Entertainment topic page + Box office tracker + Streaming charts + Critical reception aggregator + Regional entertainment landings
- Accessibility audit + WCAG 2.1 AA remediation
- Brand refresh (per Decision 9)
- SEO and structured data

**Track 2 — Architecture (per Skills Architecture v1, with BullMQ migrations folded in):**
- B.1 Codebase reorganization by skill
- B.2 Define skill contract documentation
- B.3 Establish skill boundaries (linter rules, isolation tests)
- B.4 First skill isolation POC (image/video pipeline)
- **BullMQ migrations** (First 5: ingestion, video, enrichment, analysis, realityIndex)
  - Originally listed in Strategic Plan v6 Phase B Foundation
  - Reframed under DP1=β as Track 2 work because the 5 queues correspond to 5 skill boundaries
  - This double-counting is intentional: BullMQ migrations partially deliver against Strategic Plan v6 Phase B Foundation AND partially deliver against Skills Architecture v1's skill-isolation vision

**Phase B duration estimate post-DP1:**
Strategic Plan v6 originally said "Months 1-3." DP1=β extends this
to **"Months 1-5" baseline.** DP2=δ extends further (see §6.4).

**Coordination mechanism:**
DrJ as sole operator decides per-session which track to feed.
No formal sprint-boundary synchronization needed at the team
level (no team), but DrJ commits to:
- Logging which track each session contributes to
- Not letting either track go dark for more than 4 consecutive sessions
- Acknowledging in retrospective documents when one track is leading the other

---

## 6. Decision Point 2 — Infrastructure Track Disposition

### 6.1 The question

How does the infrastructure track (Finding #56 R1-R4 + Session 21
Sprint 0-6) fit within the now-two-track Phase B (after DP1=β)?

### 6.2 Options presented

- **α** — Defer entirely. R1-R4 becomes future reference. Saves 10-13 sessions but contradicts DP1=β's durability premise.
- **β** — Fold lazily into Phase B. Sprint 0 as 1-session hygiene; Sprint 1+ defer until specific feature triggers them. 1-2 session cost.
- **γ** — Keep as Phase B prerequisite. Do R1-R4 first (10-13 sessions) before Track 1 + Track 2. Roughly doubles Phase B duration.
- **δ** — Position as parallel supporting track (Track 3). Three concurrent tracks. Highest coordination cost; honors comparative analysis fully.

Claude Code's calibrated recommendation: β (lazy fold-in) over δ.
Reasoning: solo + AI managing three concurrent tracks is
operationally heavy; β captures Sprint 0's verified value at
minimum cost.

### 6.3 Decision: δ (parallel supporting track)

**Rationale (DrJ's choice):**

The comparative analysis is concrete observational evidence, not
speculation. Sessions 18-21 demonstrated infrastructure pain is
real at current scale. Treating R1-R4 as a supporting track —
rather than deferred work or prerequisite work — honors both
the analysis and the cascade learning.

The "supporting track" framing matters: Track 3 does not block
Track 1 (product features) or Track 2 (architecture). It runs
alongside, completing infrastructure milestones at its own
cadence with verifiable per-sprint outcomes (the comparative
analysis pre-specified Sprint 0-6 with concrete verification
steps for each).

The coordination cost is acknowledged. DrJ accepts that Phase B
duration extends further (see §6.4) and that solo + AI execution
carries higher cognitive load with three concurrent tracks.

### 6.4 Implications of δ

**Track 3 — Infrastructure (per Comparative Analysis §7):**

| Sprint | Item | Effort | Maps to | Depends on |
|---|---|---|---|---|
| **Sprint 0** | `Cache-Control: public, max-age=31536000, immutable` on hashed static assets | 1 session | R2 | None |
| **Sprint 1** | Cloudflare (or equivalent CDN) edge in front of `scoopfeeds.com` HTML | 2-3 sessions | R2 | None directly; benefits from Sprint 0 |
| **Sprint 2** | `Cache-Control: public, s-maxage=120, stale-while-revalidate=600` on HTML responses | 1 session | R2 + R3 | Sprint 1 |
| **Sprint 3** | SWR pattern on content API responses, extending c8917d1 persistent cache | 2 sessions | R3 | None |
| **Sprints 4-6** | Server-render hot routes (`/`, `/topic/:slug`) via Vite SSR or small Node SSR layer | 4-6 sessions | R4 | None directly; biggest structural payoff after Sprints 1+2 |

**Total Track 3 effort:** 10-13 sessions in dependency order.

**Phase B duration estimate post-DP2:**
DP1=β baseline was "Months 1-5." Adding Track 3 in parallel
extends to **"Months 4-7"** estimated. Solo + AI execution
typically runs 1.3-1.8× original estimates (per Execution Method
v1 Section 2), so realistic outside is "Months 6-9."

**This is a real cost.** Strategic Plan v6 originally promised
Phase B in "Months 1-3." Post-reconciliation, Phase B is
"Months 4-7" estimated, "Months 6-9" realistic. The trade-off
is shipping a more architecturally-durable Phase B at the cost
of longer time-to-Phase-C.

**Anti-goal tension acknowledged:**

Skills Architecture v1 Section 8 says *"Don't build the platform
before the application."* Track 3 is partially platform-shaped
work. The reconciliation accepts this tension explicitly:

- Sprint 0 is hygiene (5-line config), not platform
- Sprint 1 is integrating a third-party CDN, not building one
- Sprint 2 is a header policy change, not infrastructure construction
- Sprint 3 extends existing persistent cache code (c8917d1)
- Sprints 4-6 (SSR) is the most platform-shaped — but is genuinely
  application-facing (changes user-visible first paint), not
  pure infrastructure for non-existent features

So Track 3 sits closer to "application-supporting infrastructure"
than "platform-before-application." The anti-goal tension is
named but not blocking.

---

## 7. Decision Point 3 — Sprint 0 Specific Disposition

### 7.1 The question

When does Sprint 0 (Cache-Control immutable on hashed assets)
execute? It was the original tactical question that triggered
this entire reconciliation.

### 7.2 Options presented

- **a** — Execute as Track 3's opening sprint within Phase B, after the binding kickoff gate clears
- **b** — Execute as Phase A close-out item, before kickoff gate
- **c** — Drop Sprint 0 entirely

### 7.3 Decision: a (Track 3 opening sprint, post-kickoff-gate)

**Rationale (DrJ's choice):**

Internal consistency with DP2=δ. Sprint 0 is Track 3's natural
opening move; pulling it forward to Phase A close-out would set
a precedent for forward-pulling other Track 3 items and erode
the binding kickoff gate.

The 1-session of production hardening Sprint 0 represents is
genuinely valuable but not urgent — browsers cache aggressively
even without the explicit `immutable` directive. Waiting 6-12
sessions for kickoff gate to clear costs near-zero.

### 7.4 Implications of (a)

- Sprint 0 happens after Sprint 2 closes + Phase A retrospective is written
- Sprint 0 is Track 3's first sprint
- No special-case carve-outs for any other Track 3 items either
- All Track 3 work waits for kickoff gate, consistent with Tracks 1 and 2

---

## 8. Reconciled Phase B Definition

### 8.1 Single source of truth (this section)

Phase B is defined as **three concurrent tracks** with a unified
exit gate.

**Track 1 — Product features**
*(per Strategic Plan v6 §9 Phase B; binding load-bearing exit work)*

Six work areas: Comprehension layer, Source matrix, Distribution,
Search, Entertainment, Foundation. See §5.4 for full list.

**Track 2 — Architecture**
*(per Skills Architecture v1 §7 Phase B work items)*

- B.1 Codebase reorganization by skill
- B.2 Skill contract documentation
- B.3 Skill boundaries (lint rules, isolation tests)
- B.4 First skill isolation POC (image/video)
- BullMQ migrations (5 queues, partial double-count with Strategic Plan v6 Foundation)

**Track 3 — Infrastructure**
*(per Finding #56 R1-R4 + Comparative Analysis v1 §7 Sprint 0-6)*

- Sprint 0 (Cache-Control immutable on hashed assets)
- Sprint 1 (CDN edge)
- Sprint 2 (s-maxage + SWR HTML headers)
- Sprint 3 (SWR pattern on persistent cache)
- Sprints 4-6 (SSR for hot routes)

### 8.2 Phase B exit criteria (unified)

Phase B exits when ALL of these are true:

**From Strategic Plan v6 (load-bearing user-facing):**
- Homepage above-the-fold = intelligence + comprehension content only
- Mobile Lighthouse ≥90
- Tracker Auto-Detection Engine operational with ≥10 active trackers
- Breaking news alerts live across web push + email + Telegram
- Op-ed perspectives on ≥80% of major events
- Video clips on ≥60% of major events
- 3 newsletter products with ≥30% open rates
- ≥150 active sources with quality scores
- Combined social followers ≥10,000 across X, LinkedIn, Instagram
- ≥3% engagement rate average on social
- ≥10,000 search queries/month on Scoop
- Scoop returns dossiers/trackers as top results for ≥60% of category-relevant queries
- Returning user rate ≥25%
- Telegram channel subscribers ≥5,000

**Added from Skills Architecture v1 (architectural durability):**
- Codebase organized by skill folder per skills/ taxonomy
- Skill contract documentation exists and is followed
- Linter rules enforce skill boundaries (cross-skill imports blocked or flagged)
- Image/video pipeline successfully isolated as POC
- 5 BullMQ migrations live in production (USE_BULLMQ=true on at least the worker process)

**Added from Track 3 Infrastructure:**
- Hashed asset Cache-Control header set to `public, max-age=31536000, immutable`
- CDN edge layer fronts `scoopfeeds.com` HTML responses (verifiable via `x-cache` or equivalent header)
- HTML routes return `Cache-Control: public, s-maxage=120, stale-while-revalidate=600`
- SWR pattern operational on content API responses (cached data served immediately while background refresh proceeds)
- At least one hot route (homepage `/` or topic `/topic/:slug`) server-rendered (HTML response contains article headlines, not SPA shell)

### 8.3 Phase B kickoff criteria (binding, from Skills Architecture v1 §10)

Phase B does NOT start until:
1. **Phase A wrapped cleanly.** All Sprint 0-2 issues closed. Phase A retrospective written. No outstanding production incidents.
2. **Strategic clarity on Reality Index.** Either it's running stable or relief has been applied.
3. **Operational baseline understood.** A few weeks of post-Phase-A observability data exists.
4. **Time and energy budget realistic.** Phase B is structural work that's mostly invisible to users. Don't start during periods of high user-facing pressure.

These four criteria are non-negotiable. They gate Phase B as a whole; no individual Track 1, Track 2, or Track 3 work item executes before the gate clears.

### 8.4 Phase B duration estimate

| View | Estimate |
|---|---|
| Strategic Plan v6 original | "Months 1-3" |
| Post-DP1=β | "Months 1-5" |
| Post-DP2=δ | "Months 4-7" |
| Realistic (1.3-1.8× per Execution Method v1) | "Months 6-9" |

DrJ accepts the longer duration as the cost of reconciliation.
The trade-off: longer time-to-Phase-C in exchange for a more
architecturally-durable Phase B exit.

### 8.5 Phase B coordination

Solo founder + AI execution. No team-level coordination needed,
but DrJ commits to operator-level discipline:

- **Per-session track tagging**: every session logs which of the three tracks it contributes to (in commit messages, retrospective entries, or both)
- **No-track-dark rule**: no track goes more than 4 consecutive sessions without a contribution
- **Sprint cadence within each track**: each track maintains its own logical sprint sequence; Track 1 uses Strategic Plan v6 work areas as sprint groupings, Track 2 uses B.1-B.4, Track 3 uses Sprint 0-6
- **Track conflicts surface in retrospective**: if Track 1 and Track 2 need to touch the same files, the conflict gets documented in the next retrospective rather than silently absorbed
- **No new tracks added without explicit decision**: a fourth track requires a new reconciliation document or formal amendment to this one

---

## 9. Forward Path — What Sessions 23+ Work On

### 9.1 Pre-Phase-B work (sessions 23-N, before kickoff gate clears)

The binding kickoff gate requires:
- Sprint 0-2 issues closed (per Phase A Kickoff Brief)
- Phase A retrospective written (per Execution Method v1 §11)
- No outstanding production incidents
- Strategic clarity on Reality Index
- Operational baseline understood

Per finding #75 audit, the current gap is:
- Sprint 2 has 2 PARTIAL + 1 deferred (CSP per finding #50) + 1 informal-verification accepted (2.6) — **NOT all closed**
- Sprint 4-5 (source/social/search audits + tracker templates) — entirely NOT STARTED
- Sprint 6 close-out — entirely NOT STARTED including formal retrospective and Phase B Kickoff Brief drafting
- Sprint 3 (raw_signals drop, 5 metrics dashboard) — partial

**Recommended session 23+ sequence to clear the kickoff gate:**

1. **Sprint 4 source audit** (2-3 sessions). Inventory current 119 sources, categorize against 17×10×10 matrix, identify dead sources, design quality scoring infrastructure, gap analysis, Phase B source priority list. Unblocked.
2. **Sprint 5 social audit + search audit + tracker templates** (3-4 sessions). Document current FB/IG/Bluesky auto-posting setup, audit FTS5 + sqlite-vec scaffolding, design 8 tracker templates.
3. **Sprint 3 close-outs** (1-2 sessions). 5 metrics dashboard, raw_signals drop. May happen in parallel with audits.
4. **Sprint 2 close-outs** (1 session). Remaining hollow-feature copy, i18n key wiring. CSP enable deferred per finding #50.
5. **Sprint 6 close-out** (3-4 sessions). Exit verification document, metrics snapshot, formal Phase A Retrospective synthesis, Phase B Kickoff Brief drafting.

**Total pre-Phase-B sessions:** 10-14 sessions to clear kickoff gate (consistent with finding #75's "operational view 11-20 sessions" range).

### 9.2 Phase B opening (after kickoff gate clears)

All three tracks open simultaneously:

**Track 1 first work:** likely mobile-first homepage redesign OR Tracker Auto-Detection Engine v1 — whichever Phase B Kickoff Brief drafting (Sprint 6.7) prioritizes.

**Track 2 first work:** B.1 codebase reorganization. Pure refactor, no behavioral change. Sets up the skills/ folder structure for Track 1 and Track 3 to work within.

**Track 3 first work:** Sprint 0 (Cache-Control immutable on hashed assets). 1-session hygiene win.

These three first-works can run sequentially (which gives DrJ time to settle into 3-track cadence) or with mild parallelism. The Phase B Kickoff Brief should decide.

### 9.3 Phase B mid-sequence and exit

The full sequence within each track was specified earlier. The
Phase B Kickoff Brief (drafted in Sprint 6.7) lays out the
detailed sprint-by-sprint plan. This reconciliation document
does NOT pre-write that brief.

Phase B exits when §8.2's combined exit criteria are met.

---

## 10. Updates Required to Existing Documents

### 10.1 Updates to Strategic Plan v6

**Recommended (not required) at next Strategic Plan revision:**
- Add cross-reference to this reconciliation document and to Skills Architecture v1 in Phase B section
- Note Phase B duration estimate is "Months 4-7" (or "Months 6-9" realistic) post-reconciliation, not "Months 1-3"
- Phase B exit criteria expand to include architectural and infrastructure criteria from this document's §8.2
- Foundation section's "First 5 BullMQ migrations" gets clarification that this is Track 2 work

These updates are recommended at the next quarterly Strategic Plan review per Execution Method v1 §7. They do not require an immediate v7 — the reconciliation document carries the authority in the interim.

### 10.2 Updates to Skills Architecture v1

**Recommended at next revision:**
- Section 7 Phase B work items: add cross-reference to Strategic Plan v6 Track 1 and to this reconciliation document
- Section 10 Phase B Kickoff Criteria: note that "Phase B" now refers to the three-track structure defined in this reconciliation, not just B.1-B.4 work

Skills Architecture v1 remains in the repo. It is not deprecated or archived. It continues to define Track 2 work and to provide architectural guidance.

### 10.3 Updates to Phase A Kickoff Brief

**Section 16 Hand-off to Phase B:** Update to reference this reconciliation document. Phase A retrospective (Sprint 6.4) should include explicit pointer.

### 10.4 New documents likely to emerge from this reconciliation

- **Phase B Kickoff Brief** (Sprint 6.7 in Phase A Kickoff Brief; deferred to dedicated drafting). Will translate this reconciliation's three-track structure into sprint-level execution plan with Layer 4 issues.
- **Skill contract documentation** (Track 2 work item B.2). Will live at `docs/strategy/skill_contract_v1.md` or similar.

These are future work, not deliverables of this reconciliation.

### 10.5 No Decisions Log changes needed

Spot-check of all 31 decisions confirms none of the locked decisions need revision. Several decisions (9 brand refresh, 12 Tracker Auto-Detection, 16 source onboarding, 19 social platform priority, 23 search backbone, 25 sponsored search) gain clearer placement under Track 1 of the reconciled Phase B, but their content is unchanged.

---

## 11. Review Triggers

The decisions in this document are final unless one of these triggers fires.

### 11.1 Triggers that would revisit DP1 (authority resolution)

- **Track 1 vs Track 2 deadlock:** if Track 1 and Track 2 generate persistent file-level conflicts (e.g., B.1 reorganization wants to move files that Track 1 is actively modifying), and coordination overhead exceeds acceptable, revisit whether parallel tracks are sustainable for solo execution.
- **Phase B duration exceeds "Months 9":** if even the realistic outside estimate is busted, this is a signal that three-track execution is not working for solo + AI; revisit DP1 toward α (single-track product focus).
- **Phase B exit criteria for Track 2 become impossible:** if Skills Architecture v1's exit criteria (skill folder structure, linter boundaries, BullMQ migrations) prove uneconomic to meet, demote Track 2 to "ongoing technical work" per Option α.

### 11.2 Triggers that would revisit DP2 (infrastructure track)

- **Track 3's Sprint 1+ items produce no measurable user benefit:** if CDN integration (Sprint 1) and SWR + SSR work don't measurably improve user metrics (Lighthouse, page load, returning user rate), revisit whether Track 3 is supporting features or building infrastructure for non-existent demand. Defer remaining Track 3 work to Phase C+.
- **Comparative analysis goes stale:** if the platforms benchmarked (Yahoo, Bloomberg, X, Apple News) significantly change architecture before Track 3 completes, re-validate Track 3's recommendations against fresh observation before continuing.

### 11.3 Triggers that would revisit DP3 (Sprint 0 timing)

- **A specific Phase A close-out activity needs Sprint 0 prerequisites:** if any Sprint 4-6 close-out work requires immutable cache headers, Sprint 0 may be pulled forward as an exception (with explicit documentation).

### 11.4 Triggers that would revisit binding kickoff gate

The kickoff gate (Sprint 2 closed + Phase A retrospective written + Reality Index stable + operational baseline + time/energy budget) is binding per Skills Architecture v1 §10. Revisit only if:
- Phase A close-out reveals one of the four conditions is structurally unachievable (e.g., the formal Phase A retrospective cannot be written because the retrospective inputs file is itself sufficient — that's UNCLEAR 6 from finding #75 audit, already resolved as "still required per Execution Method v1")
- An emergent production incident overrides the gate (rare; would be Phase A close-out scope expansion, not Phase B start)

---

## 12. Open Questions Parked

These were surfaced during reconciliation but not decided.

### 12.1 The "First 5 BullMQ migrations" — which 5?

Strategic Plan v6 names them as a Phase B Foundation item but doesn't specify which 5 of the 9 defined queues. Skills Architecture v1's skill taxonomy suggests the natural 5 are the most heavyweight: ingestion, video, enrichment, analysis, realityIndex.

**Parked because:** The specific choice is execution-time work for Track 2's Phase B Kickoff Brief. Not a reconciliation question.

### 12.2 Cross-track file conflicts

Track 2's B.1 codebase reorganization will move files. Track 1's feature work will modify files. Track 3's Sprint 0-6 changes some of the same files. Coordination mechanism is "DrJ logs in retrospective when conflicts surface," but no preemptive mechanism is designed.

**Parked because:** Conflict patterns aren't observable until execution. Address reactively per §8.5 coordination notes. If conflicts become frequent, fire a DP1 review trigger.

### 12.3 The CSP enable question (Sprint 2 Issue 2.2)

Finding #50 deferred CSP enablement. The reconciliation does not change that defer.

**Parked because:** CSP is Phase A Sprint 2 close-out work, not Phase B reconciliation scope. Will be addressed in pre-Phase-B kickoff gate clearing (§9.1 sequence).

### 12.4 The lastRun:null integrations

TMDB, FRED, WorldBank, ACLED, SportsDB, Synthetic Extract — all show `lastRun: null` in production health. These integrations are scaffolded but never executed.

**Parked because:** Per finding #75 UNCLEAR 5 resolution, this is Phase B source matrix expansion scope (Track 1) or pre-Phase-B operational fix. Not reconciliation scope.

### 12.5 Phase B Kickoff Brief structure under three tracks

The Phase A Kickoff Brief has a single-track structure (7 sprints, sequential). The Phase B Kickoff Brief will need to express three-track parallel structure. The template in Execution Method v1 §11.1 doesn't pre-anticipate this.

**Parked because:** Template extension is Phase B Kickoff Brief drafting work (Sprint 6.7), not reconciliation scope.

---

## 13. Honest Caveats

### 13.1 Three-track execution for solo founder + AI is unproven

Sessions 1-21 of Phase A executed largely as single-track work (with the stabilization track running effectively as the only active track from sessions 18-21). Three concurrent tracks is a coordination model Scoopfeeds hasn't operated under before. The Phase B duration estimate of "Months 4-7" assumes the model works; "Months 6-9" assumes the typical solo + AI slip factor.

If three-track execution proves operationally infeasible, the DP1 review trigger fires.

### 13.2 The comparative analysis is a single-sample snapshot

Track 3's design reference (`docs/research/comparative_analysis_v1.md`) was a 2026-05-13 snapshot of Yahoo, Bloomberg, X, Apple News. The four platforms continue to evolve. By the time Track 3's Sprint 4-6 (SSR) opens — potentially 6+ months from now — the comparative landscape may have shifted. The recommendations should be re-validated before Track 3's later sprints.

### 13.3 Pre-product-market-fit risk on Track 2

Skills Architecture v1's anti-goal *"Don't build the platform before the application"* is partially honored by Track 1's product feature priority and partially violated by Track 2's structural refactor concurrent with feature work. The reconciliation chose β/δ which accepts this tension. If Phase B execution reveals Track 2 is investing in architecture for skills that never materialize (e.g., if some product features get killed during execution), Track 2 work may have been over-investment.

The mitigation: Track 2's first work (B.1 codebase reorganization) is a pure refactor of existing code; it doesn't anticipate skills that don't exist. B.2-B.4 do anticipate future patterns. If product feature direction changes materially during Phase B, revisit Track 2's later sprints.

### 13.4 The reconciliation is itself reversible

This document is v1. Future versions can revise decisions if execution reveals the framing was wrong. Skills Architecture v1 itself is at v1 with v2/v3/v4 anticipated. Strategic Plan v6 will be v7 at next quarterly review. The reconciliation is not eternal; it's a coordination snapshot.

What the reconciliation does NOT permit is silent drift — if any document changes Phase B definition in a way that affects the others, the reconciliation must be revised (v2) to capture the new alignment. No silent re-divergence.

---

## 14. Summary Table — The Reconciliation in One Page

| Element | Value |
|---|---|
| Date decided | 2026-05-15 (Session 22) |
| Authority resolution (DP1) | **β** Parallel tracks within Phase B |
| Infrastructure track disposition (DP2) | **δ** Parallel supporting track (Track 3) |
| Sprint 0 specific disposition (DP3) | **a** Track 3 opening sprint, post-kickoff-gate |
| Phase B track count | 3 concurrent |
| Track 1 (product features) source | Strategic Plan v6 §9 Phase B |
| Track 2 (architecture) source | Skills Architecture v1 §7 (B.1-B.4) + BullMQ migrations |
| Track 3 (infrastructure) source | Finding #56 R1-R4 + Comparative Analysis v1 §7 Sprint 0-6 |
| Phase B duration estimate | Months 4-7 (Months 6-9 realistic) |
| Binding kickoff gate | Sprint 2 closed + Phase A retrospective written + 2 other conditions |
| Phase B exit criteria | Combined (Strategic Plan + Skills + Infrastructure); see §8.2 |
| Sessions to clear kickoff gate | 10-14 (per finding #75) |
| Track 3 first work | Sprint 0 (Cache-Control immutable on hashed assets) |
| Decisions Log changes needed | None |
| Strategic Plan v6 revisions | Recommended at next quarterly review |
| Skills Architecture v1 revisions | Recommended at next revision (no rush) |
| Document this reconciliation supersedes | None (additive) |

---

## 15. How to Use This Document

This document is the single source of truth for "what is Phase B" until a documented review trigger fires.

**Before starting any Phase B work:**
- Verify the binding kickoff gate (§8.3) is clear
- Identify which track the work belongs to (Track 1 / Track 2 / Track 3)
- Confirm the work item appears in §8.1's track definitions
- If the work doesn't fit any track, this reconciliation needs revision (don't silently add)

**Before drafting the Phase B Kickoff Brief:**
- Re-read this entire document
- Translate each track's work items into the brief's sprint-level structure
- Track 1, Track 2, Track 3 each need their own sprint sequence within the brief
- Apply the coordination notes from §8.5

**Before adding scope to Phase B:**
- Does the new scope fit one of the three tracks?
- If yes: add to that track's work items in the Phase B Kickoff Brief
- If no: this reconciliation needs revision; do not silently add scope

**Before Phase B exit:**
- Verify §8.2 exit criteria across all three tracks
- All three tracks must meet their respective exit criteria
- Phase A's exit criteria (per finding #75) must also remain satisfied — Phase B does not weaken Phase A's foundation

**Before considering revisions to this document:**
- Check §11 review triggers
- If a trigger has fired: revise via v2 of this document, preserving v1 as archive
- If no trigger has fired: the reconciliation is final

---

*End of document. Strategic-Tactical Reconciliation v1.0.*
