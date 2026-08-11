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
import { CANVAS, MARGIN_X, DRIFT_SAFE_Y, COLORS } from "./videoSlideRenderer.js";
import { voiceGapSecs } from "./videoVoice.js";
import { writeFileSync as writeFileSync_ } from "fs";

export const CROSSFADE_SECS = Number.parseFloat(process.env.VIDEO_CROSSFADE_SECS || "0.35");
export const FPS = Number.parseInt(process.env.VIDEO_FPS || "25", 10);
export const SUPERSAMPLE = () => DRIFT_SUPERSAMPLE;
export const DRIFT_RATE = () => DRIFT_RATE_PX_PER_SEC;

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

// CONSTANT RATE, NOT FIXED AMPLITUDE (ruling 2026-08-02). Travelling the full
// overscan over the slide made per-frame displacement a function of DURATION:
// 0.24px/frame at 6.1s, but 0.42px at 3.5s and past the 0.5px criterion below
// that. Section 5 derives durations from audio, so short captions would have
// silently pushed the drift back over the line the supersampling just fixed.
//
// Pinning the RATE makes per-frame displacement invariant to duration:
// 6px/s at 25fps is 0.24px/frame for every slide, which is the figure that
// measured clean. Total travel is then rate x duration, capped by the 2%
// overscan — so a long slide drifts SLOWER than 6px/s once it hits the cap,
// never faster. The criterion is a ceiling, and this can only sit under it.
const DRIFT_RATE_PX_PER_SEC = Number.parseFloat(process.env.VIDEO_DRIFT_RATE || "6");

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
// ─── Burned captions ────────────────────────────────────────────────────────
//
// The caption is the SAME string that was voiced (brief §3: captions and
// voiceover come from one string so they cannot drift apart), burned into the
// slide it narrates.
//
// It is drawn AFTER the drift, deliberately. Captions that drift with the
// composition read as unstable — the eye tracks text, and 6px/s of movement
// under a line being read is exactly where it becomes noticeable. Burning
// post-crop also means they are rasterised at final resolution rather than
// resampled by the downscale.
export const CAPTION = Object.freeze({
  fontSize: 34,
  lineHeight: 44,
  // Inside the bottom band, above the progress line, and clear of the drift
  // margin. Nothing a card draws reaches here — the band exists for exactly
  // this and for YouTube's auto-hiding controls.
  bottomY: CANVAS.h - DRIFT_SAFE_Y - 18,
  // Measured, not guessed. The box padding is 14px a side, so the text itself
  // has to fit inside the content measure less that padding.
  maxWidth: CANVAS.w - 2 * (MARGIN_X + 60),
  maxLines: 2,
});

/**
 * Wrap a caption by MEASURED width, not by a character estimate.
 *
 * The character predictor was conservative: of four slides it flagged as
 * three-line, two rendered as two. Tightening captions against a wrong
 * predictor would have shortened narration for nothing, so the wrap now goes
 * through the real font at the real size (renderCore.wrapToWidth), with a
 * calibrated correction for satori-vs-drawtext advance.
 */
export async function wrapCaption(text, maxWidth = CAPTION.maxWidth) {
  const { wrapToWidth } = await import("./renderCore.js");
  if (!String(text || "").trim()) return [];
  return wrapToWidth(text, { fontSize: CAPTION.fontSize, maxWidth });
}

/**
 * The drawtext fragment for one caption.
 *
 * The text goes in a FILE rather than inline. drawtext treats `:`, `\`, `%`
 * and `'` as syntax, and a caption is prose written by a model — it will
 * eventually contain every one of them. `textfile=` sidesteps the whole class.
 */
export async function buildCaptionFilter({ text, workDir, slideIndex, fontFile }) {
  const lines = await wrapCaption(text);
  if (lines.length > CAPTION.maxLines) {
    logger.warn(
      `🎬 slide ${slideIndex}: caption wraps to ${lines.length} lines (max ${CAPTION.maxLines}) — ` +
      `it will sit higher than the band intends: "${String(text).slice(0, 60)}"`
    );
  }
  // ONE drawtext PER LINE. A single multi-line drawtext centres the BLOCK and
  // left-aligns the lines inside it, so a short second line hangs off to the
  // left of a long first one — visible immediately in the first render.
  // Per-line filters let each line centre on its own width.
  const blockH = lines.length * CAPTION.lineHeight;
  const top = CAPTION.bottomY - blockH;
  const esc = (v) => String(v).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

  return lines.map((line, i) => {
    const file = path.join(workDir, `caption-${String(slideIndex).padStart(2, "0")}-${i}.txt`);
    writeFileSync_(file, line, "utf8");
    return (
      `drawtext=fontfile='${esc(fontFile)}':textfile='${esc(file)}':` +
      `fontsize=${CAPTION.fontSize}:fontcolor=0xf5f2ea:` +
      `x=(w-text_w)/2:y=${Math.round(top + i * CAPTION.lineHeight)}:` +
      `box=1:boxcolor=0x090706@0.72:boxborderw=14`
    );
  }).join(",");
}

