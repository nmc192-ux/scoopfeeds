#!/bin/bash
# run-playout.sh - launchd entry point for the radio playout on a macOS host.
# Reads ~/.scoopfeeds-radio.env (must be mode 600; never printed), keeps the Mac awake while it runs,
# and starts the playout. Default output is a ROLLING FILE RING (no network). RTMP only when the env file sets
# RADIO_PLAYOUT_MODE=rtmp, and the playout itself still needs BOTH RADIO_PLAYOUT_ENABLED=true and RADIO_STREAM_KEY.
# Linux equivalent: a systemd unit with Restart=always running this same script (drop the caffeinate line).
set -u
HOME_DIR="${HOME}"
ENV_FILE="${RADIO_ENV_FILE:-$HOME_DIR/.scoopfeeds-radio.env}"
REPO="${RADIO_REPO:-$HOME_DIR/work/scoopfeeds}"
BASE_DIR="${RADIO_BASE_DIR:-$HOME_DIR/scoopfeeds-radio}"
LOG_DIR="$BASE_DIR/logs"
mkdir -p "$LOG_DIR" "$BASE_DIR/segments"

# keep launchd's stdout/stderr logs bounded: truncate anything over 20 MB at (re)start
for f in "$LOG_DIR"/playout.out.log "$LOG_DIR"/playout.err.log; do
  [ -f "$f" ] && [ "$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")" -gt 20971520 ] && : > "$f"
done

if [ -f "$ENV_FILE" ]; then
  mode="$(stat -f%Lp "$ENV_FILE" 2>/dev/null || stat -c%a "$ENV_FILE")"
  if [ "$mode" != "600" ]; then echo "refusing to read $ENV_FILE: mode is $mode, expected 600" >&2; exit 78; fi
  set -a; . "$ENV_FILE"; set +a
fi

export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/bin:/usr/bin:/bin"
cd "$REPO/backend" || exit 78

ARGS=(src/radio/playout/cli.js --base-url "${RADIO_BASE_URL:-https://scoopfeeds.com}" --music-dir "${RADIO_MUSIC_DIR:-$BASE_DIR/music}")
if [ "${RADIO_PLAYOUT_MODE:-segments}" = "rtmp" ]; then :; else
  ARGS+=(--segments-dir "${RADIO_SEGMENTS_DIR:-$BASE_DIR/segments}")
fi
# per-destination live status (#207); only written when more than one destination is on (e.g. RADIO_X_ENABLED=true)
ARGS+=(--status-file "$BASE_DIR/outputs.json")
[ -n "${RADIO_FORCE_DAYPART_CYCLE:-}" ] && ARGS+=(--force-daypart-cycle "$RADIO_FORCE_DAYPART_CYCLE")

# #208: while ~/scoopfeeds-radio/PAUSE exists (the standing watchdog, or DrJ), do not go on air. Hold here rather than
# exit, so launchd's KeepAlive does not spin; removing PAUSE by hand resumes within 30 s.
if [ -f "$BASE_DIR/PAUSE" ]; then
  echo "$(date -u +%FT%TZ) $BASE_DIR/PAUSE exists: holding off air ($(head -c 300 "$BASE_DIR/PAUSE" | tr '\n' ' '))" >&2
  while [ -f "$BASE_DIR/PAUSE" ]; do sleep 30; done
  echo "$(date -u +%FT%TZ) PAUSE removed: going on" >&2
fi

# macOS: no idle or AC-power system sleep while this process (the exec'd node) lives
if [ -x /usr/bin/caffeinate ]; then /usr/bin/caffeinate -i -s -w $$ & fi
exec node "${ARGS[@]}"
