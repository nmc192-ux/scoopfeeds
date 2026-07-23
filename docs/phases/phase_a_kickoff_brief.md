# Phase A Kickoff Brief: Stabilize and Audit
## Foundation Work Before Comprehension Layer Build

**Document type:** Phase Kickoff Brief
**Phase:** A (of A through E)
**Strategic goal:** Production runs new architecture. Backend hardening reaches production. Foundation sound. Existing assets (sources, social, search) audited and upgrade paths documented.
**Timeline:** Now → 4-6 weeks (target 4 weeks; 6 weeks is acceptable slip)
**Owner:** DrJ (Founder)
**Predecessor retrospective:** None (first phase)
**Companion documents:** Strategic Plan v6, Decisions Log v1 (31 decisions), Execution Method v1, Repo Documentation Structure v1
**Last updated:** May 2026
**Status:** Closed — Phase A formal close 2026-05-18 (retrospective FINAL v1.0, signed off 2026-05-15 Session 24); see [phase_a_retrospective.md](phase_a_retrospective.md). Exit-criteria path correction: [phase_a_exit_criteria_correction_2026-07.md](phase_a_exit_criteria_correction_2026-07.md).

---

## 0. Document Purpose

This brief translates Phase A's strategic goal into specific executable work, sequenced into seven sprints with prompts ready for Claude Code. It is the operational source of truth for Phase A and should drive every issue, every commit, every verification step over the next 4-6 weeks.

It is read by:
- DrJ (executing or reviewing every step)
- Claude Code (with this document loaded as context for prompts)
- Any future collaborator brought in mid-phase

---

## 1. Why Phase A Matters

Phase A is the foundation. Every other phase depends on it. The four critical conditions that Phase A creates:

1. **Production runs the actual code.** Right now, code on `main` includes admin auth, scheduler/worker separation, and Redis/BullMQ scaffolding — but production runs the old architecture. Until production matches code, no other phase work is meaningful, because every Phase B/C/D feature would have to assume the old architecture and then be retrofitted.

2. **Documents are in the right place.** Strategic plan, decisions log, execution method live in the repo, not scattered. This makes Claude Code reliably useful and prevents version drift.

3. **Audits reveal reality.** Source matrix, existing social automation, search infrastructure — all need to be inspected, not assumed. Phase B planning depends on knowing what's actually there.

4. **Metrics start being captured.** You can't manage what you don't measure. Phase A introduces the first 5 success metrics so that Phase B has baseline data to compare against.

If Phase A is rushed or skipped, the consequences appear in Phase B as confused architecture, missing data, and unverifiable progress.

---

## 2. Current State Assessment

### What's working
- Backend code on `main` is hardened (admin auth middleware, scheduler/worker separation, Dockerfile, BullMQ scaffolding)
- Frontend renders 45 routes without crashes
- Multi-source ingestion infrastructure in place (RSS, GDELT, Polymarket, USGS, NOAA, ACLED, FRED, World Bank, SportsDB, TMDB, YouTube)
- Public API + embed scaffolding exists
- Multilingual scaffolding partially in place (English + Urdu)
- sqlite-vec scaffolded for future semantic search
- Auto-posting on FB page, Instagram, Bluesky operational

### What's broken or stale
- **Worktree at `88a8ba4` is 5 commits behind `origin/main`** — Codex artifacts (`adminAuth.js`, `schedulerProcess.js`, hardened `Dockerfile`) exist on main but not locally
- **Production runs old architecture** — `ENABLE_SCHEDULER=false`, all crons dead, hollow features visible
- **`ri-ops.js` still uses fail-open `?key=` query auth** — Codex updated four other admin routes but missed this
- **Urdu RTL flag never applied** — `App.jsx` computes `isRtlLang` but root `<div>` doesn't consume it
- **Double timeline build** — burning 2× LLM quota
- **Silent ALTER TABLE failures** — first failure silently skips remaining columns
- **CSP disabled** in production
- **22 of 36 `en.json` locale keys never reach `t()`**
- **Source base shallow** — ~30-50 active sources, Pakistan-heavy, English-dominant
- **No tracker auto-detection engine, no breaking news engine, no op-ed aggregation, single-source predictions, no AI search**
- **Existing social posting** lacks coherent voice, brand kit, analytical depth — quality not presence is the issue
- **No README, no LICENSE, no CONTRIBUTING.md** at repo root

### What's unclear (audits will resolve)
- How many existing sources actually deliver content vs fail silently
- Which (category × region × type) cells are most depleted
- What existing social auto-posting actually publishes
- Whether FTS5 + sqlite-vec scaffolding is solid or needs reworking
- Current monthly costs across AI inference, hosting, third-party APIs

---

## 3. Strategic Alignment

**Decisions Log decisions affecting Phase A:**
- **Decision 16:** Source onboarding workflow — AI proposes priority cells AND candidate sources; DrJ approves
- **Decision 19:** Social media platform priority — existing FB/Instagram/Bluesky as upgrade base
- **Decision 23:** Search backbone — Brave + Exa.ai planned for Phase B integration
- **Decision 31:** License posture — Apache 2.0 for code; proprietary for content

**Capabilities (1-5) touched in Phase A:** All five at the foundation level; no new capability features built. Phase A is foundation work that all five capabilities later build on.

**Layers affected:** Foundation only.

---

## 4. Sprint Sequence

Phase A breaks into seven sprints. Realistic timeline: 4 weeks if execution is dedicated, 6 weeks if normal pace alongside other commitments.

| Sprint | Theme | Duration | Key deliverables |
|---|---|---|---|
| **Sprint 0** | Repo + docs structure | 1 week | Worktree synced, repo renamed, /docs/ structure, README/LICENSE/CONTRIBUTING |
| **Sprint 1** | Production stabilization (P0) | 2 weeks | Scheduler running, admin auth secured, Urdu RTL, double-timeline fix |
| **Sprint 2** | Debt cleanup (P1) | 2 weeks | ALTER logging, CSP, hollow-feature copy, i18n sweep, startup integration log |
| **Sprint 3** | Hygiene (P3) + first metrics | 1 week | raw_signals drop, dead components removed, 5 success metrics instrumented |
| **Sprint 4** | Source audit | 2 weeks | Source matrix populated, gap analysis, source quality scoring infrastructure |
| **Sprint 5** | Social + Search audits | 2 weeks | Social audit, search infrastructure audit, tracker template library design |
| **Sprint 6** | Phase A close-out | 1 week | Production smoke tests, exit criteria verification, retrospective |

---

## 5. Sprint 0 — Repo + Docs Structure (Week 1)

**Sprint goal:** By end of Sprint 0, the repo has `/docs/` structure populated, the worktree matches `origin/main`, the repo is renamed to `scoopfeeds`, and standard public-repo files exist at root.

### Issue 0.1 — Sync worktree to origin/main

**Size:** XS (~30 minutes)
**Acceptance criteria:**
- [ ] `git status` shows clean working tree
- [ ] `git log --oneline | head -5` shows latest origin/main commits
- [ ] `backend/src/middleware/adminAuth.js` exists locally
- [ ] `backend/src/jobs/schedulerProcess.js` exists locally
- [ ] No merge conflicts unresolved

**Claude Code prompt:**

```
CONTEXT:
The local worktree is at commit 88a8ba4 (per recent screenshot of GitHub).
This is 5 commits behind origin/main per the Upgradation document. All Codex
hardening artifacts (adminAuth.js, schedulerProcess.js, hardened Dockerfile)
exist on main but not in this worktree.

Repo: nmc192-ux/scoop (will be renamed in issue 0.2)

TASK:
1. Check git status for any uncommitted local changes
2. If uncommitted changes exist, stash them: git stash push -m "Pre-Phase-A sync stash"
3. Fetch latest: git fetch origin
4. Sync: git rebase origin/main (preferred) or git pull --rebase (alternate)
5. If conflicts arise, resolve by inspection — do NOT auto-resolve
6. If stashed earlier, pop: git stash pop and resolve conflicts manually
7. Verify HEAD is now at the latest origin/main commit

VERIFICATION:
- git log --oneline -5 shows latest origin/main commits
- ls backend/src/middleware/adminAuth.js — file exists
- ls backend/src/jobs/schedulerProcess.js — file exists
- git status — clean working tree

NOTES:
This is the foundation for ALL Phase A work. Do not skip. If conflicts seem
complex, halt and report rather than auto-resolving.
```

### Issue 0.2 — Rename repo to scoopfeeds

**Size:** XS (~10 minutes)
**Acceptance criteria:**
- [ ] GitHub repo renamed from `nmc192-ux/scoop` to `nmc192-ux/scoopfeeds`
- [ ] Local clone's remote updated
- [ ] `git push` works against new remote
- [ ] Old URL redirects work

**Manual steps (DrJ, no Claude Code prompt needed):**
1. Navigate to `https://github.com/nmc192-ux/scoop/settings`
2. Under "Repository name," change `scoop` to `scoopfeeds`, click Rename
3. In local clone: `git remote set-url origin https://github.com/nmc192-ux/scoopfeeds.git`
4. Verify: `git remote -v` shows new URL
5. Test: `git fetch origin` succeeds
6. Test: visit old URL, confirms it redirects to new URL

### Issue 0.3 — Create /docs/ folder structure

