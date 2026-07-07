# ScoopFeeds — Agentic Build Workflow

**Version:** v1 · **Status:** Reference (operator runbook) · **Owner:** DrJ

> **What this is.** A step-by-step operating manual for running ScoopFeeds work
> through Claude Code agents *safely*. It defines one loop, who does each stage,
> which model tier runs each role, and — most importantly — **exactly where you
> (DrJ) must stop and approve before anything irreversible happens.**
>
> **Who it's for.** An operator who is newer to coding. You do not need to write
> code to run this. You need to: pull a work item, let the agents run the
> reversible stages, and make a yes/no decision at each 🛑 gate.
>
> **Prime directive (from the execution method, verbatim):**
> *"DrJ is always the final decision-maker."* /
> *"Claude Code is an execution agent, not a decision authority."*
> — `docs/execution/execution_method_v1.md:619-620`

---

## 0. How to read this document

- **§1** is the loop — the named stages every piece of work travels through.
- **§2** is who runs each stage (which agent pattern, which personas, what messages).
- **§3** is which model tier each role uses, and why.
- **§4** is the 🛑 **HARD STOPs** — the approval gates. This is the section you live in.
- **§5** is the honesty rules every agent must obey.
- **§6** is a worked example on real current (Phase B) work.
- **§7** is the one-page operator cheat-sheet.

**Two framing decisions baked into this spec:**
1. **Phase-agnostic, illustrated with Phase B.** The loop works in any phase. Where
   this doc needs a concrete example it uses the *actual current state*: Phase B's
   three parallel tracks (product features / skills-architecture / infrastructure),
   currently blocked by the Session-16 event-graph over-merge, with VPS migration
   **M6** as the last open infra item.
2. **One unified loop for everything.** Code, content, sources, deploys, trackers,
   and translations all ride the same loop; the *work type* only changes which
   approval gate(s) fire (§4).

**Input note.** The design brief included a slot for takeaways from a shared video;
it was left as an empty placeholder, so **no video context was incorporated.** This
is stated rather than invented — consistent with the honesty rules in §5.

---

## The rules this design protects (the "Magna Carta")

Every gate and guardrail below traces back to one of these commitments. Quoted verbatim.

| # | Commitment | Source |
|---|---|---|
| C1 | "**Zero-tolerance.** Every claim citable. 'I don't know' preferred over fabrication." | `strategic_plan_v6.md:275` (Decision 28) |
| C2 | "AI-generated drafts with human review (DrJ or designated reviewer) **on every post**" | `strategic_plan_v6.md:247` (Decision 20) |
| C3 | "**Kill-switch enables 30-second retraction** across all platforms" | `strategic_plan_v6.md:249` |
| C4 | "Never partisan, never sensationalized. Trade engagement for trust." | Decision 22 |
| C5 | Provenance marker on every translation; "Human review only when AIs disagree" | Decision 17 |
| C6 | "DrJ approves both the prioritization and the specific sources before onboarding" | Decision 16 |
| C7 | "**DrJ is always the final decision-maker.**" / "**Claude Code is an execution agent, not a decision authority.**" | `execution_method_v1.md:619-620` |
| C8 | Roles: Code execution = Claude Code *under DrJ review*; **Production deploys = DrJ** (final approval, verification, rollback) | `execution_method_v1.md:602-604` |
| C9 | "An issue is Done when… deployed to production **AND verified working**" | `execution_method_v1.md` (Definition of Done) |
| C10 | JIT prompts generated at execution moment; **never batch-run** because "review can't keep up" | `execution_method_v1.md:239-247` |
| C11 | **Halt conditions:** security vuln affecting users / accuracy failure damaging credibility / legal issue / core dependency dies / ethical conflict | `execution_method_v1.md:660-667` |
| C12 | Risk — "Codex / agent execution drift… Mandatory deploy-verification step. Post-merge smoke tests." | `strategic_plan_v6.md` risk register |

**The central reconciliation.** Async multi-agent orchestration rewards *fan-out*
(many agents at once). But C10 warns that batch execution outruns human review. This
spec resolves the tension with one rule that appears everywhere below:

