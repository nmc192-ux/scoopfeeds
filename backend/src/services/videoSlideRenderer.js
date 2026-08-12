/**
 * videoSlideRenderer.js — slide spec → keyframe state trees, at 1920×1080.
 *
 * Each card becomes 3-6 KEYFRAME STATES that ffmpeg crossfades. Nothing here
 * animates: a state is a still composition, and motion is the dissolve between
 * two of them plus a drift applied to the assembled segment. That is the whole
 * reason this is affordable — measured 2026-08-02, resvg costs 81.6ms/frame at
 * 1920×1080, so 30fps would be 150s of CPU and 71MB of scratch per video for
 * motion ffmpeg produces for free. ~95 renders instead of 1,800.
 *
 * WHAT THIS FORCES, and it is a good forcing: nothing can grow, sweep, wipe or
 * count. A crossfade between "bar at 0%" and "bar at 100%" is a smear, not a
 * wipe. So bars enter WHOLE, one per state, and stat cards hold their final
 * figure. Every entrance is a dissolve of a complete element.
 *
 * TWO-TIER LIME (approved 2026-08-02). Brief §4 asks for both "accent on
 * exactly one element per frame" and a "lime progress line", which cannot both
 * be true of one colour. So:
 *   - CHROME lime — the progress line, #dde706 at 35%. Present always, never
 *     competes. 35% not 22%: at 4px on a phone, 22% vanishes.
 *   - CONTENT lime — full #dde706, AT MOST ONE element per state and EXACTLY
 *     ONE by the final state. Early states may carry none; the invariant is
 *     protecting against two limes fighting, not mandating one in a near-empty
 *     frame.
 *
 * VIDEO_DESIGN_VER is separate from CARD_DESIGN_VER and always will be —
 * sharing would mean a video layout change re-renders every IG card. It also
 * folds in a fingerprint of THIS FILE'S SOURCE, which is the v12 lesson made
 * structural: editing a layout function below changes the cache key with no
 * human step to forget.
 */

import { renderTreeToPng, sourceFingerprint, fontsReady } from "./renderCore.js";
import { logger } from "./logger.js";
import { HORIZONTAL, geometryFor, DEFAULT_ORIENTATION } from "./videoGeometry.js";
import { makePrimitives, COLORS as C, FONTS as F } from "./videoSlideChrome.js";
import { verticalStatesForCard } from "./videoSlideRendererVertical.js";

export const VIDEO_DESIGN_VER = "vid-v1";
// EVERY MODULE WHOSE CODE DETERMINES A RENDERED PIXEL. This used to hash only
// this file, which was correct when this file WAS the renderer. It no longer
// is: geometry, the shared primitives and the vertical layouts each decide what
// comes out, and a change in any of them with an unchanged key means prod keeps
// serving the frames it already cached. That is the v12 lesson made structural,
// and splitting the renderer across files is exactly how it would have been
// quietly undone.
export const VIDEO_BUILDER_FINGERPRINT = sourceFingerprint([
  import.meta.url,
  new URL("./videoGeometry.js", import.meta.url).href,
  new URL("./videoSlideChrome.js", import.meta.url).href,
  new URL("./videoSlideRendererVertical.js", import.meta.url).href,
]);
export const videoDesignKey = () => `${VIDEO_DESIGN_VER}-${VIDEO_BUILDER_FINGERPRINT}`;

// ─── Geometry — 16:9, moved to videoGeometry.js and re-exported ─────────────
//
// These names are the module's long-standing public surface (videoAssembler and
// three test files import them), so they stay exactly as they were. The VALUES
// now come from the geometry object rather than from literals here.
const G = HORIZONTAL;
export const CANVAS = G.canvas;
export const MARGIN_X = G.marginX;
export const CONTENT_W = G.contentW;
export const CHROME_TOP_Y = G.chromeTopY;
export const RESERVED_BOTTOM_Y = G.reservedBottomY;
export const DRIFT_SAFE_X = G.driftSafeX;
export const DRIFT_SAFE_Y = G.driftSafeY;
export { COLORS } from "./videoSlideChrome.js";

