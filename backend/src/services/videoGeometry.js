/**
 * videoGeometry.js — the two frames the renderer draws into, as data.
 *
 * WHY THIS EXISTS RATHER THAN A SECOND COPY OF EVERYTHING. The 9:16 pass needs
 * genuinely different LAYOUTS — the diagram is a horizontal ticked rail at
 * 1920 wide and a downward rail at 1080, which is a different composition, not
 * the same one narrower. So the per-card layouts fork, and that is right.
 *
 * What must NOT fork is the chrome and the brand primitives. The progress line,
 * the SCOOPFEEDS mark, the eyebrow, the source credit and the two-tier lime
 * rule are the same design in both frames; only their coordinates move. Two
 * copies of those would be two places to get the brand invariant wrong, and
 * this codebase has the scar tissue to prove where that ends — the "one
 * measure" rule on the event graph, and the four-places-read-source_name note
 * in videoAttribution.
 *
 * So: geometry is data, primitives take geometry, layouts fork. See
 * videoSlideChrome.js for the primitives and videoSlideRendererVertical.js for
 * the 9:16 layouts.
 *
 * THE HORIZONTAL NUMBERS ARE THE SHIPPED ONES, MOVED VERBATIM. They were
 * literals in videoSlideRenderer.js; every one is reproduced here unchanged,
 * and _stateHashes.mjs proves it by sha256 over every state of every card type.
 */

/**
 * 16:9 — frozen. The longform track will want it, and nothing in the vertical
 * pass is allowed to move a number in here.
 */
const H_CANVAS = { w: 1920, h: 1080 };
export const HORIZONTAL = Object.freeze({
  name: "horizontal",
  canvas: Object.freeze({ w: 1920, h: 1080 }),
  marginX: 96,
  contentW: 1920 - 96 * 2,          // 1728
  chromeTopY: 72,
  // Nothing but chrome renders below this line — YouTube's control bar and end
  // screens land in the bottom band.
  reservedBottomY: 960,
  // DRIFT-SAFE INSET. Kept at its measured value even though the pan is now off
  // by default (VIDEO_SLIDE_DRIFT_ENABLED): the 2% overscan is still applied, so
  // the outer band is still cropped, and re-deriving it is a separate change.
  driftSafeX: 44,
  driftSafeY: 28,
  // Where the counter sits, measured from the top.
  counterTop: 1080 - 72,
  // No platform chrome overlays a 16:9 upload, so there is no action-rail
  // inset. Present as 0 so layouts can reference it unconditionally.
  safeRight: 0,
  // 16:9 has no platform furniture to dodge, so the chip keeps its own slot
  // here; the masthead anchor and the size floor are the same rule applied to
  // this frame's own masthead and subtitle.
  creditX: 96,
  creditY: 72,
  creditFontSize: 34,
});

/**
 * 9:16 — Shorts and Reels.
 *
 * SAFE AREA. Every number is protecting against a specific piece of platform
 * chrome that is invisible in a local render and present on the phone.
 *
 * safeBottom (320) — the one that actually bites. Shorts and Reels stack the
 *   video title, the channel handle, the caption and the progress bar across
 *   the bottom. 320 of 1920 is ~17%, which covers the two-line-title case
 *   rather than the one-line case.
 *
 * safeTop (140) — occasional "Shorts" chrome and the status bar on taller
 *   phones. Smaller than the bottom because nothing persistent lives here; it
 *   is a clearance, not a reservation.
 *
 * safeRight (168) — the action rail: like / comment / share / sound / avatar.
 *   Anything running to the right edge below the midline is under a button.
 *   Full-bleed CHROME (the progress line) is fine there; content is not.
 *
 * marginX (104) — NOW A PLATFORM CONSTRAINT, which it was not when it was 72.
 *   Raised 72 → 104 on 2026-08-14 after DrJ read display type as nearly flush
 *   to the frame edge on a real Short. The measurements:
 *
 *     as rendered        72  →  every card type measured 72-75, chrome and
 *                              eyebrow included. No layout was misbehaving.
 *     published frame    65  →  the 2% overscan (DRIFT_SCALE 1.02) scales to
 *                              1102 and crops back at x=11, a fixed ~9px loss.
 *     on the device     ~13  →  measured off DrJ's screenshots.
 *
 *   The last step is the one this number exists for. Shorts and Reels fill a
 *   screen taller than 9:16 by cropping the SIDES — CONFIRMED on a device, not
 *   inferred: the same screenshots that settled safeTop show the top edge intact
 *   while the horizontal inset has collapsed. The amount depends on the
 *   handset's aspect ratio, roughly 52px per side to explain the reading above.
 *   We cannot measure it, we cannot detect it, and it differs per phone, so the
 *   margin has to absorb it. 104 publishes at ~96 and leaves ~46 visible under
 *   the observed crop; 96 would have left ~37.
 *
 *   That the crop is HORIZONTAL ONLY is why safeTop survives at 140 while
 *   marginX had to rise: the two edges are not exposed to the same thing.
 *
 *   That the chrome, the eyebrow and the display line all read the SAME ~13 is
 *   what identifies this as a uniform downstream crop rather than a layout bug:
 *   a layout bug would not move three differently-positioned elements equally.
 *
 *   16:9 STAYS AT 96 and is unaffected — nothing crops a landscape upload, and
 *   the fixed 9px overscan loss is 1.7x more of a 1080 frame than of a 1920 one.
 *   The fractions are now 5.0% horizontal against 9.6% vertical, and that
 *   asymmetry is the point rather than an inconsistency to tidy up.
 *
 * NOT THE 4:5 BOX. A symmetric 285/285 inset is the common rule of thumb, but
 * the real chrome is strongly asymmetric — almost all of it is at the bottom —
 * so 4:5 discards 145px of usable top while adding nothing at the bottom. The
 * asymmetric numbers above are drawn by the stills harness's --safe overlay
 * alongside the 4:5 line, so the choice is checkable by looking.
 *
 * ✅ VERIFIED ON A DEVICE, 2026-08-14, from full-resolution Instagram Reels and
 * YouTube Shorts screenshots. All three safe-area numbers hold:
 *
 *   safeBottom 320 — captions clear the handle row.
 *   safeRight  168 — nothing runs under the action rail.
 *   safeTop    140 — the eyebrow sits on its own row, clearly above YouTube's
 *                    search and menu icons, WITH the iOS return-to-app banner
 *                    present. That banner pushes YouTube's chrome DOWN toward
 *                    our content, so the pessimistic case is the one that
 *                    passed and the ordinary case has more clearance still.
 *
 * These stopped being reasoned numbers and became measured ones. What is NOT
 * measurable from here is the player's horizontal crop — see marginX above.
 */
