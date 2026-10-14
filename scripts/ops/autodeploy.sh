#!/usr/bin/env bash
# ScoopFeeds auto-deploy — full-throttle engine (DrJ, 2026-10-14).
# Rulebook: docs/engine/full-throttle.md. Runbook: docs/ops/runbooks/autodeploy.md.
#
# Runs every 5 minutes from scoopfeeds-autodeploy.timer. Each run:
#   1. stops if paused (local file, or an open GitHub issue labelled engine:pause)
#   2. stops if origin/main has nothing new
#   3. stops unless every GitHub Actions check on the new commit is green
#   4. HOLDS a range whose migrations contain DROP/DELETE/UPDATE/RENAME (stop list 1)
#   5. fast-forwards, builds ALL services, ups ALL services (deploy runbook §1)
#   6. health check: home page + /api/health answer 200, every service running
#   7. on failure: rolls back to the previous commit and never retries the bad one
#
# It follows docs/ops/runbooks/deploy.md exactly: build then up, never a service
# filter, always -f docker-compose.production.yml.
set -uo pipefail

REPO="${SCOOP_REPO:-/opt/scoopfeeds}"
GH_REPO="${SCOOP_GH_REPO:-nmc192-ux/scoopfeeds}"
SITE="${SCOOP_SITE:-https://scoopfeeds.com}"
STATE="${SCOOP_AUTODEPLOY_STATE:-/var/lib/scoopfeeds-autodeploy}"
COMPOSE=(docker compose -f docker-compose.production.yml)

mkdir -p "$STATE"
LOG="$STATE/autodeploy.log"
exec 9>"$STATE/lock"
flock -n 9 || exit 0

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >> "$LOG"; }

SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
for f in "$HOME/.scoopfeeds.env" "$REPO/backend/.env"; do
  if [ -z "$SLACK_WEBHOOK_URL" ] && [ -f "$f" ]; then
    SLACK_WEBHOOK_URL="$(grep -E '^SLACK_WEBHOOK_URL=' "$f" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
  fi
done
notify() {
  log "notify: $1"
  [ -n "$SLACK_WEBHOOK_URL" ] || return 0
  curl -fsS -m 10 -X POST -H 'Content-type: application/json' \
    --data "$(jq -n --arg t "$1" '{text:$t}')" "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
}

gh_api() { curl -fsS -m 20 -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$GH_REPO/$1"; }

cd "$REPO" || { log "repo missing: $REPO"; exit 1; }

# 1. Pause switches
if [ -f "$REPO/.engine-paused" ]; then exit 0; fi
paused="$(gh_api 'issues?labels=engine:pause&state=open' | jq 'length' 2>/dev/null || echo 0)"
if [ "${paused:-0}" != "0" ]; then exit 0; fi

# 2. Anything new?
git fetch -q origin main || { log "fetch failed"; exit 0; }
cur="$(git rev-parse HEAD)"
new="$(git rev-parse origin/main)"
[ "$cur" = "$new" ] && exit 0
[ -f "$STATE/bad-$new" ] && exit 0

# 3. CI must be green on the exact commit
ci="$(gh_api "commits/$new/check-runs?per_page=100" | jq -r '
  [.check_runs[] | select(.app.slug == "github-actions")] as $r
  | if ($r | length) == 0 then "none"
    elif any($r[]; .status != "completed") then "pending"
    elif all($r[]; .conclusion == "success" or .conclusion == "skipped" or .conclusion == "neutral") then "green"
    else "red" end' 2>/dev/null || echo unknown)"
if [ "$ci" != "green" ]; then
  [ "$ci" = "red" ] && [ ! -f "$STATE/ci-red-$new" ] && { notify "⚠️ ScoopFeeds auto-deploy: CI is red on ${new:0:7}; not deploying."; touch "$STATE/ci-red-$new"; }
  exit 0
fi

# 4. Destructive migrations wait for DrJ (stop list item 1)
mig_files="$(git diff --name-only "$cur" "$new" -- backend/src/db/migrations/ || true)"
if [ -n "$mig_files" ]; then
  if git diff "$cur" "$new" -- backend/src/db/migrations/ | grep -E '^\+' | grep -qiE '\b(DROP|DELETE[[:space:]]+FROM|UPDATE[[:space:]]+[a-z_]+[[:space:]]+SET|RENAME)\b'; then
    if [ ! -f "$STATE/held-$new" ]; then
      notify "🟠 ScoopFeeds auto-deploy HELD ${new:0:7}: it contains a migration that deletes or rewrites data (stop list 1). Deploy it by hand after checking: docs/ops/runbooks/deploy.md"
      touch "$STATE/held-$new"
    fi
    exit 0
  fi
fi

# 5. Deploy
log "deploying ${cur:0:7} -> ${new:0:7}"
echo "$cur" > "$STATE/previous"
if ! git merge -q --ff-only origin/main; then
  notify "🔴 ScoopFeeds auto-deploy stopped: /opt/scoopfeeds has local commits or edits, so main cannot fast-forward. Nothing changed."
  touch "$STATE/bad-$new"
  exit 1
fi

rollback() {
  local why="$1"
  log "ROLLBACK: $why"
  git reset -q --hard "$cur"
  "${COMPOSE[@]}" build >> "$LOG" 2>&1
  "${COMPOSE[@]}" up -d >> "$LOG" 2>&1
  touch "$STATE/bad-$new"
  notify "🔴 ScoopFeeds auto-deploy ROLLED BACK ${new:0:7} -> ${cur:0:7}: $why. That commit will not be retried; a newer commit on main deploys normally."
  exit 1
}

"${COMPOSE[@]}" config > /dev/null 2>> "$LOG" || rollback "compose config invalid"
"${COMPOSE[@]}" build >> "$LOG" 2>&1 || rollback "build failed"
"${COMPOSE[@]}" up -d >> "$LOG" 2>&1 || rollback "up -d failed"

# 6. Health check, up to 3 minutes
want="$("${COMPOSE[@]}" config --services | wc -l)"
ok=0
for _ in $(seq 1 18); do
  sleep 10
  home="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$SITE/")"
  api="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$SITE/api/health")"
  running="$("${COMPOSE[@]}" ps --services --status running | wc -l)"
  if [ "$home" = "200" ] && [ "$api" = "200" ] && [ "$running" -ge "$want" ]; then ok=1; break; fi
done
[ "$ok" = "1" ] || rollback "health check failed (home=$home api=$api running=$running/$want)"

subject="$(git log -1 --format=%s "$new")"
log "deployed ${new:0:7}: $subject"
notify "🚀 ScoopFeeds deployed ${new:0:7}: $subject"
exit 0
