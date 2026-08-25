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
import { arcAt, applyReveal } from "./arc.mjs";

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
