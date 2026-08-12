/**
 * _verticalStills — STEP 1 of the vertical-layout brief. Reference stills only.
 *
 * DELIBERATELY NOT IN src/. The brief's central design decision (additive
 * per-card-type variants vs something else) is still open, and drafting the
 * layouts here means the reference render exists BEFORE anything in the
 * production module moves. Nothing in src/ is touched by this file. The
 * builders below are written the way I would lift them into production, so if
 * the structure is approved the move is mechanical rather than a rewrite.
 *
 * WORST-CASE BY CONSTRUCTION, not by sampling:
 *   - Captions are NOT persisted anywhere — specs are generated per run and
 *     discarded, and `video_posts` carries titles, not captions. So there is no
 *     "longest caption in the corpus" to look up. CAPTION_MAX_CHARS (160) is
 *     the stated writing ceiling, so the caption below is exactly 160
 *     characters: the worst case the contract permits.
 *   - `bars` and `diagram` are rendered at the RENDERER's caps (5 and 6). The
 *     SCHEMA has no upper bound at all — see the report.
 *
 * THE CAPTION IS BURNED, not omitted. Captions are drawn by ffmpeg drawtext at
 * assembly, not by satori, so a satori-only still would hide the single largest
 * vertical risk: the text column is 1080 wide instead of 1920, so a caption
 * that wrapped to two lines in 16:9 has roughly half the measure here. Showing
 * a frame without it would be showing a frame that never reaches a viewer.
 *
 *   node _verticalStills.mjs             # six stills + a contact sheet
 *   node _verticalStills.mjs --safe      # with the safe-area overlay drawn on
 *   node _verticalStills.mjs --no-caption
 */

import "./src/config/env.js";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const argv = process.argv;
const SAFE_OVERLAY = argv.includes("--safe");
const WITH_CAPTION = !argv.includes("--no-caption");

const { renderTreeToPng, fontsReady } = await import("./src/services/renderCore.js");
const { COLORS: C } = await import("./src/services/videoSlideRenderer.js");
const { getFFmpegPath } = await import("./src/services/videoGenerator.js");

if (!fontsReady({ requireAnton: true })) { console.error("Anton is required for display type"); process.exit(1); }

const OUT = path.resolve("./data/vertical-stills");
mkdirSync(OUT, { recursive: true });

// ─── Vertical geometry ──────────────────────────────────────────────────────

export const V = Object.freeze({ w: 1080, h: 1920 });

/**
 * SAFE AREA. Every number here is protecting against a specific piece of
 * platform chrome that is invisible in this render and present on the phone.
 *
 * SAFE_BOTTOM (320) — the largest and the one that actually bites. Shorts and
 *   Reels stack the video title, the channel handle, the caption and the
 *   progress bar across the bottom. 320px at 1920 is ~17% of height, which
 *   covers the two-line-title case rather than the one-line case.
 *
 * SAFE_TOP (140) — occasional "Shorts" chrome and the status bar on the
 *   taller phones. Smaller than the bottom because nothing persistent lives
 *   here; it is a clearance, not a reservation.
 *
 * SAFE_RIGHT (168) — the action rail: like / comment / share / sound / avatar.
 *   Vertically centred-to-low on the right edge. Anything full-bleed to the
 *   right edge below the midline is under a button.
 *
 * MARGIN_X (72) — the type margin, not a platform constraint. 16:9 uses 96 on
 *   1920, which is 5.0% of width; 72 on 1080 is 6.7%. Deliberately a larger
 *   FRACTION: the vertical measure is 936px against 1728px, so the same 5%
 *   would leave lines running edge to edge at a width where the eye has no
 *   trouble tracking them anyway.
 *
 * The brief cites a 4:5 safe area (1080×1350 centred, i.e. 285 top and bottom).
 * That is a stricter, symmetric rule of thumb from still-image posting. It is
 * NOT used as the primary constraint here because the real chrome is strongly
 * asymmetric — almost all of it is at the bottom — and a symmetric 285/285
 * would throw away 145px of perfectly usable top area while UNDER-protecting
 * the bottom by nothing at all. Both are drawn by --safe so the difference is
 * visible rather than argued.
 */
