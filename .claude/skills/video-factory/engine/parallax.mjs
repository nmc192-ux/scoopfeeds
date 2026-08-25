// Two-layer parallax: a cutout foreground over a Ken Burns background,
// moving at different rates. This is what makes a still read as "collage in
// motion" rather than "graded photo with a zoom" — the depth cue is the
// RELATIVE motion, so the drifts are opposed and both kept small.
//
// The rules it inherits (docs/video-pipeline.md §2, house-style.md):
//   - Parallax REPLACES the still's Ken Burns as its motion, it does not
//     stack on top of it. Double motion under text someone is reading is the
//     exact failure the keyframe design removed.
//   - Kept modest: the foreground drifts DX_DEFAULT px across the whole shot
//     and the background keeps the standard 0.16 zoom span. A parallax you
//     notice as an effect has already failed.
//
// The foreground is a transparent-background PNG (a cutout — a person, a
// building, a prop). Cutouts come from supervised sessions per the sourcing
// rules; this module only composites what already exists on disk.
//
// Exported as pure filter-graph construction so it can be unit-tested without
// executing build.mjs (which runs a whole film build on import).

export const DX_DEFAULT = 72;      // fg drift in px across the shot
export const FG_HEIGHT_FRAC = 0.92; // fg height as a fraction of the 1080 frame

/**
 * Build the -filter_complex string for a parallax shot.
 *
 * @param {object} o
 * @param {string} o.kenChain  the background's full kenFilter(...) chain,
 *                             ending in format=yuv420p at 1920x1080 — reused
 *                             verbatim so bg motion is exactly house Ken Burns
 * @param {number} o.frames    shot length in frames
 * @param {number} o.seconds   shot length in seconds
 * @param {number} [o.dx]      total fg drift in px (sign = direction)
 * @param {number} [o.fgH]     fg height in px
 * @param {"bottom"|"center"} [o.anchor]  fg vertical anchor
 * @returns {string} filter_complex mapping [0:v] bg + [1:v] fg → [v]
 */
export function parallaxFilter({ kenChain, frames, seconds, dx = DX_DEFAULT, fgH, anchor = "bottom" }) {
  if (!kenChain || !frames || !seconds) throw new Error("parallaxFilter: kenChain, frames, seconds required");
  const H = Math.round(fgH ?? 1080 * FG_HEIGHT_FRAC);
  // Drift is centred: the cutout sits dx/2 off-centre at frame 0 and crosses
  // to dx/2 the other side by the last frame, so the composition is balanced
  // at the shot's midpoint — where the viewer's eye settles.
  const x = `(W-w)/2-${(dx / 2).toFixed(1)}+${dx}*n/${frames}`;
  const y = anchor === "center" ? "(H-h)/2" : "H-h";
  return `[0:v]${kenChain}[bg];`
    + `[1:v]scale=-2:${H}[fg];`
    + `[bg][fg]overlay=x='${x}':y='${y}',format=yuv420p,`
    + `trim=duration=${seconds},setpts=PTS-STARTPTS[v]`;
}

/**
 * Validate a storyboard beat's parallax declaration. Returns problems, empty
 * when valid. Same reject-don't-repair posture as mapGeo.validateGeo.
 */
export function validateParallax(beat) {
  const errs = [];
  const px = beat.parallax;
  if (!px) return errs;
  if (!beat.photo) errs.push("parallax needs a `photo` background on the same beat");
  if (beat.footage || beat.clip) errs.push("parallax replaces a still's motion — it cannot run over footage");
  if (!px.fg) errs.push("parallax.fg (cutout key) is required");
  if (px.anchor && !["bottom", "center"].includes(px.anchor)) {
    errs.push(`parallax.anchor must be "bottom" or "center", got "${px.anchor}"`);
  }
  return errs;
}
