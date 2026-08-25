// Shared animation primitives.
//
// Extracted from render.mjs so mapGeo.mjs can use the SAME easing without a
// circular import (render → mapGeo → render). If a card and its map ever eased
// differently the composite would visibly tear — the label arriving on one
// curve while its pin arrives on another.

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const seg = (p, a, b) => clamp01((p - a) / (b - a));
/** easeOutCubic — fast arrival, soft settle. Reads as intent, not drift. */
export const ease = (x) => 1 - Math.pow(1 - x, 3);
export const at = (p, a, b) => ease(seg(p, a, b));

/** Standard entrance: fade up with a short rise. */
export const enter = (p, a, b, rise = 26) => {
  const k = at(p, a, b);
  return { opacity: k, transform: `translateY(${((1 - k) * rise).toFixed(2)}px)` };
};
