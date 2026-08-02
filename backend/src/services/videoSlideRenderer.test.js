/**
 * videoSlideRenderer.test.js — the invariants that cannot be eyeballed.
 *
 * The demo MP4 proves the layouts read. What it cannot prove is that the lime
 * rule holds on EVERY state of EVERY card, that nothing drifts out of frame,
 * or that a short slide drops the right states. Those are the assertions here.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  statesForCard, fitStatesToDuration, videoDesignKey, VIDEO_DESIGN_VER,
  CANVAS, MARGIN_X, RESERVED_BOTTOM_Y, DRIFT_SAFE_X, DRIFT_SAFE_Y, LAYOUT_Y, COLORS,
} from "./videoSlideRenderer.js";
import { buildSlideFilter } from "./videoAssembler.js";

const ctx = { outlet: "Reuters", slideIndex: 2, slideCount: 7 };

const CARDS = {
  title:       { t: "title", eyebrow: "SUBSEA", lines: [["THE CABLES", "white"], ["CARRY EVERYTHING", "lime"]], sub: "s", caption: "c" },
  attribution: { t: "attribution", outlet: "Reuters", headline: "A headline", date: "2026-08-02", caption: "c" },
  stat:        { t: "stat", eyebrow: "FAULTS", value: 70, unit: "%", lines: ["of faults", "are anchors"], hi: 1, source: "Reuters", caption: "c" },
  diagram:     { t: "diagram", eyebrow: "HOW", nodes: [["SHIP", "a"], ["SHELF", "b"], ["CABLE", "c"], ["OUTAGE", "d"]], marker: { on: 2, label: "BREAK" }, caption: "c" },
  bars:        { t: "bars", eyebrow: "CAUSE", bars: [["anchors", 70], ["gear", 18], ["natural", 9], ["sabotage", 3]], source: "Reuters", caption: "c" },
  turn:        { t: "turn", eyebrow: "REAL", lines: [["NOT SABOTAGE", "white"], ["ORDINARY", "lime"]], sub: "s", caption: "c" },
  kicker:      { t: "kicker", top: "NOT SATELLITE", bottom: "CABLE", sub: "s", caption: "c" },
};

/** Walk a satori tree, collecting every style object. */
function styles(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach(n => styles(n, out)); return out; }
  if (node.props?.style) out.push(node.props.style);
  if (node.props?.children) styles(node.props.children, out);
  return out;
}
const limeCount = (tree) =>
  styles(tree).filter(s => s.color === COLORS.lime || s.background === COLORS.lime).length;

// ─── Two-tier lime ──────────────────────────────────────────────────────────

test("no state ever carries more than ONE full-strength lime element", () => {
  for (const [name, card] of Object.entries(CARDS)) {
    for (const st of statesForCard(card, ctx)) {
      assert.ok(limeCount(st.tree) <= 1,
        `${name}/${st.key} has ${limeCount(st.tree)} lime elements — the accent must never compete with itself`);
    }
  }
});

test("every card lands on EXACTLY one lime by its final state", () => {
  for (const [name, card] of Object.entries(CARDS)) {
    const states = statesForCard(card, ctx);
    const final = states[states.length - 1];
    assert.equal(limeCount(final.tree), 1, `${name} final state must carry exactly one lime`);
  }
});

test("the chrome progress line is never full-strength lime", () => {
  // It is present in every frame; at full strength it would BE the one accent
  // permanently and no content could ever be accented.
  const s1 = statesForCard(CARDS.title, ctx)[0];
  assert.equal(limeCount(s1.tree), 0, "opening state should carry no content lime");
  assert.ok(styles(s1.tree).some(s => String(s.background).includes("221,231,6")),
    "the dimmed chrome lime should still be present");
});

// ─── Drift-safe geometry ────────────────────────────────────────────────────

test("nothing is positioned inside the drift crop margin", () => {
  // Found the hard way: the progress line sat 8px from the bottom and was
  // absent from the assembled video, because the drift crop ate that edge.
  for (const [name, card] of Object.entries(CARDS)) {
    for (const st of statesForCard(card, ctx)) {
      for (const s of styles(st.tree)) {
        if (typeof s.top === "number" && typeof s.height === "number" && s.position === "absolute") {
          assert.ok(s.top + s.height <= CANVAS.h - DRIFT_SAFE_Y,
            `${name}/${st.key}: element at y=${s.top}+${s.height} is inside the ${DRIFT_SAFE_Y}px drift margin`);
          assert.ok(s.top >= 0, `${name}/${st.key}: negative top`);
        }
        if (typeof s.left === "number") {
          assert.ok(s.left >= -1, `${name}/${st.key}: element at x=${s.left} is off-canvas left`);
        }
      }
    }
  }
});

