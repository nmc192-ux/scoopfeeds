/**
 * videoSlideRendererVertical.js — the 9:16 layouts.
 *
 * FORKED COMPOSITIONS, NOT SCALED ONES, and the diagram is the proof: at 1920
 * wide it is a horizontal ticked rail; at 1080 wide, six nodes would sit 156px
 * apart carrying 300px labels, so it becomes a DOWNWARD rail. No parameter
 * sweep gets you from one to the other, which is why the layouts fork here
 * rather than the 16:9 ones growing a width switch.
 *
 * What does NOT fork is the chrome and the brand primitives — they come from
 * videoSlideChrome.js bound to the vertical geometry. See videoGeometry.js for
 * why, and for the safe-area margins and what each is protecting against.
 *
 * SAME STATE CONTRACT AS 16:9. Every card returns 3-6 cumulative keyframe
 * states that ffmpeg crossfades; nothing animates, and the final state is the
 * complete composition. fitStatesToDuration collapses from the second-to-last
 * backwards, so the LAST state must remain the whole card — a vertical layout
 * that only looks right once every state has landed would lose content on any
 * short caption.
 *
 * ⚠️ THIS FILE FEEDS THE CACHE KEY (videoSlideRenderer.VIDEO_BUILDER_FINGERPRINT).
 */

import { VERTICAL } from "./videoGeometry.js";
import { makePrimitives, COLORS as C, FONTS as F, antonWidth, fitDisplaySize, GROUND } from "./videoSlideChrome.js";
import { truncateLoudly } from "./videoSlideRenderer.js";
import { logger } from "./logger.js";

const G = VERTICAL;
const { root, chrome, eyebrow, hairline, sourceCredit, sourceBadge, antonLine, box, text, abs } = makePrimitives(G);

/**
 * Vertical Y table.
 *
 * Vertical buys height and spends width, so each of these is a TALLER STACK OF
 * SHORTER LINES than its 16:9 equivalent rather than the same stack scaled.
 * Where a 16:9 slot assumed one line, the vertical slot budgets two — a 46-char
 * stat label at 42px over a 936px measure wraps, and the first draft put the
 * source hairline straight through it.
 */
export const VY = Object.freeze({
  eyebrow:    260,
  titleLine1: 360,
  titleLine2: 588,
  titleSub:   980,
  titleDate:  1140,

  statValue:  330,
  statLine1:  860,
  statLine2:  1000,
  statRule:   1150,
  statCredit: 1184,

  barsFirst:  360,
  barsRow:    190,
  diagramFirst: 380,
  diagramRow: 178,

  kickTop:    420,
  kickBottom: 660,
  kickSub:    980,
});

// A newly revealed bar enters at this fraction of its final width and reaches
// full width in the next state. Small enough that the growth is legible across a
// 0.35s crossfade, large enough that the bar never reads as missing.
const BAR_ENTER = 0.34;

const eyebrowV = (s) => eyebrow(s, VY.eyebrow);
const base = (card, ctx) => [...chrome(ctx), eyebrowV(card.eyebrow || "")];

// ─── title ──────────────────────────────────────────────────────────────────

const TITLE_NOMINAL = 104;
const TITLE_MIN = 64;
const KICKER_NOMINAL = 96;

/**
 * ONE size for a GROUP of display lines, decided by the widest of them.
 *
 * Shared by title, turn and kicker — all three stack Anton lines at a fixed size
 * over the same 936px measure, so all three have the same exposure. Fixing only
 * the one that was reported would have left two card types looking fixed.
 *
 * Per-line fitting is deliberately not offered: two headline lines at different
 * sizes read as a mistake rather than as typography.
 */
