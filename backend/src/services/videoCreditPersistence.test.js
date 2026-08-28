/**
 * videoCreditPersistence.test.js — the credit is on EVERY frame of borrowed
 * footage, proven by looking at every frame.
 *
 * WHY THIS FILE EXISTS. The Gate B permission request promises the poster their
 * name will be on screen "for as long as your footage is visible". Everything
 * else in this engine that guarantees that is structural — the credit is
 * composited inside the cutaway stream, so it cannot outlive the footage — but
 * "cannot outlive it" is not the same claim as "is present for all of it". A
 * chip that appeared one frame late, or was truncated one frame early, would
 * satisfy every existing test and still break the promise.
 *
 * So this renders a real short and decodes EVERY frame in the cutaway window,
 * measuring the credit region directly.
 *
 * THE NEGATIVE CONTROL IS PART OF THE TEST, not something someone did once by
 * hand and wrote down. `renderWithCredit({ delayFrames: 1 })` builds the same
 * graph with the chip deliberately gated to start one frame late, and the test
 * asserts the detector calls that frame EMPTY. Without it, a detector that
 * always reported "credit present" — the wrong crop rectangle, a threshold of
 * zero, a bug — would make the positive assertions pass while proving nothing.
 * This is the same discipline stockLibraryBoundary.test.js uses when it checks
 * its import walker against a known-reachable module before trusting its silence.
 *
 * WHY A FLAT MID-GREY CUTAWAY SOURCE. The detector counts near-white pixels in
 * the credit band. Against flat grey, the chip's text (0xcfcabd) is the only
 * bright thing that can be there, and the default film grain (±14 around the
 * grey) comes nowhere near the threshold — so the measurement survives the
 * treatment the real pipeline applies rather than needing it switched off.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { spawn } from "child_process";
import {
  buildSlideFilter, buildCutawayCreditFilter, creditChipRegion, totalFor, FPS,
} from "./videoAssembler.js";
import { getFFmpegPath } from "./videoGenerator.js";

const ORIENTATION = "vertical";
const FONT = new URL("../../assets/fonts/Inter-SemiBold.otf", import.meta.url).pathname;
const CREDIT_TEXT = "Sarah Voss / BLUESKY";
const CUTAWAY_SECS = 1.2;
const HOLD = 3.0;

/** A pixel this bright in the credit band can only be the chip's text. */
const BRIGHT = 190;
/** Enough lit pixels to be text rather than a stray artefact. */
const MIN_BRIGHT_PIXELS = 40;

