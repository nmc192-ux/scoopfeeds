/**
 * videoContrast.test.js — the floors, measured rather than asserted.
 *
 * WHAT THIS FILE IS FOR. The palette drifted dark until the receded state sat
 * at 2.2:1 and the slide counter at 1.7:1, and nothing noticed, because nothing
 * ever computed a ratio. A house rule written in a comment is a preference; a
 * house rule a suite computes is a floor. So this walks EVERY card type in BOTH
 * aspect ratios across BOTH video systems — the automated shorts
 * (videoSlideRenderer / videoSlideRendererVertical) and the long-form engine
 * (longform/engine/render.mjs) — and fails on the first text token under its
 * floor. Not a sample: the card-type lists are read off the renderers
 * themselves, so a new card type with no fixture here fails rather than
 * silently skipping.
 *
 * HOW THE BACKGROUND IS DETERMINED. Not by averaging pixels in a text bounding
 * box — that is how you measure a 40px stroke against 3000px of ground and get
 * 1.14:1 for lime on near-black. It walks the satori tree the renderers hand to
 * the rasteriser and composites each node's own background down to the card's
 * declared ground, carrying CSS `opacity` and `rgba()` alpha through as it
 * goes. That is the background the rasteriser will actually paint, arrived at
 * from the same source of truth it uses.
 *
 * GRADIENTS ARE EVALUATED, NOT WAVED AT. The vertical over-photo cards back
 * their type with `linear-gradient` scrims, and a scrim is the whole reason
 * that type is legible. The alpha is interpolated at the text's own y, and an
 * unrecognised gradient form THROWS rather than being skipped — a scrim nobody
 * can evaluate is a scrim nobody has checked.
 *
 * THE ONE THING IT CANNOT GATE, stated rather than hidden: text painted
 * directly on an underlaid photograph with no backing of its own. For any fixed
 * colour there is a photograph that renders it at 1:1, so no floor is
 * achievable. `UNBACKED_OVER_PHOTO` names exactly which tokens are in that
 * position (today: the masthead and slide counter on `photo` and `map` cards),
 * the test proves the list is complete by failing on any OTHER unbacked node,
 * and those tokens are still gated against the ink ground they were designed
 * for. Giving them chips is a design change, not a colour one.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { INK, FLOORS, NON_TEXT_MIN, over, ratio, parseColor, contrastRatio } from "./videoContrast.js";
import { COLORS } from "./videoSlideChrome.js";
import { statesForCard, renderState, _internals } from "./videoSlideRenderer.js";
import { _verticalInternals } from "./videoSlideRendererVertical.js";
import { buildSlideFilter } from "./videoAssembler.js";
import { C as FILM, CARD_TYPES, _cardTree } from "./longform/engine/render.mjs";
import { FIXTURES, docFixture } from "./longform/engine/_contrastFixtures.mjs";

// ─── Which tier each token is held to ───────────────────────────────────────
//
// Keyed by hex so the classification cannot drift from the palette: a token
// whose value changes without a decision about its tier lands here as unknown
// and fails.
const TIER = new Map([
  [COLORS.white, "active"],
  [COLORS.lime, "active"],
  [COLORS.sub, "active"],
  [COLORS.dim, "chrome"],
  [COLORS.faint, "chrome"],
  [COLORS.counter, "chrome"],
  [COLORS.recededText, "dimmed"],
  [COLORS.recededFigure, "dimmed"],
  // Long-form only. `alert` is a claim ("this post has since been deleted") and
  // is held to the active floor like any other claim on screen.
  [FILM.alert, "active"],
]);
const floorFor = (tier) => FLOORS[tier === "active" ? "active" : tier === "dimmed" ? "dimmed" : "chrome"];

/** Tokens that are painted straight onto an underlaid photograph. See header. */
const UNBACKED_OVER_PHOTO = new Set([COLORS.faint, COLORS.counter]);

// ─── Tree walk ──────────────────────────────────────────────────────────────

const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN);

/**
 * Interpolated alpha of a `linear-gradient(180deg, <rgba> <pct>, ...)` at a
 * fraction `f` down its own box. Any other gradient form throws.
 */