function fitLineGroup(texts, { nominal, min = TITLE_MIN, what }) {
  const candidates = texts.filter(Boolean).map(String);
  if (!candidates.length) return nominal;
  const longest = candidates.sort((a, b) => antonWidth(b, nominal) - antonWidth(a, nominal))[0];
  const fit = fitDisplaySize((size) => antonWidth(longest, size),
    { nominalSize: nominal, maxWidth: G.contentW, minSize: min });
  if (fit.overflow > 0) {
    logger.warn(
      `🎬 ${what} line "${longest}" does not fit ${G.contentW}px even at the ${min}px floor ` +
      `(over by ${fit.overflow}px) — rendering whole rather than clipping`
    );
  } else if (fit.fitted) {
    logger.info(`🎬 ${what} auto-fitted ${nominal}px → ${fit.size}px for "${longest}"`);
  }
  return fit.size;
}

/**
 * Unlike the stat card this was NOT overflowing in the reported render, and the
 * measurement says why: at 104px the longest realistic words clear the measure
 * with room —
 *
 *   INFRASTRUCTURE (14ch)        706   ok
 *   TELECOMMUNICATIONS (18ch)    931   ok   (against a 1008 measure edge)
 *   COUNTERINTELLIGENCE (19ch)   907   ok
 *
 * So this is prevention, not a fix. The headroom is real but thin — roughly 19
 * average characters, and only 12 of the widest glyph (Anton's M is 75 units
 * against I's 23) — and a single unbreakable word has nowhere to wrap to.
 */
function titleStatesV(card, ctx) {
  const [l1, l2] = (card.lines || []).slice(0, 2);
  const limeIdx = (card.lines || []).findIndex(l => l[1] === "lime");

  const size = fitLineGroup([l1?.[0], l2?.[0]], { nominal: TITLE_NOMINAL, what: "title" });
  const line = (pair, top) => pair
    ? antonLine(pair[0], { top, size, color: pair[1] === "lime" ? C.lime : C.white })
    : null;
  const b = () => base(card, ctx);
  return [
    { key: "s1", lime: false, tree: root(GROUND.INK, [...b()]) },
    { key: "s2", lime: limeIdx === 0, tree: root(GROUND.INK, [...b(), line(l1, VY.titleLine1)].filter(Boolean)) },
    { key: "s3", lime: limeIdx >= 0, tree: root(GROUND.INK, [...b(), line(l1, VY.titleLine1), line(l2, VY.titleLine2)].filter(Boolean)) },
    { key: "s4", lime: limeIdx >= 0, tree: root(GROUND.INK, [
        ...b(), line(l1, VY.titleLine1), line(l2, VY.titleLine2),
        card.sub ? text(card.sub, {
          position: "absolute", left: G.marginX, top: VY.titleSub, maxWidth: G.contentW,
          fontSize: 38, fontWeight: 600, color: C.sub, lineHeight: 1.3,
        }) : null,
        // The badge cannot sit top-right here: at 1080 wide it would collide
        // with the slide counter, which the 1920 frame has room to separate.
        // It moves under the sub-line, above the date, as a provenance pair.
        ctx.outlet ? text(String(ctx.outlet).toUpperCase(), {
          position: "absolute", left: G.marginX, top: VY.titleDate,
          fontSize: 24, fontWeight: 600, letterSpacing: 5, color: C.dim,
        }) : null,
        card.date ? text(card.date, {
          position: "absolute", left: G.marginX, top: VY.titleDate + 40,
          fontSize: 24, fontWeight: 600, letterSpacing: 3, color: C.dim,
        }) : null,
      ].filter(Boolean)) },
  ];
}

// ─── stat ───────────────────────────────────────────────────────────────────

// The shipped design, as literals, so the fit reads as a departure from it.
const STAT_NOMINAL = 400;
const STAT_UNIT_RATIO = 150 / 400;   // the unit is 37.5% of the figure, always
const STAT_UNIT_GAP = 12;
// LOWERED 200 → 180 WITH marginX 72 → 104. The floor is only meaningful
// relative to the measure it is fitting into, and narrowing contentW from 936 to
// 872 pushed realistic figures past it: "1,400,000%" missed by 1px and
// "12,345,678%" by 45, which the guard would have rendered whole and overflowing
// — correct behaviour, wrong trigger. 180 restores the headroom the margin took
// (measured: "12,345,678%" lands at 823px against 872) and is still a very large
// headline figure. Genuinely absurd input — nine digits plus a unit — still
// exceeds any sane floor and is still logged loudly rather than truncated.
const STAT_MIN = 180;
const STAT_LS = -4;