test("the stat credit clears the reserved bottom band (ruling 6)", () => {
  assert.ok(LAYOUT_Y.statCredit + 32 < RESERVED_BOTTOM_Y,
    `credit at ${LAYOUT_Y.statCredit}+32 must clear ${RESERVED_BOTTOM_Y}`);
});

test("diagram node labels stay on canvas at every node count", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const nodes = Array.from({ length: n }, (_, i) => [`N${i}`, `sub${i}`]);
    const states = statesForCard({ t: "diagram", eyebrow: "X", nodes, marker: { on: 0, label: "M" }, caption: "c" }, ctx);
    for (const s of styles(states[states.length - 1].tree)) {
      if (typeof s.left === "number" && typeof s.width === "number") {
        assert.ok(s.left >= -1, `${n} nodes: element starts at ${s.left}`);
        assert.ok(s.left + s.width <= CANVAS.w + 1, `${n} nodes: element ends at ${s.left + s.width}`);
      }
    }
  }
});

// ─── State counts ───────────────────────────────────────────────────────────

test("every card produces between 3 and 6 states", () => {
  for (const [name, card] of Object.entries(CARDS)) {
    const n = statesForCard(card, ctx).length;
    assert.ok(n >= 3 && n <= 6, `${name} produced ${n} states`);
  }
});

test("bars enter one per state and cap at 6 states with 5 bars", () => {
  const five = { t: "bars", eyebrow: "X", bars: [["a", 5], ["b", 4], ["c", 3], ["d", 2], ["e", 1]], source: "Reuters", caption: "c" };
  const states = statesForCard(five, ctx);
  assert.ok(states.length <= 6, `5 bars produced ${states.length} states`);
  assert.equal(states[states.length - 1].key, "credit");
});

test("the credit state is flagged so a collapse can be detected", () => {
  for (const name of ["stat", "bars"]) {
    const states = statesForCard(CARDS[name], ctx);
    assert.ok(states.some(s => s.credit), `${name} must flag its source-credit state`);
  }
});

test("an unknown card type throws — the closed set is closed", () => {
  assert.throws(() => statesForCard({ t: "carousel" }, ctx), /no layout for card type/);
});

// ─── State collapse ─────────────────────────────────────────────────────────

test("a short slide drops states from the END", () => {
  const states = statesForCard(CARDS.stat, ctx);
  const kept = fitStatesToDuration(states, 1.6, { cardType: "stat", slideIndex: 0 });
  assert.ok(kept.length < states.length);
  assert.equal(kept[0].key, states[0].key, "the opening state is never the one dropped");
});

test("a long-enough slide keeps every state", () => {
  const states = statesForCard(CARDS.stat, ctx);
  assert.equal(fitStatesToDuration(states, 30, { cardType: "stat" }).length, states.length);
});

test("collapsing the credit state is reported, not silent", async () => {
  // §3b/3's on-screen receipt vanishing from a figure card must be loud —
  // it looks like a timing tweak and behaves like a compliance regression.
  const { logger } = await import("./logger.js");
  const states = statesForCard(CARDS.stat, ctx);
  const lines = [];
  const prevWarn = logger.warn.bind(logger);
  logger.warn = (m) => { lines.push(String(m)); };
  try {
    fitStatesToDuration(states, 2.0, { cardType: "stat", slideIndex: 4 });
  } finally { logger.warn = prevWarn; }
  assert.ok(lines.some(l => /COLLAPSED THE SOURCE-CREDIT STATE/.test(l)),
    `expected a loud credit-collapse warning, got: ${lines.join(" | ") || "(nothing logged)"}`);
});

// ─── Design version ─────────────────────────────────────────────────────────

test("VIDEO_DESIGN_VER is independent of CARD_DESIGN_VER", async () => {
  const card = await import("./cardRenderer.js");
  assert.ok(!String(videoDesignKey()).includes("v12"));
  assert.match(VIDEO_DESIGN_VER, /^vid-/);
  assert.ok(typeof card.isCardRendererReady === "function");
});

test("the design key folds in a fingerprint of the builder source", () => {
  // The v12 lesson made structural: editing a layout function changes the key
  // with no human step to remember.
  const key = videoDesignKey();
  assert.match(key, new RegExp(`^${VIDEO_DESIGN_VER}-[0-9a-f]{12}$`));
});

// ─── Assembly order — the build requirement ─────────────────────────────────

