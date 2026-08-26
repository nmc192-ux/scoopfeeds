/**
 * srtTime.test.js — SRT timestamps carry correctly (#76 follow-up).
 *
 * Found by an actual film build, not by inspection: the rendered SRT
 * contained `00:00:28,1000` — a four-digit millisecond field. Valid SRT has
 * exactly three, and 1000ms must carry into the next second.
 *
 * Not cosmetic. The SRT is the timeline of record — shorts.mjs takes cut
 * points from it, music.mjs derives chapter times from it, and
 * uploadCaptions ships it to YouTube verbatim. A parser reading `(\d+)` for
 * the millisecond field silently treats 1000ms as an extra second, so one
 * malformed cue drifts everything keyed to it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { srtTime } from "./engine/srtTime.mjs";

const SRT_STRICT = /^\d{2}:\d{2}:\d{2},\d{3}$/;

test("THE REGRESSION: a fraction that rounds to 1000ms carries into seconds", () => {
  // 28.9996 produced "00:00:28,1000" before the fix.
  assert.equal(srtTime(28.9996), "00:00:29,000");
  assert.equal(srtTime(59.9999), "00:01:00,000", "and carries through the minute");
  assert.equal(srtTime(3599.9996), "01:00:00,000", "and through the hour");
});

test("every timestamp is strictly well-formed, across the whole range", () => {
  const samples = [0, 0.0004, 0.9999, 1, 1.0005, 28.9996, 59.9999, 60, 61.5,
                   599.9999, 3599.9996, 3600, 7261.337];
  for (const t of samples) {
    assert.match(srtTime(t), SRT_STRICT, `t=${t} produced a malformed timestamp`);
  }
  // And exhaustively across a second boundary, where the carry lives.
  for (let ms = 0; ms <= 2000; ms++) {
    assert.match(srtTime(28 + ms / 1000), SRT_STRICT, `28 + ${ms}ms is malformed`);
  }
});

test("ordinary values are unchanged — the fix is a carry, not a re-timing", () => {
  assert.equal(srtTime(0), "00:00:00,000");
  assert.equal(srtTime(1), "00:00:01,000");
  assert.equal(srtTime(61.5), "00:01:01,500");
  assert.equal(srtTime(9.07), "00:00:09,070");
});

test("negative and non-finite inputs clamp rather than emit garbage", () => {
  assert.equal(srtTime(-1), "00:00:00,000");
  assert.match(srtTime(0), SRT_STRICT);
});
