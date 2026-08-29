/**
 * videoSlideChrome.js — the tree helpers and the brand primitives, bound to a
 * geometry rather than to a canvas size.
 *
 * Extracted from videoSlideRenderer.js unchanged when the 9:16 layouts landed.
 * These are the parts that are the SAME DESIGN in both frames and differ only
 * in coordinates: the SCOOPFEEDS mark, the slide counter, the progress line,
 * the eyebrow, the hairline, the source credit, the source badge, the display
 * line. Duplicating them per orientation would be two places to get the
 * two-tier lime rule wrong.
 *
 * The per-card LAYOUTS deliberately do not live here — they fork, because a
 * vertical diagram is a different composition rather than a narrower one.
 *
 * ⚠️ THIS FILE FEEDS THE CACHE KEY. videoSlideRenderer's
 * VIDEO_BUILDER_FINGERPRINT hashes every module whose code determines rendered
 * output; editing this file must change that hash or prod serves stale frames.
 * It is in the list. Keep it there.
 */

export const COLORS = Object.freeze({
  base:        "#090706",
  lime:        "#dde706",
  white:       "#f5f2ea",
  sub:         "#cfcabd",
  dim:         "#8a8578",
  faint:       "#6b675e",
  rule:        "#2a2721",
  track:       "#4a473f",

  // ─── CONTEXT RECESSION ────────────────────────────────────────────────────
  //
  // What an entry looks like when it is on screen but NOT the one being
  // discussed. Cheapest item in the visual set and one of the strongest: the
  // eye goes straight to the single thing still in colour.
  //
  // THESE ARE CHOSEN COLOURS, NOT A DIMMED ACCENT (DrJ, 2026-08-15), and the
  // difference is visible rather than theoretical. Lime at 25% over the ground
  // composites to #3e3f06 — it keeps lime's hue, so a receded row reads as a
  // BROKEN accent, a colour that failed to render. These sit on the ground's own
  // warm-neutral axis instead: present, legible, obviously not the subject.
  // videoSlideRenderer.test.js asserts they stay near-neutral, so nobody can
  // quietly replace them with an alpha of the accent later.
  recededText:   "#4a473f",   // a label that is not being discussed
  recededFigure: "#3f3c35",   // its number
  recededFill:   "#26241f",   // its bar, or its rail dot
});

export const FONTS = { inter: "Inter", anton: "Anton" };

// ─── Anton metrics, for a SYNCHRONOUS fit ───────────────────────────────────
//
// WHY A BAKED TABLE. `statesForCard` is synchronous and three test files plus
// the assembler depend on that, but the only in-process way to measure text is
// `satori()`, which is async. Rather than make the whole layout path async for
// a width check, the ADVANCE of every glyph the display face can receive is
// measured once, offline, and baked here.
//
// MEASURED 2026-08-14 at size 100, by difference: adv(X) = ink("HXH") - ink("HH").
// Ink width alone would fold in side bearings and under-measure a run, which
// fails in the dangerous direction. Re-derive with the same method if
// Anton-Regular.ttf is ever replaced — and note that replacing the font file
// changes VIDEO_BUILDER_FINGERPRINT only if the font is hashed, which it is not.
//
// ANTON'S DIGITS ARE NOT TABULAR. "1" is 33 against 50 for every other digit —
// a 34% difference. This is exactly why the fix is width-driven rather than the
// digit-COUNT step it looked like it could be: "11,111" and "44,444" are the
// same length and 100px apart at display size, so a count-based rule would
// shrink one unnecessarily and let the other clip.
export const ANTON_ADV_REF = 100;
export const ANTON_ADV = Object.freeze({
  "0": 50, "1": 33, "2": 50, "3": 50, "4": 50, "5": 50, "6": 50, "7": 50, "8": 50, "9": 50,
  ",": 24, ".": 23, "%": 106, "$": 47, "+": 36, "-": 31, " ": 24,
  A: 49, B: 48, C: 48, D: 50, E: 42, F: 40, G: 49, H: 50, I: 23, J: 47, K: 48, L: 40, M: 75,
  N: 50, O: 49, P: 48, Q: 50, R: 48, S: 46, T: 40, U: 48, V: 47, W: 72, X: 49, Y: 45, Z: 41,
});
// An unmeasured glyph is assumed as wide as the widest letter, so an unexpected
// character shrinks the type rather than silently overflowing the frame.
const ANTON_ADV_FALLBACK = 75;

