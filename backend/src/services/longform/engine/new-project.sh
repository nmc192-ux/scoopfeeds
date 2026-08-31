#!/bin/bash
# Scaffold a working directory for one video.
#
#   bash engine/new-project.sh <slug> [parent-dir]
#
# The node_modules SYMLINK is the whole point of this script. These directories
# reuse the backend's installed toolchain (ffmpeg, satori, resvg) rather than
# installing their own — and creating that link by hand is easy to forget, while
# `npm install` inside the directory destroys it. See references/gotchas.md.
set -euo pipefail

SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "usage: bash engine/new-project.sh <slug> [parent-dir]"; exit 1; }
# ABSOLUTE, ALWAYS. The toolchain check at the bottom passes $DIR to require(),
# which treats a path not starting with "./" or "/" as a MODULE NAME — so a
# relative parent dir ("engine/new-project.sh slug some/where") scaffolded the
# project correctly and then failed its own verification with
# "Cannot find module", which reads as a broken symlink and is not one.
PARENT="${2:-$PWD}"
mkdir -p "$PARENT"
PARENT="$(cd "$PARENT" && pwd)"
DIR="$PARENT/$SLUG"
# ANCHOR ON BACKEND, NOT ON THE REPO ROOT — the same rule _deps.mjs follows, and
# for the same reason. The engine moved from .claude/skills/video-factory/engine
# into backend/src/services/longform/engine so it would ship in the production
# image, and this script's own derivation was not updated with it: REPO_ROOT
# resolved to <repo>/backend, BACKEND to <repo>/backend/backend, and SKILL to
# the longform service directory, so every template copy below pointed at a path
# that does not exist. deployment.test.js pinned _deps.mjs through the move but
# never looked at this file, so it broke in silence.
ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$(cd "$ENGINE_DIR/../../../.." && pwd)"
REPO_ROOT="$(cd "$BACKEND/.." && pwd)"
# The SKILL keeps only SKILL.md, references/, assets/ and template/ — the engine
# no longer lives under it.
SKILL="$REPO_ROOT/.claude/skills/video-factory"

[ -e "$DIR" ] && { echo "refusing: $DIR already exists"; exit 1; }

mkdir -p "$DIR/out"
ln -s "$BACKEND/node_modules" "$DIR/node_modules"
ln -s "$SKILL/assets/fonts" "$DIR/fonts"
cp "$SKILL/template/storyboard.example.mjs" "$DIR/storyboard.mjs"
cp "$SKILL/template/script.example.md" "$DIR/script.md"
printf '{\n  "slug": "%s",\n  "title": "TODO — a phrase the demand probe actually returns suggestions for"\n}\n' "$SLUG" > "$DIR/project.json"
printf '[]\n' > "$DIR/docs.json"
printf '[]\n' > "$DIR/shorts.json"
printf '{}\n' > "$DIR/publish.json"
printf '{}\n' > "$DIR/ig.json"

echo "created $DIR"
node -e "require('$DIR/node_modules/@ffmpeg-installer/ffmpeg')" \
  && echo "  toolchain resolves" || { echo "  TOOLCHAIN BROKEN — check the symlink"; exit 1; }
cat <<TXT

next:
  1. node $ENGINE_DIR/demand.mjs "<candidate title>"     # before writing anything
  2. rewrite script.md and storyboard.mjs for this topic
  3. node $ENGINE_DIR/narrate.mjs
  4. node $ENGINE_DIR/build.mjs
  5. node $ENGINE_DIR/music.mjs
  6. node $ENGINE_DIR/shorts.mjs
  7. node $ENGINE_DIR/qc.mjs out/<slug>-scored.mp4
TXT
