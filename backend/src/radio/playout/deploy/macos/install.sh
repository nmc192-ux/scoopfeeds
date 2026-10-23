#!/bin/bash
# install.sh - install/refresh the launchd agent (user level, no sudo). Usage: install.sh [uninstall]
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.scoopfeeds.radio.plist"
UIDN="$(id -u)"
launchctl bootout "gui/$UIDN/com.scoopfeeds.radio" 2>/dev/null || true
[ "${1:-}" = "uninstall" ] && { rm -f "$PLIST"; echo uninstalled; exit 0; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/scoopfeeds-radio/logs"
sed -e "s|__LAUNCHER__|$HERE/run-playout.sh|" -e "s|__HOME__|$HOME|g" "$HERE/com.scoopfeeds.radio.plist.template" > "$PLIST"
if [ ! -f "$HOME/.scoopfeeds-radio.env" ]; then
  ( umask 077; printf 'RADIO_PLAYOUT_ENABLED=false\n' > "$HOME/.scoopfeeds-radio.env" )
fi
chmod 600 "$HOME/.scoopfeeds-radio.env"
launchctl bootstrap "gui/$UIDN" "$PLIST"
echo "installed $PLIST"
bash "$HERE/check-resilience.sh" || true
