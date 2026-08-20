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
import path from "path";
import { fileURLToPath } from "url";

import { ASSETS } from "./_deps.mjs";
export const W = 1920;
export const H = 1080;

/** Boundary between the entrance phase and the payoff phase. */
export const PAYOFF_P = 0.35;
/** Card types that hold something back for the payoff phase. */
export const HAS_PAYOFF = new Set(["stat", "statement", "equation", "bars", "ledger", "doc", "dotgrid", "pipeline", "map", "linechart", "multiline"]);

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

/**
 * Schematic maps.
 *
 * SHAPES ONLY — no <text>. satori hands its fonts to its own layout engine,
 * not to images it rasterises, so <text> inside a nested SVG renders as
 * nothing at all (silently: the map came out as unlabelled blobs). Every label
 * is an absolutely-positioned div in the card, in viewBox coordinates.
 *
 * Deliberately schematic, not traced coastline: the film needs the viewer to
 * understand a CHOKEPOINT — two landmasses, one gap — in about two seconds.
 * A faithful outline at 1600px reads as a smudge. Every variant is drawn to
 * real relative geography (Iran north, Musandam poking north to pinch the
 * strait, Gulf west, Gulf of Oman east) but simplified to legible shapes.
 */
function mapSvg(variant, p = 1, opts = {}) {
  const W = 1600, H = 700;
  const g = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

  if (variant === "hormuz") {
    const reveal = at(p, 0.10, 0.55);
    const pulse = at(p, 0.55, 0.95);
    const IRAN = "M0,0 H1600 V96 C1460,120 1330,168 1218,236 C1150,278 1096,318 1058,352 "
      + "L946,372 C742,352 548,296 336,268 C224,253 112,246 0,244 Z";
    // Musandam is the whole reason the strait is narrow — draw it as a spur.
    const ARABIA = "M0,700 H1600 V636 C1498,616 1400,578 1312,532 C1256,502 1206,466 1166,428 "
      + "L1122,392 C1104,376 1086,382 1072,404 L1040,456 C1000,514 940,554 856,584 "
      + "C660,634 372,644 176,660 C104,666 48,672 0,678 Z";
    const routeLen = 1500;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<defs>${g("w", "#12222c", "#0a1319")}${g("l", "#1d1811", "#12100c")}</defs>
<rect width="${W}" height="${H}" fill="url(#w)"/>
<path d="${IRAN}" fill="url(#l)" stroke="${C.landEdge}" stroke-width="3"/>
<path d="${ARABIA}" fill="url(#l)" stroke="${C.landEdge}" stroke-width="3"/>
<path d="M60,300 C300,318 620,352 860,392 C960,408 1030,404 1096,380 C1210,338 1360,286 1540,250"
      fill="none" stroke="${C.lime}" stroke-width="6" stroke-dasharray="${routeLen}"
      stroke-dashoffset="${(1 - reveal) * routeLen}" opacity="0.95" stroke-linecap="round"/>
<circle cx="1090" cy="384" r="${26 + pulse * 20}" fill="none" stroke="${C.lime}"
        stroke-width="4" opacity="${(0.9 * (1 - pulse)).toFixed(3)}"/>
<circle cx="1090" cy="384" r="14" fill="${C.lime}" opacity="${pulse.toFixed(3)}"/>
</svg>`;
  }

  // ── DRC / GREAT LAKES — REAL GEOMETRY ──────────────────────────────────
  // Country outlines are Natural Earth 1:110m (public domain), projected
  // equirectangular into this viewBox with the aspect preserved, and the marked
  // places are real coordinates: Bunia 1.56N 30.25E, Goma -1.68 29.22E,
  // Bukavu -2.51 28.86E, Mongbwalu 1.94N 30.03E. The first version of this card
  // was a hand-drawn blob; on a film about a specific outbreak in specific
  // provinces, an invented coastline is not good enough.
  if (variant === "drc") {
    const spread = at(p, 0.16, 0.72);
    const pin = at(p, 0.55, 0.92);
    const NEIGH = ["M1146.8,248.3L1078.9,250.9L1042.3,250.5L1030.6,254.5L1010.7,264.8L1002.6,261.4L1002.9,236.2L1010.7,223.5L1012.5,196.8L1019.5,181.3L1032.3,163.9L1045.1,155.0L1055.8,143.2L1042.4,138.7L1044.5,99.7L1044.5,99.7L1058.2,90.6L1079.4,98.1L1106.2,90.3L1129.7,90.3L1150.2,75.0L1166.0,98.1L1169.9,114.9L1184.5,153.1L1172.4,177.4L1156.0,199.5L1146.5,213.0L1146.8,248.3Z","M1030.6,254.5L1043.9,273.3L1041.9,292.9L1032.3,297.1L1032.3,297.1L1014.6,294.9L1004.4,313.9L984.2,311.3L987.2,293.1L991.8,290.5L993.1,270.7L1002.6,261.4L1010.7,264.8L1030.6,254.5Z","M1032.3,297.1L1034.3,310.3L1041.4,317.8L1041.7,328.6L1033.5,335.6L1020.5,353.0L1008.5,365.1L994.7,366.7L992.5,326.5L984.2,311.3L1004.4,313.9L1014.6,294.9L1032.3,297.1Z","M1146.8,248.3L1152.4,252.0L1273.3,319.9L1275.6,339.2L1323.4,372.6L1308.0,413.6L1310.0,432.5L1331.3,444.7L1332.3,453.3L1323.2,473.5L1325.1,483.6L1322.9,499.5L1334.5,520.4L1348.3,553.3L1360.6,560.6L1360.6,560.6L1334.0,579.9L1297.6,592.8L1277.6,592.3L1265.7,602.3L1242.5,603.2L1233.8,607.4L1193.7,598.0L1168.7,600.7L1159.3,555.3L1148.0,539.8L1141.3,530.6L1108.6,524.4L1089.7,514.3L1068.5,508.7L1055.3,503.2L1041.3,494.7L1041.3,494.7L1023.3,452.7L1004.0,434.0L997.3,414.7L1000.7,397.3L994.7,366.7L1008.5,365.1L1020.5,353.0L1033.5,335.6L1041.7,328.6L1041.4,317.8L1034.3,310.3L1032.3,297.1L1032.3,297.1L1041.9,292.9L1043.9,273.3L1030.6,254.5L1042.3,250.5L1078.9,250.9L1146.8,248.3Z","M1044.5,99.7L1015.1,77.5L1007.2,63.3L988.6,70.4L973.2,68.2L964.3,73.8L949.3,69.7L929.1,42.2L923.8,31.6L898.9,18.4L890.4,-1.6L876.6,-16.0L854.1,-33.3L853.8,-44.2L835.6,-57.6L812.9,-70.7L823.1,-74.3L834.6,-80.6L843.2,-110.3L852.3,-125.8L876.4,-130.4L882.1,-121.2L899.2,-101.8L908.4,-98.9L920.4,-104.6L944.5,-103.5L949.0,-96.6L982.2,-96.6L983.4,-103.5L1000.5,-109.8L1004.0,-119.5L1016.6,-126.4L1044.6,-106.9L1061.8,-110.3L1078.4,-134.4L1096.7,-152.7L1093.8,-172.7L1085.8,-182.4L1105.8,-184.2L1108.1,-191.6L1123.6,-189.3L1119.6,-164.7L1123.6,-140.7L1140.7,-127.5L1144.7,-116.1L1144.2,-99.5L1148.8,-98.8L1149.2,-72.8L1144.2,-62.6L1126.5,-61.8L1115.1,-42.8L1135.6,-40.4L1152.5,-24.2L1158.3,-10.9L1173.6,-3.1L1193.3,33.1L1170.7,55.1L1150.2,75.0L1129.7,90.3L1106.2,90.3L1079.4,98.1L1058.2,90.6L1044.5,99.7Z","M929.1,42.2L918.1,45.7L896.8,45.0L871.7,41.5L859.3,44.3L854.3,52.4L843.5,53.4L830.4,46.4L793.2,63.0L778.0,59.7L773.5,62.2L763.5,82.4L738.6,75.9L714.3,72.6L693.0,60.3L665.6,48.9L647.7,59.7L634.8,76.6L631.8,99.9L610.3,98.0L587.8,92.4L567.9,110.1L550.4,141.1L546.9,131.4L545.4,116.2L530.2,105.5L517.9,88.3L515.0,76.3L499.3,58.9L502.0,49.0L498.6,34.9L501.2,9.1L509.2,3.1L526.0,-30.7L553.5,-33.2L559.7,-41.8L565.2,-41.2L573.5,-33.6L615.5,-46.4L629.7,-59.4L647.0,-71.0L643.7,-82.8L653.1,-85.8L685.3,-83.8L716.7,-99.2L740.8,-135.6L757.7,-149.1L778.8,-154.7L782.6,-140.5L801.8,-119.6L801.9,-106.0L796.5,-92.2L798.6,-81.8L810.2,-72.2L835.6,-57.6L853.8,-44.2L854.1,-33.3L876.6,-16.0L890.4,-1.6L898.9,18.4L923.8,31.6L929.1,42.2Z","M1041.3,494.7L1055.3,503.2L1068.5,508.7L1089.7,514.3L1108.6,524.4L1124.4,539.2L1132.9,567.5L1127.2,576.6L1120.5,603.6L1126.9,631.2L1116.4,642.8L1106.3,673.8L1123.8,682.4L1022.6,709.9L1025.8,733.6L1000.6,738.2L981.6,751.4L977.5,763.0L965.6,765.6L936.6,793.0L918.1,814.6L906.9,815.4L896.1,811.5L858.8,807.9L852.8,805.4L852.6,802.6L839.4,795.1L817.8,793.2L790.5,800.8L768.7,779.9L746.3,752.7L747.8,646.6L817.2,647.0L814.4,635.5L819.3,623.0L813.5,607.4L817.3,591.2L813.7,580.9L825.2,581.7L827.2,592.1L842.8,591.3L863.9,594.4L875.1,609.5L901.8,614.1L922.1,603.6L929.6,621.1L955.2,625.7L967.5,640.0L981.1,658.3L1006.7,658.6L1003.9,622.6L994.7,628.7L971.4,615.7L962.4,609.8L966.5,576.3L972.5,536.9L965.0,522.2L974.5,500.9L983.4,496.9L1028.2,491.3L1041.3,494.7Z","M427.4,420.0L441.2,415.5L450.8,416.1L462.5,412.1L560.9,412.6L569.1,437.4L578.7,457.4L586.3,468.2L599.1,485.6L621.1,482.9L632.1,478.2L650.6,482.9L655.6,474.6L663.9,455.2L684.6,453.9L686.4,448.1L703.4,448.0L700.5,460.0L740.9,459.7L741.5,480.7L748.3,493.5L743.4,513.6L745.8,534.1L757.0,546.5L755.2,586.2L763.4,583.1L777.9,583.9L798.6,578.9L813.7,580.9L817.3,591.2L813.5,607.4L819.3,623.0L814.4,635.5L817.2,647.0L747.8,646.6L746.3,752.7L768.7,779.9L790.5,800.8L729.2,814.4L648.5,809.6L625.4,793.7L490.3,795.1L485.3,797.4L465.4,782.4L443.8,781.4L423.8,787.1L407.8,793.4L404.7,772.4L409.3,743.1L420.8,712.6L422.5,698.3L433.3,668.3L441.3,654.6L460.4,632.8L471.1,618.0L474.6,593.3L472.9,574.4L462.9,562.5L454.0,542.2L445.8,522.2L447.6,515.3L457.9,502.1L447.8,469.9L440.9,447.6L424.2,426.5L427.4,420.0Z"];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<defs>${g("wd", "#12222c", "#0a1319")}${g("ld", "#1d1811", "#12100c")}</defs>
<rect width="${W}" height="${H}" fill="#080d11"/>
${NEIGH.map((d) => `<path d="${d}" fill="#100d08" stroke="#241f17" stroke-width="2" opacity="0.6"/>`).join("")}
<path d="M994.7,366.7L1000.7,397.3L997.3,414.7L1004.0,434.0L1023.3,452.7L1041.3,494.7L1041.3,494.7L1028.2,491.3L983.4,496.9L974.5,500.9L965.0,522.2L972.5,536.9L966.5,576.3L962.4,609.8L971.4,615.7L994.7,628.7L1003.9,622.6L1006.7,658.6L981.1,658.3L967.5,640.0L955.2,625.7L929.6,621.1L922.1,603.6L901.8,614.1L875.1,609.5L863.9,594.4L842.8,591.3L827.2,592.1L825.2,581.7L813.7,580.9L798.6,578.9L777.9,583.9L763.4,583.1L755.2,586.2L757.0,546.5L745.8,534.1L743.4,513.6L748.3,493.5L741.5,480.7L740.9,459.7L700.5,460.0L703.4,448.0L686.4,448.1L684.6,453.9L663.9,455.2L655.6,474.6L650.6,482.9L632.1,478.2L621.1,482.9L599.1,485.6L586.3,468.2L578.7,457.4L569.1,437.4L560.9,412.6L462.5,412.1L450.8,416.1L441.2,415.5L427.4,420.0L422.7,409.7L431.2,406.1L432.3,391.6L437.7,383.0L449.9,376.0L458.6,379.4L470.0,366.7L488.2,367.0L490.3,376.4L502.8,382.3L522.4,361.5L541.8,345.2L550.2,334.5L549.1,307.1L563.6,274.7L578.8,257.5L600.8,241.5L604.6,230.8L605.5,218.6L610.9,207.0L609.1,188.1L613.3,158.6L619.8,137.8L629.8,120.0L631.8,99.9L634.8,76.6L647.7,59.7L665.6,48.9L693.0,60.3L714.3,72.6L738.6,75.9L763.5,82.4L773.5,62.2L778.0,59.7L793.2,63.0L830.4,46.4L843.5,53.4L854.3,52.4L859.3,44.3L871.7,41.5L896.8,45.0L918.1,45.7L929.1,42.2L949.3,69.7L964.3,73.8L973.2,68.2L988.6,70.4L1007.2,63.3L1015.1,77.5L1044.5,99.7L1044.5,99.7L1042.4,138.7L1055.8,143.2L1045.1,155.0L1032.3,163.9L1019.5,181.3L1012.5,196.8L1010.7,223.5L1002.9,236.2L1002.6,261.4L993.1,270.7L991.8,290.5L987.2,293.1L984.2,311.3L992.5,326.5L994.7,366.7Z" fill="url(#ld)" stroke="${C.landEdge}" stroke-width="3.5"/>
<clipPath id="drcclip"><path d="M994.7,366.7L1000.7,397.3L997.3,414.7L1004.0,434.0L1023.3,452.7L1041.3,494.7L1041.3,494.7L1028.2,491.3L983.4,496.9L974.5,500.9L965.0,522.2L972.5,536.9L966.5,576.3L962.4,609.8L971.4,615.7L994.7,628.7L1003.9,622.6L1006.7,658.6L981.1,658.3L967.5,640.0L955.2,625.7L929.6,621.1L922.1,603.6L901.8,614.1L875.1,609.5L863.9,594.4L842.8,591.3L827.2,592.1L825.2,581.7L813.7,580.9L798.6,578.9L777.9,583.9L763.4,583.1L755.2,586.2L757.0,546.5L745.8,534.1L743.4,513.6L748.3,493.5L741.5,480.7L740.9,459.7L700.5,460.0L703.4,448.0L686.4,448.1L684.6,453.9L663.9,455.2L655.6,474.6L650.6,482.9L632.1,478.2L621.1,482.9L599.1,485.6L586.3,468.2L578.7,457.4L569.1,437.4L560.9,412.6L462.5,412.1L450.8,416.1L441.2,415.5L427.4,420.0L422.7,409.7L431.2,406.1L432.3,391.6L437.7,383.0L449.9,376.0L458.6,379.4L470.0,366.7L488.2,367.0L490.3,376.4L502.8,382.3L522.4,361.5L541.8,345.2L550.2,334.5L549.1,307.1L563.6,274.7L578.8,257.5L600.8,241.5L604.6,230.8L605.5,218.6L610.9,207.0L609.1,188.1L613.3,158.6L619.8,137.8L629.8,120.0L631.8,99.9L634.8,76.6L647.7,59.7L665.6,48.9L693.0,60.3L714.3,72.6L738.6,75.9L763.5,82.4L773.5,62.2L778.0,59.7L793.2,63.0L830.4,46.4L843.5,53.4L854.3,52.4L859.3,44.3L871.7,41.5L896.8,45.0L918.1,45.7L929.1,42.2L949.3,69.7L964.3,73.8L973.2,68.2L988.6,70.4L1007.2,63.3L1015.1,77.5L1044.5,99.7L1044.5,99.7L1042.4,138.7L1055.8,143.2L1045.1,155.0L1032.3,163.9L1019.5,181.3L1012.5,196.8L1010.7,223.5L1002.9,236.2L1002.6,261.4L993.1,270.7L991.8,290.5L987.2,293.1L984.2,311.3L992.5,326.5L994.7,366.7Z"/></clipPath>
<g clip-path="url(#drcclip)">
  <rect x="958" y="0" width="${W}" height="${H}" fill="${C.alertDim}"
        opacity="${spread.toFixed(3)}"/>
  <rect x="958" y="0" width="3" height="${H}" fill="${C.alert}"
        opacity="${(spread * 0.9).toFixed(3)}"/>
</g>
<circle cx="990.7" cy="272.7" r="7" fill="${C.alert}" opacity="${at(p, 0.34, 0.62).toFixed(2)}"/>
<circle cx="978.7" cy="300.3" r="7" fill="${C.alert}" opacity="${at(p, 0.42, 0.70).toFixed(2)}"/>
<circle cx="1025" cy="164.7" r="${11 + pin * 13}" fill="none" stroke="${C.lime}"
        stroke-width="3.5" opacity="${(0.9 * (1 - pin)).toFixed(3)}"/>
<circle cx="1025" cy="164.7" r="8" fill="${C.lime}" opacity="${pin.toFixed(3)}"/>
</svg>`;
  }

  // ── BYPASS MAPS ────────────────────────────────────────────────────────
  // Both bypass variants draw on ONE regional base, not two invented country
  // blobs. The first attempt drew Saudi and the UAE as separate rounded shapes
  // with a straight line across them: unrecognisable as geography, and the
  // "animation" was a single dash-reveal. Sharing a base means the viewer reads
  // chapter 03 against the map they already learned in chapter 01, the strait
  // stays on screen so a BYPASS is legibly a bypass, and the route animates as
  // flow — a pulse travelling the pipe — rather than a line being drawn.
  const REGION_IRAN = "M900,0 H1600 V132 C1470,150 1352,190 1250,244 "
    + "C1182,280 1132,318 1094,352 L1000,286 C946,214 902,120 900,0 Z";
  const REGION_ARABIA = "M0,330 C170,296 392,276 632,296 C830,312 966,348 1064,404 "
    + "L1124,446 C1186,494 1266,534 1366,562 C1444,584 1522,596 1600,602 "
    + "V700 H0 Z";
  const REGION_GULF = "M0,160 C226,128 486,128 726,174 C904,206 1014,270 1082,358 "
    + "L1014,404 C922,348 800,316 640,300 C404,280 182,298 0,330 Z";

  const straitX = 1092, straitY = 372;
  const flow = at(p, 0.16, 0.70);
  const blocked = at(p, 0.52, 0.86);
  // The chokepoint stays marked and struck through: the whole claim of this
  // chapter is that the route AVOIDS it.
  const blockMark = `
<circle cx="${straitX}" cy="${straitY}" r="30" fill="none" stroke="${C.alert}" stroke-width="6"
        opacity="${blocked.toFixed(2)}"/>
<line x1="${straitX - 20}" y1="${straitY - 20}" x2="${straitX + 20}" y2="${straitY + 20}"
      stroke="${C.alert}" stroke-width="6" stroke-linecap="round" opacity="${blocked.toFixed(2)}"/>
<line x1="${straitX + 20}" y1="${straitY - 20}" x2="${straitX - 20}" y2="${straitY + 20}"
      stroke="${C.alert}" stroke-width="6" stroke-linecap="round" opacity="${blocked.toFixed(2)}"/>`;

  // Straight segments, so the travelling pulse interpolates exactly.
  const R = variant === "saudi"
    ? { a: [966, 470], b: [148, 578], len: 826 }
    : { a: [1040, 528], b: [1378, 452], len: 346 };
  const [ax, ay] = R.a, [bx2, by2] = R.b;
  const dotX = ax + (bx2 - ax) * flow, dotY = ay + (by2 - ay) * flow;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<defs>${g("w2", "#12222c", "#0a1319")}${g("l4", "#1d1811", "#12100c")}</defs>
<rect width="${W}" height="${H}" fill="#080d11"/>
<path d="${REGION_GULF}" fill="url(#w2)"/>
<path d="${REGION_IRAN}" fill="url(#l4)" stroke="${C.landEdge}" stroke-width="3"/>
<path d="${REGION_ARABIA}" fill="url(#l4)" stroke="${C.landEdge}" stroke-width="3"/>
<line x1="${ax}" y1="${ay}" x2="${bx2}" y2="${by2}" stroke="${C.track}" stroke-width="11"
      stroke-linecap="round" opacity="0.5"/>
<line x1="${ax}" y1="${ay}" x2="${bx2}" y2="${by2}" stroke="${C.lime}" stroke-width="11"
      stroke-linecap="round" stroke-dasharray="${R.len}"
      stroke-dashoffset="${((1 - flow) * R.len).toFixed(0)}"/>
<circle cx="${ax}" cy="${ay}" r="16" fill="${C.lime}" opacity="${at(p, 0.08, 0.26).toFixed(2)}"/>
<circle cx="${bx2}" cy="${by2}" r="16" fill="${C.lime}" opacity="${at(p, 0.58, 0.78).toFixed(2)}"/>
<circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="12" fill="${C.white}"
        opacity="${(flow > 0.03 && flow < 0.98 ? 0.95 : 0).toFixed(2)}"/>
${blockMark}
</svg>`;
}

const col = (style, children) => h("div", { display: "flex", flexDirection: "column", ...style }, children);
const row = (style, children) => h("div", { display: "flex", flexDirection: "row", ...style }, children);

// ─── Animation primitives ───────────────────────────────────────────────────

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (p, a, b) => clamp01((p - a) / (b - a));
/** easeOutCubic — fast arrival, soft settle. Reads as intent, not drift. */
const ease = (x) => 1 - Math.pow(1 - x, 3);
const at = (p, a, b) => ease(seg(p, a, b));

/** Standard entrance: fade up with a short rise. */
const enter = (p, a, b, rise = 26) => {
  const k = at(p, a, b);
  return { opacity: k, transform: `translateY(${((1 - k) * rise).toFixed(2)}px)` };
};

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
      }, n),
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

  /** One figure, large. The workhorse. */
  stat: ({ kicker, figure, unit, label, src }, p) => {
    const k = at(p, 0.05, 0.30);
    return frame([
      ...(kicker ? [eyebrow(kicker, p)] : []),
      col({ flexGrow: 1, justifyContent: "center" }, [
        row({ alignItems: "baseline" }, [
          h("div", {
            fontFamily: "Anton", fontSize: 300, color: C.lime, lineHeight: 0.95, letterSpacing: -2,
            opacity: k, transform: `translateY(${((1 - k) * 30).toFixed(2)}px)`,
          }, figure),
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
   * A schematic map. The film's single most-requested missing piece: a viewer
   * who cannot picture the chokepoint cannot feel any number about it.
   */
  map: ({ kicker, title, variant = "hormuz", note, src, pin }, p) => {
    const L = {
      hormuz: [
        { t: "IRAN", x: 150, y: 108, s: 40, c: C.sub, a: [0.02, 0.20] },
        { t: "SAUDI ARABIA \u00b7 UAE", x: 250, y: 590, s: 34, c: C.sub, a: [0.06, 0.24], w: 640 },
        { t: "OMAN", x: 1240, y: 572, s: 30, c: C.dim, a: [0.10, 0.30] },
        { t: "PERSIAN GULF", x: 330, y: 424, s: 30, c: C.dim, a: [0.14, 0.34], w: 500 },
        { t: "GULF OF OMAN", x: 1270, y: 162, s: 30, c: C.dim, a: [0.18, 0.38], w: 500 },
        { t: pin || "STRAIT OF HORMUZ", x: 830, y: 250, s: 44, c: C.lime, a: [0.55, 0.90], f: "Anton", w: 700 },
      ],
      drc: [
        { t: "DEM. REP. CONGO", x: 505, y: 392, s: 30, c: C.dim, a: [0.02, 0.20], w: 460 },
        { t: "UGANDA", x: 1076, y: 210, s: 24, c: C.sub, a: [0.10, 0.32], w: 260 },
        { t: "ITURI", x: 1042, y: 140, s: 26, c: C.lime, a: [0.52, 0.86], w: 260 },
        { t: "NORTH KIVU", x: 1006, y: 262, s: 22, c: C.alert, a: [0.34, 0.66], w: 300 },
        { t: "SOUTH KIVU", x: 994, y: 306, s: 22, c: C.alert, a: [0.42, 0.74], w: 300 },
      ],
      saudi: [
        { t: "IRAN", x: 1230, y: 60, s: 34, c: C.dim, a: [0.02, 0.20] },
        { t: "SAUDI ARABIA", x: 400, y: 636, s: 34, c: C.dim, a: [0.04, 0.24], w: 640 },
        { t: "PERSIAN GULF", x: 430, y: 214, s: 28, c: C.dim, a: [0.06, 0.26], w: 480 },
        { t: "GULF COAST", x: 906, y: 402, s: 28, c: C.sub, a: [0.10, 0.30], w: 420 },
        { t: "RED SEA", x: 90, y: 606, s: 28, c: C.sub, a: [0.58, 0.78], w: 400 },
        { t: "HORMUZ \u2014 BYPASSED", x: 1146, y: 350, s: 28, c: C.alert, a: [0.56, 0.88], w: 460 },
      ],
      uae: [
        { t: "IRAN", x: 1230, y: 60, s: 34, c: C.dim, a: [0.02, 0.20] },
        { t: "UAE", x: 900, y: 640, s: 34, c: C.dim, a: [0.04, 0.24] },
        { t: "PERSIAN GULF", x: 430, y: 214, s: 28, c: C.dim, a: [0.06, 0.26], w: 480 },
        { t: "HABSHAN", x: 946, y: 560, s: 28, c: C.sub, a: [0.10, 0.30], w: 400 },
        { t: "FUJAIRAH", x: 1300, y: 486, s: 28, c: C.sub, a: [0.58, 0.78], w: 400 },
        { t: "HORMUZ \u2014 BYPASSED", x: 1146, y: 320, s: 28, c: C.alert, a: [0.56, 0.88], w: 460 },
      ],
    }[variant] || [];
    return frame([
      ...(kicker ? [eyebrow(kicker, p)] : []),
      ...(title ? [h("div", {
        fontFamily: "Anton", fontSize: 56, color: C.white, marginBottom: 18,
        maxWidth: 1560, lineHeight: 1.1, ...enter(p, 0.02, 0.20, 22),
      }, title)] : []),
      col({ flexGrow: 1, justifyContent: "center" }, [
        h("div", { display: "flex", position: "relative", width: 1600, height: 700 }, [
          hsvg(mapSvg(variant, p), {
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
  equation: ({ kicker, numerator, denominator, result, note, flipped }, p) => frame([
    ...(kicker ? [eyebrow(kicker, p, flipped ? C.lime : C.dim)] : []),
    col({ flexGrow: 1, justifyContent: "center" }, [
      row({ alignItems: "center" }, [
        col({ alignItems: "center" }, [
          h("div", {
            fontFamily: "Anton", fontSize: 66, color: C.white, lineHeight: 1.1,
            ...enter(p, 0.02, 0.14, 18),
          }, numerator),
          // The rule draws left-to-right between the terms.
          h("div", {
            width: Math.round(720 * at(p, 0.10, 0.24)), height: 8,
            backgroundColor: C.lime, margin: "22px 0",
          }),
          h("div", {
            fontFamily: "Anton", fontSize: 66, color: C.white, lineHeight: 1.1,
            ...enter(p, 0.16, 0.30, 18),
          }, denominator),
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
  ], p),

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
      ...(map ? [hsvg(mapSvg(map, p), {
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
