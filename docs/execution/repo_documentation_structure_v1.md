# Scoopfeeds Repo Documentation Structure v1.0
## How Documents Live in the Codebase

**Document type:** Repo organization spec
**Version:** 1.0
**Owner:** DrJ (Founder)
**Companion documents:** Strategic Plan v6.0, Decisions Log v1.0, Execution Method v1.0
**Target repo:** `nmc192-ux/scoop` (recommended rename to `nmc192-ux/scoopfeeds`)
**Last updated:** May 2026

---

## 0. Purpose

This document defines the `/docs/` folder structure for the Scoopfeeds repository. It exists because the four-layer execution method (Strategic Plan → Phase Brief → Sprint → Issue) requires a stable home for documents inside the codebase. Without that home, documents drift across local files, Drive folders, and chat threads, and Claude Code can't reliably load context.

This is not a stylistic preference. It's the operational foundation that makes the Execution Method document executable.

---

## 1. Current State (from repo inspection)

The repo has the following observable conventions:

**Code structure (clean):**
- `backend/` — server-side application
- `frontend/` — client-side application
- `deploy/` — deployment scripts
- `scripts/` — utility scripts
- `.github/workflows/` — CI/CD
- `.claude/` — Claude Code working directory

**Documentation (ad-hoc):**
- Top-level `*.md` files in `SCREAMING_SNAKE_CASE.md` convention
- Currently includes: `HOSTINGER_MIGRATION.md`, `MAC_MINI_DEPLOY.md`, `MEDIAVINE_READINESS.md`, `REALITY_INDEX_STATUS.md`, `SOCIAL_CREDENTIALS.md`
- No `README.md`
- No `LICENSE`, `CONTRIBUTING.md`, or `CODE_OF_CONDUCT.md`
- No `/docs/` folder

**Phase nomenclature (inconsistent):**
- Recent commits reference "Phase 7," "Phase C," "Phase 4b-4l," "Phase 1+2"
- This pre-existing phase concept is informal and inconsistent
- v6 strategic plan uses Phase A through E — this is a re-anchoring, not a continuation

**Worktree state:**
- Currently at `88a8ba4` (per screenshot, 2 days old)
- Per Upgradation document, worktree is 5 commits behind `main`
- Sprint 0 begins with worktree sync (Step 0 from Claude Code remediation plan)

---

## 2. Target State

The repo gets a clean `/docs/` structure that holds all strategic, execution, and operational documentation. Existing top-level `*.md` files migrate into appropriate `/docs/` subfolders. New standard files (`README.md`, `LICENSE`, `CONTRIBUTING.md`) are added at root. Code structure (`backend/`, `frontend/`, etc.) is unchanged.

```
nmc192-ux/scoopfeeds/  (renamed from nmc192-ux/scoop)
├── .claude/                           [unchanged — Claude Code workspace]
├── .github/
│   └── workflows/                     [unchanged — CI/CD]
├── backend/                           [unchanged — server code]
├── frontend/                          [unchanged — client code]
├── deploy/                            [unchanged — deploy scripts]
├── scripts/                           [unchanged — utility scripts]
├── docs/                              [NEW — all documentation lives here]
│   ├── README.md                      [NEW — index of all docs]
│   ├── strategy/                      [NEW — strategic-level documents]
│   │   ├── strategic_plan_v6.md
│   │   ├── decisions_log_v1.md
│   │   └── archive/                   [old versions live here]
│   │       ├── strategic_plan_v1.md
│   │       ├── strategic_plan_v2.md
│   │       ├── strategic_plan_v3.md
│   │       ├── strategic_plan_v4.md
│   │       └── strategic_plan_v5.md
│   ├── execution/                     [NEW — execution methodology + supporting]
│   │   ├── execution_method_v1.md
│   │   └── repo_documentation_structure_v1.md  (this document)
│   ├── phases/                        [NEW — phase kickoff briefs and retrospectives]
│   │   ├── phase_a_kickoff_brief.md
│   │   ├── (later: phase_a_retrospective.md, phase_b_kickoff_brief.md, etc.)
│   ├── ops/                           [NEW — operational runbooks and how-tos]
│   │   ├── hostinger_migration.md     [migrated from root]
│   │   ├── mac_mini_deploy.md         [migrated from root]
│   │   ├── mediavine_readiness.md     [migrated from root]
│   │   ├── reality_index_status.md    [migrated from root]
│   │   ├── social_credentials.md      [migrated from root]
│   │   └── runbooks/                  [reserved for future runbooks]
│   ├── api/                           [NEW — API documentation]
│   │   └── (future OpenAPI/Swagger docs)
│   ├── content/                       [NEW — editorial and content guidelines]
│   │   ├── voice_and_brand.md         [drafted in Phase B]
│   │   └── tracker_templates/         [drafted in Phase B]
│   └── dependencies.md                [NEW — third-party services, APIs, costs]
├── README.md                          [NEW — public-facing overview]
├── LICENSE                            [NEW — choose appropriate license]
├── CONTRIBUTING.md                    [NEW — how to contribute, even if just for AI agents]
├── .gitignore                         [unchanged]
├── nixpacks.toml                      [unchanged]
├── package.json                       [unchanged]
└── railway.json                       [unchanged]
```