/**
 * The figure, auto-fitted.
 *
 * MEASURED FAILURE (DrJ, 2026-08-14, from a live YouTube Short): "14,000"
 * rendered with its last glyph clipped at the right frame edge. Confirmed on the
 * real render path — at 1080 wide the fixed 400px figure runs past the 936px
 * measure from five characters upward, and past the FRAME from six:
 *
 *   7,000               933   ok
 *   14,000             1061   over by 53
 *   140,000           >1079   clipped
 *   7,000 + a unit    >1079   clipped
 *
 * 16:9 is unaffected — the same figures end at 833-1500 against a 1824 measure,
 * so the horizontal layout keeps its fixed sizes and its byte-identical render.
 * This is a consequence of spending width, not a latent bug that vertical
 * happened to reveal.
 *
 * The unit scales WITH the figure rather than staying at 150: the 37.5% ratio is
 * the design relationship, and holding the unit fixed while the figure shrinks
 * inverts the hierarchy on exactly the cards where the number matters most.
 */
function fittedStatSize(card) {
  const avail = G.contentW;
  // THE MEASURE MUST MODEL THE RENDER EXACTLY, rounding included. The unit is
  // rendered at Math.round(size * RATIO); measuring the unrounded value let the
  // fit accept a size whose real width was up to ~1px wider, and "1,400,000%"
  // duly overflowed by exactly 1px. A guarantee that is off by a rounding step
  // is not a guarantee.
  const unitSize = (size) => Math.round(size * STAT_UNIT_RATIO);
  const measure = (size) =>
    antonWidth(card.value, size, STAT_LS) +
    (card.unit ? STAT_UNIT_GAP + antonWidth(card.unit, unitSize(size)) : 0);

  const fit = fitDisplaySize(measure, { nominalSize: STAT_NOMINAL, maxWidth: avail, minSize: STAT_MIN });
  if (fit.overflow > 0) {
    // NO SILENT CAPS. At the floor and still over: the figure is rendered whole
    // and overflowing rather than truncated, because a clipped number is a WRONG
    // number and this is the one element on the card that must not lie.
    logger.warn(
      `🎬 stat "${card.value}${card.unit || ""}" does not fit ${avail}px even at the ${STAT_MIN}px floor ` +
      `(over by ${fit.overflow}px) — rendering whole and overflowing rather than clipping a digit`
    );
  } else if (fit.fitted) {
    logger.info(`🎬 stat "${card.value}${card.unit || ""}" auto-fitted ${STAT_NOMINAL}px → ${fit.size}px to hold the ${avail}px measure`);
  }
  return fit.size;
}

function statStatesV(card, ctx) {
  const b = () => base(card, ctx);
  const hi = Number.isInteger(card.hi) ? card.hi : -1;
  const vSize = fittedStatSize(card);
  const value = box({
    position: "absolute", left: G.marginX, top: VY.statValue, alignItems: "flex-end",
  }, [
    text(card.value, { fontFamily: F.anton, fontSize: vSize, lineHeight: 1.0, letterSpacing: STAT_LS, color: C.white }),
    card.unit ? text(card.unit, {
      fontFamily: F.anton, fontSize: Math.round(vSize * STAT_UNIT_RATIO), lineHeight: 1.0,
      color: C.white, marginLeft: STAT_UNIT_GAP,
      // The unit sits on the figure's baseline, so its offset has to track the
      // fitted size — a fixed 52 would float it off a shrunken figure.
      marginBottom: Math.round(52 * (vSize / STAT_NOMINAL)),
    }) : null,
  ].filter(Boolean));
  const supportLine = (i, top) => {
    const s = (card.lines || [])[i];
    if (!s) return null;
    return text(s, {
      position: "absolute", left: G.marginX, top, maxWidth: G.contentW,
      fontSize: 42, fontWeight: 600, color: i === hi ? C.lime : C.sub, lineHeight: 1.25,
    });
  };
  const limeAfterLines = hi >= 0 && Boolean((card.lines || [])[hi]);
  return [
    { key: "s1", lime: false, tree: root(GROUND.INK, [...b()]) },
    { key: "s2", lime: false, tree: root(GROUND.INK, [...b(), value]) },
    { key: "s3", lime: hi === 0, tree: root(GROUND.INK, [...b(), value, supportLine(0, VY.statLine1)].filter(Boolean)) },
    { key: "s4", lime: limeAfterLines, tree: root(GROUND.INK, [...b(), value, supportLine(0, VY.statLine1), supportLine(1, VY.statLine2)].filter(Boolean)) },
    { key: "credit", lime: limeAfterLines, credit: true, tree: root(GROUND.INK, [
        ...b(), value, supportLine(0, VY.statLine1), supportLine(1, VY.statLine2),
        hairline(VY.statRule, 420), sourceCredit(card.source, VY.statCredit),
      ].filter(Boolean)) },
  ];
}

