// trackBed.test.mjs — looping a real music track to film length.
//
// Run:  node --test backend/src/services/longform/engine/trackBed.test.mjs
//
// loopPlan is pure and tested here because its failure mode is expensive and
// late: one repeat too few leaves the last minutes of a 14-minute film in
// silence, and you find out after the render, under the closing line — the one
// place the music is most supposed to be doing something.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loopPlan, BED_DEFAULTS, audioDuration, bedFromTrack } from "./trackBed.mjs";
import { ffmpegPath } from "./_deps.mjs";
import { DUCK } from "./ducking.mjs";

const exec = promisify(execFile);

/** Length a plan actually yields, given acrossfade eats `xfade` per join. */
const yielded = (p, track) => p.repeats * track - (p.repeats - 1) * p.xfade;

test("a plan always covers the film", () => {
  const xfade = BED_DEFAULTS.xfade;
  for (const track of [17, 30, 62.5, 128, 191, 400]) {
    for (const film of [30, 60, 240, 605, 847.7, 1200]) {
      const p = loopPlan(track, film, { xfade });
      assert.ok(yielded(p, track) >= film - 1e-6,
        `${track}s track × ${p.repeats} yields ${yielded(p, track).toFixed(1)}s `
        + `but the film is ${film}s — the tail would be silent`);
    }
  }
});

test("a plan is not wasteful — one repeat fewer would fall short", () => {
  for (const track of [30, 62.5, 191]) {
    for (const film of [240, 605, 847.7]) {
      const p = loopPlan(track, film, { xfade: BED_DEFAULTS.xfade });
      if (p.repeats <= 1) continue;
      const less = { ...p, repeats: p.repeats - 1 };
      assert.ok(yielded(less, track) < film,
        `${p.repeats} repeats of a ${track}s track is one more than needed for ${film}s`);
    }
  }
});

test("a track longer than the film is used once, not looped", () => {
  const p = loopPlan(600, 120);
  assert.equal(p.repeats, 1);
});

test("a track exactly the film's length is not silently short", () => {
  const p = loopPlan(120, 120);
  assert.ok(yielded(p, 120) >= 120, "an exact-length track must still cover the film");
});

test("the reported total matches what the crossfades actually yield", () => {
  const p = loopPlan(62.5, 847.7);
  assert.equal(+p.totalRaw.toFixed(6), +yielded(p, 62.5).toFixed(6),
    "totalRaw must account for the length each acrossfade consumes, or the "
    + "atrim afterwards is being asked for audio that was never produced");
});

test("nonsense durations are refused rather than producing an empty bed", () => {
  assert.throws(() => loopPlan(0, 100), /track duration must be positive/);
  assert.throws(() => loopPlan(-5, 100), /track duration must be positive/);
  assert.throws(() => loopPlan(100, 0), /film duration must be positive/);
});

test("a missing track file is named, not silently skipped", async () => {
  await assert.rejects(() => audioDuration("/nonexistent/track.mp3"), /.+/);
});

// ── End to end ──────────────────────────────────────────────────────────────
//
// THE PURE TESTS ABOVE CANNOT CATCH THE BUG THIS ONE EXISTS FOR. loopPlan was
// correct and the acrossfade chain measured exactly as modelled (6 × 12s with a
// 4s crossfade = 52.00s), and the bed still came out 3.3 seconds short, because
// single-pass loudnorm holds a lookahead this engine's bundled 2018 ffmpeg
// never flushes. Arithmetic about a filter graph is not evidence about a filter
// graph, so this renders one and measures it.

test("the bed is exactly the requested length, not merely long enough", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bed-"));
  const track = path.join(dir, "track.mp3");
  try {
    await exec(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=12", "-c:a", "libmp3lame", track]);
  } catch {
    t.skip("no usable ffmpeg/libmp3lame in this environment");
    return;
  }
  // 47s from a 12s track forces five crossfaded joins — the case that failed.
  const want = 47;
  const out = path.join(dir, "bed.wav");
  await bedFromTrack(track, want, out);
  const got = await audioDuration(out);
  assert.ok(Math.abs(got - want) < 0.15,
    `bed is ${got.toFixed(2)}s for a ${want}s film — a short bed leaves the end of `
    + `the film silent, which is exactly where the music is meant to land`);
});

// ── The duck ────────────────────────────────────────────────────────────────

test("the track preset ducks harder and faster than the ambient bed preset", () => {
  assert.ok(DUCK.track.ratio > DUCK.bed.ratio,
    "a track that is meant to be present must duck harder, or it covers the voice");
  assert.ok(DUCK.track.attack < DUCK.bed.attack,
    "a louder bed has to get out of the way faster at the start of a line");
  assert.ok(DUCK.track.threshold < DUCK.bed.threshold,
    "a lower threshold makes the duck trigger on ordinary speech, not just peaks");
  assert.ok(DUCK.track.release > DUCK.bed.release,
    "a longer release lets the track swell back between lines instead of pumping");
});