export function buildSlideFilter({ stateCount, hold, crossfade = CROSSFADE_SECS, driftDir = 0, caption = null }) {
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
  const maxX = w2 - cw, maxY = h2 - ch;      // the overscan cap, in SS units

  // Travel at a constant RATE along the overscan's own diagonal, so the
  // direction is unchanged and only the distance responds to duration.
  const maxMag = Math.hypot(maxX, maxY);
  const wantMag = DRIFT_RATE_PX_PER_SEC * SS * total;
  const mag = Math.min(wantMag, maxMag);
  const dx = Math.round(maxMag > 0 ? (maxX / maxMag) * mag : 0);
  const dy = Math.round(maxMag > 0 ? (maxY / maxMag) * mag : 0);

  const prog = `(t/${total.toFixed(3)})`;
  // Direction alternates by slide so a long video does not feel mechanical.
  const xExpr = driftDir % 2 === 0 ? `${dx}*${prog}` : `${dx}*(1-${prog})`;
  const yExpr = driftDir % 4 < 2   ? `${dy}*${prog}` : `${dy}*(1-${prog})`;
  // The crop window has to sit inside the scaled frame at every t, so the
  // start offset moves with the travel rather than the (larger) overscan.
  const padX = Math.max(0, maxX - dx), padY = Math.max(0, maxY - dy);
  // Captions come LAST in the chain — after the crop and the downscale — so
  // they neither drift nor get resampled.
  const captionChain = caption ? `,${caption}` : "";
  parts.push(
    `[${last}]scale=${w2}:${h2}:flags=lanczos,` +
    `crop=${cw}:${ch}:x='${Math.round(padX / 2)}+${xExpr}':y='${Math.round(padY / 2)}+${yExpr}',` +
    `scale=${CANVAS.w}:${CANVAS.h}:flags=lanczos,setsar=1${captionChain}[out]`
  );

  return { filter: parts.join("; "), totalDuration: total };
}

/**
 * SLIDE DURATION IS AUDIO DURATION (§5). Given N states and the audio's own
 * length, this is the per-state hold that makes the video land exactly on it:
 *
 *   total = N*hold - (N-1)*crossfade   =>   hold = (total + (N-1)*xf) / N
 *
 * A short tail of silence is added so the last word is not clipped by the hard
 * cut into the next slide.
 *
 * TWO TAILS, TWO JOBS. SLIDE_TAIL_SECS is mechanical — it exists so the final
 * consonant survives the cut, and 0.3s is the smallest value that does that.
 * VIDEO_VOICE_GAP_MS (voiceGapSecs) is editorial — it is the pause BETWEEN
 * IDEAS that separates documentary narration from podcast narration, and it is
 * the knob a reader of this file is meant to turn. Collapsing them into one
 * number would mean re-deriving the clipping margin every time the pacing
 * changes, and the first person to shorten the pause would clip every slide.
 */
export const SLIDE_TAIL_SECS = Number.parseFloat(process.env.VIDEO_SLIDE_TAIL || "0.3");

/** Audio + the mechanical tail + the editorial gap. The slide's true length. */
export function slideTotalSecs(audioSecs) {
  return audioSecs + SLIDE_TAIL_SECS + voiceGapSecs();
}

export function holdForAudio(audioSecs, stateCount, crossfade = CROSSFADE_SECS) {
  return (slideTotalSecs(audioSecs) + (stateCount - 1) * crossfade) / stateCount;
}

/**
 * Assemble one slide: state PNGs → crossfade → drift → caption → + its audio.
 *
 * Pass `audioPath` and the segment carries that slide's narration, with the
 * video timed to it. Without it the segment is silent (the motion-review path).
 */
export async function assembleSlide({
  statePaths, hold, outputPath, driftDir = 0, ffmpegPath = null,
  audioPath = null, captionText = null, workDir = null, fontFile = null,
}) {
  const ff = ffmpegPath || getFFmpegPath();
  if (!ff) throw new Error("videoAssembler: ffmpeg not available");
  if (!statePaths.length) throw new Error("videoAssembler: no states to assemble");

  const args = ["-y", "-loglevel", "error"];
  for (const p of statePaths) args.push("-loop", "1", "-t", String(hold), "-i", p);
  const audioIdx = statePaths.length;
  if (audioPath) args.push("-i", audioPath);

  const caption = (captionText && workDir && fontFile)
    ? await buildCaptionFilter({ text: captionText, workDir, slideIndex: driftDir, fontFile })
    : null;

  const { filter, totalDuration } = buildSlideFilter({
    stateCount: statePaths.length, hold, driftDir, caption,
  });

  args.push("-filter_complex", filter, "-map", "[out]");
  if (audioPath) args.push("-map", `${audioIdx}:a`);
  args.push(
    "-t", totalDuration.toFixed(3),
    "-c:v", ENC.codec, "-preset", ENC.preset, "-crf", ENC.crf,
    "-profile:v", ENC.profile, "-level", ENC.level,
    "-pix_fmt", ENC.pixFmt, "-r", String(FPS), "-g", String(FPS * 2),
  );
  if (audioPath) {
    // Pad rather than -shortest: the tail of silence is deliberate, and
    // -shortest would trim the video back to the audio and remove it. The
    // editorial gap is padded here too — it is real trailing silence on this
    // slide's audio, just not baked into the cached MP3, so re-pacing the
    // channel costs nothing at ElevenLabs. The +0.5 stays a margin over the
    // longest thing the video can be, not a third tail.
    args.push("-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
              "-af", `apad=pad_dur=${(SLIDE_TAIL_SECS + voiceGapSecs() + 0.5).toFixed(3)}`);
  } else {
    args.push("-an");
  }
  args.push(outputPath);
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