// ─── bars ───────────────────────────────────────────────────────────────────

function barsStatesV(card, ctx) {
  const bars = truncateLoudly(card.bars || [], 5, { what: "bars", card, ctx });
  const max = Math.max(...bars.map(b => Number(b[1]) || 0), 1);
  const leadIdx = bars.reduce((best, b, i) => (Number(b[1]) > Number(bars[best][1]) ? i : best), 0);
  const BAR_H = 46;
  // LABEL ABOVE THE BAR, not beside it. A side-by-side label costs ~40% of a
  // 936px measure and leaves a stub of a bar; stacked, the bar keeps the full
  // rail-safe width and the label gets a whole line.
  const trackW = G.contentWRail;

  /**
   * ONE ENTRY, in one of two conditions.
   *
   * ACTIVE — the entry this beat is about. Full accent, and a spotlight behind
   * it. RECEDED — on screen, legible, plainly not the subject. The receded
   * colours are chosen (COLORS.receded*), never an alpha of the accent: lime at
   * 25% over the ground keeps lime's hue and reads as a rendering fault.
   *
   * `grow` is the bar's fraction of its own final width. A newly revealed bar
   * enters SHORT and reaches full width in the next state, so the crossfade
   * between two cumulative states does the growing — no extra states, and
   * therefore nothing new for fitStatesToDuration to collapse.
   */
  const oneBar = (bar, i, { active, grow = 1 }) => {
    const top = VY.barsFirst + i * VY.barsRow;
    const full = Math.max(10, Math.round((Number(bar[1]) / max) * trackW));
    const w = Math.max(10, Math.round(full * grow));
    return [
      // The spotlight sits UNDER the row, first in paint order. A soft radial
      // lift rather than a box: an edge would read as a container the design
      // does not otherwise have.
      active ? abs({
        left: G.marginX - 40, top: top - 34, width: trackW + 80, height: BAR_H + 130,
        backgroundImage: "radial-gradient(60% 120% at 22% 50%, rgba(221,231,6,0.16) 0%, rgba(221,231,6,0) 70%)",
      }) : null,
      text(bar[0], { position: "absolute", left: G.marginX, top, maxWidth: trackW - 150, fontSize: 34, fontWeight: 600,
        color: active ? C.sub : C.recededText }),
      // Values right-align to the RAIL inset, not the margin — at the margin
      // they sit under the like/comment column.
      text(bar[1], { position: "absolute", right: G.safeRight, top: top - 12, fontFamily: F.anton, fontSize: 62,
        color: active ? C.lime : C.recededFigure }),
      abs({ left: G.marginX, top: top + 62, width: trackW, height: BAR_H, background: "#151310" }),
      abs({ left: G.marginX, top: top + 62, width: w, height: BAR_H, background: active ? C.lime : C.recededFill }),
    ].filter(Boolean);
  };

  const b = () => base(card, ctx);
  const states = [{ key: "s1", lime: false, tree: root(GROUND.INK, [...b()]) }];
  const groups = bars.length <= 4 ? bars.map((_, i) => [i]) : [[0], [1], [2], [3, 4]];
  let shown = [];
  groups.forEach((g, gi) => {
    shown = [...shown, ...g];
    // ACTIVE = the entry just revealed. The reveal order IS the order the
    // narration discusses them in, so "newest" is the same thing as "the one
    // being talked about" without needing a second field to say so.
    const justRevealed = new Set(g);
    states.push({
      key: `bar${gi + 1}`,
      lime: true,
      tree: root(GROUND.INK, [...b(), ...shown.flatMap(i =>
        oneBar(bars[i], i, { active: justRevealed.has(i), grow: justRevealed.has(i) ? BAR_ENTER : 1 }))]),
    });
  });

  // THE FINAL STATE RETURNS TO THE CARD'S POINT. Every bar is present and the
  // LEAD is the one in colour — the comparison the card exists to make. This is
  // also the frame that survives every collapse, so it has to be the whole card.
  const creditTop = Math.min(VY.barsFirst + bars.length * VY.barsRow + 10, G.contentBottom - 120);
  states.push({
    key: "credit", lime: true, credit: true,
    tree: root(GROUND.INK, [
      ...b(), ...bars.flatMap((bar, i) => oneBar(bar, i, { active: i === leadIdx })),
      hairline(creditTop, 420), sourceCredit(card.source, creditTop + 26),
    ]),
  });
  return states;
}

