#!/bin/bash
# install-longread.sh - install the Long Read timer (#304; user level, no sudo).
#   install-longread.sh 05:40       one draft a day at 5:40 am (Mac local time)
#   install-longread.sh uninstall
# Installing the timer puts nothing on air: pieces are drafts until `cli.mjs approve`, and air only with
# RADIO_LONGREAD_ENABLED=1 in ~/.scoopfeeds-radio.env.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL=com.scoopfeeds.radio.longread
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UIDN="$(id -u)"
launchctl bootout "gui/$UIDN/$LABEL" 2>/dev/null || true
[ "${1:-}" = "uninstall" ] && { rm -f "$PLIST"; echo "uninstalled $LABEL"; exit 0; }
[ $# -eq 1 ] || { echo "usage: $0 HH:MM | uninstall" >&2; exit 64; }
h="${1%%:*}"; m="${1##*:}"
[[ "$h" =~ ^[0-9]{1,2}$ && "$m" =~ ^[0-9]{2}$ ]] || { echo "bad time: $1" >&2; exit 64; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/scoopfeeds-radio/logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HERE/run-longread.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>$((10#$h))</integer><key>Minute</key><integer>$((10#$m))</integer></dict>
  <key>StandardOutPath</key><string>$HOME/scoopfeeds-radio/logs/longread.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/scoopfeeds-radio/logs/longread.err.log</string>
</dict></plist>
PL
plutil -lint "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UIDN" "$PLIST"
echo "installed $LABEL at $1 (drafts only; RADIO_LONGREAD_ENABLED=1 is what airs an approved piece)"
