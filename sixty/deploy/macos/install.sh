#!/bin/bash
# install.sh — the 60 · schedule: 06:00 and 14:00 PKT (this Mac's local time), one film each, cap 2 a day.
#   install.sh            write the two LaunchAgent plists, do NOT load them (nothing runs)
#   install.sh enable     load them: the first batch fires at the next 06:00 / 14:00
#   install.sh disable    unload them (the plists stay)
#   install.sh status
#   install.sh uninstall  unload and delete
# The batch itself refuses to start in a pause window (sixty/gates/pause.mjs), when late, on STOP, or at the cap.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
UIDN="$(id -u)"
LA="$HOME/Library/LaunchAgents"
declare -a W=("am:6" "pm:14")
write() {
  mkdir -p "$LA" "$HOME/sixty/logs"
  for w in "${W[@]}"; do
    name="${w%%:*}"; hour="${w##*:}"
    sed -e "s|__WINDOW__|$name|g" -e "s|__HOUR__|$hour|g" -e "s|__LAUNCHER__|$HERE/run-batch.sh|g" -e "s|__HOME__|$HOME|g" \
      "$HERE/com.scoopfeeds.sixty.plist.template" > "$LA/com.scoopfeeds.sixty.$name.plist"
    plutil -lint "$LA/com.scoopfeeds.sixty.$name.plist" >/dev/null
  done
}
case "${1:-write}" in
  write)    write; echo "plists written to $LA — NOT loaded. Run: $0 enable" ;;
  enable)   write; for w in "${W[@]}"; do n="${w%%:*}"; launchctl bootout "gui/$UIDN/com.scoopfeeds.sixty.$n" 2>/dev/null || true; launchctl bootstrap "gui/$UIDN" "$LA/com.scoopfeeds.sixty.$n.plist"; done; echo "enabled: am 06:00, pm 14:00 (local time)" ;;
  disable)  for w in "${W[@]}"; do launchctl bootout "gui/$UIDN/com.scoopfeeds.sixty.${w%%:*}" 2>/dev/null || true; done; echo "disabled" ;;
  status)   for w in "${W[@]}"; do n="${w%%:*}"; if launchctl print "gui/$UIDN/com.scoopfeeds.sixty.$n" >/dev/null 2>&1; then echo "$n: loaded"; else echo "$n: not loaded"; fi; done ;;
  uninstall) for w in "${W[@]}"; do n="${w%%:*}"; launchctl bootout "gui/$UIDN/com.scoopfeeds.sixty.$n" 2>/dev/null || true; rm -f "$LA/com.scoopfeeds.sixty.$n.plist"; done; echo "uninstalled" ;;
  *) echo "usage: $0 [write|enable|disable|status|uninstall]"; exit 1 ;;
esac