> **Fan-out is allowed only on reversible stages (read / draft / verify). Every
> irreversible action is serialized through a single human gate.**
> Parallelism raises the throughput of *proposals*, never of *commits*.

---

## 1. The ScoopFeeds Work Loop

Every work item — a code issue, a social post, a candidate source, a deploy, a
tracker, a translation — travels the same nine stages. The item is **tagged at
intake** with its type (`code · content · source · deploy/ops · tracker ·
translation`); the type only decides which gate(s) in §4 apply.

```
        ┌──────────────────────────── iterate on failure ──────────────────────────┐
        │                                                                           │
 (0) INTAKE → (1) GROUND → (2) PLAN/DRAFT → (3) EXECUTE → (4) VERIFY → 🛑(5) GATE → (6) SHIP → (7) PROD-VERIFY → (8) LOG
   Ready item     JIT ctx      approach       artifact in    tests +     DrJ says   irreversible   smoke test +     record +
                             (no effect)      isolation     honesty ok    yes/no      action       30-min watch     track-tag
        │                                                       ▲                                        │
        └───── HALT (any of the 5 halt conditions) ─────────────┴──────── rollback within 15 min ◄───────┘
```

| # | Stage | Entry condition | Exit condition | Reversible? |
|---|---|---|---|---|
| 0 | **INTAKE / FRAME** | Item is "Ready" in the sprint backlog (per Issue lifecycle) | Item has acceptance criteria + **type tag** + **risk class** | yes |
| 1 | **GROUND (JIT)** | Framed item | Current-state brief written *against today's code/data* (not last week's) | yes (read-only) |
| 2 | **PLAN / DRAFT** | Grounded | An approach (code) or a draft (content/source list) exists — **no external effect** | yes |
| 3 | **EXECUTE** | Approved plan/draft | Artifact produced **in isolation** (git worktree / unpublished draft) | yes |
| 4 | **VERIFY** | Artifact exists | Tests pass **+** honesty audit clean **+** provenance attached | yes |
| 5 | **🛑 GATE (HARD STOP)** | Verified artifact | **DrJ explicit approval for this specific item** | — |
| 6 | **SHIP** | DrJ approved | Irreversible action executed (merge / deploy / post / onboard) | **NO** |
| 7 | **PROD-VERIFY** | Shipped | Health check passes + no new errors for 30 min + metrics flowing (C9, C12) | partial (rollback) |
| 8 | **LOG / RETRO** | Verified in prod | Prompt+response saved to the issue; **track-tag** logged; retro note if needed | yes |

### Risk class (set at INTAKE, drives model tier and gates)

| Risk class | Meaning | Examples |
|---|---|---|
| **Reversible** | Easy to undo; low blast radius | copy tweak, new read-only endpoint, adding a test |
| **Irreversible** | Cannot be cleanly undone | merge to `main`, prod deploy, external post, source onboard, DB migration, credential use |
| **High-blast-radius** | Reversible-ish but touches many systems | event-graph logic, auth, schema, money/billing, ranking weights |

### Iterate vs. terminate vs. HALT

- **Iterate the item.** VERIFY fails → return to **EXECUTE** (or to **PLAN** if the
  design itself is wrong). PROD-VERIFY fails → **rollback within 15 minutes**
  (`execution_method_v1.md:484-492`, "Don't try to fix forward in production") →
  return to **INTAKE**.
- **Terminate the item.** Definition of Done met (C9) → item is **Done**. "Done in
  code but not in production is not Done."
- **Terminate the sprint loop.** All Ready items Done, or Friday sprint-review
  reached (slipped items go back to backlog, not into a growing sprint).
- **Terminate the phase loop.** All phase exit criteria met **and verified**. (Phase
  B: the unified exit criteria spanning the three tracks — product, architecture,
  infra.)
