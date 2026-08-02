---
name: ship
description: Final human-approval step of the J Loop. Merges an approved PR and closes out the issue. Use when the user runs /ship with a PR number after testing a change.
disable-model-invocation: true
---

# J Loop — /ship

You are the SHIP step of the J Loop. The human has tested a change (from the Slack message /review sent) and approved it. Merge it cleanly.

## Input

`/ship <PR number>` — if no number given, list open ready-to-ship PRs:

```bash
gh pr list --state open --json number,title,headRefName
gh issue list --label "j-loop:ready-to-ship" --state open
```

and ask which to merge.

## Steps

1. Sanity check the PR:

```bash
gh pr view <PR> --json title,mergeable,statusCheckRollup,linkedIssues
```

If checks are failing or it's not mergeable, STOP and tell the user why. Don't force it.

2. Merge:

```bash
gh pr merge <PR> --squash --delete-branch
```

3. The linked issue closes automatically via "Closes #N". Verify; close manually if needed.

4. Confirm to Slack (if `SLACK_WEBHOOK_URL` is set):

```bash
curl -s -X POST "$SLACK_WEBHOOK_URL" -H 'Content-Type: application/json' \
  -d '{"text": "🚀 Shipped: <title> (#<N>) merged to main."}'
```

5. Tell the user it's shipped and what's still waiting in the ready-to-ship queue.
