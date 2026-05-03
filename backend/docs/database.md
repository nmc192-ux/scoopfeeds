# Database Operations

Scoopfeeds uses SQLite via `better-sqlite3`. SQLite remains the source of truth in this phase.

## Current shape

- Main application tables are still initialized directly in `src/models/database.js`.
- Reality Index tables are still initialized separately in `src/realityIndex/schema.js`.
- This direct initialization stays in place for backward compatibility with existing deployments.

## Migration runner

- Migration runner: `src/db/migrate.js`
- Migration files: `src/db/migrations/`
- Applied migrations are tracked in `schema_migrations`.

Design rules:

- Migrations must be idempotent.
- Prefer additive changes only.
- Keep direct `CREATE TABLE IF NOT EXISTS` schema bootstrapping until a later cleanup phase.

Current managed operational tables:

- `admin_audit_logs`
- `background_job_runs`
- `api_slow_logs`
- `job_idempotency_keys`

## Connection safety

The shared DB bootstrap now sets:

- `PRAGMA journal_mode = WAL`
- `PRAGMA synchronous = NORMAL`
- `PRAGMA cache_size = 10000`
- `PRAGMA temp_store = MEMORY`
- `PRAGMA busy_timeout = 5000`

## Transactions

Reusable transaction helper:

- `src/db/transaction.js`

Use it when a multi-statement write must succeed or fail atomically.

## Query timing

Query timing helper:

- `src/db/queryTiming.js`

It logs slow DB operations when they exceed `DB_SLOW_QUERY_THRESHOLD_MS` or the helper-specific threshold.

## Maintenance

Maintenance helper:

- `src/db/maintenance.js`

It runs:

- `PRAGMA optimize`
- `ANALYZE`
- optional `VACUUM` during the low-traffic maintenance window

The scheduler invokes this daily. `VACUUM` is only attempted when `ENABLE_SQLITE_VACUUM=true`.

## Backups

Create a timestamped backup:

```bash
npm run db:backup --prefix backend
```

Backups are written to `backend/data/backups/` or the sibling `backups/` directory next to `SCOOP_PERSISTENT_DATA_DIR/news.db`.

## Rollout notes

- Existing deployments continue to work because schema initialization still happens in code before migrations run.
- New migrations should be additive and safe to re-run.
- Reality Index schema is intentionally not migrated in this phase; it remains under its existing initializer until we split that area into dedicated migrations later.