---

## 3. Naming Conventions

**Strategic documents** (rare, stable):
- `snake_case` filenames
- Major versioning: `strategic_plan_v6.md`, `decisions_log_v1.md`
- Old versions move to `archive/` folder, never deleted
- Header includes version, owner, last updated date

**Execution method documents** (rare, stable):
- `snake_case` filenames
- Major versioning: `execution_method_v1.md`, `repo_documentation_structure_v1.md`
- Updated rarely; revised version replaces the file (with old version archived)

**Phase documents** (per phase):
- `snake_case` filenames
- Pattern: `phase_<letter>_<artifact>.md`
- Examples: `phase_a_kickoff_brief.md`, `phase_a_retrospective.md`
- No version numbers (each phase produces its artifacts once; refinements update in place with date stamps in the header)

**Operational runbooks** (continuous):
- `snake_case` filenames
- Existing `SCREAMING_SNAKE_CASE.md` files migrate to `snake_case.md` for consistency
- Examples: `hostinger_migration.md`, `mac_mini_deploy.md`
- No version numbers

**Code-level documentation:**
- README files live alongside code in their folders (`backend/README.md`, `frontend/README.md` if needed)
- Inline comments for non-obvious choices
- API docs auto-generated where possible (OpenAPI/Swagger)

---

## 4. Document Headers

Every document under `/docs/` has a standard header:

```markdown
# [Document Title] v[X.Y]
## [Subtitle if useful]

**Document type:** [Strategic / Execution / Phase / Operational / etc.]
**Version:** [if applicable]
**Owner:** [Name]
**Companion documents:** [References to related docs]
**Last updated:** [Month Year]
**Status:** [Active / Draft / Archived]
```

The header makes the document self-describing — anyone reading it (human or AI) immediately knows what it is, who owns it, when it was last touched, and where to find related context.

---

## 5. The Top-Level README.md

A public-facing README that introduces the project. Suggested structure:

```markdown
# Scoopfeeds

> The intelligence platform for events that shape the world.

Scoopfeeds is a news and event intelligence platform combining a fast,
mobile-first news experience for general readers (Layer 1: The Newsroom)
with a research-grade analytical workstation for journalists, researchers,
and analysts (Layer 2: The Intelligence Desk at intel.scoopfeeds.com).

## What Scoopfeeds offers

- **Read the news.** Fast event-centric coverage with regional depth.
- **See the data.** Quantitative trackers and infographics on every event.
- **Hear the perspectives.** Multi-source op-ed aggregation with credibility scoring.
- **Decode the signals.** Reality Index — multi-source probability triangulation.
- **Search like an analyst.** Scoop — AI-augmented search with cited sources.

## Project status

Scoopfeeds is currently in Phase A (Stabilization). See [Strategic Plan](docs/strategy/strategic_plan_v6.md) for full context.

## Documentation

- **Strategic direction:** [Strategic Plan v6](docs/strategy/strategic_plan_v6.md)
- **How we build:** [Execution Method v1](docs/execution/execution_method_v1.md)
- **Decisions made:** [Decisions Log v1](docs/strategy/decisions_log_v1.md)
- **Current phase:** [Phase A Kickoff Brief](docs/phases/phase_a_kickoff_brief.md)
- **Operational runbooks:** [docs/ops/](docs/ops/)

## Tech stack

- **Backend:** Node.js, FastAPI patterns, SQLite (with Postgres path documented)
- **Frontend:** Next.js
- **Deployment:** Hostinger (web tier), Mac mini (auxiliary), Railway considered for future
- **AI:** Multi-model routing (DeepSeek for routine, Claude/GPT for complex)
- **Search backbone:** Brave Search API + Exa.ai (planned)

## License

[License TBD — see Section 6 below]

## Contact

DrJ (Jahanzeb Hussain) — primary maintainer
```

