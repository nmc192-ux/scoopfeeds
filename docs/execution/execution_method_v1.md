# Scoopfeeds Execution Method v1.0
## How Strategic Plans Become Working Software

**Document type:** Operational SOP (stable across all phases)
**Version:** 1.0
**Owner:** DrJ (Founder)
**Companion documents:** Strategic Plan v6.0, Decisions Log v1.0
**Review cadence:** Annually or upon material methodology change
**Last updated:** May 2026

---

## 0. Purpose

This document defines **how** Scoopfeeds gets built. The Strategic Plan v6 defines *what* gets built and *why*. The Decisions Log v1 captures *which* strategic choices have been locked. This document is the missing third piece: the operational pattern that turns strategy into shipping software.

It exists as a separate document because:
- The strategic plan describes a stable destination but should not be re-edited every time execution learns something new
- Execution methodology should be stable across phases (the way work gets done shouldn't change phase-to-phase) while phase-specific content does change
- Future collaborators (Claude Code, part-time engineers, editors) need a clear pattern to follow without reading the entire strategic context

**Who reads this document:**
- DrJ (primary operator)
- Claude Code (execution agent, when given this document as context)
- Any future hire (part-time engineer in Phase D+, editor in Phase E+)
- Anyone reviewing or auditing how Scoopfeeds operates

**What this document is NOT:**
- A specific phase plan (those are the Phase Kickoff Briefs)
- A list of features to build (that's the Strategic Plan)
- A list of decisions made (that's the Decisions Log)
- A coding style guide (separate engineering doc, written when needed)

---

## 1. The Four-Layer Structure

Work flows through four layers of increasing specificity. Each layer has its own document type, cadence, and stability characteristics.

### Layer 1 — Strategic Plan
**What:** The platform vision, capabilities, layers, phases, metrics, risks. The "why" and "what."
**Document:** Strategic Plan v6 (currently); revised only when explicit triggers fire.
**Stability:** Quarterly review; structural changes are rare.
**Length:** ~1,000 lines.
**Audience:** All collaborators, partners, investors.

### Layer 2 — Phase Kickoff Brief
**What:** The detailed execution plan for one specific phase (A, B, C, D, or E). Translates that phase's strategic goals into concrete work — infrastructure, backend, frontend, data, content, social, ops — with sprint-by-sprint sequencing, dependency maps, and verification criteria.
**Document:** Phase A Kickoff Brief, Phase B Kickoff Brief, etc.
**Stability:** Drafted at phase start; updated mid-phase only when material learnings invalidate prior assumptions.
**Length:** ~30-50 pages per phase.
**Audience:** DrJ, Claude Code (with context), execution collaborators.
**Drafted:** At the start of each phase, after the prior phase's retrospective.

### Layer 3 — Sprint Plan
**What:** A two-week work plan within a phase. Lists ~5-15 issues to be completed in that sprint, with priority order, dependencies, and assigned executors.
**Document:** Sprint plan in GitHub Project (or equivalent issue tracker).
**Stability:** Drafted at sprint start; revised only when blockers force scope changes.
**Length:** Issue list with descriptions; ~1-2 pages of summary.
**Audience:** DrJ, Claude Code, executors.

### Layer 4 — Issue + Just-in-Time Claude Code Prompt
**What:** A single discrete unit of work (1-3 days of effort) with acceptance criteria, plus the Claude Code prompt generated at the moment of execution against the current codebase state.
**Document:** GitHub issue + ad-hoc prompt (saved in issue comment for auditability).
**Stability:** Issue is stable once "ready"; prompt is generated when work starts.
**Length:** Issue ~200-400 words; prompt ~500-2000 words depending on complexity.
**Audience:** Whoever executes the work.

### Why this layering matters

**Stability decreases as specificity increases.** Layer 1 (Strategic Plan) almost never changes; Layer 4 (prompts) is regenerated for every issue. Trying to pre-write Layer 4 content months in advance is the most common planning mistake — the codebase state at the moment of execution is unknown, so prompts written too early are wrong on details that matter.

**Each layer feeds the next.** Strategic Plan → Phase Kickoff Brief → Sprint Plan → Issues + Prompts. No layer is created in isolation. No layer is skipped.

**Each layer has a single source of truth.** The Strategic Plan lives in one document. The Phase Kickoff Brief lives in one document per phase. Sprint Plans live in the issue tracker. Prompts live in issue comments at the time of execution. No duplication; no drift.

---

## 2. The Phase Lifecycle

A phase is a 2-4 month execution unit with a defined strategic goal, exit criteria, and retrospective. Phases are dependency-ordered (Phase A → B → C → D → E); they are not concurrent.

### Phase Kickoff (Days 1-7)

Before phase work begins:

1. **Read the predecessor's retrospective** (if any). Capture what was learned that affects this phase.
2. **Re-read the Strategic Plan's section for this phase.** Confirm exit criteria are still relevant; flag anything that has shifted.
3. **Audit the current state** of relevant systems (codebase, sources, social, search, etc.) so the brief is grounded in reality, not assumptions.
4. **Draft the Phase Kickoff Brief** — see Section 11 for template.
5. **Validate dependencies and prerequisites.** External APIs, third-party access, infrastructure, source-data availability.
6. **Sequence the work into sprints** (~6-8 sprints per phase typically). Each sprint has a coherent theme and is sized for completion.
7. **Lock the brief.** Once locked, it becomes the reference document for the phase.

### Phase Execution (Weeks 2 - end)

- Sprints execute on 2-week cadence (see Section 3).
- A mid-phase checkpoint at the halfway point: are we on track to exit criteria? If not, adjust scope (preferred) or extend timeline (last resort).
- The Phase Kickoff Brief is updated only when material learnings invalidate prior assumptions. All updates are dated and documented.
- Strategic decisions are NOT re-litigated mid-phase. If something fundamental seems wrong, halt and reassess; do not silently drift.

### Phase Exit (Last 1-2 weeks)

1. **Exit criteria verification.** Each criterion from the Phase Kickoff Brief is checked. Met / partial / not-met.
2. **Production smoke test.** Verify the phase's deliverables work in production, not just in development.
3. **Metrics capture.** Snapshot all relevant success metrics; compare to baseline and to phase targets.
4. **Phase Retrospective** (see Section 11 for template). Captures: what worked, what didn't, what was learned, what changed in assumptions, what the next phase needs to address that wasn't anticipated.
5. **Decisions Log review.** Were any strategic decisions revised during the phase? If yes, document the revision with date and rationale.
6. **Hand off to next phase.** The retrospective + updated metrics become inputs to the next Phase Kickoff Brief.

### When phases slip

Phases will slip. The honest pattern across solo founder + AI execution is roughly 1.3-1.8× the originally estimated timeline.

**Acceptable response to slip:**
- Reduce scope of current phase if exit criteria can be partially met and remaining work folded into next phase
- Extend timeline by 2-4 weeks if scope is critical
- Document the slip and its cause in the retrospective

**Not acceptable response to slip:**
- Silent extension without documentation
- Skipping retrospective to "save time"
- Re-opening strategic plan to remove phase exit criteria

---

## 3. The Sprint Lifecycle

A sprint is two weeks. Within a phase, sprints execute sequentially. Each sprint has a theme aligned with the phase brief.

### Sprint Planning (Monday morning, ~30 minutes)

1. Review the Phase Kickoff Brief's sprint sequence. Confirm this sprint's theme.
2. Pull issues from phase backlog that fit the sprint theme.
3. Size the sprint: ~5-15 issues, sized in hours per Section 4.
4. Identify dependencies (which issues block which).
5. Identify prerequisites (third-party access, API keys, design assets).
6. Commit to the sprint backlog. Once committed, scope does not expand mid-sprint.

### Sprint Execution (Daily, throughout the two weeks)

- Pull the next ready issue from the backlog.
- Execute (see Section 4 issue lifecycle and Section 5 prompt generation).
- Mark complete when Definition of Done is met (see Section 6).
- If blocked, document the blocker in the issue and pull the next available issue.
- Log time spent (rough; not for accountability — for future estimation calibration).

**Daily check-in:** Even if you're a solo founder + AI, a 5-minute daily review of "what's in progress, what's blocked, what's done" prevents drift. Can be a simple notes file.

### Sprint Review (Friday afternoon of week 2, ~30 minutes)

1. Review completed issues. What shipped?
2. Review unfinished issues. Why? Pull into next sprint or back to backlog?
3. Update phase metrics dashboard.
4. Production smoke test for anything user-facing that shipped.
5. Note anything for the phase retrospective.

### Sprint Retrospective (Optional weekly; required end-of-phase)

Mid-phase retrospectives are optional but useful when something feels off. End-of-phase retrospective is mandatory (see Section 2).

---

## 4. The Issue Lifecycle

Issues are the atomic unit of work. One issue = one discrete deliverable, sized for 1-3 days of focused work.

### Issue Template

Every issue contains:

```
Title: [Verb-first, specific. "Fix the Urdu RTL flag in App.jsx" not "RTL bug"]

Context:
- Why this issue exists
- What strategic phase / sprint theme it belongs to
- Reference to Phase Kickoff Brief section

Acceptance Criteria:
- [ ] Specific, testable condition 1
- [ ] Specific, testable condition 2
- [ ] Specific, testable condition 3
(Typically 3-7 criteria. Less than 3 = too vague. More than 7 = issue should be split.)

Dependencies:
- Issue #X must complete before this can start (if any)
- Requires ADMIN_BEARER_TOKEN configured (if any)
- Requires Brave Search API key (if any)

Size: XS / S / M / L / XL (see sizing below)

Verification:
- How will completion be verified? (Specific commands, smoke tests, manual checks)

Notes:
- Anything else relevant
```

### Issue Sizing

| Size | Estimated Effort | Example |
|---|---|---|
| **XS** | < 1 hour | Config flip, single-line code change, env var update |
| **S** | 1-3 hours | Single-file edit, simple test, basic UI tweak |
| **M** | 3-8 hours (one focused day) | Single-feature implementation, modest refactor |
| **L** | 1-3 days | Multi-file feature, integration with new third-party service |
| **XL** | 3-5 days (should be SPLIT) | Anything larger should be broken into multiple issues |

**Discipline:** No issue larger than L gets pulled into a sprint. XL = split before sprint planning.

### Issue States

- **Backlog:** Drafted but not ready to start (missing context, dependencies unmet, etc.)
- **Ready:** All prerequisites met, can be pulled into a sprint
- **In-progress:** Actively being worked on
- **Review:** Implementation complete, awaiting verification
- **Done:** Verified per Definition of Done

### Definition of Done

An issue is Done when:
1. All acceptance criteria are checked off
2. Code passes type checks, linter, and existing tests
3. New functionality has at least basic test coverage (unit or integration)
4. Code is merged to `main` (no long-lived feature branches)
5. If user-facing: deployed to production AND verified working in production
6. If user-facing: appropriate metrics instrumentation added
7. Documentation updated (in-code comments for non-obvious choices; README updates if user-facing changes)

If an issue is "done in code but not in production," it is not Done. Production verification is part of completion.

---

## 5. Just-in-Time Claude Code Prompts

This is the most important methodological choice in this document.

### The principle

Claude Code prompts are generated at the moment of execution, against the actual current state of the codebase. They are NEVER pre-written more than ~24 hours in advance.

### Why JIT

- The codebase changes constantly. A prompt written today for next month's issue assumes the codebase looks like it does today; by next month, file paths, function names, and architectural patterns have shifted.
- AI-generated code quality depends heavily on the context provided. Generic prompts produce generic code. Current-state-aware prompts produce code that fits the actual codebase.
- Pre-written prompts incentivize batch execution ("let me run all 20 prompts at once") which produces low-quality work because review can't keep up.

### Prompt Generation Pattern

Every prompt has four sections:

```
1. CONTEXT (what Claude Code needs to know about the current codebase)
   - Relevant file paths and their current state
   - Architectural patterns being followed
   - Recent related changes (last 5-10 commits relevant to this area)
   - Conventions specific to this codebase (naming, structure, error handling)

2. TASK (what to do)
   - The specific change to be made
   - The acceptance criteria from the issue
   - Any explicit constraints

3. VERIFICATION (how to know it worked)
   - Tests to run after the change
   - Manual verification steps
   - What "done" looks like

4. NOTES (anything else)
   - Tradeoffs to be aware of
   - Alternative approaches considered and rejected
   - Things to avoid
```

### Prompt Review Pattern

Before executing any prompt:

1. **Read the prompt out loud** (or in your head, if alone). If it doesn't make sense to you, it won't produce sensible code.
2. **Check the context section.** Is the current state actually current? Has the codebase changed since the prompt was drafted?
3. **Check the acceptance criteria.** Are they still the right criteria, or has scope shifted?
4. **Run the prompt.** Save the prompt + Claude Code's response in the issue comments for auditability.
5. **Verify the output.** Does the code do what was asked? Does it follow conventions? Does it pass tests?

### Common Prompt Templates by Work Type

Different types of work have different prompt patterns. The template below is a starting point for each; specifics adapt to the actual issue.

**Infrastructure / Deployment / Config:**
```
CONTEXT:
- Current deployment platform: [Hostinger / Docker / Fly.io / etc.]
- Current env config: [show .env.example]
- Current Dockerfile / docker-compose: [show file]
- Recent infrastructure changes: [git log filtered to infra files]

TASK:
- [Specific infrastructure change]
- Update .env.example accordingly
- Update relevant documentation

VERIFICATION:
- Deploy succeeds without errors
- Health check at /api/health returns expected response
- Affected functionality works in production
- No regressions in unaffected functionality

NOTES:
- Production deploys must be verified, not just dev
- Document any new env vars
```

**Backend (services, jobs, APIs):**
```
CONTEXT:
- Current service file: [path and content]
- Related routes / handlers: [paths]
- Database schema for affected tables: [show schema]
- Existing test patterns: [show one example test]

TASK:
- [Specific backend change]
- Follow existing patterns (logging, error handling, response format)
- Add appropriate tests

VERIFICATION:
- Unit tests pass
- Integration tests pass (if applicable)
- Affected endpoints return correct responses
- Error cases handled correctly

NOTES:
- Use the standardized API response helper
- Add request_id logging for new endpoints
```

**Frontend (UI, mobile, accessibility):**
```
CONTEXT:
- Component path: [path and current content]
- Related components: [paths]
- Design system tokens: [color, typography, spacing]
- Accessibility requirements: WCAG 2.1 AA minimum

TASK:
- [Specific UI change]
- Follow existing component patterns
- Mobile-first (start at 375px width)
- RTL-correct for Urdu

VERIFICATION:
- Renders correctly at 375px, 768px, 1280px
- Lighthouse score ≥90 on key metrics
- Keyboard navigation works
- Screen reader announces correctly

NOTES:
- Use existing Tailwind utility classes; no custom CSS
- Test in Urdu mode for RTL correctness
```

**Data (sources, ingestion, dedup, enrichment):**
```
CONTEXT:
- Current ingestion service: [path and content]
- Current source list: [show sources file]
- Existing ingestion patterns: [show one example]
- Schema for affected tables: [show schema]

TASK:
- [Specific data change]
- Follow existing ingestion patterns
- Handle errors gracefully (log, don't crash)
- Idempotent if possible

VERIFICATION:
- New source ingests successfully
- Dedup works correctly with new content
- No regressions in existing sources
- Source quality score is computed

NOTES:
- All new sources need credibility scoring
- Translation pipeline applies for non-English
```

**AI/ML (prompts, models, evaluation):**
```
CONTEXT:
- Current AI service: [path and content]
- Current model routing: [show routing logic]
- Cost dashboard: [current per-event / per-query costs]
- Existing evaluation tests: [show one example]

TASK:
- [Specific AI change]
- Use multi-model routing (cheap for routine, premium for complex)
- Track costs in standard cost dashboard
- Add evaluation test for accuracy

VERIFICATION:
- Accuracy ≥ target on test set
- Cost per call ≤ budget
- Hallucination rate < 1% on sensitive content
- Citations present and valid

NOTES:
- Zero-tolerance for hallucination on factual claims
- "I don't know" preferred over fabrication
```

**Content (editorial, social, newsletters):**
```
CONTEXT:
- Brand voice guidelines: [show or reference]
- Per-platform style for [platform]: [show guidelines]
- Existing content templates: [show example]

TASK:
- [Specific content change]
- Follow per-platform brand voice
- Include appropriate citations / attribution
- Avoid sensationalism, partisan framing

VERIFICATION:
- Content reviewed and approved (Phase B: human review every post)
- Citations verified
- Brand voice consistent
- Appropriate disclaimers present

NOTES:
- AI-generated content always labeled
- Sensitive topics get extra review
```

**Operations (monitoring, alerting, incidents):**
```
CONTEXT:
- Current monitoring setup: [Sentry / health checks / etc.]
- Current alert thresholds: [show config]
- Recent incidents: [reference]

TASK:
- [Specific ops change]
- Add appropriate monitoring
- Define alert thresholds based on baseline
- Document runbook for new alerts

VERIFICATION:
- Alert fires on test condition
- Dashboard shows new metric
- Runbook is clear
- On-call (DrJ) understands what to do

NOTES:
- Alert fatigue is real; tune thresholds carefully
- Every new alert needs a runbook
```

---

## 6. Quality Gates

Quality is verified at four levels. Skipping a level eventually causes regressions.

### Level 1 — Code Quality

Every change passes:
- Type checks (TypeScript, where applicable)
- Linter (ESLint, where applicable)
- Existing test suite
- New test coverage for new functionality (basic unit or integration)

This is automated via CI/CD. If CI is red, work doesn't merge.

### Level 2 — Integration

Every user-facing change passes:
- Integration test in a staging-like environment
- Smoke test of affected user flows
- Performance check (no regression > 20% on key metrics)

### Level 3 — Production

Every user-facing change is verified in production after deploy:
- Health check passes
- Affected functionality works (manual smoke test or automated post-deploy check)
- No new errors in Sentry within 30 minutes of deploy
- Metrics are flowing correctly

If production verification fails, rollback within 15 minutes. Don't try to fix forward in production.

### Level 4 — Strategic Alignment

Every phase exit verifies:
- Strategic Plan exit criteria met
- Decisions Log decisions still hold (or revisions documented)
- Risk register updated with phase learnings
- Metrics align with phase targets

---

## 7. Documentation Discipline

What gets written down, where, when. The discipline is to write down enough that work compounds; not so much that documentation becomes the work.

### What gets written down

| Artifact | Where | When |
|---|---|---|
| Strategic Plan | Repo `/docs/strategy/` | Drafted once; revised quarterly |
| Decisions Log | Repo `/docs/strategy/` | Updated when decisions revised |
| Phase Kickoff Brief | Repo `/docs/phases/` | At start of each phase |
| Sprint Plan | GitHub Project | At start of each sprint |
| Issues | GitHub Issues | Continuously |
| Claude Code prompts | Issue comments | At time of execution |
| Code-level docs | Inline comments + README | With each change |
| API docs | OpenAPI / Swagger | With each API change |
| Runbooks | Repo `/docs/ops/` | When new ops surfaces are added |
| Phase Retrospectives | Repo `/docs/phases/` | At end of each phase |
| Risk register updates | Strategic Plan Section 11 | Quarterly + after incidents |
| External dependencies | Repo `/docs/dependencies.md` | When new dependency added |

### What does NOT get written down

- Day-to-day chatter
- "I'm thinking about X" without committing to action
- Speculation about future phases not yet kicked off
- Documentation about features that don't exist yet (write the docs when the feature ships)

### Versioning convention

- Strategic documents: `vX.Y` semantic versioning. Major (X) for structural changes; minor (Y) for refinements.
- Phase documents: dated, no version (`Phase A Kickoff Brief - 2026-05-15`).
- All documents have a "Last updated" date and an explicit owner.

### Stale-document handling

When a document goes stale:
1. **First:** check if it should be updated (information evolved) or archived (information no longer relevant).
2. **If updating:** make the change, bump version or date, note what changed at the top.
3. **If archiving:** move to `/docs/archive/` with a note about why archived.
4. **Never:** delete documents silently. Archive preserves history.

---

## 8. Cadence and Rituals

The rhythms of execution. Skipping these doesn't save time; it just means the work is happening without the loop that makes it improve.

### Weekly

| Day | Activity | Duration |
|---|---|---|
| Monday morning | Sprint planning (start of new sprint) OR sprint review prep | 30 min |
| Daily | Quick status check (in-progress / blocked / done) | 5 min |
| Friday afternoon | Sprint review (end of sprint week 2) OR mid-sprint check | 30 min |

### Bi-weekly

| Activity | When | Duration |
|---|---|---|
| Sprint planning + retrospective | End of each 2-week sprint | 60 min combined |

### Monthly

| Activity | Duration |
|---|---|
| Metrics dashboard review (all phases) | 60 min |
| Risk register review (any new risks?) | 30 min |
| Cost dashboard review (AI inference, search backbone, etc.) | 30 min |

### Per-Phase

| Activity | Duration |
|---|---|
| Phase Kickoff Brief drafting | 1-2 days |
| Mid-phase checkpoint | 90 min |
| Phase Retrospective | 90 min |

### Quarterly

| Activity | Duration |
|---|---|
| Strategic Plan review (does it still hold?) | 2-3 hours |
| Decisions Log review (any triggers fired?) | 60 min |
| Comparison set review (peers, competitors, what's changed externally) | 60 min |

---

## 9. Roles and Decision Authority

### Phase A-C (Solo founder + AI execution)

| Role | Held by | Authority |
|---|---|---|
| Strategic decisions | DrJ | All decisions in Decisions Log; revisions require documented trigger |
| Phase planning | DrJ + Claude Code (drafting); DrJ approves | Phase Kickoff Briefs locked by DrJ |
| Sprint planning | DrJ | Sprint backlog committed by DrJ |
| Issue creation | DrJ + Claude Code (drafting); DrJ approves "ready" state | Issues can be drafted by Claude Code; DrJ moves to "ready" |
| Code execution | Claude Code | Code is generated by Claude Code under DrJ's review |
| Code review | DrJ (light review) + automated (CI/CD) | DrJ reviews Claude Code output before merge |
| Production deploys | DrJ | Final approval; verification; rollback authority |
| Content review | DrJ (Phase B every post; Phase C high-stakes only) | Content not labeled "AI-generated" requires DrJ approval |

### Phase D-E (Adding part-time engineer + editor)

| Role | Held by | Authority |
|---|---|---|
| Strategic decisions | DrJ | Unchanged |
| Phase planning | DrJ + collaborators (drafting) | DrJ locks |
| Code execution | Part-time engineer + Claude Code | Engineer reviews Claude Code; DrJ reviews engineer |
| Content / editorial | Part-time editor | Editor reviews AI-generated; DrJ reviews editor on high-stakes |
| Production deploys | DrJ + engineer (with documented playbook) | Engineer can deploy with DrJ approval; DrJ can deploy directly |

### Decision authority principles

- **DrJ is always the final decision-maker.** Collaborators advise, draft, propose; DrJ approves.
- **Claude Code is an execution agent, not a decision authority.** It generates code, drafts plans, suggests options. It does not make strategic, editorial, or financial decisions.
- **Decisions Log is binding.** No collaborator can override a logged decision without going through the documented review trigger.
- **Disagreement is resolved by re-reading the Strategic Plan.** If two collaborators disagree on direction, the answer is in the strategic documents. If it isn't, that's a strategic gap and goes to DrJ.

---

## 10. When Things Don't Go to Plan

Software execution does not go to plan. The discipline is responding to that reality without abandoning the plan or pretending nothing happened.

### Sprint slip (common, low-stakes)

**Pattern:** A sprint reaches Friday with unfinished issues.
**Response:**
1. Identify why specific issues didn't complete (estimation error, blocker, scope creep)
2. Pull unfinished issues into next sprint OR back to backlog (case by case)
3. Note the slip and cause in sprint review
4. **Do not** add the slipped work to next sprint's scope without removing equivalent work — sprints don't grow indefinitely

### Phase slip (common, medium-stakes)

**Pattern:** A phase reaches its planned end without all exit criteria met.
**Response:**
1. Identify which exit criteria are unmet and why
2. Decide: extend the phase by 2-4 weeks, OR move unmet criteria to next phase, OR drop them
3. Document the decision in the Phase Retrospective
4. **Do not** silently extend without documentation
5. **Do not** declare phase exit when criteria are unmet

### Strategic plan invalidation (rare, high-stakes)

**Pattern:** Execution reveals that a strategic assumption was wrong (e.g., audience research shows the target audience doesn't want what we're building, a competitor releases something that changes the market, a regulatory change makes a feature impossible).
**Response:**
1. **Halt work** in the affected area
2. Document what was learned
3. Convene a strategic review (DrJ + key context)
4. Decide: revise the Strategic Plan, OR adjust the Phase Kickoff Brief without changing the Strategic Plan, OR confirm the plan and continue
5. Document the decision and update appropriate documents
6. **Do not** silently drift away from the plan; either revise it explicitly or follow it

### Halt conditions

Stop work and reassess if:
- A security vulnerability is discovered that affects users
- An accuracy failure damages credibility (e.g., a viral wrong AI answer)
- A legal issue arises (copyright complaint, terms-of-service violation, regulatory inquiry)
- A core dependency fails permanently (e.g., key third-party API discontinued without replacement)
- An ethical concern arises that conflicts with platform values

### When NOT to halt

- Sprint slips (just adjust scope)
- Phase slips (extend or descope)
- Disagreement about approach (resolve with strategic plan reference)
- Unfamiliar problem (research, don't halt)

---

## 11. Templates

The actual document templates referenced throughout this method.

### 11.1 Phase Kickoff Brief Template

```
# Phase [X] Kickoff Brief: [Phase Theme]

## Metadata
- Phase: A / B / C / D / E
- Strategic goal: [from Strategic Plan Section 9]
- Timeline: [start date - target end date]
- Predecessor retrospective: [link if applicable]

## Current state assessment
- What's working
- What's broken
- What audits revealed (sources, social, search, etc.)
- What predecessor phase delivered

## Strategic alignment
- Which Strategic Plan exit criteria does this phase address?
- Which Decisions Log decisions affect this phase?
- Which capabilities (1-5) are touched?
- Which layer(s) are affected?

## Sprint sequence (typically 6-8 sprints, ~12-16 weeks)
For each sprint:
- Sprint number and theme
- Estimated duration
- Key deliverables
- Dependencies on prior sprints

## Detailed work breakdown
By work type:
- Infrastructure / deployment
- Backend (services, jobs, APIs)
- Frontend (UI, mobile, accessibility)
- Data (sources, ingestion, dedup, enrichment)
- AI/ML (prompts, models, evaluation)
- Content (editorial, social, newsletters)
- Operations (monitoring, alerting, incidents)

For each work item:
- Description
- Sprint assignment
- Dependencies
- Acceptance criteria
- Verification approach

## External dependencies
- Third-party services required (with status: confirmed / in-progress / blocked)
- API keys needed
- Infrastructure access required
- Design assets required

## Risks specific to this phase
- New risks not in Strategic Plan
- Mitigation plans

## Success metrics
- Metrics to instrument during this phase
- Phase target values
- Baseline values (from end of prior phase)

## Phase exit criteria
- Specific, measurable, verifiable
- Aligned with Strategic Plan Section 9 exit criteria for this phase
- Includes production verification, not just code completion
```

### 11.2 Phase Retrospective Template

```
# Phase [X] Retrospective: [Phase Theme]

## Metadata
- Phase completed: [date]
- Original target: [date]
- Slip: [days/weeks, or "on time"]

## Exit criteria status
For each exit criterion from the brief:
- Met / Partial / Not Met
- If not fully met: explanation and remediation plan

## What worked well
- Practices, decisions, tools that compounded value
- Things to keep doing

## What didn't work
- Practices, decisions, tools that hindered execution
- Things to stop doing

## What was learned
- About the codebase
- About the audience
- About the technology
- About the team's velocity

## Surprises
- Things that took much longer than expected (and why)
- Things that took much less time than expected (and why)
- Unforeseen dependencies or blockers

## Strategic plan implications
- Anything in this phase that should change Strategic Plan v6?
- Anything in Decisions Log that should be revised?
- Anything in next Phase Kickoff Brief that needs adjustment?

## Metrics snapshot
- All success metrics: current values vs targets vs baseline

## Risk register updates
- New risks identified
- Existing risks resolved
- Existing risks evolved

## Inputs to next phase
- Critical context the next Phase Kickoff Brief needs to incorporate
- Open issues being carried forward
```

### 11.3 Sprint Plan Template

```
# Sprint [N] Plan: [Sprint Theme]

## Metadata
- Sprint number: N
- Phase: A / B / C / D / E
- Start date: [Monday]
- End date: [Friday two weeks later]

## Sprint theme
- One-paragraph description of what this sprint accomplishes
- Reference to Phase Kickoff Brief sprint sequence

## Committed issues
[Ordered by priority and dependency]
- Issue #X: [Title] (Size: M)
- Issue #Y: [Title] (Size: S, depends on #X)
- ...

## Prerequisites
- API keys / access required: [status]
- Designs / content needed: [status]
- Decisions needed: [status]

## Risks for this sprint
- Specific blockers anticipated
- Mitigation plans
```

### 11.4 Issue Template

[See Section 4]

### 11.5 Claude Code Prompt Template

[See Section 5]

---

## 12. Anti-patterns to Avoid

Based on observed failure modes in solo founder + AI execution.

### Pre-writing prompts for distant phases

**Why it fails:** Codebase state at execution time is unknown when prompts are written months ahead.
**Instead:** Write prompts JIT, when the issue is being worked on.

### Treating the Strategic Plan as a contract

**Why it fails:** The plan is a compass, not a contract. Treating it as immutable means execution learnings can't update it; treating it as infinitely revisable means it provides no guidance.
**Instead:** Strategic Plan changes only with documented triggers (see Decisions Log review schedule).

### Skipping retrospectives

**Why it fails:** Without retrospectives, learnings are lost; mistakes repeat; improvements don't compound.
**Instead:** Retrospective at every phase exit, even if the phase went well. The review *is* part of the work.

### Adding scope mid-sprint

**Why it fails:** Sprints exist precisely to commit to bounded scope. Adding mid-sprint means commitments mean nothing.
**Instead:** Capture new ideas in a backlog file. Address in next sprint planning, not now.

### Confusing planning with progress

**Why it fails:** Planning produces documents; execution produces working software. At some point, more planning is procrastination.
**Instead:** When the question is "should I plan more or execute?", default to executing.

### Pre-merging strategy and execution documents

**Why it fails:** When strategy and execution share a document, every execution learning forces a strategy revision. Documents become unstable; reading them becomes a chore.
**Instead:** Strategy in Strategic Plan. Execution in Phase Kickoff Briefs. Operations in this document.

### "I'll write the docs later"

**Why it fails:** Later never comes. Documentation written months after the work has lost the context that made it valuable.
**Instead:** Documentation is part of Definition of Done, not a separate task.

### Manually deploying without verification

**Why it fails:** "It works on my machine" is the historical first cause of production failures.
**Instead:** Production smoke test is part of Definition of Done for any user-facing change.

### Carrying issues across multiple sprints silently

**Why it fails:** An issue in three consecutive sprints with no progress is signaling something — usually that it's bigger than estimated, blocked, or unclear. Silent carry-over hides this signal.
**Instead:** If an issue doesn't complete in its sprint, the sprint review either pulls it forward (with explanation) or sends it to backlog. Never silent.

### Treating Claude Code as a decision-maker

**Why it fails:** Claude Code is an execution agent. Asking "should we use Postgres or SQLite?" treats it as a strategic authority. It will give an answer, but the answer is not authoritative.
**Instead:** Strategic decisions go through the founder + Decisions Log. Claude Code executes the decided strategy.

---

## 13. Metrics for Execution Itself

How to know if this method is working.

| Indicator | Healthy signal | Warning signal |
|---|---|---|
| Sprint commitment vs delivery | 80-100% issues completed per sprint | <60% repeatedly |
| Phase exit on or near target date | Within 25% of target | >50% slip without scope reduction |
| Retrospective insights acted on | Most insights generate sprint or phase changes | Insights documented but ignored |
| Issue size accuracy | Estimates within 50% of actual | Estimates consistently 2x+ off |
| Strategic plan stability | Quarterly review with minor updates | Constant strategic plan rewrites |
| Decisions Log additions | Rare, with documented triggers | Frequent without triggers |
| Production incidents | Rare, post-mortem documented | Frequent or undocumented |
| Documentation freshness | Most docs <30 days from current state | Many docs months out of date |

If multiple warning signals appear, the method itself needs review (annual review, or trigger-driven if severe).

---

## 14. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | May 2026 | Initial document |

---

*End of document. Execution Method v1.0.*
