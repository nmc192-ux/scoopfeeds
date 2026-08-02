/**
 * videoAssembler.js — keyframe states → slide segments → one MP4.
 *
 * DRIFT IS APPLIED AFTER CROSSFADE ASSEMBLY. This is a correctness
 * requirement, not a preference. If each state carried its own baked-in drift
 * offset, the crossfade would dissolve between two DIFFERENTLY-POSITIONED
 * compositions and every state boundary would visibly jump. So the filter
 * graph is strictly ordered: scale/pad each state → xfade them into one
 * continuous stream → and only then pan that stream. The drift is a property
 * of the assembled slide, which is the only level at which it is continuous.
 *
 * Requires ffmpeg >= 4.3 for `xfade`. Verified on the VPS 2026-08-02:
 * 5.1.9-0+deb12u1 with xfade present, installed via the Dockerfile's apt step.
 * getFFmpegPath() prefers system ffmpeg over the bundled 4.1 binary, which
 * lacks xfade and would silently degrade every transition to a hard cut.
 */

import { spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";
import path from "path";
import { logger } from "./logger.js";
import { getFFmpegPath } from "./videoGenerator.js";
import { CANVAS } from "./videoSlideRenderer.js";

export const CROSSFADE_SECS = Number.parseFloat(process.env.VIDEO_CROSSFADE_SECS || "0.35");
export const FPS = Number.parseInt(process.env.VIDEO_FPS || "25", 10);
export const SUPERSAMPLE = () => DRIFT_SUPERSAMPLE;

// 2% overscan gives ~38px horizontal and ~22px of travel — below the amplitude
// where text edges visibly resample, above the point where it reads as static.
const DRIFT_SCALE = Number.parseFloat(process.env.VIDEO_DRIFT_SCALE || "1.02");

// SUPERSAMPLE FACTOR for the drift. Measured 2026-08-02 by phase correlation
// across 25 consecutive frames: the drift advanced in discrete 2px JUMPS at
// irregular frames (2, 5, 8, 15, 16, 22), with dx and dy jumping on DIFFERENT
// frames — two axes twitching independently, which is what read as shake.
//
// Cause: the animated crop ran at OUTPUT resolution. The intended motion is
// ~0.3px/frame, but crop x/y are integers and yuv420p's chroma subsampling
// forces them even, so nothing moves until the accumulated offset crosses a
// 2px boundary and then it snaps. Two axes, two independent boundaries, hence
// the twitch rather than a push.
//
// Fix: do the crop in a 4x domain. A 2px quantised step at 4x is 0.5px at
// output — below the visible-motion threshold and, more importantly, the
// residual is a smooth ramp rather than a stall-and-snap.
const DRIFT_SUPERSAMPLE = Number.parseInt(process.env.VIDEO_DRIFT_SUPERSAMPLE || "4", 10);

// ENCODE, pinned rather than inherited. The demo came out at 129 kbps, which
// is fine for static dark frames — but that number is a CONSEQUENCE of this
// content, not a setting, and it would drift the moment card content changes.
// Pinning means quality is a decision instead of an emergent property.
const ENC = Object.freeze({
  codec:   process.env.VIDEO_X264_CODEC   || "libx264",
  preset:  process.env.VIDEO_X264_PRESET  || "medium",
  crf:     process.env.VIDEO_X264_CRF     || "18",
  pixFmt:  "yuv420p",       // the chroma format that forced the even-crop snap
  profile: "high",
  level:   "4.0",
});

function shellQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

function runFFmpeg(args, ffmpegPath) {
  const cmd = [ffmpegPath, ...args].map(shellQuote).join(" ");
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`)));
    proc.on("error", reject);
  });
}

/**
 * The filter graph for ONE slide: N still PNGs → crossfaded → drifted.
 *
 * xfade's `offset` is measured from the start of the COMBINED timeline, which
 * already includes every preceding overlap — not from the start of clip N.
 * Getting that wrong stacks the transitions on top of each other.
 */
export function buildSlideFilter({ stateCount, hold, crossfade = CROSSFADE_SECS, driftDir = 0 }) {
  const parts = [];
  for (let i = 0; i < stateCount; i++) {
    parts.push(`[${i}:v]scale=${CANVAS.w}:${CANVAS.h},setsar=1,format=yuv420p,fps=${FPS}[s${i}]`);
  }

  let last = "s0";
  let total = hold;
  if (stateCount > 1) {
    let offset = hold - crossfade;
    for (let i = 1; i < stateCount; i++) {
      const out = `xf${i}`;
      parts.push(`[${last}][s${i}]xfade=transition=fade:duration=${crossfade}:offset=${offset.toFixed(3)}[${out}]`);
      total += hold - crossfade;
      offset = total - crossfade;
      last = out;
    }
  }

  // ── Drift, applied to the ASSEMBLED stream, in a supersampled domain ──
  //
  // Order is load-bearing three times over:
  //   1. AFTER the last xfade — per-state drift would dissolve between two
  //      differently-positioned frames and every boundary would jump.
  //   2. UPSCALE BEFORE THE CROP — this is what buys sub-pixel precision. The
  //      crop's integer, chroma-even coordinates are 4x finer relative to the
  //      output, turning a 2px stall-and-snap into a 0.5px ramp.
  //   3. DOWNSCALE AFTER THE CROP, back to output. lanczos both ways: bilinear
  //      would soften the display type enough to see at Anton 340.
  const SS = Math.max(1, DRIFT_SUPERSAMPLE);
  const w2 = Math.round(CANVAS.w * DRIFT_SCALE) * SS;
  const h2 = Math.round(CANVAS.h * DRIFT_SCALE) * SS;
  const cw = CANVAS.w * SS, ch = CANVAS.h * SS;
  const dx = w2 - cw, dy = h2 - ch;
  const prog = `(t/${total.toFixed(3)})`;
  // Direction alternates by slide so a long video does not feel mechanical.
  const xExpr = driftDir % 2 === 0 ? `${dx}*${prog}` : `${dx}*(1-${prog})`;
  const yExpr = driftDir % 4 < 2   ? `${dy}*${prog}` : `${dy}*(1-${prog})`;
  parts.push(
    `[${last}]scale=${w2}:${h2}:flags=lanczos,` +
    `crop=${cw}:${ch}:x='${xExpr}':y='${yExpr}',` +
    `scale=${CANVAS.w}:${CANVAS.h}:flags=lanczos,setsar=1[out]`
  );

  return { filter: parts.join("; "), totalDuration: total };
}

/**
 * Assemble one slide's state PNGs into a silent MP4 segment.
 * `hold` is per-state; slide duration falls out of it.
 */
export async function assembleSlide({ statePaths, hold, outputPath, driftDir = 0, ffmpegPath = null }) {
  const ff = ffmpegPath || getFFmpegPath();
  if (!ff) throw new Error("videoAssembler: ffmpeg not available");
  if (!statePaths.length) throw new Error("videoAssembler: no states to assemble");

  const args = ["-y", "-loglevel", "error"];
  for (const p of statePaths) args.push("-loop", "1", "-t", String(hold), "-i", p);

  const { filter, totalDuration } = buildSlideFilter({ stateCount: statePaths.length, hold, driftDir });
  args.push(
    "-filter_complex", filter, "-map", "[out]",
    "-t", totalDuration.toFixed(3),
    "-c:v", ENC.codec, "-preset", ENC.preset, "-crf", ENC.crf,
    "-profile:v", ENC.profile, "-level", ENC.level,
    "-pix_fmt", ENC.pixFmt, "-r", String(FPS), "-g", String(FPS * 2), "-an",
    outputPath
  );
  await runFFmpeg(args, ff);
  return { outputPath, duration: totalDuration };
}

/** Concatenate slide segments into the finished silent MP4. */
export async function concatSlides({ segmentPaths, outputPath, workDir, ffmpegPath = null }) {
  const ff = ffmpegPath || getFFmpegPath();
  if (!ff) throw new Error("videoAssembler: ffmpeg not available");
  const listPath = path.join(workDir, "concat.txt");
  // The concat demuxer's own quoting, not JSON's: single quotes, with an
  // embedded quote escaped as '\''. JSON.stringify emits DOUBLE quotes, which
  // ffmpeg reads as part of the filename and then resolves relative to the
  // list file — producing a path with the quotes still in it.
  const quote = (p) => `'${String(p).replace(/'/g, `'\\''`)}'`;
  writeFileSync(listPath, segmentPaths.map(p => `file ${quote(p)}`).join("\n") + "\n");
  await runFFmpeg([
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath,
    "-c", "copy", "-movflags", "+faststart", outputPath,
  ], ff);
  if (!existsSync(outputPath)) throw new Error("videoAssembler: concat produced no output");
  return outputPath;
}

/** Does this ffmpeg actually have xfade? The keyframe design has no fallback. */
export async function assertXfadeAvailable(ffmpegPath = null) {
  const ff = ffmpegPath || getFFmpegPath();
  if (!ff) throw new Error("videoAssembler: ffmpeg not available");
  const { execSync } = await import("child_process");
  const out = execSync(`"${ff}" -hide_banner -filters 2>&1`, { timeout: 8000 }).toString();
  if (!/\sxfade\s/.test(out)) {
    throw new Error(
      "videoAssembler: this ffmpeg has no `xfade` filter. The keyframe renderer has no " +
      "hard-cut fallback — without crossfade there is no motion, only a slideshow of states. " +
      "Install system ffmpeg >= 4.3 (the Dockerfile does this)."
    );
  }
  logger.info(`🎬 videoAssembler: xfade available in ${ff}`);
  return true;
}
