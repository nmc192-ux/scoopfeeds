# Postgres Migration Plan

This document prepares Scoopfeeds for a future migration from SQLite to Postgres without changing production behavior yet.

## Scope and principles

- SQLite remains the source of truth in this phase.
- No live data migration happens yet.
- No runtime cutover happens yet.
- The goal is to define target shapes, risks, and staged rollout mechanics.

## Current database split

- Core app schema is initialized in `backend/src/models/database.js`.
- Reality Index schema is initialized in `backend/src/realityIndex/schema.js`.
- SQLite-specific features currently in use:
  - `articles_fts` via SQLite FTS5
  - `embeddings` via `sqlite-vec` `vec0`
  - integer millisecond timestamps in most tables
  - JSON stored as `TEXT`

## Target Postgres conventions

- Primary keys:
  - Keep existing `TEXT` ids as `TEXT` where ids are already application-generated.
  - Convert `INTEGER PRIMARY KEY AUTOINCREMENT` tables to `BIGSERIAL` where practical.
- Timestamps:
  - Convert epoch-millisecond integers to `TIMESTAMPTZ` for new Postgres-native schema.
  - During backfill/cutover, accept epoch-millisecond transforms in ETL.
- Booleans:
  - Convert SQLite integer flags (`0/1`) to `BOOLEAN`.
- JSON:
  - Convert JSON-in-text columns to `JSONB`.
- vectors:
  - Replace `sqlite-vec` with `pgvector`.

## Table-by-table mapping

### Core content and user tables

| SQLite table | Postgres target | Notes |
|---|---|---|
| `articles` | `articles` | `published_at`/`fetched_at` -> `TIMESTAMPTZ`; `tags` -> `JSONB`; `is_featured`/`is_duplicate` -> `BOOLEAN` |
| `videos` | `videos` | `published_at`/`fetched_at` -> `TIMESTAMPTZ` |
| `subscribers` | `subscribers` | `topics` -> `JSONB`; verification/unsubscribe/send timestamps -> `TIMESTAMPTZ` |
| `users` | `users` | auth/user metadata stays relational; convert time columns to `TIMESTAMPTZ` |
| `auth_tokens` | `auth_tokens` | token expiry/create fields -> `TIMESTAMPTZ` |
| `user_sessions` | `user_sessions` | session timing fields -> `TIMESTAMPTZ` |
| `saved_articles` | `saved_articles` | join table can stay narrow; `created_at` -> `TIMESTAMPTZ` |
| `user_article_views` | `user_article_views` | strong candidate for retention policy later |
| `meter_events` | `meter_events` | consider long-term partitioning if growth accelerates |

### Ingestion, analytics, and operational tables

| SQLite table | Postgres target | Notes |
|---|---|---|
| `ingestion_logs` | `ingestion_logs` | `fetched_at` -> `TIMESTAMPTZ` |
| `source_health` | `source_health` | success/failure timestamps -> `TIMESTAMPTZ` |
| `analytics` | `analytics` | `metadata` -> `JSONB`; consider event retention window |
| `admin_audit_logs` | `admin_audit_logs` | safe direct mapping; retention policy recommended |
| `background_job_runs` | `background_job_runs` | `error_stack` remains `TEXT`; `created_at`/`started_at`/`finished_at` -> `TIMESTAMPTZ` |
| `api_slow_logs` | `api_slow_logs` | operational-only; retention policy recommended |
| `job_idempotency_keys` | `job_idempotency_keys` | `metadata` -> `JSONB`; likely unique on `(scope, idempotency_key)` |

### Push, social, monetization, and media tables

| SQLite table | Postgres target | Notes |
|---|---|---|
| `push_subscriptions` | `push_subscriptions` | `topics` -> `JSONB`; `disabled_at` -> `TIMESTAMPTZ` |
| `pushed_articles` | `pushed_articles` | direct mapping; `pushed_at` -> `TIMESTAMPTZ`; `sent`/`failed` -> `BOOLEAN` |
| `social_posts` | `social_posts` | direct mapping; preserve `(article_id, platform)` uniqueness |
| `tips` | `tips` | direct mapping; `created_at` -> `TIMESTAMPTZ` |
| `video_jobs` | `video_jobs` | likely operational queue table even after BullMQ maturity |
| `video_metrics` | `video_metrics` | engagement fields unchanged; timestamps to `TIMESTAMPTZ` |
| `live_events` | `live_events` | if JSON text exists, convert to `JSONB` |

### Content intelligence tables

| SQLite table | Postgres target | Notes |
|---|---|---|
| `story_clusters` | `story_clusters` | `keywords`, `article_ids`, `brief`, `perspectives` -> `JSONB` |
| `explained_pieces` | `explained_pieces` | `facts`, `timeline`, `sources` -> `JSONB` |
| `article_analysis_cache` | `article_analysis_cache` | `takeaways`/`related_ids` -> `JSONB` |

