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
import path from "node:path";
import {
  statesForCard, fitStatesToDuration, videoDesignKey, VIDEO_DESIGN_VER,
  CANVAS, MARGIN_X, RESERVED_BOTTOM_Y, DRIFT_SAFE_X, DRIFT_SAFE_Y, LAYOUT_Y, COLORS,
} from "./videoSlideRenderer.js";
import { buildSlideFilter } from "./videoAssembler.js";

const ctx = { outlet: "Reuters", slideIndex: 2, slideCount: 7 };

const CARDS = {
  title:       { t: "title", eyebrow: "SUBSEA", lines: [["THE CABLES", "white"], ["CARRY EVERYTHING", "lime"]], sub: "s", caption: "c" },
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

test("the chrome carries NO lime at all — the accent rule is gone", () => {
  // The dimmed progress line was chrome's one lime element; it read as a stray
  // line across the frame and was deleted (DrJ, 2026-08-30). The opening state
  // is chrome plus eyebrow only, so lime of ANY strength appearing here means
  // the rule (or a successor) has crept back into every frame.
  const s1 = statesForCard(CARDS.title, ctx)[0];
  assert.equal(limeCount(s1.tree), 0, "opening state should carry no content lime");
  assert.ok(!styles(s1.tree).some(s => String(s.background).includes("221,231,6")),
    "no chrome element may carry the lime hue at any alpha");
});

// ─── Drift-safe geometry// ─── Drift-safe geometry ────────────────────────────────────────────────────

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

test("the FINAL state survives a short slide — collapse takes middle states", async () => {
  // States are cumulative, so the last one is the complete composition. Plain
  // end-backwards collapse cost the bars card its SOURCE CREDIT and the
  // diagram card its MARKER on a 7-slide measurement — content, not pacing.
  const { logger } = await import("./logger.js");
  const states = statesForCard(CARDS.stat, ctx);
  const lines = [];
  const prevInfo = logger.info.bind(logger);
  const prevWarn = logger.warn.bind(logger);
  logger.info = (m) => { lines.push(String(m)); };
  logger.warn = (m) => { lines.push(String(m)); };
  let kept;
  try { kept = fitStatesToDuration(states, 2.0, { cardType: "stat", slideIndex: 4 }); }
  finally { logger.info = prevInfo; logger.warn = prevWarn; }

  assert.ok(kept.length < states.length, "a 2s slide must drop something");
  assert.equal(kept[kept.length - 1].key, states[states.length - 1].key,
    "the final state must survive");
  assert.ok(kept[kept.length - 1].credit, "and it is the one carrying the source credit");
  assert.ok(lines.some(l => /final state preserved/.test(l)), lines.join(" | "));
});

test("only a slide too short for TWO states can lose the credit, and it warns", async () => {
  const { logger } = await import("./logger.js");
  const states = statesForCard(CARDS.stat, ctx);
  const lines = [];
  const prevWarn = logger.warn.bind(logger);
  const prevInfo = logger.info.bind(logger);
  logger.warn = (m) => { lines.push(String(m)); };
  logger.info = () => {};
  try { fitStatesToDuration(states, 0.9, { cardType: "stat", slideIndex: 4 }); }
  finally { logger.warn = prevWarn; logger.info = prevInfo; }
  assert.ok(lines.some(l => /COLLAPSED THE SOURCE-CREDIT STATE/.test(l)),
    `expected a loud credit-collapse warning, got: ${lines.join(" | ") || "(nothing)"}`);
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
  return withDrift(() => {
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
});

test("the supersampled crop domain is an integer multiple of the output", () => {
  return withDrift(() => {
  const { filter } = buildSlideFilter({ stateCount: 2, hold: 1.5 });
  const m = filter.match(/crop=(\d+):(\d+):/);
  assert.ok(m, "expected a crop in the graph");
  const [w, h] = [Number(m[1]), Number(m[2])];
  assert.equal(w % 1920, 0, `crop width ${w} must be a whole multiple of 1920`);
  assert.equal(h % 1080, 0, `crop height ${h} must be a whole multiple of 1080`);
  assert.ok(w / 1920 >= 4, "2x was MEASURED insufficient — median returned to 0.000px with snap ratio 3759");
});
});

test("a single-state slide still gets drift and a valid graph", () => {
  return withDrift(() => {
  const { filter, totalDuration } = buildSlideFilter({ stateCount: 1, hold: 2 });
  assert.ok(!filter.includes("xfade="));
  assert.match(filter, /crop=\d+:\d+:x=/, "the drift crop must still be present with one state");
  // The film grain node used to ride after setsar, so this allowed a tail.
  // Grain is gone (2026-09-03) and the chain ends at setsar again — asserted
  // exactly, because "something may follow" is how a texture node got in.
  assert.match(filter, /scale=1920:1080:flags=lanczos,setsar=1\[out\]$/,
    "and must still land back at output size, with nothing after it");
  assert.equal(totalDuration, 2);
});
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

// ─── Constant-rate drift (ruling 2026-08-02) ────────────────────────────────

// ─── Drift is OFF by default (DrJ, 2026-08-12) ──────────────────────────────
//
// The tests below exercise the drift MECHANISM, which still has to work if the
// flag is ever turned back on — so each one enables it explicitly. The static
// default has its own tests, further down, which assert EXACTLY zero motion
// rather than "under the criterion": at zero the old <=0.5px assertion passes
// vacuously and would keep passing if the pan came back at 0.4px/frame.
// ASYNC, and every caller returns it. A synchronous version hands the promise
// back and restores the flag in `finally` before the body has run — the drift
// is then already off by the time the assertions execute, which fails as a null
// regex match rather than as anything that names the real cause.
async function withDrift(fn) {
  const saved = process.env.VIDEO_SLIDE_DRIFT_ENABLED;
  process.env.VIDEO_SLIDE_DRIFT_ENABLED = "1";
  try { return await fn(); }
  finally {
    if (saved === undefined) delete process.env.VIDEO_SLIDE_DRIFT_ENABLED;
    else process.env.VIDEO_SLIDE_DRIFT_ENABLED = saved;
  }
}

const travelOf = (filter) => {
  const x = filter.match(/crop=\d+:\d+:x='(\d+)\+(\d+)\*/);
  const y = filter.match(/:y='(\d+)\+(\d+)\*/);
  return { dx: Number(x[2]), dy: Number(y[2]), padX: Number(x[1]), padY: Number(y[1]) };
};

test("per-frame displacement is INVARIANT to slide duration", async () => {
  return withDrift(async () => {
  // Fixed amplitude made this a function of duration — 0.24px/frame at 6.1s
  // but past 0.5px below ~3.5s. Section 5 derives durations from audio, so
  // short captions would have pushed the drift back over the criterion that
  // the supersampling had just brought it under.
  const { FPS, SUPERSAMPLE } = await import("./videoAssembler.js");
  // Bounded by the overscan cap, which bites at ~7.3s (6px/s x 7.3s = the
  // 43.9px diagonal of a 2% overscan). Past that the travel stops growing and
  // px/frame FALLS — asserted separately, since slower is always acceptable.
  const perFrame = [];
  for (const dur of [1.5, 2, 3, 4.95, 6.1, 7.0]) {
    const { filter, totalDuration } = buildSlideFilter({ stateCount: 3, hold: (dur + 2 * 0.35) / 3 });
    const { dx, dy } = travelOf(filter);
    perFrame.push(Math.hypot(dx, dy) / SUPERSAMPLE() / (totalDuration * FPS));
  }
  const spread = Math.max(...perFrame) - Math.min(...perFrame);
  assert.ok(spread < 0.01, `per-frame displacement varies by ${spread.toFixed(4)}px across durations: ${perFrame.map(v => v.toFixed(3))}`);
  for (const v of perFrame) {
    assert.ok(v <= 0.5, `${v.toFixed(3)} px/frame exceeds the 0.5px criterion`);
  }
});
});

test("a long slide drifts SLOWER than the rate, never faster", async () => {
  return withDrift(async () => {
  // Past the overscan cap the travel stops growing, so px/frame can only fall.
  // The criterion is a ceiling; this must sit under it from both directions.
  const { FPS, SUPERSAMPLE } = await import("./videoAssembler.js");
  const { filter, totalDuration } = buildSlideFilter({ stateCount: 3, hold: 8 });
  const { dx, dy } = travelOf(filter);
  const perFrame = Math.hypot(dx, dy) / SUPERSAMPLE() / (totalDuration * FPS);
  assert.ok(perFrame < 0.24, `expected the cap to slow a long slide, got ${perFrame.toFixed(3)} px/frame`);
});
});

test("travel never exceeds the overscan, so the crop stays inside the frame", () => {
  return withDrift(() => {
  for (const hold of [0.8, 2, 5, 20]) {
    const { filter } = buildSlideFilter({ stateCount: 3, hold });
    const { dx, dy, padX, padY } = travelOf(filter);
    // scale is 1958*SS x 1102*SS, crop 1920*SS x 1080*SS → 38*SS x 22*SS spare
    assert.ok(dx + padX <= 38 * 4 + 1, `x travel ${dx} + pad ${padX} overruns the overscan`);
    assert.ok(dy + padY <= 22 * 4 + 1, `y travel ${dy} + pad ${padY} overruns the overscan`);
  }
});
});

// ─── Captions (§5) ──────────────────────────────────────────────────────────

test("captions burn AFTER the drift, so they never move under the eye", async () => {
  return withDrift(async () => {
  const { buildSlideFilter } = await import("./videoAssembler.js");
  const { filter } = buildSlideFilter({ stateCount: 3, hold: 1.5, caption: "drawtext=fontfile='/f':textfile='/t'" });
  const crop = filter.lastIndexOf("crop=");
  const draw = filter.indexOf("drawtext=");
  assert.ok(draw > crop, "a caption drawn before the crop would drift with the composition");
  assert.match(filter, /scale=1920:1080:flags=lanczos,setsar=1,drawtext=/,
    "and must come after the downscale so it is not resampled");
});
});

test("caption wrapping is MEASURED, not predicted from character count", async () => {
  const { wrapCaption, CAPTION } = await import("./videoAssembler.js");
  const { measureTextWidth } = await import("./renderCore.js");
  const long = "The Guardian reports that seventy percent of recorded subsea cable faults are caused by ships dragging their anchors across shallow coastal approaches.";
  const lines = await wrapCaption(long);
  for (const line of lines) {
    const w = await measureTextWidth(line, { fontSize: CAPTION.fontSize });
    assert.ok(w <= CAPTION.maxWidth, `line measures ${w}px, over the ${CAPTION.maxWidth}px measure: "${line}"`);
  }
  assert.equal((await wrapCaption("")).length, 0);
});

test("the measurement is calibrated against drawtext, not assumed equal to it", async () => {
  const { DRAWTEXT_WIDTH_RATIO } = await import("./renderCore.js");
  // satori measured 2.0-2.7% NARROWER than drawtext across three real captions.
  // Under-measuring wraps too late and overflows, so the correction must be
  // upward and must cover the observed spread.
  assert.ok(DRAWTEXT_WIDTH_RATIO > 1.027, `${DRAWTEXT_WIDTH_RATIO} does not cover the measured 2.7% bias`);
  assert.ok(DRAWTEXT_WIDTH_RATIO < 1.15, "an over-correction wastes line width for nothing");
});

test("the caption band sits inside the drift-safe area", async () => {
  const { CAPTION } = await import("./videoAssembler.js");
  assert.ok(CAPTION.bottomY <= CANVAS.h - DRIFT_SAFE_Y,
    `caption bottom ${CAPTION.bottomY} is inside the ${DRIFT_SAFE_Y}px drift margin`);
  assert.ok(CAPTION.bottomY - CAPTION.maxLines * CAPTION.lineHeight >= RESERVED_BOTTOM_Y - 60,
    "the caption block should live in the bottom band, not up in the card content");
});

test("one drawtext PER LINE — a single multi-line one left-aligns the rest", async () => {
  const { buildCaptionFilter } = await import("./videoAssembler.js");
  const { mkdtempSync } = await import("node:fs");
  const os2 = await import("node:os");
  const dir = mkdtempSync(path.join(os2.tmpdir(), "capfilter-"));
  const f = await buildCaptionFilter({
    text: "The Guardian reports that seventy percent of recorded subsea cable faults are caused by ships dragging anchors.",
    workDir: dir, slideIndex: 0, fontFile: "/tmp/Inter.otf",
  });
  assert.ok((f.match(/drawtext=/g) || []).length >= 2, "a two-line caption needs two centred drawtexts");
  assert.ok(f.includes("x=(w-text_w)/2"), "each line centres on its own width");
});

test("audio duration drives the hold, exactly", async () => {
  const { holdForAudio, SLIDE_TAIL_SECS, CROSSFADE_SECS } = await import("./videoAssembler.js");
  for (const [audio, n] of [[4.2, 5], [2.6, 3], [9.1, 6]]) {
    const hold = holdForAudio(audio, n);
    const total = n * hold - (n - 1) * CROSSFADE_SECS;
    assert.ok(Math.abs(total - (audio + SLIDE_TAIL_SECS)) < 0.001,
      `${n} states over ${audio}s audio produced a ${total}s slide`);
  }
});

// ─── Vertical display-type auto-fit ─────────────────────────────────────────
//
// EARNED 2026-08-14, from a live YouTube Short: the stat figure "14,000"
// rendered with its last glyph clipped at the right frame edge. Vertical is
// 1080 wide against 16:9's 1920, and the figure size was a fixed 400px carried
// over from a frame with 792px more measure.
//
// These assert on MEASURED WIDTH rather than on rendered pixels: the metrics
// table in videoSlideChrome is itself derived from renders (see its header), so
// re-rendering here would test satori rather than the fit. The rendered-ink
// verification is the ground harness's job and its numbers are in the commit.

const { antonWidth, fitDisplaySize, ANTON_ADV } = await import("./videoSlideChrome.js");
const { geometryFor } = await import("./videoGeometry.js");
const VG = geometryFor("vertical");
const HG = geometryFor("horizontal");

/** Widest ink any state of this card puts on screen, from the tree itself. */
function widestAntonInTree(node, acc = []) {
  const st = node?.props?.style;
  if (st?.fontFamily === "Anton" && typeof st.fontSize === "number") {
    const s = node.props.children?.[0]?.props?.children;
    if (s != null) acc.push({ text: String(s), size: st.fontSize, ls: st.letterSpacing || 0 });
  }
  for (const c of node?.props?.children || []) if (c) widestAntonInTree(c, acc);
  return acc;
}

test("Anton digits are NOT tabular — which is why the fix is width-driven", () => {
  // A digit-COUNT step would have been wrong: same length, 17 units apart.
  assert.equal(ANTON_ADV["1"], 33);
  assert.equal(ANTON_ADV["4"], 50);
  assert.ok(antonWidth("11,111", 400) < antonWidth("44,444", 400) - 100,
    "at display size the two are >100px apart despite identical character counts");
});

test("THE REPORTED CASE: 14,000 fits the vertical measure after the fit", () => {
  const card = { t: "stat", eyebrow: "F", value: "14,000", lines: ["a", "b"], hi: 1, source: "R", caption: "c" };
  const states = statesForCard(card, { outlet: "R", slideIndex: 2, slideCount: 7, orientation: "vertical" });
  for (const st of states) {
    for (const run of widestAntonInTree(st.tree)) {
      assert.ok(antonWidth(run.text, run.size, run.ls) <= VG.contentW,
        `"${run.text}" at ${run.size}px is ${Math.round(antonWidth(run.text, run.size, run.ls))}px against a ${VG.contentW}px measure`);
    }
  }
});

test("every plausible figure, with and without a unit, holds the measure", () => {
  const ctx = { outlet: "R", slideIndex: 2, slideCount: 7, orientation: "vertical" };
  for (const unit of [null, "%", "bn"]) {
    for (const value of ["7", "70", "700", "7,000", "14,000", "44,444", "140,000", "1,400,000", "12,345,678"]) {
      const card = { t: "stat", eyebrow: "F", value, unit, lines: ["a", "b"], hi: 1, source: "R", caption: "c" };
      for (const st of statesForCard(card, ctx)) {
        // The value box is a ROW of value + unit, so the runs are summed, not maxed.
        const runs = widestAntonInTree(st.tree).filter(r => r.text === value || r.text === unit);
        const total = runs.reduce((s, r) => s + antonWidth(r.text, r.size, r.ls), 0) + (unit ? 12 : 0);
        assert.ok(total <= VG.contentW, `${value}${unit || ""} → ${Math.round(total)}px > ${VG.contentW}px`);
      }
    }
  }
});

test("the unit keeps its 37.5% ratio to the figure when the figure shrinks", () => {
  // Holding the unit at 150 while the figure shrank would invert the hierarchy
  // on exactly the cards where the number matters most.
  const ctx = { outlet: "R", slideIndex: 2, slideCount: 7, orientation: "vertical" };
  const card = { t: "stat", eyebrow: "F", value: "12,345,678", unit: "%", lines: ["a"], hi: 0, source: "R", caption: "c" };
  const st = statesForCard(card, ctx).find(s => s.key === "s2");
  const runs = widestAntonInTree(st.tree);
  const val = runs.find(r => r.text === "12,345,678");
  const un = runs.find(r => r.text === "%");
  assert.ok(val.size < 400, "this figure must have been fitted down");
  assert.equal(un.size, Math.round(val.size * 150 / 400));
});

test("both title lines get ONE size, decided by the wider line", () => {
  const ctx = { outlet: "R", slideIndex: 1, slideCount: 7, orientation: "vertical" };
  const card = { t: "title", eyebrow: "B",
    lines: [["COUNTERTERRORISMINVESTIGATION", "white"], ["SHORT", "lime"]], sub: "s", date: "AUG 14", caption: "c" };
  const st = statesForCard(card, ctx).find(s => s.key === "s3");
  const sizes = new Set(widestAntonInTree(st.tree)
    .filter(r => r.text.includes("COUNTER") || r.text === "SHORT").map(r => r.size));
  assert.equal(sizes.size, 1, "two headline lines at different sizes read as a mistake, not typography");
  for (const r of widestAntonInTree(st.tree)) {
    assert.ok(antonWidth(r.text, r.size, r.ls) <= VG.contentW, `"${r.text}" overflows`);
  }
});

test("a word that fits is NOT shrunk — the fit is a ceiling, not a policy", () => {
  const ctx = { outlet: "R", slideIndex: 1, slideCount: 7, orientation: "vertical" };
  const card = { t: "title", eyebrow: "B", lines: [["CABLE", "white"], ["CUT", "lime"]], sub: "s", date: "AUG 14", caption: "c" };
  const st = statesForCard(card, ctx).find(s => s.key === "s3");
  // 104 -> 148 with defect 6 (DrJ, 2026-08-30): phrases fill the width, so the
  // nominal a short headline renders at rose. The pinned value tracks it.
  assert.equal(widestAntonInTree(st.tree).find(r => r.text === "CABLE").size, 148,
    "short headlines must render at the shipped nominal size");
});

test("16:9 IS NOT TOUCHED — it keeps its fixed sizes and its wider measure", () => {
  // The horizontal layout was never overflowing: the same figures end at
  // 833-1500px against an 1824px measure. Fitting it too would have changed a
  // render that is proven byte-identical, for no defect.
  const ctx = { outlet: "R", slideIndex: 2, slideCount: 7 };   // no orientation → horizontal
  const card = { t: "stat", eyebrow: "F", value: "1,400,000", unit: "%", lines: ["a", "b"], hi: 1, source: "R", caption: "c" };
  const runs = widestAntonInTree(statesForCard(card, ctx).find(s => s.key === "s2").tree);
  // 340/120, not vertical's 400/150 — the two layouts have always had their own
  // display scale, which is the point: this is a fork, not a shared constant.
  assert.equal(runs.find(r => r.text === "1,400,000").size, 340, "horizontal keeps its fixed 340px figure");
  assert.equal(runs.find(r => r.text === "%").size, 120, "and its fixed 120px unit");
  const total = runs.reduce((s, r) => s + antonWidth(r.text, r.size, r.ls), 0) + 12;
  assert.ok(total <= HG.contentW, "which is fine, because 1728px of measure holds it");
});

test("fitDisplaySize reports overflow instead of truncating at the floor", () => {
  // No silent caps. If even the floor does not fit, the caller logs and renders
  // the figure WHOLE — a clipped number is a wrong number.
  const r = fitDisplaySize((size) => size * 100, { nominalSize: 400, maxWidth: 10, minSize: 200 });
  assert.equal(r.size, 200);
  assert.ok(r.fitted);
  assert.equal(r.overflow, 200 * 100 - 10);
  const ok = fitDisplaySize((size) => size, { nominalSize: 400, maxWidth: 1000, minSize: 200 });
  assert.deepEqual(ok, { size: 400, fitted: false, overflow: 0 });
});

// ─── B1: the ground is declared, never assumed ──────────────────────────────
//
// root() used to take children alone and always paint the near-black base. That
// implicit choice was invisible and therefore repeatedly wrong — across the
// collage prototypes it buried a photo under an opaque layer twice and produced
// a card with no ground at all once. Three debugging sessions, one unstated
// assumption. These make the assumption a contract.

const { GROUND, groundOf, makePrimitives } = await import("./videoSlideChrome.js");
const { renderState } = await import("./videoSlideRenderer.js");
const { VERTICAL } = await import("./videoGeometry.js");

test("every shipped card declares its ground, in both frames", () => {
  const ctx = { outlet: "Reuters", slideIndex: 2, slideCount: 7 };
  const cards = {
    title:   { t:"title", eyebrow:"B", lines:[["A","white"],["B","lime"]], sub:"s", date:"AUG 15", caption:"c" },
    stat:    { t:"stat", eyebrow:"F", value:70, unit:"%", lines:["a","b"], hi:1, source:"R", caption:"c" },
    bars:    { t:"bars", eyebrow:"C", bars:[["a",70],["b",18]], source:"R", caption:"c" },
    diagram: { t:"diagram", eyebrow:"H", nodes:[["A","x"],["B","y"]], marker:{on:1,label:"M"}, caption:"c" },
    turn:    { t:"turn", eyebrow:"BUT", lines:[["X","white"],["Y","lime"]], caption:"c" },
    kicker:  { t:"kicker", top:"A", bottom:"B", sub:"s", caption:"c" },
  };
  for (const orientation of ["horizontal", "vertical"]) {
    for (const [name, card] of Object.entries(cards)) {
      for (const st of statesForCard(card, { ...ctx, orientation })) {
        assert.equal(st.ground, GROUND.INK,
          `${orientation}/${name}/${st.key} must declare a ground — got ${JSON.stringify(st.ground)}`);
      }
    }
  }
});

test("root() REFUSES an unstated or unknown ground", () => {
  const { root } = makePrimitives(VERTICAL);
  for (const bad of [undefined, null, "", "black", "paper", true, 1]) {
    assert.throws(() => root(bad, []), /needs an explicit ground/,
      `root(${JSON.stringify(bad)}) must throw`);
  }
  assert.doesNotThrow(() => root(GROUND.INK, []));
  assert.doesNotThrow(() => root(GROUND.OVER, []));
});

test("GROUND.OVER paints NOTHING — that is the whole point of it", () => {
  // A transparent card is what lets a photo, a mount or a map sit behind the
  // type. If OVER ever starts painting a background it buries them silently,
  // which is precisely the failure this vocabulary exists to prevent.
  const { root } = makePrimitives(VERTICAL);
  assert.equal(root(GROUND.OVER, []).props.style.background, undefined);
  assert.ok(root(GROUND.INK, []).props.style.background, "INK must still paint one");
});

test("renderState refuses a tree that never declared a ground", async () => {
  // The contract has to bite at the point of rendering too: a tree assembled by
  // hand, bypassing root(), is a card where nobody decided what is behind it.
  const naked = { key: "hand-rolled", tree: { type: "div", props: { style: { display: "flex" }, children: [] } } };
  await assert.rejects(() => renderState(naked, { orientation: "vertical" }),
    /has no declared ground/);
});

test("the marker is invisible to satori — it is a symbol, not a prop", () => {
  const { root } = makePrimitives(VERTICAL);
  const tree = root(GROUND.INK, []);
  assert.equal(groundOf(tree), GROUND.INK);
  assert.ok(!Object.keys(tree).includes("ground"), "no enumerable key that satori could trip on");
  assert.deepEqual(Object.keys(tree).sort(), ["props", "type"]);
});

// ─── B5: emphasis — recession, spotlight, growth ────────────────────────────

const { gestureBudget } = await import("./videoSlideChrome.js");

// `styles()` is the walker already defined at the top of this file — reused
// rather than redeclared; the existing one also handles child ARRAYS, which a
// second copy here did not.
const barsCard = { t: "bars", eyebrow: "CAUSE",
  bars: [["anchors", 70], ["gear", 18], ["natural", 9]], source: "Reuters", caption: "c" };
const vctx = { outlet: "Reuters", slideIndex: 2, slideCount: 7, orientation: "vertical" };

test("THE RECEDED COLOURS ARE CHOSEN, NOT A DIMMED ACCENT", () => {
  // DrJ, 2026-08-15: "make sure the muted context colour is a real choice, not
  // just an opacity drop on the accent." Measured rather than asserted in prose:
  // lime at 25% over the ground composites to #3e3f06 — saturation 0.90, lime's
  // own hue, which reads as a colour that failed to render. These are neutral.
  const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const sat = (h) => { const [r, g, b] = hex(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
  const over = (fg, bg, a) => "#" + hex(fg).map((c, i) => Math.round(a * c + (1 - a) * hex(bg)[i]).toString(16).padStart(2, "0")).join("");

  const dimmedLime = over(COLORS.lime, COLORS.base, 0.25);
  assert.ok(sat(dimmedLime) > 0.8, `the comparison must be a saturated olive, got ${dimmedLime}`);
  for (const key of ["recededText", "recededFigure", "recededFill"]) {
    assert.ok(sat(COLORS[key]) < 0.35,
      `${key} (${COLORS[key]}) has saturation ${sat(COLORS[key]).toFixed(2)} — that is a dimmed accent, not a chosen neutral`);
  }
});

test("only the entry being discussed is in colour", () => {
  const states = statesForCard(barsCard, vctx);
  const mid = states.find(s => s.key === "bar2");
  const fills = styles(mid.tree).map(st => st.background).filter(Boolean);
  assert.ok(fills.includes(COLORS.lime), "the active entry keeps the accent");
  assert.ok(fills.includes(COLORS.recededFill), "an earlier entry must have receded");
  assert.ok(!fills.includes(COLORS.track),
    "COLORS.track was the old undifferentiated fill — nothing should still use it here");
});

test("a newly revealed bar ENTERS SHORT and is full width in the next state", () => {
  // The growth costs no extra states: a bar that is 34% in one cumulative state
  // and 100% in the next grows across the crossfade that was already happening.
  const states = statesForCard(barsCard, vctx);
  const widthOfFirstBar = (key) => {
    const st = states.find(s => s.key === key);
    // the fills sit at the bar's own row; take the widest non-track box on it
    return Math.max(...styles(st.tree)
      .filter(s => s.height === 46 && s.background && s.background !== "#151310")
      .map(s => s.width));
  };
  const entering = widthOfFirstBar("bar1");
  const settled = widthOfFirstBar("bar2");
  assert.ok(entering < settled, `bar1 should enter short: ${entering} vs ${settled}`);
  assert.ok(entering / settled < 0.5, `entry width should be a clear step, got ${(entering / settled).toFixed(2)}`);
});

test("the spotlight is a soft radial lift, and only on the active row", () => {
  const states = statesForCard(barsCard, vctx);
  const mid = states.find(s => s.key === "bar2");
  const glows = styles(mid.tree).filter(s => /radial-gradient/.test(s.backgroundImage || ""));
  assert.equal(glows.length, 1, "exactly one row may be spotlit");
  assert.ok(!("borderRadius" in glows[0]) && !glows[0].border,
    "a soft lift, not a container the design does not otherwise have");
});

test("the FINAL state returns to the card's point — every bar, lead in colour", () => {
  // It is also the frame that survives every collapse, so it must be the whole
  // card rather than whatever the last reveal happened to emphasise.
  const states = statesForCard(barsCard, vctx);
  const last = states[states.length - 1];
  const fills = styles(last.tree).map(s => s.background).filter(Boolean);
  assert.equal(fills.filter(f => f === COLORS.lime).length, 1, "exactly one entry in the accent");
  assert.ok(fills.filter(f => f === COLORS.recededFill).length >= 2, "the rest receded");
});

test("the diagram's unmarked nodes recede too", () => {
  const card = { t: "diagram", eyebrow: "HOW",
    nodes: [["SHIP", "a"], ["SHELF", "b"], ["CABLE", "c"]], marker: { on: 2, label: "BREAK" }, caption: "c" };
  const last = statesForCard(card, vctx).slice(-1)[0];
  const colours = styles(last.tree).flatMap(s => [s.background, s.color]).filter(Boolean);
  assert.ok(colours.includes(COLORS.recededFill) || colours.includes(COLORS.recededText),
    "the rail should use the same recession vocabulary as the bars");
});

// ─── B7: one gesture per frame ──────────────────────────────────────────────

test("a second gesture in one frame THROWS, naming both", () => {
  const g = gestureBudget("stat/s4");
  assert.equal(g("circle: round the figure", "MARK"), "MARK");
  assert.throws(() => g("block: behind a word", "X"), (e) =>
    /ONE GESTURE PER FRAME/.test(e.message) &&
    /circle: round the figure/.test(e.message) &&
    /block: behind a word/.test(e.message) &&
    /stat\/s4/.test(e.message));
});

test("a gesture must be NAMED — an unlabelled one cannot be reported", () => {
  for (const bad of ["", "   ", null, undefined, 7]) {
    assert.throws(() => gestureBudget("f")(bad, "X"), /must be NAMED/);
  }
});

test("budgets are per frame, not global", () => {
  const a = gestureBudget("one"), b = gestureBudget("two");
  a("tilt: photo", 1);
  assert.doesNotThrow(() => b("tilt: photo", 1), "a second frame gets its own budget");
});

test("the shipped cards spend NO gestures — emphasis is not a gesture", () => {
  // Colour, weight, scale, the spotlight and recession are how the design speaks
  // normally. If ordinary emphasis started spending the budget, the photo mounts
  // would arrive with nothing left to spend.
  const g = gestureBudget("bars/credit");
  statesForCard(barsCard, vctx);
  assert.equal(g.spent(), null);
});

// ─── B3: the ground contract's first real users ─────────────────────────────

test("a GROUND.OVER state rasterises TRANSPARENT, not black", async () => {
  // THE BUG THIS CAUGHT, on the first end-to-end render: renderState passed
  // `background: C.base` unconditionally, so a transparent card came out as a
  // black rectangle and buried the mount composited behind it. The contract
  // knew the answer; the last step was still assuming one. Measured on real
  // pixels rather than on the call's arguments.
  const { Resvg } = await import("@resvg/resvg-js");
  const card = { t: "photo", eyebrow: "WHO", lines: [["A", "white"], ["B", "lime"]], caption: "c" };
  const [first] = statesForCard(card, { outlet: "R", slideIndex: 1, slideCount: 5, orientation: "vertical" });
  const png = await renderState(first, { orientation: "vertical" });

  // Composite the state over a MAGENTA field. If the card is opaque, none of it
  // shows through; if it is transparent, most of the frame is magenta.
  const raw = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">` +
    `<rect width="1080" height="1920" fill="#ff00ff"/>` +
    `<image href="data:image/png;base64,${png.toString("base64")}" width="1080" height="1920"/></svg>`,
    { fitTo: { mode: "original" } }).render().pixels;
  let magenta = 0;
  for (let i = 0; i < raw.length; i += 4) {
    if (raw[i] > 200 && raw[i + 1] < 60 && raw[i + 2] > 200) magenta++;
  }
  const share = magenta / (raw.length / 4);
  assert.ok(share > 0.5,
    `only ${(share * 100).toFixed(1)}% of the frame showed through — a GROUND.OVER card must be transparent`);
});

test("an INK state is still fully opaque", () => {
  // The other half: nothing about the OVER path may make ordinary cards
  // transparent, or every existing slide would composite onto whatever is behind.
  const [first] = statesForCard(
    { t: "stat", eyebrow: "F", value: 70, unit: "%", lines: ["a", "b"], hi: 1, source: "R", caption: "c" },
    { outlet: "R", slideIndex: 1, slideCount: 5, orientation: "vertical" });
  assert.equal(first.ground, "ink");
  assert.equal(first.tree.props.style.background, COLORS.base);
});

test("subject-visual states name the image they need behind them", () => {
  const ctx = { outlet: "R", slideIndex: 1, slideCount: 5, orientation: "vertical" };
  for (const [card, want] of [
    [{ t: "photo", lines: [["A", "white"]], caption: "c" }, "photo"],
    [{ t: "map", codes: ["DZA"], lines: [["A", "white"]], caption: "c" }, "map"],
  ]) {
    for (const st of statesForCard(card, ctx)) {
      assert.equal(st.ground, "over", "the image goes behind, so the card paints no ground");
      assert.equal(st.underlay, want, "the assembler needs to know WHICH image");
    }
  }
});

test("16:9 has no subject-visual layout, so it degrades and says so", () => {
  // Losing an entire video over one card whose WORDS render perfectly would be
  // the wrong trade. The imagery is a 9:16 composition; the type survives.
  const st = statesForCard({ t: "photo", eyebrow: "W", lines: [["A", "white"], ["B", "lime"]], caption: "c" },
    { outlet: "R", slideIndex: 1, slideCount: 5 });
  assert.ok(st.length >= 3, "it still renders");
  assert.equal(st[0].ground, "ink", "and paints its own ground, since nothing is composited behind it");
});
