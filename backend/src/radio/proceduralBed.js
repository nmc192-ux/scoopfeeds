/**
 * proceduralBed.js — the radio's FALLBACK music bed: a quiet synthesised pad, made by ffmpeg from sine
 * waves. No AI model, no samples, no licence, nothing a copyright system can match (#208).
 *
 * It airs only when the music library has no cleared bed (musicManifest.js). DrJ, 22 Oct 2026: "the
 * procedural bed stays as a fallback only". Same lineage as services/longform/engine/music.mjs (pure
 * synthesis), but self-contained: that engine needs a film's storyboard.
 *
 * The loop is seamless: every frequency completes a whole number of cycles in LOOP_SEC, so the looped
 * feeder never clicks at the seam. Rendered once into <music dir>/_procedural/ (not a daypart folder, so
 * listFiles never sees it) and reused.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const LOOP_SEC = 120;
export const VERSION = "v1";
// [Hz left, Hz right, gain, swell Hz]: each Hz × LOOP_SEC is a whole number (a seamless loop).
const VOICES = [[110, 110, 0.10, 0.05], [165, 165.5, 0.06, 0.075], [220, 220.5, 0.05, 0.025], [262, 261.5, 0.035, 0.0583333333]];

export const VOICES_FOR_TEST = VOICES.map(([l, r, , sw]) => [l, r, sw]);
const voice = (hz, g, sw, ph) => `${g}*sin(2*PI*${hz}*t)*(0.65+0.35*sin(2*PI*${sw}*t+${ph}))`;
export function proceduralExpr() {
  const L = VOICES.map(([l, , g, sw], i) => voice(l, g, sw, i)).join("+");
  const R = VOICES.map(([, r, g, sw], i) => voice(r, g, sw, i + 0.5)).join("+");
  return `${L}|${R}`;
}

export function proceduralArgs(out, seconds = LOOP_SEC) {
  return ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `aevalsrc=${proceduralExpr()}:s=48000:d=${seconds}`,
    "-af", "lowpass=f=1800,volume=0.9", "-c:a", "pcm_s16le", out];
}

export const proceduralPath = (dir) => path.join(dir, "_procedural", `radio-bed-${VERSION}.wav`);

/** The fallback bed's path, rendering it first if needed. Throws if ffmpeg cannot make it. */
export function ensureProceduralBed(dir, { ffmpeg = process.env.FFMPEG || "ffmpeg" } = {}) {
  const out = proceduralPath(dir);
  try { if (fs.statSync(out).size > 1_000_000) return out; } catch { /* render it */ }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.tmp.wav`;
  const r = spawnSync(ffmpeg, proceduralArgs(tmp), { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) { fs.rmSync(tmp, { force: true }); throw new Error(`procedural bed render failed: ${String(r.stderr || r.error?.message || "").slice(-300)}`); }
  fs.renameSync(tmp, out);
  return out;
}
