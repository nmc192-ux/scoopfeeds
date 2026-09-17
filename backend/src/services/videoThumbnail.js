/**
 * videoThumbnail.js — the poster frame for an automated short.
 *
 * WHY THIS EXISTS. The daily loop published shorts with no thumbnail at all, so
 * every platform picked its own frame. YouTube grabs one at random, Instagram
 * was handed `thumb_offset: 1000` (whatever happens to be on screen at 1.0s,
 * which on our cards is usually the title mid-animation), and Facebook chose
 * for itself. The channel page is the shop window and nobody was dressing it.
 *
 * ── THE PICTURE IS NOT CHOSEN HERE ──────────────────────────────────────────
 *
 * The thumbnail reuses THE SUBJECT VISUAL THE VIDEO ALREADY RESOLVED — the
 * photograph, map or flag that `produceVideo` picked for the establishing
 * shot — and it never goes looking for one of its own. A second selection path
 * would be a second thing that can disagree with the spec's declared subject,
 * and the tariffs failure (a story about a continent-wide system illustrated
 * with a photograph of two people) is exactly what that costs. If the video
 * resolved no picture, the thumbnail is type on the house ground, which is a
 * correct thumbnail and not a degraded one.
 *
 * ── THE CENTRE SQUARE IS THE ONLY PART YOU CAN COUNT ON ─────────────────────
 *
 * Instagram displays a Reel cover CENTRE-CROPPED TO 1080x1080 on the profile
 * grid. So a hook laid out against the bottom of a 1080x1920 frame — where the
 * video's own caption sits — is a hook nobody reading the grid ever sees. The
 * type block is therefore constrained to the centre square, and
 * `centreSquareBox()` plus its test pin that, because it is the sort of rule
 * that is invisible until a month of covers have shipped cropped.
 *
 * Vertical safe margins and marginX 104 still apply on top of that: the frame
 * is shared with platform furniture whichever surface it lands on.
 *
 * ── SAME RASTERISER AS THE VIDEO ────────────────────────────────────────────
 *
 * The type layer goes through `renderTreeToPng` — the same satori + resvg path
 * every slide uses, with the same fonts and the same primitives — so the
 * thumbnail cannot drift from the frames it fronts. The picture is composited
 * BEHIND the type by ffmpeg, which is the order #140 established for the video
 * and is the same order for the same reason.
 */