This README is for public visitors. It's discoverable, professional, and points to documentation depth rather than embedding it.

---

## 6. License Decision

The repo is currently public without an explicit license. This is a meaningful gap — public code without a license technically can't be legally reused by anyone (default copyright), which is fine if intentional, but should be deliberate.

**Three reasonable options:**

**Option A — Keep code proprietary, public for transparency.**
- License: "All rights reserved" or no license
- README states: "Code visible for transparency. Not licensed for reuse."
- Appropriate if you want to preserve full commercial control

**Option B — Permissive open source (MIT or Apache 2.0).**
- License: MIT (simplest) or Apache 2.0 (more protections)
- Allows others to use, modify, contribute
- Appropriate if you want to encourage contributions and academic use

**Option C — Mixed: code permissive, content restrictive.**
- Code: MIT or Apache 2.0
- Content (briefs, trackers, AI outputs): proprietary
- Documented in `LICENSE` (for code) + content notice (in README)
- Appropriate if you want code to be open but protect editorial output

**Recommendation:** Option C if you eventually want academic citations and community contributions to the platform code, or Option A if you want to keep all options open for now.

This is a strategic decision that should be added to the Decisions Log (it would be Decision 31 — License posture). Worth deciding before Sprint 0 of Phase A so the LICENSE file gets the right content from the start.

**Your call needed before Sprint 0:** Option A, B, or C?

---

## 7. The Migration Plan (Sprint 0 of Phase A)

These are the concrete steps to set up the docs structure. Each step is a Claude Code prompt or a manual action by DrJ.

### Step 1 — Worktree sync (this is Step 0 from the Claude Code remediation plan)

**Action:** DrJ + Claude Code
**Prompt:**
```
CONTEXT:
The current worktree at /Users/<username>/clever-mayer-091fe5 is on commit 88a8ba4
which is 5 commits behind origin/main (latest 7c5dc3a). All Codex hardening
artifacts (adminAuth.js, schedulerProcess.js, Dockerfile, etc.) exist on main
but not in this worktree.

TASK:
Sync the worktree to origin/main without losing any local changes.
1. Check `git status` for uncommitted changes; stash if present
2. `git fetch origin`
3. `git rebase origin/main` (or `git pull --rebase` if cleaner)
4. Resolve any conflicts (likely none if no local changes)
5. Pop stash if applicable
6. Verify HEAD is now at origin/main

VERIFICATION:
- `git log --oneline | head -5` shows the latest origin/main commits
- `git status` shows clean working tree
- Files like backend/src/middleware/adminAuth.js now exist locally

NOTES:
This is the foundation for all subsequent Phase A work. Do not skip.
```

### Step 2 — Optional repo rename

**Action:** DrJ (manual via GitHub web UI)
**Steps:**
1. Go to repo Settings → General → Repository name
2. Change `scoop` to `scoopfeeds`
3. Confirm
4. Update any local clones: `git remote set-url origin https://github.com/nmc192-ux/scoopfeeds.git`

GitHub auto-redirects old URLs, so external links won't break. This eliminates the three-layer "scoop" naming ambiguity.

### Step 3 — Create the docs folder structure

**Action:** Claude Code
**Prompt:**
```
CONTEXT:
The Scoopfeeds repo currently has documentation as ad-hoc top-level *.md files.
We're introducing a /docs/ structure to hold strategic, execution, phase, and
operational documents.

TASK:
1. Create the following folder structure at the repo root:
   docs/
   docs/strategy/
   docs/strategy/archive/
   docs/execution/
   docs/phases/
   docs/ops/
   docs/ops/runbooks/
   docs/api/
   docs/content/
   docs/content/tracker_templates/

2. Create a placeholder `.gitkeep` file in each new directory so they get committed
   (Git doesn't track empty directories).

3. Do not move or delete any existing files yet — that's a later step.

VERIFICATION:
- `ls docs/` shows: strategy, execution, phases, ops, api, content
- All subdirectories exist
- `git status` shows new untracked .gitkeep files
- No existing files modified

NOTES:
This is purely structural. Content gets added in subsequent steps.
```

