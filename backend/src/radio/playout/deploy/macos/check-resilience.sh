#!/bin/bash
# check-resilience.sh - READ-ONLY check of the Mac mini settings that keep the radio on air through sleep, reboots
# and power cuts (#196, build step 4). Changes nothing; prints what is set and, for anything missing, DrJ's step.
#   bash check-resilience.sh          (install.sh runs it at the end)
set -u
ok() { echo "  ok    $*"; }
todo() { echo "  TODO  $*"; }
ME="$(id -un)"
echo "Radio host resilience ($(hostname -s 2>/dev/null || hostname)):"
if ! command -v pmset >/dev/null; then echo "  (not macOS: pmset not found; on Linux use a systemd unit with Restart=always and BIOS 'power on after AC loss')"; exit 0; fi
PM="$(pmset -g 2>/dev/null)"
ar="$(printf '%s\n' "$PM" | awk '$1=="autorestart" {print $2}')"
[ "$ar" = "1" ] && ok "restarts automatically after a power failure" \
  || todo "restart after a power failure is OFF. DrJ: System Settings > Energy > 'Start up automatically after a power failure' (or: sudo pmset -a autorestart 1)"
sl="$(printf '%s\n' "$PM" | awk '$1=="sleep" {print $2}')"
[ "$sl" = "0" ] && ok "system sleep is off" \
  || ok "system sleep is ${sl:-?} min; caffeinate holds it off while the radio runs (sudo pmset -a sleep 0 makes it permanent)"
al="$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)"
[ "$al" = "$ME" ] && ok "logs in automatically as $ME, so the radio's login agent starts after a reboot" \
  || todo "automatic login is OFF. The radio is a login agent (com.scoopfeeds.radio): after a reboot it starts only once $ME logs in. DrJ: System Settings > Users & Groups > 'Automatically log in as' $ME (FileVault must be off for this)"
launchctl print "gui/$(id -u)/com.scoopfeeds.radio" >/dev/null 2>&1 && ok "launch agent com.scoopfeeds.radio is loaded (RunAtLoad + KeepAlive)" \
  || todo "launch agent com.scoopfeeds.radio is not loaded: bash install.sh"
command -v networkQuality >/dev/null && ok "networkQuality present: the playout measures upload at start and drops to 720p below 6 Mbps per output" \
  || todo "networkQuality missing (macOS 12+): the 720p fallback cannot measure and stays at 1080p"
exit 0
