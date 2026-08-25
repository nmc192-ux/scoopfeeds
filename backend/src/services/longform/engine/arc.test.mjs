// arc.test.mjs — the reveal-aware score arc, held to its contract.
//
// Run:  node --test .claude/skills/video-factory/engine/arc.test.mjs
//
// The contract, in order of importance:
//   1. ON the reveal the bed is at the drop level — near silence is what
//      makes the picture loud.
//   2. OUTSIDE the shaping window the arc is byte-identical to what the
//      chapter arrangement produced. The reveal may not restructure the film.
//   3. No reveal → no change at all. The shaping is opt-in by the storyboard
//      exporting REVEAL, nothing else.

import test from "node:test";
import assert from "node:assert/strict";
import { arcAt, applyReveal, sortArc, envelope } from "./arc.mjs";

// A miniature of a real film arc: open, build, turn, rebuild.
const ARC = [
  [0, 0.55], [12, 0.72], [100, 0.88], [200, 1.0], [260, 0.4], [320, 0.92], [400, 0.8],
];

test("arcAt interpolates linearly and clamps at both ends", () => {
  assert.equal(arcAt(ARC, -5), 0.55);
  assert.equal(arcAt(ARC, 0), 0.55);
  assert.equal(arcAt(ARC, 6), (0.55 + 0.72) / 2);
  assert.equal(arcAt(ARC, 400), 0.8);
  assert.equal(arcAt(ARC, 999), 0.8);
});

test("the bed is at the drop level ON the reveal, and holds it", () => {
  const out = applyReveal(ARC, 150);
  assert.equal(arcAt(out, 150), 0.18, "the drop lands on the reveal itself");
  assert.equal(arcAt(out, 151.5), 0.18, "and holds while the picture lands");
  // Thinning precedes it: quieter than the un-shaped arc just before.
  assert.ok(arcAt(out, 148.8) < arcAt(ARC, 148.8), "the breath in before the drop");
  // Swell after: back up, slightly hot.
  assert.ok(arcAt(out, 160) > 0.18, "the bed comes back after the hold");
});

test("outside the shaping window the arc is untouched", () => {
  const out = applyReveal(ARC, 150);
  for (const t of [0, 12, 100, 260, 320, 400]) {
    if (t < 142 || t > 160) {
      assert.equal(arcAt(out, t), arcAt(ARC, t), `t=${t}s must keep its chapter-arrangement value`);
    }
  }
  // Points list stays time-ordered — an out-of-order list silently corrupts
  // the ffmpeg envelope expression.
  const ts = out.map(([t]) => t);
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b), "points must remain sorted by time");
});

test("no reveal, no change — null and NaN are both 'leave it alone'", () => {
  assert.deepEqual(applyReveal(ARC, null), ARC);
  assert.deepEqual(applyReveal(ARC, undefined), ARC);
  assert.deepEqual(applyReveal(ARC, NaN), ARC);
});

test("a reveal near the film's start clamps instead of going negative", () => {
  const out = applyReveal(ARC, 4);
  const ts = out.map(([t]) => t);
  assert.ok(ts.every((t) => t >= 0), "no negative times");
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b), "still sorted");
  assert.equal(arcAt(out, 4), 0.18, "the drop still lands on the reveal");
});

test("a reveal near the outro rejoins the authored settle instead of swallowing it", () => {
  // The outro settle lives at [296, 0.92], [300, 0.80] — inside the nominal
  // +10s window of a 295s reveal. Those points are the authored structure;
  // the swell must END on them, not delete them and play the credits hot.
  const FILM = [[0, 0.55], [12, 0.72], [280, 1.0], [296, 0.92], [300, 0.80], [310, 0.80]];
  const out = applyReveal(FILM, 295);
  assert.equal(arcAt(out, 295), 0.18, "the drop still lands on the reveal");
  assert.equal(arcAt(out, 300), 0.80, "the outro settle survives");
  assert.equal(arcAt(out, 306), 0.80, "the credits play at the authored level, not the swell");
});

test("sortArc: out-of-order and duplicate-time points are normalised", () => {
  // The non-6-chapter fallback arc emits [0],[12],[T-4],[T],… — a chapter at
  // 9s lands [5],[9] AFTER [12], and envelope's if-chain silently shadows
  // everything past the inversion. sortArc is what every producer ends with.
  const messy = [[0, 0.55], [12, 0.72], [5, 0.72], [9, 0.85], [12, 0.9], [-2, 0.1]];
  const out = sortArc(messy);
  const ts = out.map(([t]) => t);
  assert.deepEqual(ts, [...ts].sort((x, y) => x - y), "sorted");
  assert.ok(ts.every((t) => t >= 0), "no negative times");
  assert.equal(new Set(ts).size, ts.length, "no duplicate times");
  assert.equal(arcAt(out, 12), 0.9, "last writer wins on a duplicate time");
});

test("envelope and arcAt are two views of ONE list — breakpoints stay sorted", () => {
  // The audio the viewer hears is shaped by envelope (an ffmpeg if-chain);
  // the tests reason through arcAt. applyReveal's output must be safe for
  // BOTH: monotone breakpoints, so no branch shadows another.
  const out = applyReveal([[0, 0.55], [12, 0.72], [400, 0.8]], 4); // clamped early reveal
  const expr = envelope(out);
  const breaks = [...expr.matchAll(/lt\(t,([\d.]+)\)/g)].map((m) => parseFloat(m[1]));
  assert.deepEqual(breaks, [...breaks].sort((x, y) => x - y), "envelope breakpoints sorted");
  assert.ok(expr.length > 0 && !expr.includes("NaN"), "no NaN reaches the expression");
});
