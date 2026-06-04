# Scoopfeeds Mission Control

A single-file, self-updating dashboard tracking Scoopfeeds development against the Phase B plan.

## How it works
On every page load it fetches live data client-side — no server, no build step:
- **GitHub API** (`api.github.com`): last 100 commits, classified into Track 1/2/3 by your commit-prefix conventions (`feat(trackers)` → T1, `feat(scoring)` → T2, `perf(cache)` → T3, `docs(retrospective)` → session marker). Cached in localStorage for 10 minutes to stay under the 60 req/hr unauthenticated limit.
- **Raw repo files**: `docs/phases/phase_b_retrospective_inputs.md` parsed for session count and highest finding number.
- **`status.json`** (this folder): manually maintained — exit-criteria statuses, audience metrics, risk watchlist. Items marked ⚙ are automatic; items marked ✎ come from this file.

## Deploy (GitHub Pages, free)
1. Copy this `dashboard/` folder into the repo root and commit to `main`.
2. On GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`** → Save.
3. Dashboard appears at `https://nmc192-ux.github.io/scoopfeeds/dashboard/` within a minute or two.

It also works opened directly from disk (`file://`) or dropped on the VPS — `status.json` then loads from the same folder.

## Per-session maintenance (~1 minute)
Edit `status.json`: flip criteria between `not-started` → `in-progress` → `met`, update `lastUpdated`, toggle risks. Commit. The dashboard reflects it on next load.

Note: the public repo means a public dashboard — it reveals nothing the repo doesn't already.