### Reality Index market and event tables

| SQLite table | Postgres target | Notes |
|---|---|---|
| `prediction_markets` | `prediction_markets` | `tags`/`raw_meta` -> `JSONB`; `resolved`/`active` -> `BOOLEAN` |
| `prediction_market_snapshots` | `prediction_market_snapshots` | partition by time; see partition section |
| `cluster_market_links` | `cluster_market_links` | direct mapping |
| `article_market_links` | `article_market_links` | direct mapping |
| `raw_signals` | `raw_signals` | `payload` -> `JSONB`; good partition candidate if growth spikes |
| `embedding_meta` | `embedding_meta` | stays relational alongside `pgvector` embeddings |
| `events` | `events` | `geo_country_codes`/`meta` -> `JSONB`; geo fields could later move to PostGIS |
| `event_timeline` | `event_timeline` | `ts` -> `TIMESTAMPTZ`; possible future partitioning if volume rises |
| `event_articles` | `event_articles` | direct mapping |
| `event_actors` | `event_actors` | direct mapping |
| `event_market_links` | `event_market_links` | direct mapping |
| `sentiment_snapshots` | `sentiment_snapshots` | strong candidate for time partitioning later |
| `reality_index_snapshots` | `reality_index_snapshots` | partition by time; see partition section |
| `anomaly_alerts` | `anomaly_alerts` | `payload`-like columns should become `JSONB` where applicable |
| `user_watchlists` | `user_watchlists` | watchlist filters/metadata -> `JSONB` if present |
| `api_keys` | `api_keys` | direct mapping; use `BYTEA` only if hashes/binary secrets are introduced |
| `synthetic_markets` | `synthetic_markets` | any JSON payloads -> `JSONB` |
| `synthetic_market_trades` | `synthetic_market_trades` | operational/trading ledger, append-heavy |
| `user_reputation` | `user_reputation` | direct mapping |
| `agent_reputation` | `agent_reputation` | direct mapping |
| `macro_indicators` | `macro_indicators` | values relational, metadata to `JSONB` if introduced |
| `generated_briefs` | `generated_briefs` | evidence and generated structures should become `JSONB` |
| `pushed_anomalies` | `pushed_anomalies` | direct mapping |

## Data type conversion rules

### Integer timestamps

Most current time columns are stored as epoch milliseconds in `INTEGER`. In Postgres:

- application-facing write target: `TIMESTAMPTZ`
- ETL/backfill transform: `to_timestamp(epoch_ms / 1000.0)`

### Boolean flags

Convert:

- `0` -> `FALSE`
- `1` -> `TRUE`

Examples:

- `articles.is_featured`
- `articles.is_duplicate`
- `prediction_markets.active`
- `prediction_markets.resolved`
- `pushed_articles.sent`
- `pushed_articles.failed`

### JSON text to JSONB

Primary candidates:

- `articles.tags`
- `analytics.metadata`
- `job_idempotency_keys.metadata`
- `push_subscriptions.topics`
- `story_clusters.keywords`
- `story_clusters.article_ids`
- `story_clusters.brief`
- `story_clusters.perspectives`
- `explained_pieces.facts`
- `explained_pieces.timeline`
- `explained_pieces.sources`
- `article_analysis_cache.takeaways`
- `article_analysis_cache.related_ids`
- `prediction_markets.tags`
- `prediction_markets.raw_meta`
- `raw_signals.payload`
- `events.geo_country_codes`
- `events.meta`
- `generated_briefs` evidence/detail payloads

## Index strategy

### Direct carry-over indexes

Carry forward most existing B-tree indexes with Postgres equivalents, especially:

- article feed/order indexes
- uniqueness constraints
- queue/job operational indexes
- event and market lookup indexes
- time-series descending indexes on `(entity_id, ts DESC)`

### New Postgres-specific index opportunities

- partial indexes for active or unresolved records:
  - `prediction_markets WHERE active = true`
  - `events WHERE status = 'active'`
- GIN indexes for `JSONB` search/filter columns:
  - `articles.tags`
  - `analytics.metadata`
  - `prediction_markets.raw_meta`
  - `raw_signals.payload`
- composite descending indexes for timeline/ops tables:
  - `background_job_runs (queue, created_at DESC)`
  - `api_slow_logs (created_at DESC)`

## Full-text search replacement for `articles_fts`

Current SQLite implementation:

- `articles_fts` virtual table
- sync triggers from `articles`
- fallback to `LIKE` if FTS is unavailable

Recommended Postgres replacement:

1. Add generated or maintained `tsvector` column on `articles`, for example `search_document`.
2. Populate from weighted fields:
   - `title` highest weight
   - `description` medium weight
   - `content` medium weight
   - `source_name` lower weight