const V_CANVAS = { w: 1080, h: 1920 };
const V_SAFE_BOTTOM = 320;
const V_CONTENT_BOTTOM = V_CANVAS.h - V_SAFE_BOTTOM;   // 1600

/**
 * ─── The 9:16 caption block, and the rule that sits above it ────────────────
 *
 * THE CAPTION BLOCK. Read back by videoAssembler.captionGeometry so the burned
 * captions and the geometry cannot drift apart — these numbers lived in the
 * assembler once, and moving them here is what ended the era of two copies
 * agreeing by coincidence.
 *
 * MAX_CAPTION_BOTTOM_FRACTION (0.75) — measured against the platforms. TikTok's
 * own furniture reaches about 85% of frame height and the Instagram Reels
 * caption block sits inside that band, so anything burned below 75% competes
 * with somebody else's UI on two of the seven surfaces. It is a ceiling on the
 * BOTTOM of the block: the caption can move up, never down.
 *
 * THE ACCENT RULE IS GONE (DrJ, 2026-08-30). The full-width progress line that
 * these numbers once positioned ("the rule sits ruleAir above the caption")
 * read as a stray line across the frame and was deleted from both
 * orientations, together with its derivation (V_RULE_AIR, progressY,
 * progressH). The caption block itself is unchanged.
 */
export const MAX_CAPTION_BOTTOM_FRACTION = 0.75;
const V_CAPTION_FONT_SIZE = 30;
const V_CAPTION_LINE_HEIGHT = 40;
const V_CAPTION_MAX_LINES = 3;
const V_CAPTION_BOTTOM = Math.min(
  V_CONTENT_BOTTOM - 44,                                     // 1556, the unclamped value
  Math.round(V_CANVAS.h * MAX_CAPTION_BOTTOM_FRACTION)       // 1440, the platform ceiling
);
export const VERTICAL = Object.freeze({
  name: "vertical",
  canvas: Object.freeze({ w: 1080, h: 1920 }),
  marginX: 104,
  contentW: 1080 - 104 * 2,         // 872
  safeTop: 140,
  safeBottom: 320,
  safeRight: 168,
  // The measure for anything that must dodge the action rail.
  contentWRail: 1080 - 104 - 168,   // 808
  chromeTopY: 140,
  counterTop: 140,
  driftSafeX: 44,
  driftSafeY: 28,
  contentBottom: V_CONTENT_BOTTOM,
  // The caption block, read back by videoAssembler.captionGeometry — one set of
  // numbers, one place to change them.
  captionFontSize: V_CAPTION_FONT_SIZE,
  captionLineHeight: V_CAPTION_LINE_HEIGHT,
  captionMaxLines: V_CAPTION_MAX_LINES,
  captionBottomY: V_CAPTION_BOTTOM,
  reservedBottomY: V_CONTENT_BOTTOM,
  /**
   * Where the cutaway credit chip goes, and how big.
   *
   * ANCHORED TO THE MASTHEAD SLOT — the same x and the same top as SCOOPFEEDS.
   * The rule that encodes: *when the frame is not ours, the source's name takes
   * our name's position.* The chip used to be right-aligned inside the action
   * rail, which aligned it to nothing — measured on a real render it centred at
   * x≈663 against a subtitle centred at x≈540, neither centred nor edge-aligned,
   * and it read as accidental.
   *
   * creditFontSize (38) matches the title card's `sub` size, so the chip's cap
   * height is no smaller than the subtitle beneath it. At 24 it was the smallest
   * text in the frame — backwards for something that is a promise to a person.
   */
  creditX: 104,
  creditY: 140,
  creditFontSize: 38,
});

export const GEOMETRY = Object.freeze({ horizontal: HORIZONTAL, vertical: VERTICAL });

/**
 * Resolve an orientation name to its geometry. Unknown names THROW rather than
 * defaulting: a typo silently rendering 16:9 into a vertical pipeline would
 * produce a letterboxed video that looks deliberate.
 */
export function geometryFor(orientation = "horizontal") {
  const g = GEOMETRY[orientation];
  if (!g) throw new Error(`videoGeometry: unknown orientation "${orientation}" (want ${Object.keys(GEOMETRY).join("|")})`);
  return g;
}

/** The default for the daily loop. Vertical is where the discovery surface is. */
export const DEFAULT_ORIENTATION = process.env.VIDEO_ORIENTATION || "vertical";
