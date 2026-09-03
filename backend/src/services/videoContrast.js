/**
 * videoContrast.js — the house contrast floors, and the arithmetic that proves
 * a token meets them.
 *
 * WHY THIS EXISTS. The palette drifted dark one reasonable-looking commit at a
 * time. "Dim the past, highlight the present" is the right idea and it is kept;
 * what went wrong is that nothing ever measured how dim "dimmed" had become, so
 * the receded state settled at 2.2:1 and the slide counter at 1.7:1 — below the
 * point where a phone in daylight renders them at all. DrJ, 2026-09-03: "the
 * dim state is just set far too low to read. Keep the hierarchy, move the whole
 * range up."
 *
 * A floor nobody computes is a preference. So the numbers live here, the WCAG
 * arithmetic lives here, and `videoContrast.test.js` walks EVERY card type in
 * BOTH aspect ratios across BOTH video systems and fails on the first token
 * under its floor. Same principle as counting pictures from source bytes rather
 * than from a log line: measure the thing, not a claim about the thing.
 *
 * THE FLOORS (DrJ, 2026-09-03), applying to every format and every card type:
 *
 *   dimmed / inactive text       >= 3.0:1
 *   active / highlighted text    >= 4.5:1
 *   eyebrows and masthead        >= 3.0:1
 *
 * These are WCAG 2.1 §1.4.3 numbers — 4.5:1 for body text, 3:1 for large
 * display type — applied to a medium WCAG does not itself cover. Video type is
 * large and briefly on screen, which cuts both ways: bigger glyphs help, and a
 * viewer who cannot re-read a frame has one pass at it. We take the stricter
 * reading and gate the active tier at 4.5:1 whatever its size.
 *
 * NOT GATED, deliberately: non-text marks (bar tracks, hairlines, chevrons,
 * receded fills). WCAG 1.4.11 would ask 3:1 of the meaningful ones, but a
 * receded bar at 3:1 stops being receded — it competes with the active row it
 * exists to sit behind. They were lifted in step with the text instead, and
 * `NON_TEXT_MIN` records the weaker floor they are held to so the choice is
 * visible rather than an omission.
 */

/** The one ground. Everything is measured against this unless a card says otherwise. */
export const INK = "#090706";

export const FLOORS = Object.freeze({
  /** Text that is on screen but not the subject: the receded / past state. */
  dimmed: 3.0,
  /** Text carrying the beat: display lines, figures, body, the accent. */
  active: 4.5,
  /** Standing furniture: masthead, slide counter, eyebrows, source credits. */
  chrome: 3.0,
});

/** Structural marks. Lower on purpose — see the header note. */
export const NON_TEXT_MIN = 1.9;

/** "#rgb" | "#rrggbb" | "rgba(r,g,b,a)" -> {r,g,b,a} with 0-255 channels. */
export function parseColor(input) {
  const s = String(input ?? "").trim();
  const rgba = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (rgba) {
    return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] === undefined ? 1 : +rgba[4] };
  }
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) throw new Error(`videoContrast: cannot parse colour ${JSON.stringify(input)}`);
  const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
}

const toHex = ({ r, g, b }) =>
  "#" + [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("");

/**
 * Composite `fg` over `bg` — source-over, the only blend the renderers use.
 *
 * `alpha` multiplies whatever alpha `fg` already carries, which is how a CSS
 * `opacity` on an ancestor and an `rgba()` fill compose into one effective
 * colour. Returns an opaque "#rrggbb", because the result of painting anything
 * onto an opaque ground is opaque.
 */
export function over(fg, bg, alpha = 1) {
  const f = parseColor(fg);
  const b = parseColor(bg);
  const a = Math.min(1, Math.max(0, f.a * alpha));
  return toHex({ r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a) });
}

const channel = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(color) {
  const { r, g, b } = parseColor(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG 2.1 contrast ratio, 1.0 – 21.0. Order-independent.
 *
 * Both arguments must be OPAQUE. A translucent colour has no ratio of its own —
 * composite it with `over()` first, against whatever it is actually painted on.
 * Passing one here is a caller bug and throws, because silently treating an
 * alpha as 1 is exactly how a token measures better on paper than on screen.
 */
export function contrastRatio(a, b) {
  for (const c of [a, b]) {
    if (parseColor(c).a !== 1) {
      throw new Error(`videoContrast: contrastRatio needs opaque colours — composite ${JSON.stringify(c)} with over() first`);
    }
  }
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Rounded to 2dp, the form every report and failure message uses. */
export const ratio = (a, b) => Math.round(contrastRatio(a, b) * 100) / 100;
