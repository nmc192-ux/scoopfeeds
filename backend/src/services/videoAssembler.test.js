/**
 * videoAssembler.test.js — the timing chain, and the two gates VIDEO_VOICE_GAP_MS
 * has to clear.
 *
 * No ffmpeg is invoked: everything here is the pure arithmetic that decides how
 * long a slide is and how far it pans, plus the filter string that arithmetic
 * produces. That string IS the contract with ffmpeg, so asserting on it is
 * asserting on what will actually run.
 *
 * SLIDE DURATION IS AUDIO DURATION (§5), so every millisecond added here is
 * multiplied by the slide count and lands in the published runtime. The gap is
 * cheap to type and expensive to get wrong, which is why it is measured rather
 * than reasoned about.
 */

import test from "node:test";
import assert from "node:assert/strict";

const {
  holdForAudio, slideTotalSecs, buildSlideFilter,
  SLIDE_TAIL_SECS, CROSSFADE_SECS, FPS, SUPERSAMPLE, DRIFT_RATE,
} = await import("./videoAssembler.js");

/** The measured criterion from videoAssembler.js's header: below this the pan
 *  reads as a smooth ramp, above it as the stall-and-snap that read as shake. */
const DRIFT_MAX_PX_PER_FRAME = 0.5;

function withGap(ms, fn) {
  const saved = process.env.VIDEO_VOICE_GAP_MS;
  process.env.VIDEO_VOICE_GAP_MS = String(ms);
  try { return fn(); }
  finally {
    if (saved === undefined) delete process.env.VIDEO_VOICE_GAP_MS;
    else process.env.VIDEO_VOICE_GAP_MS = saved;
  }
}

/** Read the pan back out of the filter graph rather than recomputing it, so a
 *  change to the graph is visible here instead of only in a rendered file. */