export const SAFE = Object.freeze({
  TOP: 140,
  BOTTOM: 320,
  RIGHT: 168,
  MARGIN_X: 72,
});
const CONTENT_W = V.w - SAFE.MARGIN_X * 2;          // 936
// RAIL-SAFE MEASURE. Anything that runs to the right edge below the midline is
// under the like/comment/share column. Full-bleed CHROME (the progress line) is
// fine there; content is not.
const CONTENT_W_RAIL = V.w - SAFE.MARGIN_X - SAFE.RIGHT;   // 840
const CONTENT_TOP = SAFE.TOP;
const CONTENT_BOTTOM = V.h - SAFE.BOTTOM;           // 1600
// The 4:5 box, for comparison only.
const FOUR_FIVE_INSET = Math.round((V.h - (V.w * 5) / 4) / 2);   // 285

// ─── Tree helpers (same shapes as the 16:9 module) ──────────────────────────

const F = { inter: "Inter", anton: "Anton" };
const box = (style, children = []) => ({ type: "div", props: { style: { display: "flex", ...style }, children } });
const text = (content, style) => ({
  type: "div",
  props: { style: { display: "flex", fontFamily: F.inter, ...style }, children: [{ type: "span", props: { children: String(content ?? "") } }] },
});
const abs = (style, children = []) => box({ position: "absolute", ...style }, children);

const root = (children) => box({
  width: V.w, height: V.h, background: C.base,
  position: "relative", overflow: "hidden", flexDirection: "column",
}, children);

// The progress line sits at the BOTTOM OF OUR CONTENT AREA, not at the bottom
// of the frame as it does in 16:9. Below CONTENT_BOTTOM is the platform's band.
const PROGRESS_Y = CONTENT_BOTTOM - 6;

function chrome({ slideIndex = 2, slideCount = 7 }) {
  const frac = (slideIndex + 1) / slideCount;
  return [
    text("SCOOPFEEDS", {
      position: "absolute", left: SAFE.MARGIN_X, top: CONTENT_TOP,
      fontSize: 24, fontWeight: 600, letterSpacing: 6, color: C.faint,
    }),
    text(`${slideIndex + 1} / ${slideCount}`, {
      position: "absolute", right: SAFE.MARGIN_X, top: CONTENT_TOP,
      fontSize: 22, fontWeight: 600, letterSpacing: 2, color: "#3a3830",
    }),
    abs({ left: 0, top: PROGRESS_Y, width: V.w, height: 5, background: "#1a1814" }),
    abs({ left: 0, top: PROGRESS_Y, width: Math.round(V.w * frac), height: 5, background: C.limeChrome }),
  ];
}

const safeOverlay = () => !SAFE_OVERLAY ? [] : [
  abs({ left: 0, top: 0, width: V.w, height: SAFE.TOP, background: "rgba(255,0,0,0.16)" }),
  abs({ left: 0, top: CONTENT_BOTTOM, width: V.w, height: SAFE.BOTTOM, background: "rgba(255,0,0,0.16)" }),
  abs({ left: V.w - SAFE.RIGHT, top: 0, width: SAFE.RIGHT, height: V.h, background: "rgba(0,120,255,0.14)" }),
  abs({ left: 0, top: FOUR_FIVE_INSET, width: V.w, height: 2, background: "rgba(0,255,120,0.5)" }),
  abs({ left: 0, top: V.h - FOUR_FIVE_INSET, width: V.w, height: 2, background: "rgba(0,255,120,0.5)" }),
  text("4:5", { position: "absolute", left: 8, top: FOUR_FIVE_INSET + 6, fontSize: 20, color: "rgba(0,255,120,0.8)" }),
];

const eyebrow = (s, top) => text(String(s || "").toUpperCase(), {
  position: "absolute", left: SAFE.MARGIN_X, top,
  fontSize: 28, fontWeight: 600, letterSpacing: 5, color: C.dim,
});
const hairline = (top, width = 420) => abs({ left: SAFE.MARGIN_X, top, width, height: 1, background: C.rule });
const sourceCredit = (source, top) => text(`SOURCE: ${String(source || "").toUpperCase()}`, {
  position: "absolute", left: SAFE.MARGIN_X, top,
  fontSize: 24, fontWeight: 600, letterSpacing: 4, color: C.dim, opacity: 0.7,
});
const antonLine = (s, { top, size = 104, color = C.white }) => text(s, {
  position: "absolute", left: SAFE.MARGIN_X, top, maxWidth: CONTENT_W,
  fontFamily: F.anton, fontSize: size, lineHeight: 1.02, color,
});

// ─── Vertical Y table ───────────────────────────────────────────────────────
//
// Vertical buys height and spends width, so everything below is a taller stack
// of shorter lines than the 16:9 equivalent — not the same stack scaled.
const Y = Object.freeze({
  eyebrow:    260,
  titleLine1: 360,
  titleLine2: 588,
  titleSub:   980,
  titleDate:  1140,

  statValue:  330,
  // Two lines of room for EACH support line. The worst case wraps: a 46-char
  // label at 42px over a 936px measure is two lines, and the first draft put
  // the rule at 1070 straight through it.
  statLine1:  860,
  statLine2:  1000,
  statRule:   1150,
  statCredit: 1184,

  barsFirst:  360,
  diagramFirst: 380,

  kickTop:    420,
  kickBottom: 660,
  kickSub:    980,
});

