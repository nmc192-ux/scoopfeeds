#!/bin/bash
# phase-c-check.sh - pre-flight for the RTMP test. Validates ~/.scoopfeeds-radio.env WITHOUT printing the stream key
# (it reports only whether each variable is set, the key's length and whether its characters look like a YouTube key).
# Usage: phase-c-check.sh            check the file
#        phase-c-check.sh --logs     also count occurrences of the key in the playout logs (prints a number only)
ENV_FILE="${RADIO_ENV_FILE:-$HOME/.scoopfeeds-radio.env}"
ok=1
say() { printf '%-34s %s\n' "$1" "$2"; }
[ -f "$ENV_FILE" ] || { say "env file" "MISSING ($ENV_FILE)"; exit 1; }
mode="$(stat -f%Lp "$ENV_FILE" 2>/dev/null || stat -c%a "$ENV_FILE")"
[ "$mode" = "600" ] && say "file mode" "600 ok" || { say "file mode" "$mode (must be 600: chmod 600 ~/.scoopfeeds-radio.env)"; ok=0; }
get() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2-; }
enabled="$(get RADIO_PLAYOUT_ENABLED)"; mode_v="$(get RADIO_PLAYOUT_MODE)"; key="$(get RADIO_STREAM_KEY)"
[ "$enabled" = "true" ] && say "RADIO_PLAYOUT_ENABLED" "true ok" || { say "RADIO_PLAYOUT_ENABLED" "'$enabled' (must be exactly true to stream)"; ok=0; }
[ "$mode_v" = "rtmp" ] && say "RADIO_PLAYOUT_MODE" "rtmp ok" || { say "RADIO_PLAYOUT_MODE" "'$mode_v' (must be rtmp, otherwise the launcher keeps writing files)"; ok=0; }
if [ -z "$key" ]; then say "RADIO_STREAM_KEY" "NOT SET"; ok=0
else
  say "RADIO_STREAM_KEY" "set, ${#key} characters (value not shown)"
  [[ "$key" =~ ^[A-Za-z0-9_-]+$ ]] || { say "  key characters" "contains characters other than letters, digits, - and _ (quotes or spaces pasted in?)"; ok=0; }
  [[ "$key" =~ ^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3,4}$ ]] && say "  key shape" "looks like a YouTube key (xxxx-xxxx-xxxx-xxxx[-xxxx])" || say "  key shape" "does not look like a YouTube key (warning only)"
fi
extra="$(grep -vE '^(RADIO_PLAYOUT_ENABLED|RADIO_PLAYOUT_MODE|RADIO_STREAM_KEY)=|^[[:space:]]*(#|$)' "$ENV_FILE" | cut -d= -f1 | tr '\n' ' ')"
[ -n "$extra" ] && say "other variables" "$extra"
if [ "${1:-}" = "--logs" ] && [ -n "$key" ]; then
  n=0; for f in "$HOME"/scoopfeeds-radio/logs/*.log; do [ -f "$f" ] && n=$((n + $(grep -cF -- "$key" "$f"))); done
  say "key occurrences in logs" "$n (must be 0)"; [ "$n" = 0 ] || ok=0
fi
[ "$ok" = 1 ] && { echo "READY"; exit 0; } || { echo "NOT READY"; exit 1; }