**Size:** S (~15 minutes)
**Acceptance criteria:**
- [ ] All target subfolders exist with `.gitkeep` files
- [ ] No existing files moved or deleted yet

**Claude Code prompt:**

```
CONTEXT:
Per docs/execution/repo_documentation_structure_v1.md (which DrJ will save in
issue 0.5), introduce /docs/ structure. This issue creates the empty structure
only.

TASK:
1. Create at repo root:
   docs/strategy/
   docs/strategy/archive/
   docs/execution/
   docs/phases/
   docs/ops/
   docs/ops/runbooks/
   docs/api/
   docs/content/
   docs/content/tracker_templates/

2. Create a .gitkeep file in each new directory

3. Do not move or delete any existing files. Do not create any documentation
   content yet.

VERIFICATION:
- ls docs/ shows: strategy, execution, phases, ops, api, content
- find docs -name .gitkeep shows 9 files
- ls *.md at repo root shows existing files unchanged

NOTES:
Purely structural. Content added in subsequent issues.
```

### Issue 0.4 — Migrate top-level *.md files to docs/ops/

**Size:** S (~30 minutes)
**Acceptance criteria:**
- [ ] All five operational docs moved to `docs/ops/` with snake_case
- [ ] `git mv` used (preserves history)
- [ ] Standard header added to each file
- [ ] No code references to old paths remain

**Claude Code prompt:**

```
CONTEXT:
Top-level *.md files to migrate:
- HOSTINGER_MIGRATION.md
- MAC_MINI_DEPLOY.md
- MEDIAVINE_READINESS.md
- REALITY_INDEX_STATUS.md
- SOCIAL_CREDENTIALS.md

TASK:
1. Use git mv (preserves history) for each:
   git mv HOSTINGER_MIGRATION.md docs/ops/hostinger_migration.md
   git mv MAC_MINI_DEPLOY.md docs/ops/mac_mini_deploy.md
   git mv MEDIAVINE_READINESS.md docs/ops/mediavine_readiness.md
   git mv REALITY_INDEX_STATUS.md docs/ops/reality_index_status.md
   git mv SOCIAL_CREDENTIALS.md docs/ops/social_credentials.md

2. For each migrated file, add a standard header at the top:
   # [Existing Title]

   **Document type:** Operational runbook
   **Owner:** DrJ
   **Last updated:** [if visible from git, else current month/year]
   **Status:** Active
   ---

   Preserve all existing content below the new header.

3. Search for references to old filenames:
   grep -r "HOSTINGER_MIGRATION.md" --exclude-dir=node_modules --exclude-dir=.git
   (and same for other 4 files)

4. Update any references found to new paths. Do NOT modify code logic — only
   path references.

VERIFICATION:
- ls *.md at repo root: those 5 files no longer there
- ls docs/ops/ shows all 5 in snake_case
- git log --follow docs/ops/hostinger_migration.md shows preserved history
- grep finds no remaining references to old paths

NOTES:
Use git mv not mv. If grep finds references in code (not docs), halt and report.
```

### Issue 0.5 — Add strategic and execution documents