// The primitives, bound to 16:9. Same functions the vertical module binds to
// its own geometry — one definition, two bindings.
const { root, chrome, eyebrow, hairline, sourceCredit, sourceBadge, antonLine, box, text, abs } = makePrimitives(G);

/**
 * Cap a series at what the renderer can draw, LOUDLY.
 *
 * The validator drops over-long cards before they get here, so a warning from
 * this function means something bypassed validation — a harness, a fixture, or
 * a regression in the drop path. Either way it is worth a line, because the
 * failure it replaces was invisible: the extra entries simply were not drawn.
 */
export function truncateLoudly(series, max, { what, card, ctx }) {
  if (series.length <= max) return series;
  logger.warn(
    `🎬 slide ${ctx?.slideIndex ?? "?"} (${card?.t}): ${series.length} ${what} exceeds the ${max} this ` +
    `renderer can draw — drawing ${max} and DISCARDING ${series.length - max}. validateSpec should ` +
    `have dropped this card; it reached the renderer, so something bypassed validation.`
  );
  return series.slice(0, max);
}



// ─── Per-card layouts ───────────────────────────────────────────────────────
//
// Each returns an array of STATES; every state is a full tree. `lime` is noted
// per state so the invariant is checkable rather than asserted.

const Y = Object.freeze({
  eyebrow:     176,
  titleLine1:  300,
  titleLine2:  436,
  titleSub:    610,
  // The absorbed attribution date. Below the sub-line, 260px clear of
  // RESERVED_BOTTOM_Y — it is a provenance detail, not a headline element.
  titleDate:   700,
  // Stat stack, tightened upward (ruling 6): credit lands at 806+32 = 838,
  // clear of RESERVED_BOTTOM_Y by 122px.
  statValue:   238,
  statLine1:   626,
  statLine2:   686,
  statRule:    772,
  statCredit:  806,
  diagramRule: 552,
  barsFirst:   264,
  kickTop:     300,
  kickBottom:  452,
  kickSub:     650,
  kickMark:    740,
});
export const LAYOUT_Y = Y;

function titleStates(card, ctx) {
  const [l1, l2] = (card.lines || []).slice(0, 2);
  const limeIdx = (card.lines || []).findIndex(l => l[1] === "lime");
  const line = (pair, top) => pair
    ? antonLine(pair[0], { top, color: pair[1] === "lime" ? C.lime : C.white })
    : null;
  const base = () => [...chrome(ctx), eyebrow(card.eyebrow || "", Y.eyebrow)];
  return [
    { key: "s1", lime: false, tree: root([...base()]) },
    { key: "s2", lime: limeIdx === 0, tree: root([...base(), line(l1, Y.titleLine1)].filter(Boolean)) },
    { key: "s3", lime: limeIdx >= 0, tree: root([...base(), line(l1, Y.titleLine1), line(l2, Y.titleLine2)].filter(Boolean)) },
    // s4 is where the absorbed attribution card lands: the badge was already
    // here, and the DATE line joins it. Both are code-injected onto the card by
    // decorateTitleCard, never model-written. The spoken credit rides in the
    // caption, so nothing else needs a slide of its own.
    { key: "s4", lime: limeIdx >= 0, tree: root([
        ...base(), line(l1, Y.titleLine1), line(l2, Y.titleLine2),
        card.sub ? text(card.sub, { position: "absolute", left: MARGIN_X, top: Y.titleSub, fontSize: 42, fontWeight: 600, color: C.sub, maxWidth: 1400 }) : null,
        sourceBadge(ctx.outlet),
        card.date ? text(card.date, {
          position: "absolute", left: MARGIN_X, top: Y.titleDate,
          fontSize: 26, fontWeight: 600, letterSpacing: 3, color: C.dim,
        }) : null,
      ].filter(Boolean)) },
  ];
}


