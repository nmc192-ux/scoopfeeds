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
  limeChrome:  "rgba(221,231,6,0.35)",
  white:       "#f5f2ea",
  sub:         "#cfcabd",
  dim:         "#8a8578",
  faint:       "#6b675e",
  rule:        "#2a2721",
  track:       "#4a473f",
});

export const FONTS = { inter: "Inter", anton: "Anton" };

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
export function makePrimitives(G) {
  const C = COLORS;
  const F = FONTS;

  const root = (children) => box({
    width: G.canvas.w, height: G.canvas.h, background: C.base,
    position: "relative", overflow: "hidden", flexDirection: "column",
  }, children);

  const chrome = ({ slideIndex = 0, slideCount = 1 }) => {
    const frac = slideCount > 1 ? (slideIndex + 1) / slideCount : 1;
    return [
      text("SCOOPFEEDS", {
        position: "absolute", left: G.marginX, top: G.chromeTopY,
        fontSize: 26, fontWeight: 600, letterSpacing: 6, color: C.faint,
      }),
      text(`${slideIndex + 1} / ${slideCount}`, {
        position: "absolute", right: G.marginX, top: G.counterTop,
        fontSize: 22, fontWeight: 600, letterSpacing: 2, color: "#3a3830",
      }),
      // Progress line: full-width track, lime fill to this slide's fraction.
      // Full-bleed on purpose in BOTH frames — it is chrome, so the vertical
      // action rail does not apply to it.
      abs({ left: 0, top: G.progressY, width: G.canvas.w, height: G.progressH, background: "#1a1814" }),
      abs({ left: 0, top: G.progressY, width: Math.round(G.canvas.w * frac), height: G.progressH, background: C.limeChrome }),
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