3. Add GIN index on `search_document`.
4. Replace SQLite `MATCH` queries with `plainto_tsquery` or `websearch_to_tsquery`.

Suggested pattern:

- `setweight(to_tsvector('english', coalesce(title, '')), 'A')`
- `setweight(to_tsvector('english', coalesce(description, '')), 'B')`
- `setweight(to_tsvector('english', coalesce(content, '')), 'B')`
- `setweight(to_tsvector('english', coalesce(source_name, '')), 'C')`

## `pgvector` replacement for `sqlite-vec`

Current SQLite implementation:

- `embeddings` virtual table via `vec0`
- `embedding_meta` relational sidecar
- 768 dimensions

Recommended Postgres replacement:

- enable `pgvector`
- create `embeddings` table:
  - `id BIGSERIAL PRIMARY KEY`
  - `embedding vector(768) NOT NULL`
- keep `embedding_meta` as a relational sidecar or fold metadata into one table
- add IVF or HNSW indexes once workload shape is measured

Recommended first cut:

- separate `embeddings` and `embedding_meta` for parity with current design
- use cosine distance if that matches current retrieval semantics
- defer ANN tuning until production recall/latency data exists

## Partition strategy

### `prediction_market_snapshots`

Recommended partitioning:

- range partition by time on snapshot timestamp
- monthly partitions initially

Why:

- append-heavy write pattern
- retention/downsampling lifecycle
- point lookups remain scoped by `market_id`, while retention and archive operations stay cheap

Recommended primary model:

- partitioned parent table on `ts`
- per-partition local indexes:
  - `(market_id, ts DESC)`
  - `(tier, ts DESC)`

### `reality_index_snapshots`

Recommended partitioning:

- range partition by `ts`
- monthly partitions initially

Indexes per partition:

- `(scope, scope_id, ts DESC)`
- `(scope, ts DESC, truth_gap)`

Future extension:

- if event volume becomes very large, consider subpartitioning or additional covering indexes by `scope`

## Migration risks

### Data shape risks

- JSON text may contain malformed payloads that SQLite tolerated but `JSONB` cast will reject
- epoch-millisecond fields may contain mixed units in edge cases
- boolean-like integers may contain unexpected non-`0/1` values

### Query behavior risks

- SQLite FTS ranking and Postgres `ts_rank` will not match exactly
- `LIKE`/collation semantics differ
- SQLite permissive typing can hide bad data that Postgres rejects immediately

### Operational risks

- dual-write drift between SQLite and Postgres
- time-series tables may grow faster than expected once mirrored
- vector search recall may differ from `sqlite-vec` defaults

### Application risks

- existing ad hoc SQL spread across codebase means full cutover must inventory every direct query
- current schema is split across two initializers, so migration ownership boundaries must be clarified before cutover

## Staged cutover plan

### Stage 0: preparation

- keep SQLite as source of truth
- introduce DB adapter and repository seams
- move low-risk operational writes first

### Stage 1: schema parity in Postgres

- provision Postgres
- create DDL for all tables, indexes, FTS, and `pgvector`
- validate table counts and constraints in a non-production environment

### Stage 2: offline snapshot load

- export SQLite data
- transform timestamps, booleans, and JSON text
- load into Postgres staging
- validate row counts and sampled query results

### Stage 3: optional dual-write for operational tables

- start with append-heavy, low-risk tables:
  - `background_job_runs`
  - `api_slow_logs`
  - `admin_audit_logs`
- compare counts and sample records

### Stage 4: dual-write for selective core tables

- add guarded dual-write for a narrow subset of article or event writes
- keep all reads on SQLite
- monitor write latency, error rates, and divergence

### Stage 5: shadow reads

- compare selected read queries in the background
- start with non-user-facing admin or reporting queries

### Stage 6: read cutover by slice

- move operational dashboards first
- then low-risk APIs
- then primary content reads only after parity is proven

### Stage 7: primary switch

- set `DATABASE_PRIMARY=postgres`
- keep SQLite fallback for rollback window
- continue reconciliation jobs during the stabilization period

### Stage 8: decommission

- remove dual-write
- archive SQLite snapshots
- delete SQLite-specific code paths only after rollback window closes

## Notes for future dual-write

- dual-write should start with repositories only, not raw SQL call sites
- writes should be ordered:
  - primary write first
  - secondary write second
  - emit divergence log on secondary failure
- use idempotent upserts where possible
- add reconciliation scripts before enabling critical-table dual-write
- do not dual-write vector payloads until serialization, indexing, and recall semantics are validated

## Recommended first migration targets

Low-risk first:

- `background_job_runs`
- `api_slow_logs`
- `admin_audit_logs`
- `job_idempotency_keys`

High-risk later:

- `articles`
- `story_clusters`
- `prediction_market_snapshots`
- `reality_index_snapshots`
- vector-backed embedding search
