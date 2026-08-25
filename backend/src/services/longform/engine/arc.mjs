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
  const w0 = Math.max(0, tReveal - IN);
  // The swell must not swallow authored structure. If the original arc has a
  // point between the end of the hold and the nominal +10s window — the outro
  // settle, a chapter change — the shaping ENDS at that point, at that
  // point's own value. A reveal usually lives in the final chapter, so this
  // is the common case, not the edge.
  const holdEnd = tReveal + holdSecs;
  const nextT = points.map(([t]) => t).find((t) => t > holdEnd + 0.5);
  const w1 = nextT !== undefined ? Math.min(tReveal + OUT, nextT) : tReveal + OUT;
  const endsOnAuthored = nextT !== undefined && nextT <= tReveal + OUT;
  const before = points.filter(([t]) => t < w0);
  const after = points.filter(([t]) => t > w1);
  const shaped = [
    [w0, arcAt(points, w0)],                                 // enter at the existing level
    [Math.max(w0, tReveal - 1.2), +(arcAt(points, w0) * 0.55).toFixed(3)], // thinning — the breath in
    [tReveal, drop],                                         // the drop, ON the reveal
    [holdEnd, drop],                                         // hold while it lands
    endsOnAuthored
      ? [w1, arcAt(points, w1)]                              // rejoin the authored arc exactly
      : [w1, +Math.min(1, arcAt(points, w1) * 1.1).toFixed(3)], // free air: swell out slightly hot
  ];
  return sortArc([...before, ...shaped, ...after]);
}

/**
 * Normalise a points list: clamp negative times, sort by time, drop
 * duplicate-time points (last writer wins). envelope() builds a nested
 * if(lt(t,…)) chain that assumes monotone times — an out-of-order pair makes
 * an earlier branch shadow later ones, and the bed silently holds a wrong
 * level for a whole region. Every producer of a points list ends with this.
 */
export function sortArc(points) {
  const byT = new Map();
  for (const [t, v] of points) byT.set(Math.max(0, t), v);
  return [...byT.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * Piecewise-linear envelope as an ffmpeg expression over `t`. Lives here, not
 * in music.mjs, so the SAME module owns both interpretations of a points list
 * (arcAt for JS/tests, envelope for the rendered audio) — they were in two
 * files and could disagree without any test noticing.
 */
export function envelope(points) {
  const f = (n) => n.toFixed(6);
  let expr = String(points[points.length - 1][1]);
  for (let i = points.length - 2; i >= 0; i--) {
    const [t0, v0] = points[i], [t1, v1] = points[i + 1];
    const lerp = `(${v0}+(${v1 - v0})*(t-${f(t0)})/${f(Math.max(0.01, t1 - t0))})`;
    expr = `if(lt(t,${f(t1)}),${lerp},${expr})`;
  }
  return expr;
}
