#!/bin/bash
# run-standing.sh - launchd entry point for one pass of the channel-standing watchdog (#208, safety/standingWatch.mjs).
# Fired every 10 minutes by com.scoopfeeds.radio.standing (install-standing.sh). Reads ~/.scoopfeeds-radio.env
# (mode 600, never printed) for RADIO_YT_* and the alert settings. On an incident it writes ~/scoopfeeds-radio/PAUSE,
# ends the live broadcast, stops the 24/7 playout and alerts DrJ. It never removes PAUSE.
set -u
ENV_FILE="${RADIO_ENV_FILE:-$HOME/.scoopfeeds-radio.env}"
REPO="${RADIO_REPO:-$HOME/work/scoopfeeds}"
BASE_DIR="${RADIO_BASE_DIR:-$HOME/scoopfeeds-radio}"
mkdir -p "$BASE_DIR/logs" "$BASE_DIR/notices"
if [ -f "$ENV_FILE" ]; then
  mode="$(stat -f%Lp "$ENV_FILE" 2>/dev/null || stat -c%a "$ENV_FILE")"
  if [ "$mode" != "600" ]; then echo "refusing to read $ENV_FILE: mode is $mode, expected 600" >&2; exit 78; fi
  set -a; . "$ENV_FILE"; set +a
fi
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/bin:/usr/bin:/bin"
cd "$REPO/backend" || exit 78
exec node src/radio/safety/standingWatch.mjs
