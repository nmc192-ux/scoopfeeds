# Phase B Kickoff Brief: Comprehension Layer, Distribution, Internal Scoop
## Scale-and-Stabilize Across Three Parallel Tracks

**Document type:** Phase Kickoff Brief
**Phase:** B (of A through E)
**Version:** 1.0
**Strategic goal (per Strategic Plan v6 §9 Phase B):** Launch Layer 1 with Comprehension Layer + Distribution + Internal Scoop. Corpus grows to operational scale (≥150 sources with quality scores). Reality Index v1 publishes. Codebase matures from prototype to skill-organized architecture. Performance infrastructure (caching + CDN + SSR) lands behind hot routes.
**Timeline:** Months 4–7 estimated (per reconciliation v1 §8.4); Months 6–9 realistic (1.3–1.8× per Execution Method v1 §2)
**Owner:** DrJ (Founder)
**Predecessor retrospective:** [Phase A Retrospective v1.0](phase_a_retrospective.md) (Sprint 6.4 artifact)
**Companion documents:** [Strategic Plan v6.0](../strategy/strategic_plan_v6.md), [Decisions Log v1.0](../strategy/decisions_log_v1.md), [Strategic-Tactical Reconciliation v1.0](../strategy/strategic_tactical_reconciliation_v1.md), [Source Credibility Methodology v1.1](../content/source_credibility_methodology.md), [Source Scoring Service Specification v1.0](../specs/source_scoring_service.md), [Phase A Source Audit Phase 2 Calibration](../audits/phase_a_source_audit_phase2_calibration.md), Skills Architecture v1, Comparative Analysis v1
**Audience:** Internal — founder + AI implementers (Claude Code as primary)
**Last updated:** 2026-05-17
**Status:** Draft v1.0 — pending Phase A close-out completion

---

## 0. About this document

This brief is the **structural commitment** defining what Phase B is. It locks track structure, lists deliverables per track, defines exit criteria, and names what is explicitly NOT in Phase B scope. It does not pre-write every sprint plan: sprint-level tactical sequencing lives in sprint-specific documents drafted during Phase B execution. The brief sets the boundary; sprints fill in the inside.

It is read by:
- DrJ — to know what to work on, in what order, against what exit criteria
- Claude Code — loaded as context for every Phase B session prompt
- Any future collaborator or reviewer — to understand Phase B scope without reconstructing it from sources

It is **not**:
- An implementation guide for any individual deliverable (those live in sprint docs and specs)
- A tactical sequencing plan binding every session (per-session track choice is operator discretion within track-cadence rules — see §6)
- A re-negotiation of strategic decisions (decisions 1–31 stand; brief operates within them)

---

## 1. Phase B in context

### 1.1 What Phase A delivered

Phase A (Stabilize and Audit) closed substantively at this brief's authoring with the following artifacts shipped:

- **Methodology v1.1** (commit `3d935ef`) — public source-credibility scoring methodology, 5 components × 8 posture labels × 6 score bands. Open methodology + proprietary weights per Decision 7. Three refinements from 15-source publisher calibration: Government direct-state-funded sub-case expansion (DW + France 24 class); Corporate-owned industry-affiliated parent sub-case (CoinDesk under Bullish reference); Aggregator ET sub-criteria substitution (Hacker News reference).
- **Source Scoring Service Specification v1.0** (commit `3ca4e34`) — architectural spec for the Phase B Track 1 automated scoring service that applies methodology v1.1 programmatically. Captures inputs, outputs, sub-criteria operationalization patterns, scoring runtime, editorial override mechanism, validation harness binding the future service to the 15-source v1.0 calibration ground-truth.
- **Sources Table Infrastructure** (Migration 002, commit `2c67764`) — DB schema for quality scores, posture labels, methodology version per source. Seeded with 154 sources (110 RSS + 44 YouTube).
- **15-source v1.0 Calibration** (commit `e1921b9`) — validation set proving methodology v1.0 produces expected score bands; serves as the ±5-point reproduction harness for the future scoring service.
- **Phase A Retrospective v1.0** (commit `72a7eb8`) — formal retrospective synthesizing 86 findings, exit-criteria status, lessons learned.
- **Source Audits** — Phase 1 (commit `70cac7b`) and Phase 2 (commit `4f2a91b`) gap analysis; 9 dead sources cleaned up (commit `6278ab6`).
- **86 cumulative findings** captured in `docs/phases/phase_a_retrospective_inputs.md`, including the two architectural findings that anchor Phase B planning: finding #85 (infrastructure work disguised as content work in Phase planning — the institutional pattern; Sprint 4.5 reframed to automated scoring service); finding #86 (publisher methodology scope gap; creator methodology with three-layer host + guest + episode composite preserved as architectural artifact for Phase C).

Phase A did **not** close every exit criterion as originally framed. The retrospective documents 4 of 8 strategic exit criteria MET with the unmet criteria (metrics dashboard, social audit, search audit) explicitly noted as Phase A close-out remaining work. Per reconciliation v1 §8.3, Phase B kickoff is gated on Phase A wrapping cleanly, not on every audit shipping — see §7 below.

### 1.2 What Phase B is for

Phase B is the **scale-and-stabilize phase**. Phase A established the methodology + architectural commitments. Phase B does three things:

