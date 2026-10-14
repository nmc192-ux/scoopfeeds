# The ScoopFeeds build engine — full throttle

**Decided by DrJ, 14 Oct 2026:** "Engine speed: Full Throttle. I'll only review something
extremely important. Everything else gets built and committed and deployed automatically."

This document is the rulebook every agent in the engine follows. Where it conflicts with an
older rule in `CLAUDE.md`, `docs/agentic-workflow.md` or a J Loop skill, **this document
wins**, except for the stop list below, which nothing overrides.

The plan the engine works through is **ScoopFeeds Development Plan v7**
(`docs/plan/plan_v7.md`; the living version is DrJ's doc of the same name).

---

## 1. What runs automatically

| Step | Who | Rule |
|---|---|---|
| Spec | `/plan` (nightly) | Turns the next backlog items from `docs/plan/plan_v7.md` into `j-loop:spec-ready` issues directly. No `j-loop:proposed` stage. |
| Build | `/build` | Unchanged: one issue, its own branch, never commits to `main`. |
| Review | `/review` | Unchanged quality bar, plus the **stop-list check** (section 3). Opens the PR. |
| Merge | `/ship` | **Automatic.** Merges a `j-loop:ready-to-ship` PR when every CI check is green and it does not carry `engine:needs-drj`. Squash merge, delete branch. |
| Deploy | VPS auto-deploy timer | `scripts/ops/autodeploy.sh` every 5 minutes: fast-forwards to `main` only when CI is green on that commit, builds all services, runs the health check, rolls back on failure. |
| Flag flip | `/ship` follow-up | Reader-facing work still ships **behind a flag**. After 24 hours in production with no new errors, the engine opens a one-line PR that switches the flag on; it merges like any other PR. |
| Report | Daily report task, 20:00 PKT | What merged, what deployed, what rolled back, which sources went live, anything waiting for DrJ. |

## 2. The safeguards that replace approvals

1. **CI must be green.** `.github/workflows/node.js.yml` builds the frontend on Node
   18/20/22 and runs the full backend suite (`scripts/ci/backend-tests.sh`). A red check
   blocks the merge and the deploy.
2. **Health check after every deploy.** The home page and `/api/health` must answer 200 and
   every compose service must be running within 3 minutes, or the deploy rolls back to the
   previous commit on its own and that commit is never retried.
3. **Dark first.** New reader-facing behaviour ships behind an env flag or URL param and is
   flipped on only after 24 clean hours (section 1).
4. **Pause switch.** Open any GitHub issue with the label `engine:pause` and every part of
   the engine stops: no specs, builds, merges or deploys. Close it to resume. On the server,
   `touch /opt/scoopfeeds/.engine-paused` pauses deploys only.
5. **Honesty rules still apply** (`docs/agentic-workflow.md` section 5): unmeasured is
   UNVERIFIED, never "passing". A PR whose tests could not run is not green.

## 3. The stop list — the only things that wait for DrJ

`/review` checks every PR against this list. A match gets the label `engine:needs-drj`, a
notification, and a plain-language note on the PR saying which item matched and why. It is
not merged until DrJ says so. Everything not on this list ships automatically.

1. **Deleting or rewriting stored data**: a migration with `DROP`, `DELETE`, `UPDATE`,
   `RENAME` or a table rebuild; an event-graph re-merge or bulk re-promotion over existing
   events; any script that writes to production data outside the normal pipeline.
   (Additive migrations — new tables, columns, indexes — ship automatically. The auto-deploy
   script also refuses a commit range whose migrations contain those keywords.)
2. **Credentials, DNS, firewall or server changes**: anything touching secrets, `.env`
   handling, Caddy, Docker networking, systemd units, or the deploy script itself.
3. **Cost**: anything expected to raise monthly AI or hosting spend by more than 25%
   (new model tiers, higher call caps, more sources than the plan's current step).
4. **New public surfaces**: a new social channel, a new kind of automated post, email to a
   new audience, or anything that publishes where ScoopFeeds did not publish before.
5. **Editorial and legal**: changes to editorial guardrails (Rule 0, sensitive-topic rules,
   the Pakistan-related rules), the AI-disclosure chain, privacy, terms or other legal pages.
6. **Market odds**: switching Reality Index / Truth Gap / market-implied probabilities back
   on in any reader-facing surface after they were hidden (plan v7, decision 3).

## 4. Sources

New sources need **no approval** (DrJ, 14 Oct 2026). The engine adds sources in batches of up
to 50 that pass the quality-score floor, at the pace of the plan's source steps, and lists each
batch in the daily report. DrJ replies only to remove one. English-language sources only while
the site is English-only.

## 5. Scope decisions that bind the build

- **English only** for now: the language switch and non-English locales come out of the UI.
- **No WhatsApp channel** for now.
- **Feeds follow the reader's location**: Today and News put the reader's country first.
- **Door names**: Today, News, Originals, Markets, Watch & Listen.
- **Market odds stay hidden** until the Markets fix lands (stop-list item 6 to re-enable).
- **AI-written "What we know"** on dossiers is allowed, with a disclosure line, once the
  coherence gate is live — this lifts the old mechanical-only header rule for that block only.

## 6. Lanes

Each issue carries one lane label so builds can run side by side without touching the same
files: `lane:website`, `lane:graph`, `lane:sources`, `lane:originals`, `lane:radio`. Radio's
code is built here like any other lane; its playout keeps running on the Mac mini.

## 7. Running the stages from a cloud session

Scheduled engine runs start fresh cloud sessions. There, `gh` subcommands that use GitHub's
GraphQL API (`gh issue list`, `gh pr create`, `gh pr view`, `gh pr merge`) are refused; use
the REST API through `gh api` instead. Unset `GH_TOKEN` first (`GH_TOKEN= gh api …`) — the
session's git proxy supplies the credentials.

| Skill says | Use in a cloud session |
|---|---|
| `gh issue list --label L` | `gh api "repos/nmc192-ux/scoopfeeds/issues?labels=L&state=open&per_page=50"` |
| `gh issue edit N --add-label L` | `gh api -X POST repos/nmc192-ux/scoopfeeds/issues/N/labels -f "labels[]=L"` |
| `gh issue edit N --remove-label L` | `gh api -X DELETE repos/nmc192-ux/scoopfeeds/issues/N/labels/L` |
| `gh issue comment N --body …` | `gh api -X POST repos/nmc192-ux/scoopfeeds/issues/N/comments -f body=…` |
| `gh issue create` | `gh api -X POST repos/nmc192-ux/scoopfeeds/issues -f title=… -f body=… -f "labels[]=…"` |
| `gh pr create` | `gh api -X POST repos/nmc192-ux/scoopfeeds/pulls -f title=… -f head=BRANCH -f base=main -f body=…` |
| checks on a commit | `gh api repos/nmc192-ux/scoopfeeds/commits/SHA/check-runs` |
| `gh pr merge N --squash --delete-branch` | `gh api -X PUT repos/nmc192-ux/scoopfeeds/pulls/N/merge -f merge_method=squash`, then `gh api -X DELETE repos/nmc192-ux/scoopfeeds/git/refs/heads/BRANCH` |

The Mac mini daemon (`.claude/bin/jloop-daemon`) can run the same stages locally, where the
plain `gh` commands work; either runner obeys this document.
