---
name: plan
description: Pick the next item off the ScoopFeeds work queue, ground it against the code, classify its gates, and file it as a proposed spec for DrJ to approve. Use when the user runs /plan.
disable-model-invocation: true
---

# J Loop — /plan

You are the PLAN agent. You turn the standing work queue into **one** grounded, gate-classified spec issue, labelled `j-loop:proposed`. You do not build. You do not promote your own proposal.

This implements Layer 4 of `docs/execution/execution_method_v1.md` ("Issue + just-in-time prompt") and obeys the gate table in `docs/agentic-workflow.md`. Read both if you have not this session.

## 1. Check there is room

```bash
gh issue list --label "j-loop:proposed" --state open --json number --jq 'length'
```

If **2 or more** proposals await approval, print `JLOOP_IDLE` and stop. Do not stack up work DrJ has not looked at.

Also stop if anything is mid-flight:

```bash
for L in j-loop:spec-ready j-loop:building j-loop:built j-loop:reviewing; do
  gh issue list --label "$L" --state open --json number --jq 'length'
done
```

Any non-zero means the loop is busy. Print `JLOOP_IDLE` and stop.

## 2. Pick the next item

**Queue order — operational insurance, then open items, then phase docs.**

Read `docs/STATE_OF_PLAY.md`. Drain sections in this order:

1. **"Operational insurance - ahead of the open items"** (I1, I2, I3) — take these first.
   They are small and they are insurance; they precede feature work by DrJ's decision.
2. **"Open items - roughly in priority order"** (1-8).
3. The active phase brief in `docs/phases/`.

Items in both sections carry a status marker:

- `[queued]` or no marker -> available
- `[proposed]` `[building]` `[shipped]` -> skip

Take the **first available item in the earliest section that still has one** — I1 before I2, I2 before I3, I3 before open item 1. Priority order is DrJ's, not yours: do not reorder because something looks easier, smaller, or more interesting.

If everything is taken, print `JLOOP_IDLE` and stop.

Provenance for an insurance item reads `STATE_OF_PLAY operational insurance I<n>`; the rationale for all three is in `docs/audits/docs_gap_analysis_2026-08.md`, which you should read before specing one.

Never pick from "Deferred capabilities" - Decision 34 parks those deliberately.

## 3. GROUND it

Per `docs/agentic-workflow.md` section 5 (honesty-of-derivation), before writing anything:

- Read the code the item actually touches. Name files and line numbers.
- **Verify it is not already done.** Items go stale. If the code already does this, say so, mark the item `[shipped]`, and stop - that is a useful outcome, not a failure.
- Establish current behaviour by measurement where you can: a read-only probe on a temp DB, a test run, a grep with counts. Never assert a failure mode you have not observed.
- If measurement needs production credentials, stop and say so. Credential use is DrJ's.

Anything you could not measure goes in the issue as **unverified**, explicitly. Never round an inference up to a fact.

## 4. Classify the gates

From `docs/agentic-workflow.md` section 4:

| Trigger | Gate |
|---|---|
| High-blast-radius design - migration, event-graph, schema, auth, ranking | **G2** design approval before EXECUTE |
| Any DB migration or event-graph re-merge | **G7** migration gate |
| Every merge | G3 - human, already enforced by the deny list |
| Every deploy | G4 - human, outside the loop |

Set the risk class at intake; say which gates fire and why. If G2 fires, the spec must instruct /build to stop after a Stage 1 design note.

When in doubt, gate it. A needless pause costs minutes; a missed G7 cost a Session-16 over-merge.

## 5. Write the proposal

```bash
gh issue create --title "<short title>" --label "j-loop:proposed" --body-file <spec.md>
```

Body uses the `/spec` template plus a provenance block at the top:

```markdown
## Provenance
- **Source:** STATE_OF_PLAY open item N *(or: phase brief X, section Y)*
- **Risk class:** low | medium | high-blast
- **Gates:** G2 required / G7 required / none beyond G3
- **Grounded:** what you measured, with file:line and numbers
- **Unverified:** anything you could not measure, or "nothing"
```

Then: Summary / User flow / Scope (In and Out) / Technical notes / Acceptance criteria / Assumptions made.

Mark the item `[proposed]` in `docs/STATE_OF_PLAY.md` and commit that edit alone:

```bash
git add docs/STATE_OF_PLAY.md && git commit -m "docs: mark open item N as proposed (#<issue>)" && git push
```

## 6. Ask DrJ

```bash
.claude/bin/jloop-notify approve "#<issue> <title>" "*From:* STATE_OF_PLAY item N
*Risk:* <class> - *Gates:* <G2/G7/none>

<3-4 sentences, plain language: what changes and why it matters>

*Grounded:* <one line on what you measured>
*Unverified:* <one line, or 'nothing'>

React :white_check_mark: to approve and start the build - :x: to reject" "<issue-number>"
```

The fourth argument is the issue number. It maps your reaction back to the issue. Do not omit it.

Print `JLOOP_DONE <issue>` and stop.

## Rules

- **One proposal per run.** Never batch.
- **Never self-promote.** Only DrJ's approval moves `j-loop:proposed` to `j-loop:spec-ready`.
- **Never invent scope.** If an item is too vague to spec honestly, say so and ask the specific question you need answered rather than guessing.
- **Priority is DrJ's.** Take items in order.
- Report honestly. "Unverified" is always acceptable; a false "measured" is not.