/** Rendered width of `str` in Anton at `size`, including letter-spacing gaps. */
export function antonWidth(str, size, letterSpacing = 0) {
  const chars = [...String(str ?? "")];
  if (!chars.length) return 0;
  let units = 0;
  for (const ch of chars) {
    units += ANTON_ADV[ch] ?? ANTON_ADV[ch.toUpperCase()] ?? ANTON_ADV_FALLBACK;
  }
  return (units / ANTON_ADV_REF) * size + letterSpacing * (chars.length - 1);
}

/**
 * The largest size at or below `nominalSize` at which `measure(size)` fits.
 *
 * Takes a MEASURE FUNCTION rather than a string so a composite — the stat card's
 * value plus its unit, which are two Anton runs at a fixed size ratio — can be
 * fitted as the single object it reads as. Steps down rather than solving
 * algebraically because the composite is not affine in size once a fixed pixel
 * margin sits between the runs.
 *
 * Returns `{ size, fitted, overflow }`. `overflow` is non-zero only when even
 * `minSize` does not fit — the caller is expected to log that loudly. Nothing
 * here truncates: shrinking to a floor and reporting is always preferable to
 * dropping a glyph off a figure, because a clipped number is a WRONG number.
 */
export function fitDisplaySize(measure, { nominalSize, maxWidth, minSize, step = 4 }) {
  if (measure(nominalSize) <= maxWidth) return { size: nominalSize, fitted: false, overflow: 0 };
  for (let s = nominalSize - step; s > minSize; s -= step) {
    if (measure(s) <= maxWidth) return { size: s, fitted: true, overflow: 0 };
  }
  const w = measure(minSize);
  return { size: minSize, fitted: true, overflow: Math.max(0, Math.round(w - maxWidth)) };
}

// ─── Tree helpers — no geometry, pure shape ─────────────────────────────────

export const box = (style, children = []) => ({ type: "div", props: { style: { display: "flex", ...style }, children } });
export const text = (content, style) => ({
  type: "div",
  props: { style: { display: "flex", fontFamily: FONTS.inter, ...style }, children: [{ type: "span", props: { children: String(content ?? "") } }] },
});
export const abs = (style, children = []) => box({ position: "absolute", ...style }, children);

/**
 * Bind the geometry-dependent primitives to one frame.
 *
 * A factory rather than a first argument on every call: the layout functions
 * below read like the originals (`eyebrow(card.eyebrow, Y.eyebrow)`), which is
 * what keeps the 16:9 bodies byte-for-byte comparable to the versions they
 * replaced — and that comparability is what _stateHashes.mjs verifies.
 */
/**
 * Who paints the ground behind a card. See root() below for why this is a
 * declared property rather than a default.
 */
export const GROUND = Object.freeze({ INK: "ink", OVER: "over" });
export const GROUND_VALUES = new Set(Object.values(GROUND));
/** Where root() stamps its choice. Non-enumerable, so satori never sees it. */
export const GROUND_KEY = Symbol.for("scoopfeeds.videoGround");
/** The ground a tree was built with, or null if it never went through root(). */
export const groundOf = (tree) => tree?.[GROUND_KEY] ?? null;

/**
 * ONE GESTURE PER FRAME — the discipline, enforced rather than remembered.
 *
 * DrJ, 2026-08-14: "The vocabulary is slight rotation, torn edges, halftone, one
 * hand-drawn mark, colour blocks behind words, scale contrast. THE RULE, and I
 * want it enforced rather than approximated: ONE GESTURE PER FRAME. This is a
 * news brand under my own name — I want crafted, not a meme account."
 *
 * A gesture is a deliberate departure from the grid: a tilt, a hand-drawn mark,
 * a colour block behind a word, a torn edge. It is NOT ordinary emphasis —
 * colour, weight, scale, the spotlight and context recession are how the design
 * speaks normally, and none of them spends the budget. A frame carrying a tilted
 * photograph AND a circled figure AND a highlighted word is the failure this
 * prevents, and it is the shape that arrives one reasonable-looking commit at a
 * time.
 *
 *   const g = gestureBudget("stat/s4");
 *   tree = root(GROUND.INK, [...base, g("circle: round the figure", mark)]);
 *
 * The second claim throws, naming BOTH gestures and the frame, because "too
 * many gestures" without saying which ones is a message you have to go and
 * investigate.
 *
 * NOTHING CLAIMS IT YET. The shipped cards spend no gestures — that is correct,
 * not an oversight: the vocabulary arrives with the photo mounts and the quote
 * card. This lands first so those are written against a contract that already
 * exists, exactly as the ground contract did.
 */