### Step 4 — Migrate existing top-level *.md files to docs/ops/

**Action:** Claude Code
**Prompt:**
```
CONTEXT:
The repo has these top-level operational markdown files:
- HOSTINGER_MIGRATION.md
- MAC_MINI_DEPLOY.md
- MEDIAVINE_READINESS.md
- REALITY_INDEX_STATUS.md
- SOCIAL_CREDENTIALS.md

These should move to docs/ops/ with snake_case naming.

TASK:
1. Move each file using `git mv` (preserves history):
   - git mv HOSTINGER_MIGRATION.md docs/ops/hostinger_migration.md
   - git mv MAC_MINI_DEPLOY.md docs/ops/mac_mini_deploy.md
   - git mv MEDIAVINE_READINESS.md docs/ops/mediavine_readiness.md
   - git mv REALITY_INDEX_STATUS.md docs/ops/reality_index_status.md
   - git mv SOCIAL_CREDENTIALS.md docs/ops/social_credentials.md

2. Search the codebase for any references to the old filenames and update them:
   - `grep -r "HOSTINGER_MIGRATION.md" --exclude-dir=node_modules`
   - Same for the other four files
   - Update any references found to the new paths

3. Add a header to each migrated file with the standard format:
   ```
   # [Title]

   **Document type:** Operational runbook
   **Owner:** DrJ
   **Last updated:** [original last-updated date if visible from git, else current date]
   **Status:** Active
   ```

VERIFICATION:
- `ls` at repo root no longer shows those *.md files
- `ls docs/ops/` shows all five files in snake_case
- `git log --follow docs/ops/hostinger_migration.md` shows preserved history
- No broken references in the codebase

NOTES:
Use `git mv` not `mv`; preserves file history. Test with one file first if uncertain.
```

### Step 5 — Add the strategic and execution documents