**Size:** S (~30 minutes)
**DrJ manual steps:**
1. Save these files (from this conversation's outputs) into local clone:
   - `docs/strategy/strategic_plan_v6.md`
   - `docs/strategy/decisions_log_v1.md` (with Decision 31 included)
   - `docs/execution/execution_method_v1.md`
   - `docs/execution/repo_documentation_structure_v1.md`
   - `docs/phases/phase_a_kickoff_brief.md` (this document)
2. Save older strategic plan versions to `docs/strategy/archive/`:
   - `strategic_plan_v1.md` through `strategic_plan_v5.md`

**Claude Code prompt for verification + index creation:**

```
CONTEXT:
DrJ has saved strategic and execution documents. Verify and create the index.

TASK:
1. Verify all expected files exist at correct paths.
2. Verify each has standard header (Document type, Version, Owner, Last updated, Status).
3. Create docs/README.md as documentation index:

   # Scoopfeeds Documentation

   Source of truth for the Scoopfeeds platform's strategic direction, execution
   methodology, and operational runbooks.

   ## Strategic direction
   - [Strategic Plan v6](strategy/strategic_plan_v6.md) — vision, capabilities, phases
   - [Decisions Log v1](strategy/decisions_log_v1.md) — 31 strategic decisions made
   - [Strategic Plan archive](strategy/archive/) — historical versions

   ## Execution methodology
   - [Execution Method v1](execution/execution_method_v1.md) — how work gets done
   - [Repo Documentation Structure v1](execution/repo_documentation_structure_v1.md)

   ## Active phase
   - [Phase A Kickoff Brief](phases/phase_a_kickoff_brief.md)

   ## Operational runbooks
   - [Hostinger migration](ops/hostinger_migration.md)
   - [Mac mini deploy](ops/mac_mini_deploy.md)
   - [Mediavine readiness](ops/mediavine_readiness.md)
   - [Reality Index status](ops/reality_index_status.md)
   - [Social credentials](ops/social_credentials.md)

   ## Reference
   - [Dependencies](dependencies.md) — third-party services, costs, ownership
   - API documentation: api/ (planned for Phase D)
   - Content guidelines: content/ (planned for Phase B)

VERIFICATION:
- All files at expected paths
- All headers standardized
- docs/README.md exists; internal links resolve
```

### Issue 0.6 — Create root README.md

**Size:** S (~30 minutes)
**Acceptance criteria:**
- [ ] README.md at repo root, renders cleanly on GitHub
- [ ] All internal links to docs/ work
- [ ] License notice clear (per Decision 31)

**Claude Code prompt:**

```
CONTEXT:
Repo lacks README.md. Need professional public-facing introduction.
License (Decision 31): Apache 2.0 code, proprietary content.

TASK:
Create README.md at repo root:

# Scoopfeeds

> The intelligence platform for events that shape the world.

Scoopfeeds is a news and event intelligence platform combining a fast,
mobile-first news experience for general readers with a research-grade
analytical workstation for journalists, researchers, and analysts.

**Read the news. See the data. Hear the perspectives. Decode the signals. Search like an analyst.**

## What Scoopfeeds offers

- **The Newsroom** (`scoopfeeds.com`) — Fast event-centric news with regional depth, quantitative trackers, multi-perspective op-eds, verified video, breaking news alerts.
- **The Intelligence Desk** (`intel.scoopfeeds.com`, planned) — Research-grade analytical workstation with multi-source probability triangulation, full Event Dossiers with downloadable data, custom alerts, programmatic API access.
- **Scoop** (planned) — AI-augmented search returning intelligence, not just links. Perplexity-style answers with citations, credibility-weighted ranking, no spam.

## Project status

Currently in **Phase A (Stabilization and Audit)**. See [Strategic Plan](docs/strategy/strategic_plan_v6.md) for full vision and [Phase A Kickoff Brief](docs/phases/phase_a_kickoff_brief.md) for current execution work.

## Documentation

All documentation lives in [/docs/](docs/README.md). Key entry points:
- [Strategic Plan v6](docs/strategy/strategic_plan_v6.md)
- [Decisions Log v1](docs/strategy/decisions_log_v1.md)
- [Execution Method v1](docs/execution/execution_method_v1.md)
- [Phase A Kickoff Brief](docs/phases/phase_a_kickoff_brief.md)

## Tech stack

- Backend: Node.js / FastAPI patterns, SQLite (Postgres path documented)
- Frontend: Next.js
- Deployment: Hostinger (web tier), Mac mini (auxiliary)
- AI: Multi-model routing (DeepSeek for routine, Claude/GPT for complex)
- Search backbone (planned): Brave Search API + Exa.ai
- Alerts (planned): web push, email, Telegram (free); WhatsApp + webhooks + Slack/Teams (premium)

## License and content notice

Code in this repository is licensed under [Apache License 2.0](LICENSE).

Editorial content produced by the platform — including AI-generated briefs, Reality Index outputs, quantitative trackers, dossiers, op-ed analyses, methodology documentation, and social posts — is **proprietary** and not licensed for reuse without explicit permission from Scoopfeeds.

This dual posture exists because the code is a contribution to public infrastructure for AI-augmented journalism, while the editorial content is the platform's commercial differentiator.

## Contributing

Primary execution is currently solo founder + AI agents. External contributions welcome but should follow patterns in [CONTRIBUTING.md](CONTRIBUTING.md) and align with the Strategic Plan and Decisions Log.

## Contact

DrJ (Jahanzeb Hussain) — primary maintainer, Founder.

VERIFICATION:
- README.md at repo root
- Internal links to docs/ resolve
- Renders cleanly on GitHub (no broken markdown)
- License notice clear
```

### Issue 0.7 — Add LICENSE (Apache 2.0)

**Size:** XS (~10 minutes)
**Acceptance criteria:**
- [ ] LICENSE at repo root with standard Apache 2.0 text
- [ ] Copyright includes "Scoopfeeds" and 2026
- [ ] No modifications to standard Apache 2.0 license text

**Claude Code prompt:**

```
CONTEXT:
Per Decision 31, repo uses Apache License 2.0 for code (proprietary content
notice handled in README.md).

TASK:
1. Create LICENSE at repo root with the standard Apache 2.0 text.
2. Top of file:
   Copyright 2026 Scoopfeeds (Jahanzeb Hussain)

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

3. Append the full Apache 2.0 license text below this notice.

VERIFICATION:
- LICENSE at repo root
- Copyright year 2026
- GitHub recognizes Apache 2.0 (shows badge in repo sidebar)
```

### Issue 0.8 — Add CONTRIBUTING.md

**Size:** XS (~15 minutes)

**Claude Code prompt:**

```
CONTEXT:
Repo lacks CONTRIBUTING.md. Need clear, honest contribution guide.

TASK:
Create CONTRIBUTING.md at repo root:

# Contributing to Scoopfeeds

Thank you for your interest in Scoopfeeds.

## Current execution model

Primary execution is currently solo founder (DrJ) + AI agents (Claude Code) following a structured methodology documented in [docs/execution/execution_method_v1.md](docs/execution/execution_method_v1.md).

External contributions are welcomed but the methodology is currently optimized for the founder-and-agents pattern. We expect to formalize external contribution workflows in Phase D (after the platform's first revenue stream launches).

## How to contribute

### Issues

If you find a bug, want to suggest a feature, or have a question:
1. Check existing [issues](https://github.com/nmc192-ux/scoopfeeds/issues) first
2. If not raised, file a new issue with: clear title, context (what you observed, what you expected), reproduction steps if a bug, reference to relevant Strategic Plan section if a feature suggestion

### Pull requests

Pull requests are reviewed against:
- [Strategic Plan v6](docs/strategy/strategic_plan_v6.md) — does this align with platform direction?
- [Decisions Log v1](docs/strategy/decisions_log_v1.md) — does this respect existing decisions?
- [Execution Method v1](docs/execution/execution_method_v1.md) — does this follow our quality discipline?
- Code quality (passes type checks, linter, tests)

If a contribution requires changing strategic direction or revisiting a logged decision, the PR should reference the proposed change in its description and may require maintainer discussion before merging.

### Code conventions

- Follow existing patterns in `backend/` and `frontend/`
- New files use snake_case for utilities, PascalCase for components
- Tests required for new functionality
- Production verification required before marking work complete

### Editorial / content contributions

Editorial content in Scoopfeeds (briefs, tracker analyses, methodology) is proprietary and not currently accepting external contributions. This may change in Phase E.

## License

By contributing code, you agree your contributions will be licensed under [Apache License 2.0](LICENSE).

## Contact

For questions: file an issue or contact DrJ via GitHub.

VERIFICATION:
- CONTRIBUTING.md at repo root
- Internal links resolve
```

### Issue 0.9 — Create docs/dependencies.md

**Size:** M (~2 hours)
**Acceptance criteria:**
- [ ] All 10 categories present: hosting, AI, search backbones, predictions, news ingestion, communications, monitoring, payments, social, domain
- [ ] Each dependency has: purpose, account ownership, monthly cost, phase introduced, criticality, replacement options
- [ ] File linked from `docs/README.md`

**Claude Code prompt:**

```
CONTEXT:
Need a single index of all third-party services Scoopfeeds depends on.
Reference: docs/execution/repo_documentation_structure_v1.md Section 7 Step 7.

TASK:
Create docs/dependencies.md following the structure in the repo documentation
structure spec, with sections:
1. Hosting and infrastructure (Hostinger, Mac mini, future migration options)
2. AI and ML services (Anthropic, OpenAI, DeepSeek, Cerebras)
3. Search backbones (Brave, Exa.ai — Phase B+)
4. Data sources / Reality Index (Polymarket, Kalshi Phase C, Metaculus Phase C, Good Judgment Phase D)
5. News ingestion (GDELT, ACLED, USGS, NOAA, FRED, World Bank, SportsDB, TMDB, YouTube)
6. Communications (email provider, web push, Telegram Phase B, WhatsApp Phase D, webhooks Phase D)
7. Monitoring (Sentry or current equivalent, logging)
8. Payments (Stripe Phase D)
9. Social platforms (existing FB/Instagram/Bluesky; new X/LinkedIn Phase B; future)
10. Domain and DNS (scoopfeeds.com, intel.scoopfeeds.com Phase D)

For each dependency, capture (with TBD where DrJ input needed):
- Purpose
- Account owner / API key location
- Estimated monthly cost (or "TBD" / "free")
- Phase introduced
- Critical / Important / Optional
- Replacement options

After creating, update docs/README.md to link this file under "Reference."

VERIFICATION:
- docs/dependencies.md exists
- All 10 categories present
- TBD markers visible where DrJ input needed
- Linked from docs/README.md
```

### Issue 0.10 — Sprint 0 final commit and verification

**Size:** XS (~30 minutes)

**Claude Code prompt:**

```
CONTEXT:
Sprint 0 issues 0.1-0.9 should be complete. Time to commit and push.

TASK:
1. Run git status; verify expected changes:
   - New: docs/ structure with all subdirectories and files
   - Renamed (preserved history): old top-level *.md → docs/ops/
   - New: README.md, LICENSE, CONTRIBUTING.md at root
   - New: docs/dependencies.md, docs/README.md
   - New: strategic, execution, phase documents

2. Stage all: git add -A

3. Commit:
   chore(docs): establish /docs/ structure and add strategic foundation

   Sprint 0 of Phase A complete. This commit:

   - Adds /docs/ structure with subfolders for strategy, execution, phases, ops, api, content
   - Migrates 5 existing operational *.md files from root to docs/ops/ (history preserved)
   - Adds Strategic Plan v6, Decisions Log v1 (with 31 decisions), Execution Method v1
   - Adds Repo Documentation Structure spec
   - Adds Phase A Kickoff Brief at docs/phases/phase_a_kickoff_brief.md
   - Archives Strategic Plan v1-v5 in docs/strategy/archive/
   - Adds README.md, LICENSE (Apache 2.0 per Decision 31), CONTRIBUTING.md
   - Adds docs/dependencies.md tracking all third-party services

   See docs/phases/phase_a_kickoff_brief.md for current execution context.

   Refs: Strategic Plan v6, Decisions Log v1 (Decision 31)

4. Push: git push origin main

5. Verify on GitHub:
   - https://github.com/nmc192-ux/scoopfeeds/ shows README.md rendered
   - /docs/ structure visible
   - License shows "Apache 2.0" badge
   - Old top-level *.md files no longer at root

VERIFICATION:
- Push succeeds
- GitHub web view shows expected structure
- README.md renders cleanly
- Internal markdown links work
```

---

## 6. Sprint 1 — Production Stabilization (P0) (Weeks 2-3)

**Sprint goal:** Zero P0 items remaining unaddressed. Every metric on `/api/health` shows healthy.

### Issue 1.1 — Flip ENABLE_SCHEDULER=true on Hostinger

**Size:** XS (~10 minutes), manual

**DrJ steps:**
1. Log into Hostinger control panel for scoopfeeds.com production
2. Navigate to Environment Variables section
3. Set `ENABLE_SCHEDULER=true` (was either false or unset)
4. Save and trigger restart of the web process
5. Wait 5 minutes for first cron cycle
6. Verify: `curl https://scoopfeeds.com/api/health | jq '.scheduler.lastRun'`
7. Should return ISO timestamp like `"2026-05-XX..."` not `null`

### Issue 1.2 — Confirm/set ADMIN_BEARER_TOKEN

**Size:** XS (~5 minutes), manual

**DrJ steps:**
1. Generate fresh 64-char random string: `openssl rand -hex 32`
2. Save to password manager
3. In Hostinger env panel, set `ADMIN_BEARER_TOKEN=<value>`
4. Save and restart web process

### Issue 1.3 — Replace fail-open auth in ri-ops.js with adminAuth middleware

**Size:** XS (~15 minutes)

**Claude Code prompt:**

```
CONTEXT:
backend/src/routes/ri-ops.js currently has a local requireAdmin function
(around lines 37-43) that does fail-open ?key= query auth. Codex updated four
other admin route files (newsletter-ops.js, push.js, social.js, videos-gen.js)
to use the new middleware at backend/src/middleware/adminAuth.js, but skipped
ri-ops.js.

The new adminAuth.js middleware:
- Uses timing-safe bearer token comparison
- Checks Authorization: Bearer <token> header
- Logs admin access for audit
- Fails closed if ADMIN_BEARER_TOKEN env var is missing

TASK:
1. View backend/src/routes/ri-ops.js current content
2. Replace local requireAdmin function (around lines 37-43) with:
   import { requireAdmin } from "../middleware/adminAuth.js";
3. All existing usages of requireAdmin in the file still work (same name, different source)
4. Make no other changes to the file

VERIFICATION:
- View file after change; import at top, local function removed
- Run linter on the file
- Run any existing tests for ri-ops.js routes
- After deploy, manually test:
  - curl https://scoopfeeds.com/scoop-ops/ri-ops/dashboard returns 401
  - curl -H "Authorization: Bearer <token>" https://scoopfeeds.com/scoop-ops/ri-ops/dashboard returns 200

NOTES:
This is exactly what Codex did to four other admin route files; ri-ops.js was
the gap. Minimal change, significant security impact.
```

### Issue 1.4 — Apply Urdu RTL flag to root <div> in App.jsx

**Size:** S (~30 minutes)

**Claude Code prompt:**

```
CONTEXT:
Urdu UI users currently see LTR layout despite ur.json shipping. The fix:
- frontend/src/App.jsx line 87 computes isRtlLang correctly
- frontend/src/App.jsx line 143 root <div> never consumes it
- Header right-cluster and TopicNav don't reverse for RTL

TASK:
1. View frontend/src/App.jsx, frontend/src/components/layout/Header.jsx,
   frontend/src/components/layout/TopicNav.jsx

2. In App.jsx:
   - Find root <div> (around line 143)
   - Add: dir={isRtlLang ? "rtl" : "ltr"}
   - Verify isRtlLang is in scope

3. In Header.jsx:
   - Find right-cluster container (language switcher, login/menu icons)
   - Add rtl:flex-row-reverse to className

4. In TopicNav.jsx:
   - Find overflow-scroll container (horizontal-scrolling topic chips)
   - Add rtl:flex-row-reverse to className

VERIFICATION:
- Type checks pass
- Linter passes
- Manual test:
  - Switch UI to Urdu via language switcher
  - Inspect root element — confirm dir="rtl" attribute
  - Layout should flip: heading right-aligned, nav scrolls right-to-left
  - Switch back to English; layout returns to LTR with no artifacts
- Test on mobile (375px) and desktop (1280px+)

NOTES:
One of the highest-leverage fixes in Phase A — a one-line change unlocks
proper Urdu UX for an audience segment that's a strategic differentiator.
```

### Issue 1.5 — Fix double timeline build

**Size:** XS (~10 minutes)

**Claude Code prompt:**

```
CONTEXT:
runEventTrackerCronCycle in backend/src/services/scheduler.js calls
runEventTimelineBuilder() inside its lock at minute :13/:43. There's
ALSO a standalone cron schedule at :19 that calls runEventTimelineBuilderCycle.

Result: timeline builder runs TWICE per hour, burning 2x LLM quota.
The standalone cron locks correctly on its own.

TASK:
1. View backend/src/services/scheduler.js around line 254
2. Find the inline call to runEventTimelineBuilder() inside runEventTrackerCronCycle
3. Delete the call (and any error handling specifically for it)
4. Do NOT touch the standalone cron for runEventTimelineBuilderCycle

VERIFICATION:
- Type checks pass
- After deploy, query /api/health
- scheduler.lastEventTrackerRun and scheduler.lastTimelineBuilderRun differ by ~6 min
- Before fix: same time

NOTES:
Simple cron-discipline fix. Standalone cron is correct; inline call was leftover.
```

### Issue 1.6 — Update .env.example for split-process clarity

**Size:** XS (~10 minutes)

**Claude Code prompt:**

```
CONTEXT:
Current .env.example sets ENABLE_SCHEDULER=true (legacy default). With new
split-process architecture, this is confusing.

TASK:
View backend/.env.example. Add commented section near ENABLE_SCHEDULER:

# ENABLE_SCHEDULER controls whether this process runs the event scheduler
#
# Two valid configurations:
#
# 1. Monolithic (single process runs everything):
#    ENABLE_SCHEDULER=true
#    Web process embeds the scheduler. Suitable for low-traffic deployments.
#
# 2. Split (web + scheduler as separate processes):
#    web process: ENABLE_SCHEDULER=false (focuses on serving HTTP requests)
#    scheduler process: ENABLE_SCHEDULER=true (focuses on cron jobs)
#    Suitable for higher-traffic deployments. Requires deploying schedulerProcess.js
#    as a separate Hostinger / Fly.io / Railway process alongside the web tier.
#
# Phase A default: monolithic (ENABLE_SCHEDULER=true on the single process)
# Phase E target: split (when traffic justifies separation)
ENABLE_SCHEDULER=true

VERIFICATION:
- File renders correctly
- Comments clear about both configurations
- Default value true (monolithic) for current Phase A
```

### Issue 1.7 — Sprint 1 verification: full P0 smoke test

**Size:** S (~1 hour)

**Manual smoke tests (DrJ):**

1. **Scheduler health:**
```
curl https://scoopfeeds.com/api/health | jq '.scheduler.lastRun'
```
Expected: ISO timestamp within last 30 minutes.

2. **Admin auth (must fail):**
```
curl -i https://scoopfeeds.com/scoop-ops/ri-ops/dashboard
```
Expected: 401 Unauthorized.

3. **Admin auth (must succeed):**
```
curl -i -H "Authorization: Bearer <ADMIN_BEARER_TOKEN>" \
  https://scoopfeeds.com/scoop-ops/ri-ops/dashboard
```
Expected: 200 with JSON dashboard.

4. **Urdu RTL:**
- Visit scoopfeeds.com
- Switch to Urdu
- DevTools: confirm `dir="rtl"` on root div
- Visually verify layout flipped

5. **Briefs populating:**
- Wait 6 hours after Issue 1.1 deploy
- Visit scoopfeeds.com/briefs
- Expected: at least 1 brief visible

6. **No error spike:**
- Check Sentry for new errors in last 24h
- Expected: no spike from Phase A changes

If all six pass, Sprint 1 complete and Phase A on track.

---

## 7. Sprint 2 — Debt Cleanup (P1) (Weeks 4-5)

**Sprint goal:** Production stable, security improved (CSP), user experience improved on hollow features, localization works correctly.

### Issue 2.1 — ALTER TABLE logging fix

**Size:** S (~30 minutes)

**Claude Code prompt:**

```
CONTEXT:
backend/src/models/database.js has ~8 columns added via:
  try { db.exec("ALTER TABLE ..."); } catch {}
Problem: catch block logs generic warning; first failure silently skips
remaining ALTERs.

Affected columns (approximate):
- articles.language, articles.is_duplicate, articles.ig_summary
- users.tier, users.stripe_customer_id
- subscribers.referred_by_token, subscribers.welcome_d1_sent_at, subscribers.welcome_d3_sent_at

TASK:
1. View backend/src/models/database.js
2. Restructure each ALTER block to one column per try, with logger.warn naming
   the specific column on failure:

   try {
     db.exec("ALTER TABLE articles ADD COLUMN language TEXT");
   } catch (err) {
     logger.warn(`ALTER articles.language failed: ${err.message}`);
   }

3. Eventually migrate to backend/src/db/migrate.js runner Codex added,
   but for Phase A just fix the logging.

VERIFICATION:
- Type checks pass
- On startup, any ALTER failure logged with specific column name
- All ALTERs attempted independently (no early-exit)
- Tests pass
```

### Issue 2.2 — Enable CSP in production

**Size:** M (~1 day; testing surface is wide)

**Claude Code prompt:**

```
CONTEXT:
backend/server.js has helmet({contentSecurityPolicy: false}) — CSP disabled.
Need permissive-but-present CSP that allows AdSense, GTM, YouTube embeds,
Skimlinks, and news image domains.

TASK:
1. View backend/server.js (find helmet config, near line 101)
2. Replace contentSecurityPolicy: false with permissive policy:

   contentSecurityPolicy: {
     directives: {
       defaultSrc: ["'self'"],
       scriptSrc: [
         "'self'",
         "'unsafe-inline'", // needed for some inline scripts; tighten later
         "*.googlesyndication.com",
         "*.doubleclick.net",
         "*.googletagmanager.com",
         "www.googletagmanager.com",
         "*.youtube.com",
         "skimresources.com",
         "*.skimresources.com"
       ],
       imgSrc: ["*", "data:", "blob:"],
       styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
       fontSrc: ["'self'", "fonts.gstatic.com", "data:"],
       connectSrc: ["'self'", "*.googlesyndication.com", "*.doubleclick.net"],
       frameSrc: ["'self'", "*.youtube.com", "*.youtube-nocookie.com", "*.googlesyndication.com"],
       objectSrc: ["'none'"],
       baseUri: ["'self'"]
     }
   }

3. Test thoroughly in staging/development before production deploy
4. After production deploy: monitor browser console for CSP violations for 24-48 hours
5. Tighten policy iteratively if specific violations show up

VERIFICATION:
- AdSense ads still load
- YouTube embeds work
- Skimlinks affiliate clicks work
- No CSP violations in browser console for normal browsing
- Newspaper images load (img-src * permits all)

NOTES:
This is the widest-surface change in Phase A. Test thoroughly. Worst case is
roll back to contentSecurityPolicy: false temporarily and tighten incrementally.
```

### Issue 2.3 — Hollow feature copy

**Size:** S (~5 components, ~5 min each)

**Claude Code prompt:**

```
CONTEXT:
Hollow features (briefs, synthetic markets, truth-gap, leaderboard, anomalies)
render empty arrays after Phase A startup, with no copy explaining why.
Users see nothing and assume site is broken.

TASK:
For each of these page components, update empty state to include:
- One-line explainer: "Data accumulates over 24-48 hours after each scheduler run"
- Hint: "Next cycle in approximately X minutes" (derived from scheduler dashboard if available)
- Use existing EmptyState component pattern if one exists

Files to update:
- frontend/src/pages/BriefsPage.jsx
- frontend/src/pages/SyntheticMarketsPage.jsx
- frontend/src/pages/TruthGapPage.jsx
- frontend/src/pages/LeaderboardPage.jsx
- frontend/src/pages/AnomaliesPage.jsx

For each:
1. Find the empty-state condition (likely "if (data.length === 0) return ...")
2. Replace generic empty state with an explanatory empty state
3. Use existing UI components for consistency

VERIFICATION:
- Each page renders explanation when empty
- Existing rendering when data is present unchanged
- Consistent visual treatment across the 5 pages
```

### Issue 2.4 — Startup integration log

**Size:** XS (~30 minutes)

**Claude Code prompt:**

```
CONTEXT:
Env-gated integrations (FRED/TMDB/ACLED/Bluesky/SMTP/Stripe/AI providers) silently
no-op when keys absent. Operators can't tell which integrations are dark.

TASK:
In backend/src/services/scheduler.js startScheduler() (or equivalent boot path),
emit one structured log on startup:

[startup] integrations: fred=✓ tmdb=✓ acled=✗ bluesky=✗ smtp=✓ stripe=✗ llm=cerebras embed=cloudflare

Where ✓ means env var/credential present, ✗ means absent.

Implementation:
- Check each relevant env var
- Build the log line at boot, after env vars loaded
- Use existing logger pattern (logger.info or similar)

VERIFICATION:
- After scheduler restart, log shows the integration line
- Marks accurately reflect env var presence
- Operators can immediately see which integrations are off
```

### Issue 2.5 — Wire 22 dead nav.* locale keys

**Size:** S (~30 minutes)

**Claude Code prompt:**

```
CONTEXT:
22 of 36 en.json keys never trigger t() — most are nav.* consumed by MoreMenu.jsx
via string interpolation rather than the i18n hook.

TASK:
1. Find which keys are never reached:
   grep -r "t('nav\." frontend/src/ — confirm what IS used
   compare to en.json nav.* keys — find what's NOT

2. In frontend/src/components/layout/MoreMenu.jsx:
   - Find SECTIONS array (or equivalent) that has hardcoded title strings
   - Replace each title with t('nav.<key>') call
   - Ensure useT() hook is imported and used

3. Same in frontend/src/pages/EventsPage.jsx for category labels in chip row

4. Run tests after change

VERIFICATION:
- Switch UI to Urdu
- MoreMenu items now display Urdu translations (not English)
- Same for EventsPage chip labels
- All 22 dead keys now reach t()
- No regression in English UI
```

### Issue 2.6 — Sprint 2 production verification

**Size:** XS (~30 minutes)

**Manual smoke tests:**

1. CSP working in production (no console errors during normal browsing)
2. AdSense / YouTube / Skimlinks all functional
3. Hollow features show explanatory copy
4. Startup integration log visible in logs
5. Urdu UI shows translated nav

If all pass, Sprint 2 complete.

---

## 8. Sprint 3 — Hygiene + First Metrics (Week 6)

**Sprint goal:** Codebase cleaner, dead components removed, success metrics flowing into a dashboard.

### Issue 3.1 — Drop unused raw_signals table

**Size:** XS (~15 minutes)

**Claude Code prompt:**

```
CONTEXT:
backend/src/realityIndex/schema.js declares raw_signals table. Per Upgradation
document, zero rows ever written; ingesters write directly to events/macro_indicators.

TASK:
1. Verify table is unused: search for "raw_signals" in backend/src/
2. If only in schema.js (no inserts/queries), drop:
   - Add migration in backend/src/db/migrate.js (or equivalent) to DROP TABLE
   - Remove from schema.js
3. Test that nothing breaks (existing ingestion + query flows)

VERIFICATION:
- Tests pass
- Production deploy doesn't crash
- DB no longer has raw_signals table after migration
```

### Issue 3.2 — Delete dead LiveTVChannelEmbed

**Size:** XS (~10 minutes)

**Claude Code prompt:**

```
CONTEXT:
frontend/src/components/news/LiveTVSection.jsx:108-109 has LiveTVChannelEmbed
function that returns null. Dead code.

TASK:
1. View LiveTVSection.jsx
2. Delete the LiveTVChannelEmbed function
3. Remove its imports
4. Verify any callers were already handling its absence (they were, if it returns null)

VERIFICATION:
- Type checks pass
- LiveTVSection still renders correctly
- No console errors
```

### Issue 3.3 — Remove dead isUrdu variable in App.jsx

**Size:** XS (~5 minutes)

**Claude Code prompt:**

```
CONTEXT:
App.jsx computes isUrdu but never uses it (per Upgradation document).

TASK:
1. View App.jsx
2. Find the isUrdu computation
3. If genuinely unused, remove the line
4. If actually used somewhere (verify), wire it up properly

VERIFICATION:
- Type checks pass
- No unused variable warning
```

### Issue 3.4 — Instrument 5 success metrics

**Size:** L (~2 days)

**Claude Code prompt:**

```
CONTEXT:
Per Phase A Section 15 of brief, instrument 5 baseline metrics:
1. Production uptime (use external uptime monitor or compute from health checks)
2. Scheduler last-run age (median over time window)
3. Failed BullMQ job rate (24h rolling)
4. Layer 1 returning user rate (7-day) — analytics
5. Source diversity index — query articles table

TASK:
For each metric:
1. Identify data source (DB query, log analysis, external service)
2. Build a query/aggregation that computes current value
3. Store result in a metrics table or expose via /api/metrics endpoint
4. Schedule recomputation appropriately (hourly for most; daily for source diversity)

Build admin-only dashboard at /scoop-ops/metrics (requires bearer token):
- Display all 5 metrics with current value, trend (last 7 days), target
- Update in real-time or with reasonable refresh cadence

Add to existing scoop-ops admin routes; protect with adminAuth middleware.

VERIFICATION:
- All 5 metrics computed and visible on /scoop-ops/metrics
- Values are sensible (no nulls, no NaN)
- Dashboard loads in <2 seconds
- Requires auth; public can't see metrics

NOTES:
Phase A captures BASELINE values, not targets. Phase B compares against these baselines.
```

### Issue 3.5 — Sprint 3 verification

**Size:** XS (~15 minutes)

**Verification:**
- Hygiene items all closed
- Metrics dashboard accessible at /scoop-ops/metrics
- All 5 metrics flowing
- Phase B can reference these baselines

---

## 9. Sprint 4 — Source Audit (Weeks 7-8)

**Sprint goal:** Complete source audit at `docs/ops/runbooks/source_audit_phase_a.md`. Source quality scoring infrastructure live. Phase B has clear priority list.

### Issue 4.1 — Inventory active sources

**Size:** M (~3 hours)

**Claude Code prompt:**

```
CONTEXT:
Need inventory of all currently-active sources for Phase B planning.
DB has sources table (or equivalent) and articles table.

TASK:
1. View sources table schema in backend/src/models/database.js
2. Build query returning:
   - source_id, source_name, rss_url
   - last_ingestion_timestamp
   - articles_in_last_30_days
   - language
   - existing category/region tags

3. Run against production (read-only)

4. Save output to docs/ops/runbooks/source_audit_phase_a.md:

   # Phase A Source Audit

   **Date:** [current date]
   **Owner:** DrJ + Claude Code
   **Status:** In progress

   ## Active sources (last 7 days)

   | Source ID | Name | RSS URL | Last ingest | Articles 30d | Language | Notes |
   |---|---|---|---|---|---|---|
   | ... |

   ## Dead sources (no successful ingestion in 30 days)

   | ... |

   ## Active source count: X
   ## Dead source count: Y
   ## Total tracked: X + Y

VERIFICATION:
- Audit file exists at correct path
- Counts roughly match expected (~30-50 active)
- All known sources from sources.js (or equivalent) appear

NOTES:
Read-only against production. No data modified.
```

### Issue 4.2 — Categorize active sources against matrix

**Size:** M (~4 hours)

**Claude Code prompt:**

```
CONTEXT:
Per Strategic Plan v6 Section 3, source matrix is 17 categories × 10 regions ×
10 source types.

Categories (17): Politics & Government, Conflict & Security, Economics & Markets,
Health & Medicine, Climate & Environment, Science & Technology, Sports,
Culture & Society, Religion, Migration & Refugees, Energy & Resources,
Maritime & Shipping, Aviation, Agriculture & Food Security, Education,
Human Rights, Entertainment & Culture.

Regions (10): North America, Latin America, Europe, Russia & Central Asia,
Middle East & North Africa, Sub-Saharan Africa, South Asia, Southeast Asia,
East Asia, Oceania & Pacific.

Source types (10): Wire services, International broadcasters, National newspapers,
Regional newspapers, Specialized publications, Think tanks & research orgs,
Government & primary data, Independent journalism, Academic sources, Local-language sources.

TASK:
1. For each active source from issue 4.1, assign:
   - Primary category (1 of 17)
   - Primary region (1 of 10)
   - Source type (1 of 10)
   - Optional: secondary category if multi-topic

2. If source already has tags in DB, use them; verify accuracy
3. If missing, propose tags based on source content / domain knowledge
4. DrJ reviews and approves

5. Update audit document with categorization:

   ## Source matrix coverage

   | Source ID | Name | Category | Region | Type |
   |---|---|---|---|---|
   | ... |

VERIFICATION:
- Every active source has Category + Region + Type assigned
- DrJ reviews and approves the categorization

NOTES:
This is the matrix that gets compared against targets in issue 4.6 gap analysis.
```

### Issue 4.3 — Identify and handle dead sources

**Size:** M (~3 hours)

**Claude Code prompt:**

```
CONTEXT:
Issue 4.1 identified dead sources (no successful ingestion in 30 days).

TASK:
For each dead source:
1. Check if RSS URL still resolves: curl -I <url>
2. If broken (404, DNS fail), mark for removal
3. If RSS still works, check feed format — is parser broken?
4. Decision per source:
   - Remove from sources list (clean DB)
   - Fix parser (if format change is recoverable)
   - Replace with alternative source covering same niche

Update audit document with:
   ## Dead source decisions

   | Source | Status | Decision | Replacement |
   |---|---|---|---|
   | ... |

For sources to remove:
1. Update sources.js to drop them
2. Mark them as inactive in DB (don't hard delete; keep history)
3. Document the removal rationale

VERIFICATION:
- All dead sources have a decision
- Removed sources marked inactive
- Audit document updated

NOTES:
Dead sources are a credibility risk — they look like coverage that isn't there.
Better to have fewer working sources than many dead ones.
```

### Issue 4.4 — Build source quality scoring schema

**Size:** M (~4 hours)

**Claude Code prompt:**

```
CONTEXT:
Per Strategic Plan v6 Section 3 and Decision 16, every source needs a credibility
score (0-100) based on: editorial track record, methodology transparency,
domain expertise, independence, historical accuracy.

This is the foundation for source-credibility-weighted ranking in Scoop (Phase C).

TASK:
1. Add columns to sources table (via migration in backend/src/db/migrate.js):
   - quality_score INTEGER (0-100, nullable initially)
   - quality_score_components JSON (breakdown of how score was computed)
   - quality_score_last_updated TIMESTAMP
   - quality_score_methodology_version TEXT

2. Build scoring methodology document:
   docs/content/source_credibility_methodology.md

   Sections:
   - Editorial track record (corrections published, retractions, fact-check ratings) — 0-25 points
   - Methodology transparency (does the source publish editorial standards, fact-check process) — 0-15 points
   - Domain expertise (is this source authoritative for the categories it covers) — 0-25 points
   - Independence (state-controlled / corporate-owned / independent) — 0-15 points
   - Historical accuracy on past events (where measurable) — 0-20 points
   - Total: 0-100

3. Build scoring API:
   - Function that takes source metadata and returns score with component breakdown
   - Uses AI assistance for evaluating each component (with citations)
   - Stored in sources.quality_score

VERIFICATION:
- Migration runs successfully
- Schema updated
- Methodology document at docs/content/source_credibility_methodology.md
- Scoring function callable; produces score + components
- Score persisted to DB

NOTES:
Phase A sets up the infrastructure. Phase B uses it for ranking. Methodology is
proprietary (Decision 7); methodology overview is open.
```

### Issue 4.5 — Backfill quality scores for active sources

**Size:** L (~1-2 days)

**Claude Code prompt:**

```
CONTEXT:
Issue 4.4 built scoring infrastructure. Now apply to all active sources.

TASK:
1. For each active source from issue 4.2:
   - Run scoring function
   - Store score and component breakdown in DB
   - Commit version of methodology used

2. Spot-check by DrJ: review 10 random sources and confirm scores are sensible
   - Wire services like Reuters, AP should score 85-95
   - Major broadcasters like BBC, Al Jazeera should score 80-90
   - Tabloids or low-credibility sources should score 30-50
   - State-controlled outlets should score per independence component

3. If methodology produces unexpected results, refine and re-run

VERIFICATION:
- All active sources have quality_score
- Spot check confirms scores are sensible
- Component breakdown is auditable for any source
```

### Issue 4.6 — Gap analysis

**Size:** M (~3 hours)

**Claude Code prompt:**

```
CONTEXT:
Phase B target: ≥150 active sources, ≥6 regions covered, ≥3 source types per
major event. Need to identify which (category × region × type) cells are most
depleted.

TASK:
1. Build matrix view from issue 4.2 categorizations:
   For each (category × region × type), count active sources
   
2. Flag gaps:
   - Cells with 0 sources (CRITICAL gap)
   - Cells with 1 source (single-point-of-failure gap)
   - Cells underrepresented vs strategic priorities
   
3. Update audit document with gap analysis section:

   ## Gap analysis
   
   ### CRITICAL gaps (0 sources)
   | Category | Region | Source type | Priority |
   |---|---|---|---|
   | ... |
   
   ### Single-point-of-failure gaps (1 source)
   | ... |
   
   ### Strategic priority gaps
   (Cells where DrJ wants more sources for strategic reasons:
   e.g., South Asia health coverage, Muslim-world politics)

4. Prioritize gaps by:
   - Impact on Phase B exit criteria (≥150 sources, ≥6 regions, ≥3 types/event)
   - Strategic alignment with audience (S Asian + Muslim-world strength)
   - Availability of credible sources to fill gap

VERIFICATION:
- Gap analysis section in audit document
- DrJ reviews and approves prioritization
- Top 30-40 gaps identified for Phase B priority list
```

### Issue 4.7 — Document Phase B source priority list

**Size:** M (~2 hours)

**Claude Code prompt:**

```
CONTEXT:
Issue 4.6 identified gaps. Now identify specific candidate sources to fill them.
This becomes input to Phase B Sprint 1.

TASK:
1. For top 30-40 priority gaps:
   - Search for candidate sources (RSS, news APIs, language aggregators)
   - Verify RSS works, content is current
   - Estimate quality score (full scoring later)
   - Document in audit:

   ## Phase B priority sources (30-40)
   
   | Priority | Source name | RSS URL | Category | Region | Type | Est. quality | Notes |
   |---|---|---|---|---|---|---|---|
   | 1 | [name] | [url] | [cat] | [reg] | [type] | [score] | [why this source for this gap] |
   | ... |

2. DrJ reviews and approves
3. This list becomes the Phase B Sprint 1 source-onboarding work

VERIFICATION:
- 30-40 priority candidates documented
- Each has all matrix fields filled
- DrJ approves; Phase B can begin onboarding from this list

NOTES:
This closes the source audit. Phase B Kickoff Brief references this document
for the source matrix expansion work.
```

---

## 10. Sprint 5 — Social + Search Audits (Weeks 9-10)

**Sprint goal:** Social audit at `docs/ops/runbooks/social_audit_phase_a.md`. Search audit at `docs/ops/runbooks/search_audit_phase_a.md`. Tracker template library at `docs/content/tracker_templates/`.

### Issue 5.1 — Document current social auto-posting setup

**Size:** M (~3 hours)

**Claude Code prompt:**

```
CONTEXT:
Per Decision 19, FB page, Instagram, Bluesky already have auto-posting. Need
to document where the code lives, how it works, what triggers posts.

TASK:
1. Search for social posting code:
   grep -r "facebook" backend/src/ frontend/src/
   grep -r "instagram" backend/src/ frontend/src/
   grep -r "bluesky" backend/src/ frontend/src/

2. Identify:
   - Files / services responsible for each platform
   - Trigger logic (cron? event-driven?)
   - Content templates (where defined? how variable?)
   - Recent posts (query DB for posts in last 30 days, by platform)

3. Document at docs/ops/runbooks/social_audit_phase_a.md:

   # Phase A Social Audit
   
   **Date:** [current]
   **Owner:** DrJ + Claude Code
   **Status:** In progress
   
   ## Current setup
   
   ### Facebook
   - Code location: [file paths]
   - Trigger: [cron / event / manual]
   - Content template: [description]
   - API integration: [Meta Graph API? Other?]
   - Auth: [where credentials live]
   - Posting cadence: [posts per week]
   - Recent volume: [last 30 days]
   
   ### Instagram
   [same structure]
   
   ### Bluesky
   [same structure]

VERIFICATION:
- Document has section per platform with all fields filled
- Code locations verified to exist
- Auth/credential storage documented (without leaking secrets)
```

### Issue 5.2 — Inventory recent posts

**Size:** M (~3 hours)

**Claude Code prompt:**

```
CONTEXT:
Need to assess content quality of existing auto-posts.

TASK:
1. Query DB or fetch from each platform's API: posts in last 30 days for FB, Instagram, Bluesky.

2. For each post, capture:
   - Date/time
   - Platform
   - Content (text + image/video)
   - Engagement (likes, shares, comments)
   - Click-through to scoopfeeds.com (if tracked)

3. Identify patterns:
   - Common templates (do all posts look the same?)
   - Variation in content
   - Engagement drivers (which posts perform best?)
   - Misses (posts about important events that didn't perform)

4. Document under "Content quality assessment" section in social audit:

   ## Content quality assessment
   
   ### Recurring patterns
   - [Template patterns observed]
   
   ### Engagement leaders
   - [Top 5 posts in last 30 days, with content + engagement]
   
   ### Engagement laggards
   - [Bottom 5 with hypotheses about why]
   
   ### Voice consistency
   - [Are posts on-brand for "informed, data-first, regionally-aware, never partisan"?]
   - [Specific drift examples]

VERIFICATION:
- 30 days of posts inventoried per platform
- Quality assessment documented
- DrJ reviews and adds qualitative observations
```

### Issue 5.3 — Identify content quality issues

**Size:** S (~2 hours)

**Claude Code prompt:**

```
CONTEXT:
From issue 5.2, identify specific quality problems for Phase B upgrade.

TASK:
Document at social audit:

   ## Quality issues identified
   
   ### Issue 1: [Specific problem]
   - Pattern: [what's happening]
   - Frequency: [how often]
   - Examples: [3-5 example posts]
   - Impact: [how it hurts brand or engagement]
   - Phase B fix: [what to change]
   
   ### Issue 2: ...
   
   ### Issue 3: ...

Common issues to look for:
- Repetitive templates (every post looks like the others)
- Missing analytical depth (just headlines, no insight)
- Voice drift (clickbait, sensational language, partisan framing)
- Image/visual quality problems
- Missing or wrong UTM tags for traffic attribution
- No A/B testing
- Posting to platforms where audience isn't (e.g., Bluesky low engagement = OK to deprioritize?)

VERIFICATION:
- 5-10 specific issues identified
- Each has fix recommendation for Phase B
```

### Issue 5.4 — Document Phase B social upgrade path

**Size:** M (~2 hours)

**Claude Code prompt:**

```
CONTEXT:
Per Decision 19 and Strategic Plan v6, Phase B upgrades existing FB+Instagram+Bluesky
and adds new X (Twitter) + LinkedIn. Need clear handoff to Phase B.

TASK:
Document at social audit:

   ## Phase B upgrade path
   
   ### Existing platforms
   
   #### Facebook page
   - Keep: [what continues to work]
   - Rebuild: [what gets replaced]
   - Add: [what's new]
   
   #### Instagram
   [same structure]
   
   #### Bluesky
   [same structure]
   
   ### New platforms (Phase B)
   
   #### X (Twitter)
   - Why: [strategic reasoning]
   - Build approach: [from scratch with shared templates]
   - First-month posting cadence: [10-15 posts/week]
   
   #### LinkedIn
   [same structure]
   
   ### Cross-platform infrastructure (Phase B)
   - Per-platform brand voice guidelines (docs/content/social_voice_<platform>.md)
   - UTM tagging discipline
   - Performance dashboard
   - Human review workflow (Phase B every post)

VERIFICATION:
- Clear path for each platform
- Phase B can plan sprint work from this document
- Aligned with Decision 19 (X + LinkedIn new builds; FB + Instagram + Bluesky upgrades)
```

### Issue 5.5 — Audit FTS5 search current setup

**Size:** M (~3 hours)

**Claude Code prompt:**

```
CONTEXT:
Current search is SQLite FTS5. Phase B upgrades to entity + semantic +
credibility-weighted. Need to know current state.

TASK:
1. Find FTS5 setup in backend:
   grep -r "FTS5" backend/src/
   grep -r "MATCH " backend/src/

2. Identify:
   - Which tables are FTS5-indexed
   - Index configuration (tokenizer, ranking)
   - Query patterns (which routes use it)
   - Performance (query time on a sample of typical queries)
   - Coverage gaps (what content isn't indexed but should be)

3. Document at docs/ops/runbooks/search_audit_phase_a.md:

   # Phase A Search Audit
   
   **Date:** [current]
   **Owner:** DrJ + Claude Code
   **Status:** In progress
   
   ## Current FTS5 setup
   
   ### Indexed tables
   - articles: [columns indexed]
   - events: [columns indexed]
   - [others]
   
   ### Query patterns
   - /api/search uses: [pattern]
   - /api/events/search uses: [pattern]
   - [others]
   
   ### Performance
   - Median query time: X ms
   - P95 query time: Y ms
   - Slowest queries: [examples]
   
   ### Coverage gaps
   - [What content isn't indexed]

VERIFICATION:
- All search-related code identified
- Index config documented
- Performance metrics captured
```

### Issue 5.6 — Audit sqlite-vec scaffolding

**Size:** M (~3 hours)

**Claude Code prompt:**

```
CONTEXT:
Per Strategic Plan, sqlite-vec is scaffolded for semantic search. Need to know
what's actually in place.

TASK:
1. Find sqlite-vec usage:
   grep -r "sqlite-vec\|vec_" backend/src/

2. Identify:
   - Where embeddings are stored
   - Which content is embedded (articles? events? all? subset?)
   - Embedding model used
   - Vector index configuration
   - Whether semantic search is wired to any UI

3. Document at search audit:

   ## sqlite-vec semantic search infrastructure
   
   ### Storage
   - Table: [name]
   - Schema: [columns]
   - Coverage: [what % of articles/events are embedded]
   
   ### Embedding pipeline
   - Model: [Cloudflare? Other?]
   - Trigger: [on ingest? batch?]
   - Cost per embedding: [estimate]
   
   ### Querying
   - Where used: [routes / functions]
   - Hybrid scoring: [if any combines FTS + semantic]
   
   ### Phase B readiness
   - What's ready: [...]
   - What's missing: [...]

VERIFICATION:
- sqlite-vec setup fully documented
- Coverage gaps clear
- Phase B integration path emerges from gaps
```

### Issue 5.7 — Document Phase B search upgrade path

**Size:** M (~3 hours)

**Claude Code prompt:**

```
CONTEXT:
Phase B does internal search upgrade + Brave Search API preview integration.
Phase C does AI-augmented answers + credibility-weighted ranking. Need clear
roadmap.

TASK:
Document at search audit:

   ## Phase B search upgrade path
   
   ### Internal search upgrade (Phase B)
   - Entity-aware: [implementation approach]
   - Semantic via sqlite-vec: [completing what's scaffolded]
   - Credibility-weighted ranking: [using sources.quality_score from issue 4.4]
   - Hybrid scoring: 0.7 * fts5 + 0.3 * cosine_similarity (per Strategic Plan)
   
   ### Brave Search API integration (Phase B preview, Phase C full)
   - Account setup: [steps]
   - API integration approach
   - Cost monitoring (per query)
   - Result rendering on /search page
   
   ### Phase C additions (referenced for Phase B planning)
   - AI generative answers (multi-model routing)
   - Source credibility-weighted ranking on web results
   - Entity-aware results
   - Scoop portal polished as destination

VERIFICATION:
- Phase B can plan sprint work from this
- Aligned with Decisions 23 (Brave + Exa) and 24 (multi-model routing)
- Cost projections clear
```

### Issue 5.8 — Design tracker template library

**Size:** L (~2 days)

**Claude Code prompt:**

```
CONTEXT:
Per Decision 12 and Strategic Plan v6, the Tracker Auto-Detection Engine uses
validated templates for 8 tracker types: conflict, outbreak, incident, sports,
environmental, election, study, entertainment.

Each template encodes journalism best practices (Reuters Graphics methodology,
WHO surveillance formats, ACLED reporting standards, Box Office Mojo presentation,
Our World in Data conventions).

TASK:
For each of the 8 tracker types, create a template document at
docs/content/tracker_templates/<type>.md:

1. conflict.md
   - When triggered (auto-detection signal: ACLED data + multi-source coverage)
   - Required metrics: casualties (military/civilian/total), hardware loss,
     territorial control, refugee flows, named actors
   - Data sources: ACLED, ICRC, Reuters, AP, regional sources
   - Visualization: timeline, map, casualty charts, actor network
   - Update cadence: daily during active conflict
   - Methodology references: ACLED methodology, Reuters Graphics conflict tracker patterns

2. outbreak.md
   - When triggered: WHO surveillance signal + case-count growth
   - Required metrics: cases by country, deaths, vaccination coverage,
     regional spread rate, R0 estimate
   - Data sources: WHO, national health ministries, Lancet, NEJM
   - Visualization: case curve, geographic spread, demographic breakdown
   - Update cadence: weekly (or daily during acute phase)

3. incident.md (accidents, crashes, industrial)
   - When triggered: aviation/maritime/industrial incident with casualty floor
   - Required metrics: casualties, hardware/infrastructure damage, location,
     responsible parties, investigation status
   - Data sources: aviation safety boards, maritime authorities, news wires
   - Update cadence: hourly during acute phase, daily as story matures

4. sports.md
   - When triggered: scheduled fixture + interest indicator
   - Required metrics: games, standings, key player stats, betting markets
   - Data sources: SportsDB, official league APIs, regional sports media
   - Update cadence: real-time during games, daily otherwise

5. environmental.md (wildfires, storms, droughts)
   - When triggered: NOAA/USGS/ACLED + news coverage threshold
   - Required metrics: extreme weather indicators, displacement, infrastructure damage
   - Data sources: NOAA, USGS, regional environmental agencies
   - Visualization: geographic maps, severity over time

6. election.md
   - When triggered: scheduled date + competitive race indicator
   - Required metrics: polling, money raised/spent, competitive races, final results
   - Data sources: polling aggregators, campaign finance data, election commissions
   - Visualization: polling trends, money flow, electoral maps

7. study.md (major research releases)
   - When triggered: journal publication + media pickup + topic relevance
   - Required metrics: study findings, methodology rigor, replication status,
     prior contradicting studies
   - Data sources: journal RSS, university press releases, expert commentary
   - Visualization: study comparison, evidence strength

8. entertainment.md
   - When triggered: release date + opening signal
   - Required metrics: box office, streaming top-10, critical reception
     (Rotten Tomatoes, Metacritic, audience), regional breakdown
   - Data sources: Box Office Mojo, The Numbers, Rotten Tomatoes, Metacritic,
     regional industry pubs (Bollywood Hungama, etc.)
   - Visualization: opening weekend vs comparable releases, critic vs audience divergence
   - Update cadence: weekly, with major-release intensification

For each template:
- Header with metadata (template version, owner, last updated)
- Auto-detection trigger logic (specific signals + thresholds)
- Required vs optional metrics
- Data source list with API/RSS endpoints
- Visualization recommendations
- Update cadence
- Methodology references (cite original journalism conventions)

VERIFICATION:
- 8 template files at docs/content/tracker_templates/
- Each has all sections filled
- DrJ reviews and approves
- Phase B can use these templates directly when building Tracker Auto-Detection Engine

NOTES:
These templates are the foundation for Capability 2's Tracker Auto-Detection
Engine in Phase B. Get them right; everything builds on them.
```

---

## 11. Sprint 6 — Phase A Close-out (Weeks 11-12)

**Sprint goal:** Phase A formally complete. All exit criteria verified. Retrospective committed. Phase B Kickoff Brief drafting begins.

### Issue 6.1 — Verify Phase A exit criteria

**Size:** S (~2 hours)

**Manual checklist (DrJ):**

Walk through Section 13 of this brief, item by item. For each criterion:
- Met / Partial / Not Met
- If Partial or Not Met: documented remediation plan

Document results in `docs/phases/phase_a_exit_verification.md`.

### Issue 6.2 — Full production smoke test

**Size:** S (~2 hours)

**Manual smoke tests (DrJ):**

Run full suite:
- All 6 Sprint 1 smoke tests
- All Sprint 2 verifications
- All Sprint 3 verifications (metrics dashboard accessible)
- Audits readable on the deployed docs (GitHub web view)

Document results.

### Issue 6.3 — Capture metrics snapshot

**Size:** XS (~30 minutes)

**Steps:**
- Visit `/scoop-ops/metrics`
- Capture current values of all 5 metrics
- Save to `docs/phases/phase_a_metrics_snapshot.md`
- These become the Phase B baselines

### Issue 6.4 — Write Phase A Retrospective

**Size:** M (~3 hours)

**Template (per Execution Method Section 11.2):**

Create `docs/phases/phase_a_retrospective.md`:

```
# Phase A Retrospective: Stabilize and Audit

## Metadata
- Phase completed: [date]
- Original target: [4 weeks from start]
- Slip: [actual time minus 4 weeks]

## Exit criteria status
[For each criterion from Section 13: Met / Partial / Not Met]

## What worked well
- [practices that compounded value]

## What didn't work
- [practices that hindered]

## What was learned
- About the codebase
- About the audience
- About the technology
- About velocity

## Surprises
- Things that took much longer than expected (and why)
- Things that took much less time
- Unforeseen dependencies or blockers

## Strategic plan implications
- Anything that should change Strategic Plan v6?
- Anything in Decisions Log to revise?
- Anything Phase B Kickoff Brief needs that wasn't anticipated?

## Metrics snapshot
- All 5 metrics: current values vs targets vs (no baseline yet)

## Risk register updates
- New risks identified
- Existing risks resolved
- Existing risks evolved

## Inputs to Phase B
- Critical context Phase B Kickoff Brief needs to incorporate
- Open issues being carried forward
```

### Issue 6.5 — Update Decisions Log if revisions needed

**Size:** XS (~30 minutes)

**Steps:**
- Review all 31 decisions in light of Phase A learnings
- Any decision needs revision? Document with date and rationale
- If yes: bump Decisions Log version (`v1` → `v2`); archive `v1`

### Issue 6.6 — Update Strategic Plan if structural changes warranted

**Size:** XS-S (~30 minutes - 2 hours)

**Steps:**
- Review Strategic Plan v6 in light of Phase A learnings
- Likely no structural changes needed (Phase A is foundation, not strategic)
- If changes needed: bump version (`v6` → `v7`); archive `v6`

### Issue 6.7 — Begin drafting Phase B Kickoff Brief

**Size:** L (~2-3 days)

**Steps:**
- Use Phase A Retrospective as input
- Use audit findings (source, social, search) as detailed inputs
- Use tracker templates as Phase B foundation
- Draft Phase B Kickoff Brief at `docs/phases/phase_b_kickoff_brief.md`
- Initial draft can be ~50% complete; finalized in early Phase B

---

## 12. External Dependencies and Prerequisites

### Required before Sprint 0

- DrJ has Hostinger control panel access
- DrJ has GitHub admin access to the repo
- DrJ has local clone of the repo with git configured
- Claude Code is set up

### Required before Sprint 1

- Sprint 0 complete (worktree synced, /docs/ structure live)

### Required before Sprint 4

- Read-only DB access from local environment

### Required before Sprint 5

- DrJ has access to FB page admin, Instagram admin, Bluesky account
- DrJ knows where social posting code lives

---

## 13. Phase A Exit Criteria

Phase A is complete when ALL of these are true:

### Production stability
- [ ] `/api/health.scheduler.lastRun` returns ISO timestamp within last 15 minutes (99% of checks)
- [ ] Admin endpoints (`/scoop-ops/*` and `/scoop-ops/ri-ops/*`) require bearer token; return 401 without
- [ ] Hollow feature pages populating with data within 6 hours of any scheduler restart
- [ ] CSP enabled in production with no console errors from third-party content
- [ ] Production uptime ≥99.5% over last 30 days

### Documentation foundation
- [ ] `/docs/` structure exists with all subfolders populated
- [ ] Strategic Plan v6, Decisions Log v1 (31 decisions), Execution Method v1, Repo Documentation Structure v1, Phase A Kickoff Brief all in repo
- [ ] README.md, LICENSE, CONTRIBUTING.md at repo root
- [ ] `docs/dependencies.md` complete with no [TBD] markers
- [ ] All references to old top-level `*.md` paths updated

### Audits complete
- [ ] Source audit at `docs/ops/runbooks/source_audit_phase_a.md` with active/dead inventory, gap analysis, Phase B priority list
- [ ] Social audit at `docs/ops/runbooks/social_audit_phase_a.md` with current state, content quality assessment, Phase B upgrade path
- [ ] Search audit at `docs/ops/runbooks/search_audit_phase_a.md` with current state and Phase B integration plan
- [ ] Tracker template library at `docs/content/tracker_templates/` with templates for all 8 types

### Metrics
- [ ] First 5 success metrics instrumented and flowing
- [ ] Metrics dashboard at `/scoop-ops/metrics` (admin-only)
- [ ] Baseline values captured

### Hygiene
- [ ] All P0 items closed
- [ ] All P1 items closed
- [ ] All P3 hygiene items closed
- [ ] No silent ALTER TABLE failures
- [ ] Urdu RTL working

### Closure artifacts
- [ ] Phase A Retrospective at `docs/phases/phase_a_retrospective.md`
- [ ] Decisions Log updated if any revisions
- [ ] Phase B Kickoff Brief in active drafting

---

## 14. Risks Specific to Phase A

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Worktree sync introduces conflicts | Low | Medium | Sprint 0 Issue 0.1 stashes uncommitted changes; conflicts halt for review |
| Hostinger env flip causes scheduler crash | Low | High | Restart of one process; if crashes, set ENABLE_SCHEDULER=false to revert |
| ri-ops.js auth fix breaks existing admin access | Medium | Medium | Test with new bearer token before deploying |
| Urdu RTL fix breaks LTR layout | Low | Medium | Test both languages after fix; rollback is one line removal |
| CSP rollout breaks AdSense/Skimlinks/YouTube | Medium | High | Stage to test first; permissive policy starts loose; tighten over time |
| Source audit takes longer than 2 weeks | Medium | Low | Defer dead-source cleanup to Phase B if needed |
| Social/search audits reveal more brokenness than expected | Medium | Medium | Document findings; defer fixes to Phase B if Phase A timeline binding |
| Repo rename breaks CI/deploys | Low | High | Test deploys after rename; GitHub redirects help; check CI configs for hardcoded URLs |

---

## 15. Phase A Success Metrics (Baseline Capture)

These 5 metrics are instrumented during Sprint 3. Phase A captures baselines.

| Metric | Phase A baseline target | How measured |
|---|---|---|
| Production uptime | ≥99.5% | Hostinger or external uptime monitor |
| Scheduler last-run age (median) | ≤15 minutes | Querying /api/health periodically |
| Failed BullMQ job rate (24h rolling) | <1% | Query BullMQ failed-jobs counter |
| Layer 1 returning user rate (7-day) | Baseline number captured | Analytics tool (TBD) |
| Source diversity index (no source >X% of corpus) | Baseline captured | Query articles by source |

---

## 16. Hand-off to Phase B

Phase A's hand-off consists of:

1. **Phase A Retrospective** — what worked, what didn't, what was learned, surprises, strategic implications, metrics snapshot, risk updates

2. **Audit findings:**
   - Source audit → Phase B knows which 30-40 sources to add first
   - Social audit → Phase B knows what to keep/upgrade/rebuild
   - Search audit → Phase B knows internal upgrade path + Brave preview plan

3. **Tracker template library** ready for the Tracker Auto-Detection Engine in Phase B

4. **Phase B Kickoff Brief** drafted (likely outline; finalized in early Phase B)

5. **Decisions Log status:** all 31 decisions held; any phase A learnings flagging revisions documented in retrospective

---

*End of document. Phase A Kickoff Brief.*
