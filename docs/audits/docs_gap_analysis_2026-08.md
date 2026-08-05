# Documentation gap analysis — 2026-08

Full read of the strategy, execution, architecture, and reference docs (strategic_plan_v6,
decisions_log_v1 + amendments, strategic_tactical_reconciliation_v1, execution_method_v1,
agentic-workflow, phase_b_go_live_runbook, phase_a_exit_criteria_correction, kickoff briefs,
dossier_and_event_graph, env_reference, STATE_OF_PLAY, dependencies, video-pipeline, CLAUDE.md).

Verdict up front: the documentation is unusually good for a solo project — grounded, honest
about failure, decision-logged. The gaps below are mostly *between* documents (drift and
missing mechanisms), not missing documents. Ranked by severity.

---

## Tier 1 — could cost you the product

### 1. No backup or restore procedure for prod `news.db`
`npm run db:backup` exists as a command; nothing documents when it runs, where copies go,
whether any copy leaves the VPS, or how to restore. The docs' only DR content is a warning
that a mis-set `SCOOP_PERSISTENT_DATA_DIR` "destroys news.db" on redeploy. The entire event
graph — the product's moat — is one SQLite file on one root-owned volume on one VPS.
The bootstrap fix (issue #1) means a restore can now *boot*; there is still nothing to restore from.
**Missing doc:** `docs/ops/runbooks/backup_restore.md` with schedule, off-site target, and a
tested restore drill.

### 2. Nothing pages you when prod dies
No uptime monitor, no alerting. The logs prove outages go unnoticed: a 45-minute Caddy port
outage, a worker running month-old code for a week, a dead YouTube token logged as
`publishConfigured: true` "for weeks". Detection is "check the site returns 200 after any
recreate" — i.e. only when DrJ happens to look.
**Missing:** any external uptime check (even a free one hitting `/api/healthz`, which now
reports `degraded`) wired to Slack/phone.

### 3. CI runs no tests — the Level-1 quality gate is fictional
execution_method §6 Level 1: "automated via CI/CD. If CI is red, work doesn't merge."
CI actually runs install + frontend build + `node --check`. The 464-test suite runs only on
whoever's laptop remembers. This is precisely how 64 failures sat on main unnoticed.
**Fix is small:** add `node --test "src/**/*.test.js"` to the workflow. (Already flagged in
review of PR #2; still not specced.)

## Tier 2 — the plan no longer describes reality

### 4. strategic_plan_v6 was never revised after the timeline collapsed
Plan: Phase A = 4 weeks, Phase B done by month 3. Reality (Aug 2026, ~month 3): still
pre-Phase-B, in a remediation programme the plan doesn't mention. The reconciliation's own
anti-drift rule (§13.4: any Phase B redefinition "must be revised (v2)… No silent
re-divergence") was violated by D34. A reader of the strategic plan alone has a wrong
picture of the next six months.
**Missing:** strategic_plan v7 or a short "delta" doc; Phase B kickoff brief v2 (named as
"the next critical document" in May, still absent).

### 5. Decision numbering collision — two Decision 32s
decisions_log_v1 assigns 32 to *Embedding Provider*; the amendments file assigns 32 to
*Video editorial boundary* and believes the log holds 31 decisions. Cross-references
("Decision 32 below") are now ambiguous. Trivial to fix, corrosive if left: the decision
log is the project's memory.

### 6. Sequencing contradiction nobody has written down
D34 defers all Phase B features for graph integrity — while amended D19 pulled video (a
Phase D deliverable) forward to July and made it a primary format. Whatever the rationale
(revenue early, decoupled from graph), no document states it, so the plan reads as
"integrity before features, except the biggest feature."

### 7. Phase E targets rest on a channel already flagged broken
D13's free tier and §8's 5,000/25,000-subscriber targets assume Telegram; the amendment
records Telegram "unstable in Pakistan" — the core market. Targets stand unrevised.

## Tier 3 — process says one thing, practice does another

### 8. The ritual layer has no tooling and no evidence of happening
Sprint planning Mondays, daily check-ins, Friday reviews, monthly metric/risk/cost reviews,
quarterly strategic review, "documentation freshness <30 days" — none scheduled, recorded,
or measured anywhere. The J Loop automates the *issue* layer only. Either automate the
cadence (the loop could open a sprint issue every 2 weeks) or delete it from the method —
a method that documents rituals that don't happen trains readers to ignore it.

### 9. Three unreconciled state machines
Method issue-states (Backlog→Done) vs workflow stages (INTAKE→…→LOG) vs J-Loop labels
(spec-ready→…→ready-to-ship). No crosswalk. G1 (sprint scope) never fires because nothing
represents a sprint; G5's kill-switch precondition has no implementation; G6/G9 guard
workflows that don't exist yet. The agent assigns its own risk class at INTAKE — i.e. the
gated party decides which gates it faces (mitigated in practice by /plan's "when in doubt,
gate it", but that's convention, not mechanism).

### 10. Phase A exit failure is corrected but not prevented
The exit check failed as a *path* check ("looked for a directory that never existed") rather
than a content check. The correction fixes the assessment; the method still says only
"each criterion is checked." One sentence would prevent recurrence: *exit criteria are
verified against artifact content, with the artifact linked in the exit doc.*

### 11. Documentation currency is asserted, not owned
CLAUDE.md promises STATE_OF_PLAY/env_reference/architecture "are kept current"; no doc says
who updates them or when, and the method's maintenance cadence is quarterly. The J Loop's
new `[queued]/[proposed]/[building]/[shipped]` markers give STATE_OF_PLAY a mechanism for
the open-items list; nothing equivalent exists for the other two.

## Tier 4 — worth writing down before they bite

- **Env drift:** ~9 load-bearing flags where prod value ≠ code default (unified affinity,
  breaker, storylines, video autopost…). A fresh deploy without prod's exact `.env` silently
  reverts the product to an older behaviour. The duplicated `STORYLINE_ENABLED` trap is
  documented but left in place.
- **Secrets:** flat `.env`, single copy, "back it up before edits"; Facebook disk-cache
  outranks the env var (rotation no-op); Graph API pin drifts silently at v26 expiry;
  YouTube refresh tokens die in 7 days if the app leaves production mode. All accounts
  bus-factor 1.
- **dependencies.md is stale** (May 2026, many [TBD]s incl. SMTP provider marked Critical,
  domain renewal date, Sentry cost). Gemini is a single live path for both LLM and
  embeddings.
- **Revenue mechanics unmodelled:** ad sales function, institutional sales motion, 50K-
  follower assumption for partnerships, and no budget/runway/cost model anywhere in /docs.
- **The part-time engineer** (Phase D risk mitigation) appears in no phase plan or budget.

---

## Five smallest actions with the largest coverage

1. Backup runbook + off-site copy + one tested restore. (Tier 1.1)
2. Free uptime monitor on `/api/healthz` → Slack. (Tier 1.2)
3. `node --test` in CI. (Tier 1.3 — one line in the workflow file.)
4. Renumber the second Decision 32 → 35; add one paragraph to the amendments stating the
   D19-vs-D34 sequencing rationale. (Tier 2.5, 2.6)
5. A 1-page strategic delta: "where v6 stands as of Aug 2026" — cheaper than v7, kills most
   of Tier 2.

Items 1–3 are J-Loop-sized; they could be filed as `j-loop:proposed` issues today.