// ─── Per-card vertical layouts (final state — the fullest composition) ──────

const CTX = { slideIndex: 2, slideCount: 7, outlet: "REUTERS" };
const base = () => [...safeOverlay(), ...chrome(CTX), eyebrow(CARD_EYEBROW, Y.eyebrow)];
let CARD_EYEBROW = "";

function titleV(card) {
  CARD_EYEBROW = card.eyebrow;
  const [l1, l2] = card.lines;
  return root([
    ...base(),
    antonLine(l1[0], { top: Y.titleLine1, color: l1[1] === "lime" ? C.lime : C.white }),
    antonLine(l2[0], { top: Y.titleLine2, color: l2[1] === "lime" ? C.lime : C.white }),
    text(card.sub, { position: "absolute", left: SAFE.MARGIN_X, top: Y.titleSub, fontSize: 38, fontWeight: 600, color: C.sub, maxWidth: CONTENT_W, lineHeight: 1.3 }),
    text(String(CTX.outlet), { position: "absolute", left: SAFE.MARGIN_X, top: Y.titleDate, fontSize: 24, fontWeight: 600, letterSpacing: 5, color: C.dim }),
    text(card.date, { position: "absolute", left: SAFE.MARGIN_X, top: Y.titleDate + 40, fontSize: 24, fontWeight: 600, letterSpacing: 3, color: C.dim }),
  ]);
}

function statV(card) {
  CARD_EYEBROW = card.eyebrow;
  return root([
    ...base(),
    box({ position: "absolute", left: SAFE.MARGIN_X, top: Y.statValue, alignItems: "flex-end" }, [
      text(card.value, { fontFamily: F.anton, fontSize: 400, lineHeight: 1.0, letterSpacing: -4, color: C.white }),
      text(card.unit, { fontFamily: F.anton, fontSize: 150, lineHeight: 1.0, color: C.white, marginLeft: 12, marginBottom: 52 }),
    ]),
    text(card.lines[0], { position: "absolute", left: SAFE.MARGIN_X, top: Y.statLine1, maxWidth: CONTENT_W, fontSize: 42, fontWeight: 600, color: C.sub, lineHeight: 1.25 }),
    text(card.lines[1], { position: "absolute", left: SAFE.MARGIN_X, top: Y.statLine2, maxWidth: CONTENT_W, fontSize: 42, fontWeight: 600, color: C.lime, lineHeight: 1.25 }),
    hairline(Y.statRule),
    sourceCredit(card.source, Y.statCredit),
  ]);
}

function barsV(card) {
  CARD_EYEBROW = card.eyebrow;
  const bars = card.bars.slice(0, 5);
  const max = Math.max(...bars.map(b => b[1]), 1);
  const leadIdx = bars.reduce((best, b, i) => (b[1] > bars[best][1] ? i : best), 0);
  // Label ABOVE the bar, value at the right of the label row. Side-by-side
  // label+bar costs ~40% of a 936px measure to the label and leaves a stub.
  const ROW = 190, BAR_H = 46;
  const trackW = CONTENT_W_RAIL;
  const one = (b, i) => {
    const top = Y.barsFirst + i * ROW;
    const w = Math.max(10, Math.round((b[1] / max) * trackW));
    return [
      text(b[0], { position: "absolute", left: SAFE.MARGIN_X, top, maxWidth: CONTENT_W_RAIL - 150, fontSize: 34, fontWeight: 600, color: C.sub }),
      text(b[1], { position: "absolute", right: SAFE.RIGHT, top: top - 12, fontFamily: F.anton, fontSize: 62, color: i === leadIdx ? C.lime : C.white }),
      abs({ left: SAFE.MARGIN_X, top: top + 62, width: trackW, height: BAR_H, background: "#151310" }),
      abs({ left: SAFE.MARGIN_X, top: top + 62, width: w, height: BAR_H, background: i === leadIdx ? C.lime : C.track }),
    ];
  };
  const creditTop = Y.barsFirst + bars.length * ROW + 10;
  return root([
    ...base(), ...bars.flatMap(one),
    hairline(creditTop), sourceCredit(card.source, creditTop + 26),
  ]);
}