// ─── diagram ────────────────────────────────────────────────────────────────

function diagramStatesV(card, ctx) {
  const nodes = truncateLoudly(card.nodes || [], 6, { what: "nodes", card, ctx });
  const n = nodes.length;
  const b = () => base(card, ctx);
  const RAIL_X = G.marginX + 26;
  const markerOn = Number.isInteger(card.marker?.on) ? card.marker.on : -1;

  const rowsFor = (upto, withMarker) => nodes.slice(0, upto).flatMap((nd, i) => {
    const top = VY.diagramFirst + i * VY.diagramRow;
    const marked = withMarker && i === markerOn;
    return [
      abs({ left: RAIL_X - 9, top: top + 6, width: 18, height: 18, background: marked ? C.lime : C.recededFill, borderRadius: 9 }),
      ...(i < n - 1 ? [
        abs({ left: RAIL_X - 1, top: top + 26, width: 2, height: VY.diagramRow - 26, background: C.rule }),
        // The same two-rotated-bars chevron as 16:9 — the CSS border-triangle
        // idiom renders as a solid square in satori and destroys the direction.
        abs({ left: RAIL_X - 8, top: top + VY.diagramRow - 14, width: 16, height: 2, background: C.track, transform: "rotate(45deg)" }),
        abs({ left: RAIL_X + 1, top: top + VY.diagramRow - 14, width: 16, height: 2, background: C.track, transform: "rotate(-45deg)" }),
      ] : []),
      text(nd[0], { position: "absolute", left: RAIL_X + 44, top, maxWidth: G.contentWRail - 70, fontFamily: F.anton, fontSize: 54, color: marked ? C.lime : C.recededText }),
      nd[1] ? text(nd[1], { position: "absolute", left: RAIL_X + 44, top: top + 64, maxWidth: G.contentWRail - 70, fontSize: 30, fontWeight: 600, color: C.dim, lineHeight: 1.25 }) : null,
      ...(marked && card.marker?.label ? [text(String(card.marker.label).toUpperCase(), {
        position: "absolute", right: G.safeRight, top: top + 8,
        fontSize: 26, fontWeight: 600, letterSpacing: 4, color: C.lime,
      })] : []),
    ].filter(Boolean);
  });

  const states = [{ key: "s1", lime: false, tree: root(GROUND.INK, [...b()]) }];
  const groups = n <= 4 ? nodes.map((_, i) => i + 1) : [1, 2, 3, n];
  groups.forEach((upto, gi) => {
    states.push({ key: `node${gi + 1}`, lime: false, tree: root(GROUND.INK, [...b(), ...rowsFor(upto, false)]) });
  });
  // The marker lands LAST and is the card's single lime element, matching 16:9.
  states.push({ key: "marker", lime: markerOn >= 0, tree: root(GROUND.INK, [...b(), ...rowsFor(n, true)]) });
  return states;
}

