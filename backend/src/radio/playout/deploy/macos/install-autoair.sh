#!/bin/bash
# install-autoair.sh - install the auto-air timer (user level, no sudo).
#   install-autoair.sh 20:14            one run a day at 8:14 pm (Mac local time) -> the 9 pm hour
#   install-autoair.sh 08:14 20:14      two runs a day
#   install-autoair.sh uninstall
# Installing the timer does NOT put anything on air: that needs RADIO_AUTOAIR_ENABLED=1 in ~/.scoopfeeds-radio.env.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL=com.scoopfeeds.radio.autoair
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UIDN="$(id -u)"
launchctl bootout "gui/$UIDN/$LABEL" 2>/dev/null || true
[ "${1:-}" = "uninstall" ] && { rm -f "$PLIST"; echo "uninstalled $LABEL"; exit 0; }
[ $# -ge 1 ] || { echo "usage: $0 HH:MM [HH:MM ...] | uninstall" >&2; exit 64; }
TIMES=""
for t in "$@"; do
  h="${t%%:*}"; m="${t##*:}"
  [[ "$h" =~ ^[0-9]{1,2}$ && "$m" =~ ^[0-9]{2}$ ]] || { echo "bad time: $t" >&2; exit 64; }
  TIMES="$TIMES<dict><key>Hour</key><integer>$((10#$h))</integer><key>Minute</key><integer>$((10#$m))</integer></dict>"
done
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/scoopfeeds-radio/logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HERE/run-autoair.sh</string></array>
  <key>StartCalendarInterval</key><array>$TIMES</array>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$HOME/scoopfeeds-radio/logs/autoair.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/scoopfeeds-radio/logs/autoair.err.log</string>
</dict></plist>
PL
plutil -lint "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UIDN" "$PLIST"
echo "installed $LABEL at: $*"
grep -q '^RADIO_AUTOAIR_ENABLED=1' "$HOME/.scoopfeeds-radio.env" 2>/dev/null && echo "RADIO_AUTOAIR_ENABLED=1: these runs WILL go on air" || echo "RADIO_AUTOAIR_ENABLED is not 1: these runs are rehearsals (nothing goes out)"