test("DRIFT IS APPLIED AFTER CROSSFADE, never per state", () => {
  const { filter } = buildSlideFilter({ stateCount: 4, hold: 1.5 });
  const lastXfade = filter.lastIndexOf("xfade=");
  const drift = filter.indexOf("crop=");
  assert.ok(lastXfade > -1 && drift > lastXfade,
    "the crop/drift must come after every xfade — per-state drift makes each boundary jump");
});

test("the UPSCALE sits between the last xfade and the crop", () => {
  // Measured 2026-08-02: with the crop at output resolution the drift advanced
  // in 2px snaps at irregular frames, x and y on different frames. Integer,
  // chroma-even crop coordinates against ~0.3px/frame of intended motion.
  // Supersampling is what makes the coordinate grid finer than the motion; if
  // the upscale ever moves after the crop it buys nothing at all.
  const { filter } = buildSlideFilter({ stateCount: 4, hold: 1.5 });
  const tail = filter.slice(filter.lastIndexOf("xfade="));
  const up   = tail.indexOf("scale=");
  const crop = tail.indexOf("crop=");
  const down = tail.indexOf("scale=", crop);
  assert.ok(up > -1 && crop > up, "the upscale must precede the crop");
  assert.ok(down > crop, "the downscale back to output must follow the crop");
  assert.match(tail, /scale=\d+:\d+:flags=lanczos[\s\S]*crop=[\s\S]*scale=1920:1080:flags=lanczos/,
    "both rescales must be lanczos — bilinear softens Anton at 340px visibly");
});

test("the supersampled crop domain is an integer multiple of the output", () => {
  const { filter } = buildSlideFilter({ stateCount: 2, hold: 1.5 });
  const m = filter.match(/crop=(\d+):(\d+):/);
  assert.ok(m, "expected a crop in the graph");
  const [w, h] = [Number(m[1]), Number(m[2])];
  assert.equal(w % 1920, 0, `crop width ${w} must be a whole multiple of 1920`);
  assert.equal(h % 1080, 0, `crop height ${h} must be a whole multiple of 1080`);
  assert.ok(w / 1920 >= 4, "2x was MEASURED insufficient — median returned to 0.000px with snap ratio 3759");
});

test("a single-state slide still gets drift and a valid graph", () => {
  const { filter, totalDuration } = buildSlideFilter({ stateCount: 1, hold: 2 });
  assert.ok(!filter.includes("xfade="));
  assert.match(filter, /crop=\d+:\d+:x=/, "the drift crop must still be present with one state");
  assert.match(filter, /scale=1920:1080:flags=lanczos,setsar=1\[out\]$/, "and must still land back at output size");
  assert.equal(totalDuration, 2);
});

test("xfade offsets accumulate on the combined timeline", () => {
  const hold = 2, xf = 0.35;
  const { filter, totalDuration } = buildSlideFilter({ stateCount: 3, hold, crossfade: xf });
  const offsets = [...filter.matchAll(/offset=([\d.]+)/g)].map(m => Number(m[1]));
  assert.deepEqual(offsets, [
    Number((hold - xf).toFixed(3)),
    Number((2 * hold - xf - xf).toFixed(3)),
  ]);
  assert.ok(Math.abs(totalDuration - (3 * hold - 2 * xf)) < 0.001);
});

test("the output is square-pixel — setsar after the crop", () => {
  const { filter } = buildSlideFilter({ stateCount: 2, hold: 1 });
  assert.match(filter, /crop=[^[]*setsar=1\[out\]/,
    "cropping an overscanned frame perturbs SAR unless it is reset");
});

test("the encode is pinned, not inherited", async () => {
  // The demo came out at 129 kbps, which is a CONSEQUENCE of static dark
  // frames rather than a setting — it would move the moment card content
  // changes. Pinning makes quality a decision.
  const src = readFileSync(new URL("./videoAssembler.js", import.meta.url), "utf8");
  for (const flag of ["-preset", "-crf", "-pix_fmt", "-profile:v", "-level", "-g"]) {
    assert.ok(src.includes(`"${flag}"`), `encode must pin ${flag} explicitly`);
  }
  assert.match(src, /crf:\s*process\.env\.VIDEO_X264_CRF\s*\|\|\s*"18"/);
  assert.match(src, /pixFmt:\s*"yuv420p"/);
});

test("concat re-muxes rather than re-encoding", async () => {
  // A second encode pass would compound quantisation on top of the pinned crf
  // and quietly undo the pin.
  const src = readFileSync(new URL("./videoAssembler.js", import.meta.url), "utf8");
  const concat = src.slice(src.indexOf("export async function concatSlides"));
  assert.match(concat, /"-c",\s*"copy"/, "concat must stream-copy");
});
