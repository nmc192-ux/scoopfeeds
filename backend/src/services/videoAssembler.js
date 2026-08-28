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
 * getFFmpegPath() prefers system ffmpeg over the bundled @ffmpeg-installer
 * binary.
 *
 * THE BUNDLE IS PLATFORM-DEPENDENT, and this note was wrong in both directions
 * before. On darwin-arm64 it is 4.4 and DOES carry xfade (measured 2026-08-12),
 * which is why a dev Mac with no system ffmpeg can render. On **linux-x64 it is
 * a 2018 build with 381 filters and NO xfade** (measured 2026-08-28) — so a
 * Linux host without a system ffmpeg resolves a binary, boots clean, and then
 * fails at the first multi-state slide.
 *
 * That is now caught at boot rather than at render: `assertFFmpegCapable()` in
 * services/ffmpegCapability.js runs in the worker's startup path and refuses to
 * start without the filters this file needs. Do not soften it into a warning —
 * a worker that cannot render takes video jobs and fails every one.
 */

import { spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";
import path from "path";
import { logger } from "./logger.js";
import { getFFmpegPath } from "./videoGenerator.js";
import { CANVAS, MARGIN_X, DRIFT_SAFE_Y, COLORS } from "./videoSlideRenderer.js";
import { geometryFor, DEFAULT_ORIENTATION } from "./videoGeometry.js";
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

/**
 * THE SLIDE PAN IS OFF (DrJ, 2026-08-12). Static shipped, not static behind a
 * flag someone has to remember to flip — so this defaults to FALSE and the
 * whole drift block below is skipped unless it is explicitly turned back on.
 *
 * The pan was eye-straining: a whole frame of text and figures sliding
 * continuously under a line the viewer is trying to read. Everything measured
 * about it — the 4x supersample, the pinned 6px/s rate, the 0.5px/frame
 * criterion — was work to make the motion TOLERABLE, and the verdict is that
 * tolerable was still the wrong target.
 *
 * WHAT IS *NOT* AFFECTED, deliberately, because "static" is easy to over-apply:
 *   - The progressive state reveal (xfade between keyframe states) STAYS. That
 *     is content appearing, not the frame moving, and it is the entire motion
 *     design of the format.
 *   - The 2% overscan (DRIFT_SCALE) STAYS. With no drift it is a harmless
 *     slight crop; removing it is a layout change with its own risk and is a
 *     separate pass.
 *   - DRIFT_SAFE_Y in videoSlideRenderer STAYS. It reserves the bottom band
 *     that the burned captions and the progress line already live in.
 *
 * The 4x SUPERSAMPLE, on the other hand, is skipped when drift is off — it
 * exists ONLY to give an animated crop sub-pixel precision, and there is
 * nothing to be sub-pixel about in a still frame. See buildSlideFilter.
 */
export const driftEnabled = () => process.env.VIDEO_SLIDE_DRIFT_ENABLED === "1";

/**
 * IMAGE-LAYER MOTION — a different thing from the slide pan, on purpose.
 *
 * The pan was removed (DrJ, 2026-08-12) because "a slow whole-frame pan under
 * text someone is reading is eye-straining". That reasoning is about TEXT. It
 * does not apply to a photograph or a locator map, which exist to be looked at
 * rather than read — and a still image under static type is exactly why the
 * shorts read as a slideshow (measured: 587 of 735 frames are duplicates).
 *
 * So this moves the UNDERLAY ONLY. The type overlay is composited on top,
 * untouched and pixel-static. Every assertion pinning the static graph still
 * holds, because they all describe slides with no underlay at all.
 *
 * WHY ZOOM AND NOT PAN. A pan is an animated integer crop, and at the rates
 * that look good here (~0.3px/frame) it stalls and snaps 2px unless
 * supersampled 4x — sixteen times the pixels, which this pipeline's economics
 * cannot carry. A zoom is a continuous rescale: zoompan resamples, so there is
 * no integer-offset staircase to hide.
 *
 * NO UPSCALING EVER. The underlay is laid out at canvas x (1 + zoom) and the
 * zoom runs 1.0 -> 1+ZA, so z=1 downscales the oversized plate to canvas and
 * z=1+ZA lands on native pixels. The push-in never invents detail.
 */
export const imageMotionEnabled = () => process.env.VIDEO_IMAGE_MOTION_ENABLED === "1";
const IMAGE_ZOOM = Number.parseFloat(process.env.VIDEO_IMAGE_ZOOM || "0.06");

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
/**
 * Caption geometry, per orientation.
 *
 * 16:9 — inside the bottom band, above the progress line, clear of the drift
 * margin. Nothing a card draws reaches there; the band exists for exactly this
 * and for YouTube's auto-hiding controls.
 *
 * 9:16 — THE CAPTION MOVES UP, and this is a vertical-only finding. Placed the
 * 16:9 way it lands in the band where Shorts and Reels draw the video title,
 * the channel handle, their own caption and the progress bar: it renders
 * perfectly and is then covered on the viewer's screen. So it sits ABOVE
 * contentBottom, inside our own area.
 *
 * maxLines is 2 in 16:9 and 3 in 9:16, and that is a DELIBERATE ASYMMETRY. A
 * 160-char caption over a 1080 measure wraps to three lines; the alternative
 * was cutting the caption budget to ~110 chars, which would have silently
 * shortened the SPOKEN script — the caption is the narration — and undone part
 * of the arc work. A layout constraint must not become an editorial one
 * (DrJ, 2026-08-12).
 */
/**
 * How far down the frame a burned caption may sit.
 *
 * 75%. Measured against the platforms: TikTok's own furniture reaches about 85%
 * of frame height and Instagram Reels' caption block sits inside that band, so
 * anything we burn below 75% is competing with somebody else's UI on two of the
 * seven surfaces we publish to. This is a ceiling on the BOTTOM of the block —
 * the caption can always move up, never down.
 */
export const MAX_CAPTION_BOTTOM_FRACTION = 0.75;

/**
 * The caption for a card, or null when it would only repeat what is on screen.
 *
 * FOUND AT GATE C by frame-by-frame reading of a real render: at 3.6s the burned
 * subtitle read "Riverside bridge reopens" while the card's own display lines
 * read RIVERSIDE BRIDGE / REOPENS. The caption track itself was fine — it
 * changed correctly later — but on that beat it was spending the bottom band
 * saying something the viewer had already read in 100pt type.
 *
 * A duplicate caption is worse than no caption. It costs the band, it costs the
 * reader a second of attention for nothing, and on a card that also carries a
 * cutaway it competes with the one piece of text that has to be read.
 *
 * COMPARED LOOSELY on purpose — case, punctuation and whitespace all differ
 * between a display line ("RIVERSIDE BRIDGE") and a caption ("Riverside bridge
 * reopens"), and an exact-match test would never fire on the very case that
 * prompted this.
 */
export function captionForCard(card = {}) {
  const caption = String(card.caption || "").trim();
  if (!caption) return null;

  const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const headline = norm(
    Array.isArray(card.lines) ? card.lines.map((l) => (Array.isArray(l) ? l[0] : l)).join(" ") : card.title
  );
  if (!headline) return caption;
  return norm(caption) === headline ? null : caption;
}



export function captionGeometry(orientation = "horizontal") {
  const g = geometryFor(orientation);
  if (orientation === "vertical") {
    return Object.freeze({
      fontSize: 30, lineHeight: 40,
      // CLAMPED TO 75% OF FRAME HEIGHT. The unclamped value (contentBottom - 44
      // = 1556) is 81%, and TikTok's furniture reaches about 85% with the
      // Instagram Reels caption block inside that band — so a burned caption
      // down there is competing with somebody else's UI on two of the seven
      // surfaces. The clamp is a MIN so the band can only ever move up.
      bottomY: Math.min(g.contentBottom - 44, Math.round(g.canvas.h * MAX_CAPTION_BOTTOM_FRACTION)),
      maxWidth: g.canvas.w - 2 * (g.marginX + 20),
      maxLines: 3,
    });
  }
  return Object.freeze({
    fontSize: 34, lineHeight: 44,
    bottomY: g.canvas.h - g.driftSafeY - 18,
    // Measured, not guessed. The box padding is 14px a side, so the text itself
    // has to fit inside the content measure less that padding.
    maxWidth: g.canvas.w - 2 * (g.marginX + 60),
    maxLines: 2,
  });
}

/** The 16:9 caption box, unchanged. Kept as a named export — three call sites
 *  and a test import it. */
export const CAPTION = captionGeometry("horizontal");

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
export async function buildCaptionFilter({ text, workDir, slideIndex, fontFile, orientation = "horizontal" }) {
  const CAP = captionGeometry(orientation);
  const lines = await wrapCaption(text, CAP.maxWidth);
  if (lines.length > CAP.maxLines) {
    logger.warn(
      `🎬 slide ${slideIndex}: caption wraps to ${lines.length} lines (max ${CAP.maxLines}) — ` +
      `it will sit higher than the band intends: "${String(text).slice(0, 60)}"`
    );
  }
  // ONE drawtext PER LINE. A single multi-line drawtext centres the BLOCK and
  // left-aligns the lines inside it, so a short second line hangs off to the
  // left of a long first one — visible immediately in the first render.
  // Per-line filters let each line centre on its own width.
  const blockH = lines.length * CAP.lineHeight;
  const top = CAP.bottomY - blockH;
  const esc = (v) => String(v).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

  return lines.map((line, i) => {
    const file = path.join(workDir, `caption-${String(slideIndex).padStart(2, "0")}-${i}.txt`);
    writeFileSync_(file, line, "utf8");
    return (
      `drawtext=fontfile='${esc(fontFile)}':textfile='${esc(file)}':` +
      `fontsize=${CAP.fontSize}:fontcolor=0xf5f2ea:` +
      `x=(w-text_w)/2:y=${Math.round(top + i * CAP.lineHeight)}:` +
      `box=1:boxcolor=0x090706@0.72:boxborderw=14`
    );
  }).join(",");
}

/**
 * The credit that rides on a cutaway.
 *
 * ATTRIBUTION IS OWED HERE MORE THAN ANYWHERE. A cutaway is somebody else's
 * footage, and the licence asks for the creator to be credited where possible.
 * The masthead and the slide counter drop for the cutaway's duration — they are
 * our furniture and a two-second gap in them reads as an edit — but the credit
 * is the one piece of chrome that must NOT drop, because it belongs to the
 * picture rather than to us.
 *
 * It carries its own contrast, the same way the photo credit does: a chip on a
 * near-opaque plate, because a photograph is whatever it happens to be and dim
 * grey over a bright frame is not a credit at all. This is drawn in ffmpeg
 * rather than in the satori tree so that no renderer file changes — the design
 * key stays where it is, and the credit is composited into the cutaway stream
 * itself, so it cannot outlive the footage by even one frame.
 */
/**
 * The band the credit chip occupies, as a crop rectangle.
 *
 * EXPORTED SO THE PERSISTENCE TEST CAN LOOK AT IT. `videoCreditPersistence.test.js`
 * renders a real short and samples every frame carrying third-party footage,
 * asserting the credit region is non-empty in each. That test is only meaningful
 * if it looks at the region the chip is ACTUALLY drawn in — so the region is
 * defined once, here, beside the filter that draws into it, rather than as a
 * rectangle the test guesses at and that silently stops overlapping the chip the
 * next time the chip moves.
 *
 * Generous on purpose: a band, not a tight box, because the chip's width depends
 * on the credit text and `drawtext` positions it by measured text width. A band
 * that contains the chip plus margin is exactly what "is anything drawn here"
 * needs.
 */
export function creditChipRegion(orientation = "horizontal", { frame = null } = {}) {
  const G = geometryFor(orientation);
  const CV = G.canvas;
  const h = Math.round(G.creditFontSize * 2);

  // FRAMED LANE. The chip is drawn into the INSET stream at the picture's own
  // corner, so in FRAME coordinates it lands at the box's origin plus that
  // inset — not in the masthead slot. A persistence test that cropped the
  // masthead band here would be measuring the card behind the picture and would
  // report "credit present" from whatever the card happens to have drawn there.
  // That is exactly the vacuous-pass this whole property is written against, and
  // it is why the region is a function of the lane rather than a constant.
  if (frame) {
    const inset = Math.round(G.creditFontSize / 2);
    // CLAMPED STRICTLY INSIDE THE PICTURE. A band that spilled past the box
    // edge would sample the CARD around the inset, and then "is anything drawn
    // here" would be answered by our own layout rather than by the chip —
    // measured: the uncredited control read 152 bright pixels from the card
    // alone, which is a detector that cannot tell a missing credit from a
    // present one.
    const x = Math.max(frame.x, frame.x + inset - 20);
    const y = Math.max(frame.y, frame.y + inset - 12);
    return {
      x, y,
      w: Math.max(1, Math.min(frame.x + frame.w - x, frame.w)),
      h: Math.max(1, Math.min(h, frame.y + frame.h - y)),
    };
  }

  // The chip is left-anchored in the masthead slot, so the band runs from just
  // left of that anchor across the width a credit can plausibly occupy.
  const x = Math.max(0, G.creditX - 20);
  const y = Math.max(0, G.creditY - 12);
  return {
    x,
    y,
    w: Math.min(CV.w - x, Math.round(CV.w * 0.72)),
    h,
  };
}

/**
 * The inset box a FRAMED cutaway occupies (the fair-use lane).
 *
 * Sized to the content measure and 16:9 inside it, sitting above the caption
 * band and below the masthead — so the chrome that makes the use legible as
 * commentary is visible on all four sides of the borrowed picture, which is the
 * entire point of the lane distinction.
 */
export function cutawayFrameFor(orientation = "horizontal") {
  const G = geometryFor(orientation);
  const CV = G.canvas;
  const w = G.contentW - (G.contentW % 2);
  const h = Math.round(w * 9 / 16) - (Math.round(w * 9 / 16) % 2);
  return { w, h, x: Math.round((CV.w - w) / 2), y: Math.round((CV.h - h) / 2) };
}

/**
 * Which composition does this clearance lane get?
 *
 *   grant     → full-bleed, chrome suppressed.
 *   fair_use  → framed, chrome retained.
 *   owner     → framed, chrome retained.
 *   anything else, including null → framed.
 *
 * FULL-BLEED IS NOW AN ALLOWLIST OF ONE, AND THE DEFAULT IS FRAMED. It used to
 * be `basis === "fair_use" ? framed : full-bleed`, i.e. an unrecognised basis
 * suppressed the masthead. Suppressing our own branding is the more consequential
 * of the two outcomes, so it is the one that has to be asked for by name.
 *
 * WHY fair_use AND owner SHARE A COMPOSITION FOR OPPOSITE REASONS. This looks
 * like the lane distinction collapsing and it is not:
 *
 *   fair_use is framed because the LANE NEEDS IT. Its whole posture rests on the
 *     use being commentary, and chrome-suppressed full-bleed shows the least
 *     commentary of any composition available (DrJ, Gate C).
 *   owner is framed because THE MASTHEAD IS OURS TO KEEP (DrJ, Gate E).
 *     Suppressing our own branding over our own footage makes no sense. Own
 *     material renders with normal chrome.
 *
 * They would diverge the moment either reason changed, which is why they are two
 * entries in a table rather than one condition.
 *
 * WHAT THIS DELIBERATELY IS NOT: full-bleed with the masthead redrawn on top.
 * That was the other way to satisfy Gate E, and it was rejected. The masthead is
 * baked into the state PNGs by satori at 34px with 8px letter-spacing, and
 * `drawtext` has no tracking control — a redrawn masthead would be a visibly
 * different wordmark appearing at the exact frame the cutaway starts, which is
 * the kind of one-frame pop this file's cutaway header exists to prevent.
 * Cropping the real masthead out of the state PNG and re-overlaying it would
 * carry the card's opaque background with it and land a solid bar across the
 * footage. Framing costs nothing and needs no new compositing stage.
 *
 * Exported as a function rather than inlined at the call site so the rule has
 * one home and a test can walk every lane rather than the two someone
 * remembered.
 */
const FULL_BLEED_BASES = Object.freeze(["grant"]);

export function cutawayFrameForLane(clearanceBasis, orientation = "horizontal") {
  return FULL_BLEED_BASES.includes(clearanceBasis) ? null : cutawayFrameFor(orientation);
}

export function buildCutawayCreditFilter({ text, workDir, slideIndex, fontFile, orientation = "horizontal", frame = null }) {
  const G = geometryFor(orientation);
  const file = path.join(workDir, `cutaway-credit-${String(slideIndex).padStart(2, "0")}.txt`);
  const esc = (v) => String(v).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  writeFileSync_(file, String(text).toUpperCase(), "utf8");
  // Right-aligned inside the action rail, on the top safe line — the same band
  // the photo credit uses, so the two never collide or read differently.
  // MASTHEAD ANCHOR, OPAQUE PLATE, SUBTITLE-SIZED.
  //
  // x and y are the masthead's own slot: when the frame is not ours, the
  // source's name takes our name's position. Left-aligned to marginX like every
  // other piece of chrome, rather than floating at whatever x the text width
  // happened to produce.
  //
  // The plate is FULLY OPAQUE (@1.0, was @0.62). At 0.62 it survived a test
  // pattern and would not have survived a blown-out sky, which is precisely the
  // frame a phone clip of an outdoor incident produces — and an unreadable
  // credit is not a credit.
  // IN THE FRAMED LANE the chip is drawn into the INSET stream, not the full
  // frame, so the masthead's coordinates mean nothing there — 104/140 inside an
  // 872x490 box is a third of the way down a picture rather than a masthead
  // slot. The credit still belongs to the picture (it is composited inside the
  // cutaway stream, which is what stops it outliving the footage), so in that
  // lane it takes the picture's own top-left corner instead. Found by looking at
  // the Gate D render, not by a test.
  const inset = Math.round(G.creditFontSize / 2);
  const x = frame ? inset : G.creditX;
  const y = frame ? inset : G.creditY;
  return (
    `drawtext=fontfile='${esc(fontFile)}':textfile='${esc(file)}':` +
    `fontsize=${G.creditFontSize}:fontcolor=0xf5f2ea:` +
    `x=${x}:y=${y}:` +
    `box=1:boxcolor=0x090706@1.0:boxborderw=12`
  );
}

/**
 * FILM GRAIN — static, not temporal, and that choice is the whole cost story.
 *
 * Measured 2026-08-14 on a 43s vertical render, final encode from clean masters:
 *
 *   clean         2.0s    1.7MB
 *   static 9      7.0s    7.7MB
 *   static 14     7.6s    8.9MB      <- shipped
 *   temporal 5   15.0s    9.0MB
 *   temporal 9   33.4s   31.6MB
 *
 * Static at 14 costs about the same as temporal at 5 and looks considerably
 * stronger; temporal at a comparable strength is roughly 4x the bytes and 4x the
 * encode. Grain is unique per pixel per frame, so temporal grain defeats
 * inter-frame compression completely — that is the 31.6MB.
 *
 * THE SEED IS FIXED ON PURPOSE. Slides are encoded separately and concatenated,
 * and an unseeded `noise` would generate a different still pattern per slide —
 * the texture would visibly jump at every cut, which is worse than no texture.
 * One seed means one grain field across the whole video.
 *
 * VIDEO_GRAIN_STRENGTH=0 removes the filter node entirely rather than adding a
 * zero-strength one: zero means zero, and it also means no encode cost at all.
 */
// The one ground, as ffmpeg spells it. Kept beside the filter that pads onto it.
const GROUND_HEX = "0x090706";
const GRAIN_SEED = 20260814;
export const grainStrength = () => {
  const raw = process.env.VIDEO_GRAIN_STRENGTH;
  if (raw === undefined || raw === "") return 14;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    logger.warn(`🎬 VIDEO_GRAIN_STRENGTH="${raw}" is not an integer 0-100 — using 14`);
    return 14;
  }
  return n;
};
export const grainChain = () => {
  const n = grainStrength();
  return n > 0 ? `,noise=alls=${n}:allf=u:all_seed=${GRAIN_SEED}` : "";
};

