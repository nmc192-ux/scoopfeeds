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
PARENT="${2:-$PWD}"
DIR="$PARENT/$SLUG"
# Derived from this script's own location: the engine sits at
# <repo>/.claude/skills/video-factory/engine, so the repo is four levels up.
# Hardcoding one developer's checkout path here meant the skill only ran on one
# machine.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BACKEND="$REPO_ROOT/backend"
SKILL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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
  1. node $SKILL/engine/demand.mjs "<candidate title>"     # before writing anything
  2. rewrite script.md and storyboard.mjs for this topic
  3. node $SKILL/engine/narrate.mjs
  4. node $SKILL/engine/build.mjs
  5. node $SKILL/engine/music.mjs
  6. node $SKILL/engine/shorts.mjs
  7. node $SKILL/engine/qc.mjs out/<slug>-scored.mp4
TXT