**Action:** DrJ (paste files) + Claude Code (commit)
**DrJ steps:**
1. Save the latest versions of these files (from this conversation's outputs) to the repo:
   - `docs/strategy/strategic_plan_v6.md`
   - `docs/strategy/decisions_log_v1.md`
   - `docs/execution/execution_method_v1.md`
   - `docs/execution/repo_documentation_structure_v1.md` (this document)
2. Save the older versions to archive:
   - `docs/strategy/archive/strategic_plan_v1.md` through `v5.md`

**Claude Code prompt for verification:**
```
CONTEXT:
DrJ has added strategic and execution documents to docs/strategy/, 
docs/strategy/archive/, and docs/execution/.

TASK:
1. Verify the files are present:
   - docs/strategy/strategic_plan_v6.md
   - docs/strategy/decisions_log_v1.md
   - docs/execution/execution_method_v1.md
   - docs/execution/repo_documentation_structure_v1.md
   - docs/strategy/archive/ contains v1 through v5

2. Verify each document has the standard header format with:
   - Document type
   - Version
   - Owner
   - Last updated date
   - Status

3. Generate a docs/README.md that indexes all documents:
   ```
   # Scoopfeeds Documentation Index

   Strategic direction:
   - [Strategic Plan v6](strategy/strategic_plan_v6.md)
   - [Decisions Log v1](strategy/decisions_log_v1.md)
   - [Strategic Plan archive](strategy/archive/)

   Execution methodology:
   - [Execution Method v1](execution/execution_method_v1.md)
   - [Repo Documentation Structure v1](execution/repo_documentation_structure_v1.md)

   Active phase:
   - [Phase A Kickoff Brief](phases/phase_a_kickoff_brief.md) (when added)

   Operational runbooks:
   - [Hostinger migration](ops/hostinger_migration.md)
   - [Mac mini deploy](ops/mac_mini_deploy.md)
   - [Mediavine readiness](ops/mediavine_readiness.md)
   - [Reality Index status](ops/reality_index_status.md)
   - [Social credentials](ops/social_credentials.md)

   API documentation: docs/api/ (future)
   Content guidelines: docs/content/ (future)
   ```

VERIFICATION:
- All files present in correct locations
- All headers follow the standard format
- docs/README.md indexes everything
- All internal links work (use a markdown link checker if available)

NOTES:
The docs/README.md is the navigation hub. Anyone landing in /docs/ should
immediately understand what's where.
```

### Step 6 — Add root-level README.md, LICENSE, CONTRIBUTING.md

**Action:** DrJ decides license, then Claude Code creates files
**DrJ decision needed:** Decision 31 — License posture (Option A, B, or C from Section 6)

**Claude Code prompt:**
```
CONTEXT:
The repo lacks standard public-repo files: README.md, LICENSE, CONTRIBUTING.md.
DrJ has decided on license: [Option A / B / C — fill in].

TASK:
1. Create README.md at repo root using the template in 
   docs/execution/repo_documentation_structure_v1.md Section 5

2. Create LICENSE at repo root:
   - If Option A: "All rights reserved" notice
   - If Option B: standard MIT or Apache 2.0 text
   - If Option C: code-permissive license + content notice in README

3. Create CONTRIBUTING.md at repo root with sections:
   - How issues are filed
   - How pull requests are reviewed
   - Reference to docs/execution/execution_method_v1.md for full process
   - Note that primary execution is currently solo founder + Claude Code

VERIFICATION:
- `ls` at repo root shows README.md, LICENSE, CONTRIBUTING.md
- README links to all key docs in /docs/
- LICENSE is appropriate for the chosen option
- CONTRIBUTING.md is honest about current solo-execution model

NOTES:
README is public-facing. Tone: professional, clear, confident.
LICENSE choice is permanent for code already published; choose carefully.
```

### Step 7 — Add docs/dependencies.md

**Action:** Claude Code
**Prompt:**
```
CONTEXT:
Scoopfeeds depends on multiple third-party services. We need a single index
of all dependencies, their purpose, costs, and account ownership.

TASK:
Create docs/dependencies.md with sections:

1. Hosting and infrastructure
   - Hostinger (current production)
   - Mac mini M4 (auxiliary)
   - Railway/Fly.io (future consideration)

2. AI and ML services
   - Anthropic (Claude API)
   - OpenAI (GPT API)
   - DeepSeek (cost-efficient routing)
   - Cerebras (existing per ARIA pattern)

3. Search backbones (Phase B+)
   - Brave Search API
   - Exa.ai (semantic, Layer 2)

4. Data sources
   - Reality Index components (Polymarket, Kalshi, Metaculus, Good Judgment)
   - News ingestion (RSS, GDELT, ACLED, USGS, NOAA, FRED, World Bank, SportsDB, TMDB, YouTube)

5. Communications and alerts
   - WhatsApp Business API (Phase D)
   - Telegram Bot API
   - Email provider (Postmark/SES)

6. Monitoring and ops
   - Sentry (or current equivalent)
   - Logging service (if any)

7. Payments (Phase D)
   - Stripe

8. Social platforms
   - X (Twitter) API
   - LinkedIn API
   - Instagram (Meta) API
   - Facebook page API
   - YouTube API
   - Bluesky API
   - TikTok API (Phase D)

For each dependency, include:
- Purpose
- Account owner / API key location
- Estimated monthly cost (or actual where known)
- Phase introduced
- Critical / important / optional
- Replacement options if discontinued

VERIFICATION:
- All categories covered
- Each dependency has the four required fields
- File is committed at docs/dependencies.md

NOTES:
This file becomes the single source of truth for "what does Scoopfeeds depend on."
Update whenever new dependencies are added or existing ones change.
```

### Step 8 — Initial commit and verification

**Action:** Claude Code
**Prompt:**
```
CONTEXT:
Sprint 0 has restructured the docs/ folder, migrated existing operational docs,
added strategic and execution documents, created README.md, LICENSE, 
CONTRIBUTING.md, and docs/dependencies.md.

TASK:
1. Stage all changes: `git add -A`
2. Verify with `git status` that the changes look correct:
   - New: docs/ structure with all files
   - Renamed (preserved history): old top-level *.md files now in docs/ops/
   - New: README.md, LICENSE, CONTRIBUTING.md at root
3. Commit with message:
   ```
   chore(docs): establish /docs/ structure and add strategic foundation

   - Add docs/strategy/, docs/execution/, docs/phases/, docs/ops/, docs/api/, docs/content/
   - Migrate existing operational *.md files from root to docs/ops/
   - Add Strategic Plan v6, Decisions Log v1, Execution Method v1
   - Add README.md, LICENSE ([type]), CONTRIBUTING.md at root
   - Add docs/dependencies.md
   - Sprint 0 of Phase A complete

   Refs: docs/phases/phase_a_kickoff_brief.md
   ```
4. Push to origin/main: `git push origin main`
5. Verify on GitHub that the docs/ structure is visible

VERIFICATION:
- Git push succeeds
- GitHub shows the new structure
- All links in docs/README.md work
- Public repo is more navigable than before
- README.md renders cleanly on the GitHub repo page

NOTES:
This is the formal Sprint 0 completion commit. Everything from here references
this state as the new baseline.
```

---

## 8. After Sprint 0 — How New Documents Get Added

When future phases or sprints produce new documents:

**Phase Kickoff Brief (start of each phase):**
- DrJ drafts (or Claude Code drafts under DrJ's review)
- Saved as `docs/phases/phase_<letter>_kickoff_brief.md`
- Linked from `docs/README.md`
- Linked from main `README.md` under "Active phase"

**Phase Retrospective (end of each phase):**
- DrJ writes
- Saved as `docs/phases/phase_<letter>_retrospective.md`
- Linked from `docs/README.md`

**New runbook (when a new operational surface emerges):**
- Saved as `docs/ops/<surface_name>.md`
- Linked from `docs/README.md`

**Strategic plan revision (rare):**
- Old version moves to `docs/strategy/archive/`
- New version replaces `docs/strategy/strategic_plan_v<X>.md`
- Decisions Log updated if any decisions changed
- README.md links to new version

**Decisions Log update:**
- Same file, version bumped (`decisions_log_v1.md` → `decisions_log_v2.md`)
- Old version to archive
- README.md links to new version

**Content guidelines (Phase B onward):**
- `docs/content/voice_and_brand.md` — brand voice across platforms
- `docs/content/tracker_templates/<type>.md` — one file per tracker type
- `docs/content/social_voice_<platform>.md` — per-platform tone guides

**API docs (Phase D onward):**
- `docs/api/openapi.yaml` — OpenAPI specification
- `docs/api/getting_started.md` — developer guide
- `docs/api/authentication.md` — auth documentation
- `docs/api/rate_limits.md` — rate limit policy

---

## 9. Maintenance Discipline

**Quarterly review (during Strategic Plan review):**
- Are all documents in `/docs/` still accurate?
- Any documents that should be archived?
- Any new categories of documents emerging that need their own subfolder?
- Is `docs/README.md` still a useful index?

**On every commit that changes a document:**
- Update the "Last updated" header in the document
- Bump version if structural change

**On every phase exit:**
- Add new retrospective to `docs/phases/`
- Update `docs/README.md` "Active phase" link
- Archive any documents made obsolete by the phase

**On every dependency change:**
- Update `docs/dependencies.md`

**Anti-pattern to avoid:** Creating documents outside `/docs/` "just for now" or "while we figure it out." If a document is worth writing, it goes in `/docs/` from the start. If it's not worth writing, don't write it.

---

## 10. The .claude Folder

The repo has a `.claude/` folder, which is Claude Code's working directory (typically containing skills, project context, and operational state).

**Decision:** Leave `.claude/` unchanged. It's Claude Code's space, not part of the human-readable documentation structure. The `/docs/` folder is for humans (and AI agents reading docs as context); `.claude/` is for Claude Code's own operational state.

If `.claude/` ever contains documentation that should be human-readable (e.g., explanations of how skills work), copy that documentation into `/docs/execution/` rather than expecting humans to read inside `.claude/`.

---

## 11. Summary

**What this document defines:**
- Target `/docs/` folder structure
- Naming conventions (snake_case, versioning, headers)
- Migration plan for Sprint 0 of Phase A (8 steps)
- Maintenance discipline post-Sprint-0

**What still needs DrJ decision before Sprint 0:**
1. Repo rename: `scoop` → `scoopfeeds`? (Recommended: yes)
2. License posture: Option A / B / C? (Recommended: Option C for permissive code + protected content, OR Option A to defer)

**Sprint 0 deliverables:**
- Worktree synced to `main`
- `/docs/` structure created
- Existing `*.md` files migrated
- Strategic, execution, and operational documents committed
- `README.md`, `LICENSE`, `CONTRIBUTING.md` added at root
- `docs/dependencies.md` created

**After Sprint 0:**
- Phase A Kickoff Brief is drafted (lives at `docs/phases/phase_a_kickoff_brief.md`)
- Phase A engineering work begins from a clean documentation baseline

---

*End of document. Repo Documentation Structure v1.0.*
