// ScoopFeeds long-form card renderer — animated.
//
// satori (element tree → SVG) + @resvg/resvg-js (SVG → PNG), 1920×1080.
// Palette and fonts are lifted verbatim from backend/src/services/videoSlideChrome.js
// so the long-form reads as the same channel as the 60-100s clips.
//
// One lime accent per frame. That rule is the whole look — don't add a second.
//
// ─── Why this renders a TIMELINE, not a state ────────────────────────────────
//
// Measured against the Vox reference: their frame changes 62% of the time,
// ours changed 19%. video-pipeline.md §2 is still right that the FRAME must not
// pan — a moving frame under text is eye-straining — but Vox doesn't pan either.
// They animate CONTENT: lines draw, bars grow, elements arrive. That is the
// format's motion design, and it is what we were missing.
//
// Every card is therefore a function of progress `p` ∈ [0,1], sampled into a
// frame sequence by build.mjs. The timeline is split at PAYOFF_P:
//
//   p 0.00 → 0.35   ENTRANCE — the card poses its question
//   p 0.35 → 1.00   PAYOFF   — the answer lands, timed to the narration
//
// build.mjs renders the entrance fast (1.2s), holds, then plays the payoff at
// ~45% through the spoken line. That preserves the reveal timing that fixed the
// "voice lagging the picture" problem while adding the motion that was absent.

// RESOLVED, NOT BARE-IMPORTED. Bare specifiers resolve relative to THIS file,
// and the engine ships without a node_modules of its own — a stray symlink here
// was removed before commit, which silently broke every render outside the
// folder it was created in. dep() looks in the working directory first, then
// the backend, the same way ffmpeg is found.
import { dep } from "./_deps.mjs";
const _satori = dep("satori");
const satori = _satori.default ?? _satori;
const { Resvg } = dep("@resvg/resvg-js");
import { readFileSync, writeFileSync } from "fs";
import { clamp01, at, enter } from "./anim.mjs";
import { GEO, geoSvg } from "./mapGeo.mjs";
import { assertVerbatim } from "./statement.mjs";
import path from "path";
import { fileURLToPath } from "url";

import { ASSETS } from "./_deps.mjs";
export const W = 1920;
export const H = 1080;

/** Boundary between the entrance phase and the payoff phase. */
export const PAYOFF_P = 0.35;
/** Card types that hold something back for the payoff phase. */
export const HAS_PAYOFF = new Set(["stat", "statement", "equation", "bars", "ledger", "doc", "dotgrid", "pipeline", "map", "linechart", "multiline", "decay", "split"]);

export const C = {
  base: "#090706",
  lime: "#dde706",
  white: "#f5f2ea",
  sub: "#cfcabd",
  dim: "#8a8578",
  faint: "#6b675e",
  rule: "#2a2721",
  track: "#4a473f",
  // Context recession. These are CHOSEN near-neutrals, not a dimmed accent:
  // lime at 25% over the ground composites to #3e3f06, which keeps lime's hue
  // and reads as a BROKEN accent rather than a receded one.
  recededText: "#4a473f",     // was missing — ledger rows referenced it and got `undefined`
  recededFigure: "#3f3c35",
  recededFill: "#26241f",
  // Loss/removal. Dots used to be DELETED to show a shortfall, which reads as
  // "these were never here"; recolouring says "these are gone", which is the
  // actual claim. Warm enough to separate from lime at a glance.
  alert: "#e0452b",
  alertDim: "#6b1f14",
  water: "#0e1a22",
  land: "#191510",
  landEdge: "#2c261d",
};

const FONTS = [
  { name: "Anton", data: readFileSync(path.join(ASSETS, "fonts/Anton-Regular.ttf")), weight: 400, style: "normal" },
  { name: "Inter", data: readFileSync(path.join(ASSETS, "fonts/Inter-Bold.otf")), weight: 700, style: "normal" },
  { name: "Inter", data: readFileSync(path.join(ASSETS, "fonts/Inter-SemiBold.otf")), weight: 600, style: "normal" },
];

/** Minimal hyperscript for satori's element tree (no JSX transpile step). */
export const h = (type, style = {}, children = undefined) => ({
  type,
  props: { style, ...(children === undefined ? {} : { children }) },
});

// img needs src as a PROP (not style), and satori wants a data URI for local
// files. URIs are cached per path — doc cards render ~40 frames each.
const IMG_CACHE = new Map();
const dataUri = (p) => {
  if (!IMG_CACHE.has(p)) IMG_CACHE.set(p, `data:image/png;base64,${readFileSync(p).toString("base64")}`);
  return IMG_CACHE.get(p);
};
const himg = (srcPath, style) => ({ type: "img", props: { src: dataUri(srcPath), style } });
/** Inline SVG as an <img>. satori rasterises it through resvg like any image. */
const hsvg = (svg, style) => ({ type: "img", props: {
  src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, style } });

// Schematic maps are DATA now — see mapGeo.mjs for the element grammar and
// the shipped variants. The renderer keeps two rules from the hardcoded era:
// SHAPES ONLY (satori renders <text> in nested SVGs as nothing, silently), and
// labels are positioned divs in the card, in viewBox coordinates.

const col = (style, children) => h("div", { display: "flex", flexDirection: "column", ...style }, children);
const row = (style, children) => h("div", { display: "flex", flexDirection: "row", ...style }, children);

// Animation primitives (clamp01/seg/ease/at/enter) come from anim.mjs — shared
// with mapGeo.mjs so maps and cards ease identically.

// ─── Chrome ─────────────────────────────────────────────────────────────────

/** The ground every card sits on, plus the standing chrome. */
function frame(children, p = 1, { accentRule = true } = {}) {
  // The accent rule wipes down as the card arrives — the first motion on screen.
  const k = at(p, 0, 0.22);
  return h(
    "div",
    {
      width: W, height: H, display: "flex", flexDirection: "column",
      backgroundColor: C.base, position: "relative",
      padding: "96px 120px", fontFamily: "Inter",
    },
    [
      ...(accentRule
        ? [h("div", {
            position: "absolute", left: 0, top: 0, width: 14,
            height: Math.round(H * k), backgroundColor: C.lime,
          })]
        : []),
      ...(Array.isArray(children) ? children : [children]),
    ]
  );
}

const eyebrow = (text, p, color = C.dim) =>
  h("div", {
    fontFamily: "Inter", fontWeight: 700, fontSize: 26, letterSpacing: 6,
    textTransform: "uppercase", color, marginBottom: 28,
    ...enter(p, 0.02, 0.20, 14),
  }, text);

const source = (text, p) =>
  h("div", {
    position: "absolute", left: 120, bottom: 64,
    fontFamily: "Inter", fontWeight: 600, fontSize: 22, letterSpacing: 1.5,
    color: C.faint, opacity: at(p, 0.75, 1),
  }, text);

/**
 * Roll a figure string toward its value: "$1,240" at k=0.5 → "$620".
 * The number is found once (first numeric run, sign included); everything
 * around it is carried verbatim. Decimals and comma grouping mirror the
 * authored string, and k=1 reproduces it exactly — the roll may never land
 * on a different figure than the author wrote.
 */
