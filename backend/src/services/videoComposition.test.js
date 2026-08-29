/**
 * Composition rulings from Gate C, asserted against the real geometry and the
 * real filter builders.
 *
 * These are all numbers a frame-by-frame reading of a render produced, so they
 * are pinned as numbers rather than as "looks about right": the caption band at
 * 79.5%, the accent rule at 83%, the chip at x≈663 against a subtitle centred at
 * x≈540. Each test below names the measurement it exists to keep true.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  captionGeometry, MAX_CAPTION_BOTTOM_FRACTION, captionForCard,
  creditChipRegion, buildCutawayCreditFilter, buildSlideFilter,
  cutawayFrameFor, cutawayFrameForLane,
} from "./videoAssembler.js";
import { geometryFor } from "./videoGeometry.js";
import { CLEARANCE_BASES } from "./incident/incidentStatus.js";

const V = geometryFor("vertical");
const FONT = new URL("../../assets/fonts/Inter-SemiBold.otf", import.meta.url).pathname;

// ─── (g) The bottom band ───────────────────────────────────────────────────

test("burned captions sit no lower than 75% of frame height", () => {
  // Measured at 79.5% on the Gate C render. TikTok's furniture reaches ~85% and
  // the Reels caption block sits in that band.
  const cap = captionGeometry("vertical");
  const frac = cap.bottomY / V.canvas.h;
  assert.ok(frac <= MAX_CAPTION_BOTTOM_FRACTION + 1e-9,
    `caption bottom is at ${(frac * 100).toFixed(1)}% of frame height, below the ${MAX_CAPTION_BOTTOM_FRACTION * 100}% ceiling`);
  assert.equal(cap.bottomY, 1440);
});

test("the clamp can only move the band UP, never down", () => {
  // It is a Math.min against the unclamped value, so a future layout change that
  // wanted the caption lower would be silently overruled rather than silently
  // obeyed.
  const cap = captionGeometry("vertical");
  assert.ok(cap.bottomY <= V.contentBottom - 44);
});

test("the caption block the assembler burns IS the one the geometry declares", () => {
  // THE ANTI-DRIFT TEST. captionGeometry once held its own literals; the two
  // files could diverge silently. Tied together so that cannot happen without
  // a failure. (The accent rule these numbers once also positioned is deleted.)
  const cap = captionGeometry("vertical");
  assert.equal(cap.bottomY, V.captionBottomY);
  assert.equal(cap.lineHeight, V.captionLineHeight);
  assert.equal(cap.maxLines, V.captionMaxLines);
  assert.equal(cap.fontSize, V.captionFontSize);
});

// ─── (h) The duplicate subtitle ────────────────────────────────────────────

test("a caption that repeats the card headline is suppressed", () => {
  // The exact case from the render: display lines RIVERSIDE BRIDGE / REOPENS
  // with a burned subtitle reading "Riverside bridge reopens".
  assert.equal(captionForCard({
    lines: [["RIVERSIDE BRIDGE", "white"], ["REOPENS", "lime"]],
    caption: "Riverside bridge reopens",
  }), null);
});

test("the comparison is loose enough to fire on the case that prompted it", () => {
  // Case, punctuation and spacing all differ between a display line and a
  // caption; an exact-match test would never have caught the real one.
  for (const caption of ["riverside bridge reopens", "Riverside Bridge Reopens!", "  RIVERSIDE  BRIDGE REOPENS  "]) {
    assert.equal(captionForCard({ lines: [["RIVERSIDE BRIDGE"], ["REOPENS"]], caption }), null, caption);
  }
});

test("a caption that says something new survives", () => {
  // The mirror: over-eager suppression would silently delete the caption track.
  assert.equal(
    captionForCard({ lines: [["RIVERSIDE BRIDGE"], ["REOPENS"]], caption: "Eleven days closed for inspection" }),
    "Eleven days closed for inspection"
  );
  assert.equal(captionForCard({ title: "What happens next", caption: "Weight limits stay for now" }),
    "Weight limits stay for now");
});

test("a card with no caption or no headline is handled without inventing one", () => {
  assert.equal(captionForCard({}), null);
  assert.equal(captionForCard({ caption: "  " }), null);
  assert.equal(captionForCard({ caption: "Standalone" }), "Standalone", "no headline to duplicate");
});

// ─── (d) The credit chip ───────────────────────────────────────────────────

test("the chip takes the masthead's slot — same x, same top", () => {
  // "When the frame isn't ours, the source's name takes our name's position."
  // The masthead is drawn at left: marginX, top: chromeTopY.
  assert.equal(V.creditX, V.marginX);
  assert.equal(V.creditY, V.chromeTopY);
});

test("the chip is no smaller than the subtitle beneath it", () => {
  // It was 24 against a 38pt subtitle — the smallest text in the frame, which is
  // backwards for something that is a promise to a person.
  const SUBTITLE_SIZE = 38;   // titleStatesV's `sub`
  assert.ok(V.creditFontSize >= SUBTITLE_SIZE,
    `chip is ${V.creditFontSize}pt against a ${SUBTITLE_SIZE}pt subtitle`);
});

test("the chip plate is fully opaque", () => {
  // At @0.62 it survived a test pattern. It would not survive a blown-out sky,
  // which is exactly the frame a phone clip of an outdoor incident produces.
  const f = buildCutawayCreditFilter({
    text: "Sarah Voss / BLUESKY", workDir: "/tmp", slideIndex: 0, fontFile: FONT, orientation: "vertical",
  });
  assert.match(f, /boxcolor=0x090706@1\.0/);
  assert.equal(/@0\.\d/.test(f), false, "no partial alpha may remain on the plate");
});

test("the chip is anchored, not floating at whatever x the text width produced", () => {
  const f = buildCutawayCreditFilter({
    text: "A", workDir: "/tmp", slideIndex: 0, fontFile: FONT, orientation: "vertical",
  });
  const g = buildCutawayCreditFilter({
    text: "A MUCH LONGER CREDIT INDEED", workDir: "/tmp", slideIndex: 1, fontFile: FONT, orientation: "vertical",
  });
  assert.match(f, new RegExp(`x=${V.creditX}:`));
  assert.match(g, new RegExp(`x=${V.creditX}:`));
  assert.equal(/x=w-text_w/.test(f), false, "the old right-anchored form aligned the chip to nothing");
});

test("the credit region follows the chip to its new anchor", () => {
  // The persistence test crops this region. If it did not move with the chip it
  // would be measuring empty frame and every assertion in it would be vacuous.
  const r = creditChipRegion("vertical");
  assert.ok(r.x <= V.creditX && r.x + r.w > V.creditX, "the region must contain the chip's x anchor");
  assert.ok(r.y <= V.creditY && r.y + r.h > V.creditY + V.creditFontSize, "and its full line height");
});

// ─── (e) Lane-aware composition ────────────────────────────────────────────

test("grant renders full-bleed; fair_use and owner keep our framing", () => {
  assert.equal(cutawayFrameForLane("grant", "vertical"), null);
  assert.ok(cutawayFrameForLane("fair_use", "vertical"), "the Lane 3 posture rests on visible commentary");
  // GATE E. Own material keeps the masthead: suppressing our own branding over
  // our own footage makes no sense, and full-bleed is what suppresses it.
  assert.ok(cutawayFrameForLane("owner", "vertical"), "own material renders with normal chrome");
});

test("an unrecognised basis is framed, not full-bleed — the default keeps the masthead", () => {
  // Direction matters. Before Gate E the fall-through was full-bleed, so a typo
  // or a newly-added basis silently suppressed our branding. Suppression is the
  // more consequential outcome, so it has to be asked for by name.
  for (const basis of [null, undefined, "", "OWNER", "grant ", "licence", 0]) {
    assert.ok(cutawayFrameForLane(basis, "vertical"),
      `basis ${JSON.stringify(basis)} must not fall through to a suppressed masthead`);
  }
});

test("every clearance lane has a defined composition — none falls through", () => {
  for (const lane of CLEARANCE_BASES) {
    const frame = cutawayFrameForLane(lane, "vertical");
    assert.ok(frame === null || (frame.w > 0 && frame.h > 0), `lane "${lane}" has no defined composition`);
  }
});

test("the framed box sits inside the content measure, above the caption band", () => {
  const f = cutawayFrameFor("vertical");
  const cap = captionGeometry("vertical");
  assert.equal(f.w, V.contentW);
  assert.ok(f.x >= V.marginX - 1);
  assert.ok(f.y + f.h < cap.bottomY - cap.maxLines * cap.lineHeight,
    "the framed footage must not sit under the caption block");
  // Even dimensions: yuv420p chroma subsampling requires them.
  assert.equal(f.w % 2, 0);
  assert.equal(f.h % 2, 0);
});

test("a framed cutaway overlays at its offset; a full-bleed one covers the frame", () => {
  const framed = buildSlideFilter({
    stateCount: 1, hold: 3, orientation: "vertical",
    cutaway: { inputIndex: 1, seconds: 2, credit: null, frame: cutawayFrameFor("vertical") },
  }).filter;
  const bleed = buildSlideFilter({
    stateCount: 1, hold: 3, orientation: "vertical",
    cutaway: { inputIndex: 1, seconds: 2, credit: null, frame: null },
  }).filter;

  const f = cutawayFrameFor("vertical");
  assert.match(framed, new RegExp(`overlay=${f.x}:${f.y}:eof_action=pass`));
  assert.match(bleed, /overlay=0:0:eof_action=pass/);
  assert.match(framed, new RegExp(`scale=${f.w}:${f.h}`));
});

test("both lanes still use ONE mechanism — a stream that ends, with no time term", () => {
  // The property that makes this one compositing path rather than two: the
  // framed branch differs only in scale and offset. An `enable=` on the overlay
  // would put a time term into the graph, which the type-chain invariance tests
  // forbid.
  for (const frame of [null, cutawayFrameFor("vertical")]) {
    const filter = buildSlideFilter({
      stateCount: 1, hold: 3, orientation: "vertical",
      cutaway: { inputIndex: 1, seconds: 2, credit: null, frame },
    }).filter;
    assert.match(filter, /eof_action=pass/);
    assert.match(filter, /trim=duration=2\.000/);
    const overlayStage = filter.split(";").find((p) => p.includes("overlay="));
    assert.equal(/enable=/.test(overlayStage), false, "no time term may enter an overlay stage");
  }
});


test("in the framed lane the chip takes the PICTURE's corner, not the masthead's", () => {
  // 104/140 inside an 872x490 inset is a third of the way down a picture, not a
  // masthead slot. The credit belongs to the picture it credits, so in that lane
  // it uses the picture's own coordinates. Found by looking at the Gate D
  // render.
  const frame = cutawayFrameFor("vertical");
  const bleed = buildCutawayCreditFilter({
    text: "River Watch / X", workDir: "/tmp", slideIndex: 0, fontFile: FONT, orientation: "vertical",
  });
  const framed = buildCutawayCreditFilter({
    text: "River Watch / X", workDir: "/tmp", slideIndex: 1, fontFile: FONT, orientation: "vertical", frame,
  });
  assert.match(bleed, new RegExp(`x=${V.creditX}:y=${V.creditY}:`));
  const inset = Math.round(V.creditFontSize / 2);
  assert.match(framed, new RegExp(`x=${inset}:y=${inset}:`));
  // Both keep the size and the opaque plate — only the anchor differs.
  for (const f of [bleed, framed]) {
    assert.match(f, new RegExp(`fontsize=${V.creditFontSize}`));
    assert.match(f, /boxcolor=0x090706@1\.0/);
  }
});