export function gestureBudget(frameName) {
  let spent = null;
  const claim = (kind, node) => {
    if (typeof kind !== "string" || !kind.trim()) {
      throw new Error(`gestureBudget("${frameName}"): a gesture must be NAMED — got ${JSON.stringify(kind)}`);
    }
    if (spent) {
      throw new Error(
        `ONE GESTURE PER FRAME: "${frameName}" already spent its gesture on "${spent}" ` +
        `and then asked for "${kind}"`
      );
    }
    spent = kind;
    return node;
  };
  claim.spent = () => spent;
  return claim;
}

export function makePrimitives(G) {
  const C = COLORS;
  const F = FONTS;

  /**
   * THE GROUND IS DECLARED, NEVER ASSUMED.
   *
   * `root` used to take children alone and always paint the near-black base.
   * That implicit choice was invisible and therefore repeatedly wrong: across
   * the collage prototypes it buried a photo under an opaque layer twice and
   * produced a card with no ground at all once — three separate debugging
   * sessions for one unstated assumption.
   *
   *   GROUND.INK  — this card paints the near-black ground itself.
   *   GROUND.OVER — this card is a TRANSPARENT overlay. Something upstream
   *                 (a composited photo, a map, a mount) supplies what is
   *                 behind it, and painting a ground here would bury it.
   *
   * There is no default and an unknown value throws, so the failure is a build
   * error naming the card rather than a black rectangle in a rendered file.
   *
   * The chosen ground is stamped on the returned tree as a non-enumerable
   * marker — satori reads `type`/`props` and ignores it — so `renderState` can
   * verify a tree came through here at all, and the assembler can later ask
   * what a card expects behind it without re-deriving it from the pixels.
   */
  const root = (ground, children) => {
    if (!GROUND_VALUES.has(ground)) {
      throw new Error(
        `videoSlideChrome: root() needs an explicit ground, one of ` +
        `${[...GROUND_VALUES].map(g => `"${g}"`).join(" | ")} — got ${JSON.stringify(ground)}`
      );
    }
    const tree = box({
      width: G.canvas.w, height: G.canvas.h,
      position: "relative", overflow: "hidden", flexDirection: "column",
      ...(ground === GROUND.INK ? { background: C.base } : {}),
    }, children);
    Object.defineProperty(tree, GROUND_KEY, { value: ground, enumerable: false });
    return tree;
  };

  const chrome = ({ slideIndex = 0, slideCount = 1 }) => {
    // No accent rule. The full-width progress line that lived here read as a
    // stray line across the frame (DrJ, 2026-08-30) and was removed from BOTH
    // orientations — the slide counter is the only progress indicator.
    return [
      text("SCOOPFEEDS", {
        position: "absolute", left: G.marginX, top: G.chromeTopY,
        fontSize: 26, fontWeight: 600, letterSpacing: 6, color: C.faint,
      }),
      text(`${slideIndex + 1} / ${slideCount}`, {
        position: "absolute", right: G.marginX, top: G.counterTop,
        fontSize: 22, fontWeight: 600, letterSpacing: 2, color: "#3a3830",
      }),
    ];
  };

  const eyebrow = (s, top) => text(String(s || "").toUpperCase(), {
    position: "absolute", left: G.marginX, top,
    fontSize: 30, fontWeight: 600, letterSpacing: 5, color: C.dim,
  });

  const hairline = (top, width = 520) => abs({ left: G.marginX, top, width, height: 1, background: C.rule });

  /** §3b/3's on-screen receipt. Never lime, never large, always the footnote slot. */
  const sourceCredit = (source, top) => text(`SOURCE: ${String(source || "").toUpperCase()}`, {
    position: "absolute", left: G.marginX, top,
    fontSize: 26, fontWeight: 600, letterSpacing: 4, color: C.dim, opacity: 0.7,
  });

  /** Code-injected on the title card — the model never writes an outlet name. */
  const sourceBadge = (outlet) => text(String(outlet || "").toUpperCase(), {
    position: "absolute", right: G.marginX, top: G.chromeTopY,
    fontSize: 26, fontWeight: 600, letterSpacing: 5, color: C.dim,
  });

  const antonLine = (s, { top, size = 118, color = C.white, maxWidth = G.contentW }) => text(s, {
    position: "absolute", left: G.marginX, top, maxWidth,
    fontFamily: F.anton, fontSize: size, lineHeight: 1.02, color,
  });

  return { G, root, chrome, eyebrow, hairline, sourceCredit, sourceBadge, antonLine, box, text, abs, C, F };
}
