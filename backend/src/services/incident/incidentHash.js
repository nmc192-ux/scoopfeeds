/**
 * incidentHash.js — perceptual hashing, with no new dependency.
 *
 * WHAT IT IS FOR. Two posts of "the same incident" are corroboration; two posts
 * of the SAME FILE are one post shared twice, and counting them as two would let
 * a single source corroborate itself. Collapsing reposts is the difference
 * between a corroboration check and a repost counter.
 *
 * WHY dHASH AND NOT A LIBRARY. Grounding measured this: the bundled static
 * ffmpeg already renders any image or video frame to a 9x8 grayscale raster in
 * one call, which is exactly the input a 64-bit difference hash needs. The
 * comparison is then integer work. Adding an image library for it would put a
 * new native surface in the tree to do arithmetic we can do in nine lines.
 *
 * WHY DIFFERENCE HASH AND NOT AVERAGE HASH. dHash compares each pixel with its
 * right-hand neighbour, so it keys on gradients rather than absolute
 * brightness. Re-encodes, platform recompression and the brightness shifts a
 * repost picks up on its way through three apps move an aHash and mostly do not
 * move a dHash. It is not robust to crops or mirroring, and it is not meant to
 * be: a cropped re-upload IS a different file for our purposes, and the human
 * queue is where that judgement belongs.
 *
 * THIS IS NOT A VERIFICATION ORACLE. A hash match proves two candidates carry
 * the same pixels. It proves nothing about when they were taken, where, or by
 * whom. Everything this module returns is an input to a check, never a verdict.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { getFFmpegPath } from "../videoGenerator.js";
import { logger } from "../logger.js";

/** dHash geometry: 9 columns give 8 horizontal comparisons per row. */
export const HASH_W = 9;
export const HASH_H = 8;
export const HASH_BITS = (HASH_W - 1) * HASH_H;   // 64

/** How long a single ffmpeg decode may take before it is abandoned. */
const DECODE_TIMEOUT_MS = 20_000;

export class HashError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "HashError";
    this.code = code;
  }
}

/**
 * Run ffmpeg and collect raw stdout bytes.
 *
 * Kept separate and injectable so every rule above it is testable without a
 * decoder — the same discipline longformFootageRelevance uses for its embedder.
 */
export async function ffmpegRaw(args, { ffmpegPath = null, timeoutMs = DECODE_TIMEOUT_MS } = {}) {
  const ff = ffmpegPath || getFFmpegPath();
  if (!ff) throw new HashError("ffmpeg not available — a hash cannot be measured", { code: "no-ffmpeg" });

  return new Promise((resolve, reject) => {
    const proc = spawn(ff, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new HashError(`ffmpeg timed out after ${timeoutMs}ms`, { code: "timeout" }));
    }, timeoutMs);

    proc.stdout.on("data", (d) => chunks.push(d));
    proc.stderr.on("data", (d) => { stderr += d.toString().slice(0, 2000); });
    proc.on("error", (err) => { clearTimeout(timer); reject(new HashError(err.message, { code: "spawn-failed" })); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new HashError(`ffmpeg exited ${code}: ${stderr.trim().slice(0, 300)}`, { code: "ffmpeg-failed" }));
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

/**
 * Turn a 9x8 grayscale raster into a 64-bit difference hash.
 *
 * REFUSES A RASTER OF THE WRONG SIZE rather than hashing whatever it was given.
 * A short buffer would otherwise produce a hash that is stable, plausible and
 * meaningless — and two such hashes would compare equal, which is the worst
 * possible failure for a check whose job is to spot duplicates.
 */
export function rasterToHash(buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== HASH_W * HASH_H) {
    throw new HashError(
      `expected a ${HASH_W}x${HASH_H} grayscale raster (${HASH_W * HASH_H} bytes), got ${buf?.length ?? "nothing"}. ` +
      "Hashing a short buffer would produce a plausible hash of nothing.",
      { code: "bad-raster" }
    );
  }
  let bits = "";
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) {
      bits += buf[y * HASH_W + x] > buf[y * HASH_W + x + 1] ? "1" : "0";
    }
  }
  // 16 hex chars, zero-padded, so hashes are comparable as strings and sortable.
  return BigInt(`0b${bits}`).toString(16).padStart(HASH_BITS / 4, "0");
}

/** The ffmpeg filter that produces the raster. One place, both call sites. */
const RASTER_ARGS = ["-vf", `scale=${HASH_W}:${HASH_H},format=gray`, "-f", "rawvideo", "-pix_fmt", "gray", "-"];

