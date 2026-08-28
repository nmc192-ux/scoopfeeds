/**
 * videoGeometry.test.js — the two frames, and the properties that keep 16:9
 * frozen while 9:16 exists beside it.
 *
 * The strongest guarantee in this pass is not in here: `_stateHashes.mjs`
 * renders every state of every card type and compares sha256 before and after
 * the refactor, and all 29 came back byte-identical. These tests pin the things
 * a hash cannot — that the fingerprint covers the new files, that an unknown
 * orientation is refused rather than defaulted, and that the vertical layouts
 * honour the same state contract the collapse rule depends on.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { GEOMETRY, HORIZONTAL, VERTICAL, geometryFor } from "./videoGeometry.js";
import { statesForCard, VIDEO_BUILDER_FINGERPRINT, CANVAS, MARGIN_X } from "./videoSlideRenderer.js";
import { verticalStatesForCard, VY } from "./videoSlideRendererVertical.js";
import { makePrimitives, GROUND } from "./videoSlideChrome.js";

const CARDS = {
  title:   { t: "title", eyebrow: "E", lines: [["A", "white"], ["B", "lime"]], sub: "s", date: "12 AUGUST 2026", caption: "c" },
  stat:    { t: "stat", eyebrow: "E", value: 100, unit: "%", lines: ["a", "b"], hi: 1, source: "Reuters", caption: "c" },
  bars:    { t: "bars", eyebrow: "E", bars: [["a", 9], ["b", 8], ["c", 7], ["d", 6], ["e", 5]], source: "Reuters", caption: "c" },
  diagram: { t: "diagram", eyebrow: "E", nodes: [["A", "a"], ["B", "b"], ["C", "c"], ["D", "d"], ["E", "e"], ["F", "f"]], marker: { on: 2, label: "X" }, caption: "c" },
  turn:    { t: "turn", eyebrow: "E", lines: [["A", "white"], ["B", "lime"]], sub: "s", caption: "c" },
  kicker:  { t: "kicker", top: "A", bottom: "B", sub: "s", caption: "c" },
};
const CTX_V = { orientation: "vertical", outlet: "Reuters", slideIndex: 2, slideCount: 7 };

// ─── The frames ─────────────────────────────────────────────────────────────

test("16:9 is unchanged, and its exported names still resolve to it", () => {
  assert.deepEqual({ ...HORIZONTAL.canvas }, { w: 1920, h: 1080 });
  assert.equal(HORIZONTAL.marginX, 96);
  assert.equal(HORIZONTAL.contentW, 1728);
  assert.equal(HORIZONTAL.progressY, 1046);
  // The module's long-standing public surface, which videoAssembler and three
  // test files import. A rename here is a breakage there.
  assert.deepEqual({ ...CANVAS }, { w: 1920, h: 1080 });
  assert.equal(MARGIN_X, 96);
});

test("9:16 is 1080x1920 with an asymmetric safe area", () => {
  assert.deepEqual({ ...VERTICAL.canvas }, { w: 1080, h: 1920 });
  // Asymmetric ON PURPOSE: the platform chrome is almost all at the bottom, so
  // a symmetric 4:5 inset (285/285) would discard usable top and add nothing
  // at the bottom. If someone "tidies" these to match, this fails.
  assert.ok(VERTICAL.safeBottom > VERTICAL.safeTop * 2, "the bottom reservation must dominate");
  assert.equal(VERTICAL.contentBottom, 1600);
  // The progress line MOVED UP (Gate C): it was 1594 — 83% of frame height —
  // which is under TikTok's own furniture and below the burned caption band.
  // The invariant it was pinning is unchanged and now asserted as an invariant
  // rather than as a literal: it sits inside OUR content area, and it now also
  // sits above the captions it belongs to.
  assert.ok(VERTICAL.progressY < VERTICAL.contentBottom, "the progress line sits inside our area, not the platform's");
  assert.ok(VERTICAL.progressY / VERTICAL.canvas.h <= 0.75,
    `the progress line is at ${(VERTICAL.progressY / VERTICAL.canvas.h * 100).toFixed(1)}% — platform furniture starts around 85%`);
  assert.equal(VERTICAL.progressY, 1296);
  assert.ok(VERTICAL.contentWRail < VERTICAL.contentW, "content must have a rail-safe measure");
});

test("an unknown orientation THROWS rather than defaulting to 16:9", () => {
  // A typo silently rendering horizontal into a vertical pipeline produces a
  // letterboxed stripe that looks deliberate.
  assert.throws(() => geometryFor("portrait"), /unknown orientation "portrait"/);
  assert.throws(() => geometryFor("9:16"), /unknown orientation/);
  assert.equal(geometryFor("vertical"), VERTICAL);
  assert.equal(geometryFor(), HORIZONTAL);
});

// ─── The cache key ──────────────────────────────────────────────────────────

test("THE FINGERPRINT COVERS EVERY FILE THAT DECIDES A PIXEL", () => {
  // It used to hash only videoSlideRenderer.js, which was right when that file
  // WAS the renderer. Splitting it across four modules without widening this is
  // exactly how prod ends up serving frames from before a layout change, with
  // no human step to forget.
  const src = readFileSync(new URL("./videoSlideRenderer.js", import.meta.url), "utf8");
  const call = src.slice(src.indexOf("sourceFingerprint(["), src.indexOf("]);", src.indexOf("sourceFingerprint([")));
  // videoAssembler.js is here because a cutaway composites footage over the
  // frame and drops the masthead for its duration — it decides pixels now, even
  // though it rasterises nothing.
  for (const f of ["videoGeometry.js", "videoSlideChrome.js", "videoSlideRendererVertical.js", "videoAssembler.js"]) {
    assert.ok(call.includes(f), `${f} decides rendered output but is not in the fingerprint`);
  }
  assert.ok(call.includes("import.meta.url"), "this file itself must stay in the list");
  assert.match(VIDEO_BUILDER_FINGERPRINT, /^[0-9a-f]{12}$/);
});

// ─── The vertical layouts honour the shared state contract ──────────────────

test("every card type has a vertical layout, and the closed set stays closed", () => {
  for (const [name, card] of Object.entries(CARDS)) {
    const states = verticalStatesForCard(card, CTX_V);
    assert.ok(states.length >= 3, `${name}: ${states.length} states`);
    assert.ok(states.length <= 6, `${name}: ${states.length} states exceeds the 6-state budget`);
  }
  assert.throws(() => verticalStatesForCard({ t: "carousel" }, CTX_V), /no layout for card type/);
});

test("statesForCard dispatches on orientation and defaults to 16:9", () => {
  const h = statesForCard(CARDS.stat, { outlet: "Reuters", slideIndex: 2, slideCount: 7 });
  const v = statesForCard(CARDS.stat, CTX_V);
  assert.equal(h[0].tree.props.style.width, 1920, "no orientation must still mean horizontal");
  assert.equal(v[0].tree.props.style.width, 1080);
  assert.equal(v[0].tree.props.style.height, 1920);
});

test("states are CUMULATIVE — the last one is the complete card", () => {
  // fitStatesToDuration collapses from the second-to-last backwards precisely
  // because the final state is the whole composition. A vertical layout that
  // only looked right after every state had landed would lose content on any
  // short caption.
  for (const [name, card] of Object.entries(CARDS)) {
    const states = verticalStatesForCard(card, CTX_V);
    const size = (st) => JSON.stringify(st.tree).length;
    const last = size(states[states.length - 1]);
    for (const st of states.slice(0, -1)) {
      assert.ok(size(st) <= last, `${name}/${st.key} is larger than the final state`);
    }
  }
});

test("the two-tier lime rule holds vertically: the final state carries the accent", () => {
  for (const [name, card] of Object.entries(CARDS)) {
    const states = verticalStatesForCard(card, CTX_V);
    assert.equal(states[states.length - 1].lime, true, `${name}: final state carries no content lime`);
    assert.equal(states[0].lime, false, `${name}: the empty opening state should carry none`);
  }
});

test("the primitives are ONE definition bound twice, not two copies", () => {
  // The whole reason videoSlideChrome exists. If someone forks it, the brand
  // invariant has two homes and they drift.
  const h = makePrimitives(HORIZONTAL), v = makePrimitives(VERTICAL);
  // root() takes an explicit ground as of the B1 contract — see videoSlideChrome.
  assert.equal(h.root(GROUND.INK, []).props.style.width, 1920);
  assert.equal(v.root(GROUND.INK, []).props.style.width, 1080);
  // Same shape, different coordinates — the progress track is full-bleed in
  // BOTH, because it is chrome and the action rail does not apply to chrome.
  const hc = h.chrome({ slideIndex: 0, slideCount: 4 });
  const vc = v.chrome({ slideIndex: 0, slideCount: 4 });
  assert.equal(hc.length, vc.length);
  assert.equal(hc[2].props.style.width, 1920);
  assert.equal(vc[2].props.style.width, 1080);
});

test("vertical content clears the platform's bottom band", () => {
  // Everything the layouts position by Y must land above contentBottom. This is
  // the invisible failure: it renders perfectly and is covered on the phone.
  for (const [k, y] of Object.entries(VY)) {
    if (k.endsWith("Row")) continue;   // pitches, not positions
    assert.ok(y < VERTICAL.contentBottom, `VY.${k} = ${y} is inside the platform band (>= ${VERTICAL.contentBottom})`);
  }
  // The lowest thing the bars card can place: five rows plus its credit.
  const lastBarCredit = VY.barsFirst + 5 * VY.barsRow + 10 + 26;
  assert.ok(lastBarCredit < VERTICAL.contentBottom, `bars credit at ${lastBarCredit} is in the platform band`);
  const lastNode = VY.diagramFirst + 5 * VY.diagramRow + 64;
  assert.ok(lastNode < VERTICAL.contentBottom, `last diagram node at ${lastNode} is in the platform band`);
});

// ─── The vertical margin, and what it is absorbing ──────────────────────────

test("vertical marginX is LARGER than 16:9's, and deliberately so", () => {
  // 16:9 is 96 on 1920 = 5.0%; vertical is 104 on 1080 = 9.6%. The asymmetry is
  // the point, not an inconsistency: nothing crops a landscape upload, whereas
  // Shorts and Reels crop the SIDES of a 9:16 upload to fill a taller screen by
  // an amount that depends on the handset and cannot be detected from here.
  assert.equal(VERTICAL.marginX, 104);
  assert.equal(HORIZONTAL.marginX, 96);
  assert.ok(VERTICAL.marginX / VERTICAL.canvas.w > HORIZONTAL.marginX / HORIZONTAL.canvas.w * 1.5,
    "the vertical margin must stay a substantially larger FRACTION");
});

test("the derived measures follow marginX — no literal may drift from it", () => {
  // Every card type derives from these two. If a layout ever hardcodes an inset
  // instead, raising marginX silently stops working for that card.
  assert.equal(VERTICAL.contentW, VERTICAL.canvas.w - VERTICAL.marginX * 2);
  assert.equal(VERTICAL.contentWRail, VERTICAL.canvas.w - VERTICAL.marginX - VERTICAL.safeRight);
  assert.equal(HORIZONTAL.contentW, HORIZONTAL.canvas.w - HORIZONTAL.marginX * 2);
});

test("the rail measure stays wide enough to be worth having", () => {
  // contentWRail is what diagram labels and bar tracks get. Raising marginX
  // narrows it from both ends at once, so it is the first thing to become
  // unusable if the margin is pushed again.
  assert.ok(VERTICAL.contentWRail >= 800,
    `${VERTICAL.contentWRail}px — below ~800 the diagram's node labels start wrapping`);
});