1. **Grows the corpus to operational scale.** Strategic Plan v6 §9 Phase B exit target: ≥150 active sources with quality scores. Current corpus is 110 RSS + 44 YouTube = 154 sources; scoring needs to land on all of them via the Phase 28.B scoring service. Net new sources to onboard during Phase B: ≥40 per Sprint 4 audit Phase 2 gap analysis.
2. **Ships the Comprehension Layer and Distribution capabilities.** Per Strategic Plan v6 Capability 1 + Capability 2: Tracker Auto-Detection Engine v1, Event Dossier mobile-first redesign, breaking news engine v1, op-ed aggregation MVP, three newsletter products, alert engine v1 (web push + email + Telegram), Reality Index v1.
3. **Matures the codebase from prototype to skill-organized architecture.** Per Skills Architecture v1: B.1 codebase reorganization, B.2 skill contract documentation, B.3 skill boundaries (lint rules), B.4 image/video skill-isolation POC. Plus BullMQ migrations for 5 queues (ingestion, video, enrichment, analysis, realityIndex) — partial double-count with Strategic Plan v6 Foundation per reconciliation v1 §5.4.

These three things ship across three concurrent tracks (§2) with a unified exit gate (§7).

### 1.3 What Phase B is NOT for

- **Not for creator/individual-creator scoring.** Publisher methodology v1.1 is the operative rubric. Creator methodology (three-layer host + guest + per-episode composite per finding #86) is **Phase C scope**. Phase B reserves an architectural slot in the Source Scoring Service for the creator branch but does not implement it.
- **Not for translation pipeline at scale.** AI translation pipeline (Urdu) is in Strategic Plan v6 Phase B Track 1 — but per Decision 6 (Urdu through Phase D) and finding #82 calibration, Phase B includes Urdu-only translation operational; broader non-English source ingestion at scale is Phase C.
- **Not for paid licensing / commercial deployment.** Reuters / Foreign Affairs / Project Syndicate licensing is Phase D+. Phase B operates on free-tier sources only.
- **Not for mobile native apps.** Per Decision 8 (mobile native app timing), responsive web suffices through Phase B. Native is Phase D+.
- **Not for third-party developer API.** Public API is Phase D+ if at all (Strategic Plan v6 §9 Phase D).
- **Not for editorial advisory panel rollout.** Per methodology v1.1 §6.5 founder override, scoring decisions remain accountable to a single human reviewer through Phase B. Advisory panel is Phase D scope per methodology §9.4.

### 1.4 Phase B duration estimate

Per reconciliation v1 §8.4:

| View | Estimate |
|---|---|
| Strategic Plan v6 original | Months 1–3 |
| Post-DP1=β (Track 1 + Track 2) | Months 1–5 |
| Post-DP2=δ (Track 1 + Track 2 + Track 3) | Months 4–7 |
| Realistic (1.3–1.8× per Execution Method v1 §2) | Months 6–9 |

Translated to sessions at Phase A observed velocity (~22 sessions over ~10 weeks = ~2 sessions/week sustained, with bursts to 4–5 sessions/week during high-energy windows): **Months 4–7 estimated ≈ 60–110 sessions; Months 6–9 realistic ≈ 90–145 sessions**. Phase B is materially larger than Phase A.

This estimate is the cost of reconciliation: longer time-to-Phase-C in exchange for a more architecturally-durable Phase B exit. DrJ accepted this trade-off explicitly in reconciliation v1 §8.4.

---

## 2. Three-track structure

### 2.1 Why three tracks

Phase B work falls into three categories that operate at different cadences and have different success criteria. Treating them as separate tracks lets each track ship on its own pace without blocking. The three-track structure was introduced in reconciliation v1 §8.1 (session 22 reconciliation decisions DP1=β + DP2=δ) and is re-stated here for operational self-containment per DEC1.

Origin and binding source: [strategic_tactical_reconciliation_v1.md](../strategy/strategic_tactical_reconciliation_v1.md) §8.1.

### 2.2 Track 1 — Product features

**Source:** Strategic Plan v6 §9 Phase B (binding load-bearing exit work).

**Scope:** User-visible capabilities and the services that enable them.

**Phase B Track 1 deliverables (per reconciliation v1 §5.4):**

Six work areas covering the full Track 1 surface:

- **Comprehension Layer.** Mobile-first homepage redesign; mobile-first Event Dossier (Layer 1 view); Tracker Auto-Detection Engine v1 + first trackers across 8 categories (per Strategic Plan v6 Capability 2 + Decision 12); op-ed aggregation MVP; video clip integration with verification labels; breaking news engine v1.
- **Source matrix.** Source matrix expansion to ≥150 active sources; source onboarding workflow operational (per Decision 16 weekly batch); source quality scoring infrastructure (Source Scoring Service v1 implementation per Phase 28.B spec).
- **Distribution.** Three newsletter products with ≥30% open rates; alert engine v1 (web push + email + Telegram); combined social followers ≥10,000; ≥3% engagement rate average; Telegram channel subscribers ≥5,000; Social Media Engine v2 (existing FB/IG/Bluesky upgrade + new X + LinkedIn) with per-platform content templates and brand voice; UTM tagging and social analytics dashboard.
- **Search.** Internal Scoop search upgrade (entity awareness, semantic search via existing sqlite-vec scaffolding, credibility-weighted ranking); Brave Search API preview integration; Scoop search portal page v1; ≥10,000 search queries/month; dossiers/trackers as top results for ≥60% of category-relevant queries.
- **Entertainment.** Entertainment topic page (per Strategic Plan v6 new Category 17 — Entertainment & Culture); Box Office tracker; Streaming charts; Critical reception aggregator; Regional entertainment landings.
- **Foundation.** Accessibility audit + WCAG 2.1 AA remediation; brand refresh (per Decision 9); SEO and structured data; AI translation pipeline (Urdu only per Decision 6 + finding #82); returning user rate ≥25%.

**Source-related Track 1 deliverables in detail** (Phase A close-out provides the foundation):

- **Source discovery service** (§3.1)
- **Source enrichment service** (§3.2)
- **Source scoring service** — specced (§3.3, full spec at `docs/specs/source_scoring_service.md`)
- **Editorial review interface** (§3.4)
- **Reality Index v1** publication (§3.5; Capability 3 per Strategic Plan v6)
- **Corpus growth to ≥150 active sources with quality scores** (§3.6)

### 2.3 Track 2 — Architecture

**Source:** Skills Architecture v1 §7 + reconciliation v1 §8.1.

**Scope:** Codebase health, data layer, scoring infrastructure, foundational engineering. The work that makes Track 1 features shippable repeatedly.

**Track 2 deliverables for Phase B:**

- **B.1 Codebase reorganization by skill** — consolidate scattered files; establish module boundaries; skills/ folder taxonomy.
- **B.2 Skill contract documentation** — formal interface specs per skill.
- **B.3 Skill boundaries enforcement** — linter rules; isolation tests; cross-skill imports blocked or flagged.
- **B.4 First skill isolation POC** — image/video pipeline as the first end-to-end skill isolation demonstration.
- **BullMQ migrations** — 5 queues live in production: ingestion, video, enrichment, analysis, realityIndex. Originally listed in Strategic Plan v6 Phase B Foundation; reframed under DP1=β as Track 2 work because the 5 queues correspond to 5 skill boundaries (intentional double-count acknowledged in reconciliation v1 §5.4).
- **Source scoring service implementation** — implementation of Phase 28.B spec (`docs/specs/source_scoring_service.md`); ground-truth validation against the 15-source v1.0 calibration within ±5 points per source; per-sub-criterion operationalization for the ~25 remaining sub-criteria; audit log persistence (Migration 003+).

### 2.4 Track 3 — Infrastructure

**Source:** Finding #56 R1–R4 + Comparative Analysis v1 §7 (Sprint 0–6) + reconciliation v1 §8.1.

**Scope:** Performance infrastructure — caching, CDN, SSR. Application-supporting infrastructure that lifts user-facing speed without being platform-shaped per se.

**Note on track scope:** Track 3 in reconciliation v1 is specifically the Comparative Analysis v1 Sprint 0–6 performance infrastructure (Cache-Control headers, CDN edge, SWR patterns, SSR for hot routes). It is not "general ops" (deploy pipeline, monitoring, secrets rotation, incident response) — that work, while important, is not the reconciliation-defined Track 3 scope. Ops work happens incrementally across all three tracks and during Phase A close-out, not as a dedicated track.

This distinction matters because earlier informal references in Phase A artifacts have used "Track 3 = ops" framing. Per reconciliation v1 §8.1 (locked source), Track 3 = infrastructure performance work. Operational work is cross-track discipline that happens incrementally during sprints. This brief follows reconciliation; future Phase B execution sessions should preserve the distinction.

**Track 3 deliverables for Phase B (per reconciliation v1 §6.4):**

| Sprint | Item | Effort | Maps to | Depends on |
|---|---|---|---|---|
| Sprint 0 | `Cache-Control: public, max-age=31536000, immutable` on hashed static assets | 1 session | R2 | None |
| Sprint 1 | Cloudflare (or equivalent CDN) edge in front of `scoopfeeds.com` HTML | 2–3 sessions | R2 | Benefits from Sprint 0 |
| Sprint 2 | `Cache-Control: public, s-maxage=120, stale-while-revalidate=600` on HTML responses | 1 session | R2 + R3 | Sprint 1 |
| Sprint 3 | SWR pattern on content API responses, extending `c8917d1` persistent cache | 2 sessions | R3 | None |
| Sprints 4–6 | Server-render hot routes (`/`, `/topic/:slug`) via Vite SSR or small Node SSR layer | 4–6 sessions | R4 | Biggest payoff after Sprints 1+2 |

**Total Track 3 effort:** 10–13 sessions in dependency order.

**Anti-goal tension acknowledged** (reconciliation v1 §6.4): Skills Architecture v1 §8 says *"Don't build the platform before the application."* Track 3 is partially platform-shaped. Reconciliation accepts the tension explicitly — Sprint 0 is hygiene, Sprint 1 is integrating a third-party CDN, Sprint 2 is a header policy change, Sprint 3 extends existing persistent-cache code, Sprints 4–6 SSR is the most platform-shaped but is genuinely application-facing (changes user-visible first paint). Track 3 sits closer to "application-supporting infrastructure" than "platform-before-application." The anti-goal tension is named but not blocking.

### 2.5 Track coordination

Solo founder + AI execution. No team-level coordination needed, but per reconciliation v1 §8.5 DrJ commits to operator-level discipline:

- **Per-session track tagging.** Every session logs which of the three tracks it contributes to (commit messages and/or Pace Tracker entries). Phase A session-26-onward Pace Tracker entries demonstrate the pattern.
- **No-track-dark rule.** No track goes more than 4 consecutive sessions without a contribution. Surface in next retrospective if violated.
- **Sprint cadence within each track.** Each track maintains its own logical sprint sequence. Track 1 uses Strategic Plan v6 work areas (six areas above) as sprint groupings. Track 2 uses B.1–B.4 + BullMQ-per-queue. Track 3 uses Sprint 0–6 from Comparative Analysis v1.
- **Track conflicts surface in retrospective.** If Track 1 and Track 2 need to touch the same files (likely during B.1 reorganization), the conflict gets documented in the next retrospective rather than silently absorbed.
- **No new tracks added without explicit decision.** A fourth track requires a new reconciliation document or formal amendment.

Track dependencies (high-level):

- **Track 1 source scoring service** depends on **Track 2 source scoring service implementation** (Track 2 builds; Track 1 deploys and operates).
- **Track 1 source onboarding workflow** depends on **Track 3 Sprint 1 CDN edge** (only loosely — onboarding doesn't strictly require CDN but benefits from it).
- **Track 2 B.1 codebase reorganization** may temporarily destabilize **Track 1** (files moving while Track 1 wants to edit them); coordinate via change windows logged in commits.
- **Track 1 Reality Index v1 publication** depends on multiple Track 2 BullMQ migrations being stable.

---

## 3. Track 1 — Source services + Comprehension Layer detail

The full Track 1 scope (§2.2 six work areas) is large. The brief details the source-services subset because Phase 28 has been building toward exactly this, and because the source services are the prerequisite for the corpus growth that gates Phase B exit. The remaining Track 1 work areas (Comprehension Layer features beyond sources, Distribution, Search, Entertainment, Foundation) are sized at sprint-kickoff time inside Phase B execution — not pre-planned here.

### 3.1 Source discovery service

- **Purpose.** Find candidate sources from RSS directories, news APIs, Wikipedia infoboxes, language-specific aggregators. Surface ~50 candidates per week per Decision 16.
- **Inputs.** Source matrix gap analysis (`docs/audits/phase_a_source_audit_phase2_gap_analysis.md`): 40 net new sources needed to hit Phase B 150-source exit criterion; specific category × region × type cells below target.
- **Outputs.** Weekly candidate list with metadata: ownership, language, frequency, RSS health, sample headlines, estimated quality band, proposed posture label.
- **Success criteria.** Weekly batch operational; candidate quality high enough that founder approves ~10–20 per week (Decision 16 cadence).
- **Estimated sprint count.** 2–3 sessions for v1; ongoing operation.
- **Dependencies.** None blocking — can start in Track 1 Sprint 1.

### 3.2 Source enrichment service

- **Purpose.** Gather metadata for each candidate or existing source: ownership, corrections-page URL, byline transparency, funding mix, masthead.
- **Inputs.** Source identifier (URL or channel_id); optional founder-supplied metadata overrides.
- **Outputs.** Metadata payload consumed by the scoring service per `docs/specs/source_scoring_service.md` §6.1.
- **Success criteria.** Enrichment confidence ≥80% on calibration-set sources; fallback to website scraping when structured-data lookup fails.
- **Estimated sprint count.** 3–4 sessions for v1; ongoing operation.
- **Dependencies.** None blocking. Source scoring service quality is upper-bounded by enrichment service quality (`docs/specs/source_scoring_service.md` §7.2).

### 3.3 Source scoring service

- **Purpose.** Apply methodology v1.1 rubric programmatically to source + enrichment metadata. Produce 5 component sub-scores + posture label + combined quality_score per source.
- **Spec.** Full spec at `docs/specs/source_scoring_service.md` (v1.0, committed `3ca4e34`).
- **Validation harness.** Must reproduce the 15-source v1.0 calibration scores (`docs/audits/phase_a_source_audit_phase2_calibration.md` §2) within ±5 points per source on methodology v1.0 before being trusted on the remaining corpus. v1.1 hypothesized deltas (Hacker News +5 to +12; minimal others) are intentional and don't fail validation.
- **Success criteria.** Validation harness passes; weekly batch operational; audit log persisting; founder override mechanism per methodology v1.1 §6.5 functioning.
- **Estimated sprint count.** 5–8 sessions across Track 1 (operation) and Track 2 (implementation per §4.3).
- **Dependencies.** **Track 2 implementation** (this is the cross-track dependency); source enrichment service (§3.2).

### 3.4 Editorial review interface

- **Purpose.** Surface weekly batch for founder approval per Decision 16. Support per-source override per methodology v1.1 §6.5 + Source Scoring Service Spec §5.
- **Inputs.** Weekly candidate batch from source discovery (§3.1); weekly scoring runs from source scoring service (§3.3); override-conflict queue.
- **Outputs.** Approved/rejected source onboardings; founder overrides written to audit log.
- **Success criteria.** Founder review takes ~30 minutes per week (Decision 16 cadence target); override conflicts surfaced clearly; audit log queryable.
- **Estimated sprint count.** 2–3 sessions for v1.
- **Dependencies.** Source discovery + source scoring services in flight (§3.1, §3.3).

### 3.5 Reality Index v1

- **Purpose.** Per Strategic Plan v6 Capability 3 — probability inputs from multiple independent sources, aggregated weighted by calibration history.
- **Phase B scope.** v1 launch sources per Decision 11: Polymarket + Kalshi + Metaculus + AI estimates. (Phase D adds Good Judgment Open; skipped: Manifold, PredictIt.)
- **Success criteria.** Reality Index v1 publishing; cross-source claim triangulation observable on event dossiers; per-event probability prior visible to Layer 1 (and Layer 2 with full source attribution).
- **Estimated sprint count.** 6–10 sessions. Genuinely novel work; honest range.
- **Dependencies.** Source scoring service operational (Reality Index consumes source quality scores as weights); BullMQ realityIndex queue migration (Track 2).

### 3.6 Corpus growth to ≥150 active sources

- **Purpose.** Hit Strategic Plan v6 §9 Phase B exit criterion of ≥150 active sources with quality scores.
- **Current state.** 154 sources in corpus (Migration 002 seed); ~110 RSS + 44 YouTube. Scoring landed on 15 of 154 via v1.0 calibration; remaining 139 await scoring service first run.
- **Gap analysis.** Phase A source audit Phase 2 identified 40 net new sources needed (Phase B 150-source target vs current corpus minus dead-source candidates); category × region × type cells with priority listed in `docs/audits/phase_a_source_audit_phase2_gap_analysis.md`.
- **Success criteria.** ≥150 sources active with quality scores from scoring service; weekly onboarding workflow steady-state; per-source profile pages publishing.
- **Estimated sprint count.** Continuous across Phase B; not a single deliverable. Onboarding rate ~10–20 sources/week at Decision 16 target.
- **Dependencies.** Source discovery + enrichment + scoring + editorial review services all operational.

---

## 4. Track 2 — Architecture detail

### 4.1 B.1 Codebase reorganization by skill

- **Purpose.** Consolidate scattered files; establish skill-folder structure per Skills Architecture v1.
- **Scope.** Reorganize backend/src into skills/-shaped taxonomy (ingestion, video, enrichment, analysis, realityIndex, scoring, etc.).
- **Success criteria.** Skill folder structure exists; existing tests still pass; commits document the reorganization explicitly.
- **Estimated sprint count.** 4–8 sessions (scope uncertainty acknowledged per §10.2).
- **Dependencies.** None blocking. Phase B Track 2 Sprint 1.

### 4.2 B.2 Skill contract documentation

- **Purpose.** Define formal interface specs per skill — what each skill exposes, consumes, owns.
- **Success criteria.** `docs/strategy/skill_contract_v1.md` exists (or per-skill contracts); contracts followed in B.3 + B.4.
- **Estimated sprint count.** 2–3 sessions.
- **Dependencies.** B.1 in flight (need skill structure to document).

### 4.3 B.3 Skill boundaries enforcement

- **Purpose.** Linter rules + isolation tests prevent cross-skill import drift.
- **Success criteria.** Cross-skill imports blocked or flagged by lint; isolation tests run in CI.
- **Estimated sprint count.** 2–3 sessions.
- **Dependencies.** B.1 + B.2 complete.

### 4.4 B.4 First skill isolation POC (image/video pipeline)

- **Purpose.** End-to-end demonstration of skill-isolation working in production.
- **Success criteria.** Image/video pipeline running fully within its skill folder; no cross-skill imports; isolated tests passing.
- **Estimated sprint count.** 3–5 sessions.
- **Dependencies.** B.3 enforcement live.

### 4.5 BullMQ migrations (5 queues)

- **Purpose.** Migrate 5 queues to BullMQ: ingestion, video, enrichment, analysis, realityIndex. Per reconciliation v1 §5.4, this is intentional double-count with Strategic Plan v6 Foundation; the 5 queues correspond to the 5 skill boundaries.
- **Success criteria.** All 5 queues live in production; `USE_BULLMQ=true` on worker process; metrics published.
- **Estimated sprint count.** 1–2 sessions per queue = 5–10 sessions total.
- **Dependencies.** Skill structure established (B.1+).

### 4.6 Source scoring service implementation

- **Purpose.** Implementation of Phase 28.B spec (`docs/specs/source_scoring_service.md`); v1 implementation scope per spec §8.1.
- **Scope.**
  - Publisher methodology v1.1 only (creator branch declared per spec §2.5 but not implemented).
  - ~25 sub-criteria operationalized per the three-pattern shape in spec §3 (structured-data lookup / website scraping + pattern matching / LLM evaluation).
  - Weekly batch cadence per spec §4.1.
  - Triggered rescore per spec §4.1 (methodology bump / ownership change / fact-check flag / override registration).
  - Founder override mechanism per spec §5.
  - Audit log persistence per spec §6.4 (Migration 003+ schema; retention policy decided during implementation per Edit 16 of Phase 28.B).
- **Validation harness.** Reproduce the 15-source v1.0 calibration scores within ±5 points per source on methodology v1.0 before being trusted on the remaining corpus. v1.1 hypothesized deltas are intentional and don't fail validation.
- **Success criteria.** Validation harness passes; service operational on full corpus.
- **Estimated sprint count.** 8–12 sessions for v1.
- **Dependencies.** B.1 skill folder structure (service lives in scoring skill).

---

## 5. Track 3 — Infrastructure detail

Track 3 is the performance-infrastructure sequence from Comparative Analysis v1 §7, Sprint 0 → Sprint 6. Each sprint has pre-specified verification commands (curl headers, view-source checks per finding #14 verification-discipline carryover). See reconciliation v1 §6.4 for the detailed table; reproduced compactly here.

### 5.1 Sprint 0 — Cache-Control immutable on hashed static assets

- **Change.** Set `Cache-Control: public, max-age=31536000, immutable` on hashed static asset responses.
- **Effort.** 1 session.
- **Verification.** `curl -I` on a hashed JS chunk URL; expect the `immutable` directive in the response header.
- **Dependencies.** None.

### 5.2 Sprint 1 — Cloudflare (or equivalent) CDN edge for HTML

- **Change.** Front `scoopfeeds.com` HTML responses with CDN edge.
- **Effort.** 2–3 sessions.
- **Verification.** `curl -I scoopfeeds.com` response includes `x-cache` or equivalent header indicating edge.
- **Dependencies.** Benefits from Sprint 0; not strictly blocked.

### 5.3 Sprint 2 — s-maxage + SWR HTML headers

- **Change.** `Cache-Control: public, s-maxage=120, stale-while-revalidate=600` on HTML responses.
- **Effort.** 1 session.
- **Verification.** `curl -I` on any HTML route; expect the s-maxage + swr directives.
- **Dependencies.** Sprint 1 (CDN edge must be in place to honor s-maxage).

### 5.4 Sprint 3 — SWR pattern on content API responses

- **Change.** Extend `c8917d1` persistent cache pattern to content API: serve cached data immediately while background refresh proceeds.
- **Effort.** 2 sessions.
- **Verification.** Repeated `/api/news` calls show stable response time even under upstream RSS-source slowness.
- **Dependencies.** None.

### 5.5 Sprints 4–6 — Server-render hot routes

- **Change.** Server-render `/` (homepage) and `/topic/:slug` via Vite SSR or small Node SSR layer.
- **Effort.** 4–6 sessions.
- **Verification.** `curl scoopfeeds.com` returns HTML containing article headlines (not just SPA shell with empty `<div id="root">`).
- **Dependencies.** Biggest structural payoff; not strictly blocked but most coherent after Sprints 1+2 ship.

---

## 6. Sequencing

### 6.1 Critical path

The longest dependency chain across the three tracks is:

**Track 2 B.1 codebase reorganization → Track 2 source scoring service implementation (§4.6) → Track 1 source scoring service operation (§3.3) → Track 1 corpus growth to ≥150 sources (§3.6)**

This chain contains the corpus-growth exit criterion. Optimizing this path is the highest-leverage planning move for Phase B.

A parallel long chain runs on Track 1 alone: **Track 1 Reality Index v1 (§3.5) depends on multiple Track 2 BullMQ queue migrations being stable, especially realityIndex queue (§4.5)**.

### 6.2 Parallel work

Work that can ship without blocking on the critical path:

- **Track 3 Sprint 0** (Cache-Control immutable) — 1 session, no dependencies; can ship in the first Phase B week.
- **Track 3 Sprint 1** (CDN edge) — no blocking dependencies on Track 1 or Track 2.
- **Track 1 source discovery service** (§3.1) and **enrichment service** (§3.2) — design and prototype can begin before scoring service implementation is complete.
- **Track 1 Comprehension Layer non-source work** (mobile-first homepage, op-ed MVP, etc.) — independent of the source-scoring critical path; bounded only by founder time and Reality Index dependency for some features.

### 6.3 Recommended early sessions

The first 3–4 sessions of Phase B should focus on:

1. **Track 2 B.1 codebase reorganization start** (1 session). Unblocks all subsequent Track 2 work including scoring service implementation. Pure refactor; no behavioral change.
2. **Track 3 Sprint 0** (1 session). Cache-Control immutable hygiene; near-zero risk; ship-and-forget.
3. **Track 1 source discovery service design** (1–2 sessions). Doesn't block on Track 2; produces design artifact that feeds scoring-service implementation context.
4. **Track 3 Sprint 1** (2–3 sessions). CDN edge integration; high user-visible payoff (first-paint speed); independent of Track 1.

These four early-session work-items respect the no-track-dark rule (every track gets touched in the first ~4 sessions) and start the critical path (Track 2 B.1) without blocking on it.

### 6.4 Phase B opening sprint sequence

Per reconciliation v1 §9.2:

- **Track 1 first work:** mobile-first homepage redesign OR Tracker Auto-Detection Engine v1 — whichever this brief prioritizes. Recommendation: **Tracker Auto-Detection Engine v1**, because it delivers Capability 2 ground-truth (8 trackers across categories) that Reality Index v1 (§3.5) consumes downstream. This recommendation is subject to DrJ confirmation at Phase B kickoff. Conditions on the ground at actual kickoff time (Phase A close-out status, energy, calendar) may favor a different first sprint.
- **Track 2 first work:** B.1 codebase reorganization (above).
- **Track 3 first work:** Sprint 0 Cache-Control immutable (above).

These three first-works can run sequentially (giving DrJ time to settle into 3-track cadence) or with mild parallelism within the first 4–6 sessions.

---

## 7. Phase B kickoff criteria (binding)

Per reconciliation v1 §8.3, Phase B does NOT start until all four of these are true:

1. **Phase A wrapped cleanly.** All Sprint 0–2 issues closed; Phase A retrospective written; no outstanding production incidents.
2. **Strategic clarity on Reality Index.** Either running stable or relief applied.
3. **Operational baseline understood.** A few weeks of post-Phase-A observability data exists.
4. **Time and energy budget realistic.** Phase B is structural work mostly invisible to users — don't start during periods of high user-facing pressure.

These four criteria are non-negotiable. They gate Phase B as a whole; no individual Track 1, Track 2, or Track 3 work item executes before the gate clears.

**Status at this brief authoring:**

| Criterion | Status |
|---|---|
| 1. Phase A wrapped cleanly | **Substantively MET** — Sprint 4 closed (5 of 7 DONE + 2 PARTIAL per session 27); Sprint 6.4 retrospective shipped; Sprint 6.2 production smoke test PASS; no outstanding production incidents per session 27 close |
| 2. Strategic clarity on Reality Index | **MET** — Strategic Plan v6 Capability 3 + Decision 11 lock the v1 sources (Polymarket, Kalshi, Metaculus, AI estimates) |
| 3. Operational baseline understood | **MET** — Phase A retrospective + 86 findings + session-by-session Pace Tracker provide the baseline |
| 4. Time and energy budget realistic | **DrJ judgment call at kickoff time** — not a static condition |

Per session 26 + 27 Pace Tracker estimates, Phase A close-out remaining is 3–7 sessions (down from 5–9 at session 27 estimate, reflecting the Phase 28 commit chain). The kickoff gate is operationally close to clearing.

---

## 8. Phase B exit criteria

Per reconciliation v1 §8.2, Phase B exits when **all** of the following are true. The brief preserves the full list (organized into three groups per reconciliation v1) rather than the simplified 4-criterion subset, because the full list is what the reconciliation locked in.

### 8.1 Load-bearing user-facing (from Strategic Plan v6)

- Homepage above-the-fold = intelligence + comprehension content only
- Mobile Lighthouse score ≥90
- Tracker Auto-Detection Engine operational with ≥10 active trackers across the 8 signal types
- Breaking news alerts live across web push + email + Telegram
- Op-ed perspectives on ≥80% of major events
- Video clips on ≥60% of major events
- 3 newsletter products with ≥30% open rates
- **≥150 active sources with quality scores** (the single most-cited Phase B exit criterion across documents)
- Combined social followers ≥10,000 across X + LinkedIn + Instagram
- ≥3% engagement rate average on social
- ≥10,000 search queries per month on Scoop
- Scoop returns dossiers / trackers as top results for ≥60% of category-relevant queries
- Returning user rate ≥25%
- Telegram channel subscribers ≥5,000

### 8.2 Architectural durability (from Skills Architecture v1)

- Codebase organized by skill folder per skills/ taxonomy
- Skill contract documentation exists and is followed
- Linter rules enforce skill boundaries (cross-skill imports blocked or flagged)
- Image/video pipeline successfully isolated as POC
- 5 BullMQ migrations live in production (`USE_BULLMQ=true` on at least the worker process)

### 8.3 Performance infrastructure (from Track 3)

- Hashed asset Cache-Control header set to `public, max-age=31536000, immutable`
- CDN edge layer fronts `scoopfeeds.com` HTML responses (verifiable via `x-cache` or equivalent header)
- HTML routes return `Cache-Control: public, s-maxage=120, stale-while-revalidate=600`
- SWR pattern operational on content API responses
- At least one hot route (homepage `/` or topic `/topic/:slug`) server-rendered

### 8.4 Phase B close-out artifacts (per Execution Method v1)

- Phase B Retrospective written (analog to `docs/phases/phase_a_retrospective.md`)
- Phase C Kickoff Brief drafted (analog to this document)

**Total exit criteria:** ~22 individual conditions across 4 groups. Phase B is materially larger than Phase A both in execution scope and in exit-criterion count.

---

## 9. Resource model

### 9.1 Solo founder + AI pattern

DrJ as founder + Claude Code as primary implementer. No team. No advisory panel yet (per methodology v1.1 §6.5 — founder override stays single-human through Phase B). Per finding #84 + #85 institutional lessons, Phase B Brief authoring discipline applies:

- Verify premises against actual code/data state before writing them (finding #84).
- Classify each line item as content vs infrastructure with documented justification; infrastructure items sized in build-effort + annualized-operation-cost terms (finding #85).

### 9.2 Session cadence

Phase A demonstrated ~2 sessions/week sustained with bursts to 4–5 sessions/week during high-energy windows. Phase B expects similar cadence. Per reconciliation v1 §8.4, this maps to:

- Estimated: Months 4–7 (~60–110 sessions at observed velocity)
- Realistic: Months 6–9 (~90–145 sessions)

### 9.3 Per-track session allocation discipline

Per reconciliation v1 §8.5 no-track-dark rule: no track goes more than 4 consecutive sessions without a contribution. Operator discretion on which track to feed within that constraint.

---

## 10. Honest limitations and risks

### 10.1 Resource concentration

Solo founder + AI agents pattern is vulnerable to founder unavailability, AI tool changes, or scope-fatigue. Phase A demonstrated the pattern works for 22 sessions over ~10 weeks; Phase B's 60–145-session estimate stress-tests durability. Mitigation: per-session Pace Tracker entries preserve continuity across founder unavailability windows; methodology + spec documents are self-contained enough that a future collaborator can be brought in mid-phase.

### 10.2 Track 2 architectural unknowns

Codebase reorganization (B.1) scope is uncertain. Could be 4 sessions (light refactor) or 8 sessions (deeper module restructuring) depending on what skill boundaries surface during the work itself. Reconciliation v1 §11 explicitly names "Track 2 exit criteria become impossible" as a trigger to revisit DP1 (authority resolution). Phase B mid-retrospective should explicitly check Track 2 progress against §8.2 architectural exit criteria.

### 10.3 Source onboarding throughput

Decision 16 weekly batch model assumes ~10–20 source onboardings per week. If enrichment service (§3.2) accuracy is below expectation or founder review time becomes a constraint, the 150-source target slips. Mitigation: scoring service validation harness (§3.3 / §4.6) catches scoring-quality issues early; founder-override mechanism per methodology §6.5 catches per-source quality issues; Pace Tracker per-session source count metric should track corpus growth trajectory.

### 10.4 Reality Index v1 scope

Reality Index v1 is genuinely novel work. The 6–10-session estimate (§3.5) reflects honest uncertainty. v1 scope may compress (Polymarket-only at first) or expand (full 4-source triangulation from the start) based on early prototype findings. Phase B retrospective should explicitly capture Reality Index scope decisions made during execution.

### 10.5 Methodology v1.1 may need v1.2 during Phase B

Operating the scoring service at corpus scale will surface new edge cases not visible in the 15-source calibration. Methodology v1.1 calibration was explicit about three v1.1 candidates being decisions deferred to v1.1 review — v1.2 will likely have its own candidates from production-scale operation. Methodology v1.2 should ship within Phase B if needed (§7.2 of methodology authorizes this cadence); Phase B brief plans for this as expected, not exceptional.

### 10.6 Track 3 anti-goal tension

Skills Architecture v1 §8: *"Don't build the platform before the application."* Track 3 Sprints 4–6 (SSR for hot routes) is the most platform-shaped Phase B work. Tension named in reconciliation v1 §6.4 and accepted; brief carries the tension forward without re-litigating it. If during Phase B execution Sprints 4–6 reveal more platform-shaping than expected, Track 3 mid-sequence retrospective should escalate to DrJ for a defer-or-proceed decision.

### 10.7 Phase A close-out audit deferrals

Phase A retrospective documents Sprint 5 social audit + search audit as NOT MET. Per finding #75 + retrospective §2, those audits are honest gaps in Phase A close-out. The brief's position: Phase B kickoff per reconciliation v1 §8.3 does not require the social/search audits as binding conditions (the 4 reconciliation conditions are Phase A wrapped cleanly + Reality Index strategic clarity + operational baseline + time/energy budget). Social/search audit work may happen during Phase B Track 1 as discovery + enrichment work touches those areas naturally — or may be deferred to Phase C as scope discipline.

---

## 11. What's explicitly NOT in scope for Phase B

Re-stating §1.3 as a discrete reference list:

- **Creator methodology / individual creator scoring** — Phase C scope per finding #86. Architectural slot reserved in Source Scoring Service Spec §2.5; not implemented in v1 service.
- **Three-layer host + guest + episode composite scoring** for interview-format content — Phase C scope per finding #86 architectural artifact.
- **Translation pipeline at scale beyond Urdu** — Phase C scope per Decision 6 + finding #82.
- **Non-English source ingestion at scale** — Phase C scope.
- **Paid licensing / commercial deployment** — Phase D+ scope per Strategic Plan v6 §9.
- **Mobile native apps** — Phase D+ scope per Decision 8.
- **Public API for third-party developers** — Phase D+ scope.
- **Editorial advisory panel** — Phase D scope per methodology v1.1 §9.4. Founder override remains single-human through Phase B.
- **New strategic capabilities beyond Strategic Plan v6 Capabilities 1–4** — Phase C+ scope or Strategic Plan v7+ revision.

---

## 12. Related documents

- **[Strategic Plan v6.0](../strategy/strategic_plan_v6.md)** — §3 Capabilities, §9 Phased Roadmap (Phase B definition + exit criteria source).
- **[Decisions Log v1.0](../strategy/decisions_log_v1.md)** — Decisions 6 (Urdu through Phase D), 7 (open methodology + proprietary weights), 9 (brand refresh), 11 (Reality Index v1 sources), 12 (Tracker Auto-Detection), 16 (source onboarding workflow + weekly batch cadence), 19 (social platform priority), 25 (search ad model), 26 (anonymous search query limits).
- **[Strategic-Tactical Reconciliation v1.0](../strategy/strategic_tactical_reconciliation_v1.md)** — §5.4 (Track 1 Phase B work-area enumeration), §6.4 (Track 3 Sprint 0–6 detail), §8 (Reconciled Phase B Definition — source of truth for track structure, exit criteria, kickoff criteria, duration estimate, coordination).
- **[Skills Architecture v1](../strategy/skills_architecture_v1.md)** (if present in repo) — §7 Phase B work items (Track 2 deliverables); §8 anti-goal language; §10 binding kickoff criteria.
- **[Comparative Analysis v1](../research/comparative_analysis_v1.md)** — §7 Track 3 Sprint 0–6 source.
- **[Source Credibility Methodology v1.1](../content/source_credibility_methodology.md)** — operative scoring rubric for Phase B.
- **[Source Scoring Service Specification v1.0](../specs/source_scoring_service.md)** — Track 1 + Track 2 cross-deliverable spec.
- **[Phase A Source Audit Phase 2 Calibration](../audits/phase_a_source_audit_phase2_calibration.md)** — 15-source v1.0 calibration; validation harness ground-truth for scoring service.
- **[Phase A Source Audit Phase 2 Gap Analysis](../audits/phase_a_source_audit_phase2_gap_analysis.md)** — 40 net new sources priority list for corpus growth (§3.6).
- **[Phase A Retrospective v1.0](phase_a_retrospective.md)** — Phase A close-out synthesis; carryover practices (especially §5).
- **[Phase A Retrospective Inputs](phase_a_retrospective_inputs.md)** — 86 findings; particularly #75 (audit gap framing), #76 (architectural breadcrumb pattern), #85 (Sprint 4.5 architectural reframing), #86 (creator methodology Phase C scope reservation).
- **Migration 002:** `backend/src/db/migrations/002_sources_table.js` — schema for quality scoring data.

---

## Changelog

**v1.0 — May 17, 2026 (Session 28, Phase 28.C).** Initial Phase B Kickoff Brief. Three-track structure self-contained per DEC1 with reconciliation v1 §8.1 as binding source. Phase B scope per Strategic Plan v6 §9. Source Scoring Service (Phase 28.B spec) as Track 1 + Track 2 cross-deliverable. Creator methodology slot reserved for Phase C per finding #86. Phase B exit criteria preserved from reconciliation v1 §8.2 in full (22 conditions across 4 groups). Phase B kickoff criteria preserved from reconciliation v1 §8.3 (4 binding conditions). Phase B duration estimate Months 4–7 (Months 6–9 realistic) per reconciliation v1 §8.4.
