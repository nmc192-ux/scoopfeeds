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
  const m = filter.match(/crop=\d+:\d+:x='\d+\+([\d.]+)\*\(t\/[\d.]+\)':y='\d+\+([\d.]+)\*/);
  assert.ok(m, `could not read the crop expression out of the filter:\n${filter}`);
  const travelPx = Math.hypot(Number(m[1]), Number(m[2])) / SUPERSAMPLE();
  return travelPx / (totalDuration * FPS);
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

test("the drift stays under 0.5px/frame at every gap, for every slide length", () => {
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

test("a longer slide cannot drift FASTER — the rate is pinned, the cap only slows it", () => {
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
