#!/bin/bash
# run-batch.sh <am|pm> — launchd entry point for one scheduled 60 · batch (one film, never posted by this script).
# The daily cap is 2 films (SIXTY_FILMS_PER_DAY; gates/cap.mjs can only lower the hard ceiling of 6, never raise it).
set -u
WINDOW="${1:?usage: run-batch.sh am|pm}"
REPO="${SIXTY_REPO:-$HOME/Projects/scoopfeeds}"
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.claude/local:/usr/bin:/bin"
export SIXTY_FILMS_PER_DAY=2
unset ANTHROPIC_API_KEY
mkdir -p "$HOME/sixty/logs"
cd "$REPO" || exit 78
exec node sixty/bin/batch.mjs --window "$WINDOW"