function statStates(card, ctx) {
  const base = () => [...chrome(ctx), eyebrow(card.eyebrow || "", Y.eyebrow)];
  const hi = Number.isInteger(card.hi) ? card.hi : -1;
  // Value and unit share a baseline row. No count-up (approved): the figure
  // arrives whole — a crossfade between 0 and 70 smears digits, it cannot count.
  const value = box({
    position: "absolute", left: MARGIN_X, top: Y.statValue, alignItems: "flex-end",
  }, [
    text(card.value, { fontFamily: F.anton, fontSize: 340, lineHeight: 1.0, letterSpacing: -2, color: C.white }),
    card.unit ? text(card.unit, { fontFamily: F.anton, fontSize: 120, lineHeight: 1.0, color: C.white, marginLeft: 16, marginBottom: 44 }) : null,
  ].filter(Boolean));
  const supportLine = (i, top) => {
    const s = (card.lines || [])[i];
    if (!s) return null;
    return text(s, {
      position: "absolute", left: MARGIN_X, top, maxWidth: 1400,
      fontSize: 44, fontWeight: 600, color: i === hi ? C.lime : C.sub,
    });
  };
  const limeAfterLines = hi >= 0 && Boolean((card.lines || [])[hi]);
  return [
    { key: "s1", lime: false, tree: root([...base()]) },
    { key: "s2", lime: false, tree: root([...base(), value]) },
    { key: "s3", lime: hi === 0, tree: root([...base(), value, supportLine(0, Y.statLine1)].filter(Boolean)) },
    { key: "s4", lime: limeAfterLines, tree: root([...base(), value, supportLine(0, Y.statLine1), supportLine(1, Y.statLine2)].filter(Boolean)) },
    { key: "credit", lime: limeAfterLines, credit: true, tree: root([
        ...base(), value, supportLine(0, Y.statLine1), supportLine(1, Y.statLine2),
        hairline(Y.statRule), sourceCredit(card.source, Y.statCredit),
      ].filter(Boolean)) },
  ];
}

function barsStates(card, ctx) {
  // BELT AND BRACES, AND IT SHOULD NEVER FIRE. validateSpec now DROPS a card
  // carrying more than MAX_BARS, so nothing that reaches here can be over-long.
  // The slice stays because this function is also called directly by harnesses
  // that never went through the validator — but it is no longer allowed to be
  // quiet about it. Silent truncation is what let three bars vanish from a
  // published video with no error, no dropped[] entry and nothing in the log.
  const bars = truncateLoudly(card.bars || [], 5, { what: "bars", card, ctx });
  const max = Math.max(...bars.map(b => Number(b[1]) || 0), 1);
  const leadIdx = bars.reduce((best, b, i) => (Number(b[1]) > Number(bars[best][1]) ? i : best), 0);
  const H = 72, GAP = 40;
  const trackW = 1180;

  const oneBar = (b, i) => {
    const top = Y.barsFirst + i * (H + GAP);
    const w = Math.max(8, Math.round((Number(b[1]) / max) * trackW));
    return [
      text(b[0], { position: "absolute", left: MARGIN_X, top: top + 4, fontSize: 36, fontWeight: 600, color: C.sub }),
      abs({ left: MARGIN_X, top: top + 44, width: trackW, height: H - 44, background: "#151310" }),
      abs({ left: MARGIN_X, top: top + 44, width: w, height: H - 44, background: i === leadIdx ? C.lime : C.track }),
      text(b[1], { position: "absolute", left: MARGIN_X + trackW + 32, top: top + 30, fontFamily: F.anton, fontSize: 58, color: C.white }),
    ];
  };

  const base = () => [...chrome(ctx), eyebrow(card.eyebrow || "", Y.eyebrow)];
  const states = [{ key: "s1", lime: false, tree: root([...base()]) }];

  // Bars enter WHOLE, one per state (approved) — a crossfade cannot grow one.
  // With 5 bars the last two share a state to stay inside the 6-state budget.
  const groups = bars.length <= 4
    ? bars.map((_, i) => [i])
    : [[0], [1], [2], [3, 4]];
  let shown = [];
  groups.forEach((g, gi) => {
    shown = [...shown, ...g];
    states.push({
      key: `bar${gi + 1}`,
      lime: shown.includes(leadIdx),
      tree: root([...base(), ...shown.flatMap(i => oneBar(bars[i], i))]),
    });
  });

  const creditTop = Math.min(Y.barsFirst + bars.length * (H + GAP) + 24, RESERVED_BOTTOM_Y - 60);
  states.push({
    key: "credit", lime: true, credit: true,
    tree: root([
      ...base(), ...bars.flatMap((b, i) => oneBar(b, i)),
      hairline(creditTop), sourceCredit(card.source, creditTop + 26),
    ]),
  });
  return states;
}