/** Perceptual hash of a still image. */
export async function hashImage(path, { ffmpegPath = null } = {}) {
  if (!existsSync(path)) throw new HashError(`no such file: ${path}`, { code: "no-file" });
  const raw = await ffmpegRaw(["-v", "error", "-i", path, "-frames:v", "1", ...RASTER_ARGS], { ffmpegPath });
  return rasterToHash(raw);
}

/**
 * Perceptual hashes of a video's keyframes, in order.
 *
 * KEYFRAMES, NOT A FIXED SAMPLE RATE. `-skip_frame nokey` gives the frames the
 * encoder itself chose as scene anchors, so the sample tracks the content
 * rather than the clock — a 4-second clip and a 40-second clip both yield the
 * shots they actually contain. It is also far cheaper: no full decode.
 */
export async function hashVideoKeyframes(path, { ffmpegPath = null, maxFrames = 8 } = {}) {
  if (!existsSync(path)) throw new HashError(`no such file: ${path}`, { code: "no-file" });
  const raw = await ffmpegRaw(
    ["-v", "error", "-skip_frame", "nokey", "-i", path, "-vsync", "0", "-frames:v", String(maxFrames), ...RASTER_ARGS],
    { ffmpegPath }
  );
  const frameSize = HASH_W * HASH_H;
  if (raw.length === 0 || raw.length % frameSize !== 0) {
    throw new HashError(
      `keyframe raster is ${raw.length} bytes, not a whole number of ${frameSize}-byte frames — the decode is unusable`,
      { code: "bad-raster" }
    );
  }
  const hashes = [];
  for (let i = 0; i < raw.length; i += frameSize) {
    hashes.push(rasterToHash(raw.subarray(i, i + frameSize)));
  }
  return hashes;
}

/** Bit distance between two hex hashes. 0 = identical, 64 = inverted. */
export function hammingDistance(a, b) {
  const x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = x;
  let count = 0;
  while (n > 0n) { count += Number(n & 1n); n >>= 1n; }
  return count;
}

/**
 * Distance at or below which two hashes are treated as the same file.
 *
 * 6 of 64 bits (~9%). Chosen to absorb re-encode and recompression noise while
 * staying well clear of "two photographs of the same scene", which typically
 * differ by 20+ bits. It is deliberately CONSERVATIVE in the direction that
 * matters: an over-tight threshold splits a repost into two candidates, and a
 * human notices two identical thumbnails in the queue. An over-loose one merges
 * two genuinely independent posts, which silently destroys the corroboration the
 * whole check is counting — and nothing downstream can detect that it happened.
 */
export const SAME_FILE_MAX_DISTANCE = 6;

/** Are these the same file, allowing for re-encode noise? */
export function isSameFile(a, b, maxDistance = SAME_FILE_MAX_DISTANCE) {
  return hammingDistance(a, b) <= maxDistance;
}

/**
 * Do two candidates share any frame?
 *
 * ANY-FRAME, not all-frames: a repost trimmed to a different length shares its
 * middle but not its edges, and one shared keyframe is already proof the same
 * footage is underneath. Images are the one-hash case of the same rule.
 */
export function sharesAnyFrame(hashesA = [], hashesB = [], maxDistance = SAME_FILE_MAX_DISTANCE) {
  for (const a of hashesA) {
    for (const b of hashesB) {
      if (isSameFile(a, b, maxDistance)) return true;
    }
  }
  return false;
}

/**
 * Collapse a set of candidates into distinct-file groups.
 *
 * Each entry is `{ id, hashes }`. Returns groups of ids that share footage, in
 * input order, so the caller can count DISTINCT SOURCES rather than posts.
 *
 * Transitivity is taken as given (a shares with b, b with c ⇒ one group). That
 * is not strictly true of a distance threshold, and it is the safe direction:
 * it merges more aggressively, which lowers the corroboration count. Erring
 * towards fewer independent sources is erring towards not verifying.
 */
export function groupByFile(entries = [], maxDistance = SAME_FILE_MAX_DISTANCE) {
  const groups = [];
  for (const entry of entries) {
    const hit = groups.find((g) => sharesAnyFrame(g.hashes, entry.hashes || [], maxDistance));
    if (hit) {
      hit.ids.push(entry.id);
      hit.hashes.push(...(entry.hashes || []));
    } else {
      groups.push({ ids: [entry.id], hashes: [...(entry.hashes || [])] });
    }
  }
  if (groups.length < entries.length) {
    logger.info(`🎥 incident: ${entries.length} post(s) collapsed to ${groups.length} distinct file(s) by perceptual hash`);
  }
  return groups.map((g) => g.ids);
}