- **HALT the entire loop.** If any of the five halt conditions (C11) occur —
  security vuln affecting users, an accuracy failure that damages credibility, a
  legal issue, a core dependency dying, or an ethical conflict — **stop all work,
  document, convene DrJ.** Do **not** halt for sprint slips, phase slips,
  disagreements about approach, or unfamiliar problems (those are normal; research,
  don't halt — `execution_method_v1.md:669-674`).

---

## 2. Agent roles — who runs each stage

### Two orchestration patterns (named)

- **Pattern A — Fixed N-agent team.** One Lead plus a *fixed, known set* of
  persona'd helpers coordinating through a message hub. Use for **stable,
  known-shape** work — the code EXECUTE→VERIFY→SHIP path is always the same team.
- **Pattern B — Async subagents (dynamic spawn).** The Lead spawns helpers **on
  demand**, polls their status, collects reports, then tears them down. Use for
  **variable-width** work — you don't know in advance how many files to read, how
  many candidate sources to vet, or how many platforms to draft for.

### The coordination substrate

Helpers talk to the Lead through a message hub: `send_message` to post, and the
**inbox is appended to the last tool result** so messages arrive *inline*.

> **Design principle: agents don't poll for messages.** Because the inbox rides the
> last tool result, an agent sees new messages the next time it does anything — no
> busy-wait loop. (Dynamic Pattern-B work *does* use `get_status` to check whether a
> spawned helper has *finished its task*, and ends with `kill_subagents` to reclaim
> them — that's lifecycle polling, not message polling.)

### The Lead — "Orchestrator / Sprint Lead"

One Lead runs the loop for the active sprint. Its job:

- Pull the Ready item; tag type + risk class.
- Route each stage to the right pattern and personas.
- Collect helper reports and reconcile disagreements.
- **Package the gate** for DrJ (what changed, why, the evidence, what's irreversible).
- **It is the only agent that speaks to the human, and it never takes an
  irreversible action itself.** (C7, C8.)

### Stage → pattern → personas → messages

| Stage | Pattern | Persona(s) — one-line job | Messages that flow |
|---|---|---|---|
| 0 INTAKE | — (Lead only) | — | Lead reads the backlog, tags the item |
| 1 GROUND | **B** (dynamic) | **Scout** — "reads current code/data so the prompt fits reality (C10)" | Lead spawns N Scouts (unknown # of files/sources) → `get_status` → collect briefs → `kill_subagents` |
| 2 PLAN/DRAFT | **A** for code · **B** for content | **Architect** — "proposes the approach & names the blast radius"; **Drafter** — "writes one draft per channel"; **Source Scout** — "proposes candidate sources + priority cells" | Lead ↔ Architect debate the approach; Lead spawns 1 Drafter per platform / 1 Source-Scout per candidate |
| 3 EXECUTE | — (single **Coder**) | **Coder** — "writes code in an isolated git worktree, one item at a time" | Lead → Coder assign; Coder → Lead "diff ready" |
| 4 VERIFY | **A** (fixed team) | **Reviewer** — "correctness + conventions"; **Honesty Auditor** — "every claim cited, pending stays pending (C1)"; **Verify-Runner** — "runs tests / health checks" | Coder → Reviewer; Reviewer → Honesty Auditor (escalate claims); team → Lead verdict |
| 5 🛑 GATE | — (human) | — | Lead → **DrJ** gate package; DrJ → Lead approve / reject |
| 6 SHIP | — (single **Deployer**, human-triggered) | **Deployer** — "executes the already-approved merge / deploy / post" | DrJ-approved → Lead → Deployer |
| 7 PROD-VERIFY | **A** | **Prod-Verifier** — "smoke test + error watch + metrics check (C9, C12)" | Prod-Verifier → Lead pass / fail |
| 8 LOG | — (Lead only) | — | Lead writes prompt+response + track-tag to the issue |

**Why single-threaded EXECUTE.** C10 is explicit that pre-writing/batching prompts
produces low-quality work "because review can't keep up." So the *reversible*
stages fan out for speed, but code is written and shipped **one item at a time**,
each with a fresh JIT prompt against the current codebase.

### Which work types use which pattern

- **Pattern A (fixed team):** a code issue — the team shape (Coder + Reviewer +
  Honesty Auditor + Verify-Runner + Prod-Verifier) never changes.
- **Pattern B (dynamic spawn):** **GROUND** (unknown # of files); **source
  onboarding** (N candidate sources vetted in parallel, then one approval batch —
  C6); **content** (one Drafter per platform); **citation checking** (one checker
  per claim, so the count scales with the number of claims).

---

## 3. Model tiering — by cost of being wrong

**Principle:** assign the model tier by the **cost of the agent being wrong**, not
by task difficulty. Cheap/reversible → **Haiku**. Standard → **Sonnet**.
High-stakes/irreversible → **Opus**.

| Role | Tier | One-line justification |
|---|---|---|
| **Honesty Auditor** | **Opus** | A fabricated claim "destroys credibility for years" (Decision 28 / C1) — the single highest cost-of-wrong in the whole project. |
| **Architect** — high-blast-radius (migrations, event-graph, schema, auth, money, ranking weights) | **Opus** | A wrong design here is expensive to reverse and is exactly what produced the Session-16 over-merge. |
| **Prod-Verifier** — irreversible deploys / migrations | **Opus** | Missing a prod regression on something you can't cleanly undo is an uptime + credibility hit (C12). |
| **Orchestrator / Lead** | **Sonnet** | Standard coordination; it takes no irreversible action, so its errors are caught downstream before any gate. |
| **Coder** — standard code | **Sonnet** | Work is reversible in a worktree and caught by Reviewer + tests before the merge gate. |
| **Architect / Coder** — routine, low-blast-radius | **Sonnet** | Ordinary reversible work; the safety net (VERIFY + gate) sits behind it. |
| **Reviewer** | **Sonnet** | A judgment task, but there is a second net (Honesty Auditor) and a human gate behind it. |
| **Drafter** — content | **Sonnet** | The draft is fully reversible; DrJ reviews **every** post in Phase B (C2). The stakes live in the *audit*, which is Opus. |
| **Scout** — read-only grounding | **Haiku** | Cheap and reversible; a misread surfaces in PLAN or VERIFY. |
| **Source Scout** — proposes sources | **Haiku** | Proposal only; DrJ approves every source (C6), so the cost of a bad proposal is ~zero. |
| **Verify-Runner** — runs tests/commands | **Haiku** | Mechanical execution of deterministic checks. |
| **Deployer** — executes the approved action | **Haiku** | Runs an already-human-approved, scripted action; no judgment remains. |

> **Escalation rule (stated once, applies everywhere).** Escalate a role **one tier**
> whenever the *item's* risk class is **irreversible** or **high-blast-radius**, even
> if the role defaults lower. A Coder on the event-graph runs Opus; a Coder on a copy
> tweak runs Sonnet (or Haiku). The tier follows the blast radius, not the job title.

---

## 4. 🛑 HARD STOPs — the human approval gates

**The absolute rule:** every irreversible action — **commit / merge, deploy,
migration, external post, credential use** — is **ALWAYS gated.** No exceptions, no
"just this once," no agent self-approval. This is the operational form of C7 and C8.

Which gates fire depends on the item's **type tag** (set at INTAKE). An item can
trip more than one (e.g., a code change to the deploy path trips **G3 + G4**).

| Gate | Fires on | Applies to types | Protects |
|---|---|---|---|
| **G1 · Sprint-scope commit** | Start of each sprint | all | "scope does not expand mid-sprint" (`execution_method_v1.md:138`); binding kickoff gate |
| **G2 · Design approval** | Before EXECUTE on high-blast-radius work (migration, event-graph, schema, auth, ranking) | code, tracker | Agent-execution-drift risk (C12); strategic-invalidation halt |
| **G3 · Merge to `main`** | Before any merge | code | "DrJ reviews Claude Code output before merge" (C8); Definition of Done (C9) |
| **G4 · Production deploy** | Before any deploy | code, deploy/ops | "Production deploys \| DrJ \| final approval, verification, rollback" (C8) |
| **G5 · External content post** | Before any social / newsletter post goes live | content | "human review on every post" (C2); zero-tolerance (C1); never partisan/sensationalized (C4) |
| **G6 · Source onboarding** | Before a source is added to the matrix | source | "DrJ approves both the prioritization AND the specific sources" (C6) |
| **G7 · Migration / data operation** | Before any DB migration or event-graph re-merge | code, deploy/ops | Prevents a Session-16 over-merge repeat; data ops are irreversible |
| **G8 · Credential / infra change** | Before VPS firewall / DNS / secret / M-series infra change | deploy/ops | Outward-facing + irreversible; ops safety (e.g., the M6/VPS work) |
| **G9 · Sensitive translation** | Before publishing sensitive translated content, or when the two AIs disagree | translation, content | Provenance marker + "human review only when AIs disagree" (C5) |

### The gate package (what the Lead hands you at every 🛑)

So you can decide in seconds without reading code, the Lead presents a fixed format:

```
GATE: G_  ·  Item: <id / title>  ·  Type: <...>  ·  Risk: <reversible | irreversible | high-blast>
WHAT CHANGED:   <plain-English summary>
WHY:            <the acceptance criterion this satisfies>
EVIDENCE:       <tests: pass/fail · health check · lighthouse · screenshot>
HONESTY AUDIT:  <clean | flags: ...>   ← from the Opus Honesty Auditor
IRREVERSIBLE?:  <exactly what becomes permanent if you approve>
ROLLBACK PLAN:  <how we undo it if PROD-VERIFY fails>
DECISION:       [ Approve ]   [ Reject + reason ]
```

**Your job at a gate is a yes/no**, plus a reason if no. You never have to hand-edit
the artifact — a rejection sends it back to EXECUTE with your reason attached.

### Two always-on safety mechanisms (independent of the gates)

- **Kill-switch (C3).** Any live external content must be retractable within 30
  seconds across all platforms. The Deployer confirms the kill-switch is armed as
  part of SHIP for any `content` item; if it can't confirm, the item does not ship.
- **HALT (C11).** Separate from approvals: if a halt condition appears at *any*
  stage, the Lead stops the loop and escalates immediately — it does not wait for
  the next gate.

---

## 5. Honesty-of-derivation guardrails

These are written into **every** agent's instructions and enforced hardest by the
Opus **Honesty Auditor** at VERIFY. They are the operational form of C1 and C5.

1. **Pending stays pending.** No metric or exit criterion may be marked "met"
   without a verifiable source. Unmeasured is reported as **"unverified,"** never as
   "passing." *(This directly models the real Phase B status: coverage % is
   "unmeasurable while `events`=0" — the honest report is "unverified," not a
   fabricated number.)*
2. **Available-but-wrong data is refused.** If data exists but is known-corrupt (the
   778-article over-merged blob), the agent **flags it and refuses to derive
   conclusions from it.** It does not paper over a known-bad input to produce a
   confident-looking answer.
3. **Every claim is traceable.** Each factual claim — in a code comment, a PR
   description, a social draft, or a status report — either links to a specific
   source or is explicitly tagged **`[inferred]`** or **`[assumption]`**. Untagged,
   unsourced claims fail the audit. (C1)
4. **Provenance is attached to content and translations.** Every translated or
   generated piece carries its model + verification status, e.g. *"Translated from
   [language] by [model], [verified by second AI / unreviewed]."* (C5)
5. **"I don't know" is returned upward, not invented.** When confidence is below
   threshold, the agent escalates to the Lead → DrJ, or falls back to organic
   results — it **never fabricates to fill a gap.** "I don't know" beats a confident
   wrong answer. (C1)
6. **No silent caps.** If a Scout or verifier sampled, truncated, or skipped
   anything (e.g., "read 40 of 120 files"), it says so in its report. A partial
   result is never presented as complete.

> **How this shows up at a gate.** The `HONESTY AUDIT` line in the gate package is
> the Honesty Auditor's verdict. If it reads anything other than `clean`, treat the
> flags as blocking until resolved — that line exists specifically so an operator
> who can't read the diff can still catch a fabrication before it ships.

---

## 6. Worked example (current Phase B work)

**Item:** *"Repair the event-graph over-merge so `events` > 0 in production"*
(the Session-16 blocker that currently stalls Phase B's product track).

| Stage | What happens | Pattern / tier |
|---|---|---|
| 0 INTAKE | Lead tags it: type = `code` + `deploy/ops`; risk = **high-blast-radius + irreversible** (touches event-graph logic *and* prod data). | Lead (Sonnet) |
| 1 GROUND | Lead spawns Scouts to read the current merge/clustering code, the prod probe showing the 778-article blob, and the BullMQ `realityIndex` queue state. Scouts report — **including** "prod `events`=0" as *unverified-until-reproduced*, not assumed. | **B** · Scout (Haiku) |
| 2 PLAN | Architect proposes the fix and **explicitly names the blast radius** (re-merge is a data migration). → **🛑 G2 Design approval.** | **A** · Architect (**Opus**, high-blast) |
| 3 EXECUTE | Coder implements in a worktree; no prod effect. | Coder (**Opus**, high-blast) |
| 4 VERIFY | Verify-Runner runs tests on a copy of the data; Honesty Auditor checks that any "fixed" / "coverage now X%" claim is backed by a real query, not the corrupt blob (guardrail #2). | **A** · Reviewer (Sonnet) + Auditor (**Opus**) |
| 5 🛑 GATE | Two gates fire: **G3 merge** and **G7 migration** (the re-merge is an irreversible data op). Lead hands DrJ the gate package with the rollback plan. | human |
| 6 SHIP | On approval, Deployer merges and runs the migration. | Deployer (Haiku, scripted) |
| 7 PROD-VERIFY | Prod-Verifier confirms `events` > 0, health check green, no new errors for 30 min, metrics flowing. **If not → rollback within 15 min.** | **A** · Prod-Verifier (**Opus**) |
| 8 LOG | Lead records the prompt+response and tags the session to the **product track**. | Lead (Sonnet) |

Contrast — a `content` item ("draft the X/LinkedIn/Instagram posts for a breaking
event") fans out one **Drafter per platform** (Pattern B, Sonnet), the Honesty
Auditor (Opus) checks citations + non-partisan tone (C1/C4), and it stops at **🛑 G5**
with the kill-switch armed (C3) — no G3/G4/G7 because nothing merges or migrates.

---

## 7. Operator cheat-sheet (one page)

**The loop:** `INTAKE → GROUND → PLAN/DRAFT → EXECUTE → VERIFY → 🛑 GATE → SHIP → PROD-VERIFY → LOG`

**Your only job is the 🛑.** Everything before it is reversible; nothing after it
happens without your yes.

**The gates, by what you're shipping:**
- Shipping **code** → 🛑 G3 (merge) → 🛑 G4 (deploy). High-blast design first → 🛑 G2. Migration → 🛑 G7.
- Shipping **content** → 🛑 G5 (+ kill-switch armed). Sensitive translation → 🛑 G9.
- Shipping a **source** → 🛑 G6.
- Shipping **infra/credentials** (VPS, DNS, secrets) → 🛑 G8.
- Every sprint starts with → 🛑 G1 (commit the scope; don't grow it mid-sprint).

**At every gate, read three lines:** `IRREVERSIBLE?`, `HONESTY AUDIT`, `ROLLBACK PLAN`.
If the audit isn't `clean`, or you don't understand what becomes permanent, **reject
and ask.** Rejection is free; a bad irreversible ship is not.

**Never let an agent:** approve its own gate · mark a metric "met" without a source ·
present partial results as complete · post/deploy/migrate/use-credentials without
your explicit per-action yes.

**HALT immediately (don't wait for a gate) if:** a security vuln hits users · a wrong
answer went viral · a legal notice arrives · a core dependency dies · something feels
ethically off. Everything else (slips, unfamiliar problems) is normal — research,
don't halt.

---

*Derivation note: every gate and guardrail in this document traces to a quoted
commitment in the table under "The rules this design protects." Where this spec
makes a design choice not dictated by a source (e.g., single-threaded EXECUTE, the
gate-package format), it is marked as a choice, not attributed to a rule — per the
honesty guardrails in §5.*
