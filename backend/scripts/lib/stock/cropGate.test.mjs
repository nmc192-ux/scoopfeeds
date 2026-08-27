/**
 * cropGate.test.mjs — the §5 gate.
 *
 * Run: cd backend && node --test "scripts/lib/stock/*.test.mjs"
 *
 * The failure being designed against is a library that looks fine in the manifest
 * and soft everywhere it is used. A 1080p landscape clip yields a 607×1080 centre
 * crop that has to be upscaled 1.78× to fill the frame, and nothing downstream
 * can recover that detail — so the grade has to be recorded at acquisition, while
 * the source dimensions are still in hand, and rationed rather than accepted
 * silently.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  centreCropWidth, gradeCandidate, rationSoftCrops, SOFT_CROP_CLASS_LIMIT,
} from "./cropGate.mjs";

const clip = (width, height, durationSec = 10) => ({ width, height, durationSec });

// ─── The three grades ───────────────────────────────────────────────────────

test("a native portrait clip is the best case", () => {
  const v = gradeCandidate(clip(1080, 1920));
  assert.equal(v.grade, "native-portrait");
  assert.equal(v.orientation, "portrait");
  assert.equal(v.accepted, true);
});

test("a UHD landscape clip crops crisply — its centre crop is still taller than the frame", () => {
  const v = gradeCandidate(clip(3840, 2160));
  assert.equal(v.grade, "crisp-4k-crop");
  assert.equal(v.accepted, true);
  // 1215×2160 downscales to 1080×1920 rather than being stretched up to it.
  assert.equal(centreCropWidth(2160), 1215);
  assert.ok(centreCropWidth(2160) > 1080, "the crop must be wider than the target, not narrower");
});

test("a 1080p landscape clip is the soft case — the crop must be upscaled", () => {
  const v = gradeCandidate(clip(1920, 1080));
  assert.equal(v.grade, "soft-hd-crop");
  assert.equal(v.accepted, true, "accepted at the gate; rationed later by class");
  assert.equal(centreCropWidth(1080), 608);
  assert.ok(centreCropWidth(1080) < 1080, "this is the grade that costs detail");
});

// ─── Both rejects ───────────────────────────────────────────────────────────

test("anything below 1080p is rejected outright", () => {
  for (const c of [clip(1280, 720), clip(640, 360), clip(720, 1280)]) {
    const v = gradeCandidate(c);
    assert.equal(v.accepted, false, `${c.width}×${c.height} must not pass`);
    assert.equal(v.reason, "below-1080p");
    assert.equal(v.grade, null);
  }
});

test("a portrait clip narrower than the frame is below 1080p even though it is tall", () => {
  // 720×1280 is portrait and 1280 tall, but only 720 wide — the frame is 1080 wide.
  const v = gradeCandidate(clip(720, 1280));
  assert.equal(v.accepted, false);
  assert.equal(v.reason, "below-1080p");
});

test("durations outside the cutaway window are rejected, and say which end", () => {
  const short = gradeCandidate(clip(3840, 2160, 1.5));
  assert.equal(short.accepted, false);
  assert.equal(short.reason, "too-short", "cutaways run 1.5-3s and need trim room either side");

  const long = gradeCandidate(clip(3840, 2160, 121));
  assert.equal(long.accepted, false);
  assert.equal(long.reason, "too-long", "these are cutaways, not scenes");

  assert.equal(gradeCandidate(clip(3840, 2160, 2)).accepted, true, "2s exactly is in");
  assert.equal(gradeCandidate(clip(3840, 2160, 120)).accepted, true, "120s exactly is in");
});

test("a duration rejection still reports the grade it would have had", () => {
  // --dry-run readers need to see what they are losing, not just that it went.
  const v = gradeCandidate(clip(3840, 2160, 0.5));
  assert.equal(v.grade, "crisp-4k-crop");
  assert.equal(v.accepted, false);
});

test("missing dimensions are refused rather than defaulted", () => {
  // videoSubjectVisual defaults an unreadable probe to 1920x1080. Doing that here
  // would silently grade an unknown clip as soft-hd-crop and stage it.
  for (const bad of [{}, clip(0, 0), clip(NaN, 1080), { width: 1920 }]) {
    const v = gradeCandidate(bad);
    assert.equal(v.accepted, false);
    assert.ok(["unknown-dimensions", "unknown-duration"].includes(v.reason), `got ${v.reason}`);
  }
});

// ─── The soft-crop ration ───────────────────────────────────────────────────

test("soft crops are taken while a class is thin and refused once it is not", () => {
  const soft = () => ({ ...gradeCandidate(clip(1920, 1080)), tag: "soft" });
  const rationed = rationSoftCrops([soft(), soft()], SOFT_CROP_CLASS_LIMIT);
  assert.deepEqual(rationed.map((r) => r.accepted), [false, false],
    "a class already holding 5 better assets does not need soft ones");
  assert.equal(rationed[0].reason, "soft-crop-quota");

  const thin = rationSoftCrops([soft(), soft()], 0);
  assert.deepEqual(thin.map((r) => r.accepted), [true, true], "a thin class takes what it can get");
});

test("the ration counts better grades found in the SAME run, not just the manifest", () => {
  const better = gradeCandidate(clip(3840, 2160));
  const soft = gradeCandidate(clip(1920, 1080));
  // Four already in the manifest + one found now = the limit, so the soft one goes.
  const out = rationSoftCrops([better, soft], SOFT_CROP_CLASS_LIMIT - 1);
  assert.equal(out[0].accepted, true);
  assert.equal(out[1].accepted, false, "the better clip found this run must count toward the quota");
  assert.equal(out[1].reason, "soft-crop-quota");
});

test("rationing never revives a candidate the gate already rejected", () => {
  const rejected = gradeCandidate(clip(640, 360));
  const [out] = rationSoftCrops([rejected], 0);
  assert.equal(out.accepted, false);
  assert.equal(out.reason, "below-1080p", "the quota must not overwrite the real reason");
});
