// ken.test.mjs — the slow move on a still.
//
// The vibration these numbers describe was measured, not reasoned about: a
// still with one thin bright line at the exact centre of a centre-anchored
// zoom. That line should never move, so any motion is artifact. See ken.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { kenFilter, zoomSpanFor, ZOOM_PER_SEC, ZOOM_MAX_SPAN, ZP_W, OUT_W } from "./ken.mjs";

test("zoompan renders above the output size and is downscaled", () => {
  const f = kenFilter("in", 150);
  assert.ok(ZP_W > OUT_W, "the whole fix is that rounding happens at a larger size");
  assert.match(f, new RegExp(`s=${ZP_W}x`), "zoompan must render at the larger size");
  assert.match(f, new RegExp(`scale=${OUT_W}:\\d+:flags=bicubic`),
    "an interpolating downscale is what turns a 1px snap into a sub-pixel shift; "
    + "dropping it puts the vibration straight back");
  assert.ok(f.indexOf("zoompan") < f.indexOf(`scale=${OUT_W}`),
    "the downscale has to come AFTER zoompan or it does nothing for jitter");
});

test("drift is per second, so every shot moves at the same visible rate", () => {
  // Tying the span to the shot made a 2s cutaway race and a 9s hold crawl.
  assert.equal(zoomSpanFor(2), ZOOM_PER_SEC * 2);
  assert.equal(zoomSpanFor(5), ZOOM_PER_SEC * 5);
  // Both lengths must sit UNDER the cap, or the cap is what is being compared.
  const spanOf = (f) => +/min\([\d.]+\+\(([\d.]+)\//.exec(f)[1];
  const rate = (frames) => spanOf(kenFilter("in", frames)) / (frames / 30);
  assert.ok(zoomSpanFor(6) < ZOOM_MAX_SPAN, "6s must be under the cap for this comparison");
  assert.ok(Math.abs(rate(60) - rate(180)) < 1e-6,
    "a 2s shot and a 6s shot must drift at the same rate per second");
});

test("past the cap, a longer shot drifts more slowly rather than further", () => {
  // The cap is a deliberate second rule, and it is what makes the rate test
  // above need two lengths under it. A 20s hold must not travel 0.24 of zoom.
  const spanOf = (f) => +/min\([\d.]+\+\(([\d.]+)\//.exec(f)[1];
  assert.equal(spanOf(kenFilter("in", 600)), ZOOM_MAX_SPAN);
  assert.equal(spanOf(kenFilter("in", 1200)), ZOOM_MAX_SPAN,
    "twice as long must not mean twice the travel once capped");
});

test("a long shot is capped rather than drifting across the whole frame", () => {
  assert.equal(zoomSpanFor(600), ZOOM_MAX_SPAN);
  assert.ok(ZOOM_MAX_SPAN < 0.16,
    "0.16 was the pre-fix span and it read as a push, not a drift");
});

test("the move ends where it says it ends", () => {
  const f = kenFilter("in", 150, 1.0);
  const m = /min\(([\d.]+)\+\(([\d.]+)\/150\)\*on,([\d.]+)\)/.exec(f);
  assert.ok(m, `zoom expression not in the expected form: ${f}`);
  const [, z0, span, z1] = m.map(Number);
  assert.ok(Math.abs((z0 + span) - z1) < 1e-6,
    "the clamp must equal start+span, or the move stops short of or past its end");
});

test("out reverses in, and both stay within the same bounds", () => {
  const zin = kenFilter("in", 150), zout = kenFilter("out", 150);
  assert.match(zin, /z='min\(/);
  assert.match(zout, /z='max\(/);
  assert.notEqual(zin, zout);
});

test("an unknown mode falls back rather than emitting a broken filter", () => {
  assert.equal(kenFilter("sideways", 90), kenFilter("in", 90));
});
