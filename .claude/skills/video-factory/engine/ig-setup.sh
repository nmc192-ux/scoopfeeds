#!/bin/bash
# Install a per-film Instagram poller.
#
#   bash engine/ig-setup.sh <slug>     # run from the project directory
#
# WHY A POLLER AND NOT A SCHEDULE
# Instagram's Content Publishing API cannot schedule: there is no publish_time
# parameter, and media containers expire after 24 hours, so you cannot even
# pre-build one for a slot days out. "Scheduled IG posting" is always a process
# that wakes up and posts. It also cannot accept uploaded bytes — IG fetches
# media from a public URL — so ig-run.mjs serves the Shorts through a temporary
# tunnel for the minute Meta needs them.
#
# EVERY FILM GETS ITS OWN DIRECTORY, MARKER AND LAUNCHD LABEL. Two films sharing
# a label means whichever posts first unloads the other.
set -euo pipefail

SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "usage: bash engine/ig-setup.sh <slug>   (from the project dir)"; exit 1; }
PROJ="$PWD"
DST="$HOME/.scoopfeeds-igpost-$SLUG"
LABEL="com.scoopfeeds.igpost.$SLUG"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ENGINE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Derived from this script's own location: the engine sits at
# <repo>/.claude/skills/video-factory/engine, so the repo is four levels up.
# Hardcoding one developer's checkout path here meant the skill only ran on one
# machine.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BACKEND="$REPO_ROOT/backend"
NODE="$(command -v node)"

[ -e "$DST" ] && { echo "refusing: $DST already exists"; exit 1; }
[ -f "$PROJ/ig.json" ] || { echo "refusing: no ig.json in $PROJ"; exit 1; }
ls "$PROJ"/out/shorts/*.mp4 >/dev/null 2>&1 || { echo "refusing: no Shorts in $PROJ/out/shorts"; exit 1; }

mkdir -p "$DST/out/shorts"
cp "$ENGINE/ig-run.mjs" "$ENGINE/ig-publish.mjs" "$DST/"
cp "$PROJ/ig.json" "$DST/"
cp "$PROJ"/out/shorts/*.mp4 "$DST/out/shorts/"
ln -sfn "$BACKEND/node_modules" "$DST/node_modules"

# localtunnel, in a SIDECAR dir — installing into node_modules would replace the
# symlink above and break ffmpeg for every other script (see gotchas).
if [ -d "$HOME/.scoopfeeds-igpost/.lt_modules" ]; then
  cp -R "$HOME/.scoopfeeds-igpost/.lt_modules" "$DST/.lt_modules"
else
  (cd "$DST" && npm install --prefix .ltinstall localtunnel --no-audit --no-fund >/dev/null 2>&1 \
    && mv .ltinstall/node_modules "$DST/.lt_modules" && rm -rf .ltinstall)
fi

cat > "$DST/ig-cron.sh" <<CRON
#!/bin/bash
cd "$DST" || exit 1
MARKER="$DST/out/.IG_POSTED"
LOG="$DST/out/ig-cron.log"
[ -f "\$MARKER" ] && exit 0
echo "=== \$(date -u '+%Y-%m-%d %H:%M:%SZ') run ===" >> "\$LOG"
"$NODE" "$DST/ig-run.mjs" --confirm >> "\$LOG" 2>&1
CODE=\$?
if [ \$CODE -eq 0 ]; then
  date -u '+%Y-%m-%dT%H:%M:%SZ' > "\$MARKER"
  echo "POSTED — marker written; disarming" >> "\$LOG"
  launchctl unload "$PLIST" 2>/dev/null
elif [ \$CODE -eq 2 ]; then
  echo "film not public yet — will retry in 30 min" >> "\$LOG"
else
  echo "FAILED code \$CODE — will retry in 30 min" >> "\$LOG"
fi
exit 0
CRON
chmod +x "$DST/ig-cron.sh"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$DST/ig-cron.sh</string></array>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$DST/out/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$DST/out/launchd.err.log</string>
</dict>
</plist>
PL
plutil -lint "$PLIST" >/dev/null

echo "installed $DST"
echo "self-test (should refuse: film not public yet)…"
"$DST/ig-cron.sh" || true
tail -2 "$DST/out/ig-cron.log" 2>/dev/null || true

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "armed: $LABEL   (fires every 30 min, posts once, then disarms)"
echo "disarm with: launchctl unload $PLIST"