function diagramStates(card, ctx) {
  // See barsStates — same contract, same reason it must not be silent.
  const nodes = truncateLoudly(card.nodes || [], 6, { what: "nodes", card, ctx });
  const n = nodes.length;
  const base = () => [...chrome(ctx), eyebrow(card.eyebrow || "", Y.eyebrow)];
  // Node labels are 300px boxes CENTRED on their tick, so the rail has to be
  // inset by half a label plus the drift margin or the first and last nodes
  // hang off the canvas — which is exactly what the first render did.
  const NODE_BOX = 300;
  const railL = MARGIN_X + NODE_BOX / 2 + DRIFT_SAFE_X - MARGIN_X + 20;
  const railR = CANVAS.w - railL;
  const step = n > 1 ? (railR - railL) / (n - 1) : 0;
  const xOf = (i) => Math.round(n > 1 ? railL + step * i : CANVAS.w / 2);

  const rule = abs({ left: railL, top: Y.diagramRule, width: railR - railL, height: 2, background: C.rule });

  // DIRECTIONAL connectors (approved): without arrowheads a ticked rule reads
  // as a timeline, which is wrong for a causal chain. Built as a CSS triangle —
  // a zero-size box with one coloured left border.
  const connector = (i) => {
    const x1 = xOf(i - 1), x2 = xOf(i);
    const midY = Y.diagramRule;
    const tipX = x2 - 26;
    // A chevron built from two rotated bars. The CSS border-triangle idiom
    // (zero size + transparent borders) does NOT work in satori — it rendered
    // as a solid square, which read as another tick mark and destroyed the
    // direction the connector exists to show.
    return [
      abs({ left: x1 + 16, top: midY, width: Math.max(8, x2 - x1 - 52), height: 2, background: C.track }),
      abs({ left: tipX - 17, top: midY - 9,  width: 20, height: 3, background: C.track, transform: "rotate(45deg)" }),
      abs({ left: tipX - 17, top: midY + 6,  width: 20, height: 3, background: C.track, transform: "rotate(-45deg)" }),
    ];
  };

  const node = (nd, i, marked) => [
    abs({ left: xOf(i) - 7, top: Y.diagramRule - 6, width: 14, height: 14, background: marked ? C.lime : C.white }),
    text(nd[0], {
      position: "absolute", left: xOf(i) - 150, top: Y.diagramRule - 118, width: 300,
      justifyContent: "center", fontFamily: F.anton, fontSize: 48, color: C.white,
    }),
    nd[1] ? text(nd[1], {
      position: "absolute", left: xOf(i) - 150, top: Y.diagramRule + 44, width: 300,
      justifyContent: "center", fontSize: 26, fontWeight: 600, letterSpacing: 2, color: C.dim,
    }) : null,
  ].filter(Boolean);

  const markerOn = Number.isInteger(card.marker?.on) ? card.marker.on : -1;
  const states = [{ key: "s1", lime: false, tree: root([...base(), rule]) }];

  const groups = n <= 4 ? nodes.map((_, i) => [i]) : [[0], [1], [2], [3, 4, 5].slice(0, n - 3)];
  let shown = [];
  groups.forEach((g, gi) => {
    shown = [...shown, ...g];
    const parts = shown.flatMap(i => [...(i > 0 ? connector(i) : []), ...node(nodes[i], i, false)]);
    states.push({ key: `node${gi + 1}`, lime: false, tree: root([...base(), rule, ...parts]) });
  });

  // The marker is the card's single lime element and lands last. The LIME IS
  // THE TICK, not the label: a lime tick plus a lime label is two accents
  // competing, which the invariant forbids and which a first render shipped.
  // The tick marks WHICH node; the label sits directly beneath it in white so
  // the pair still reads as one unit.
  const allParts = nodes.flatMap((nd, i) => [...(i > 0 ? connector(i) : []), ...node(nd, i, i === markerOn)]);
  const markerLabel = card.marker?.label
    ? text(card.marker.label, {
        position: "absolute", left: Math.max(MARGIN_X, xOf(markerOn) - 200), top: Y.diagramRule + 130, width: 400,
        justifyContent: "center", fontFamily: F.anton, fontSize: 44, color: C.white,
      })
    : null;
  states.push({
    key: "marker", lime: true,
    tree: root([...base(), rule, ...allParts, markerLabel].filter(Boolean)),
  });
  return states;
}