// ─── turn / kicker ──────────────────────────────────────────────────────────

function turnStatesV(card, ctx) {
  const [l1, l2] = (card.lines || []).slice(0, 2);
  const limeIdx = (card.lines || []).findIndex(l => l[1] === "lime");
  const size = fitLineGroup([l1?.[0], l2?.[0]], { nominal: TITLE_NOMINAL, what: "turn" });
  const line = (pair, top) => pair
    ? antonLine(pair[0], { top, size, color: pair[1] === "lime" ? C.lime : C.white })
    : null;
  const b = () => base(card, ctx);
  return [
    { key: "s1", lime: false, tree: root(GROUND.INK, [...b()]) },
    { key: "s2", lime: limeIdx === 0, tree: root(GROUND.INK, [...b(), line(l1, VY.titleLine1)].filter(Boolean)) },
    { key: "s3", lime: limeIdx >= 0, tree: root(GROUND.INK, [...b(), line(l1, VY.titleLine1), line(l2, VY.titleLine2)].filter(Boolean)) },
    { key: "s4", lime: limeIdx >= 0, tree: root(GROUND.INK, [
        ...b(), line(l1, VY.titleLine1), line(l2, VY.titleLine2),
        card.sub ? text(card.sub, {
          position: "absolute", left: G.marginX, top: VY.titleSub, maxWidth: G.contentW,
          fontSize: 38, fontWeight: 600, color: C.sub, lineHeight: 1.3,
        }) : null,
      ].filter(Boolean)) },
  ];
}

function kickerStatesV(card, ctx) {
  const b = () => [...chrome(ctx), eyebrowV("WHAT NOW")];
  // Same exposure as title and turn: two Anton lines at a fixed size over the
  // same 936px measure. Fitted as one group so the pair keeps a single size.
  const kSize = fitLineGroup([card.top, card.bottom], { nominal: KICKER_NOMINAL, what: "kicker" });
  return [
    { key: "s1", lime: false, tree: root(GROUND.INK, [...b()]) },
    { key: "s2", lime: false, tree: root(GROUND.INK, [...b(), antonLine(card.top, { top: VY.kickTop, size: kSize, color: C.white })]) },
    { key: "s3", lime: true, tree: root(GROUND.INK, [
        ...b(),
        antonLine(card.top, { top: VY.kickTop, size: kSize, color: C.white }),
        antonLine(card.bottom, { top: VY.kickBottom, size: kSize, color: C.lime }),
      ]) },
    { key: "s4", lime: true, tree: root(GROUND.INK, [
        ...b(),
        antonLine(card.top, { top: VY.kickTop, size: kSize, color: C.white }),
        antonLine(card.bottom, { top: VY.kickBottom, size: kSize, color: C.lime }),
        card.sub ? text(card.sub, {
          position: "absolute", left: G.marginX, top: VY.kickSub, maxWidth: G.contentW,
          fontSize: 38, fontWeight: 600, color: C.sub, lineHeight: 1.3,
        }) : null,
      ].filter(Boolean)) },
  ];
}

const BUILDERS_V = {
  title: titleStatesV, stat: statStatesV, bars: barsStatesV,
  diagram: diagramStatesV, turn: turnStatesV, kicker: kickerStatesV,
};

/** Every keyframe state for one card, at 9:16. Throws on an unknown type — the
 *  closed set is closed in both orientations. */
export function verticalStatesForCard(card, ctx = {}) {
  const build = BUILDERS_V[card?.t];
  if (!build) throw new Error(`videoSlideRendererVertical: no layout for card type "${card?.t}"`);
  return build(card, ctx);
}

export const _verticalInternals = { G, VY, BUILDERS_V };