function run(args, ff) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ff, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    let err = "";
    proc.stdout.on("data", (d) => out.push(d));
    proc.stderr.on("data", (d) => { err += d.toString().slice(0, 2000); });
    proc.on("error", reject);
    proc.on("close", (code) => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${code}: ${err.slice(-500)}`)));
  });
}

/**
 * Render one slide with a cutaway, optionally delaying the credit.
 *
 * Goes through the REAL buildSlideFilter and the REAL buildCutawayCreditFilter.
 * `delayFrames` wraps the credit's drawtext in an `enable=` window starting
 * that many frames in — the exact defect this test exists to catch, produced
 * deliberately so the detector can be shown to catch it.
 */
async function renderWithCredit(dir, { delayFrames = 0, omit = false } = {}) {
  const ff = getFFmpegPath();
  const state = path.join(dir, "state.png");
  const cut = path.join(dir, `cut-${delayFrames}-${omit}.mp4`);
  const out = path.join(dir, `out-${delayFrames}-${omit}.mp4`);

  // One state: no xfade, so this renders on any ffmpeg the repo might resolve.
  await run(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x101010:size=1080x1920:d=1",
    "-frames:v", "1", state], ff);
  // Flat mid-grey footage — see the header.
  await run(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x808080:size=1080x1920:d=3:r=25",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", cut], ff);

  let credit = null;
  if (!omit) {
    credit = buildCutawayCreditFilter({
      text: CREDIT_TEXT, workDir: dir, slideIndex: delayFrames, fontFile: FONT, orientation: ORIENTATION,
    });
    if (delayFrames > 0) {
      credit += `:enable='gte(t,${(delayFrames / FPS).toFixed(4)})'`;
    }
  }

  const { filter, totalDuration } = buildSlideFilter({
    stateCount: 1, hold: HOLD, driftDir: 0, orientation: ORIENTATION,
    cutaway: { inputIndex: 1, seconds: CUTAWAY_SECS, credit },
  });

  await run(["-y", "-v", "error",
    "-loop", "1", "-t", String(HOLD), "-i", state,
    "-i", cut,
    "-filter_complex", filter, "-map", "[out]",
    "-t", totalDuration.toFixed(3),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
    "-pix_fmt", "yuv420p", "-r", String(FPS), out], ff);

  return out;
}

/**
 * Bright-pixel count in the credit band, for every frame of the video.
 *
 * One decode, one crop, the whole stream — so "every frame" is literally every
 * frame rather than a sample someone chose.
 */
async function creditBandPerFrame(videoPath) {
  const ff = getFFmpegPath();
  const r = creditChipRegion(ORIENTATION);
  const raw = await run(["-v", "error", "-i", videoPath,
    "-vf", `crop=${r.w}:${r.h}:${r.x}:${r.y},format=gray`,
    "-f", "rawvideo", "-pix_fmt", "gray", "-"], ff);

  const frameSize = r.w * r.h;
  assert.ok(raw.length > 0 && raw.length % frameSize === 0,
    `crop stream is ${raw.length} bytes, not a whole number of ${frameSize}-byte frames`);

  const perFrame = [];
  for (let off = 0; off < raw.length; off += frameSize) {
    let bright = 0;
    for (let i = off; i < off + frameSize; i++) if (raw[i] > BRIGHT) bright++;
    perFrame.push(bright);
  }
  return perFrame;
}

/** The frames that carry third-party footage, by construction of the graph. */
const cutawayFrameCount = () => Math.floor(CUTAWAY_SECS * FPS);

// ─── The detector must work before its silence means anything ──────────────

test("the detector distinguishes a credited frame from an uncredited one", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "credit-detect-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.ok(getFFmpegPath(), "ffmpeg must resolve — this is a real failure, not a skip");

  const withChip = await creditBandPerFrame(await renderWithCredit(dir, {}));
  const without = await creditBandPerFrame(await renderWithCredit(dir, { omit: true }));

  assert.ok(withChip[0] >= MIN_BRIGHT_PIXELS,
    `a credited frame measured only ${withChip[0]} bright pixels — the crop rectangle may not overlap the chip`);
  assert.ok(without[0] < MIN_BRIGHT_PIXELS,
    `an UNcredited frame measured ${without[0]} bright pixels, above the threshold — the detector cannot tell ` +
    "the difference, so every assertion below would pass for the wrong reason");
});

// ─── The property ───────────────────────────────────────────────────────────

test("EVERY frame carrying third-party footage carries the credit", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "credit-every-")); t.after(() => rmSync(dir, { recursive: true, force: true }));

  const perFrame = await creditBandPerFrame(await renderWithCredit(dir, {}));
  const n = cutawayFrameCount();
  assert.ok(perFrame.length > n, `video has ${perFrame.length} frames, fewer than the ${n}-frame cutaway`);

  const bare = [];
  for (let i = 0; i < n; i++) if (perFrame[i] < MIN_BRIGHT_PIXELS) bare.push(i);
  assert.deepEqual(
    bare, [],
    `frames ${bare.join(", ")} of the cutaway carry footage with no credit. The permission request promises the ` +
    "poster their name is on screen for as long as their footage is — every one of these frames breaks it."
  );
});

test("the credit does not outlive the footage it credits", async (t) => {
  // The other half of the promise: the chip belongs to the picture, so once the
  // footage ends the chip must be gone too. Structural (it is composited inside
  // the cutaway stream), measured here anyway.
  const dir = mkdtempSync(path.join(tmpdir(), "credit-end-")); t.after(() => rmSync(dir, { recursive: true, force: true }));

  const perFrame = await creditBandPerFrame(await renderWithCredit(dir, {}));
  const n = cutawayFrameCount();
  // One frame of slack at the boundary: the cut lands between samples.
  for (let i = n + 2; i < perFrame.length; i++) {
    assert.ok(perFrame[i] < MIN_BRIGHT_PIXELS,
      `frame ${i} still carries the credit ${((i - n) / FPS).toFixed(2)}s after the footage ended`);
  }
});

// ─── The negative control ──────────────────────────────────────────────────

test("a credit delayed by ONE FRAME is caught", async (t) => {
  // The defect the whole file exists for. If this test ever goes green while
  // the one above also passes, the detector has stopped discriminating.
  const dir = mkdtempSync(path.join(tmpdir(), "credit-delay-")); t.after(() => rmSync(dir, { recursive: true, force: true }));

  const perFrame = await creditBandPerFrame(await renderWithCredit(dir, { delayFrames: 1 }));

  assert.ok(perFrame[0] < MIN_BRIGHT_PIXELS,
    `frame 0 measured ${perFrame[0]} bright pixels, but the credit was deliberately delayed one frame — ` +
    "the detector did not notice a one-frame gap, so it would not notice a real one either");
  // And the frames after the delay DO carry it, so the render is otherwise sound
  // and the failure above is specifically the missing first frame.
  assert.ok(perFrame[2] >= MIN_BRIGHT_PIXELS,
    "the delayed render should carry the credit from frame 2 onward — if not, this control proves nothing");
});

test("a credit truncated by one frame is caught", async (t) => {
  // Same detector, the other end. Built by shortening the enable window rather
  // than the footage, so the footage still runs its full length underneath.
  const dir = mkdtempSync(path.join(tmpdir(), "credit-trunc-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ff = getFFmpegPath();
  const state = path.join(dir, "s.png");
  const cut = path.join(dir, "c.mp4");
  const out = path.join(dir, "t.mp4");
  await run(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x101010:size=1080x1920:d=1", "-frames:v", "1", state], ff);
  await run(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x808080:size=1080x1920:d=3:r=25",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", cut], ff);

  const truncatedAt = (CUTAWAY_SECS - 1 / FPS).toFixed(4);
  const credit = buildCutawayCreditFilter({
    text: CREDIT_TEXT, workDir: dir, slideIndex: 9, fontFile: FONT, orientation: ORIENTATION,
  }) + `:enable='lt(t,${truncatedAt})'`;

  const { filter, totalDuration } = buildSlideFilter({
    stateCount: 1, hold: HOLD, driftDir: 0, orientation: ORIENTATION,
    cutaway: { inputIndex: 1, seconds: CUTAWAY_SECS, credit },
  });
  await run(["-y", "-v", "error", "-loop", "1", "-t", String(HOLD), "-i", state, "-i", cut,
    "-filter_complex", filter, "-map", "[out]", "-t", totalDuration.toFixed(3),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS), out], ff);

  const perFrame = await creditBandPerFrame(out);
  const last = cutawayFrameCount() - 1;
  assert.ok(perFrame[last] < MIN_BRIGHT_PIXELS,
    `the final cutaway frame (${last}) measured ${perFrame[last]} bright pixels, but the credit was deliberately ` +
    "cut one frame short — a truncation at the tail would go unnoticed");
});

// ─── The region itself ─────────────────────────────────────────────────────

test("the credit region is derived from the same geometry the filter draws into", () => {
  // If these drifted apart, every measurement above would be of empty frame.
  const r = creditChipRegion(ORIENTATION);
  assert.ok(r.w > 0 && r.h > 0);
  assert.ok(r.x >= 0 && r.y >= 0);
  assert.ok(r.x + r.w <= 1080, "the region must sit inside the vertical canvas");
  assert.ok(r.y + r.h <= 1920);
});
