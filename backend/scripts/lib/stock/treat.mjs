/**
 * treat.mjs — grade a staged clip into the house palette (brief §3b).
 *
 * The grade is NOT restated here. `GRADES` in
 * src/services/longform/storyboardInterpreter.js is the single source of truth for
 * the house look, and its own header says grades are engine behaviour rather than
 * per-asset judgement. This file imports it and applies one documented change.
 *
 * THE COOLING FIX (§3b). The brief records that the Aug 14 prototype "read
 * strongly olive" and that the fix was identified as a one-line coefficient
 * change. In `GRADES.default` the olive is arithmetic, not opinion:
 *
 *   colorbalance=rs=-0.06:gs=0.02:bs=-0.08:rm=-0.03:gm=0.03:bm=-0.06
 *
 * blue is pulled down in both shadows and midtones while green is the only
 * channel lifted — a green-dominant, warm-desaturated cast. The `marine` grade in
 * the same file is already the cool version of the identical chain (bs=0.04,
 * bm=0.03), so the fix is to take the blue terms positive to match it. That is
 * the one line changed; saturation, contrast, gamma and vignette are untouched.
 *
 * NOTE: the repo carries no comment recording the intended fix, so which
 * coefficients to move was inferred from `marine`. Worth a human confirming the
 * look on the first treated batch.
 *
 * Framing is deliberately NOT changed here. A 9:16 crop baked into the library
 * would throw away reframing latitude that render-time selection may want, and
 * framing belongs to the later selection brief. Treatment means the grade.
 */

import { execFile } from "child_process";
import { createRequire } from "module";
import { existsSync, statSync } from "fs";
import path from "path";
import { promisify } from "util";
import { GRADES } from "../../../src/services/longform/storyboardInterpreter.js";

const execFileP = promisify(execFile);
const require = createRequire(import.meta.url);

/** Blue lift matching the `marine` grade — see the cooling-fix note above. */
export const COOL_BLUE_SHADOWS = "0.04";
export const COOL_BLUE_MIDS = "0.03";

/** Take the blue terms of a colorbalance chain positive. */
export function coolGrade(chain) {
  return String(chain)
    .replace(/\bbs=-?[\d.]+/, `bs=${COOL_BLUE_SHADOWS}`)
    .replace(/\bbm=-?[\d.]+/, `bm=${COOL_BLUE_MIDS}`);
}

/** The library grade: the house default, cooled. */
export const LIBRARY_GRADE = coolGrade(GRADES.default);

/**
 * Static grain, strength 14 — the treatment measured in the prototype and used by
 * src/services/videoAssembler.js (`noise=alls=14:allf=u:all_seed=20260814`; the
 * seed is the Aug 14 date). `allf=u` is uniform/static: temporal grain cost 4× the
 * encode time in that measurement and must not be substituted.
 *
 * Default is OFF (brief Q1): grain applied here is re-encoded again at assembly,
 * so the library stores grade-only masters and grain stays a render decision.
 */
export const GRAIN_CHAINS = Object.freeze({
  none: "",
  static14: "noise=alls=14:allf=u:all_seed=20260814",
});

/**
 * Treated assets are written at DELIVERY resolution, not at the master's.
 *
 * Renders are 1080x1920 and a cutaway is 1.5-3s of it, so every pixel above
 * 1080 wide was being carried to the VPS and then discarded at assembly. The
 * masters in staging/ stay 2160x3840 and untouched — they are the re-treat
 * source, and the only reason this is a safe one-way change.
 *
 * The downscale happens in the SAME pass as the grade. A second encode to
 * resize would decode and re-encode the graded output, which costs quality for
 * nothing.
 */
export const DELIVERY = Object.freeze({ width: 1080, height: 1920 });
const DELIVERY_AR = DELIVERY.width / DELIVERY.height;

/** Is this source the delivery aspect (9:16), so a straight scale is lossless in framing? */
export function isDeliveryAspect(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
  return Math.abs(w / h - DELIVERY_AR) < 0.005;
}

