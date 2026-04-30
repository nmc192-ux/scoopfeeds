/**
 * ─── Motion language — Electric Signal ───────────────────────────────────
 * Single source of truth for animation timing across CSS and Framer Motion.
 *
 * Three durations, two easings:
 *   fast (150ms)   — taps, icon swaps, ring fade
 *   normal (250ms) — card hover, color transitions, list-item reveal
 *   slow (400ms)   — modal transitions, page-shift, hero parallax
 *
 *   smooth         — cubic-bezier(0.16, 1, 0.3, 1)  · default ease-out
 *   spring         — cubic-bezier(0.68, -0.55, 0.27, 1.55) · springy overshoot
 *
 * Mirrors the CSS custom properties in index.css and Tailwind utilities
 * (transition-fast / duration-fast / ease-smooth) so the system stays
 * coherent regardless of which animation API a component reaches for.
 */

export const DURATION = {
  fast:   0.15,
  normal: 0.25,
  slow:   0.4,
};

export const EASE = {
  smooth: [0.16, 1, 0.3, 1],          // default — pleasant, brand-aligned
  inOut:  [0.65, 0, 0.35, 1],
  spring: [0.68, -0.55, 0.27, 1.55],  // for emphasis / save-button bounce
};

/* ── Framer Motion presets ─────────────────────────────────────────────── */

export const FADE_IN = {
  initial:    { opacity: 0 },
  animate:    { opacity: 1 },
  exit:       { opacity: 0 },
  transition: { duration: DURATION.normal, ease: EASE.smooth },
};

export const SLIDE_UP = {
  initial:    { opacity: 0, y: 12 },
  animate:    { opacity: 1, y: 0 },
  exit:       { opacity: 0, y: 12 },
  transition: { duration: DURATION.normal, ease: EASE.smooth },
};

export const SCALE_IN = {
  initial:    { opacity: 0, scale: 0.96 },
  animate:    { opacity: 1, scale: 1 },
  exit:       { opacity: 0, scale: 0.96 },
  transition: { duration: DURATION.fast, ease: EASE.smooth },
};

export const SHEET_UP = {
  initial:    { opacity: 0, y: 24 },
  animate:    { opacity: 1, y: 0 },
  exit:       { opacity: 0, y: 24 },
  transition: { duration: DURATION.normal, ease: EASE.smooth },
};

/**
 * Staggered list-item reveal — capped at 0.3s total delay so a 50-item
 * grid still reveals in under half a second.
 */
export const listItem = (i, base = 0.04) => ({
  initial:    { opacity: 0, y: 12 },
  animate:    { opacity: 1, y: 0 },
  transition: {
    duration: DURATION.normal,
    delay:    Math.min(i * base, 0.3),
    ease:     EASE.smooth,
  },
});

/* ── Convenience tap/hover micro-interactions ──────────────────────────── */

export const TAP = { scale: 0.96 };
export const TAP_SOFT = { scale: 0.92 };
export const HOVER_LIFT = { y: -2 };
