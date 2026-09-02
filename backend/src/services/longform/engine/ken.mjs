// Ken Burns — the slow move on a still.
//
// Extracted from build.mjs so it can be rendered and MEASURED without running a
// film build, which is how the vibration below was finally characterised. Same
// reason parallax.mjs and srtTime.mjs live outside build.mjs.
//
// ── The vibration ───────────────────────────────────────────────────────────
//
// `zoompan` recomputes the crop origin every output frame and ROUNDS IT TO AN
// INTEGER PIXEL of the intermediate image. As the zoom ramps, the ideal origin
// moves by a fraction of a pixel per frame, so the rounded origin holds still
// for a few frames and then jumps one pixel. At 30fps that reads as vibration,
// not as movement — and it is worst on a slow move, because the slower the
// ramp, the longer each hold and the more visible each jump.
//
// Two things reduce it, and both are needed:
//
//   · ZOOMPAN RENDERS AT 4K AND IS DOWNSCALED. This is the one that actually
//     works. The rounding happens at zoompan's OUTPUT size, so producing
//     3840x2160 and then scaling to 1920x1080 halves every jump AND runs it
//     through an interpolating filter, which turns a hard 1-px step into a
//     smooth sub-pixel shift instead of a visible snap.
//
//   · A BIGGER INTERMEDIATE feeding it, so the crop itself has finer steps.
//
//   · A SMALLER SPAN. 0.16 of zoom across a 5-second shot is a push. The brief
//     asks for drift. Less total travel is fewer pixel crossings.
//
// MEASURED, not reasoned about. A still with one thin bright line at the exact
// centre of a centre-anchored zoom: that line should never move, so any motion
// is pure artifact. Tracking its sub-pixel centroid across 150 frames, and
// reporting how much consecutive frame-to-frame steps DIFFER from each other
// (smooth motion has near-equal steps; a vibration reverses direction):
//
//     0bf7aa9  2560 → zoompan 1920           jitter mean 1.363 px  max 2.113
//     5120 → zoompan 1920                    jitter mean 0.662 px  max 0.952
//     7680 → zoompan 1920                    jitter mean 0.245 px  max 0.654
//   → 5120 → zoompan 3840 → bicubic 1920     jitter mean 0.034 px  max 0.618
//     7680 → zoompan 3840 → bicubic 1920     jitter mean 0.174 px  max 0.453
//
// A 40x reduction in sustained wobble. The 7680 variants have a slightly lower
// worst single frame but five times the mean, and it is the sustained wobble
// that reads as shake — one outlier frame does not.
//
// The span is deliberately expressed per SECOND rather than per shot, so a 2s
// cutaway and a 9s hold drift at the same visible rate. Tying it to the shot
// length meant a short shot moved fast and a long one crawled.

/** Output frame size. */
export const OUT_W = 1920;
export const OUT_H = 1080;

/** Intermediate the move is cropped from. Larger = finer sub-pixel steps. */
export const MID_W = 5120;
export const MID_H = 2880;

/** zoompan's own output, downscaled to OUT_W afterwards. See the header. */
export const ZP_W = 3840;
export const ZP_H = 2160;

/** Zoom travelled per second of shot. A drift, not a push. */
export const ZOOM_PER_SEC = 0.012;
/** Never travel more than this in one shot, however long it runs. */
export const ZOOM_MAX_SPAN = 0.075;

/**
 * @param {string} mode  "in" | "out" | "left" | "right"
 * @param {number} frames  shot length in frames
 * @param {number} z0      starting zoom (a punch-in starts already tight)
 * @param {number} [fps]
 */
export function kenFilter(mode, frames, z0 = 1.0, fps = 30) {
  const seconds = Math.max(0.1, frames / fps);
  const span = Math.min(ZOOM_MAX_SPAN, ZOOM_PER_SEC * seconds);
  const Z = z0 + span;
  const f = (n) => n.toFixed(6);
  const zin = `min(${f(z0)}+(${f(span)}/${frames})*on,${f(Z)})`;
  const zout = `max(${f(Z)}-(${f(span)}/${frames})*on,${f(z0)})`;
  const cx = `iw/2-(iw/zoom/2)`, cy = `ih/2-(ih/zoom/2)`;
  const map = {
    in: { z: zin, x: cx, y: cy },
    out: { z: zout, x: cx, y: cy },
    left: { z: f(Z), x: `(iw-iw/zoom)*(1-on/${frames})`, y: cy },
    right: { z: f(Z), x: `(iw-iw/zoom)*(on/${frames})`, y: cy },
  };
  const m = map[mode] || map.in;
  return `scale=${MID_W}:${MID_H}:force_original_aspect_ratio=increase,crop=${MID_W}:${MID_H},`
    + `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${frames}:s=${ZP_W}x${ZP_H}:fps=${fps},`
    + `scale=${OUT_W}:${OUT_H}:flags=bicubic,format=yuv420p`;
}

/** Total zoom a shot of this length will travel. Exported for tests. */
export function zoomSpanFor(seconds) {
  return Math.min(ZOOM_MAX_SPAN, ZOOM_PER_SEC * Math.max(0.1, seconds));
}
