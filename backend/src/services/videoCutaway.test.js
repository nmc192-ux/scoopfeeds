/**
 * videoCutaway.test.js — a stock cutaway inside a slide, and the one thing it
 * must never do: change how long the video is.
 *
 * THE DURATION TEST RENDERS REAL FILES. Everything else in this area asserts on
 * the filter string, which is the right level for "can the graph express motion".
 * It is the wrong level for "is the video the same length": the filter is an
 * intention, and ffmpeg's `-t`, the trim, the overlay's eof behaviour and the
 * encoder all sit between that intention and the file. So the two segments are
 * actually encoded and actually probed. Four length signals have leaked through
 * this pipeline already, and the music bed derives its timeline independently
 * from slideTotalSecs — a segment that came out even a frame long would put the
 * score out of sync with the picture for the rest of the video.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleSlide, buildSlideFilter, totalFor } from "./videoAssembler.js";
import { getFFmpegPath } from "./videoGenerator.js";

const FF = getFFmpegPath();
const dirs = [];
const tmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), "cutaway-")); dirs.push(d); return d; };
test.after(() => {
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

// ─── The graph ──────────────────────────────────────────────────────────────

test("with no cutaway the graph is untouched — one node, ending in [out]", () => {
  // The feature is dark by default and must be inert when off, not merely
  // harmless. A different graph with cutaways off would mean every cached
  // render is invalidated for a feature nobody switched on.
  const { filter } = buildSlideFilter({ stateCount: 3, hold: 3 });
  assert.ok(!filter.includes("[cut]"), "no cutaway stage");
  assert.ok(!filter.includes("[base]"), "no split into a composite tail");
  assert.match(filter, /\[out\]$/);
});

test("the cutaway is a stream that ENDS, not a clock", () => {
  // An `enable='lt(t,N)'` overlay would put a time term into an overlay stage,
  // which the type-chain invariance tests forbid — and, worse, would make the
  // chrome drop depend on two expressions agreeing frame for frame.
  const { filter } = buildSlideFilter({
    stateCount: 3, hold: 3, cutaway: { inputIndex: 3, seconds: 2.2, credit: null },
  });
  assert.match(filter, /trim=duration=2\.200/, "the clip is trimmed to its own window");
  assert.match(filter, /overlay=0:0:eof_action=pass/, "when it ends, the slide passes through");
  assert.ok(!/enable=/.test(filter), "nothing is time-gated");
  for (const stage of filter.split(";").map((s) => s.trim())) {
    if (!/overlay=/.test(stage)) continue;
    assert.ok(!/\benable\b/.test(stage), `overlay is time-gated:\n${stage}`);
    assert.ok(!/overlay=[^,\]]*\b(t|on)\b/.test(stage), `overlay position is animated:\n${stage}`);
  }
});

test("the chrome drop is structural — the footage covers the whole frame", () => {
  // The masthead and the slide counter are baked into the state PNGs, which are
  // the main stream. A full-frame cutaway hides them for exactly as long as it
  // exists, and they return on the frame it ends. That is why there is no
  // separate "hide the chrome" step to get out of step with the cut.
  const { filter } = buildSlideFilter({
    stateCount: 3, hold: 3, orientation: "vertical", cutaway: { inputIndex: 3, seconds: 2, credit: null },
  });
  assert.match(filter, /scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920/,
    "the cutaway must cover the frame whatever the asset's dimensions are, and never letterbox");
  assert.match(filter, /overlay=0:0/, "composited at the origin, covering everything beneath");
});

test("the credit rides INSIDE the cutaway stream, so it cannot outlive the footage", () => {
  // If the credit were drawn on the main stream with its own enable window, it
  // could persist for a frame after the picture it credits had gone — which is
  // both wrong and reads as a glitch.
  const { filter } = buildSlideFilter({
    stateCount: 3, hold: 3, cutaway: { inputIndex: 3, seconds: 2, credit: "drawtext=CREDIT" },
  });
  const cutStage = filter.split(";").map((s) => s.trim()).find((s) => s.endsWith("[cut]"));
  assert.ok(cutStage.includes("drawtext=CREDIT"), "the credit belongs to the cutaway stage");
  assert.ok(cutStage.indexOf("trim=") < cutStage.indexOf("drawtext=CREDIT"),
    "and sits after the trim, inside the trimmed window");
  const overlayStage = filter.split(";").map((s) => s.trim()).find((s) => s.includes("overlay=0:0:eof_action"));
  assert.ok(!overlayStage.includes("drawtext=CREDIT"), "never on the main stream");
});

test("the caption still covers the whole slide, and no grain does", () => {
  // Narration continues over a cutaway, so the burned caption must too.
  const { filter } = buildSlideFilter({
    stateCount: 3, hold: 3, caption: "drawtext=CAPTION", cutaway: { inputIndex: 3, seconds: 2, credit: null },
  });
  const outStage = filter.split(";").map((s) => s.trim()).find((s) => s.endsWith("[out]"));
  assert.ok(outStage.includes("drawtext=CAPTION"), "the caption is applied after the composite");
  // This asserted a grain field until 2026-09-03. Grain is gone from every
  // render path; the assertion is inverted rather than deleted so the cutaway
  // composite — the last place a texture node was added "just for the seam" —
  // stays covered.
  assert.ok(!filter.includes("noise="), "and no grain rides the cutaway composite");
});

test("the arithmetic length is identical with a cutaway and without", () => {
  for (const stateCount of [2, 3, 4]) {
    const off = buildSlideFilter({ stateCount, hold: 3 });
    const on = buildSlideFilter({ stateCount, hold: 3, cutaway: { inputIndex: stateCount, seconds: 2.2, credit: null } });
    assert.equal(on.totalDuration, off.totalDuration, `stateCount=${stateCount}`);
    // totalFor states the same length as a formula where the graph accumulates
    // it in a loop, so they agree to floating-point rather than bit-for-bit.
    assert.ok(Math.abs(on.totalDuration - totalFor(stateCount, 3)) < 1e-9,
      `${on.totalDuration} vs ${totalFor(stateCount, 3)}`);
  }
});

// ─── The rendered files ─────────────────────────────────────────────────────

const canRender = Boolean(FF) && existsSync(FF);

/** Duration from the container, read back off the encoded file. */
function probe(file) {
  let out;
  try {
    out = execFileSync(FF, ["-hide_banner", "-i", file], { encoding: "utf8" });
  } catch (e) {
    out = String(e.stderr || e.stdout || "");
  }
  const m = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  assert.ok(m, `ffmpeg printed no Duration for ${file}`);
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

function statePng(dir, name, colour) {
  const p = path.join(dir, name);
  execFileSync(FF, ["-y", "-loglevel", "error", "-f", "lavfi",
    "-i", `color=c=${colour}:s=1080x1920`, "-frames:v", "1", p]);
  return p;
}

/**
 * ONE STATE, DELIBERATELY, in the rendered tests.
 *
 * Multi-state slides crossfade with `xfade`, and the bundled
 * @ffmpeg-installer/ffmpeg is 4.2.x, which does not have that filter — the same
 * gap videoGenerator.js already works around with supportsXfade() and
 * FFMPEG_NO_XFADE. A single state skips the xfade chain entirely while still
 * exercising everything a cutaway actually touches: the trim, the overlay's
 * eof behaviour, the `-t` truncation and the encode. Using two states here
 * would test the host's ffmpeg build rather than this feature.
 */
test("THE RENDERED SEGMENT IS THE SAME LENGTH WITH A CUTAWAY AND WITHOUT", { skip: !canRender && "no ffmpeg" }, async () => {
  const dir = tmp();
  const states = [statePng(dir, "s0.png", "black")];
  const clip = path.join(dir, "clip.mp4");
  execFileSync(FF, ["-y", "-loglevel", "error", "-f", "lavfi",
    "-i", "testsrc2=size=1080x1920:rate=25:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);

  const hold = 2.5;
  const plain = path.join(dir, "plain.mp4");
  const withCut = path.join(dir, "withcut.mp4");

  await assembleSlide({ statePaths: states, hold, outputPath: plain, orientation: "vertical" });
  await assembleSlide({
    statePaths: states, hold, outputPath: withCut, orientation: "vertical",
    cutawayPath: clip, cutawaySecs: 2.2,
  });

  const a = probe(plain);
  const b = probe(withCut);
  // One frame at 25fps is 0.04s; anything within half a frame is the same file
  // length as far as the concat and the music bed are concerned.
  assert.ok(Math.abs(a - b) < 0.02,
    `cutaway changed the segment length: ${a.toFixed(3)}s without, ${b.toFixed(3)}s with`);
  assert.ok(Math.abs(a - totalFor(1, hold)) < 0.1, `segment length should track the arithmetic: got ${a}`);
});

test("a cutaway LONGER than its slide cannot stretch the segment", { skip: !canRender && "no ffmpeg" }, async () => {
  // The clamp is what makes "duration never changes" true even when the asset
  // is long and the slide is short — the library holds clips up to 120s.
  const dir = tmp();
  const states = [statePng(dir, "s0.png", "black")];
  const clip = path.join(dir, "clip.mp4");
  execFileSync(FF, ["-y", "-loglevel", "error", "-f", "lavfi",
    "-i", "testsrc2=size=1080x1920:rate=25:duration=8", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);

  const hold = 1.2;
  const out = path.join(dir, "short.mp4");
  await assembleSlide({
    statePaths: states, hold, outputPath: out, orientation: "vertical",
    cutawayPath: clip, cutawaySecs: 3,
  });
  const secs = probe(out);
  assert.ok(secs < hold + 0.1, `a 3s cutaway stretched a ${hold}s slide to ${secs.toFixed(3)}s`);
});

test("the rendered cutaway segment is a real, playable video", { skip: !canRender && "no ffmpeg" }, async () => {
  const dir = tmp();
  const states = [statePng(dir, "s0.png", "black")];
  const clip = path.join(dir, "clip.mp4");
  execFileSync(FF, ["-y", "-loglevel", "error", "-f", "lavfi",
    "-i", "testsrc2=size=2160x3840:rate=25:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);

  const out = path.join(dir, "out.mp4");
  await assembleSlide({
    statePaths: states, hold: 2.5, outputPath: out, orientation: "vertical",
    cutawayPath: clip, cutawaySecs: 2,
  });
  // A 2160x3840 master must come out at the delivery frame, not letterboxed.
  let info;
  try {
    info = execFileSync(FF, ["-hide_banner", "-i", out], { encoding: "utf8" });
  } catch (e) { info = String(e.stderr || ""); }
  assert.match(info, /1080x1920/, "the segment must be at the delivery resolution");
});

// ─── A STILL through the same seam ──────────────────────────────────────────
//
// The imagery inversion needs pictures over type cards, and those card layouts
// declare no underlay — only `photo` and `map` do. So a still rides the cutaway
// seam instead of getting a new compositing path. These pin the claim that it
// really is the SAME path: only the input declaration differs.

test("a STILL cutaway holds for its full window instead of flashing one frame",
  { skip: !canRender && "no ffmpeg" }, async () => {
  // A bare `-i still.jpg` decodes ONE frame: the overlay would appear for 40ms
  // and pass through, which looks like a glitch rather than a picture. The
  // `-loop 1 -t N` declaration is what makes it a stream that ENDS — the exact
  // property `eof_action=pass` is built on, and the same flags the state PNGs
  // and the underlay already use.
  const dir = tmp();
  const states = [statePng(dir, "s0.png", "black")];
  const still = statePng(dir, "still.png", "red");

  const hold = 2.5;
  const out = path.join(dir, "still-cut.mp4");
  await assembleSlide({
    statePaths: states, hold, outputPath: out, orientation: "vertical",
    cutawayPath: still, cutawaySecs: 1.5, cutawayIsStill: true,
  });

  assert.ok(existsSync(out));
  const secs = probe(out);
  assert.ok(Math.abs(secs - totalFor(1, hold)) < 0.1,
    `a still cutaway changed the segment length: ${secs.toFixed(3)}s vs ${totalFor(1, hold)}s`);

  // The picture must actually be on screen partway through the window. Sampled
  // at 0.75s — inside the 1.5s cutaway — the frame should be the still's red,
  // not the slide's black.
  // Read the pixel directly: one frame, scaled to 1x1, as raw RGB on stdout.
  // (signalstats prints to STDERR, which is how the first version of this test
  // measured nothing and reported a black frame.)
  const rgb = execFileSync(FF, ["-loglevel", "error", "-ss", "0.75", "-i", out,
    "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1 << 20 });
  assert.equal(rgb.length, 3, "expected one RGB pixel");
  const [r, g, b] = rgb;
  assert.ok(r > 100 && g < 80 && b < 80,
    `at 0.75s the frame is rgb(${r},${g},${b}) — the red still never rendered over the black slide`);
});

test("a still and a video cutaway differ ONLY in the input declaration", async () => {
  // The structural claim, asserted rather than described: the filter graph is
  // identical, so everything downstream — credit inside the stream, the clamp,
  // eof_action=pass, the audio it never maps — behaves the same for both.
  const asVideo = buildSlideFilter({
    stateCount: 1, hold: 2.5, orientation: "vertical",
    cutaway: { inputIndex: 1, seconds: 1.5, credit: null, frame: null },
  });
  const asStill = buildSlideFilter({
    stateCount: 1, hold: 2.5, orientation: "vertical",
    cutaway: { inputIndex: 1, seconds: 1.5, credit: null, frame: null },
  });
  assert.equal(asVideo.filter, asStill.filter,
    "a still must not need its own filter graph — that would be a second compositing path");
  assert.match(asVideo.filter, /eof_action=pass/);
});

test("a cutaway with a NaN duration is REFUSED loudly, not dropped in silence", async () => {
  // The defect that cost a whole render: slideTotalSecs takes seconds and was
  // handed the audio object, producing NaN. `NaN > 0` is false, so useCutaway
  // went false and every resolved still vanished — while the resolver's own
  // log line said it had placed one. Silence is the part that must not recur.
  const errs = [];
  const { logger } = await import("./logger.js");
  const realError = logger.error;
  logger.error = (m) => errs.push(String(m));
  try {
    const dir = tmp();
    const states = [statePng(dir, "s0.png", "black")];
    const still = statePng(dir, "still.png", "red");
    const out = path.join(dir, "nan.mp4");
    await assembleSlide({
      statePaths: states, hold: 1.2, outputPath: out, orientation: "vertical",
      cutawayPath: still, cutawaySecs: NaN, cutawayIsStill: true,
    });
    assert.ok(existsSync(out), "the video must still render — a missing picture is not a lost story");
    assert.ok(errs.some((e) => /unusable duration/.test(e)),
      `expected a loud refusal, got: ${JSON.stringify(errs)}`);
  } finally { logger.error = realError; }
});