/**
 * A cutaway is a stream that ENDS, not a time-gated overlay.
 *
 * The clip is trimmed to its own length and composited with `eof_action=pass`,
 * so when it runs out the slide underneath simply passes through. Two
 * consequences, both load-bearing:
 *
 *   1. THE CHROME DROP IS FRAME-EXACT BY CONSTRUCTION. The masthead and the
 *      slide counter are baked into the state PNGs, which are the main stream,
 *      so a full-frame cutaway hides them for exactly as long as it exists and
 *      they return on the frame it ends. Nothing has to agree with anything:
 *      there is one stream boundary, not two expressions that could drift by a
 *      frame and read as a glitch.
 *   2. NO TIME TERM ENTERS THE GRAPH. An `enable='lt(t,N)'` overlay would put a
 *      `t` into an `overlay=` stage, which is precisely what the type-chain
 *      time-invariance tests forbid. A stream that ends needs no clock.
 *
 * The credit rides INSIDE the cutaway stream for the same reason: composited
 * before the overlay, it cannot outlive the footage it credits.
 */
export function buildSlideFilter({ stateCount, hold, crossfade = CROSSFADE_SECS, driftDir = 0, caption = null, orientation = "horizontal", underlay = false, cutaway = null }) {
  const CV = geometryFor(orientation).canvas;
  const parts = [];
  // The whole-slide timeline, needed by image motion so each state animates its
  // OWN slice of one continuous move. Mirrors the xfade arithmetic below.
  const stepSecs = hold - crossfade;
  const slideTotal = hold + (stateCount - 1) * stepSecs;
  const motion = underlay && imageMotionEnabled() && IMAGE_ZOOM > 0;
  if (underlay) {
    // The image is the LAST input, after the states. Centred and scaled to
    // cover — a mount is taller than it is wide and must not be letterboxed
    // onto the ground it is supposed to be sitting on.
    const ui = stateCount;
    // With motion the plate is laid out oversized so the push-in never upscales.
    const PW = motion ? Math.round(CV.w * (1 + IMAGE_ZOOM)) : CV.w;
    const PH = motion ? Math.round(CV.h * (1 + IMAGE_ZOOM)) : CV.h;
    const tap = motion ? "m" : "u";
    parts.push(
      `[${ui}:v]scale=${PW}:${PH}:force_original_aspect_ratio=decrease,` +
      `pad=${PW}:${PH}:(ow-iw)/2:(oh-ih)/2:color=${GROUND_HEX},setsar=1,fps=${FPS},` +
      `split=${stateCount}${Array.from({ length: stateCount }, (_, j) => `[${tap}${j}]`).join("")}`
    );
    if (motion) {
      // STATES ARE CROSSFADED, SO THEIR ZOOMS MUST BE CONTIGUOUS. Each state is
      // its own stream starting at t=0; state i appears at i*(hold-crossfade)
      // in the assembled slide. Giving every state the same 1.0->1+ZA ramp
      // would put two different zoom levels on screen during each dissolve and
      // the image would visibly jump at every state change. Each state instead
      // animates the sub-range its own window covers, so zEnd(i) == zStart(i+1)
      // exactly and the dissolve is between matching frames.
      for (let i = 0; i < stateCount; i++) {
        const frames = Math.max(1, Math.round(hold * FPS));
        const zAt = (T) => 1 + IMAGE_ZOOM * (slideTotal > 0 ? T / slideTotal : 0);
        const z0 = zAt(i * stepSecs), z1 = zAt(i * stepSecs + hold);
        parts.push(
          `[m${i}]zoompan=z='${z0.toFixed(6)}+${(z1 - z0).toFixed(6)}*on/${frames}':` +
          `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${CV.w}x${CV.h}:fps=${FPS},setsar=1[u${i}]`
        );
      }
    }
  }
  for (let i = 0; i < stateCount; i++) {
    // UNDERLAY. A subject-visual card declares GROUND.OVER — it is a transparent
    // overlay, and the mount or map goes behind it here. The image is ONE input
    // split per state rather than one input per state: same pixels, decoded once.
    if (underlay) {
      parts.push(`[${i}:v]format=rgba,scale=${CV.w}:${CV.h},setsar=1,fps=${FPS}[o${i}]`);
      parts.push(`[u${i}][o${i}]overlay=0:0:format=auto,setsar=1,format=yuv420p,fps=${FPS}[s${i}]`);
    } else {
      parts.push(`[${i}:v]scale=${CV.w}:${CV.h},setsar=1,format=yuv420p,fps=${FPS}[s${i}]`);
    }
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

  // Captions come LAST in the chain in both branches below — after any crop and
  // any downscale — so they neither move nor get resampled.
  const captionChain = caption ? `,${caption}` : "";

  /**
   * The cutaway stage, and the tail it feeds.
   *
   * `scale=…:force_original_aspect_ratio=increase` then `crop` covers the frame
   * whatever the asset's dimensions are — the library is portrait 2160x3840
   * today and 1080x1920 after the treatment pass, and neither may letterbox.
   * The caption and the grain are applied AFTER the composite, so narration
   * stays burned over the footage and one grain field covers the whole slide.
   */
  const appendCutaway = () => {
    const credit = cutaway.credit ? `,${cutaway.credit}` : "";

    /**
     * FRAMED LANE. `cutaway.frame` insets the footage instead of covering the
     * frame, and the slide underneath — masthead, counter, card type — stays
     * visible around it.
     *
     * WHY THIS IS A LANE AND NOT A PREFERENCE (DrJ, Gate C). Full-bleed with the
     * chrome suppressed is normal broadcast grammar for GRANTED footage: nothing
     * carries platform furniture, a source chip is expected, and the frame reads
     * as ours. A Lane 3 fair-use excerpt is a different claim. Its whole posture
     * rests on the use being commentary, and chrome-suppressed full-bleed shows
     * the least commentary of any composition available — it is the weakest
     * possible position for the one lane that may actually have to be defended.
     * So fair_use keeps our framing around it, visibly.
     *
     * Still ONE compositing path: the same stream-that-ends, the same
     * `eof_action=pass`, the same credit composited inside it. Only the scale
     * and the overlay offset differ, and both are constants in the graph — no
     * time term enters an `overlay=` stage, so the type-chain time-invariance
     * tests hold exactly as before.
     */
    if (cutaway.frame) {
      const f = cutaway.frame;
      parts.push(
        `[${cutaway.inputIndex}:v]scale=${f.w}:${f.h}:force_original_aspect_ratio=increase,` +
        `crop=${f.w}:${f.h},setsar=1,fps=${FPS},` +
        `trim=duration=${cutaway.seconds.toFixed(3)},setpts=PTS-STARTPTS${credit}[cut]`
      );
      parts.push(`[base][cut]overlay=${f.x}:${f.y}:eof_action=pass,setsar=1${captionChain}${grainChain()}[out]`);
      return;
    }

    parts.push(
      `[${cutaway.inputIndex}:v]scale=${CV.w}:${CV.h}:force_original_aspect_ratio=increase,` +
      `crop=${CV.w}:${CV.h},setsar=1,fps=${FPS},` +
      `trim=duration=${cutaway.seconds.toFixed(3)},setpts=PTS-STARTPTS${credit}[cut]`
    );
    parts.push(`[base][cut]overlay=0:0:eof_action=pass,setsar=1${captionChain}${grainChain()}[out]`);
  };
  // With no cutaway the graph is byte-for-byte what it was: one node, ending in
  // [out]. The split into [base] happens only when there is something to composite.
  const sink = cutaway ? `setsar=1[base]` : `setsar=1${captionChain}${grainChain()}[out]`;

  // ── STATIC (the default): the same 2% overscan, cropped dead centre ──
  //
  // The centre is not an arbitrary choice — it is the MIDPOINT of the pan this
  // replaces. The animated crop ran from (maxX-dx)/2 to (maxX+dx)/2, so maxX/2
  // is exactly where the old motion averaged out. Framing is therefore
  // unchanged; only the movement is gone.
  //
  // NO SUPERSAMPLE HERE. The 4x round trip exists solely to make an animated
  // integer crop advance smoothly (see DRIFT_SUPERSAMPLE); a still crop lands
  // on one integer coordinate and stays there, so scaling to 4x and back would
  // buy nothing and cost two lanczos passes at sixteen times the pixel count.
  // Dropping it also removes the slight softening that round trip caused, which
  // is why static output is fractionally CRISPER than the panned output was.
  if (!driftEnabled()) {
    const w2s = Math.round(CV.w * DRIFT_SCALE);
    const h2s = Math.round(CV.h * DRIFT_SCALE);
    const offX = Math.round((w2s - CV.w) / 2);
    const offY = Math.round((h2s - CV.h) / 2);
    parts.push(
      `[${last}]scale=${w2s}:${h2s}:flags=lanczos,` +
      `crop=${CV.w}:${CV.h}:x=${offX}:y=${offY},` +
      sink
    );
    if (cutaway) appendCutaway();
    return { filter: parts.join("; "), totalDuration: total };
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
  const w2 = Math.round(CV.w * DRIFT_SCALE) * SS;
  const h2 = Math.round(CV.h * DRIFT_SCALE) * SS;
  const cw = CV.w * SS, ch = CV.h * SS;
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
  parts.push(
    `[${last}]scale=${w2}:${h2}:flags=lanczos,` +
    `crop=${cw}:${ch}:x='${Math.round(padX / 2)}+${xExpr}':y='${Math.round(padY / 2)}+${yExpr}',` +
    `scale=${CV.w}:${CV.h}:flags=lanczos,${sink}`
  );
  if (cutaway) appendCutaway();

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
 * The assembled length of a slide — the same accumulation buildSlideFilter does,
 * and the inverse of holdForAudio. A cutaway is clamped against this so it can
 * never outlast the slide it sits inside, which is what keeps total video
 * duration identical whether cutaways are on or off.
 */
export function totalFor(stateCount, hold, crossfade = CROSSFADE_SECS) {
  return hold + Math.max(0, stateCount - 1) * (hold - crossfade);
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
  orientation = "horizontal", underlayPath = null,
  cutawayPath = null, cutawaySecs = 0, cutawayCredit = null, cutawayFrame = null,
}) {
  const ff = ffmpegPath || getFFmpegPath();
  if (!ff) throw new Error("videoAssembler: ffmpeg not available");
  if (!statePaths.length) throw new Error("videoAssembler: no states to assemble");

  const args = ["-y", "-loglevel", "error"];
  for (const p of statePaths) args.push("-loop", "1", "-t", String(hold), "-i", p);
  // Input ORDER is the contract with buildSlideFilter: states, then the
  // underlay, then audio. The filter addresses them by index.
  if (underlayPath) args.push("-loop", "1", "-t", String(hold * statePaths.length), "-i", underlayPath);
  // The cutaway sits AFTER the underlay and BEFORE the audio, so both indices
  // below stay arithmetic on the counts rather than on which options are set.
  const useCutaway = Boolean(cutawayPath) && cutawaySecs > 0;
  const cutawayIdx = statePaths.length + (underlayPath ? 1 : 0);
  if (useCutaway) args.push("-i", cutawayPath);
  const audioIdx = cutawayIdx + (useCutaway ? 1 : 0);
  if (audioPath) args.push("-i", audioPath);

  const caption = (captionText && workDir && fontFile)
    ? await buildCaptionFilter({ text: captionText, workDir, slideIndex: driftDir, fontFile, orientation })
    : null;

  // The cutaway can never outlast the slide it sits inside. That is what keeps
  // the video's total duration identical with cutaways on and off: the segment
  // is still cut to `-t totalDuration`, and nothing new is concatenated.
  const cutSecs = useCutaway ? Math.min(cutawaySecs, Math.max(0, totalFor(statePaths.length, hold) - 0.25)) : 0;
  const credit = (useCutaway && cutawayCredit && workDir && fontFile)
    ? buildCutawayCreditFilter({ text: cutawayCredit, workDir, slideIndex: driftDir, fontFile, orientation, frame: cutawayFrame })
    : null;

  const { filter, totalDuration } = buildSlideFilter({
    stateCount: statePaths.length, hold, driftDir, caption, orientation,
    underlay: Boolean(underlayPath),
    cutaway: useCutaway && cutSecs > 0
      ? { inputIndex: cutawayIdx, seconds: cutSecs, credit, frame: cutawayFrame }
      : null,
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
