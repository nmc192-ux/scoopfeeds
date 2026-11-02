#!/bin/bash
# install-longread.sh - install the Long Read timer (#304; user level, no sudo).
#   install-longread.sh 05:40              one draft a day at 5:40 am (Mac local time)
#   install-longread.sh 05:40 17:40        several times a day
#   install-longread.sh every3h 40         every 3 hours at :40 (00:40, 03:40 ... 21:40): ~8 drafts a day (DrJ, 2 Nov)
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
TIMES=()
if [ "${1:-}" = "every3h" ]; then
  mm="${2:-40}"; [[ "$mm" =~ ^[0-5][0-9]$ ]] || { echo "bad minute: $mm" >&2; exit 64; }
  for hh in 00 03 06 09 12 15 18 21; do TIMES+=("$hh:$mm"); done
else
  TIMES=("$@")
fi
[ ${#TIMES[@]} -ge 1 ] || { echo "usage: $0 HH:MM [HH:MM ...] | every3h [MM] | uninstall" >&2; exit 64; }
INTERVALS=""
for t in "${TIMES[@]}"; do
  h="${t%%:*}"; m="${t##*:}"
  [[ "$h" =~ ^[0-9]{1,2}$ && "$m" =~ ^[0-9]{2}$ && $((10#$h)) -le 23 && $((10#$m)) -le 59 ]] || { echo "bad time: $t" >&2; exit 64; }
  INTERVALS+="<dict><key>Hour</key><integer>$((10#$h))</integer><key>Minute</key><integer>$((10#$m))</integer></dict>"
done
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/scoopfeeds-radio/logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HERE/run-longread.sh</string></array>
  <key>StartCalendarInterval</key><array>$INTERVALS</array>
  <key>StandardOutPath</key><string>$HOME/scoopfeeds-radio/logs/longread.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/scoopfeeds-radio/logs/longread.err.log</string>
</dict></plist>
PL
plutil -lint "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UIDN" "$PLIST"
echo "installed $LABEL at ${TIMES[*]} (drafts only; RADIO_LONGREAD_ENABLED=1 is what airs an approved piece)"
