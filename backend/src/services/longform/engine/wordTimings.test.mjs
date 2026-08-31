// wordTimings.test.mjs — the pure half of word-level narration timing.
//
// Run:  node --test backend/src/services/longform/engine/wordTimings.test.mjs
//
// These run WITHOUT an ElevenLabs key, which is the point of putting the logic
// here rather than inside narrate.mjs: the part that decides where an element
// lands is testable offline, and the two callers are thin enough to read.
//
// The alignment fixture below is hand-built in the shape the API documents —
// three parallel arrays, one entry per character spoken.

import test from "node:test";
import assert from "node:assert/strict";

import { wordsFromAlignment, findAnchor, clampReveal } from "./wordTimings.mjs";

/** Build a character alignment for `text` at a steady seconds-per-character. */
function fixture(text, spc = 0.1) {
  const characters = [...text];
  const character_start_times_seconds = characters.map((_, i) => +(i * spc).toFixed(4));
  const character_end_times_seconds = characters.map((_, i) => +((i + 1) * spc).toFixed(4));
  return { characters, character_start_times_seconds, character_end_times_seconds };
}

test("characters become words, with the first and last character's times", () => {
  const words = wordsFromAlignment(fixture("Thirteen minutes."));
  assert.deepEqual(words.map((w) => w.word), ["Thirteen", "minutes."]);
  assert.equal(words[0].start, 0);
  assert.equal(words[0].end, 0.8);       // 8 characters
  assert.equal(words[1].start, 0.9);     // after the space
});

test("runs of whitespace do not produce empty words", () => {
  const words = wordsFromAlignment(fixture("a   b\n\tc"));
  assert.deepEqual(words.map((w) => w.word), ["a", "b", "c"]);
});

test("a disagreeing alignment throws rather than yielding undefined times", () => {
  // A truncated timing array would give words with start: undefined, which
  // compares silently — the anchor resolves to NaN and the reveal to frame 0.
  const a = fixture("hello");
  a.character_end_times_seconds.pop();
  assert.throws(() => wordsFromAlignment(a), /alignment arrays disagree/);
});

test("a missing or malformed alignment is empty, not an exception", () => {
  // narrate.mjs falls back to proportional timing on these, so they must be
  // survivable rather than fatal.
  for (const bad of [undefined, null, {}, { characters: "not an array" }]) {
    assert.deepEqual(wordsFromAlignment(bad), []);
  }
});

test("an anchor resolves to the start of its first word", () => {
  const words = wordsFromAlignment(fixture("So by the time that needle went in"));
  const at = findAnchor(words, "that needle went in");
  // "So by the time " is 15 characters, so the phrase starts at 1.5s.
  assert.equal(at, 1.5);
});

test("anchor matching ignores case and punctuation", () => {
  const words = wordsFromAlignment(fixture("After an overnight fast."));
  assert.equal(findAnchor(words, "overnight fast"), findAnchor(words, "Overnight, FAST!"));
  assert.notEqual(findAnchor(words, "overnight fast"), null);
});

test("a phrase that is not in the take resolves to null, never to zero", () => {
  // Zero would silently fire the reveal on the first frame, which looks like a
  // timing bug rather than a missing anchor.
  const words = wordsFromAlignment(fixture("Thirteen minutes."));
  assert.equal(findAnchor(words, "fourteen minutes"), null);
  assert.equal(findAnchor(words, ""), null);
});

test("a repeated phrase resolves to its first occurrence", () => {
  const words = wordsFromAlignment(fixture("gone and gone again"));
  assert.equal(findAnchor(words, "gone"), 0);
});

test("a single word is a legal anchor", () => {
  const words = wordsFromAlignment(fixture("one two three"));
  assert.equal(findAnchor(words, "three"), 0.8);
});

test("clampReveal keeps the reveal inside the window build.mjs enforces", () => {
  const ENTER = 1.20, PAYOFF = 0.70;
  // Comfortably inside: used as-is.
  assert.equal(clampReveal(3.0, 8, ENTER, PAYOFF), 3.0);
  // Too early would cut the entrance off.
  assert.equal(clampReveal(0.2, 8, ENTER, PAYOFF), 1.5);
  // Too late leaves no room for the payoff to play.
  assert.equal(clampReveal(7.9, 8, ENTER, PAYOFF), 8 - PAYOFF - 0.9);
});

test("clampReveal never returns a window that runs backwards on a short take", () => {
  // On a take too short to hold both phases the low bound wins, so hold1/hold2
  // in build.mjs stay non-negative rather than producing an invalid ffmpeg -t.
  const ENTER = 1.20, PAYOFF = 0.70;
  const r = clampReveal(5, 1.0, ENTER, PAYOFF);
  assert.equal(r, ENTER + 0.30);
  assert.ok(r >= ENTER + 0.30);
});
