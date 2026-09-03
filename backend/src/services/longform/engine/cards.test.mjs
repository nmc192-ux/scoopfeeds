// cards.test.mjs — the motion-grammar opt-ins (stat roll, equation wipe).
//
// Run:  node --test .claude/skills/video-factory/engine/*.test.mjs
//
// Same method as mapGeo.test.mjs: recorded PNG sha256 fixtures, valid because
// the render is deterministic (verified with duplicate runs). The recorded
// hashes were produced in the same session that verified the no-opt-in specs
// render IDENTICALLY through the pre-change code at commit 241b5e7 — the
// opt-ins are proven additive, not just claimed to be.
//
// The invariant these tests protect: AT p=1 AN OPT-IN CHANGES NOTHING. A roll
// must land on the authored figure, a wipe must fully uncover — the animation
// may only ever change the road, never the destination.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { renderCard } from "./render.mjs";

const TMP = mkdtempSync(path.join(os.tmpdir(), "cards-"));
const render = async (spec, name, p) => {
  const f = path.join(TMP, `${name}.png`);
  await renderCard(spec, f, p);
  return createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 16);
};

const STAT = { card: "stat", kicker: "THE NUMBER", figure: "$1,240", unit: "BN",
  label: "What the closure cost in ninety days.", src: "Fixture" };
const EQ = { card: "equation", kicker: "THE MECHANISM", numerator: "20M BARRELS A DAY",
  denominator: "ONE 26KM GAP", result: "NO SLACK", note: "Fixture note." };

// Re-recorded 2026-09-03 for the contrast-floor palette lift, in two passes
// (the floors first, then a further lift of the receded tokens once the frames
// were looked at). Re-recording a pixel baseline is how a layout regression
// gets blessed, so neither pass was done on the strength of "the colours
// changed": every fixture was rendered before and after and compared by INK
// MASK — the set of pixels that are not the ground. Overlap was 100.000% on all
// six, both times, i.e. glyph coverage is identical and only values moved.
//
// The second pass moved only the two equation hashes at p >= 0.6, which is
// itself a check worth reading: the card's 90px "=" is the one glyph here in a
// receded colour, and its opacity ramp `at(p, 0.24, 0.34)` is still zero at
// p=0.18 — so equation@0.18 SHOULD be untouched, and is. `stat` carries no
// receded token and did not move either.
//
// The invariant these tests actually protect (at p=1 an opt-in changes nothing)
// is untouched by a palette change and still holds below.
const PLAIN = {
  "stat@0.18": "cc74dc4734d449a5", "stat@0.6": "fff5eb04eda39452", "stat@1": "8547fee5070e8826",
  "equation@0.18": "b33f910304556df3", "equation@0.6": "bd1d4aafab43e386", "equation@1": "b4f09975f3b38b7f",
};

test("without opt-ins, stat and equation render exactly as before the change", async () => {
  for (const [name, spec] of [["stat", STAT], ["equation", EQ]]) {
    for (const p of [0.18, 0.6, 1.0]) {
      const got = await render(spec, `plain-${name}-${p}`, p);
      assert.equal(got, PLAIN[`${name}@${p === 1 ? "1" : p}`],
        `${name}@${p}: pixels drifted for a film that opted into nothing`);
    }
  }
});

test("roll: the figure counts, but lands on exactly the authored string", async () => {
  const mid = await render({ ...STAT, roll: true }, "roll-mid", 0.18);
  const end = await render({ ...STAT, roll: true }, "roll-end", 1.0);
  assert.notEqual(mid, PLAIN["stat@0.18"], "mid-entrance, a rolling figure must differ from the static one");
  assert.equal(end, PLAIN["stat@1"], "at p=1 the roll must reproduce the authored figure pixel-exactly");
});

test("roll: a figure with no number in it is left alone", async () => {
  for (const p of [0.18, 1.0]) {
    const a = await render({ card: "stat", figure: "NO DEAL", label: "x", roll: true }, `nn-roll-${p}`, p);
    const b = await render({ card: "stat", figure: "NO DEAL", label: "x" }, `nn-plain-${p}`, p);
    assert.equal(a, b, `"NO DEAL" with roll:true must render as if roll were off (p=${p})`);
  }
});

test("wipe: terms uncover left-to-right, converging on the fade version's final frame", async () => {
  const mid = await render({ ...EQ, wipe: true }, "wipe-mid", 0.18);
  const end = await render({ ...EQ, wipe: true }, "wipe-end", 1.0);
  assert.notEqual(mid, PLAIN["equation@0.18"], "mid-entrance, the wipe must differ from the fade");
  assert.equal(end, PLAIN["equation@1"], "at p=1 the wipe and the fade must be pixel-identical");
});

test("roll: grouping conventions the regroup cannot round-trip land verbatim at p=1", async () => {
  // "12,40,000" (Indian grouping), a figure with a trailing clause comma, and
  // a leading-zero figure — reconstruction mangles all three, so at p=1 the
  // authored string short-circuits past reconstruction entirely. Verified by
  // pixel identity with the roll-less render.
  for (const figure of ["12,40,000", "1,240, AND RISING", "007"]) {
    const key = figure.replace(/[^a-z0-9]/gi, "");
    const a = await render({ card: "stat", figure, label: "x", roll: true }, `grp-roll-${key}`, 1.0);
    const b = await render({ card: "stat", figure, label: "x" }, `grp-plain-${key}`, 1.0);
    assert.equal(a, b, `"${figure}" with roll:true must land pixel-identical at p=1`);
  }
});