const rollFigure = (figure, k) => {
  // AT k=1 THE AUTHORED STRING WINS, UNCONDITIONALLY. Reconstruction can
  // never be trusted to round-trip every grouping convention ("12,40,000"
  // is a real figure on an India story and regroups Western; "007" loses
  // its zeros) — and k=1 is the held frame the viewer actually reads.
  if (k >= 1) return figure;
  // The number never ends on a comma — "1,240, AND RISING" captures "1,240",
  // not "1,240,".
  const m = String(figure).match(/^(.*?)(-?\d(?:[\d,]*\d)?(?:\.\d+)?)(.*)$/s);
  if (!m) return figure;
  const raw = m[2];
  const decimals = (raw.split(".")[1] || "").length;
  const value = parseFloat(raw.replace(/,/g, "")) * k;
  let out = value.toFixed(decimals);
  // Mid-roll grouping is only re-applied when the author grouped Western —
  // any other convention rolls ungrouped and lands verbatim via the k=1
  // short-circuit above.
  if (/^-?\d{1,3}(,\d{3})+$/.test(raw.split(".")[0])) {
    const [int, frac] = out.split(".");
    out = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? "." + frac : "");
  }
  return m[1] + out + m[3];
};

// ─── Card types ─────────────────────────────────────────────────────────────

