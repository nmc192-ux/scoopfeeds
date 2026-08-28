/**
 * Hashing, tested at two levels.
 *
 * The arithmetic is tested purely, from rasters built by hand, so the rules are
 * exercised without a decoder. Then ONE test drives the real bundled ffmpeg end
 * to end, because a hash that only ever sees hand-made buffers proves nothing
 * about the thing it will actually be fed. The bundled binary is a dependency of
 * this repo, so that test is not conditional and does not skip — a hashing test
 * that quietly skips when a decoder is missing is the vacuous-pass shape this
 * whole engine is written against.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  HASH_W, HASH_H, HASH_BITS, SAME_FILE_MAX_DISTANCE,
  rasterToHash, hammingDistance, isSameFile, sharesAnyFrame, groupByFile,
  hashImage, hashVideoKeyframes, ffmpegRaw, HashError,
} from "./incidentHash.js";
import { getFFmpegPath } from "../videoGenerator.js";

/** A 9x8 raster from a per-pixel function. */
const raster = (fn) => {
  const b = Buffer.alloc(HASH_W * HASH_H);
  for (let y = 0; y < HASH_H; y++) for (let x = 0; x < HASH_W; x++) b[y * HASH_W + x] = fn(x, y);
  return b;
};

// ─── The arithmetic ─────────────────────────────────────────────────────────

test("a flat raster has no gradients, so every bit is zero", () => {
  assert.equal(rasterToHash(raster(() => 128)), "0".repeat(HASH_BITS / 4));
});

test("a strictly decreasing row sets every bit", () => {
  // Each pixel greater than its right neighbour ⇒ all 64 bits set.
  assert.equal(rasterToHash(raster((x) => 255 - x * 20)), "f".repeat(HASH_BITS / 4));
});

test("the hash is always 16 hex chars, zero-padded, so hashes compare as strings", () => {
  for (const f of [() => 128, (x) => 255 - x * 20, (x, y) => (x + y) * 7 % 256]) {
    const h = rasterToHash(raster(f));
    assert.equal(h.length, HASH_BITS / 4, `"${h}" is not 16 chars`);
    assert.match(h, /^[0-9a-f]{16}$/);
  }
});

test("a raster of the wrong size is refused, never hashed anyway", () => {
  // The dangerous failure: two short buffers would hash equal and read as a
  // duplicate. So a short raster is an error, not a hash of nothing.
  for (const bad of [Buffer.alloc(0), Buffer.alloc(10), Buffer.alloc(HASH_W * HASH_H - 1), Buffer.alloc(HASH_W * HASH_H + 1), null, "abc"]) {
    assert.throws(() => rasterToHash(bad), HashError, `${bad?.length ?? bad} should be refused`);
  }
});

test("brightness shifts do not move the hash; that is the point of a difference hash", () => {
  const base = raster((x, y) => (x * 13 + y * 29) % 200);
  const brighter = raster((x, y) => Math.min(255, ((x * 13 + y * 29) % 200) + 40));
  assert.equal(rasterToHash(base), rasterToHash(brighter));
});

test("hamming distance is symmetric, zero on identity, and 64 on inversion", () => {
  const a = "ffffffffffffffff";
  const b = "0000000000000000";
  assert.equal(hammingDistance(a, a), 0);
  assert.equal(hammingDistance(a, b), 64);
  assert.equal(hammingDistance(b, a), 64);
  assert.equal(hammingDistance("0000000000000001", "0000000000000000"), 1);
  assert.equal(hammingDistance("000000000000000f", "0000000000000000"), 4);
});

test("the same-file threshold absorbs noise without merging different pictures", () => {
  const a = "0000000000000000";
  assert.equal(SAME_FILE_MAX_DISTANCE, 6);
  assert.ok(isSameFile(a, "000000000000003f"), "6 bits apart is the same file re-encoded");
  assert.equal(isSameFile(a, "000000000000007f"), false, "7 bits apart is not");
  assert.equal(isSameFile(a, "ffffffffffffffff"), false);
});

