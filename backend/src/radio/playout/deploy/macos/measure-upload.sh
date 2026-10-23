#!/bin/bash
# measure-upload.sh - sample the Mac mini's real upload speed for the live-radio bandwidth call (#207).
#   bash measure-upload.sh                 # one sample
#   bash measure-upload.sh 8 180           # 8 samples, 3 hours apart (about a day); leave it running
# Each sample appends one JSON line to ~/scoopfeeds-radio/upload-samples.jsonl. Then:
#   node backend/src/radio/live/bandwidth.js            # prints the direct / relay / unverified call with numbers
# Uses macOS's built-in `networkQuality` (Monterey or later). Run it while the radio is NOT streaming, or the
# stream's own traffic lowers the number (that is a fair worst case, but say which it was).
set -u
N="${1:-1}"; GAP_MIN="${2:-180}"
OUT="${RADIO_BASE_DIR:-$HOME/scoopfeeds-radio}/upload-samples.jsonl"
mkdir -p "$(dirname "$OUT")"
command -v networkQuality >/dev/null || { echo "networkQuality not found (needs macOS 12+)" >&2; exit 78; }
for i in $(seq 1 "$N"); do
  J="$(networkQuality -s -c 2>/dev/null)"
  UL="$(printf '%s' "$J" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("ul_throughput",0))' 2>/dev/null || echo 0)"
  MBPS="$(/usr/bin/python3 -c "print(round(${UL:-0}/1e6,2))")"
  LINE="{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"uploadMbps\":${MBPS},\"tool\":\"networkQuality -s\"}"
  echo "$LINE" | tee -a "$OUT"
  [ "$i" -lt "$N" ] && sleep $((GAP_MIN * 60))
done