/**
 * THE ENCODE QUALITY, AND WHY IT IS 20 RATHER THAN 18.
 *
 * crf 18 was the original choice and it was wrong in a way that showed up in the
 * library: it is finer than a typical provider delivery encode, so re-encoding
 * an already-compressed clip spent bits describing its compression artefacts.
 * ships-0008 GREW on treatment, 160.5 MB -> 192.0 MB.
 *
 * Measured here rather than chosen by convention, on 4K portrait sources first
 * encoded at crf 23 to imitate a provider delivery file, graded and downscaled
 * to 1080x1920, and compared against a LOSSLESS render of the same downscale and
 * grade so the numbers isolate encode loss:
 *
 *   crf   detail-like            smooth/gradient-like
 *   16    3.04 MB  PSNR 50.9     5.71 MB  PSNR 48.0
 *   18    2.16 MB  PSNR 49.5     4.33 MB  PSNR 46.7
 *   20    1.42 MB  PSNR 48.0     3.23 MB  PSNR 45.3   <- chosen
 *   22    0.96 MB  PSNR 46.8     2.34 MB  PSNR 43.8
 *   24    0.64 MB  PSNR 45.7     1.63 MB  PSNR 42.5
 *
 * The curve has no knee — it is a straight trade — so the value is a judgement
 * about where this library sits. 20 takes 25-34% off 18 while holding 45-48 dB,
 * which is comfortably inside visually-transparent territory for content that
 * has already lost most of its hard-to-encode detail in a 4x downscale.
 *
 * NOT lower than 20: the grade ends in `vignette`, which is a smooth luminance
 * ramp, and gradients are what band first. The gradient-like column is the
 * proxy for that and it is the one that falls off faster — 45.3 dB at 20
 * against 43.8 at 22. Saving another megabyte per clip is not worth banding a
 * vignette in a library that is encoded once and used many times, especially
 * when the whole library at 11 subject classes lands near 1.3 GB either way.
 *
 * If this is ever revisited, revisit it with a measurement on REAL masters —
 * the numbers above come from synthetic sources (see the PR).
 */
export const LIBRARY_CRF = "20";

export function buildFilterChain(grain = "none") {
  const grainChain = GRAIN_CHAINS[grain];
  if (grainChain === undefined) {
    throw new Error(`unknown grain option \`${grain}\` — expected one of: ${Object.keys(GRAIN_CHAINS).join(", ")}`);
  }
  // Scale FIRST: grading fewer pixels is cheaper and identical in result, and it
  // keeps the vignette sized to the delivery frame rather than the master's.
  const scale = `scale=${DELIVERY.width}:${DELIVERY.height}:flags=lanczos`;
  return [scale, LIBRARY_GRADE, grainChain, "format=yuv420p"].filter(Boolean).join(",");
}

/**
 * Resolve ffmpeg without importing the render path. Same order as
 * src/services/videoGenerator.js's getFFmpegPath (FFMPEG_PATH → PATH → bundled),
 * kept local so this tooling stays separable from the runtime (§2c) and adds no
 * dependency (§2b) — @ffmpeg-installer/ffmpeg is already a backend dependency.
 */
export function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "ffmpeg");
    if (existsSync(candidate)) return candidate;
  }
  try {
    return require("@ffmpeg-installer/ffmpeg")?.path || null;
  } catch {
    return null;
  }
}

/**
 * Grade one file. Never writes over `sourcePath` (§3b) — refuses if asked to.
 * Returns { treated: true, bytes } or throws with a readable reason.
 */
export async function treatFile({
  sourcePath, outputPath, grain = "none", ffmpegPath = resolveFfmpeg(),
  sourceWidth = null, sourceHeight = null,
}) {
  if (!ffmpegPath) {
    throw new Error(
      "no ffmpeg available: set FFMPEG_PATH, install ffmpeg on PATH, or install backend dependencies " +
        "(@ffmpeg-installer/ffmpeg). Brief §10 asks that the Mac's ffmpeg be current before the first treat run."
    );
  }
  if (!existsSync(sourcePath)) throw new Error(`source missing: ${sourcePath}`);
  // A STRAIGHT SCALE, NEVER A SILENT CROP. The library is native-portrait by
  // construction — the crop gate only accepts 9:16 or downscales 4K landscape —
  // so a source of another shape means something upstream changed. Scaling it
  // anyway would stretch the picture, and cropping it would silently reframe
  // someone else's shot. Both are worse than stopping and saying so.
  if (sourceWidth !== null && sourceHeight !== null && !isDeliveryAspect(sourceWidth, sourceHeight)) {
    throw new Error(
      `refusing to treat ${path.basename(sourcePath)}: ${sourceWidth}x${sourceHeight} is not the ` +
      `${DELIVERY.width}x${DELIVERY.height} delivery aspect. Treatment scales, it does not crop — ` +
      "reframing is a human decision made at curation, not one to make here."
    );
  }
  if (path.resolve(sourcePath) === path.resolve(outputPath)) {
    throw new Error(`refusing to treat ${sourcePath} onto itself — the source download is never overwritten (§3b)`);
  }

  await execFileP(
    ffmpegPath,
    ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", sourcePath,
      "-vf", buildFilterChain(grain),
      // Silent masters: these are 1.5-3s cutaways under narration; the film owns its audio bed.
      "-an", "-c:v", "libx264", "-crf", LIBRARY_CRF, "-preset", "medium", "-pix_fmt", "yuv420p",
      outputPath],
    { maxBuffer: 1 << 26 }
  );

  if (!existsSync(outputPath)) throw new Error(`ffmpeg reported success but ${outputPath} does not exist`);
  const bytes = statSync(outputPath).size;
  if (bytes === 0) throw new Error(`ffmpeg produced an empty file at ${outputPath}`);
  return { treated: true, bytes };
}
