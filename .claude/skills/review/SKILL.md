---
name: review
description: Run the J Loop review worker. Picks up a built GitHub Issue, reviews it for security and quality, tests it, opens a PR, and pings Slack. Use when the user runs /review.
disable-model-invocation: true
---

# J Loop — /review

Review ONE built issue like a skeptical senior engineer, then open a PR and ping the human.

Notify with `.claude/bin/jloop-notify <ready|blocked|failed> "<title>" "<body>"`.

## 1. Find work

```bash
gh issue list --label "j-loop:built" --state open --json number,title,createdAt --jq 'sort_by(.createdAt) | .[0]'
```

If empty: print `JLOOP_IDLE` and stop. Do not sleep — the runner handles waiting.

## 2. Claim it

```bash
gh issue edit <N> --remove-label "j-loop:built" --add-label "j-loop:reviewing"
gh issue view <N> --json title,body,comments
git checkout j-loop/issue-<N>-<slug> && git pull
```

## 3. Review the diff

`git diff main...HEAD`. Be adversarial — finding nothing is rare. Check spec compliance (every criterion actually met), security, correctness at the edges, and convention drift.

Fix trivia yourself. For anything substantive: comment findings, set `j-loop:spec-ready`, `jloop-notify blocked`, stop.

## 4. Test it

- Full suite, lint, build. Compare against the CLAUDE.md baseline — pre-existing failures aren't this PR's fault, and saying so is part of an honest review.
- Web changes: run the flow in a browser, screenshot to `.j-loop/screenshots/issue-<N>/`.
- Run any verification the spec demands. If you could not run one, write "unverified" — never imply a check passed that you did not perform.
- Write numbered test steps a non-developer can follow.

## 5. Open the PR

```bash
git push
gh pr create --title "<title> (#<N>)" --body-file <pr-body.md> --base main
gh issue edit <N> --remove-label "j-loop:reviewing" --add-label "j-loop:ready-to-ship"
```

PR body: plain-language summary, what changed, test steps, screenshots, verification results including anything unverified, and `Closes #<N>`.

## 6. Ping

```bash
.claude/bin/jloop-notify ready "#<N> <title>" "<2-3 sentence plain-language summary>

*Test it:*
1. <step>
2. <step>

*Watch for:* <most likely problem, or 'nothing — clean review'>

PR: <url>

Merge with: /ship <PR number>"
```

Print `JLOOP_DONE <N>` and stop.

## Rules

- Never merge. One issue per run. Agreeable reviews are useless reviews.