function driftPerFrame(stateCount, hold) {
  const { filter, totalDuration } = buildSlideFilter({ stateCount, hold, driftDir: 0 });
  // A STATIC crop has constant coordinates and no `t` at all. That is zero
  // motion, measured — not an unparseable filter, and not an excuse to skip the
  // assertion. Returning 0 here is what lets the same helper prove both states.
  if (!/crop=\d+:\d+:x='/.test(filter)) return 0;
  const m = filter.match(/crop=\d+:\d+:x='\d+\+([\d.]+)\*\(t\/[\d.]+\)':y='\d+\+([\d.]+)\*/);
  assert.ok(m, `could not read the crop expression out of the filter:\n${filter}`);
  const travelPx = Math.hypot(Number(m[1]), Number(m[2])) / SUPERSAMPLE();
  return travelPx / (totalDuration * FPS);
}

/** Run a body with the pan turned back on. Async — see videoSlideRenderer.test.js. */
async function withDrift(fn) {
  const saved = process.env.VIDEO_SLIDE_DRIFT_ENABLED;
  process.env.VIDEO_SLIDE_DRIFT_ENABLED = "1";
  try { return await fn(); }
  finally {
    if (saved === undefined) delete process.env.VIDEO_SLIDE_DRIFT_ENABLED;
    else process.env.VIDEO_SLIDE_DRIFT_ENABLED = saved;
  }
}

// A caption is one or two spoken sentences (§5), which lands between about 1.5s
// and 12s. The step is fine enough that a threshold crossing cannot hide.
const DURATIONS = [];
for (let d = 1.5; d <= 12.0001; d += 0.25) DURATIONS.push(Number(d.toFixed(2)));

// ─── The gap ships inert ────────────────────────────────────────────────────

test("with VIDEO_VOICE_GAP_MS unset, slide length is exactly audio + the tail", () => {
  delete process.env.VIDEO_VOICE_GAP_MS;
  assert.equal(slideTotalSecs(5), 5 + SLIDE_TAIL_SECS);
  // The pre-change formula, verbatim.
  for (const n of [1, 2, 4]) {
    assert.equal(holdForAudio(5, n), (5 + SLIDE_TAIL_SECS + (n - 1) * CROSSFADE_SECS) / n);
  }
});

test("the gap extends the slide by exactly itself, no more", () => {
  withGap(400, () => {
    assert.ok(Math.abs(slideTotalSecs(5) - (5 + SLIDE_TAIL_SECS + 0.4)) < 1e-9);
  });
});

test("the mechanical tail and the editorial gap stay separate numbers", () => {
  // SLIDE_TAIL_SECS exists so the last consonant survives the cut. Folding the
  // pacing gap into it means the first person to shorten the pause clips every
  // slide, and the clipping margin has to be re-derived on every pacing change.
  withGap(0, () => assert.equal(slideTotalSecs(4), 4 + SLIDE_TAIL_SECS));
  withGap(800, () => assert.equal(slideTotalSecs(4).toFixed(3), (4 + SLIDE_TAIL_SECS + 0.8).toFixed(3)));
});

// ─── Gate 1: the drift criterion ────────────────────────────────────────────

test("the drift stays under 0.5px/frame at every gap, for every slide length", async () => {
  return withDrift(() => {
  for (const gapMs of [0, 100, 200, 400, 800]) {
    withGap(gapMs, () => {
      for (const stateCount of [1, 2, 3, 4, 5]) {
        for (const audioSecs of DURATIONS) {
          const px = driftPerFrame(stateCount, holdForAudio(audioSecs, stateCount));
          assert.ok(
            px < DRIFT_MAX_PX_PER_FRAME,
            `gap=${gapMs}ms states=${stateCount} audio=${audioSecs}s -> ${px.toFixed(4)}px/frame`,
          );
        }
      }
    });
  }
  });
});

test("a longer slide cannot drift FASTER — the rate is pinned, the cap only slows it", async () => {
  return withDrift(() => {
  // This is the property that makes the gate hold for any gap anyone types:
  // per-frame displacement is DRIFT_RATE/FPS until the overscan caps the
  // travel, and capped means slower. Duration can only ever reduce it.
  const ceiling = DRIFT_RATE() / FPS;
  for (const gapMs of [0, 400, 5000]) {
    withGap(gapMs, () => {
      for (const audioSecs of DURATIONS) {
        const px = driftPerFrame(3, holdForAudio(audioSecs, 3));
        // Integer, chroma-even crop coordinates put the realised value within a
        // rounding step of the pinned rate rather than exactly on it.
        assert.ok(px <= ceiling + 0.005, `gap=${gapMs} audio=${audioSecs} -> ${px} > ${ceiling}`);
      }
    });
  }
  });
});

// ─── Gate 2: the state-collapse rule is untouched ───────────────────────────

test("the collapse rule is fed RAW audio, so the gap cannot change what it drops", async () => {
  const { statesForCard, fitStatesToDuration } = await import("./videoSlideRenderer.js");
  const ctx = { outlet: "Reuters", slideIndex: 2, slideCount: 7 };
  const cards = {
    stat:    { t: "stat", eyebrow: "FAULTS", value: 70, unit: "%", lines: ["of faults", "are anchors"], hi: 1, source: "Reuters", caption: "c" },
    bars:    { t: "bars", eyebrow: "CAUSE", bars: [["anchors", 70], ["gear", 18], ["natural", 9], ["sabotage", 3]], source: "Reuters", caption: "c" },
    diagram: { t: "diagram", eyebrow: "HOW", nodes: [["SHIP", "a"], ["SHELF", "b"], ["CABLE", "c"], ["OUTAGE", "d"]], marker: { on: 2, label: "BREAK" }, caption: "c" },
  };
  const decide = (card, audioSecs) =>
    fitStatesToDuration(statesForCard(card, ctx), audioSecs, { slideIndex: 2 }).map(s => s.key).join(">");

  for (const [name, card] of Object.entries(cards)) {
    for (const audioSecs of DURATIONS) {
      const base = withGap(0, () => decide(card, audioSecs));
      for (const gapMs of [400, 800]) {
        assert.equal(withGap(gapMs, () => decide(card, audioSecs)), base,
          `${name}@${audioSecs}s changed at gap=${gapMs}ms — the gap is silence AFTER the ` +
          `narration, not room to pace states across`);
      }
    }
  }
});

test("the gap only ever ADDS to the hold a surviving state gets", async () => {
  const { statesForCard, fitStatesToDuration } = await import("./videoSlideRenderer.js");
  const ctx = { outlet: "Reuters", slideIndex: 2, slideCount: 7 };
  const card = { t: "bars", eyebrow: "CAUSE", bars: [["anchors", 70], ["gear", 18], ["natural", 9], ["sabotage", 3]], source: "Reuters", caption: "c" };
  for (const audioSecs of DURATIONS) {
    const kept = fitStatesToDuration(statesForCard(card, ctx), audioSecs, { slideIndex: 2 }).length;
    const at0   = withGap(0,   () => holdForAudio(audioSecs, kept));
    const at400 = withGap(400, () => holdForAudio(audioSecs, kept));
    assert.ok(at400 > at0, `audio=${audioSecs}s: ${at400} !> ${at0}`);
  }
});

// ─── STATIC SLIDES — the default (DrJ, 2026-08-12) ──────────────────────────
//
// These assert EXACTLY ZERO, not "under the criterion". At zero motion the
// <=0.5px/frame gate above passes vacuously and would keep passing if the pan
// came back at 0.4px/frame — which is precisely the eye-strain being removed.
// Zero is the only assertion that still means something here.

test("BY DEFAULT there is no drift: per-frame displacement is EXACTLY zero", () => {
  delete process.env.VIDEO_SLIDE_DRIFT_ENABLED;
  for (const stateCount of [1, 2, 3, 4, 5]) {
    for (const audioSecs of DURATIONS) {
      const px = driftPerFrame(stateCount, holdForAudio(audioSecs, stateCount));
      assert.strictEqual(
        px, 0,
        `states=${stateCount} audio=${audioSecs}s produced ${px} px/frame — the pan is back`,
      );
    }
  }
});

test("the static filter contains NO time-dependent term anywhere", () => {
  // The stronger form of the assertion above: not "the motion is small" but
  // "the graph cannot express motion". Any `t` in a crop/scale expression is a
  // whole-frame animation by definition.
  delete process.env.VIDEO_SLIDE_DRIFT_ENABLED;
  for (const stateCount of [1, 3, 5]) {
    const { filter } = buildSlideFilter({ stateCount, hold: 3, driftDir: 0 });
    assert.ok(!/crop=[^,]*\bt\b/.test(filter), `crop is animated:\n${filter}`);
    assert.ok(!/scale=[^,]*\bt\b/.test(filter), `scale is animated:\n${filter}`);
    assert.match(filter, /crop=\d+:\d+:x=\d+:y=\d+/, "expected a constant-coordinate crop");
  }
});

test("the direction alternation cannot reintroduce motion when drift is off", () => {
  // driftDir alternates the pan per slide. With drift off it must be inert for
  // every value, not merely for the even ones a spot-check would cover.
  delete process.env.VIDEO_SLIDE_DRIFT_ENABLED;
  const filters = new Set();
  for (let driftDir = 0; driftDir < 8; driftDir++) {
    const { filter } = buildSlideFilter({ stateCount: 3, hold: 3, driftDir });
    assert.ok(!/\bt\b/.test(filter.split("crop=")[1] || ""), `driftDir=${driftDir} animated the crop`);
    filters.add(filter);
  }
  assert.equal(filters.size, 1, "every slide must produce the identical static graph");
});

test("the 2% overscan is KEPT, and the crop sits at the pan's midpoint", () => {
  // The overscan stays (removing it is a separate layout change). Cropping dead
  // centre is not arbitrary: the old pan ran from (maxX-dx)/2 to (maxX+dx)/2,
  // so maxX/2 is exactly where that motion averaged out. Framing is unchanged;
  // only the movement is gone.
  delete process.env.VIDEO_SLIDE_DRIFT_ENABLED;
  const { filter } = buildSlideFilter({ stateCount: 3, hold: 3, driftDir: 0 });
  const scale = filter.match(/\[xf2\]scale=(\d+):(\d+):flags=lanczos/);
  assert.ok(scale, `expected an overscan scale:\n${filter}`);
  const w2 = Number(scale[1]), h2 = Number(scale[2]);
  assert.ok(w2 > 1920 && w2 <= Math.round(1920 * 1.03), `overscan width ${w2} is not ~2%`);
  const crop = filter.match(/crop=(\d+):(\d+):x=(\d+):y=(\d+)/);
  assert.equal(Number(crop[1]), 1920);
  assert.equal(Number(crop[2]), 1080);
  assert.equal(Number(crop[3]), Math.round((w2 - 1920) / 2), "crop x is not the midpoint");
  assert.equal(Number(crop[4]), Math.round((h2 - 1080) / 2), "crop y is not the midpoint");
});

test("the 4x supersample is SKIPPED when there is nothing to be sub-pixel about", () => {
  // It exists solely to make an animated integer crop advance smoothly. A still
  // crop lands on one coordinate and stays there, so the round trip would cost
  // two lanczos passes at 16x the pixel count and buy nothing.
  delete process.env.VIDEO_SLIDE_DRIFT_ENABLED;
  const { filter } = buildSlideFilter({ stateCount: 3, hold: 3, driftDir: 0 });
  const scales = [...filter.matchAll(/scale=(\d+):(\d+)/g)].map(m => Number(m[1]));
  assert.ok(Math.max(...scales) < 1920 * 2, `a supersampled scale survived: ${scales.join(", ")}`);
});

test("the progressive state reveal SURVIVES — content appearing is not the pan", () => {
  // The whole point of the scope: xfade between keyframe states is the format's
  // motion design and must be untouched. Only the frame moving is removed.
  delete process.env.VIDEO_SLIDE_DRIFT_ENABLED;
  const { filter } = buildSlideFilter({ stateCount: 4, hold: 2, driftDir: 0 });
  assert.equal((filter.match(/xfade=transition=fade/g) || []).length, 3);
});

test("captions still come LAST, after the crop", () => {
  delete process.env.VIDEO_SLIDE_DRIFT_ENABLED;
  const { filter } = buildSlideFilter({ stateCount: 2, hold: 2, driftDir: 0, caption: "drawtext=FAKE" });
  assert.ok(filter.indexOf("drawtext=FAKE") > filter.indexOf("crop="), "caption must burn after the crop");
});

test("the flag turns the pan back on, so the mechanism is not dead code", () => {
  delete process.env.VIDEO_SLIDE_DRIFT_ENABLED;
  const off = buildSlideFilter({ stateCount: 3, hold: 3, driftDir: 0 }).filter;
  process.env.VIDEO_SLIDE_DRIFT_ENABLED = "1";
  try {
    const on = buildSlideFilter({ stateCount: 3, hold: 3, driftDir: 0 }).filter;
    assert.notEqual(on, off);
    assert.match(on, /crop=\d+:\d+:x='\d+\+\d+\*\(t\//);
    assert.ok(driftPerFrame(3, 3) > 0);
  } finally { delete process.env.VIDEO_SLIDE_DRIFT_ENABLED; }
});
