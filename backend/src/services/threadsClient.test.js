/**
 * threadsClient — the split poll budget.
 *
 * THE DEFECT (DrJ, 2026-08-16): postVideoToThreads called waitForFinished() with
 * no arguments, so it ran on the IMAGE path's stopwatch — 8 x 1500ms = 12000ms,
 * sized by a comment about containers that fetch a JPEG. A video container also
 * has to TRANSCODE. Every Threads video failed "container not ready after
 * 12000ms"; none ever published.
 *
 * These tests pin the SHAPE of the fix rather than the numbers, because the
 * video ceiling is an admitted guess that the elapsed-time log exists to narrow.
 * What must not drift is that the two surfaces have SEPARATE budgets: raising
 * one must never move the other, which is what a shared default with a call-site
 * override would have left in place.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { THREADS_IMAGE_POLL, THREADS_VIDEO_POLL } from "./threadsClient.js";

const withEnv = (vars, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
};

const CLEAN = {
  THREADS_IMAGE_POLL_ATTEMPTS: undefined, THREADS_IMAGE_POLL_GAP_MS: undefined,
  THREADS_VIDEO_POLL_ATTEMPTS: undefined, THREADS_VIDEO_POLL_GAP_MS: undefined,
};

test("the image budget is unchanged — 8 x 1500ms", () => {
  withEnv(CLEAN, () => {
    const b = THREADS_IMAGE_POLL();
    assert.equal(b.maxAttempts, 8);
    assert.equal(b.gapMs, 1500);
    assert.equal(b.maxAttempts * b.gapMs, 12000, "the image path must not move");
  });
});

test("the video budget is its own, and far longer than the image one", () => {
  withEnv(CLEAN, () => {
    const v = THREADS_VIDEO_POLL(), i = THREADS_IMAGE_POLL();
    assert.ok(v.maxAttempts * v.gapMs > 60_000, "a transcode needs more than a minute of headroom");
    assert.ok(v.maxAttempts * v.gapMs > 5 * i.maxAttempts * i.gapMs,
      "if the video ceiling is close to the image one, the split bought nothing");
    // A slower cadence too — the same window at the image gap would cost ~80 calls.
    assert.ok(v.gapMs > i.gapMs, "polling a transcode every 1.5s is wasted calls");
  });
});

// THE POINT OF THE WHOLE CHANGE. A shared default with a call-site override
// passes every test above and still fails this one.
test("raising one budget does not move the other", () => {
  withEnv({ ...CLEAN, THREADS_VIDEO_POLL_ATTEMPTS: "99", THREADS_VIDEO_POLL_GAP_MS: "9000" }, () => {
    assert.equal(THREADS_VIDEO_POLL().maxAttempts, 99);
    assert.equal(THREADS_VIDEO_POLL().gapMs, 9000);
    assert.equal(THREADS_IMAGE_POLL().maxAttempts, 8, "the image budget moved with the video one");
    assert.equal(THREADS_IMAGE_POLL().gapMs, 1500);
  });
  withEnv({ ...CLEAN, THREADS_IMAGE_POLL_ATTEMPTS: "3" }, () => {
    assert.equal(THREADS_IMAGE_POLL().maxAttempts, 3);
    assert.equal(THREADS_VIDEO_POLL().maxAttempts, 24, "the video budget moved with the image one");
  });
});

test("both budgets are env-readable, and 0 means 0 for the gap", () => {
  // Not `parseInt(x) || fallback` — that reads a deliberate 0 as absent and
  // silently restores the default. A 0 gap is a legitimate "poll flat out".
  withEnv({ ...CLEAN, THREADS_VIDEO_POLL_GAP_MS: "0" }, () => {
    assert.equal(THREADS_VIDEO_POLL().gapMs, 0);
  });
});

test("a nonsense or out-of-range value falls back rather than disabling the poll", () => {
  // 0 attempts would skip the loop entirely and publish against an unready
  // container, so the floor is 1 — a bad value must not be a way to turn the
  // wait off by accident.
  for (const bad of ["nonsense", "0", "-4", ""]) {
    withEnv({ ...CLEAN, THREADS_VIDEO_POLL_ATTEMPTS: bad }, () => {
      assert.equal(THREADS_VIDEO_POLL().maxAttempts, 24, `bad attempts value accepted: "${bad}"`);
    });
  }
});

test("each budget names the var that raises it, for the timeout message", () => {
  // A timeout that does not say which stopwatch ran, or how to raise it, is the
  // operational form of a check the prompt never names.
  withEnv(CLEAN, () => {
    assert.equal(THREADS_VIDEO_POLL().attemptsVar, "THREADS_VIDEO_POLL_ATTEMPTS");
    assert.equal(THREADS_IMAGE_POLL().attemptsVar, "THREADS_IMAGE_POLL_ATTEMPTS");
    assert.equal(THREADS_VIDEO_POLL().label, "video");
    assert.equal(THREADS_IMAGE_POLL().label, "image");
  });
});
