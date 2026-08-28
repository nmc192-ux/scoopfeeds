/**
 * NO MASTHEAD SUPPRESSION ON OUR OWN FOOTAGE (DrJ, Gate E), measured in pixels.
 *
 * The ruling: "suppressing our own branding over our own footage makes no sense,
 * so own-material renders with normal chrome." The mechanism that suppresses the
 * masthead is full-bleed compositing — the state PNG carries the masthead and a
 * frame-covering cutaway hides it for exactly as long as the cutaway exists. So
 * the ruling is really a statement about which lanes may be full-bleed, and the
 * only honest way to check it is to decode the frames and look.
 *
 * WHY THIS IS A SEPARATE FILE FROM videoCreditPersistence. That file asserts a
 * credit chip is PRESENT on every frame of borrowed footage. This one asserts our
 * masthead is present on own footage and ABSENT on granted footage. Same
 * mechanism, opposite directions, different lanes — and folding them together
 * would mean one `for` loop whose body had to branch on lane anyway.
 *
 * THE TEST IS TWO-DIRECTIONAL ON PURPOSE, and that is what stops it being
 * vacuous. A detector that reported "masthead present" unconditionally would pass
 * the owner assertion and fail the grant one; a detector that reported "absent"
 * unconditionally would do the reverse. Both lanes run through the same harness,
 * the same crop rectangle and the same threshold, so neither answer can be the
 * detector's own bias.
 *
 * A SYNTHETIC MASTHEAD, NOT THE REAL ONE. The card here is a flat dark plate with
 * a white bar drawn in the masthead slot, because the property under test is
 * "does the cutaway cover the chrome band", which does not depend on what the
 * chrome says. Rendering the real satori card would drag the whole slide renderer
 * and its fonts into a filter-graph test for no additional coverage.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { spawn } from "child_process";
import {
  buildSlideFilter, buildCutawayCreditFilter, creditChipRegion, cutawayFrameForLane, FPS,
} from "./videoAssembler.js";
import { requiresCredit } from "./incident/incidentClearance.js";
import { getFFmpegPath } from "./videoGenerator.js";

const ORIENTATION = "vertical";
const FONT = new URL("../../assets/fonts/Inter-SemiBold.otf", import.meta.url).pathname;
const CUTAWAY_SECS = 1.2;
const HOLD = 3.0;

/**
 * The masthead band IS the full-bleed credit region.
 *
 * Not a coincidence and not a coordinate copied here: `creditChipRegion` with no
 * frame is anchored to the masthead's own slot, because the Gate C ruling was
 * "when the frame isn't ours, the source's name takes our name's position". So
 * asking for that region is asking where the masthead is, and if the masthead
 * ever moves this band moves with it.
 */
const MASTHEAD = creditChipRegion(ORIENTATION);

const BRIGHT = 190;
const MIN_BRIGHT_PIXELS = 40;

/**
 * COVERAGE, NOT PRESENCE — and finding out why cost one red run worth reading.
 *
 * The first version of this file asked "is anything bright in the masthead band"
 * and expected the answer to be no during a granted cutaway. It measured 28
 * frames with something bright there, and the something was correct: by the Gate
 * C ruling the credit chip is drawn IN THE MASTHEAD SLOT, because "when the
 * frame isn't ours, the source's name takes our name's position". So the band is
 * never empty on the grant lane; our name is replaced by theirs.
 *
 * The distinguishing quantity is therefore how much of the band is lit. The
 * synthetic masthead fills it (fraction ~1.0); a credit chip is text on a dark
 * opaque plate and lights a few percent. Anything in between is neither, and the
 * two thresholds are far enough apart that no plausible chip text closes the gap.
 */
const MASTHEAD_PRESENT = 0.9;
const MASTHEAD_GONE = 0.5;

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
 * Render one slide with a cutaway on the given clearance lane.
 *
 * The lane is the ONLY input that varies. Composition and credit are both
 * derived from it by the shipped functions — `cutawayFrameForLane` and
 * `requiresCredit` — rather than passed in, so this renders what the engine
 * would actually render for that basis.
 */
