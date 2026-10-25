#!/bin/bash
# install-standing.sh - install the channel-standing watchdog (#208): one pass every 10 minutes (user level, no sudo).
#   install-standing.sh            install / reinstall
#   install-standing.sh uninstall
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL=com.scoopfeeds.radio.standing
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UIDN="$(id -u)"
launchctl bootout "gui/$UIDN/$LABEL" 2>/dev/null || true
[ "${1:-}" = "uninstall" ] && { rm -f "$PLIST"; echo "uninstalled $LABEL"; exit 0; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/scoopfeeds-radio/logs" "$HOME/scoopfeeds-radio/notices"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HERE/run-standing.sh</string></array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/scoopfeeds-radio/logs/standing.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/scoopfeeds-radio/logs/standing.err.log</string>
</dict></plist>
PL
plutil -lint "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UIDN" "$PLIST"
echo "installed $LABEL: every 10 minutes. Last result: node backend/src/radio/safety/standingWatch.mjs --line"
