#!/bin/bash
# run-autoair.sh - launchd entry point for one unattended programme hour (programme/autoair.mjs).
# Fired by com.scoopfeeds.radio.autoair at the times install-autoair.sh was given (about 45 min before each hour).
# Reads ~/.scoopfeeds-radio.env (mode 600, never printed). Airs ONLY when that file sets RADIO_AUTOAIR_ENABLED=1;
# otherwise it is a rehearsal (produce + air check, nothing goes out). `touch ~/scoopfeeds-radio/PAUSE` skips hours.
set -u
ENV_FILE="${RADIO_ENV_FILE:-$HOME/.scoopfeeds-radio.env}"
REPO="${RADIO_REPO:-$HOME/work/scoopfeeds}"
BASE_DIR="${RADIO_BASE_DIR:-$HOME/scoopfeeds-radio}"
mkdir -p "$BASE_DIR/logs"

if [ -f "$ENV_FILE" ]; then
  mode="$(stat -f%Lp "$ENV_FILE" 2>/dev/null || stat -c%a "$ENV_FILE")"
  if [ "$mode" != "600" ]; then echo "refusing to read $ENV_FILE: mode is $mode, expected 600" >&2; exit 78; fi
  set -a; . "$ENV_FILE"; set +a
fi
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"
export VIDEO_TTS_PROVIDER="${VIDEO_TTS_PROVIDER:-kokoro}" VIDEO_TTS_KOKORO_URL="${VIDEO_TTS_KOKORO_URL:-http://127.0.0.1:8880}"

# the voice must be up before the producer runs
if ! curl -s -m 3 -o /dev/null "$VIDEO_TTS_KOKORO_URL/"; then
  KSTART="${RADIO_KOKORO_START:-$HOME/sixty/kokoro-start.sh}"
  if [ -x "$KSTART" ]; then
    echo "$(date -u +%FT%TZ) starting Kokoro"; nohup "$KSTART" >> "$BASE_DIR/logs/kokoro.log" 2>&1 &
    for i in $(seq 1 40); do sleep 3; curl -s -m 3 -o /dev/null "$VIDEO_TTS_KOKORO_URL/" && break; done
  fi
fi

cd "$REPO/backend" || exit 78
# keep the Mac awake for the whole run (produce + the hour)
if [ -x /usr/bin/caffeinate ]; then /usr/bin/caffeinate -i -s -w $$ & fi
exec node src/radio/programme/autoair.mjs --hour next