function turnStates(card, ctx) {
  // Collapsed per ruling 4: no dim prior-assumption state, no strikethrough.
  // The schema has no prior-assumption field to draw it from, and a strike
  // reads as debunk when most turns are not debunks.
  const [l1, l2] = (card.lines || []).slice(0, 2);
  const limeIdx = (card.lines || []).findIndex(l => l[1] === "lime");
  const line = (pair, top) => pair
    ? antonLine(pair[0], { top, color: pair[1] === "lime" ? C.lime : C.white })
    : null;
  const base = () => [...chrome(ctx), eyebrow(card.eyebrow || "", Y.eyebrow)];
  return [
    { key: "s1", lime: false, tree: root([...base()]) },
    { key: "s2", lime: limeIdx === 0, tree: root([...base(), line(l1, Y.titleLine1)].filter(Boolean)) },
    { key: "s3", lime: limeIdx >= 0, tree: root([...base(), line(l1, Y.titleLine1), line(l2, Y.titleLine2)].filter(Boolean)) },
    { key: "s4", lime: limeIdx >= 0, tree: root([
        ...base(), line(l1, Y.titleLine1), line(l2, Y.titleLine2),
        card.sub ? text(card.sub, { position: "absolute", left: MARGIN_X, top: Y.titleSub, fontSize: 42, fontWeight: 600, color: C.sub, maxWidth: 1400 }) : null,
      ].filter(Boolean)) },
  ];
}

function kickerStates(card, ctx) {
  const base = () => [...chrome(ctx)];
  const top    = antonLine(card.top, { top: Y.kickTop, size: 132 });
  const bottom = antonLine(card.bottom, { top: Y.kickBottom, size: 132, color: C.lime });
  const sub    = card.sub ? text(card.sub, { position: "absolute", left: MARGIN_X, top: Y.kickSub, fontSize: 42, fontWeight: 600, color: C.sub, maxWidth: 1400 }) : null;
  const mark   = text("SCOOPFEEDS.COM", { position: "absolute", left: MARGIN_X, top: Y.kickMark, fontSize: 34, fontWeight: 600, letterSpacing: 8, color: C.white });
  return [
    { key: "s1", lime: false, tree: root([...base(), top]) },
    { key: "s2", lime: true,  tree: root([...base(), top, bottom]) },
    { key: "s3", lime: true,  tree: root([...base(), top, bottom, sub].filter(Boolean)) },
    { key: "s4", lime: true,  tree: root([...base(), top, bottom, sub, mark].filter(Boolean)) },
  ];
}

const BUILDERS = {
  title: titleStates, stat: statStates,
  bars: barsStates, diagram: diagramStates, turn: turnStates, kicker: kickerStates,
};

/**
 * Every keyframe state for one card, in the requested orientation.
 *
 * ORIENTATION COMES FROM ctx, and defaults to the 16:9 builders when absent so
 * every existing caller and fixture is unaffected. The daily loop passes
 * `orientation` explicitly — see DEFAULT_ORIENTATION in videoGeometry.js.
 *
 * Throws on an unknown card type in BOTH orientations: the closed set is
 * closed, and a vertical layout quietly missing a type would surface as a
 * missing slide rather than as an error.
 */