import { execFileSync } from "node:child_process";
import { existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { renderTreeToPng } from "./renderCore.js";
import { logger } from "./logger.js";
import { geometryFor } from "./videoGeometry.js";
import { makePrimitives, COLORS as C, FONTS as F, GROUND } from "./videoSlideChrome.js";
import { getFFmpegPath } from "./videoGenerator.js";

/** Dark unless the flag is literally "1", per house convention. */
export const thumbnailEnabled = () => process.env.VIDEO_THUMBNAIL_ENABLED === "1";

/**
 * YouTube rejects a thumbnail over 2 MB outright. We encode JPEG and step the
 * quality down rather than shipping a file the API will refuse — a refusal
 * would land AFTER the video is already public, which is the worst moment to
 * discover it.
 */
export const MAX_BYTES = 2 * 1024 * 1024;
const JPEG_QUALITY_LADDER = [3, 5, 8, 12];   // ffmpeg -q:v, lower is better

/**
 * The region that survives Instagram's profile-grid crop, in canvas pixels.
 * Everything that must be READ belongs inside this box.
 */
export function centreSquareBox(g) {
  const side = g.canvas.w;                       // 1080 — the crop is square
  const top = Math.round((g.canvas.h - side) / 2);
  return { left: 0, top, width: side, height: side, bottom: top + side };
}

/**
 * Anton advance is baked in videoSlideChrome for synchronous fitting; here the
 * hook is short by construction, so a character budget per line is enough and
 * keeps this function pure. Two lines maximum — a third does not survive being
 * looked at for the half second a thumbnail gets.
 */
export const MAX_HOOK_LINES = 2;
const HOOK_CHARS = 17;

export function hookLines(text, { maxLines = MAX_HOOK_LINES, perLine = HOOK_CHARS } = {}) {
  const words = String(text || "")
    .toUpperCase()
    .replace(/[^\w\s£$%€—-]/g, " ")
    .trim().split(/\s+/).filter(Boolean);
  const lines = [];
  for (const w of words) {
    if (lines.length && (`${lines[lines.length - 1]} ${w}`).length <= perLine) {
      lines[lines.length - 1] += ` ${w}`;
    } else if (lines.length < maxLines) {
      lines.push(w);
    } else break;
  }
  // Never end on a connective — a cut hook should read as a statement, not as
  // a sentence someone interrupted.
  const STOP = new Set(["AND", "OR", "OF", "IN", "ON", "TO", "THE", "A", "AN", "AS",
                        "BY", "FOR", "WITH", "THAT", "IS", "ARE", "WAS", "WERE", "AT", "FROM"]);
  while (lines.length) {
    const parts = lines[lines.length - 1].split(" ");
    if (parts.length > 1 && STOP.has(parts[parts.length - 1])) {
      parts.pop();
      lines[lines.length - 1] = parts.join(" ");
    } else if (parts.length === 1 && STOP.has(parts[0]) && lines.length > 1) {
      lines.pop();
    } else break;
  }
  return lines;
}

/**
 * The type layer, as a satori tree.
 *
 * `hasPicture` decides the ground, exactly as a card does: over a resolved
 * subject visual this is a TRANSPARENT overlay and the picture supplies what is
 * behind it; with no picture it paints the house ground itself.
 */
export function thumbnailTree({ hook, outlet = null, hasPicture = false, orientation = "vertical" }) {
  const g = geometryFor(orientation);
  const P = makePrimitives(g);
  const { root, text, abs, antonLine } = P;
  const lines = hookLines(hook);
  if (!lines.length) throw new Error("videoThumbnail: no hook lines — a thumbnail with no type is an empty frame");

  const box = centreSquareBox(g);
  const SIZE = lines.length > 1 ? 120 : 134;
  const LEAD = Math.round(SIZE * 1.02);
  const blockH = lines.length * LEAD;
  // Sit the block low in the centre square, so the picture keeps the upper half
  // and the type still lands inside the crop.
  const blockTop = box.bottom - blockH - 96;

  const children = [];

  // A gradient backing, and ONLY where the type sits. The flat drawbox scrim
  // was removed from the video for reading as a seam across the photograph
  // (videoSubjectVisual.js) — the same objection applies here, so the darkening
  // is a ramp that belongs to the type block rather than a band across the frame.
  if (hasPicture) {
    children.push(abs({
      left: 0, top: blockTop - 190, width: g.canvas.w, height: blockH + 300,
      backgroundImage: `linear-gradient(180deg, rgba(9,7,6,0) 0%, rgba(9,7,6,0.82) 34%, rgba(9,7,6,0.92) 100%)`,
    }));
  }

  // Brand chrome. The wordmark only — no slide counter, because a thumbnail is
  // not a slide and a "1 / 6" on the shop window is a lie about what it is.
  children.push(text("SCOOPFEEDS", {
    position: "absolute", left: g.marginX, top: g.chromeTopY,
    fontSize: 26, fontWeight: 600, letterSpacing: 6, color: C.faint,
  }));
  if (outlet) {
    children.push(text(String(outlet).toUpperCase(), {
      position: "absolute", right: g.marginX, top: g.chromeTopY,
      fontSize: 26, fontWeight: 600, letterSpacing: 5, color: C.dim,
    }));
  }

  // The lime rule, then the hook.
  children.push(abs({ left: g.marginX, top: blockTop - 34, width: 220, height: 10, background: C.lime }));
  lines.forEach((l, i) => {
    children.push(antonLine(l, { top: blockTop + i * LEAD, size: SIZE, color: C.white }));
  });

  return root(hasPicture ? GROUND.OVER : GROUND.INK, children);
}

/**
 * Render the thumbnail to a JPEG on disk.
 *
 * NEVER THROWS INTO THE PUBLISH PATH — a thumbnail is worth having and is not
 * worth a video. Returns null and logs on any failure, exactly as the subject
 * visual and the music bed do.
 *
 * @returns {Promise<{ path, bytes, width, height } | null>}
 */
export async function renderThumbnail({
  hook, outlet = null, subjectVisualPath = null, out, work,
  orientation = "vertical", ffmpegPath = null,
}) {
  const ff = ffmpegPath || getFFmpegPath();
  if (!ff) { logger.warn("🖼 thumbnail: no ffmpeg — skipping"); return null; }
  try {
    const g = geometryFor(orientation);
    const { w, h } = g.canvas;
    mkdirSync(work, { recursive: true });

    const hasPicture = Boolean(subjectVisualPath && existsSync(subjectVisualPath));
    if (subjectVisualPath && !hasPicture) {
      logger.warn(`🖼 thumbnail: the video's subject visual is gone from ${subjectVisualPath} — type only`);
    }

    // 1 — the type layer, through the SAME rasteriser as every slide.
    const typePng = path.join(work, "thumb-type.png");
    const png = await renderTreeToPng(thumbnailTree({ hook, outlet, hasPicture, orientation }), {
      width: w, height: h,
      background: hasPicture ? undefined : C.base,
    });
    writeFileSync(typePng, png);

    // 2 — the picture BEHIND the type (#140's order), cover-cropped to frame.
    //     Nothing is scaled after compositing: the type layer is already at
    //     final size, and scaling a semi-transparent layer bands visibly.
    const flat = path.join(work, "thumb-flat.png");
    if (hasPicture) {
      execFileSync(ff, ["-y", "-loglevel", "error",
        "-i", subjectVisualPath, "-i", typePng,
        "-filter_complex",
          `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase:force_divisible_by=2:flags=lanczos,` +
          `crop=${w}:${h}[bg];[bg][1:v]overlay=0:0:format=auto`,
        "-frames:v", "1", flat], { stdio: ["ignore", "ignore", "pipe"] });
    } else {
      execFileSync(ff, ["-y", "-loglevel", "error", "-i", typePng, "-frames:v", "1", flat],
        { stdio: ["ignore", "ignore", "pipe"] });
    }

    // 3 — JPEG, stepped down until it fits YouTube's 2 MB ceiling. Measured,
    //     not assumed: the check is on the bytes actually written.
    let bytes = 0;
    for (const q of JPEG_QUALITY_LADDER) {
      execFileSync(ff, ["-y", "-loglevel", "error", "-i", flat, "-q:v", String(q), "-frames:v", "1", out],
        { stdio: ["ignore", "ignore", "pipe"] });
      bytes = statSync(out).size;
      if (bytes <= MAX_BYTES) break;
    }
    if (bytes > MAX_BYTES) {
      logger.warn(`🖼 thumbnail: ${(bytes / 1048576).toFixed(2)} MB even at the lowest quality — ` +
        `YouTube would refuse it, so no thumbnail is set`);
      return null;
    }
    logger.info(`🖼 thumbnail: ${w}x${h}, ${(bytes / 1024).toFixed(0)} KB, ` +
      `${hasPicture ? "over the video's own subject visual" : "type on the house ground"}`);
    return { path: out, bytes, width: w, height: h };
  } catch (err) {
    logger.warn(`🖼 thumbnail failed (the video is unaffected): ${String(err.message).slice(0, 160)}`);
    return null;
  }
}
