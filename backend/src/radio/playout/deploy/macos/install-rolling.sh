#!/bin/bash
# install-rolling.sh - install ScoopFeeds Radio 24/7 (programme/rolling.mjs) as a kept-alive launchd agent (no sudo).
#   install-rolling.sh             install and start (stands down com.scoopfeeds.radio and the auto-air timer)
#   install-rolling.sh uninstall   stop it; the 24/7 music radio agent is brought back if its plist exists
# Installing does NOT put anything on air: that needs RADIO_AUTOAIR_ENABLED=1 AND RADIO_ROLLING_ENABLED=1 in
# ~/.scoopfeeds-radio.env. Until then every hour is a rehearsal written to ~/scoopfeeds-radio/rehearsal-seg/.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL=com.scoopfeeds.radio.rolling
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UIDN="$(id -u)"
launchctl bootout "gui/$UIDN/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "uninstall" ]; then
  rm -f "$PLIST"; echo "uninstalled $LABEL"
  R="$HOME/Library/LaunchAgents/com.scoopfeeds.radio.plist"
  [ -f "$R" ] && launchctl bootstrap "gui/$UIDN" "$R" 2>/dev/null && echo "the 24/7 music radio (com.scoopfeeds.radio) is back"
  exit 0
fi
chmod +x "$HERE/run-rolling.sh" "$HERE/notify-macos.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/scoopfeeds-radio/logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HERE/run-rolling.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$HOME/scoopfeeds-radio/logs/rolling.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/scoopfeeds-radio/logs/rolling.err.log</string>
</dict></plist>
PL
plutil -lint "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UIDN" "$PLIST"
echo "installed $LABEL (kept alive; log: ~/scoopfeeds-radio/logs/rolling.log)"
if grep -q '^RADIO_AUTOAIR_ENABLED=1' "$HOME/.scoopfeeds-radio.env" 2>/dev/null && grep -q '^RADIO_ROLLING_ENABLED=1' "$HOME/.scoopfeeds-radio.env" 2>/dev/null; then
  echo "RADIO_AUTOAIR_ENABLED=1 and RADIO_ROLLING_ENABLED=1: hours WILL go on air"
else
  echo "rehearsal: hours are produced and played to ~/scoopfeeds-radio/rehearsal-seg/, nothing goes out"
fi