export function statesForCard(card, ctx = {}) {
  if ((ctx.orientation || "horizontal") === "vertical") return verticalStatesForCard(card, ctx);
  const build = BUILDERS[card?.t];
  if (!build) throw new Error(`videoSlideRenderer: no layout for card type "${card?.t}"`);
  return build(card, ctx);
}

/**
 * Drop states when the slide's audio is too short to hold them.
 *
 * THE FINAL STATE IS NEVER DROPPED. States are CUMULATIVE — each adds an
 * element to the one before, so the last state is the complete composition and
 * every earlier one is a partial reveal of it. Dropping from the very end
 * therefore removes CONTENT, while dropping a middle state removes only a beat
 * of pacing.
 *
 * That distinction is not theoretical. Measured 2026-08-02 on a 7-slide video
 * with realistic ~2.6 words/sec caption timings, plain end-backwards collapse
 * fired on 2 of 7 slides and took with it: the bars card's SOURCE CREDIT
 * (§3b/3's on-screen receipt, on a card carrying figures) and the diagram's
 * MARKER (its single lime element and the entire point of the card). Both are
 * content; neither is pacing.
 *
 * So collapse runs from the SECOND-TO-LAST backwards, preserving the opener
 * and the complete final frame. Every collapse is logged, and the credit case
 * still logs loudly if it is ever reached — with only two states left there is
 * nowhere else to take one from, and that is worth seeing.
 */
export function fitStatesToDuration(states, durationSecs, { minHold = 0.6, crossfade = 0.35, cardType = "?", slideIndex = -1 } = {}) {
  const kept = [...states];
  const fits = () => {
    const usable = durationSecs - crossfade * (kept.length - 1);
    return usable / kept.length >= minHold;
  };
  while (kept.length > 2 && !fits()) {
    const [dropped] = kept.splice(kept.length - 2, 1);   // second-to-last
    logger.info(
      `🎬 slide ${slideIndex} (${cardType}): collapsed state "${dropped.key}" — ` +
      `${durationSecs.toFixed(2)}s too short for ${kept.length + 1} states (final state preserved)`
    );
  }
  // Below two states the only remaining cut IS the final one.
  if (kept.length === 2 && !fits()) {
    const dropped = kept.pop();
    if (dropped.credit) {
      logger.warn(
        `🎬 slide ${slideIndex} (${cardType}): COLLAPSED THE SOURCE-CREDIT STATE — ` +
        `${durationSecs.toFixed(2)}s of audio cannot hold even two states. ` +
        `§3b/3's on-screen credit is NOT rendered on this slide (narration still carries it).`
      );
    } else {
      logger.warn(
        `🎬 slide ${slideIndex} (${cardType}): dropped the FINAL state "${dropped.key}" — ` +
        `${durationSecs.toFixed(2)}s is too short for two states, so this slide loses content, not just pacing.`
      );
    }
  }
  return kept;
}

/**
 * Render one state to a PNG buffer.
 *
 * The dimensions come from the STATE'S OWN tree, not from the module's canvas
 * constant — a vertical tree rendered at 1920x1080 would compose correctly and
 * then be cropped to a letterboxed stripe, which is exactly the failure mode a
 * hardcoded canvas produces once there are two of them.
 */
export async function renderState(state, { orientation } = {}) {
  if (!fontsReady({ requireAnton: true })) throw new Error("videoSlideRenderer: Anton required for video display type");
  const g = orientation ? geometryFor(orientation) : null;
  const w = g?.canvas.w ?? state.tree?.props?.style?.width ?? CANVAS.w;
  const h = g?.canvas.h ?? state.tree?.props?.style?.height ?? CANVAS.h;
  return renderTreeToPng(state.tree, { width: w, height: h, background: C.base });
}

export const _internals = { chrome, Y, C, BUILDERS };
