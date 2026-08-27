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

export function buildFilterChain(grain = "none") {
  const grainChain = GRAIN_CHAINS[grain];
  if (grainChain === undefined) {
    throw new Error(`unknown grain option \`${grain}\` — expected one of: ${Object.keys(GRAIN_CHAINS).join(", ")}`);
  }
  return [LIBRARY_GRADE, grainChain, "format=yuv420p"].filter(Boolean).join(",");
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
export async function treatFile({ sourcePath, outputPath, grain = "none", ffmpegPath = resolveFfmpeg() }) {
  if (!ffmpegPath) {
    throw new Error(
      "no ffmpeg available: set FFMPEG_PATH, install ffmpeg on PATH, or install backend dependencies " +
        "(@ffmpeg-installer/ffmpeg). Brief §10 asks that the Mac's ffmpeg be current before the first treat run."
    );
  }
  if (!existsSync(sourcePath)) throw new Error(`source missing: ${sourcePath}`);
  if (path.resolve(sourcePath) === path.resolve(outputPath)) {
    throw new Error(`refusing to treat ${sourcePath} onto itself — the source download is never overwritten (§3b)`);
  }

  await execFileP(
    ffmpegPath,
    ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", sourcePath,
      "-vf", buildFilterChain(grain),
      // Silent masters: these are 1.5-3s cutaways under narration; the film owns its audio bed.
      "-an", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
      outputPath],
    { maxBuffer: 1 << 26 }
  );

  if (!existsSync(outputPath)) throw new Error(`ffmpeg reported success but ${outputPath} does not exist`);
  const bytes = statSync(outputPath).size;
  if (bytes === 0) throw new Error(`ffmpeg produced an empty file at ${outputPath}`);
  return { treated: true, bytes };
}