function diagramV(card) {
  CARD_EYEBROW = card.eyebrow;
  const nodes = card.nodes.slice(0, 6);
  // VERTICAL RAIL. The 16:9 diagram is a horizontal ticked rule; at 1080 wide,
  // six nodes would be 156px apart with 300px labels. So the chain runs DOWN
  // the frame, which is also the direction the eye already travels here.
  const RAIL_X = SAFE.MARGIN_X + 26;
  const ROW = 178;
  const rows = nodes.flatMap((nd, i) => {
    const top = Y.diagramFirst + i * ROW;
    const isMark = card.marker && card.marker.on === i;
    return [
      abs({ left: RAIL_X - 9, top: top + 6, width: 18, height: 18, background: isMark ? C.lime : C.track, borderRadius: 9 }),
      ...(i < nodes.length - 1 ? [
        abs({ left: RAIL_X - 1, top: top + 26, width: 2, height: ROW - 26, background: C.rule }),
        abs({ left: RAIL_X - 8, top: top + ROW - 14, width: 16, height: 2, background: C.track, transform: "rotate(45deg)" }),
        abs({ left: RAIL_X + 1, top: top + ROW - 14, width: 16, height: 2, background: C.track, transform: "rotate(-45deg)" }),
      ] : []),
      text(nd[0], { position: "absolute", left: RAIL_X + 44, top, maxWidth: CONTENT_W_RAIL - 70, fontFamily: F.anton, fontSize: 54, color: isMark ? C.lime : C.white }),
      text(nd[1], { position: "absolute", left: RAIL_X + 44, top: top + 64, maxWidth: CONTENT_W_RAIL - 70, fontSize: 30, fontWeight: 600, color: C.dim, lineHeight: 1.25 }),
      ...(isMark ? [text(card.marker.label.toUpperCase(), {
        position: "absolute", right: SAFE.RIGHT, top: top + 8, fontSize: 26, fontWeight: 600, letterSpacing: 4, color: C.lime,
      })] : []),
    ];
  });
  return root([...base(), ...rows]);
}

function turnV(card) {
  CARD_EYEBROW = card.eyebrow;
  const [l1, l2] = card.lines;
  return root([
    ...base(),
    antonLine(l1[0], { top: Y.titleLine1, color: C.white }),
    antonLine(l2[0], { top: Y.titleLine2, color: C.lime }),
    text(card.sub, { position: "absolute", left: SAFE.MARGIN_X, top: Y.titleSub, maxWidth: CONTENT_W, fontSize: 38, fontWeight: 600, color: C.sub, lineHeight: 1.3 }),
  ]);
}

function kickerV(card) {
  CARD_EYEBROW = "WHAT NOW";
  return root([
    ...base(),
    antonLine(card.top, { top: Y.kickTop, size: 96, color: C.white }),
    antonLine(card.bottom, { top: Y.kickBottom, size: 96, color: C.lime }),
    text(card.sub, { position: "absolute", left: SAFE.MARGIN_X, top: Y.kickSub, maxWidth: CONTENT_W, fontSize: 38, fontWeight: 600, color: C.sub, lineHeight: 1.3 }),
  ]);
}

// ─── Worst-case content ─────────────────────────────────────────────────────

// Exactly CAPTION_MAX_CHARS (160). Not sampled — no caption corpus is persisted.
const CAPTION = "Reuters reports that seventy percent of recorded transmission faults last year came down to a single cause nobody had thought to plan for at all.";

const CARDS = {
  title: () => titleV({
    eyebrow: "SUBSEA INFRASTRUCTURE",
    lines: [["THE CABLES THAT", "white"], ["CARRY EVERYTHING", "lime"]],
    sub: "Almost all intercontinental data moves along the seabed rather than through orbit, on a network far thinner than anyone assumes.",
    date: "12 AUGUST 2026",
  }),
  stat: () => statV({
    eyebrow: "RECORDED FAULTS",
    value: 100, unit: "%",
    lines: ["of recorded transmission faults last year", "were traced to dragged anchors in shallow water"],
    source: "Reuters",
  }),
  bars: () => barsV({
    eyebrow: "WHAT ACTUALLY CUTS A CABLE",
    bars: [
      ["dragged anchors in shallow water", 100],
      ["commercial fishing gear", 180],
      ["natural seabed movement", 90],
      ["deliberate interference", 30],
      ["equipment failure at landing", 12],
    ],
    source: "Reuters",
  }),
  diagram: () => diagramV({
    eyebrow: "HOW A BREAK PROPAGATES",
    nodes: [
      ["SHIP", "anchor lowered in a shallow approach"],
      ["SHELF", "cable rises toward the landing station"],
      ["CABLE", "fibre bundle severed under tension"],
      ["OUTAGE", "traffic reroutes to the remaining path"],
      ["QUEUE", "repair ship tasked from another region"],
      ["REPAIR", "grapple, splice and re-lay, thirty days"],
    ],
    marker: { on: 2, label: "the break" },
  }),
  turn: () => turnV({
    eyebrow: "THE REAL STORY",
    lines: [["NOT SABOTAGE", "white"], ["ORDINARY TRAFFIC", "lime"]],
    sub: "The most consequential infrastructure on the planet is broken, routinely, by ships doing entirely unremarkable things.",
  }),
  kicker: () => kickerV({
    top: "NOBODY HAS SAID",
    bottom: "WHO PAYS NEXT",
    sub: "The replacement route is unfunded, and the decision sits with a committee that has not met since spring.",
  }),
};