test("sharesAnyFrame matches on ONE frame — a trimmed repost shares its middle", () => {
  const A = ["1111111111111111", "2222222222222222", "3333333333333333"];
  const B = ["9999999999999999", "2222222222222222"];
  assert.equal(sharesAnyFrame(A, B), true);
  assert.equal(sharesAnyFrame(A, ["9999999999999999"]), false);
  assert.equal(sharesAnyFrame([], A), false, "no frames cannot share a frame");
  assert.equal(sharesAnyFrame(A, []), false);
});

// ─── Grouping ───────────────────────────────────────────────────────────────

test("posts sharing a file collapse into one group, in input order", () => {
  const groups = groupByFile([
    { id: "a", hashes: ["1111111111111111"] },
    { id: "b", hashes: ["1111111111111111"] },
    { id: "c", hashes: ["ffffffffffffffff"] },
  ]);
  assert.deepEqual(groups, [["a", "b"], ["c"]]);
});

test("grouping is transitive — a~b, b~c gives one group, which UNDER-counts sources", () => {
  // Erring towards fewer independent sources is erring towards not verifying,
  // which is the safe direction for a corroboration count.
  const groups = groupByFile([
    { id: "a", hashes: ["0000000000000000"] },
    { id: "b", hashes: ["0000000000000007"] },   // 3 bits from a
    { id: "c", hashes: ["000000000000003f"] },   // 3 more from b, 6 from a
  ]);
  assert.equal(groups.length, 1);
});

test("an unhashed post is its own group — it cannot be shown to be a duplicate", () => {
  const groups = groupByFile([
    { id: "a", hashes: ["1111111111111111"] },
    { id: "b", hashes: [] },
    { id: "c" },
  ]);
  assert.deepEqual(groups, [["a"], ["b"], ["c"]]);
});

test("grouping an empty set yields no groups rather than one empty group", () => {
  assert.deepEqual(groupByFile([]), []);
});

// ─── The real decoder ───────────────────────────────────────────────────────

test("the real ffmpeg path produces a real hash, and identical inputs agree", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "incident-hash-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ff = getFFmpegPath();
  assert.ok(ff, "ffmpeg must resolve — it is a dependency of this repo, so this is a real failure, not a skip");

  const a = path.join(dir, "a.png");
  const b = path.join(dir, "b.png");
  const c = path.join(dir, "c.png");
  // Three synthetic images: a and b identical content, c different.
  await ffmpegRaw(["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:duration=1:rate=1", "-frames:v", "1", a]);
  await ffmpegRaw(["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:duration=1:rate=1", "-frames:v", "1", b]);
  await ffmpegRaw(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:size=320x240:duration=1:rate=1", "-frames:v", "1", c]);

  const [ha, hb, hc] = [await hashImage(a), await hashImage(b), await hashImage(c)];
  assert.match(ha, /^[0-9a-f]{16}$/);
  assert.equal(ha, hb, "the same picture must hash the same");
  assert.ok(isSameFile(ha, hb));
  assert.equal(isSameFile(ha, hc), false, "a test pattern and a black frame are not the same file");
});

test("keyframe hashing returns one hash per keyframe from a real encode", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "incident-hash-v-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const v = path.join(dir, "v.mp4");
  await ffmpegRaw([
    "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:duration=6:rate=25",
    "-c:v", "libx264", "-g", "25", "-pix_fmt", "yuv420p", v,
  ]);

  const hashes = await hashVideoKeyframes(v, { maxFrames: 8 });
  assert.ok(hashes.length >= 2, `expected several keyframes, got ${hashes.length}`);
  for (const h of hashes) assert.match(h, /^[0-9a-f]{16}$/);
  // The same file hashed twice must agree — a hash that varied per run would
  // make every repost look independent.
  assert.deepEqual(await hashVideoKeyframes(v, { maxFrames: 8 }), hashes);
});

test("a missing file is an error, not an empty hash", async () => {
  await assert.rejects(() => hashImage("/nope/does-not-exist.png"), HashError);
  await assert.rejects(() => hashVideoKeyframes("/nope/does-not-exist.mp4"), HashError);
});

test("a file ffmpeg cannot decode fails loudly rather than hashing garbage", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "incident-hash-bad-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const junk = path.join(dir, "junk.png");
  writeFileSync(junk, "this is not an image");
  await assert.rejects(() => hashImage(junk), HashError);
});
