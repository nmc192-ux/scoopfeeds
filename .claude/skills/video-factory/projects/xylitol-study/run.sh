#!/bin/bash
# Build the xylitol film. Run this ON a machine that has the keys and the
# network — the VPS or the Mac. It does NOT publish anything.
#
#   bash run.sh            # narrate → build → music → shorts → qc
#   bash run.sh --from build
#
# WHY THIS EXISTS. The remote session that authored the film cannot run it: its
# egress policy blocks api.elevenlabs.io, api.pexels.com and pixabay.com, so
# narration and stock are unreachable there whatever keys are set. Everything
# up to that line is done and committed; this is the part that needs a machine
# with a way out to the internet.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="$(cd "$HERE/../../../../../backend/src/services/longform/engine" && pwd)"
cd "$HERE"

FROM="${2:-narrate}"
[ "${1:-}" = "--from" ] || FROM="narrate"

step() { echo; echo "── $1 ─────────────────────────────────────────"; }
after() { case "$FROM" in
  narrate) return 0 ;;
  build)   [ "$1" != "narrate" ] ;;
  music)   [ "$1" != "narrate" ] && [ "$1" != "build" ] ;;
  shorts)  [ "$1" = "shorts" ] || [ "$1" = "qc" ] ;;
  qc)      [ "$1" = "qc" ] ;;
  *) return 0 ;;
esac; }

# PREFLIGHT. Fail here, naming what is missing, rather than 40 takes into a
# narration run or at the first ffmpeg call.
step "preflight"
# CHECK WHAT THE ENGINE CHECKS, NOT JUST THE SHELL. narrate.mjs has its own
# loadEnv that reads backend/.env then ~/.scoopfeeds.env, so a key living in the
# .env file is perfectly usable even though it is absent from the environment.
# The first version of this preflight tested $ELEVENLABS_API_KEY alone and
# refused to start a run that would have worked — and a false blocker is just as
# expensive as a missing one when the machine that can do the work is not the
# machine you are sitting at.
REPO="$(cd "$HERE/../../../../.." && pwd)"
missing=0
have_key() {
  [ -n "${ELEVENLABS_API_KEY:-}" ] && { echo "  key: environment"; return 0; }
  for f in "$REPO/backend/.env" "$HOME/.scoopfeeds.env"; do
    if [ -f "$f" ] && grep -qE '^[[:space:]]*ELEVENLABS_API_KEY[[:space:]]*=[[:space:]]*[^[:space:]]' "$f"; then
      echo "  key: $f"; return 0
    fi
  done
  return 1
}
if ! have_key; then
  echo "  X ELEVENLABS_API_KEY found in none of:"
  echo "      the environment"
  echo "      $REPO/backend/.env"
  echo "      $HOME/.scoopfeeds.env"
  missing=1
fi
[ -f "$HERE/storyboard.json" ] || { echo "  ✗ storyboard.json missing"; missing=1; }
[ -f "$HERE/beats.json" ] || { echo "  ✗ beats.json missing"; missing=1; }
# The scaffold's TEMPLATE storyboard is a loaded gun: storyboard.json wins while
# it exists, but if it were ever removed, build.mjs would silently assemble the
# EXAMPLE film instead of this one.
if [ -f "$HERE/storyboard.mjs" ]; then
  echo "  ! storyboard.mjs (the scaffold template) is present. storyboard.json takes"
  echo "    precedence so this run is correct, but delete it — if the JSON ever goes"
  echo "    missing, build.mjs assembles the example film without saying so."
fi
[ "$missing" = 0 ] || { echo; echo "refusing to start."; exit 1; }
echo "  ✓ ready"

if after narrate; then
  step "narrate — 115 takes + word-timing sidecars"
  # Watch the legend: '.' new, '·' cached, 't' NO TIMESTAMPS for that take.
  # A run reporting 'word timings: 0/115' means this voice/model has no
  # /with-timestamps support; the five revealOn anchors then fall back to
  # proportional timing and the film still builds. That is the one open
  # question the authoring session could not close without the API.
  node "$ENGINE/narrate.mjs"
fi

if after build; then
  step "build — assemble"
  # Needs out/footage/*.mp4 for the 70 footage beats. Acquisition is a curated
  # step, not one command: footage-search.mjs ranks candidates by provenance and
  # a human picks. See Section 4 of the brief for the 27 keys and their sources.
  node "$ENGINE/build.mjs"
fi

if after music; then step "music"; node "$ENGINE/music.mjs"; fi
if after shorts; then step "shorts — 5 vertical cuts"; node "$ENGINE/shorts.mjs"; fi

if after qc; then
  step "qc"
  node "$ENGINE/qc.mjs" "out/xylitol-study-scored.mp4"
fi

cat <<'TXT'

── done ────────────────────────────────────────
Nothing has been published. publish.json carries null publishAt values, so
publish-all.mjs refuses to schedule until a human sets the dates.

Before it ever runs, per the brief's §12:
  · watch it once on mute
  · read the captions aloud
  · confirm whether the full paper is published; if not, add the one on-screen
    line saying it was presented at a conference, not peer-reviewed in print
  · check whether absolute event rates have been released — if they have, D4
    stops being an empty panel and becomes the strongest number in the film
TXT
