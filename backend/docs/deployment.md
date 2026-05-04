# Deployment

This deployment model runs Scoopfeeds as four separate services:

- `web`
- `scheduler`
- `worker`
- `redis`

SQLite remains the source of truth. Persistence comes from the shared `SCOOP_PERSISTENT_DATA_DIR` volume.

## Process model

### Web

- command: `npm run start:web`
- sets `ENABLE_SCHEDULER=false`
- serves the API and built frontend
- exposes `/api/healthz` and `/api/readyz`

### Scheduler

- command: `npm run start:scheduler`
- single replica only
- owns cron scheduling
- shuts down cleanly by stopping cron tasks and startup timers on `SIGTERM` / `SIGINT`

### Worker

- command: `npm run start:worker`
- can scale horizontally
- drains BullMQ workers on shutdown before exit

### Redis

- BullMQ backing store
- persisted with append-only mode

## Required environment variables

Minimum deployment variables:

- `PORT=3000`
- `NODE_ENV=production`
- `PRIMARY_SITE_URL=https://scoopfeeds.com`
- `ENABLE_SCHEDULER=false` for web
- `USE_BULLMQ=true`
- `REDIS_URL=redis://redis:6379`
- `SCOOP_PERSISTENT_DATA_DIR=/var/lib/scoop`

Common important variables:

- `ADMIN_BEARER_TOKEN`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SLOW_API_THRESHOLD_MS`
- `REQUIRE_REDIS=false` or `true`
- SMTP / Stripe / push / social credentials as needed for enabled features

## Persistence

SQLite persistence depends on:

- `SCOOP_PERSISTENT_DATA_DIR`

Inside Compose, it is mounted at:

- `/var/lib/scoop`

That directory holds:

- `news.db`
- backup artifacts
- other persisted backend data

## Docker

Root image build:

```bash
docker build -t scoopfeeds:latest .
```

The image:

- installs backend and frontend dependencies
- builds the frontend
- runs the backend from `/app/backend`

## Local Docker Compose

Start the full production-style stack locally:

```bash
docker compose -f docker-compose.production.yml up --build
```

Detached mode:

```bash
docker compose -f docker-compose.production.yml up -d --build
```

Scale workers horizontally:

```bash
docker compose -f docker-compose.production.yml up -d --scale worker=3
```

Stop the stack:

```bash
docker compose -f docker-compose.production.yml down
```

## Production deployment

Typical production rollout:

1. Build or pull the latest image.
2. Ensure `backend/.env` is populated with production secrets.
3. Start Redis.
4. Start one scheduler.
5. Start one or more workers.
6. Start one or more web containers behind your reverse proxy.

Example:

```bash
docker compose -f docker-compose.production.yml up -d --build redis scheduler worker web
```

Important:

- keep `scheduler` at one replica
- scale `worker` only
- keep the SQLite volume mounted for every backend process

## Health and logs

### Web

Health endpoint:

```bash
curl -s http://127.0.0.1:3000/api/healthz
curl -s http://127.0.0.1:3000/api/readyz
```

Compose healthcheck is configured on `/api/healthz`.

### Scheduler

Scheduler health is operationally log-based because it is not an HTTP process:

```bash
docker compose -f docker-compose.production.yml logs -f scheduler
```

Look for:

- `boot`
- `started`
- cron activity and expected cycle logs

### Worker

Worker health is operationally log-based:

```bash
docker compose -f docker-compose.production.yml logs -f worker
```

Look for:

- `boot`
- `ready`
- BullMQ completion / failure logs

## Safe shutdown behavior

### Web

- closes the HTTP server on `SIGTERM` / `SIGINT`
- flushes observability before exit

### Scheduler

- stops cron tasks
- clears delayed startup timers
- flushes observability before exit

### Worker

- closes BullMQ workers
- closes Redis connections
- flushes observability before exit

## Backups

Create a DB backup from the repo:

```bash
npm run db:backup --prefix backend
```

Create a backup inside the running web container:

```bash
docker compose -f docker-compose.production.yml exec web npm run db:backup
```

## Queue inspection

Protected diagnostics:

```bash
curl -H "Authorization: Bearer <ADMIN_BEARER_TOKEN>" \
  http://127.0.0.1:3000/scoop-ops/queues/status
```

Full diagnostics:

```bash
curl -H "Authorization: Bearer <ADMIN_BEARER_TOKEN>" \
  http://127.0.0.1:3000/scoop-ops/diagnostics
```

Container logs:

```bash
docker compose -f docker-compose.production.yml logs -f web
docker compose -f docker-compose.production.yml logs -f scheduler
docker compose -f docker-compose.production.yml logs -f worker
docker compose -f docker-compose.production.yml logs -f redis
```