function gradientAlphaAt(image, f) {
  const m = String(image).match(/^linear-gradient\(\s*180deg\s*,\s*(.+)\)$/i);
  if (!m) {
    // A radial spotlight has no single y — take its STRONGEST stop as if it
    // covered the box. For light type on a dark ground that is the worst case,
    // so it can only make the test stricter.
    const radial = String(image).match(/^radial-gradient\(/i);
    if (radial) {
      const alphas = [...String(image).matchAll(/rgba?\([^)]*?,\s*([\d.]+)\s*\)/g)].map((x) => +x[1]);
      if (!alphas.length) throw new Error(`videoContrast.test: cannot read stops from ${image}`);
      return { alpha: Math.max(...alphas), color: String(image).match(/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+/)[0] + ",1)" };
    }
    throw new Error(
      `videoContrast.test: unrecognised backgroundImage "${image}". ` +
      `A backing nobody can evaluate is a backing nobody has checked — teach this walker about it.`
    );
  }
  const stops = [...m[1].matchAll(/(rgba?\([^)]*\))\s+([\d.]+)%/g)]
    .map((s) => ({ color: s[1], a: parseColor(s[1]).a, at: +s[2] / 100 }));
  if (stops.length < 2) throw new Error(`videoContrast.test: need >=2 stops in "${image}"`);
  const t = Math.min(1, Math.max(0, f));
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].at && t <= stops[i + 1].at) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const span = hi.at - lo.at;
  const k = span <= 0 ? 0 : (t - lo.at) / span;
  return { alpha: lo.a + (hi.a - lo.a) * k, color: lo.color.replace(/,\s*[\d.]+\s*\)$/, ",1)") };
}

/**
 * Collect every text node with the background it is actually painted on.
 *
 * TWO KINDS OF BACKING, and the second is the one that matters.
 *
 *   ANCESTOR — a chip: the text is a child of the box that darkens it. Carried
 *   down the walk as `bg`, composited node by node.
 *
 *   SIBLING — a scrim: `overScrim` and `kineticBacking` are absolutely
 *   positioned boxes painted BEFORE the display type, at the same level. They
 *   are not ancestors of anything. An earlier version of this walker only
 *   handled ancestors and reported the kinetic phrase as unbacked type on a bare
 *   photograph, which is precisely the false negative that makes a contrast
 *   check worthless. So absolutely-positioned backings are collected per level
 *   in PAINT ORDER, and a text node picks up every one that precedes it and
 *   whose box contains its y.
 *
 * Gradient alpha is interpolated at the text's own y within the backing's box —
 * a scrim that ramps 0 -> 0.97 gives very different protection at its top edge
 * than at its bottom, and taking either end as "the" alpha would be a guess.
 */
