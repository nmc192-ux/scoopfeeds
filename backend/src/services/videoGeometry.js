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
const H_DRIFT_SAFE_Y = 28;
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
  progressH: 4,
  // Where the counter sits, measured from the top.
  counterTop: 1080 - 72,
  // No platform chrome overlays a 16:9 upload, so there is no action-rail
  // inset. Present as 0 so layouts can reference it unconditionally.
  safeRight: 0,
  // Derived INSIDE the literal — the object is frozen, and assigning after the
  // freeze throws in module scope, which takes the whole renderer down at
  // import time rather than at render time.
  progressY: H_CANVAS.h - H_DRIFT_SAFE_Y - 6,   // 1046
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
 * marginX (72) — type margin, not a platform constraint. 16:9 uses 96 on 1920,
 *   which is 5.0%; 72 on 1080 is 6.7%. Deliberately a larger FRACTION — the
 *   vertical measure is 936 against 1728, and the same 5% would run lines edge
 *   to edge at a width the eye tracks effortlessly anyway.
 *
 * NOT THE 4:5 BOX. A symmetric 285/285 inset is the common rule of thumb, but
 * the real chrome is strongly asymmetric — almost all of it is at the bottom —
 * so 4:5 discards 145px of usable top while adding nothing at the bottom. The
 * asymmetric numbers above are drawn by the stills harness's --safe overlay
 * alongside the 4:5 line, so the choice is checkable by looking.
 *
 * ⚠️ UNVERIFIED ON A DEVICE. These are reasoned from documented overlay
 * positions, not measured on a phone. DrJ is reviewing the stills on one.
 */
const V_CANVAS = { w: 1080, h: 1920 };
const V_SAFE_BOTTOM = 320;
const V_CONTENT_BOTTOM = V_CANVAS.h - V_SAFE_BOTTOM;   // 1600
export const VERTICAL = Object.freeze({
  name: "vertical",
  canvas: Object.freeze({ w: 1080, h: 1920 }),
  marginX: 72,
  contentW: 1080 - 72 * 2,          // 936
  safeTop: 140,
  safeBottom: 320,
  safeRight: 168,
  // The measure for anything that must dodge the action rail.
  contentWRail: 1080 - 72 - 168,    // 840
  chromeTopY: 140,
  counterTop: 140,
  driftSafeX: 44,
  driftSafeY: 28,
  progressH: 5,
  contentBottom: V_CONTENT_BOTTOM,
  // The progress line sits at the bottom of OUR content area, not the bottom of
  // the frame as it does in 16:9. Below contentBottom is the platform's band.
  progressY: V_CONTENT_BOTTOM - 6,      // 1594
  reservedBottomY: V_CONTENT_BOTTOM,
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