async function renderLane(dir, lane) {
  const ff = getFFmpegPath();
  const frame = cutawayFrameForLane(lane, ORIENTATION);
  const state = path.join(dir, `state-${lane}.png`);
  const cut = path.join(dir, `cut-${lane}.mp4`);
  const out = path.join(dir, `out-${lane}.mp4`);

  // A dark card with a WHITE BAND standing in for the masthead.
  //
  // DELIBERATELY LARGER THAN THE CROP REGION, and that is not slack — it is the
  // 2% overscan. buildSlideFilter scales the assembled card to DRIFT_SCALE and
  // crops back to centre, so a bar drawn exactly at the masthead band lands ~19px
  // higher in the output and the fixed crop rectangle catches only ~80% of it.
  // Measured: the first version of this test read 81.6% where it expected ~100%,
  // which is the overscan and not a suppressed masthead. Oversizing the band
  // removes that confound without touching the real geometry, which the shipped
  // satori card does not share (its masthead is laid out in the same overscanned
  // space as everything else).
  await run(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x101010:size=1080x1920:d=1",
    "-vf", "drawbox=x=0:y=0:w=1080:h=400:color=white:t=fill",
    "-frames:v", "1", state], ff);
  // Flat mid-grey footage: 0x80 is 128, well under the 190 threshold, so footage
  // covering the band reads as dark and cannot be mistaken for the masthead.
  await run(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x808080:size=1080x1920:d=3:r=25",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", cut], ff);

  const credit = requiresCredit(lane)
    ? buildCutawayCreditFilter({
        text: "Sarah Voss / BLUESKY", workDir: dir, slideIndex: lane.length,
        fontFile: FONT, orientation: ORIENTATION, frame,
      })
    : null;

  const { filter, totalDuration } = buildSlideFilter({
    stateCount: 1, hold: HOLD, driftDir: 0, orientation: ORIENTATION,
    cutaway: { inputIndex: 1, seconds: CUTAWAY_SECS, credit, frame },
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

/** Bright-pixel COUNT in a region, for every frame of the video. One decode. */
async function brightPerFrame(videoPath, r) {
  const ff = getFFmpegPath();
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

/** The same measurement as a fraction of the region — see MASTHEAD_PRESENT. */
async function coveragePerFrame(videoPath, r) {
  const counts = await brightPerFrame(videoPath, r);
  return counts.map((c) => c / (r.w * r.h));
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;

/** The frames carrying footage, by construction of the graph. */
const cutawayFrames = () => Math.floor(CUTAWAY_SECS * FPS);

// ─── The two directions, in one harness ─────────────────────────────────────

test("GRANT: the masthead IS suppressed — full-bleed borrowed footage covers it", async (t) => {
  // The control half. Without this, "the masthead is visible on the owner lane"
  // could be true because the harness never suppresses anything.
  const dir = mkdtempSync(path.join(tmpdir(), "masthead-grant-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.ok(getFFmpegPath(), "ffmpeg must resolve — this is a real failure, not a skip");

  const per = await coveragePerFrame(await renderLane(dir, "grant"), MASTHEAD);
  const n = cutawayFrames();

  // While the footage is on screen, our masthead is gone from the band. What is
  // left there is the credit chip, which is the whole point of the Gate C anchor.
  const during = per.slice(1, n - 1);
  const stillThere = during.filter((c) => c > MASTHEAD_GONE);
  assert.equal(stillThere.length, 0,
    `granted footage left the masthead standing on ${stillThere.length} frame(s) ` +
    `(worst ${pct(Math.max(...during))}) — full-bleed must cover it`);

  // And it returns when the cutaway stream ends — proving the band, the card and
  // the detector all work, so the suppression above is suppression and not a
  // mis-aimed crop.
  const after = per.slice(n + 1);
  assert.ok(after.length > 0, "the render must outlast the cutaway");
  assert.ok(after.every((c) => c >= MASTHEAD_PRESENT),
    `the masthead must return the moment the cutaway ends (worst ${pct(Math.min(...after))})`);
});

test("OWNER: the masthead is NEVER suppressed — our own footage keeps our chrome", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "masthead-owner-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const per = await coveragePerFrame(await renderLane(dir, "owner"), MASTHEAD);
  const dark = per.map((c, i) => [i, c]).filter(([, c]) => c < MASTHEAD_PRESENT);

  assert.equal(dark.length, 0,
    `the masthead was obscured on ${dark.length} frame(s) (first at frame ${dark[0]?.[0]}, ` +
    `${pct(dark[0]?.[1] ?? 0)} lit) — own material must never suppress our own branding`);
  assert.ok(per.length > cutawayFrames(), "the video must actually contain the cutaway window");
});

test("OWNER: no credit chip is drawn anywhere on the picture", async (t) => {
  // The other half of Gate E. A credit chip on our own footage would name us as
  // an external source; the masthead already says who we are.
  const dir = mkdtempSync(path.join(tmpdir(), "masthead-nocredit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const frame = cutawayFrameForLane("owner", ORIENTATION);
  const region = creditChipRegion(ORIENTATION, { frame });
  const per = await brightPerFrame(await renderLane(dir, "owner"), region);

  const lit = per.filter((c) => c >= MIN_BRIGHT_PIXELS);
  assert.equal(lit.length, 0,
    `${lit.length} frame(s) drew something in the credit band of own material — nothing should be there`);
});

test("the same harness proves a chip IS drawn there on a third-party lane", async (t) => {
  // Without this, the previous test passes for any reason at all, including the
  // crop rectangle missing the chip entirely.
  const dir = mkdtempSync(path.join(tmpdir(), "masthead-credit-ctl-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const frame = cutawayFrameForLane("fair_use", ORIENTATION);
  const region = creditChipRegion(ORIENTATION, { frame });
  const per = await brightPerFrame(await renderLane(dir, "fair_use"), region);

  assert.ok(per.slice(0, cutawayFrames() - 1).every((c) => c >= MIN_BRIGHT_PIXELS),
    "the fair_use lane must draw its credit chip in exactly the band the owner lane was measured empty in");
});
