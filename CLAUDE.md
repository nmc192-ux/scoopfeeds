# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Scoopfeeds — an event-centric news platform (live at scoopfeeds.com). Node/Express + SQLite
backend, React/Vite frontend. The distinctive part is the **event graph**: articles are
embedded, clustered, promoted into durable events, and rendered as a reader-facing dossier.

**Read these before touching event-graph, dossier, or pipeline code** — they describe shipped
behaviour, not intent, and they are kept current:

- `docs/STATE_OF_PLAY.md` — what's shipped, what's dark, what's next (start here)
- `docs/architecture/dossier_and_event_graph.md` — how the system actually works
- `docs/reference/env_reference.md` — every flag, its code default, and its prod value
- `docs/agentic-workflow.md` — the gates, the honesty rules, who approves what
- `docs/video-pipeline.md` — the YouTube automation: format, Rule 0, sourcing,
  selection gates, publishing, and the ops runbook. **Read it before touching
  anything under `backend/src/services/video*.js`** — most of its rules were
  earned by a live failure and look arbitrary without that history.

## Commands

Run from the repo root unless noted.

```bash
# Local dev — backend must be on PORT=4000 (vite proxies /api and /scoop-ops there)
PORT=4000 npm run dev:web         # express + nodemon, scheduler off
npm run dev:scheduler             # cron process (enqueues BullMQ jobs)
npm run dev:worker                # BullMQ consumers
npm run dev --prefix frontend     # vite on :3000

npm run build                     # npm ci both workspaces + vite build

# Tests — there is NO `npm test`. Unit tests use the built-in node:test runner.
cd backend && node --test "src/**/*.test.js"                  # all of them (30 files)
cd backend && node --test src/services/videoEditorialPolicy.test.js   # a single file
cd frontend && npm run test:e2e                               # playwright (starts vite itself)
cd frontend && npx playwright test tests/e2e/smoke.spec.js    # single spec

# Database
cd backend && npm run db:migrate  # apply pending migrations (idempotent, tracked in schema_migrations)
cd backend && npm run db:backup
cd backend && node scripts/pull-prod-db.mjs --dry-run   # subset pull of prod db for analysis

# Ops helpers
cd backend && npm run signal:http     # signal read-layer HTTP server
cd backend && npm run signal:mcp      # same, as an MCP server
cd backend && npm run source:triage   # ingestion source health triage (read-only)
cd backend && npm run source:triage -- --probe   # + live-fetch every source
```

CI (`.github/workflows/node.js.yml`) only installs, builds the frontend, and runs
`node --check backend/server.js` on Node 18/20/22. It does not run tests — verify locally.

