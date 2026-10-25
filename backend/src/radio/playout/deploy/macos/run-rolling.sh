#!/bin/bash
# run-rolling.sh - launchd entry point for ScoopFeeds Radio 24/7 (programme/rolling.mjs, #195).
# Kept alive by com.scoopfeeds.radio.rolling (install-rolling.sh). This wrapper is the ONLY Mac-specific piece of the
# 24/7 loop: env file, PATH, Kokoro, caffeinate, the Mac notification hook, and standing down the agents whose job
# the loop now does (the 24/7 music radio and the one-hour auto-air timer). On a cloud host, a systemd unit with
# Restart=always would run `node src/radio/programme/rolling.mjs` with the same env instead.
# Streams ONLY when ~/.scoopfeeds-radio.env sets BOTH RADIO_AUTOAIR_ENABLED=1 and RADIO_ROLLING_ENABLED=1;
# otherwise every hour is a rehearsal written to ~/scoopfeeds-radio/rehearsal-seg/. `touch ~/scoopfeeds-radio/PAUSE`
# takes the stream OFF AIR within 30 s (#208): the loop ends its playout and broadcast and exits, and on restart
# rolling.mjs holds off air until PAUSE is removed by hand.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${RADIO_ENV_FILE:-$HOME/.scoopfeeds-radio.env}"
REPO="${RADIO_REPO:-$HOME/work/scoopfeeds}"
BASE_DIR="${RADIO_BASE_DIR:-$HOME/scoopfeeds-radio}"
mkdir -p "$BASE_DIR/logs"
for f in "$BASE_DIR"/logs/rolling.out.log "$BASE_DIR"/logs/rolling.err.log "$BASE_DIR"/logs/playout-247.log; do
  [ -f "$f" ] && [ "$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")" -gt 20971520 ] && : > "$f"
done

if [ -f "$ENV_FILE" ]; then
  mode="$(stat -f%Lp "$ENV_FILE" 2>/dev/null || stat -c%a "$ENV_FILE")"
  if [ "$mode" != "600" ]; then echo "refusing to read $ENV_FILE: mode is $mode, expected 600" >&2; exit 78; fi
  set -a; . "$ENV_FILE"; set +a
fi
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"
export VIDEO_TTS_PROVIDER="${VIDEO_TTS_PROVIDER:-kokoro}" VIDEO_TTS_KOKORO_URL="${VIDEO_TTS_KOKORO_URL:-http://127.0.0.1:8880}"
export RADIO_ALERT_CMD="${RADIO_ALERT_CMD:-$HERE/notify-macos.sh}"

# the loop owns the air: the 24/7 music radio agent and the one-hour timer must not run beside it
UIDN="$(id -u)"
for label in com.scoopfeeds.radio com.scoopfeeds.radio.autoair; do
  launchctl bootout "gui/$UIDN/$label" 2>/dev/null && echo "$(date -u +%FT%TZ) stood down $label (the 24/7 loop owns the air)"
done

if ! curl -s -m 3 -o /dev/null "$VIDEO_TTS_KOKORO_URL/"; then
  KSTART="${RADIO_KOKORO_START:-$HOME/sixty/kokoro-start.sh}"
  if [ -x "$KSTART" ]; then
    echo "$(date -u +%FT%TZ) starting Kokoro"; nohup "$KSTART" >> "$BASE_DIR/logs/kokoro.log" 2>&1 &
    for i in $(seq 1 40); do sleep 3; curl -s -m 3 -o /dev/null "$VIDEO_TTS_KOKORO_URL/" && break; done
  fi
fi

cd "$REPO/backend" || exit 78
if [ -x /usr/bin/caffeinate ]; then /usr/bin/caffeinate -i -s -w $$ & fi
exec node src/radio/programme/rolling.mjs "$@"
