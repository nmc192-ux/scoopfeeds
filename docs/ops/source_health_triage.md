# Source health triage

Companion to `npm run source:triage` (`backend/scripts/source-triage.mjs`).

Context: prod `sourceHealth` on 2026-08-10 showed 53 of 162 ingestion sources with
`consecutive_failures > 0` and 52 with no success in 24h, while ingestion itself was
healthy (3,333 articles in the trailing 24h). This is the triage of that signal.

---

## 1. What the tool is for

`source_health` mixes together four populations that need four different responses.
Reading the endpoint as one list of "failing sources" is what makes it unactionable.

| Population | How to spot it | Response |
|---|---|---|
| **Orphan** | health row with no entry in `config/sources.js` | sweep the row — there is no config entry to delete |
| **Never worked** | `last_success IS NULL` + `total_articles = 0` | bad URL from day one — fix the URL or delete the entry |
| **Regressed** | had successes, then stopped | root-cause it; check for a cohort first |
| **Failing now** | `consecutive_failures > 0`, recent last_success | usually transient — 429/5xx |

```bash
cd backend
npm run source:triage                          # offline: reconcile + cohorts
npm run source:triage -- --probe               # + live-fetch every source
npm run source:triage -- --db /tmp/prod.db     # against a pulled snapshot
npm run source:triage -- --json /tmp/out.json  # machine-readable
```

Read-only: opens SQLite in `readonly` mode and does not call `getDb()`/`bootstrapSchema()`,
so it is safe against a prod snapshot. It never edits `config/sources.js` — retiring or
repointing a source is a DrJ call, so the tool recommends and stops.

---

## 2. Structural findings (verified in-repo, 2026-08-11)

### 2.1 `source_health` is never reconciled against config — orphan rows accumulate

`updateSourceHealth()` (`models/database.js:1038`) upserts on `source_name` alone, and
nothing ever deletes. Removing an entry from `config/sources.js` therefore does **not**
remove its health row: the row stops being updated and keeps its final counters forever.

Config currently defines **110 RSS + 44 YouTube = 154** sources. Prod reports **162**
health rows. The 8-row difference is orphans.

This matters because it inverts the diagnosis for a whole group. The Reuters sub-feeds,
Associated Press and WHO Headlines named in the report **do not exist in
`config/sources.js`** — they were removed on 2026-05-15 (see the change log in the
`sources.js` header; `feeds.reuters.com` went NXDOMAIN and `apnews.com/apf-*` began
serving an HTML hub page). Nothing has fetched them since. Their counters are frozen,
not growing, and they cannot be "retired" — there is no config entry left to delete.
They need the health row swept.

> Renaming a source has the same effect: the new name starts a fresh row and the old one
> is stranded. Any rename is silently a source retirement plus a source addition.

### 2.2 `source_health` and `ingestion_logs` key the same source differently

| | `source_health.source_name` | `ingestion_logs.source_name` |
|---|---|---|
| RSS | `<name>` | `<name>` |
| YouTube | `yt:<name>` | `YouTube:<name>` |

`videoFetcher.js:99/115` writes `yt:` to health; `:101/117` writes `YouTube:` to the log.
Nothing joins the two tables today, so the mismatch has been harmless — but any forensic
query that goes from a failing counter to its error history has to bridge it. The tool
does this via `healthKey()` / `logKey()` in `src/services/sourceTriage.js`.

### 2.3 There is no backoff, quarantine or retry ceiling

`fetchAllSources()` (`rssFetcher.js:239-255`) walks the entire configured list every cycle
regardless of history. A source that has failed 6,971 consecutive times is attempted again
on the next cycle, on the same schedule as BBC News.

At the shipped cadences — `"2,32 * * * *"` (48 RSS cycles/day, `scheduler.js:603`) and
`"9 * * * *"` (24 video cycles/day, `:618`) — roughly 40 permanently-dead sources cost on
the order of **1,700-1,900 wasted outbound requests/day**. The tool prints the exact figure
for the current health table.

### 2.4 The fetcher has no per-source User-Agent or timeout override

Both fetchers build **one module-level `Parser`** with fixed headers
(`rssFetcher.js:21-35`, `videoFetcher.js:9-22`). The RSS UA is
`NewsAggregator/1.0 (RSS Reader; educational/news aggregation)` with a 15s timeout.

So for the observed failures:

- `Status code 403` (BMJ News, The Block, Daily Nation) — if any of these is UA-gating,
  it is **currently unfixable without a code change**. There is no per-source override to
  set. The triage tool's `ua_gated` verdict exists to size that change before making it.
- `Request timed out after 15000ms` (NHK World) — same: the 15s timeout is global.

### 2.5 `ingestion_logs` is never pruned

`pruneOldArticles()` (`models/database.js:968`) covers articles; nothing covers
`ingestion_logs`. Two consequences, one good and one bad:

- **Good, and the key to the cohort question:** prod holds the complete per-attempt history,
  including `error_msg` and `fetched_at` for the exact moment each source stopped working.
  The answer to "what happened on 2026-07-01" is already recorded — it just needs querying.
