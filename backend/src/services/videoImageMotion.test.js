// Image-layer motion: the underlay moves, the type does not.
//
// The correctness property worth testing is not "there is a zoom" — it is that
// the per-state zoom sub-ranges are CONTIGUOUS. States are crossfaded, so if
// state i ends at a different zoom than state i+1 starts, every dissolve puts
// two scales of the same picture on screen and the image jumps at each state
// change. That failure is invisible in a still and obvious in motion, which is
// exactly the kind this suite exists to catch before a render.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlideFilter, holdForAudio, FPS } from "./videoAssembler.js";

const zoomsFrom = (filter) =>
  [...filter.matchAll(/zoompan=z='([\d.]+)\+([\d.-]+)\*on\/(\d+)'/g)]
    .map((m) => ({ z0: Number(m[1]), span: Number(m[2]), frames: Number(m[3]) }));

test("OFF by default — an underlay slide is still a static plate", () => {
  delete process.env.VIDEO_IMAGE_MOTION_ENABLED;
  const { filter } = buildSlideFilter({ stateCount: 4, hold: 2.5, underlay: true });
  assert.ok(!/zoompan/.test(filter), "zoompan appeared without the flag");
  assert.ok(!/\bon\b/.test(filter), "a frame-dependent term appeared without the flag");
});

test("the flag alone does NOT move a text-only slide", () => {
  // The whole basis for adding this is that TEXT stays static. A card with no
  // underlay must be byte-identical whether the flag is set or not.
  const off = (() => { delete process.env.VIDEO_IMAGE_MOTION_ENABLED;
    return buildSlideFilter({ stateCount: 3, hold: 3, driftDir: 0 }).filter; })();
  process.env.VIDEO_IMAGE_MOTION_ENABLED = "1";
  const on = buildSlideFilter({ stateCount: 3, hold: 3, driftDir: 0 }).filter;
  delete process.env.VIDEO_IMAGE_MOTION_ENABLED;
  assert.equal(on, off, "the flag leaked into a slide that has no image");
});

test("overlapping states show the SAME zoom at the same instant", () => {
  // The invariant is not "state i ends where state i+1 begins" — states OVERLAP
  // by the crossfade, so those are different moments and legitimately differ.
  // (Asserting that was this test's first, wrong, form.) What must hold is that
  // at any shared instant both live states are at the same scale, so the
  // dissolve blends one picture with itself rather than two sizes of it.
  process.env.VIDEO_IMAGE_MOTION_ENABLED = "1";
  const CROSSFADE = 0.35;
  for (const stateCount of [2, 3, 4, 5]) {
    for (const audioSecs of [6, 9.5, 14]) {
      const hold = holdForAudio(audioSecs, stateCount);
      const step = hold - CROSSFADE;
      const { filter } = buildSlideFilter({ stateCount, hold, underlay: true });
      const z = zoomsFrom(filter);
      assert.equal(z.length, stateCount, "expected one zoompan per state");
      const zoomAt = (i, streamT) => z[i].z0 + z[i].span * (streamT / hold);
      for (let i = 0; i < stateCount - 1; i++) {
        // sample across the whole dissolve, not just its edges
        for (const frac of [0, 0.5, 1]) {
          const T = (i + 1) * step + frac * CROSSFADE;      // global time
          const a = zoomAt(i, T - i * step);
          const b = zoomAt(i + 1, T - (i + 1) * step);
          assert.ok(Math.abs(a - b) < 1e-4,
            `at T=${T.toFixed(3)}s state ${i} is z=${a.toFixed(6)} but state ${i + 1} is z=${b.toFixed(6)}`);
        }
      }
    }
  }
  delete process.env.VIDEO_IMAGE_MOTION_ENABLED;
});

test("the zoom starts at 1.0 and never upscales past the oversized plate", () => {
  process.env.VIDEO_IMAGE_MOTION_ENABLED = "1";
  const { filter } = buildSlideFilter({ stateCount: 4, hold: 2.5, underlay: true });
  const z = zoomsFrom(filter);
  assert.ok(Math.abs(z[0].z0 - 1.0) < 1e-6, "must begin at z=1 (full oversized plate)");
  const end = z[z.length - 1].z0 + z[z.length - 1].span;
  const zoom = Number.parseFloat(process.env.VIDEO_IMAGE_ZOOM || "0.06");
  assert.ok(Math.abs(end - (1 + zoom)) < 1e-4, `must end at 1+ZOOM, got ${end}`);
  // The plate is laid out oversized by exactly that factor, so z=1+ZOOM is 1:1.
  const plate = filter.match(/^\[\d+:v\]scale=(\d+):(\d+):force_original_aspect_ratio=decrease/m);
  assert.ok(plate, "expected an oversized underlay plate");
  assert.equal(Number(plate[1]), Math.round(1920 * (1 + zoom)), "plate width not oversized by ZOOM");
  assert.equal(Number(plate[2]), Math.round(1080 * (1 + zoom)), "plate height not oversized by ZOOM");
  delete process.env.VIDEO_IMAGE_MOTION_ENABLED;
});

test("motion is monotonic — a push-in, never a wobble", () => {
  process.env.VIDEO_IMAGE_MOTION_ENABLED = "1";
  const { filter } = buildSlideFilter({ stateCount: 5, hold: 2, underlay: true });
  for (const s of zoomsFrom(filter)) assert.ok(s.span >= 0, "a state zooms backwards");
  delete process.env.VIDEO_IMAGE_MOTION_ENABLED;
});

test("a single-state slide still produces a valid, bounded ramp", () => {
  process.env.VIDEO_IMAGE_MOTION_ENABLED = "1";
  const { filter } = buildSlideFilter({ stateCount: 1, hold: 4, underlay: true });
  const z = zoomsFrom(filter);
  assert.equal(z.length, 1);
  assert.ok(z[0].frames >= 1 && Number.isFinite(z[0].frames), "frame count must be usable");
  assert.ok(!/NaN|Infinity/.test(filter), "degenerate arithmetic leaked into the graph");
  delete process.env.VIDEO_IMAGE_MOTION_ENABLED;
});

test("the TYPE chain is time-invariant even with motion on", () => {
  // Proving "the text did not move" by sampling pixels is unreliable: the type
  // is anti-aliased over a background that is now zooming, so glyph edge pixels
  // change without the glyph moving, and any bright background inside the
  // sample window moves too. The graph settles it instead — the type is scaled
  // at a fixed size and composited at a constant offset, with no term that can
  // vary over time. If this holds, the text cannot move, whatever a threshold
  // mask suggests.
  process.env.VIDEO_IMAGE_MOTION_ENABLED = "1";
  const { filter } = buildSlideFilter({ stateCount: 4, hold: 2.5, underlay: true });
  for (const stage of filter.split(";").map((x) => x.trim())) {
    const isTypeStage = /\[o\d+\]$/.test(stage) || /overlay=/.test(stage);
    if (!isTypeStage) continue;
    assert.ok(!/\bon\b/.test(stage), `type stage is frame-dependent:\n${stage}`);
    assert.ok(!/\bt\b(?![a-z])/.test(stage.replace(/format|setsar|fps|overlay|scale|rgba|auto|yuv420p/g, "")),
      `type stage is time-dependent:\n${stage}`);
    assert.ok(!/overlay=[^,\]]*\b(t|on)\b/.test(stage), `overlay position is animated:\n${stage}`);
  }
  assert.match(filter, /overlay=0:0/, "the type must composite at a constant origin");
  delete process.env.VIDEO_IMAGE_MOTION_ENABLED;
});
