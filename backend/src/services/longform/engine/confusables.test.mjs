// confusables.test.mjs — characters that draw as a different character.
//
// Run:  node --test backend/src/services/longform/engine/confusables.test.mjs
//
// THE LIST IS DERIVED, NOT GUESSED, and this is what keeps it that way: the
// first test re-reads the shipped fonts, compares every glyph OUTLINE, and
// fails if the set of identical-outline pairs is not exactly what
// confusables.mjs documents. Swap a font and this goes red, which is the point
// — a new confusable is a new way for a card to say something the storyboard
// does not.
//
// Outlines, not cmap coverage. Anton maps U+2260 to its own glyph index, so
// every "does the font have this character" check passes; the glyph it points
// at is simply an equals sign.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ASSETS, dep } from "./_deps.mjs";
import { CONFUSABLE, FORBIDDEN, confusablesIn } from "./confusables.mjs";

const FONTS = ["Anton-Regular.ttf", "Inter-Bold.otf", "Inter-SemiBold.otf"];
// Everything a card plausibly contains: printable ASCII plus the punctuation
// and symbols the house style actually reaches for.
const CHARS = [];
for (let i = 0x20; i < 0x7f; i++) CHARS.push(String.fromCharCode(i));
for (const c of "≠≈×÷±→←↑↓—–…·•§¶†‡°′″‰≤≥∞“”‘’«»") CHARS.push(c);

/** Every pair of characters in `file` that draw the same outline. */
function confusablePairsIn(file) {
  const ot = dep("@shuding/opentype.js");
  const buf = readFileSync(path.join(ASSETS, "fonts", file));
  const font = ot.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const byPath = new Map();
  for (const c of CHARS) {
    const gi = font.charToGlyphIndex(c);
    if (!gi) continue;
    const d = font.glyphs.get(gi).getPath(0, 0, 1000).toPathData(2);
    if (!d) continue;
    if (!byPath.has(d)) byPath.set(d, []);
    byPath.get(d).push(c);
  }
  return [...byPath.values()].filter((v) => v.length > 1);
}

test("the documented confusables are exactly what the shipped fonts actually do", () => {
  const found = new Set();
  for (const f of FONTS) {
    for (const group of confusablePairsIn(f)) {
      // The character that is NOT the plain ASCII one is the impostor.
      const plain = group.find((c) => c.charCodeAt(0) < 0x80);
      for (const c of group) if (c !== plain) found.add(`${c}->${plain}`);
    }
  }
  const documented = new Set(Object.entries(CONFUSABLE).map(([k, v]) => `${k}->${v}`));
  assert.deepEqual([...found].sort(), [...documented].sort(),
    "confusables.mjs no longer matches the fonts — classify each new pair as " +
    "meaning-changing (add to FORBIDDEN) or cosmetic before updating CONFUSABLE");
});

test("every FORBIDDEN character is a real confusable, and says what to do instead", () => {
  for (const [ch, info] of Object.entries(FORBIDDEN)) {
    assert.equal(CONFUSABLE[ch], info.renders, `${ch} is forbidden but not a documented confusable`);
    assert.ok(info.why && info.instead, `${ch} must explain itself and name an alternative`);
  }
});

test("the meaning-changing case is caught; the cosmetic ones are allowed", () => {
  // ≠ drawing as = inverts the claim. An en dash drawing as a hyphen does not,
  // and refusing it would be pedantry authors would route around.
  assert.equal(confusablesIn(["TERTILES", "≠", "QUARTILES"]).length, 1);
  assert.equal(confusablesIn(["2024–2026", 'a "quote"', "5′ 3″"]).length, 0);
});

test("non-strings and empty input are survivable", () => {
  assert.deepEqual(confusablesIn([undefined, null, 42, ""]), []);
  assert.deepEqual(confusablesIn([]), []);
});
