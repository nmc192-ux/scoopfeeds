# Phase A — Retrospective Inputs

This file accumulates findings during Phase A execution. Sprint 6's
formal Phase A Retrospective will synthesize these into structured
lessons.

## Sprint 1 findings

### 1. Brief inaccuracies surfaced in 3 of 4 code issues
Issues 1.3 (auth model), 1.4 (translation gap), 1.5 (cost framing)
each had Brief framings that investigation corrected. Future Phase
Briefs should build investigation phases into every issue by default,
not as exceptions.

### 2. Translation pipeline produces poor-quality Urdu output
Discovered via Issue 1.4 production deploy. Mojibake characters
in translated content; partial translations leaving English mixed
with Urdu. Affects: AI service routing, source content pipeline,
UI rendering. Phase B/C investigation needed.

### 3. Mixed English-Urdu content in RTL mode creates UX problems
Even when individual translations are clean, English-source content
displayed in RTL layout reads badly. Phase B/C should consider
per-content-direction handling.

### 4. Hostinger GitHub auto-deploy disconnection
Exact cause unclear; manual redeploys work fine. Don't investigate
mid-Phase-A unless it becomes painful.

### 5. Codex's prior hardening was more thorough than Brief credited
Admin auth was already enforced globally before Sprint 1 began.
Issue 1.3 was code clarity, not a security fix. The Brief's framing
("close fail-open gap") was incorrect; the commit message corrected it.

### 6. Smoke test design referenced non-existent metric
Sprint 1 Issue 1.5 smoke test referenced `lastTimelineBuilderRun`
field in `/api/health` that doesn't exist. Future smoke-test plans
should verify metric existence before shipping. For timeline-builder
specifically, post-deploy verification needs to be log-based or
DB-based — or add instrumentation as part of Sprint 3 metrics work.

### 7. Alarm response to ambiguous data needs calibration
Article count drops and uptime resets are normal in cloud hosting;
not every anomaly is a bug signal. First diagnostic should always
be "is this metric meaningful?" before "is this metric broken?"

### 8. Hostinger restarts cause partial database rollback
Production has experienced two restarts in 37 hours, each causing
~300-600 articles to disappear from the database (15,269 → 14,897 →
14,301). Articles ingested in stable periods persist correctly
(verified: 14,301 → 14,498 over 50 minutes of stable uptime, ~4
articles/minute ingestion). The loss happens at restart events,
suggesting news.db is being restored from a snapshot taken before
the most recent ingestion period. Likely root cause: Hostinger
persistent-storage configuration where the database file lives on
ephemeral storage and snapshots restore on restart. Fix likely
involves moving the database to a persistent volume or adjusting
backup/restore policy. Investigation needed in a separate session:
confirm via file-system inspection where news.db is stored and
whether sibling backup files exist with stale snapshots. Logged for
Phase A retrospective; not blocking Sprint 2 work because production
is functional in stable periods and restarts are infrequent.

### 9. Phase A Brief described a phantom bug in Issue 2.1
Sprint 2 Issue 2.1 was scoped to fix "ALTER TABLE migrations re-run
on every restart and log success even when no-op." Investigation
revealed all 5 ALTER TABLE sites in the codebase already use a
column-existence guard pattern (PRAGMA + if (!cols.some(...))) that
short-circuits before any log fires on already-applied migrations.
The formal migration system at backend/src/db/migrate.js tracks
applied migrations in a schema_migrations table and is also
idempotent. Issue 2.1 closed as no-op; no code change needed.

This is the second case in Phase A where the Brief described
behavior that didn't match the codebase (the first was Sprint 1
Issue 1.3, where the local requireAdmin in ri-ops.js was already
dead code due to upstream global middleware). Pattern: the Brief
was written without full knowledge of Codex's prior hardening work.
Going forward, every Phase A issue's investigation phase should
include a "verify the Brief's premise" check before proposing a
fix, and Issues that turn out to be no-ops should be tracked as
a meta-data point about Brief accuracy.