Most backend tests live under `src/skills/scoring/`. The suite is **green on Node 24** —
464 pass / 0 fail across 30 files, measured on `main` at 611f3ac. It used to be red out of the
box (every failure a bare `SQLITE_ERROR`) because those tests built a temp DB with
`runMigrations()` alone, and migration 011 references `event_articles`, which no migration
creates. Fixed by the `bootstrapSchema()` ordering contract (issue #1); a failure now is
probably yours.

### Known-flaky: SIGABRT on a subset of test files (2026-08, UNRESOLVED)

On some machines 6-9 test files fail as a whole with `'test failed'`, **no stack**, and
`signal: SIGABRT`. Their individual subtests all pass; the file passes when run alone. The
suite's total test count **varies between runs** (610 / 524 / 516 / 485 observed), because a
straggler landing during a later test aborts the remainder of that file.

Root cause, confirmed from the abort text: `Assertion failed: (env) != nullptr` in
`node::Assert` — a **native addon called during environment teardown**. Which addon is not
yet identified. Ruled out: test concurrency (`--test-concurrency=1` does not help), file
descriptors (`ulimit -n 8192` does not help), missing `.env`, and
`@sentry-internal/node-cpu-profiler` (identical on both machines, and it ships no Node 24 ABI
build). Two fixes have already been made in this area and neither resolved it —
`src/testing/testDb.js` no longer closes handles at all, precisely because doing so from an
exit hook *caused* this same abort.

**It is timing-dependent, so it reproduces on some machines and not others.** As of
2026-08 the MacBook is green (610/610) and the Mac Mini build worker is not.

**For /review: these failures are NOT caused by the PR under review.** Establish the baseline
by running the suite on `main` first, and report the delta. A file in the list below failing
is not evidence of a regression; a *new* file failing is.

Commonly affected: `src/db/bootstrapOrder.test.js`, `src/services/videoAutopost.test.js`,
`src/skills/scoring/evidence/{articleBodyPrepass,bylineCrossCheck,coiAndSeverity,
judgmentOnPresence,ownership_2_4_a,pageDiscovery,primaryLinks,siteFetch,wikidataClient}.test.js`,
`src/skills/scoring/runtime/founderReview.test.js`.

Next diagnostic step: the native frames beneath `node::Assert` in the assertion output name
the addon. Tracked as insurance item I5 in `docs/STATE_OF_PLAY.md`.

**Never call `runMigrations()` directly to build a test DB** — use
`makeTestDb()` from `src/testing/testDb.js`, which seeds the real base schema in the real
order. `runMigrations()` on an unseeded DB now throws a named precondition error.

## Architecture

### Three processes, one image

`SCOOP_PROCESS_ROLE` splits the same codebase into `web` / `scheduler` / `worker`
(`docker-compose.production.yml`). Only the scheduler runs cron; only the worker consumes
BullMQ queues; web serves the API and the built SPA.

```
scheduler (node-cron) → enqueueSingletonJob → Redis/BullMQ → worker → runIngestionCycle /
                                                                       runEnrichCycle / runVideoCycle
web → express routers → repositories / realityIndex DAL → SQLite (better-sqlite3 + sqlite-vec)
```

**Per-process state is the recurring bug class here.** A flag or capability initialized in
one role (e.g. `sqlite-vec` availability, historically set only by `initRealityIndex()` on
web) silently no-ops in the others. Initialize in `getDb()` or an equivalent shared path, not
in a role-specific bootstrap.

Queue definitions and the singleton-jobId self-heal live in `backend/src/jobs/`. The dedup
trap is documented inline in `queues.js:enqueueSingletonJob` — BullMQ refuses to re-add a
jobId that still exists in *any* state, including completed, which once froze three queues
for days. Don't remove that removal.

### The event graph

`backend/src/realityIndex/` is the pipeline:

- `ingest/` — RSS, aggregators, markets, trends, geo, sports
- `embeddings/` — Gemini embeddings, stored via `sqlite-vec`
- `clustering/semanticClusterer.js` — greedy centroid-cosine
- `intelligence/` — the judges: `eventPromoter` (create/match/merge/absorb), `eventBreaker`
  (curative split + facets), `storyAffinity` (**the single affinity measure all judges
  share**), `chainStoryline`, `eventTimelineBuilder`, `entityExtractor`/`entityIdf`
- `dal/` — data access; routes never touch SQL directly

**One measure, ordered bands.** Promoter, merge and breaker all read `storyAffinity` with
AFFINE / AMBIGUOUS / FOREIGN bands. Three judges asking three different questions on three
quantities is what produced the create-merge-split treadmill (174 slugs for one story). Do
not introduce a second, differently-computed similarity for a judge.

Every decision emits a 🧭 log line (`promoter-create`, `promoter-merge`, `promoter-match`, …).
That log is the calibration corpus — preserve it when editing promoter paths.

### Reader-facing dossier (`/events/:slug`)

Header → Timeline → Coverage → Angles → Actors → Intelligence. Two rules that look like bugs:

- **Earn-render**: a section renders only when it has real data. An absent section is
  correct. No placeholders, no empty containers.
- The header is **mechanical only** — no LLM prose. The removed summary was the vector for a
  whole contamination class.

`docs/architecture/dossier_and_event_graph.md` §3 has the full "looks like a bug, is correct"
table. Check it before "fixing" a rendering surprise.

### Frontend

React 18 + Vite + Tailwind + react-query + zustand. `src/hooks/use*.js` wrap every API
surface; `src/lib/api.js` is the single axios client. Admin SPA routes and admin API
endpoints share the `/scoop-ops` prefix — `vite.config.js` disambiguates them by `Accept`
header, so don't "simplify" that proxy bypass.

### Admin boundary

All `/scoop-ops/*` routers sit behind one mount that applies `adminAuth` + `adminAuditLogger`
(`server.js`). Sub-routers must not re-implement auth; adding a router under that prefix
inherits it automatically. The prefix is `/scoop-ops` rather than `/admin` to bypass a host WAF.

## Conventions that matter

**Feature flags are the ship mechanism.** New reader-facing work ships dark behind an env
flag or a URL param (`?facets=1`, `?tl=0`, `?a2=0`), gets eyeballed live, then flips to
default. Any flag you add belongs in `docs/reference/env_reference.md` with its code default
*and* its prod value — the code default is what most of prod actually runs on.

**GROUND before building.** For anything touching the graph or prod data: run a read-only
analysis against a copy-on-write copy of a prod snapshot, produce verbatim artifacts, and
stop at the report. These harnesses are ad-hoc `backend/_*.mjs` scripts and are
**gitignored on purpose** — they are disposable, they reuse production functions verbatim
rather than reimplementing them, and they never write.

**Honesty rules are enforced, not aspirational** (`docs/agentic-workflow.md` §5): unmeasured
is reported as "unverified", never "passing"; known-corrupt data is flagged and refused, not
papered over; sampling or truncation is stated. No silent caps.

**DrJ approves every irreversible action** — merge to main, prod deploy, migration, external
post, credential use. Agents never deploy to prod. Build, verify, and present; don't ship.

## Gotchas

- **Env loading**: `src/config/env.js` reads `backend/.env` then `~/.scoopfeeds.env`, and
  never overwrites an already-set var. Import it (or `--require ./backend/load-env.cjs`)
  before anything that reads `process.env`.
- **DB location**: `SCOOP_PERSISTENT_DATA_DIR` must point outside the deploy directory in
  prod (`/var/lib/scoop`), otherwise a redeploy destroys `news.db`.
- **Postgres adapter is a seam, not a path.** `src/db/index.js` deliberately returns the
  SQLite adapter regardless of `DATABASE_PRIMARY`.
- **Machine events** (USGS/NOAA) carry no articles and have caused two production failures by
  consuming selection windows. Any query that picks "the freshest N events" needs
  `AND EXISTS (SELECT 1 FROM event_articles …)`.
- **`source_health` is never reconciled against config.** It upserts on `source_name` and
  nothing deletes, so removing an entry from `config/sources.js` leaves its health row
  behind with frozen counters — indistinguishable on `/api/news/stats` from a source
  failing right now (162 rows vs 154 configured sources). Renaming a source strands the old
  row the same way. `npm run source:triage` separates the populations; see
  `docs/ops/source_health_triage.md`. Related: the same source is keyed `yt:<name>` in
  `source_health` but `YouTube:<name>` in `ingestion_logs`.
- **`event_articles` has no `ON DELETE CASCADE`.** The 7-day article prune must sweep orphan
  links itself (`pruneOldArticles`), or the graph rots into dangling-link inflation.
- **Migrations are a hand-maintained array** in `src/db/migrate.js` — a new file must be
  imported and appended there, or it never runs.
- **Migrations are not the whole schema.** The base tables come from
  `models/database.js:initializeSchema()` and `realityIndex/schema.js:initRealityIndex()`;
  `db/migrations/*` layer on top and assume those ran first. The order is owned by
  `bootstrapSchema()` in `models/database.js` — `initializeSchema` → `initRealityIndex` →
  `runMigrations` — and every entry point (`getDb()`, the `db:migrate` CLI, `makeTestDb()`)
  goes through it. `runMigrations()` on an unseeded DB throws a named precondition error
  rather than dying at 011 with `no such table: event_articles`.
- **`initRealityIndex()` guards per CONNECTION, not per process** (a `WeakSet` of db
  handles). It was a module-level boolean, which silently no-oped for any second connection
  in the same process — the per-process-state bug class again.

## The J Loop (`.claude/skills/`)

`/spec` → `/build` → `/review` → `/ship`, coordinated through GitHub Issue labels
(`j-loop:spec-ready` → `building` → `built` → `reviewing` → `ready-to-ship`). `/build` works
on a branch and never merges; `/ship` is the human-approved merge step.
