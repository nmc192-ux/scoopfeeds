#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Scoopfeeds — Brand asset generator
#
# Renders the cobalt-intelligence OG card (1200×630) and a square brand mark
# (1024×1024) using headless Chrome. Writes PNGs into frontend/public/.
#
# Run from repo root:  ./scripts/generate-brand-assets.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC="$REPO_ROOT/frontend/public"
TMP="$(mktemp -d)"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  CHROME="$(command -v google-chrome || command -v chrome || command -v chromium)"
fi
if [ -z "${CHROME:-}" ] || [ ! -x "$CHROME" ]; then
  echo "ERROR: Google Chrome not found. Install Chrome to render brand assets." >&2
  exit 1
fi

echo "→ Rendering OG card (1200×630)…"
cp "$REPO_ROOT/scripts/brand-templates/og-card.html" "$TMP/og.html"
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1200,630 --virtual-time-budget=10000 \
  --run-all-compositor-stages-before-draw \
  --screenshot="$PUBLIC/og-image.png" "file://$TMP/og.html" > /dev/null 2>&1

echo "→ Rendering square brand mark (1024×1024)…"
cp "$REPO_ROOT/scripts/brand-templates/social-square.html" "$TMP/sq.html"
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1024,1024 --virtual-time-budget=10000 \
  --run-all-compositor-stages-before-draw \
  --screenshot="$PUBLIC/social-square.png" "file://$TMP/sq.html" > /dev/null 2>&1

echo "→ Rendering Twitter/X header (1500×500)…"
cp "$REPO_ROOT/scripts/brand-templates/social-banner.html" "$TMP/bn.html"
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1500,500 --virtual-time-budget=10000 \
  --run-all-compositor-stages-before-draw \
  --screenshot="$PUBLIC/social-banner.png" "file://$TMP/bn.html" > /dev/null 2>&1

rm -rf "$TMP"
echo "✓ Wrote:"
ls -la "$PUBLIC/og-image.png" "$PUBLIC/social-square.png" "$PUBLIC/social-banner.png"
