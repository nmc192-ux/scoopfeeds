#!/bin/bash
# run-longread.sh - launchd entry point for one Long Read draft a day (#304, longread/cli.mjs make).
# Fired by com.scoopfeeds.radio.longread at the time install-longread.sh was given. Puts NOTHING on air: the piece is
# saved as a draft (review on) and airs only once approved, in a produced hour with RADIO_LONGREAD_ENABLED=1.
# Reads ~/.scoopfeeds-radio.env (mode 600, never printed). `touch ~/scoopfeeds-radio/PAUSE` skips the run.
set -u
ENV_FILE="${RADIO_ENV_FILE:-$HOME/.scoopfeeds-radio.env}"
REPO="${RADIO_REPO:-$HOME/work/scoopfeeds}"
BASE_DIR="${RADIO_BASE_DIR:-$HOME/scoopfeeds-radio}"
mkdir -p "$BASE_DIR/logs"
[ -e "$BASE_DIR/PAUSE" ] && { echo "$(date -u +%FT%TZ) PAUSE present: no long read today"; exit 0; }
if [ -f "$ENV_FILE" ]; then
  mode="$(stat -f%Lp "$ENV_FILE" 2>/dev/null || stat -c%a "$ENV_FILE")"
  if [ "$mode" != "600" ]; then echo "refusing to read $ENV_FILE: mode is $mode, expected 600" >&2; exit 78; fi
  set -a; . "$ENV_FILE"; set +a
fi
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"
cd "$REPO/backend" || exit 78
exec node src/radio/longread/cli.mjs make
