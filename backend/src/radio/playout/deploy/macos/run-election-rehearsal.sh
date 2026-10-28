#!/bin/bash
# run-election-rehearsal.sh - the election night dress rehearsal (#198), Sun 1 Nov: 6 hours, unattended, disk only.
#
#   nohup backend/src/radio/playout/deploy/macos/run-election-rehearsal.sh > /dev/null 2>&1 &
#
# Runs programme/rolling.mjs --election-rehearsal: the election night special from the next hour on, with fixture
# projections (programme/fixtures/electionNight.fixture.json), 15-minute updates, poll closings moved to the
# rehearsal's clock. NOTHING is streamed and no YouTube broadcast is touched, whatever ~/.scoopfeeds-radio.env says.
# It stands nothing down: the live 24/7 loop keeps the air. By default no second playout (Chrome + encoder) runs
# beside the live stream (--no-playout); dead air is measured from the mixed audio instead. Pass --hours N,
# --fake-writer (no Claude calls) or drop --no-playout by passing --playout to record the screen as well.
# Everything lands in ~/scoopfeeds-radio/election-rehearsal/; the report is report.md there, also sent to DrJ through
# RADIO_ALERT_CMD (the Mac notification) and RADIO_ALERT_EMAIL. `touch ~/scoopfeeds-radio/PAUSE` stops it too.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${RADIO_ENV_FILE:-$HOME/.scoopfeeds-radio.env}"
REPO="${RADIO_REPO:-$HOME/work/scoopfeeds}"
BASE_DIR="${RADIO_BASE_DIR:-$HOME/scoopfeeds-radio}"
mkdir -p "$BASE_DIR/election-rehearsal/logs"

if [ -f "$ENV_FILE" ]; then
  mode="$(stat -f%Lp "$ENV_FILE" 2>/dev/null || stat -c%a "$ENV_FILE")"
  if [ "$mode" != "600" ]; then echo "refusing to read $ENV_FILE: mode is $mode, expected 600" >&2; exit 78; fi
  set -a; . "$ENV_FILE"; set +a
fi
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"
export VIDEO_TTS_PROVIDER="${VIDEO_TTS_PROVIDER:-kokoro}" VIDEO_TTS_KOKORO_URL="${VIDEO_TTS_KOKORO_URL:-http://127.0.0.1:8880}"
export RADIO_ALERT_CMD="${RADIO_ALERT_CMD:-$HERE/notify-macos.sh}"

PLAYOUT=(--no-playout)
ARGS=()
for a in "$@"; do if [ "$a" = "--playout" ]; then PLAYOUT=(); else ARGS+=("$a"); fi; done

cd "$REPO/backend" || exit 78
if [ -x /usr/bin/caffeinate ]; then /usr/bin/caffeinate -i -s -w $$ & fi
exec node src/radio/programme/rolling.mjs --election-rehearsal "${PLAYOUT[@]}" ${ARGS[@]+"${ARGS[@]}"} >> "$BASE_DIR/election-rehearsal/logs/rehearsal.out.log" 2>&1
