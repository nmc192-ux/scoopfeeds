# J Loop — autonomous mode (Mac Mini + Slack approval)

The loop proposes work from the standing queue; you approve with an emoji from your
phone; it builds and reviews under the gates already defined in
[`docs/agentic-workflow.md`](../agentic-workflow.md).

```
STATE_OF_PLAY / phase briefs
        │
     /plan          reads the queue, GROUNDs against code, classifies G-gates
        │           files j-loop:proposed  →  Slack 🟣
        │
   you react ✅     (from anywhere)
        │
     /build         → G2 design note first on high-blast work
        │
     /review        → tests, PR, Slack 🟢
        │
    you /ship       (merging stays human — G3)
```

## Roles

| Skill | Model | Runs | Does |
|---|---|---|---|
| `/plan` | Opus | Mini, when idle | One grounded proposal at a time. Never self-promotes. |
| `/build` | Sonnet | Mini | Implements a spec-ready issue. Stops at G2 if the spec says so. |
| `/review` | Opus | Mini | Adversarial review, tests, PR, Slack ping. Never merges. |
| `/ship` | — | You | Merge. G3 is human by design and `gh pr merge` is in the deny list. |

## Status markers

`docs/STATE_OF_PLAY.md` open items carry `[queued]` · `[proposed]` · `[building]` · `[shipped]`.
`/plan` takes the lowest-numbered `[queued]` item; `/review` marks `[shipped]` on merge.
Priority order is yours — the loop does not reorder.

## Slack setup for emoji approval

The incoming webhook is one-way. Approving by reaction needs a bot token.

1. https://api.slack.com/apps → your **J Loop** app
2. **OAuth & Permissions** → Bot Token Scopes, add:
   - `chat:write` — post messages
   - `channels:history` + `reactions:read` — read your reactions
   - `groups:history` as well if `#j-loop` is private
3. **Install to Workspace**, copy the **Bot User OAuth Token** (`xoxb-…`)
4. In Slack: `/invite @J Loop` in `#j-loop`
5. Get the channel ID — right-click the channel → View channel details → bottom of the dialog (`C…`)
6. Add both to your shell profile and to the launchd plist:

```bash
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_CHANNEL_ID="C..."
```

Test:

```bash
.claude/bin/jloop-notify approve "#999 test" "React ✅ to check the poller." 999
.claude/bin/jloop-approve
```

Without a bot token everything still works — you just approve with
`gh issue edit <n> --remove-label j-loop:proposed --add-label j-loop:spec-ready`
instead of a reaction.

## Reactions

| You react | Result |
|---|---|
| ✅ `white_check_mark` (or 👍 / 🚀) | Promoted to `j-loop:spec-ready`; build starts within 60s |
| ❌ `x` (or 👎 / ⛔) | Issue closed, comment recorded, plan item stays available |
| nothing | Sits pending. `/plan` stops proposing at 2 pending. |

## Guardrails

- **One proposal at a time**, two pending maximum. The loop cannot bury you.
- **`/plan` never promotes its own work.** Only your reaction does.
- **Gates are enforced from your own doc** — G2 on migration/event-graph/schema/auth/ranking, G7 on any data operation.
- **Merging and deploying stay human** (G3, G4).
- **Daily cycle cap** (default 40) and **halt-on-limit** — the daemon stops and tells you rather than spinning.
- **No production credentials on the Mini.** If a proof needs them, the loop says "unverified" and asks.

## Running it

```bash
.claude/bin/jloop-daemon              # foreground, for watching
launchctl kickstart -k gui/$(id -u)/com.jloop.scoopfeeds   # restart the service
tail -f .j-loop/logs/../daemon.log
```

Env: `JLOOP_ENABLE_PLAN=0` disables proposals and returns the loop to build/review only.
`JLOOP_DAILY_CAP=0` removes the cap. `JLOOP_MODEL_BUILD=opus` for a hard stretch of work.

## Turning it off

```bash
launchctl bootout gui/$(id -u)/com.jloop.scoopfeeds
```

Nothing is left running; open PRs and issues are unaffected.