- **Bad:** 154 sources x 48 cycles/day ≈ 7,400 rows/day, unbounded. `pull-prod-db.mjs`
  already notes this table at 44 MB and bounds its pull accordingly.

---

## 3. The 2026-07-01 cohort

ESPN, Dawn News and Inside Climate News share a last success of 2026-07-01 and an
**identical** 1,431 consecutive failures. Identical counters across three independently-hosted
sources are not a coincidence: `consecutive_failures` only increments on an attempt, so
equal counts mean all three failed on exactly the same cycles. That is one cause, and it
should be root-caused once rather than triaged three times.

**Unverified — the cause is not yet known.** Two avenues were tried and both are exhausted
in the current environment:

- Live probing: this session's egress proxy denies all news domains by policy
  (`CONNECT tunnel failed, 403` for 110/110 RSS hosts; `WebFetch` returns `EGRESS_BLOCKED`).
- Git history: the repo only goes back to 2026-07-22. There are **no commits** in the
  2026-07-01 window, so a config or fetcher change on that date cannot be confirmed or
  ruled out from this repo. If one happened, it predates the current history.

### 3.1 An arithmetic result that narrows it

The count itself is informative, and it points away from the three sources.

`consecutive_failures` increments once per attempt and resets on success, so for a source
failing continuously since its last success the count must equal the number of cycles
elapsed. From 2026-07-01 to 2026-08-10 is ~40 days; at 48 cycles/day that is **~1,925
expected**. Observed is **1,431** — a ratio of 0.74.

**About 490-560 cycles never attempted these sources at all.** A source cannot cause its
own counter to skip: not-incrementing means not-attempted. So somewhere in that 40-day
window the ingestion cycle did not run for the equivalent of ~10 days.

That reframes the question. Before investigating what ESPN, Dawn and Inside Climate News
have in common, check whether the ingestion cycle stalled between 2026-07-01 and ~2026-07-11
— and whether these three are bystanders that simply never recovered when it resumed, rather
than the thing that broke. `enqueueSingletonJob`'s dedup trap
(`jobs/queues.js`, documented inline) has frozen queues for days before.

`failureBudget()` performs this check for every cohort the tool reports.

### 3.2 The query that settles it

The transition is in prod's `ingestion_logs`. Pull a window wide enough to cover it —
2026-07-01 is ~45 days before 2026-08-10, so `--days 60` gives margin:

```bash
cd backend
node scripts/pull-prod-db.mjs --days 60          # includes ingestion_logs + source_health
npm run source:triage -- --db <snapshot>
```

The COHORTS section prints, per member, the **first** error logged after the last success —
the transition — alongside the gap between them. Read it as:

- **gap ≈ one cycle (0.5h)** → the sources broke while ingestion kept running. The shared
  `error_msg` at that moment names the cause.
- **gap >> one cycle** → the cycle stopped. Investigate the scheduler for that window; the
  sources are bystanders.

Given the 0.74 budget ratio, the second is the more likely finding — but the log decides it,
not this document.

---

## 4. Triage buckets

`--probe` refetches every configured source with the production `Parser` — same User-Agent,
same Accept header, same timeouts — so a verdict here means the same thing as a row in
`source_health`, and its error strings are byte-identical to those in `ingestion_logs`.
Failures are retried once with a stock browser UA, which is the only way to separate
"this origin rejects *our* UA" from "this origin rejects everyone".

| Verdict | Bucket | Meaning |
|---|---|---|
| `healthy` | keep | parses, has items |
| `moved` | **fix** | works, but the origin redirects elsewhere — URL is stale |
| `ua_gated` | **fix** | 403 to our UA, real feed to a browser UA (needs §2.4) |
| `not_a_feed` | **fix** | 200 but no feed root, or zero items — wrong URL |
| `timeout` | **fix** | slow origin — needs a longer per-source timeout |
| `not_found` | **retire** | 404/410 to both UAs |
| `dns` | **retire** | host does not resolve — the one unambiguous retirement |
| `forbidden` | review | 403 to both UAs — see the caution below |
| `rate_limited` | review | 429 — back off, not dead |
| `server_error` | review | 5xx — origin-side, re-probe |
| `tls` | review | certificate failure, not necessarily death |

**Run `--probe` from a host with normal egress.** A blocked network reports every source as
failing and the verdicts are worthless — this is exactly what happened when the triage was
first attempted from a sandbox.

**Never retire on a 403 alone.** A datacenter or CI IP can be blocked where the prod host is
not, so a `forbidden` from a probe host says nothing certain about prod. It is deliberately
a `review` bucket, not `retire`. Confirm from a prod-like IP first.

---

## 5. Not done, and why

- **No config entries were changed.** The fix/retire split needs live probe evidence that
  could not be gathered here (§3). Deleting sources on a guess is how a recoverable feed
  becomes a permanent gap.
- **No orphan sweep was run.** It is a `DELETE` against prod data; it needs DrJ approval,
  and it should run after a triage confirms the orphan list rather than before.
- **No backoff was added.** §2.3 is real waste, but changing when ingestion retries is a
  prod behaviour change that belongs behind a flag with its own before/after measurement —
  not a side effect of a triage.