// ─── Render ─────────────────────────────────────────────────────────────────

const ff = getFFmpegPath();
const FONT_FILE = path.resolve("assets/fonts/Inter-SemiBold.otf");

// Caption geometry mirrors videoAssembler.CAPTION, rescaled to 1080 wide.
// THE BURNED CAPTION MOVES UP, and this is a genuine vertical-only finding.
// In 16:9 the caption band sits at the bottom of the frame because nothing else
// is there. In 9:16 that exact band is where Shorts and Reels draw the video
// title, the channel handle, their own caption and the progress bar — so a
// caption placed the 16:9 way is rendered perfectly and then covered up.
// It therefore sits ABOVE CONTENT_BOTTOM, inside our own area.
const CAP = { fontSize: 30, lineHeight: 40, bottomY: CONTENT_BOTTOM - 44, maxWidth: V.w - 2 * (SAFE.MARGIN_X + 20), maxLines: 2 };

async function burnCaption(pngPath, outPath, caption) {
  const { wrapToWidth } = await import("./src/services/renderCore.js");
  // wrapToWidth is ASYNC — it measures through the real font rather than
  // predicting from character count, which is the whole point of Step 4.
  const lines = await wrapToWidth(caption, { fontSize: CAP.fontSize, maxWidth: CAP.maxWidth });
  const blockH = lines.length * CAP.lineHeight;
  const top = CAP.bottomY - blockH;
  const esc = (v) => String(v).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const filters = lines.map((line, i) => {
    const f = path.join(OUT, `.cap-${i}.txt`);
    writeFileSync(f, line, "utf8");
    return `drawtext=fontfile='${esc(FONT_FILE)}':textfile='${esc(f)}':fontsize=${CAP.fontSize}:fontcolor=0xf5f2ea:` +
           `x=(w-text_w)/2:y=${Math.round(top + i * CAP.lineHeight)}:box=1:boxcolor=0x090706@0.72:boxborderw=12`;
  }).join(",");
  execFileSync(ff, ["-y", "-loglevel", "error", "-i", pngPath, "-vf", filters, outPath]);
  return lines.length;
}

const made = [];
for (const [name, build] of Object.entries(CARDS)) {
  const png = await renderTreeToPng(build(), { width: V.w, height: V.h, background: C.base });
  const raw = path.join(OUT, `${name}-raw.png`);
  writeFileSync(raw, png);
  const final = path.join(OUT, `vertical-${name}.png`);
  let capLines = 0;
  if (WITH_CAPTION) capLines = await burnCaption(raw, final, CAPTION);
  else writeFileSync(final, png);
  made.push({ name, final, capLines });
  console.log(`  ${name.padEnd(9)} → ${path.basename(final)}${WITH_CAPTION ? `  caption wraps to ${capLines} line(s)` : ""}`);
}

// Contact sheet — six frames in a row, scaled to fit a screen.
const sheet = path.join(OUT, "CONTACT-SHEET.png");
execFileSync(ff, [
  "-y", "-loglevel", "error",
  ...made.flatMap(m => ["-i", m.final]),
  "-filter_complex",
  made.map((_, i) => `[${i}:v]scale=380:-1[s${i}]`).join(";") + ";" +
    made.map((_, i) => `[s${i}]`).join("") + `hstack=inputs=${made.length}[out]`,
  "-map", "[out]", sheet,
]);
console.log(`\ncontact sheet → ${sheet}`);
console.log(`safe area: top ${SAFE.TOP} · bottom ${SAFE.BOTTOM} · right ${SAFE.RIGHT} · margin ${SAFE.MARGIN_X} (4:5 inset would be ${FOUR_FIVE_INSET})`);