function collectText(node, { bg, opacity = 1, y = null, scrims = [], out = [], where }) {
  if (!node || typeof node !== "object") return out;
  const style = node.props?.style || {};
  const op = opacity * (style.opacity === undefined ? 1 : Number(style.opacity));

  const top = num(style.top);
  const myY = Number.isFinite(top) ? top : y;

  // This node's own (ancestor) background, composited onto what is behind it.
  let myBg = bg;
  const flat = style.background || style.backgroundColor;
  if (flat && /^(#|rgb)/.test(String(flat))) myBg = over(flat, bg, op);

  const kids = node.props?.children;

  // A leaf carrying a colour is type. The chrome helper wraps its string in a
  // <span>, so the colour sits one level above the string — either shape counts.
  const isTextNode = style.color !== undefined &&
    (typeof kids === "string" || (kids && !Array.isArray(kids) && kids.type === "span") ||
     (Array.isArray(kids) && kids.length > 0 && kids.every((k) => k && k.type === "span")));

  if (isTextNode) {
    let painted = myBg;
    let backed = painted !== bg;
    for (const s of scrims) {
      if (!s.height || myY === null) continue;
      const f = (myY - s.top) / s.height;
      if (f < 0 || f > 1) continue;                     // the text is outside this scrim
      const { alpha, color } = gradientAlphaAt(s.image, f);
      if (alpha <= 0) continue;                         // at this y the scrim does nothing
      painted = over(color, painted, alpha * s.op);
      backed = true;
    }
    out.push({
      where, color: String(style.color).toLowerCase(), opacity: op, bg: painted, hasBacking: backed,
      label: typeof kids === "string" ? kids : (kids?.props?.children ?? kids?.[0]?.props?.children ?? ""),
    });
    return out;
  }

  // Descend, accumulating absolutely-positioned backings as they are painted.
  const list = Array.isArray(kids) ? kids : kids && typeof kids === "object" ? [kids] : [];
  const here = [...scrims];
  for (const k of list) {
    const ks = k?.props?.style || {};
    collectText(k, { bg: myBg, opacity: op, y: myY, scrims: here, out, where });
    if (ks.backgroundImage && ks.position === "absolute") {
      here.push({ image: ks.backgroundImage, top: num(ks.top) || 0, height: num(ks.height) || 0,
        op: op * (ks.opacity === undefined ? 1 : Number(ks.opacity)) });
    }
  }
  return out;
}

/**
 * Assert every text node in one card's final state.
 *
 * `groundIsPhoto` renders the underlay's worst case. For light type the worst
 * photograph is a white one; for dark type it is black. Both are checked, and a
 * token must clear its floor on whichever is worse for it.
 */
function assertCard(tree, where, { over: isOver = false } = {}) {
  const grounds = isOver ? ["#ffffff", "#000000"] : [INK];
  const seen = [];
  for (const ground of grounds) {
    for (const t of collectText(tree, { bg: ground, where })) {
      const tier = TIER.get(t.color);
      assert.ok(tier,
        `${where}: text colour ${t.color} ("${String(t.label).slice(0, 30)}") is not a palette token. ` +
        `Inline hexes are how the slide counter reached 1.71:1 — add it to COLORS with a tier.`);

      if (isOver && !t.hasBacking) {
        assert.ok(UNBACKED_OVER_PHOTO.has(t.color.toLowerCase()),
          `${where}: "${String(t.label).slice(0, 30)}" (${t.color}) is painted straight onto the ` +
          `photograph with no scrim or chip. No fixed colour can meet a floor there — give it a ` +
          `backing, or add it to UNBACKED_OVER_PHOTO with a reason.`);
        continue;   // gated against ink below, with the rest of the palette
      }

      // The composited ink of the glyph itself: opacity applies to the type too.
      const fg = over(t.color, t.bg, t.opacity);
      const r = ratio(fg, t.bg);
      const floor = floorFor(tier);
      assert.ok(r >= floor,
        `${where}: "${String(t.label).slice(0, 34)}" is ${r}:1 against its rendered background ` +
        `${t.bg} — the ${tier} floor is ${floor}:1. (token ${t.color}` +
        `${t.opacity < 1 ? ` at ${t.opacity} opacity` : ""})`);
      seen.push({ ...t, r, tier });
    }
  }
  assert.ok(seen.length > 0, `${where}: no measurable text at all — the fixture rendered nothing`);
  return seen;
}

// ─── The palette ladder ─────────────────────────────────────────────────────

test("every text token clears its floor against the ink ground", () => {
  const rows = [];
  for (const [hex, tier] of TIER) {
    const r = ratio(hex, INK);
    rows.push(`${String(hex).padEnd(9)} ${tier.padEnd(7)} ${String(r).padStart(6)}:1`);
    assert.ok(r >= floorFor(tier), `${hex} (${tier}) is ${r}:1 against ${INK} — floor ${floorFor(tier)}:1`);
  }
  assert.equal(rows.length, TIER.size, "a token was added or removed without a tier");
  assert.equal(TIER.size, 9, "the tier table changed size — was that a decision?");
});

test("the content ladder is ordered, and recession survives the lift", () => {
  const r = (k) => ratio(COLORS[k], INK);
  // ONE LADDER PER AXIS. This originally asserted `recededText < faint`, which
  // ranked receded CONTENT below the MASTHEAD. That was wrong, and it acted as
  // a false ceiling holding the receded tokens down: a row the viewer may be
  // reading has no business being quieter than standing furniture. The ceiling
  // for a receded label is the live-label tier it must not out-shout.
  assert.ok(r("recededFigure") < r("recededText"), "a receded figure is quieter than its label");
  assert.ok(r("recededText") < r("dim"), "a receded label must not out-shout a live one");
  assert.ok(r("dim") < r("sub"), "a label is quieter than body text");
  assert.ok(r("sub") < r("white"), "body text is quieter than display type");
  // Chrome is its own axis and only has to be internally ordered.
  assert.ok(r("counter") < r("faint"), "the counter is the quietest thing in the frame");
  // THE POINT OF RECESSION, and the thing a lift could quietly destroy: the
  // live row must still dominate. Kept as a ratio-of-ratios rather than an
  // absolute, so it holds whatever the range is next moved to.
  const dominance = r("lime") / r("recededText");
  assert.ok(dominance > 2.5,
    `an active row is only ${dominance.toFixed(1)}x a receded one — the recession has flattened`);
  // And a real gap under the live-label tier, so "receded" is still a state
  // rather than a slightly different grey.
  assert.ok(r("dim") / r("recededText") > 1.3,
    `receded sits only ${(r("dim") / r("recededText")).toFixed(2)}x under a live label`);
});

test("structural marks are lifted too, at their own weaker floor", () => {
  for (const k of ["recededFill", "track", "rule"]) {
    assert.ok(parseColor(COLORS[k]).a === 1, `${k} must be opaque`);
  }
  assert.ok(ratio(COLORS.recededFill, INK) >= NON_TEXT_MIN,
    `recededFill is ${ratio(COLORS.recededFill, INK)}:1 — a receded bar has to be visible`);
  assert.ok(ratio(COLORS.recededFill, INK) < ratio(COLORS.recededText, INK),
    "a receded fill must stay quieter than the label above it");
});

test("the receded tokens stay near-neutral, not a dimmed accent", () => {
  // Restated from videoSlideRenderer.test.js because the values moved: lime at
  // an alpha composites to #3e3f06 and reads as a rendering fault. These sit on
  // the ground's warm-neutral axis.
  for (const k of ["recededText", "recededFigure", "recededFill"]) {
    const { r, g, b } = parseColor(COLORS[k]);
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 24,
      `${k} (${COLORS[k]}) has a ${Math.max(r, g, b) - Math.min(r, g, b)} channel spread — that is a hue, not a neutral`);
    assert.ok(r >= g && g >= b, `${k} must stay on the ground's warm axis (r >= g >= b)`);
  }
});

// ─── The shorts: every card type, both aspect ratios ────────────────────────

const SHORT_CARDS = {
  title: { t: "title", lines: [["KENTUCKY GOBLINS", "white"], ["ON THE PORCH", "lime"]],
    sub: "The 1955 Hopkinsville encounter, and what the record shows.", eyebrow: "HORROR ADAPTATION", source: "AP" },
  stat: { t: "stat", value: "11", unit: "HOURS", label: "The siege the family described", eyebrow: "THE NUMBER", source: "AP" },
  bars: { t: "bars", bars: [["1955 ENCOUNTER", 11], ["FROGMAN", 6], ["KENTUCKY GOBLINS", 14]], hi: 2, eyebrow: "THE RECORD", source: "AP" },
  diagram: { t: "diagram", nodes: [["SIGHTING", "Two men, one farmhouse"], ["SIEGE", "Shots at the treeline"], ["REPORT", "Logged at 11pm"]],
    marker: { on: 2, label: "THE RECORD" }, eyebrow: "THE SEQUENCE" },
  turn: { t: "turn", lines: [["THE REAL EVENT", "white"], ["WAS THE PANIC", "lime"]],
    sub: "No physical evidence was ever recovered.", eyebrow: "THE TURN" },
  kicker: { t: "kicker", top: "WHAT SURVIVES", bottom: "IS THE TELLING", sub: "The real event." },
  photo: { t: "photo", lines: [["THE FARMHOUSE", "white"], ["TODAY", "lime"]], phrase: "STILL STANDING", eyebrow: "ON SITE" },
  map: { t: "map", lines: [["HOPKINSVILLE", "white"], ["KENTUCKY", "lime"]], phrase: "SEVEN MILES OUT", eyebrow: "WHERE" },
};

const CTX = (t) => ({
  slideIndex: 2, slideCount: 6, outlet: "AP", imageCredit: "AP", imageDate: "AUG 1955", cardType: t,
});

test("16:9 — every card type meets the floors on every state", () => {
  const types = Object.keys(_internals.BUILDERS);
  assert.ok(types.length >= 6, "the 16:9 builder list shrank");
  let measured = 0;
  for (const t of types) {
    assert.ok(SHORT_CARDS[t], `no fixture for 16:9 card type "${t}" — add one rather than skipping it`);
    const states = statesForCard(SHORT_CARDS[t], { ...CTX(t), orientation: "horizontal" });
    states.forEach((st, i) => { measured += assertCard(st.tree, `16:9 ${t} state ${i} (${st.key})`).length; });
  }
  assert.ok(measured > 40, `only ${measured} text tokens measured across 16:9 — that is not every card type`);
});

test("9:16 — every card type meets the floors on every state", () => {
  const types = Object.keys(_verticalInternals.BUILDERS_V ?? {});
  assert.ok(types.length >= 8, "the 9:16 builder list shrank");
  let measured = 0;
  for (const t of types) {
    assert.ok(SHORT_CARDS[t], `no fixture for 9:16 card type "${t}" — add one rather than skipping it`);
    const states = statesForCard(SHORT_CARDS[t], { ...CTX(t), orientation: "vertical" });
    states.forEach((st, i) => {
      const isOver = st.tree?.props?.style?.background === undefined;
      measured += assertCard(st.tree, `9:16 ${t} state ${i} (${st.key})`, { over: isOver }).length;
    });
  }
  assert.ok(measured > 50, `only ${measured} text tokens measured across 9:16 — that is not every card type`);
});

// ─── The long-form engine: every card type ──────────────────────────────────

test("long-form 16:9 — every card type meets the floors at the held frame", () => {
  let measured = 0;
  for (const t of CARD_TYPES) {
    const spec = t === "doc" ? docFixture() : FIXTURES[t];
    assert.ok(spec, `no fixture for long-form card type "${t}" — add one rather than skipping it`);
    // p=1 is the HELD frame: the one a viewer actually reads. Every entrance
    // ramp lands at opacity 1 there, so this measures the shipped state.
    measured += assertCard(_cardTree(spec, 1), `longform ${t}`).length;
  }
  assert.ok(measured > 40, `only ${measured} text tokens measured across long-form`);
});

// ─── The ground is flat: grain is gone, and stays gone ──────────────────────

test("no render path emits a grain node", () => {
  for (const opts of [
    { stateCount: 3, hold: 2 },
    { stateCount: 3, hold: 2, orientation: "vertical" },
    { stateCount: 4, hold: 2, caption: "drawtext=CAPTION" },
    { stateCount: 3, hold: 2, underlay: true },
    { stateCount: 3, hold: 2, cutaway: { inputIndex: 3, seconds: 2, credit: "drawtext=CREDIT" } },
    { stateCount: 3, hold: 2, cutaway: { inputIndex: 3, seconds: 2, credit: null, frame: { x: 40, y: 300, w: 1000, h: 562 } } },
  ]) {
    const { filter } = buildSlideFilter(opts);
    assert.ok(!/\bnoise=/.test(filter),
      `a grain node came back in the graph for ${JSON.stringify(opts)}:\n${filter}`);
  }
  // And no env var can put one back.
  const src = readFileSync(new URL("./videoAssembler.js", import.meta.url), "utf8");
  assert.ok(!/VIDEO_GRAIN_STRENGTH/.test(src), "the grain flag must be gone, not merely defaulted to 0");
});

test("a rendered card's ground is EXACTLY flat — zero variance, not 'low'", async () => {
  const { Resvg } = await import("@resvg/resvg-js");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "contrast-"));
  const states = statesForCard(SHORT_CARDS.stat, { ...CTX("stat"), orientation: "vertical" });
  const png = await renderState(states[states.length - 1], { orientation: "vertical" });
  const file = path.join(tmp, "state.png");
  writeFileSync(file, png);

  // Decode through resvg (already a dependency — no new one for a PNG reader):
  // wrap the frame in an SVG of its own size and take the raw RGBA back out.
  const W = 1080, H = 1920;
  const shot = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<image href="data:image/png;base64,${readFileSync(file).toString("base64")}" ` +
    `x="0" y="0" width="${W}" height="${H}"/></svg>`,
    { fitTo: { mode: "width", value: W } }
  ).render();
  const pixels = shot.pixels;

  // A band no card layout paints on: the strip just above the reserved bottom
  // edge, full width.
  //
  // PER CHANNEL, not pooled. Pooling R, G and B reports a stdev of 1.25 on a
  // perfectly flat #090706 — that is the spread BETWEEN the channels, which is
  // the colour of the ground, not texture on it. A pooled figure would have
  // masked any real grain below that floor.
  const y0 = Math.round(H * 0.86), y1 = Math.round(H * 0.90);
  const ch = [[], [], []];
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      ch[0].push(pixels[i]); ch[1].push(pixels[i + 1]); ch[2].push(pixels[i + 2]);
    }
  }
  const ink = [parseColor(INK).r, parseColor(INK).g, parseColor(INK).b];
  ch.forEach((vals, k) => {
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    // The published frame that started this measured a per-pixel stdev of ~10.
    // A flat ground is 0. Not "small" — zero: any texture at all is the paper
    // grain coming back, whether from a filter node or from a card layer.
    assert.equal(sd, 0, `channel ${"rgb"[k]} varies by ${sd.toFixed(2)} per pixel across ${vals.length} px — something is texturing the ground`);
    assert.equal(mean, ink[k], `channel ${"rgb"[k]} of the ground is ${mean}, not the ink's ${ink[k]}`);
  });
});

// ─── The measured ladder, printed ───────────────────────────────────────────

test("report: the ladder, as measured", () => {
  const lines = [...TIER].map(([hex, tier]) => {
    const name = Object.keys(COLORS).find((k) => COLORS[k] === hex)
      ?? Object.keys(FILM).find((k) => FILM[k] === hex);
    return `  ${name.padEnd(14)} ${hex}  ${String(ratio(hex, INK)).padStart(6)}:1   ${tier} (floor ${floorFor(tier)})`;
  });
  console.log(`\nWCAG ratios against ${INK}:\n${lines.join("\n")}\n`);
  assert.ok(contrastRatio(COLORS.white, INK) > 15);
});