const CARDS = {
  /** Opening / section title. Giant Anton, lime underline. */
  title: ({ kicker, lines, sub }, p) => frame([
    ...(kicker ? [eyebrow(kicker, p, C.lime)] : []),
    col({ flexGrow: 1, justifyContent: "center" }, [
      ...lines.map((t, i) =>
        h("div", {
          fontFamily: "Anton", fontSize: 150, lineHeight: 1.02,
          color: i === lines.length - 1 ? C.lime : C.white,
          letterSpacing: -1,
          ...enter(p, 0.08 + i * 0.10, 0.34 + i * 0.10, 34),
        }, t)
      ),
      ...(sub ? [h("div", {
        fontFamily: "Inter", fontWeight: 600, fontSize: 34, color: C.sub,
        marginTop: 44, maxWidth: 1300, lineHeight: 1.4,
        ...enter(p, 0.34, 0.60, 20),
      }, sub)] : []),
    ]),
  ], p),

  /** Chapter divider: numeral + name. */
  chapter: ({ n, name }, p) => frame([
    col({ flexGrow: 1, justifyContent: "center" }, [
      h("div", {
        fontFamily: "Anton", fontSize: 240, color: C.recededFigure, lineHeight: 1,
        ...enter(p, 0.04, 0.28, 30),
        // String, always: satori treats a NUMERIC child as a multi-child node
        // and demands display:flex — a storyboard emitting n: 1 instead of
        // n: "01" failed the whole build here.
      }, String(n)),
      h("div", {
        width: Math.round(180 * at(p, 0.18, 0.48)), height: 10,
        backgroundColor: C.lime, margin: "26px 0 34px",
      }),
      h("div", {
        fontFamily: "Anton", fontSize: 92, color: C.white, lineHeight: 1.05, maxWidth: 1400,
        ...enter(p, 0.34, 0.62, 26),
      }, name),
    ]),
  ], p),

  /** One figure, large. The workhorse.
   *
   * `roll: true` makes the figure COUNT to its value over the entrance,
   * settling on the exact authored string at the same moment the fade does
   * (k = 1 at p = 0.30), so it cannot straddle PAYOFF_P. The authored string
   * is the contract: prefix, decimals and thousands grouping are preserved,
   * and a figure with no number in it ("NO DEAL") is left alone. Opt-in —
   * existing films render byte-identically without it.
   */
  stat: ({ kicker, figure, unit, label, src, roll }, p) => {
    const k = at(p, 0.05, 0.30);
    return frame([
      ...(kicker ? [eyebrow(kicker, p)] : []),
      col({ flexGrow: 1, justifyContent: "center" }, [
        row({ alignItems: "baseline" }, [
          h("div", {
            fontFamily: "Anton", fontSize: 300, color: C.lime, lineHeight: 0.95, letterSpacing: -2,
            opacity: k, transform: `translateY(${((1 - k) * 30).toFixed(2)}px)`,
          }, roll ? rollFigure(figure, k) : figure),
          ...(unit ? [h("div", {
            fontFamily: "Anton", fontSize: 96, color: C.lime, marginLeft: 20,
            ...enter(p, 0.16, 0.40, 18),
          }, unit)] : []),
        ]),
        // PAYOFF: the explanation waits for the voice to reach it.
        h("div", {
          fontFamily: "Inter", fontWeight: 700, fontSize: 44, color: C.white,
          marginTop: 36, maxWidth: 1450, lineHeight: 1.32,
          ...enter(p, 0.42, 0.80, 22),
        }, label),
      ]),
      ...(src ? [source(src, p)] : []),
    ], p);
  },

  /** Two-to-four bars with real, legible numbers. Bars GROW. */
  bars: ({ kicker, title, items, src }, p) => {
    const max = Math.max(...items.map((i) => i.value));
    return frame([
      ...(kicker ? [eyebrow(kicker, p)] : []),
      ...(title ? [h("div", {
        fontFamily: "Anton", fontSize: 62, color: C.white, marginBottom: 46,
        maxWidth: 1500, lineHeight: 1.1, ...enter(p, 0.04, 0.26, 22),
      }, title)] : []),
      col({ flexGrow: 1, justifyContent: "center" },
        items.map((it, i) => {
          const hot = !!it.hot;
          // Cold bars draw during the entrance; the hot bar is the payoff.
          const a = hot ? 0.42 : 0.14 + i * 0.06;
          const b = hot ? 0.86 : 0.44 + i * 0.06;
          const grow = at(p, a, b);
          const full = Math.max(10, Math.round((it.value / max) * 1680));
          return col({ marginBottom: 40 }, [
            row({ alignItems: "baseline", marginBottom: 14 }, [
              h("div", {
                fontFamily: "Inter", fontWeight: 700, fontSize: 30, letterSpacing: 2,
                textTransform: "uppercase", color: hot ? C.white : C.track,
                opacity: at(p, a - 0.08, a + 0.10),
              }, it.label),
              h("div", { flexGrow: 1 }),
              h("div", {
                fontFamily: "Anton", fontSize: 76, lineHeight: 1,
                color: hot ? C.lime : C.recededFigure,
                // The number lands as its bar finishes, not before.
                opacity: at(p, b - 0.10, b + 0.06),
              }, it.display),
            ]),
            h("div", { width: 1680, height: 34, backgroundColor: C.recededFill, display: "flex" }, [
              h("div", {
                width: Math.max(2, Math.round(full * grow)), height: 34,
                backgroundColor: hot ? C.lime : C.track,
              }),
            ]),
          ]);
        })
      ),
      ...(src ? [source(src, p)] : []),
    ], p);
  },

  /** Channel signature. Last thing on screen, over the music tail. */
  // BRAND SIGN-OFF ONLY. This renderer ignores its spec by design, and
  // build.mjs appends exactly one of these at the end of every film. A beat
  // authored as card:"outro" therefore drew a SECOND wordmark and silently
  // discarded its own lines — the closing card of the film never appeared.
  // Fail loudly instead of swallowing content.
  outro: (_spec, p) => {
    if (_spec && (_spec.lines || _spec.sub)) {
      throw new Error(
        'card:"outro" renders the fixed ScoopFeeds sign-off and ignores lines/sub, '
        + 'and build.mjs already appends one. Use card:"title" for a closing card.');
    }
    return frame([
    col({ flexGrow: 1, justifyContent: "center" }, [
      h("div", {
        fontFamily: "Anton", fontSize: 150, color: C.lime, lineHeight: 1.0, letterSpacing: -1,
        ...enter(p, 0.04, 0.30, 30),
      }, "SCOOPFEEDS"),
      h("div", {
        width: Math.round(260 * at(p, 0.22, 0.52)), height: 10,
        backgroundColor: C.lime, margin: "34px 0 40px",
      }),
      h("div", {
        fontFamily: "Anton", fontSize: 76, color: C.white, lineHeight: 1.18, maxWidth: 1500,
        ...enter(p, 0.36, 0.62, 24),
      }, "SUBSCRIBE FOR THE NEXT ONE"),
      h("div", {
        fontFamily: "Inter", fontWeight: 700, fontSize: 40, color: C.sub, marginTop: 34,
        ...enter(p, 0.54, 0.80, 18),
      }, "The full dossier, sourced and updated — scoopfeeds.com"),
    ]),
    ], p);
  },

  /** Pull quote — used once, for Watten. */
  quote: ({ text, who, role }, p) => frame([
    col({ flexGrow: 1, justifyContent: "center" }, [
      h("div", {
        fontFamily: "Anton", fontSize: 120, color: C.lime, lineHeight: 0.7, marginBottom: 18,
        ...enter(p, 0.02, 0.18, 18),
      }, "“"),
      h("div", {
        fontFamily: "Inter", fontWeight: 700, fontSize: 62, color: C.white,
        lineHeight: 1.28, maxWidth: 1520, ...enter(p, 0.10, 0.46, 26),
      }, text),
      row({ marginTop: 48, alignItems: "center", ...enter(p, 0.48, 0.74, 18) }, [
        h("div", { width: 70, height: 6, backgroundColor: C.lime, marginRight: 24 }),
        col({}, [
          h("div", { fontFamily: "Inter", fontWeight: 700, fontSize: 32, color: C.white }, who),
          h("div", { fontFamily: "Inter", fontWeight: 600, fontSize: 26, color: C.dim, marginTop: 6 }, role),
        ]),
      ]),
    ]),
  ], p),

  /**
   * A captured statement (tweet), rendered as evidence (#82).
   *
   * NOT a screenshot and NOT X's trade dress: a house-styled quotation card
   * in the same register as `quote` — but its content comes ONLY from the
   * evidence archive (out/evidence/<id>.json, written by captureStatement).
   * There is no path from a found image to this card, on purpose.
   *
   * VERBATIM IS ENFORCED IN THE CARD. A spec may carry display `text` (only
   * to control line breaks); collapsed whitespace must byte-match the
   * archive or the render throws. The archive is the record; edit nothing.
   *
   * spec: { statement: <archived record>, text?, sinceDeleted? }
   */
  tweet: ({ statement, text, sinceDeleted }, p) => {
    if (!statement || !statement.id || statement.text === undefined) {
      throw new Error('tweet card: `statement` must be an archived record from captureStatement — '
        + 'evidence enters only through the archive');
    }
    const shown = text ?? statement.text;
    // Line breaks are presentation; words are not. Compare with whitespace
    // collapsed, and throw through assertVerbatim on any word-level drift.
    const collapse = (t) => t.replace(/\s+/g, " ").trim();
    if (collapse(shown) !== collapse(statement.text)) assertVerbatim(shown, statement);
    const lines = shown.split("\n");
    const big = shown.length < 160;
    const date = statement.createdAt
      ? new Date(statement.createdAt).toLocaleDateString("en-GB",
          { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase()
      : null;
    return frame([
      ...(date ? [eyebrow(date, p)] : []),
      col({ flexGrow: 1, justifyContent: "center" }, [
        h("div", {
          fontFamily: "Anton", fontSize: 110, color: C.lime, lineHeight: 0.7, marginBottom: 16,
          ...enter(p, 0.02, 0.18, 18),
        }, "\u201C"),
        ...lines.map((t, i) => h("div", {
          fontFamily: "Inter", fontWeight: 700, fontSize: big ? 58 : 44, color: C.white,
          lineHeight: 1.3, maxWidth: 1520,
          ...enter(p, 0.08 + i * 0.05, 0.40 + i * 0.05, 24),
        }, t)),
        row({ marginTop: 44, alignItems: "center", ...enter(p, 0.46, 0.72, 18) }, [
          h("div", { width: 70, height: 6, backgroundColor: C.lime, marginRight: 24 }),
          col({}, [
            h("div", { fontFamily: "Inter", fontWeight: 700, fontSize: 32, color: C.white },
              statement.name || statement.handle || "UNATTRIBUTED"),
            ...(statement.handle ? [h("div", {
              fontFamily: "Inter", fontWeight: 600, fontSize: 26, color: C.dim, marginTop: 6,
            }, `@${statement.handle} \u00b7 statement on X`)] : []),
          ]),
        ]),
        ...(sinceDeleted ? [h("div", {
          fontFamily: "Inter", fontWeight: 700, fontSize: 26, color: C.alert, marginTop: 30,
          letterSpacing: 2, textTransform: "uppercase",
          ...enter(p, 0.60, 0.84, 14),
        }, "This post has since been deleted")] : []),
      ]),
      source(`@${statement.handle || "?"} on X \u00b7 archived ${String(statement.fetchedAt).slice(0, 10)}`, p),
    ], p);
  },

  /**
   * A schematic map. The film's single most-requested missing piece: a viewer
   * who cannot picture the chokepoint cannot feel any number about it.
   */
  map: ({ kicker, title, variant = "hormuz", geo, note, src, pin }, p) => {
    // `geo` (inline data in the mapGeo.mjs grammar) outranks `variant` (the
    // shipped registry). A new story's geography is authored as data — the
    // engine is not edited per film any more.
    const G = geo || GEO[variant];
    if (!G) {
      throw new Error(`map: unknown variant "${variant}" and no geo supplied. `
        + `Registry has: ${Object.keys(GEO).join(", ")} — or pass geo: {…} (see mapGeo.mjs).`);
    }
    // Colour tokens in label data resolve against the house palette, exactly
    // like the map's own elements. `pinnable` marks the one label whose text
    // the spec's `pin` field may replace (the strait callout).
    const L = (G.labels || []).map((d) => ({
      ...d, t: d.pinnable && pin ? pin : d.t, c: C[d.c] ?? d.c,
    }));
    return frame([
      ...(kicker ? [eyebrow(kicker, p)] : []),
      ...(title ? [h("div", {
        fontFamily: "Anton", fontSize: 56, color: C.white, marginBottom: 18,
        maxWidth: 1560, lineHeight: 1.1, ...enter(p, 0.02, 0.20, 22),
      }, title)] : []),
      col({ flexGrow: 1, justifyContent: "center" }, [
        h("div", { display: "flex", position: "relative", width: 1600, height: 700 }, [
          hsvg(geoSvg(G, p, C), {
            position: "absolute", left: 0, top: 0, width: 1600, height: 700,
            opacity: at(p, 0.02, 0.18),
          }),
          ...L.map((d) => h("div", {
            position: "absolute", left: d.x, top: d.y, width: d.w || 320,
            fontFamily: d.f || "Inter", fontWeight: 700, fontSize: d.s, color: d.c,
            letterSpacing: d.f === "Anton" ? 2 : 6,
            opacity: at(p, d.a[0], d.a[1]),
          }, d.t)),
        ]),
        ...(note ? [h("div", {
          fontFamily: "Inter", fontWeight: 700, fontSize: 36, color: C.white,
          marginTop: 18, maxWidth: 1500, lineHeight: 1.3, ...enter(p, 0.66, 0.92, 20),
        }, note)] : []),
      ]),
      ...(src ? [source(src, p)] : []),
    ], p);
  },

  /**
   * A line chart over time.
   *
   * Growing bars say "bigger"; a price that moved says "when, and how fast",
   * which is the actual claim about March 2026. Points are plotted at their
   * real dates on a real axis — NOT interpolated into a fake daily series we
   * do not have. `points` are the reported reference values only, and the
   * caption says so.
   */
  linechart: ({ kicker, title, points = [], yMin, yMax, yPrefix = "", ySuffix = "", note, src }, p) => {
    const W = 1460, H = 460, PAD_L = 170, PAD_B = 82, PAD_T = 40;
    const lo = yMin ?? Math.min(...points.map((d) => d.v));
    const hi = yMax ?? Math.max(...points.map((d) => d.v));
    const px = (i) => PAD_L + (i / Math.max(1, points.length - 1)) * (W - PAD_L - 90);
    const py = (v) => PAD_T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - PAD_T - PAD_B);
    const draw = at(p, 0.10, 0.62);
    const shown = draw * (points.length - 1);
    const path = points.map((d, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(d.v).toFixed(1)}`).join(" ");
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += Math.hypot(px(i) - px(i - 1), py(points[i].v) - py(points[i - 1].v));
    }
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
    // Shapes only — labels are divs below, for the same font reason as maps.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
${ticks.map((v) => `<line x1="${PAD_L}" y1="${py(v).toFixed(1)}" x2="${W - 90}" y2="${py(v).toFixed(1)}" stroke="${C.rule}" stroke-width="2"/>`).join("")}
<path d="${path}" fill="none" stroke="${C.lime}" stroke-width="7" stroke-linecap="round"
      stroke-linejoin="round" stroke-dasharray="${len.toFixed(0)}"
      stroke-dashoffset="${((1 - draw) * len).toFixed(0)}"/>
${points.map((d, i) => {
  const vis = clamp01(shown - i + 1);
  return vis <= 0 ? "" : `<circle cx="${px(i).toFixed(1)}" cy="${py(d.v).toFixed(1)}" r="${d.hot ? 15 : 10}" fill="${d.hot ? C.lime : C.white}" opacity="${vis.toFixed(2)}"/>`;
}).join("")}
</svg>`;
    return frame([
      ...(kicker ? [eyebrow(kicker, p)] : []),
      ...(title ? [h("div", {
        fontFamily: "Anton", fontSize: 56, color: C.white, marginBottom: 10,
        maxWidth: 1560, lineHeight: 1.1, ...enter(p, 0.02, 0.20, 22),
      }, title)] : []),
      col({ flexGrow: 1, justifyContent: "center" }, [
        h("div", { display: "flex", position: "relative", width: W, height: H }, [
          hsvg(svg, { position: "absolute", left: 0, top: 0, width: W, height: H,
                      opacity: at(p, 0.02, 0.16) }),
          // y-axis
          ...ticks.map((v) => h("div", {
            position: "absolute", left: 0, top: py(v) - 20, width: PAD_L - 26,
            textAlign: "right", fontFamily: "Inter", fontWeight: 600, fontSize: 28,
            color: C.dim, opacity: at(p, 0.04, 0.20),
            // THE AXIS UNIT IS THE CARD'S TO DECLARE. This was a hardcoded "$"
            // from the film this card was built for, so a percentage axis
            // rendered "$55, $50, $45" and nobody caught it for a whole cut.
          }, `${yPrefix}${Math.round(v)}${ySuffix}`)),
          // value + date per point
          ...points.flatMap((d, i) => {
            const vis = clamp01(shown - i + 1);
            return [
              h("div", {
                position: "absolute",
                left: i === 0 ? px(i) - 60 : Math.max(PAD_L - 150, px(i) - 170),
                top: py(d.v) - (d.hot ? 104 : 92),
                width: 340, textAlign: "center", fontFamily: "Anton",
                fontSize: d.hot ? 54 : 40, color: d.hot ? C.lime : C.white,
                opacity: vis,
              }, d.display),
              h("div", {
                position: "absolute", left: Math.max(PAD_L - 150, px(i) - 170), top: H - PAD_B + 26,
                width: 340, textAlign: "center", fontFamily: "Inter", fontWeight: 600,
                fontSize: 26, color: C.dim, opacity: vis,
              }, d.label),
            ];
          }),
        ]),
        ...(note ? [h("div", {
          fontFamily: "Inter", fontWeight: 700, fontSize: 34, color: C.white,
          marginTop: 16, maxWidth: 1500, lineHeight: 1.3, ...enter(p, 0.68, 0.94, 20),
        }, note)] : []),
      ]),
      ...(src ? [source(src, p)] : []),
    ], p);
  },

  /**
   * Several series on one axis, for "this one is not like the others".
   *
   * `linechart` plots ONE series with a value label per point and a hardcoded
   * currency axis — it was built for a price that moved. This is the other
   * shape: N series where the comparison between them IS the claim, so the
   * lines carry the meaning and only the subject line is labelled. A reader
   * should get it without reading the legend.
   *
   * Every series must be the SAME quantity over the SAME x range, and
   * `values` are plotted verbatim at their index. Nulls end a line early
   * rather than interpolating — a series whose data stops is drawn stopping.
   *
   * ALL DRAWING FINISHES BY 0.34, per the HAS_PAYOFF contract; only `note`
   * uses the payoff span.
   */
  multiline: ({ kicker, title, series = [], xMax, yMax, xLabel, yTicks = 4, note, src }, p) => {
    const W = 1460, H = 430, PAD_L = 150, PAD_B = 74, PAD_T = 26, PAD_R = 250;
    const n = xMax ?? Math.max(...series.map((s) => s.values.length - 1));
    const hi = yMax ?? Math.max(...series.flatMap((s) => s.values.filter((v) => v != null)));
    const px = (i) => PAD_L + (i / Math.max(1, n)) * (W - PAD_L - PAD_R);
    const py = (v) => PAD_T + (1 - v / Math.max(1, hi)) * (H - PAD_T - PAD_B);
    const draw = at(p, 0.08, 0.34);

    const ticks = Array.from({ length: yTicks + 1 }, (_, i) => (hi / yTicks) * i);
    const paths = series.map((s) => {
      const pts = [];
      for (let i = 0; i < s.values.length && i <= n; i++) {
        if (s.values[i] == null) break;
        pts.push([px(i), py(s.values[i])]);
      }
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]);
      return { s, d: pts.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(" "), len, end: pts[pts.length - 1] };
    });

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
${ticks.map((v) => `<line x1="${PAD_L}" y1="${py(v).toFixed(1)}" x2="${(W - PAD_R + 20).toFixed(1)}" y2="${py(v).toFixed(1)}" stroke="${C.rule}" stroke-width="2"/>`).join("")}
${paths.filter((q) => !q.s.hot).map((q) => `<path d="${q.d}" fill="none" stroke="${C.dim}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${q.len.toFixed(0)}" stroke-dashoffset="${((1 - draw) * q.len).toFixed(0)}"/>`).join("")}
${paths.filter((q) => q.s.hot).map((q) => `<path d="${q.d}" fill="none" stroke="${C.lime}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${q.len.toFixed(0)}" stroke-dashoffset="${((1 - draw) * q.len).toFixed(0)}"/>`).join("")}
</svg>`;

    return frame([
      ...(kicker ? [eyebrow(kicker, p)] : []),
      ...(title ? [h("div", {
        fontFamily: "Anton", fontSize: 54, color: C.white, marginBottom: 8,
        maxWidth: 1560, lineHeight: 1.1, ...enter(p, 0.02, 0.18, 22),
      }, title)] : []),
      col({ flexGrow: 1, justifyContent: "center" }, [
        h("div", { display: "flex", position: "relative", width: W, height: H }, [
          hsvg(svg, { position: "absolute", left: 0, top: 0, width: W, height: H,
                      opacity: at(p, 0.02, 0.14) }),
          ...ticks.map((v) => h("div", {
            position: "absolute", left: 0, top: py(v) - 18, width: PAD_L - 26,
            textAlign: "right", fontFamily: "Inter", fontWeight: 600, fontSize: 26,
            color: C.dim, opacity: at(p, 0.04, 0.18),
          }, v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : String(Math.round(v)))),
          // Each line names itself at its own end — no legend to cross-reference.
          // LABELS ARE DE-COLLIDED. The whole point of this card is that four
          // series sit flat near zero while one climbs, which means those four
          // labels all want the same y and overprint into an unreadable smear.
          // They are pushed apart to a minimum gap, in y order, after layout.
          ...(() => {
            const lab = paths.filter((q) => q.end).map((q) => ({ q, y: q.end[1] }))
              .sort((a, b) => a.y - b.y);
            const GAP = 34;
            for (let i = 1; i < lab.length; i++) {
              if (lab[i].y - lab[i - 1].y < GAP) lab[i].y = lab[i - 1].y + GAP;
            }
            // If the stack ran off the bottom, lift the whole run back inside.
            const over = lab.length ? lab[lab.length - 1].y - (H - PAD_B) : 0;
            if (over > 0) for (const l of lab) l.y -= over;
            return lab.flatMap(({ q, y }) => {
              const x = Math.min(W - PAD_R + 16, q.end[0] + 16);
              const o = at(p, 0.24, 0.34);
              return [
                h("div", {
                  position: "absolute", left: x, top: y - (q.s.hot ? 34 : 15),
                  width: PAD_R - 20,
                  fontFamily: q.s.hot ? "Anton" : "Inter", fontWeight: q.s.hot ? 400 : 600,
                  fontSize: q.s.hot ? 38 : 24, color: q.s.hot ? C.lime : C.dim,
                  lineHeight: 1.1, opacity: o,
                }, q.s.name),
                ...(q.s.hot && q.s.endLabel ? [h("div", {
                  position: "absolute", left: x, top: y + 6, width: PAD_R - 20,
                  fontFamily: "Anton", fontSize: 44, color: C.lime, opacity: o,
                }, q.s.endLabel)] : []),
              ];
            });
          })(),
          ...(xLabel ? [h("div", {
            position: "absolute", left: PAD_L, top: H - PAD_B + 30, width: W - PAD_L - PAD_R,
            textAlign: "center", fontFamily: "Inter", fontWeight: 600, fontSize: 26,
            color: C.dim, opacity: at(p, 0.06, 0.20),
          }, xLabel)] : []),
        ]),
        ...(note ? [h("div", {
          fontFamily: "Inter", fontWeight: 700, fontSize: 34, color: C.white,
          marginTop: 18, maxWidth: 1500, lineHeight: 1.3, ...enter(p, 0.62, 0.92, 20),
        }, note)] : []),
      ]),
      ...(src ? [source(src, p)] : []),
    ], p);
  },

  /**
   * Exponential decay against time — for "it was gone before anyone measured it".
   *
   * WHY THIS IS NOT `linechart`. linechart plots authored points at INDEX
   * spacing and hangs a 340px value label off every one: it is a sparse chart of
   * reference readings, and past ~5 points the labels collide. A decay argument
   * needs the opposite — a dense smooth curve on a REAL time axis, where the
   * whole claim is *where along that axis* something happened. Drawing 0, 13min,
   * 4h and 12h at equal spacing would render the one relationship the card
   * exists to show as a straight lie.
   *
   * THE CURVE IS COMPUTED, NOT AUTHORED:
   *   y(t) = baseline + (peak − baseline) · 2^(−t / halfLife)
   * A half-life is the datum sources actually report, so that is what the card
   * takes. Hand-authoring 160 points would let a typo bend the curve away from
   * the physics it claims to draw and nobody would see it. This is DATA driving
   * a fixed renderer — no storyboard-supplied code is executed.
   *
   * LINEAR Y, DELIBERATELY. A log axis turns exponential decay into a straight
   * line, which reads as a gentle ramp. Linear draws what happens: a near
   * vertical fall, then a floor. The floor IS the argument.
   *
   * `beyond` marks a moment off the right edge, drawn as an arrow leaving the
   * chart. Fitting "12 hours" inside a 6-hour axis would mean compressing time;
   * saying it is off the chart is both honest and the stronger picture.
   *
   * Entrance draws the axes and the curve and is FINISHED BY 0.34. The marks and
   * the `beyond` arrow are the payoff — see the equation card's note on why
   * nothing may straddle PAYOFF_P.
   */
  decay: ({ kicker, title, peak, halfLife, xMax, baseline = 0, xAxis = [], yAxis = [],
            marks = [], beyond, note, src }, p) => {
    // PAD_L is the y-label gutter. It is wide because these labels are authored
    // words ("1,000× BASELINE"), not reconstructed numbers — too narrow a
    // gutter wraps one onto two lines and the second line lands in the plot.
    const W = 1460, H = 450, PAD_L = 250, PAD_B = 84, PAD_T = 52;
    const PAD_R = beyond ? 290 : 90;
    const span = Math.max(1e-9, peak - baseline);
    const px = (t) => PAD_L + clamp01(t / xMax) * (W - PAD_L - PAD_R);
    const py = (v) => PAD_T + (1 - clamp01((v - baseline) / span)) * (H - PAD_T - PAD_B);
    const yOf = (t) => baseline + span * Math.pow(2, -t / halfLife);

    // 160 samples: smooth at 1920 wide without bloating the path string, which
    // is base64'd into a data URI on every one of ~40 frames per beat.
    const N = 160;
    const pts = Array.from({ length: N + 1 }, (_, i) => {
      const t = (i / N) * xMax;
      return [px(t), py(yOf(t))];
    });
    let len = 0;
    for (let i = 1; i <= N; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const path = pts.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(" ");
    const draw = at(p, 0.08, 0.34);

    const markAt = at(p, 0.42, 0.72);
    const beyondAt = at(p, 0.60, 0.90);
    const baseY = py(baseline);

    // Shapes only — satori renders <text> inside a nested SVG as nothing, so
    // every label is a positioned div, the same rule maps and linechart follow.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
${yAxis.map((t) => `<line x1="${PAD_L}" y1="${py(t.at).toFixed(1)}" x2="${(W - PAD_R + 10).toFixed(1)}" y2="${py(t.at).toFixed(1)}" stroke="${C.rule}" stroke-width="2"/>`).join("")}
${xAxis.map((t) => `<line x1="${px(t.at).toFixed(1)}" y1="${PAD_T}" x2="${px(t.at).toFixed(1)}" y2="${(H - PAD_B).toFixed(1)}" stroke="${C.rule}" stroke-width="2"/>`).join("")}
<path d="${path}" fill="none" stroke="${C.lime}" stroke-width="7" stroke-linecap="round"
      stroke-linejoin="round" stroke-dasharray="${len.toFixed(0)}"
      stroke-dashoffset="${((1 - draw) * len).toFixed(0)}"/>
${marks.map((m) => {
  const x = px(m.at), y = py(yOf(m.at));
  return `<line x1="${x.toFixed(1)}" y1="${(y - 12).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y - 62).toFixed(1)}" stroke="${C.white}" stroke-width="3" opacity="${markAt.toFixed(2)}"/>`
       + `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="${C.white}" opacity="${markAt.toFixed(2)}"/>`;
}).join("")}
${beyond ? `<line x1="${(W - PAD_R).toFixed(1)}" y1="${baseY.toFixed(1)}" x2="${(W - 74).toFixed(1)}" y2="${baseY.toFixed(1)}" stroke="${C.white}" stroke-width="5" stroke-dasharray="14 10" opacity="${beyondAt.toFixed(2)}"/>`
         + `<polygon points="${(W - 70).toFixed(1)},${baseY.toFixed(1)} ${(W - 100).toFixed(1)},${(baseY - 17).toFixed(1)} ${(W - 100).toFixed(1)},${(baseY + 17).toFixed(1)}" fill="${C.white}" opacity="${beyondAt.toFixed(2)}"/>` : ""}
</svg>`;

    return frame([
      ...(kicker ? [eyebrow(kicker, p)] : []),
      ...(title ? [h("div", {
        fontFamily: "Anton", fontSize: 56, color: C.white, marginBottom: 10,
        maxWidth: 1560, lineHeight: 1.1, ...enter(p, 0.02, 0.20, 22),
      }, title)] : []),
      col({ flexGrow: 1, justifyContent: "center" }, [
        h("div", { display: "flex", position: "relative", width: W, height: H }, [
          hsvg(svg, { position: "absolute", left: 0, top: 0, width: W, height: H,
                      opacity: at(p, 0.02, 0.16) }),
          // y axis — authored labels, never reconstructed from the values. The
          // linechart above carries the scar from a hardcoded "$" axis unit.
          ...yAxis.map((t) => h("div", {
            position: "absolute", left: 0, top: py(t.at) - 18, width: PAD_L - 28,
            textAlign: "right", fontFamily: "Inter", fontWeight: 600, fontSize: 26,
            color: C.dim, opacity: at(p, 0.04, 0.20),
          }, t.label)),
          // x axis
          ...xAxis.map((t) => h("div", {
            position: "absolute", left: px(t.at) - 80, top: H - PAD_B + 24, width: 160,
            textAlign: "center", fontFamily: "Inter", fontWeight: 600, fontSize: 25,
            color: C.dim, opacity: at(p, 0.06, 0.22),
          }, t.label)),
          // Marks sit above a leader line. The left clamp keeps a mark near the
          // start of the axis out of the y-label gutter — centred on its line it
          // would otherwise overprint the axis, which is what "1,000× BASELINE"
          // colliding with "HALF-LIFE" looked like the first time.
          ...marks.map((m) => h("div", {
            position: "absolute",
            left: Math.min(Math.max(px(m.at) - 200, PAD_L - 30), W - PAD_R - 200),
            top: py(yOf(m.at)) - 118, width: 400, textAlign: "center",
            fontFamily: "Inter", fontWeight: 700, fontSize: 30, letterSpacing: 1.5,
            textTransform: "uppercase", color: C.white, lineHeight: 1.25,
            opacity: markAt,
          }, m.label)),
          ...(beyond ? [h("div", {
            position: "absolute", left: W - PAD_R + 10, top: baseY + 34, width: PAD_R,
            fontFamily: "Anton", fontSize: 38, color: C.white, lineHeight: 1.15,
            opacity: beyondAt,
          }, beyond.label)] : []),
        ]),
        ...(note ? [h("div", {
          fontFamily: "Inter", fontWeight: 700, fontSize: 34, color: C.white,
          marginTop: 16, maxWidth: 1500, lineHeight: 1.3, ...enter(p, 0.68, 0.94, 20),
        }, note)] : []),
      ]),
      ...(src ? [source(src, p)] : []),
    ], p);
  },

  /**
   * Two panels, one seam — for "here is what we know, and here is what nobody
   * has published". A panel carries either a `figure` or a `stamp`, and the
   * stamped-absent panel is usually the point of the card: an empty box that
   * says NOT PUBLISHED is a claim about the evidence base, and it is a claim
   * most charts have no way to make.
   *
   * The stamp is the payoff. Everything else finishes by 0.34.
   */
  split: ({ kicker, title, left, right, note, src }, p) => {
    const panel = (d, side) => {
      const stamped = !!d.stamp;
      // The left panel arrives first so the eye is already there when the right
      // one turns out to be empty.
      //
      // BOTH PANELS AND BOTH FIGURES FINISH BY 0.34. These windows were
      // 0.10/0.20 +0.18 with the figure at +0.06→+0.24, which put the right
      // panel's entrance (→0.38) and its figure (0.22→0.40) astride PAYOFF_P —
      // the exact stall the equation card documents. Only the stamp, which is
      // this card's payoff, animates after the cut.
      const a = side === "left" ? 0.06 : 0.14;
      return col({
        width: 760, height: 470, padding: "44px 46px", justifyContent: "space-between",
        backgroundColor: stamped ? "transparent" : C.recededFill,
        border: stamped ? `3px dashed ${C.track}` : "none",
        ...enter(p, a, a + 0.18, 24),
      }, [
        h("div", {
          fontFamily: "Inter", fontWeight: 700, fontSize: 27, letterSpacing: 3,
          textTransform: "uppercase", color: C.dim, lineHeight: 1.3,
        }, d.label),
        ...(stamped
          ? [h("div", {
              fontFamily: "Anton", fontSize: 74, lineHeight: 1.05, color: C.alert,
              letterSpacing: 1, opacity: at(p, 0.44, 0.80),
            }, d.stamp)]
          : [h("div", {
              fontFamily: "Anton", fontSize: 150, lineHeight: 1, color: C.lime,
              opacity: at(p, a + 0.10, a + 0.20),
            }, d.figure)]),
      ]);
    };
    return frame([
      ...(kicker ? [eyebrow(kicker, p)] : []),
      ...(title ? [h("div", {
        fontFamily: "Anton", fontSize: 56, color: C.white, marginBottom: 30,
        maxWidth: 1560, lineHeight: 1.1, ...enter(p, 0.02, 0.20, 22),
      }, title)] : []),
      col({ flexGrow: 1, justifyContent: "center" }, [
        row({ alignItems: "stretch" }, [
          panel(left, "left"),
          h("div", { width: 4, backgroundColor: C.rule, margin: "0 40px" }),
          panel(right, "right"),
        ]),
        ...(note ? [h("div", {
          fontFamily: "Inter", fontWeight: 700, fontSize: 34, color: C.white,
          marginTop: 30, maxWidth: 1500, lineHeight: 1.3, ...enter(p, 0.68, 0.94, 20),
        }, note)] : []),
      ]),
      ...(src ? [source(src, p)] : []),
    ], p);
  },

  /**
   * The cost-recovery equation — the film's central mechanism. Assembles.
   *
   * EVERY TIMING HERE MUST FINISH BY PAYOFF_P (0.35) EXCEPT THE RESULT.
   * build.mjs renders the entrance span over p∈[0,0.35], HOLDS the last
   * entrance frame, then plays the payoff span. Timings that straddle 0.35
   * freeze mid-motion: this card's rule was still drawing (0.18→0.44) and its
   * denominator still fading in (0.26→0.48) at the cut, so it visibly stalled
   * half-built and then jumped. That is what "the equation errs as it appears"
   * looks like. Same rule applies to every card in HAS_PAYOFF.
   */
  equation: ({ kicker, numerator, denominator, result, note, flipped, wipe }, p) => {
    // `wipe: true` reveals each term left-to-right — a cover in the ground
    // colour retreats off it — instead of the fade-and-rise. Same windows,
    // so nothing straddles PAYOFF_P, and at p=1 the frame is pixel-identical
    // to the fade version (the cover has zero width). The device reads as
    // the equation being UNCOVERED, which suits before/after comparisons.
    const term = (text, a, b) => wipe
      ? h("div", { display: "flex", position: "relative" }, [
          h("div", { fontFamily: "Anton", fontSize: 66, color: C.white, lineHeight: 1.1 }, text),
          h("div", {
            position: "absolute", right: 0, top: 0, height: "100%",
            width: `${((1 - at(p, a, b)) * 100).toFixed(2)}%`, backgroundColor: C.base,
          }),
        ])
      : h("div", {
          fontFamily: "Anton", fontSize: 66, color: C.white, lineHeight: 1.1,
          ...enter(p, a, b, 18),
        }, text);
    return frame([
    ...(kicker ? [eyebrow(kicker, p, flipped ? C.lime : C.dim)] : []),
    col({ flexGrow: 1, justifyContent: "center" }, [
      row({ alignItems: "center" }, [
        col({ alignItems: "center" }, [
          term(numerator, 0.02, 0.14),
          // The rule draws left-to-right between the terms.
          h("div", {
            width: Math.round(720 * at(p, 0.10, 0.24)), height: 8,
            backgroundColor: C.lime, margin: "22px 0",
          }),
          term(denominator, 0.16, 0.30),
        ]),
        h("div", {
          fontFamily: "Anton", fontSize: 90, color: C.track, margin: "0 56px",
          opacity: at(p, 0.24, 0.34),
        }, "="),
        // PAYOFF — starts cleanly AFTER the entrance span ends.
        h("div", {
          fontFamily: "Anton", fontSize: 118, lineHeight: 1.05, maxWidth: 620, color: C.lime,
          ...enter(p, 0.40, 0.72, 26),
        }, result),
      ]),
      ...(note ? [h("div", {
        fontFamily: "Inter", fontWeight: 600, fontSize: 34, color: C.sub,
        marginTop: 60, maxWidth: 1500, lineHeight: 1.4,
        ...enter(p, 0.70, 0.94, 18),
      }, note)] : []),
    ]),
  ], p);
  },

  /**
   * A REAL screenshot of a cited source, presented as evidence.
   *
   * This is the device the Vox verticals use constantly (a Truth Social post
   * with the sentence highlighted; an Instagram profile with a hand-drawn
   * circle) and our film had nowhere: show the artifact, don't just cite it.
   *
   * ENTRANCE: the clipping slides up onto the dark ground, slightly rotated,
   * like a physical cutting. PAYOFF: a lime highlight sweeps across the key
   * sentence left→right, timed so it lands as the narration reaches the number.
   *
   * spec: { image (abs path), imgW, imgH, crop {x0,y0,x1,y1} as fractions,
   *         hi {x0,y0,x1,y1} as fractions OF THE CROPPED image, eyebrow, src }
   */
  /**
   * A REAL screenshot of a cited source, presented as evidence.
   *
   * Coordinates come from capture-measured.mjs, which asks the BROWSER where
   * things are rather than having them guessed: the screenshot is exactly the
   * container element's bounding box (so nothing can clip), and `rects` are
   * per-line DOM Range rectangles for the exact phrase (so a highlight that
   * wraps across lines highlights each line correctly).
   *
   * The sweep runs across the rects in reading order, proportional to their
   * widths, so a two-line highlight fills line one before starting line two.
   */
  doc: ({ image, imgW, imgH, rects = [], eyebrow: eb, src }, p) => {
    const scale = Math.min(1580 / imgW, 700 / imgH);
    const panelW = Math.round(imgW * scale), panelH = Math.round(imgH * scale);
    const k = at(p, 0.04, 0.30);
    const sweep = at(p, 0.44, 0.80);

    const total = rects.reduce((a, r) => a + r.w, 0) || 1;
    let consumed = sweep * total;
    const bars = [];
    for (const r of rects) {
      if (consumed <= 0) break;
      const frac = Math.min(1, consumed / r.w);
      consumed -= r.w;
      const w = Math.round(r.w * scale * frac);
      if (w < 2) continue;
      bars.push(h("div", {
        position: "absolute",
        left: Math.round(r.x * scale), top: Math.round(r.y * scale),
        width: w, height: Math.round(r.h * scale),
        backgroundColor: "rgba(221,231,6,0.42)",
      }));
    }

    return frame([
      ...(eb ? [eyebrow(eb, p, C.lime)] : []),
      col({ flexGrow: 1, justifyContent: "center", alignItems: "center" }, [
        h("div", {
          width: panelW + 22, height: panelH + 22, backgroundColor: "#f7f5f0",
          display: "flex", padding: 11, position: "relative",
          transform: `rotate(-0.8deg) translateY(${((1 - k) * 44).toFixed(1)}px)`,
          opacity: k, boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
        }, [
          h("div", { width: panelW, height: panelH, position: "relative", display: "flex", overflow: "hidden" }, [
            himg(image, { position: "absolute", left: 0, top: 0, width: panelW, height: panelH }),
            ...bars,
          ]),
        ]),
      ]),
      ...(src ? [source(src, p)] : []),
    ], p);
  },

  /**
   * A cohort as dots. `out` of `total` drop away on the payoff.
   *
   * WHY: "employment fell eleven percent" is a number you hear and forget.
   * Eleven dots vanishing out of a hundred is a quantity you SEE. This is the
   * device we lacked — Vox illustrates abstractions with diagrams, not stock
   * photos, which is also why their imagery never looks approximate.
   */
  dotgrid: ({ kicker, title, total = 100, out = 0, label, src }, p) => {
    const cols = 20, rows = Math.ceil(total / cols);
    const D = 46, GAP = 12;
    // Affected dots are taken from the END and stagger across the payoff.
    // They RECOLOUR rather than vanish: a disappearing dot reads as "never
    // there", which is the wrong claim — the ships/barrels/people exist, they
    // are the loss. Red states that. (Requested change; also just truer.)
    const goneAt = (i) => {
      const idx = i - (total - out);
      if (idx < 0) return 0;
      return at(p, 0.44 + (idx / Math.max(1, out)) * 0.28, 0.62 + (idx / Math.max(1, out)) * 0.28);
    };
    return frame([
      ...(kicker ? [eyebrow(kicker, p)] : []),
      ...(title ? [h("div", {
        fontFamily: "Anton", fontSize: 58, color: C.white, marginBottom: 40,
        maxWidth: 1560, lineHeight: 1.1, ...enter(p, 0.04, 0.26, 22),
      }, title)] : []),
      col({ flexGrow: 1, justifyContent: "center" }, [
        col({},
          Array.from({ length: rows }, (_, r) =>
            row({ marginBottom: GAP },
              Array.from({ length: Math.min(cols, total - r * cols) }, (_, c) => {
                const i = r * cols + c;
                const arrive = at(p, 0.06 + (i / total) * 0.16, 0.24 + (i / total) * 0.16);
                const gone = goneAt(i);
                // Three-stop recolour so the change is legible mid-transition
                // instead of a single hard swap.
                const fill = gone > 0.62 ? C.alert : gone > 0.18 ? C.alertDim : C.lime;
                return h("div", {
                  width: D, height: D, marginRight: GAP,
                  backgroundColor: fill,
                  opacity: Math.max(0.12, arrive),
                });
              })
            )
          )
        ),
        ...(label ? [h("div", {
          fontFamily: "Inter", fontWeight: 700, fontSize: 40, color: C.white,
          marginTop: 44, maxWidth: 1500, lineHeight: 1.3, ...enter(p, 0.68, 0.94, 20),
        }, label)] : []),
      ]),
      ...(src ? [source(src, p)] : []),
    ], p);
  },

  /**
   * A career pipeline as stages. One stage is `broken` — it draws as an empty
   * dashed outline that never fills, and the arrow into it never completes.
   * This is the film's actual argument in one image.
   */
  pipeline: ({ kicker, title, stages = [], broken = -1, note, src, map }, p) => {
    const W_ = Math.floor(1560 / stages.length) - 40;
    return frame([
      // Optional geography behind the stages. A pipeline is a ROUTE, and the
      // whole point of the bypass chapter is WHERE it goes — abstract boxes
      // can't carry that. Held well back so the stages stay the reading layer.
      ...(map ? [hsvg(geoSvg(GEO[map] ?? (() => {
        throw new Error(`pipeline: unknown map variant "${map}". Registry has: ${Object.keys(GEO).join(", ")}`);
      })(), p, C), {
        position: "absolute", left: 0, top: 210, width: 1920, height: 840,
        opacity: (0.62 * at(p, 0.02, 0.30)).toFixed(3),
      })] : []),
      ...(kicker ? [eyebrow(kicker, p)] : []),
      ...(title ? [h("div", {
        fontFamily: "Anton", fontSize: 58, color: C.white, marginBottom: 54,
        maxWidth: 1560, lineHeight: 1.1, ...enter(p, 0.04, 0.26, 22),
      }, title)] : []),
      col({ flexGrow: 1, justifyContent: "center" }, [
        row({ alignItems: "center" },
          stages.flatMap((st, i) => {
            const isBroken = i === broken;
            // Stages arrive left to right; the broken one waits for the payoff
            // and then only ever reaches a ghost of itself.
            const a = isBroken ? 0.46 : 0.10 + i * 0.11;
            const k = at(p, a, a + 0.24);
            const fill = isBroken ? 0 : k;
            const node = h("div", {
              width: W_, height: 210, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              backgroundColor: isBroken ? C.base : C.recededFill,
              border: isBroken ? `4px dashed ${C.track}` : `4px solid ${C.lime}`,
              opacity: isBroken ? Math.max(0.35, k) : Math.max(0.12, k),
            }, [
              h("div", {
                fontFamily: "Anton", fontSize: 44, lineHeight: 1.1,
                color: isBroken ? C.recededText : C.lime,
              }, st.name),
              ...(st.sub ? [h("div", {
                fontFamily: "Inter", fontWeight: 600, fontSize: 24, marginTop: 12,
                color: isBroken ? C.recededFigure : C.sub, textAlign: "center",
              }, st.sub)] : []),
            ]);
            if (i === stages.length - 1) return [node];
            const arrowK = at(p, a + 0.10, a + 0.30);
            const dead = isBroken || i + 1 === broken;
            return [node, h("div", {
              width: Math.round(40 * (dead ? Math.min(0.45, arrowK) : arrowK)),
              height: 6, backgroundColor: dead ? C.recededFill : C.lime,
              marginLeft: 20, marginRight: 20,
            })];
          })
        ),
        ...(note ? [h("div", {
          fontFamily: "Inter", fontWeight: 600, fontSize: 34, color: C.sub,
          marginTop: 56, maxWidth: 1520, lineHeight: 1.4, ...enter(p, 0.74, 0.96, 18),
        }, note)] : []),
      ]),
      ...(src ? [source(src, p)] : []),
    ], p);
  },

  /** A line of narration set as type. The last line is the payoff. */
  statement: ({ kicker, lines, src }, p) => frame([
    ...(kicker ? [eyebrow(kicker, p)] : []),
    col({ flexGrow: 1, justifyContent: "center" },
      lines.map((t, i) => {
        const last = i === lines.length - 1;
        const a = last ? 0.44 : 0.06 + i * 0.12;
        return h("div", {
          fontFamily: "Anton", fontSize: 96, lineHeight: 1.14,
          color: t.startsWith("*") ? C.lime : C.white, maxWidth: 1620,
          ...enter(p, a, a + 0.26, 26),
        }, t.replace(/^\*/, ""));
      })
    ),
    ...(src ? [source(src, p)] : []),
  ], p),

  /**
   * Three-up ledger. Rows arrive in order; the hot row lights on the payoff.
   * Recession only applies when SOMETHING is hot — beat 60 introduces all three
   * with nothing highlighted, and receding every row leaves no subject at all.
   */
  ledger: ({ kicker, title, rows, src }, p) => frame([
    ...(kicker ? [eyebrow(kicker, p)] : []),
    ...(title ? [h("div", {
      fontFamily: "Anton", fontSize: 68, color: C.white, marginBottom: 54, lineHeight: 1.1,
      ...enter(p, 0.04, 0.26, 22),
    }, title)] : []),
    col({ flexGrow: 1, justifyContent: "center" },
      rows.map((r, i) => {
        const anyHot = rows.some((x) => x.hot);
        const lit = r.hot || !anyHot;
        const a = r.hot ? 0.44 : 0.12 + i * 0.10;
        return row({ marginBottom: 46, ...enter(p, a, a + 0.26, 20) }, [
          h("div", {
            width: 9, alignSelf: "stretch", marginRight: 32,
            backgroundColor: r.hot ? C.lime : anyHot ? C.recededFill : C.track,
          }),
          col({}, [
            h("div", {
              fontFamily: "Anton", fontSize: 64, lineHeight: 1.1,
              color: r.hot ? C.lime : lit ? C.white : C.recededText,
            }, r.who),
            h("div", {
              fontFamily: "Inter", fontWeight: 600, fontSize: 34, marginTop: 12,
              maxWidth: 1500, lineHeight: 1.36,
              color: lit ? C.sub : C.recededFigure,
            }, r.what),
          ]),
        ]);
      })
    ),
    ...(src ? [source(src, p)] : []),
  ], p),
};

// ─── Render ─────────────────────────────────────────────────────────────────

/** Render one card at animation progress `p` ∈ [0,1]. */
export async function renderCard(spec, outPath, p = 1) {
  const build = CARDS[spec.card];
  if (!build) throw new Error(`unknown card type: ${spec.card}`);
  const svg = await satori(build(spec, p), { width: W, height: H, fonts: FONTS });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  writeFileSync(outPath, png);
  return outPath;
}

export const CARD_TYPES = Object.keys(CARDS);
