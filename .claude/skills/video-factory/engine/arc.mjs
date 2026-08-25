// Pure arc math for the score bed — no project, no ffmpeg, no I/O.
// music.mjs consumes these; arc.test.mjs holds them to their contract.

/** Evaluate a piecewise-linear points list at time t. */
export function arcAt(points, t) {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [t0, v0] = points[i], [t1, v1] = points[i + 1];
    if (t <= t1) return t1 === t0 ? v1 : v0 + (v1 - v0) * (t - t0) / (t1 - t0);
  }
  return points[points.length - 1][1];
}

/**
 * Shape the arc around the film's REVEAL — the one moment the STORY SPINE
 * says the film is remembered by. The move is the oldest one in scoring:
 * thin the bed approaching the moment, DROP it as the reveal lands (near
 * silence is what makes the picture loud), hold, then swell out the other
 * side slightly above where it would have been.
 *
 * Pure points-in, points-out so it is testable without synthesising audio.
 * Outside the [tReveal-8, tReveal+10] window the arc is untouched — chapter
 * arrangement, the turn, the outro all keep their existing shape.
 */
export function applyReveal(points, tReveal, { drop = 0.18, holdSecs = 2.6 } = {}) {
  if (tReveal == null || !Number.isFinite(tReveal)) return points;
  const IN = 8, OUT = 10;
  const w0 = Math.max(0, tReveal - IN), w1 = tReveal + OUT;
  const before = points.filter(([t]) => t < w0);
  const after = points.filter(([t]) => t > w1);
  const shaped = [
    [w0, arcAt(points, w0)],                              // enter at the existing level
    [Math.max(w0, tReveal - 1.2), +(arcAt(points, w0) * 0.55).toFixed(3)], // thinning — the breath in
    [tReveal, drop],                                      // the drop, ON the reveal
    [tReveal + holdSecs, drop],                           // hold while it lands
    [w1, +Math.min(1, arcAt(points, w1) * 1.1).toFixed(3)],  // swell out slightly hot
  ];
  return [...before, ...shaped, ...after];
}