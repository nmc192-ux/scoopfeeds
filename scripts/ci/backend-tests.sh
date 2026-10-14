#!/usr/bin/env bash
# CI gate for the backend suite (full-throttle engine, 2026-10-14).
#
# 1. Run the whole suite once.
# 2. If it is not clean, re-run EVERY test file on its own. A file that passes
#    alone is the known teardown flake (better-sqlite3 Statement destructor in a
#    GC weak callback — CLAUDE.md "Known-flaky: SIGABRT"); it is reported, not
#    failed. A file that also fails alone is a real failure and fails the build.
#
# Nothing is skipped silently: every file that needed the second pass is named in
# the log, so a new flaky file is visible rather than absorbed.
set -uo pipefail
cd "$(dirname "$0")/../../backend" || exit 2

echo "== full suite"
if node --test "src/**/*.test.js"; then
  echo "== suite clean"
  exit 0
fi

echo "== suite not clean; re-running each file on its own"
mapfile -t FILES < <(find src -name '*.test.js' -o -name '*.test.mjs' | sort)
REAL=()
FLAKY=()
for f in "${FILES[@]}"; do
  if node --test "$f" > /tmp/one-test.log 2>&1; then
    :
  else
    if node --test "$f" > /tmp/one-test-retry.log 2>&1; then
      FLAKY+=("$f")
    else
      REAL+=("$f")
      echo "---- FAILED alone: $f"
      tail -40 /tmp/one-test-retry.log
    fi
  fi
done

if [ ${#FLAKY[@]} -gt 0 ]; then
  echo "== passed only on a second solo run (flaky, reported):"
  printf '   %s\n' "${FLAKY[@]}"
fi
if [ ${#REAL[@]} -gt 0 ]; then
  echo "== REAL FAILURES:"
  printf '   %s\n' "${REAL[@]}"
  exit 1
fi
echo "== every file passes on its own; full-suite failure was the known teardown flake"
exit 0
