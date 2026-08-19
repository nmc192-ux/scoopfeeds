#!/bin/bash
# Install a per-film TikTok poller.
#
#   bash engine/tiktok-setup.sh <slug>     # run from the project directory
#
# WHY A POLLER AND NOT A SCHEDULE
# TikTok's Content Posting API has no publish_at or schedule_time on any
# endpoint — a post happens when the call is made. Same shape as Instagram, and
# for the same reason: "scheduled posting" is a process that wakes up and posts.
#
# It fires every 30 minutes, refuses while the YouTube film is still private,
# refuses while the API client is un-audited (TikTok forces SELF_ONLY until the
# audit passes), posts once, writes a marker, and disarms itself.
#
# EVERY FILM GETS ITS OWN DIRECTORY, MARKER AND LAUNCHD LABEL — two films
# sharing a label means whichever posts first unloads the other.
set -euo pipefail

SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "usage: bash engine/tiktok-setup.sh <slug>   (from the project dir)"; exit 1; }
PROJ="$PWD"
DST="$HOME/.scoopfeeds-ttpost-$SLUG"
LABEL="com.scoopfeeds.ttpost.$SLUG"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ENGINE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BACKEND="$REPO_ROOT/backend"
NODE="$(command -v node)"

[ -e "$DST" ] && { echo "refusing: $DST already exists"; exit 1; }
[ -f "$PROJ/tiktok.json" ] || { echo "refusing: no tiktok.json in $PROJ"; exit 1; }
ls "$PROJ"/out/shorts/*.mp4 >/dev/null 2>&1 || { echo "refusing: no Shorts in $PROJ/out/shorts"; exit 1; }

mkdir -p "$DST/out/shorts"
cp "$ENGINE/tiktok-publish.mjs" "$DST/"
# SYMLINKED, not copied: _deps.mjs derives REPO_ROOT four levels up from its own
# location, so a copy in $HOME resolves BACKEND to nonsense. Node resolves
# symlinks before computing import.meta.url, so the link keeps the real path.
# (ig-setup.sh omitted this entirely and every poller it installed was dead.)
ln -sfn "$ENGINE/_deps.mjs" "$DST/_deps.mjs"
cp "$PROJ/tiktok.json" "$DST/"
cp "$PROJ"/out/shorts/*.mp4 "$DST/out/shorts/"
ln -sfn "$BACKEND/node_modules" "$DST/node_modules"

cat > "$DST/tt-cron.sh" <<CRON
#!/bin/bash
cd "$DST" || exit 1
MARKER="$DST/out/.TT_POSTED"
LOG="$DST/out/tt-cron.log"
[ -f "\$MARKER" ] && exit 0
echo "=== \$(date -u '+%Y-%m-%d %H:%M:%SZ') run ===" >> "\$LOG"
"$NODE" "$DST/tiktok-publish.mjs" --confirm --require-live >> "\$LOG" 2>&1
CODE=\$?
if [ \$CODE -eq 0 ]; then
  date -u '+%Y-%m-%dT%H:%M:%SZ' > "\$MARKER"
  echo "POSTED — marker written; disarming" >> "\$LOG"
  launchctl unload "$PLIST" 2>/dev/null
elif [ \$CODE -eq 2 ]; then
  echo "film not public yet — will retry in 30 min" >> "\$LOG"
elif [ \$CODE -eq 3 ]; then
  echo "client not audited — TikTok forces SELF_ONLY; will retry in 30 min" >> "\$LOG"
else
  echo "FAILED code \$CODE — will retry in 30 min" >> "\$LOG"
fi
exit 0
CRON
chmod +x "$DST/tt-cron.sh"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$DST/tt-cron.sh</string></array>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$DST/out/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$DST/out/launchd.err.log</string>
</dict>
</plist>
PL
plutil -lint "$PLIST" >/dev/null

echo "installed $DST"
echo "self-test (must refuse — film not public, or client not audited)…"
"$DST/tt-cron.sh" || true
tail -3 "$DST/out/tt-cron.log" 2>/dev/null || true
# A poller that cannot run is worse than no poller: it looks armed, fires every
# 30 minutes and posts nothing. Only a refusal we understand means it is sound.
if ! grep -qE "film not public yet|client not audited" "$DST/out/tt-cron.log" 2>/dev/null; then
  echo ""
  echo "SELF-TEST DID NOT REACH A KNOWN GATE — not arming. See $DST/out/tt-cron.log"
  echo "Fix the cause, remove $DST, and run this again."
  exit 1
fi

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "armed: $LABEL   (fires every 30 min, posts once, then disarms)"
echo "disarm with: launchctl unload $PLIST"
