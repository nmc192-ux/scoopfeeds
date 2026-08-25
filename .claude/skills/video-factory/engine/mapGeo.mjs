// Data-driven schematic maps.
//
// Before this module, every map was a hardcoded branch of mapSvg() in
// render.mjs — three regional variants plus DRC, each a bespoke wall of SVG.
// A new story's geography meant engine surgery. Now a map is DATA: an ordered
// list of elements from a small grammar, and one renderer that knows how to
// draw them. The four shipped variants live in GEO below, expressed in that
// grammar, and are proven pixel-identical to the hardcoded originals by
// mapGeo.test.mjs against recorded baseline hashes.
//
// The grammar is deliberately small and journalistic. Each element kind is a
// device the films actually use, not a general drawing API:
//
//   path        — a landmass, sea, or neighbour outline (static)
//   line        — a static route bed (the grey "track" under a flow)
//   drawPath    — a route that DRAWS with progress (dash reveal)
//   flowDot     — a pulse travelling a straight route (flow, not drawing)
//   dot         — an incident/point marker that fades in
//   pulseMarker — the chokepoint signature: expanding ring collapsing to a dot
//   regionFill  — a region flooding with colour behind a clip (spread)
//   blockMark   — the struck-through circle: "this route is closed"
//
// Rules the grammar enforces by construction:
//   - SHAPES ONLY, no <text>. satori does not hand fonts to nested SVGs, so
//     text inside the map renders as nothing. Labels are DATA on the spec
//     (`labels`), rendered by the map card as positioned divs.
//   - Colours are palette TOKENS ("lime", "alert", "landEdge"…), resolved at
//     render time against the house palette. A string that is not a token
//     passes through as a literal — validateGeo does NOT reject unknown
//     colours, so a typo'd token renders as an invalid CSS colour. Raw hex is
//     the convention for map grounds and neighbour outlines only.
//   - Paint order is array order. No z-index, no surprises.
//
// Timing values (`anim: [a, b]`) use the same easeOutCubic as every card, via
// anim.mjs. Everything animated must respect the card's entrance/payoff split;
// the card decides what the map's p means, exactly as before.

import { at } from "./anim.mjs";

// ─── Grammar ────────────────────────────────────────────────────────────────

const ELEMENT_KINDS = new Set([
  "path", "line", "drawPath", "flowDot", "dot", "pulseMarker", "regionFill", "blockMark",
]);

/**
 * Validate a geo spec. Returns a list of problems, each naming the offending
 * element index and field — empty when valid. Kept as data-in/data-out so the
 * storyboard schema (#77) can call it long before a render is attempted.
 */
export function validateGeo(geo) {
  const errs = [];
  if (!geo || typeof geo !== "object") return ["geo: not an object"];
  if (!Array.isArray(geo.elements)) errs.push("geo.elements: missing or not an array");
  for (const [i, el] of (geo.elements || []).entries()) {
    if (!el || !ELEMENT_KINDS.has(el.el)) {
      errs.push(`elements[${i}]: unknown element kind "${el?.el}"`);
      continue;
    }
    // Everything geoSvg dereferences WITHOUT a default is required here —
    // a field this table misses renders as a literal "undefined" attribute
    // (an invalid paint value paints SVG-default BLACK, an undefined clip id
    // makes a regionFill silently never appear). Reject, never repair.
    const need = {
      path: ["d", "fill"], line: ["a", "b", "color"], drawPath: ["len", "color"],
      flowDot: ["a", "b"], dot: ["x", "y"], pulseMarker: ["x", "y"],
      regionFill: ["clip", "x", "color"], blockMark: ["x", "y"],
    }[el.el];
    for (const f of need) {
      if (el[f] === undefined) errs.push(`elements[${i}] (${el.el}): missing "${f}"`);
    }
    if (el.el === "regionFill" && el.clip && (el.clip.id === undefined || el.clip.d === undefined)) {
      errs.push(`elements[${i}] (regionFill): clip needs "id" and "d"`);
    }
    // A drawPath is either a curve (`d`) or a straight segment (`line: [a, b]`).
    if (el.el === "drawPath" && el.d === undefined && el.line === undefined) {
      errs.push(`elements[${i}] (drawPath): needs "d" or "line"`);
    }
    if (el.anim && (!Array.isArray(el.anim) || el.anim.length !== 2)) {
      errs.push(`elements[${i}] (${el.el}): anim must be [start, end]`);
    }
  }
  for (const [i, l] of (geo.labels || []).entries()) {
    for (const f of ["t", "x", "y", "s", "c", "a"]) {
      if (l[f] === undefined) errs.push(`labels[${i}]: missing "${f}"`);
    }
  }
  return errs;
}

// ─── Renderer ───────────────────────────────────────────────────────────────

/** Resolve a colour: palette token if known, literal otherwise. */
const colr = (c, C) => (C && Object.prototype.hasOwnProperty.call(C, c) ? C[c] : c);

const grad = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">`
  + `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

/**
 * Render a geo spec at progress p against palette C. Returns an SVG string.
 * Number formatting mirrors the retired hardcoded variants exactly — the
 * baseline-hash equivalence in mapGeo.test.mjs depends on it.
 */
export function geoSvg(geo, p, C) {
  const W = geo.view?.w ?? 1600, H = geo.view?.h ?? 700;
  const errs = validateGeo(geo);
  if (errs.length) throw new Error(`geoSvg: invalid geo spec:\n  ${errs.join("\n  ")}`);

  const defs = (geo.defs || []).map((d) => grad(d.id, d.from, d.to)).join("");
  const parts = [];

  for (const el of geo.elements) {
    switch (el.el) {
      case "path": {
        const bits = [`<path d="${el.d}" fill="${colr(el.fill, C)}"`];
        if (el.stroke) bits.push(` stroke="${colr(el.stroke, C)}" stroke-width="${el.sw ?? 3}"`);
        if (el.opacity !== undefined) bits.push(` opacity="${el.opacity}"`);
        parts.push(bits.join("") + "/>");
        break;
      }
      case "line": {
        const [ax, ay] = el.a, [bx, by] = el.b;
        parts.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${colr(el.color, C)}" `
          + `stroke-width="${el.width ?? 11}"\n      stroke-linecap="round" opacity="${el.opacity ?? 1}"/>`);
        break;
      }
      case "drawPath": {
        const k = at(p, ...(el.anim ?? [0, 1]));
        // Two dashoffset formats exist in the shipped films: hormuz emitted the
        // raw float, the bypass routes rounded to int. Preserved per-element so
        // the equivalence hashes hold.
        const off = el.offsetFmt === "int" ? ((1 - k) * el.len).toFixed(0) : `${(1 - k) * el.len}`;
        if (el.line) {
          const [ax, ay] = el.line[0], [bx, by] = el.line[1];
          parts.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${colr(el.color, C)}" `
            + `stroke-width="${el.width ?? 11}"\n      stroke-linecap="round" stroke-dasharray="${el.len}"\n      `
            + `stroke-dashoffset="${off}"/>`);
        } else {
          parts.push(`<path d="${el.d}"\n      fill="none" stroke="${colr(el.color, C)}" stroke-width="${el.width ?? 6}" `
            + `stroke-dasharray="${el.len}"\n      stroke-dashoffset="${off}"`
            + (el.opacity !== undefined ? ` opacity="${el.opacity}"` : "")
            + ` stroke-linecap="round"/>`);
        }
        break;
      }
      case "flowDot": {
        const k = at(p, ...(el.anim ?? [0, 1]));
        const [ax, ay] = el.a, [bx, by] = el.b;
        const x = ax + (bx - ax) * k, y = ay + (by - ay) * k;
        const [g0, g1] = el.gate ?? [0.03, 0.98];
        parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${el.r ?? 12}" fill="${colr(el.color ?? "white", C)}"\n        `
          + `opacity="${(k > g0 && k < g1 ? el.opacity ?? 0.95 : 0).toFixed(2)}"/>`);
        break;
      }
      case "dot": {
        const k = at(p, ...(el.anim ?? [0, 1]));
        parts.push(`<circle cx="${el.x}" cy="${el.y}" r="${el.r ?? 7}" fill="${colr(el.color ?? "alert", C)}" opacity="${k.toFixed(2)}"/>`);
        break;
      }
      case "pulseMarker": {
        const k = at(p, ...(el.anim ?? [0, 1]));
        const c = colr(el.color ?? "lime", C);
        parts.push(`<circle cx="${el.x}" cy="${el.y}" r="${(el.ringR ?? 26) + k * (el.ringGrow ?? 20)}" fill="none" stroke="${c}"\n        `
          + `stroke-width="${el.ringW ?? 4}" opacity="${((el.ringOpacity ?? 0.9) * (1 - k)).toFixed(3)}"/>`);
        parts.push(`<circle cx="${el.x}" cy="${el.y}" r="${el.dotR ?? 14}" fill="${c}" opacity="${k.toFixed(3)}"/>`);
        break;
      }
      case "regionFill": {
        const k = at(p, ...(el.anim ?? [0, 1]));
        const cid = el.clip.id;
        parts.push(`<clipPath id="${cid}"><path d="${el.clip.d}"/></clipPath>`);
        parts.push(`<g clip-path="url(#${cid})">\n  `
          + `<rect x="${el.x}" y="0" width="${W}" height="${H}" fill="${colr(el.color, C)}"\n        opacity="${k.toFixed(3)}"/>\n  `
          + `<rect x="${el.x}" y="0" width="3" height="${H}" fill="${colr(el.edgeColor ?? "alert", C)}"\n        opacity="${(k * 0.9).toFixed(3)}"/>\n`
          + `</g>`);
        break;
      }
      case "blockMark": {
        const k = at(p, ...(el.anim ?? [0, 1]));
        const c = colr(el.color ?? "alert", C);
        const { x, y } = el;
        parts.push(`
<circle cx="${x}" cy="${y}" r="30" fill="none" stroke="${c}" stroke-width="6"
        opacity="${k.toFixed(2)}"/>
<line x1="${x - 20}" y1="${y - 20}" x2="${x + 20}" y2="${y + 20}"
      stroke="${c}" stroke-width="6" stroke-linecap="round" opacity="${k.toFixed(2)}"/>
<line x1="${x + 20}" y1="${y - 20}" x2="${x - 20}" y2="${y + 20}"
      stroke="${c}" stroke-width="6" stroke-linecap="round" opacity="${k.toFixed(2)}"/>`);
        break;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<defs>${defs}</defs>
<rect width="${W}" height="${H}" fill="${geo.bg}"/>
${parts.join("\n")}
</svg>`;
}

// ─── The shipped variants, as data ──────────────────────────────────────────
//
// Geometry transcribed verbatim from the retired mapSvg() branches. The DRC
// outlines are Natural Earth 1:110m (public domain), equirectangular, with
// real marked coordinates (Bunia, Goma, Bukavu, Mongbwalu); the Gulf variants
// are drawn to real relative geography, simplified to legible shapes — a
// faithful coastline at 1600px reads as a smudge.
//
// Label semantics carried from the card: `pinnable` marks the one label whose
// text the spec's `pin` field may replace (hormuz's strait callout).

const IRAN_HORMUZ = "M0,0 H1600 V96 C1460,120 1330,168 1218,236 C1150,278 1096,318 1058,352 "
  + "L946,372 C742,352 548,296 336,268 C224,253 112,246 0,244 Z";
const ARABIA_HORMUZ = "M0,700 H1600 V636 C1498,616 1400,578 1312,532 C1256,502 1206,466 1166,428 "
  + "L1122,392 C1104,376 1086,382 1072,404 L1040,456 C1000,514 940,554 856,584 "
  + "C660,634 372,644 176,660 C104,666 48,672 0,678 Z";

const REGION_IRAN = "M900,0 H1600 V132 C1470,150 1352,190 1250,244 "
  + "C1182,280 1132,318 1094,352 L1000,286 C946,214 902,120 900,0 Z";
const REGION_ARABIA = "M0,330 C170,296 392,276 632,296 C830,312 966,348 1064,404 "
  + "L1124,446 C1186,494 1266,534 1366,562 C1444,584 1522,596 1600,602 "
  + "V700 H0 Z";
const REGION_GULF = "M0,160 C226,128 486,128 726,174 C904,206 1014,270 1082,358 "
  + "L1014,404 C922,348 800,316 640,300 C404,280 182,298 0,330 Z";

/** Shared base for the two bypass maps — one learned geography, two chapters. */
const bypassBase = () => ([
  { el: "path", d: REGION_GULF, fill: "url(#w2)" },
  { el: "path", d: REGION_IRAN, fill: "url(#l4)", stroke: "landEdge", sw: 3 },
  { el: "path", d: REGION_ARABIA, fill: "url(#l4)", stroke: "landEdge", sw: 3 },
]);

const bypassRoute = (a, b, len) => ([
  { el: "line", a, b, color: "track", width: 11, opacity: 0.5 },
  { el: "drawPath", line: [a, b], len, color: "lime", width: 11, offsetFmt: "int", anim: [0.16, 0.70] },
  { el: "dot", x: a[0], y: a[1], r: 16, color: "lime", anim: [0.08, 0.26] },
  { el: "dot", x: b[0], y: b[1], r: 16, color: "lime", anim: [0.58, 0.78] },
  { el: "flowDot", a, b, r: 12, color: "white", anim: [0.16, 0.70] },
  { el: "blockMark", x: 1092, y: 372, anim: [0.52, 0.86] },
]);

const bypassLabels = (place1, place2) => ([
  { t: "IRAN", x: 1230, y: 60, s: 34, c: "dim", a: [0.02, 0.20] },
  place1,
  { t: "PERSIAN GULF", x: 430, y: 214, s: 28, c: "dim", a: [0.06, 0.26], w: 480 },
  place2.mid,
  place2.end,
  { t: "HORMUZ — BYPASSED", x: 1146, y: place2.blockY, s: 28, c: "alert", a: [0.56, 0.88], w: 460 },
]);

// The DRC country and neighbour outlines are long; kept as single strings.
const DRC_MAIN = "M994.7,366.7L1000.7,397.3L997.3,414.7L1004.0,434.0L1023.3,452.7L1041.3,494.7L1041.3,494.7L1028.2,491.3L983.4,496.9L974.5,500.9L965.0,522.2L972.5,536.9L966.5,576.3L962.4,609.8L971.4,615.7L994.7,628.7L1003.9,622.6L1006.7,658.6L981.1,658.3L967.5,640.0L955.2,625.7L929.6,621.1L922.1,603.6L901.8,614.1L875.1,609.5L863.9,594.4L842.8,591.3L827.2,592.1L825.2,581.7L813.7,580.9L798.6,578.9L777.9,583.9L763.4,583.1L755.2,586.2L757.0,546.5L745.8,534.1L743.4,513.6L748.3,493.5L741.5,480.7L740.9,459.7L700.5,460.0L703.4,448.0L686.4,448.1L684.6,453.9L663.9,455.2L655.6,474.6L650.6,482.9L632.1,478.2L621.1,482.9L599.1,485.6L586.3,468.2L578.7,457.4L569.1,437.4L560.9,412.6L462.5,412.1L450.8,416.1L441.2,415.5L427.4,420.0L422.7,409.7L431.2,406.1L432.3,391.6L437.7,383.0L449.9,376.0L458.6,379.4L470.0,366.7L488.2,367.0L490.3,376.4L502.8,382.3L522.4,361.5L541.8,345.2L550.2,334.5L549.1,307.1L563.6,274.7L578.8,257.5L600.8,241.5L604.6,230.8L605.5,218.6L610.9,207.0L609.1,188.1L613.3,158.6L619.8,137.8L629.8,120.0L631.8,99.9L634.8,76.6L647.7,59.7L665.6,48.9L693.0,60.3L714.3,72.6L738.6,75.9L763.5,82.4L773.5,62.2L778.0,59.7L793.2,63.0L830.4,46.4L843.5,53.4L854.3,52.4L859.3,44.3L871.7,41.5L896.8,45.0L918.1,45.7L929.1,42.2L949.3,69.7L964.3,73.8L973.2,68.2L988.6,70.4L1007.2,63.3L1015.1,77.5L1044.5,99.7L1044.5,99.7L1042.4,138.7L1055.8,143.2L1045.1,155.0L1032.3,163.9L1019.5,181.3L1012.5,196.8L1010.7,223.5L1002.9,236.2L1002.6,261.4L993.1,270.7L991.8,290.5L987.2,293.1L984.2,311.3L992.5,326.5L994.7,366.7Z";
const DRC_NEIGH = ["M1146.8,248.3L1078.9,250.9L1042.3,250.5L1030.6,254.5L1010.7,264.8L1002.6,261.4L1002.9,236.2L1010.7,223.5L1012.5,196.8L1019.5,181.3L1032.3,163.9L1045.1,155.0L1055.8,143.2L1042.4,138.7L1044.5,99.7L1044.5,99.7L1058.2,90.6L1079.4,98.1L1106.2,90.3L1129.7,90.3L1150.2,75.0L1166.0,98.1L1169.9,114.9L1184.5,153.1L1172.4,177.4L1156.0,199.5L1146.5,213.0L1146.8,248.3Z","M1030.6,254.5L1043.9,273.3L1041.9,292.9L1032.3,297.1L1032.3,297.1L1014.6,294.9L1004.4,313.9L984.2,311.3L987.2,293.1L991.8,290.5L993.1,270.7L1002.6,261.4L1010.7,264.8L1030.6,254.5Z","M1032.3,297.1L1034.3,310.3L1041.4,317.8L1041.7,328.6L1033.5,335.6L1020.5,353.0L1008.5,365.1L994.7,366.7L992.5,326.5L984.2,311.3L1004.4,313.9L1014.6,294.9L1032.3,297.1Z","M1146.8,248.3L1152.4,252.0L1273.3,319.9L1275.6,339.2L1323.4,372.6L1308.0,413.6L1310.0,432.5L1331.3,444.7L1332.3,453.3L1323.2,473.5L1325.1,483.6L1322.9,499.5L1334.5,520.4L1348.3,553.3L1360.6,560.6L1360.6,560.6L1334.0,579.9L1297.6,592.8L1277.6,592.3L1265.7,602.3L1242.5,603.2L1233.8,607.4L1193.7,598.0L1168.7,600.7L1159.3,555.3L1148.0,539.8L1141.3,530.6L1108.6,524.4L1089.7,514.3L1068.5,508.7L1055.3,503.2L1041.3,494.7L1041.3,494.7L1023.3,452.7L1004.0,434.0L997.3,414.7L1000.7,397.3L994.7,366.7L1008.5,365.1L1020.5,353.0L1033.5,335.6L1041.7,328.6L1041.4,317.8L1034.3,310.3L1032.3,297.1L1032.3,297.1L1041.9,292.9L1043.9,273.3L1030.6,254.5L1042.3,250.5L1078.9,250.9L1146.8,248.3Z","M1044.5,99.7L1015.1,77.5L1007.2,63.3L988.6,70.4L973.2,68.2L964.3,73.8L949.3,69.7L929.1,42.2L923.8,31.6L898.9,18.4L890.4,-1.6L876.6,-16.0L854.1,-33.3L853.8,-44.2L835.6,-57.6L812.9,-70.7L823.1,-74.3L834.6,-80.6L843.2,-110.3L852.3,-125.8L876.4,-130.4L882.1,-121.2L899.2,-101.8L908.4,-98.9L920.4,-104.6L944.5,-103.5L949.0,-96.6L982.2,-96.6L983.4,-103.5L1000.5,-109.8L1004.0,-119.5L1016.6,-126.4L1044.6,-106.9L1061.8,-110.3L1078.4,-134.4L1096.7,-152.7L1093.8,-172.7L1085.8,-182.4L1105.8,-184.2L1108.1,-191.6L1123.6,-189.3L1119.6,-164.7L1123.6,-140.7L1140.7,-127.5L1144.7,-116.1L1144.2,-99.5L1148.8,-98.8L1149.2,-72.8L1144.2,-62.6L1126.5,-61.8L1115.1,-42.8L1135.6,-40.4L1152.5,-24.2L1158.3,-10.9L1173.6,-3.1L1193.3,33.1L1170.7,55.1L1150.2,75.0L1129.7,90.3L1106.2,90.3L1079.4,98.1L1058.2,90.6L1044.5,99.7Z","M929.1,42.2L918.1,45.7L896.8,45.0L871.7,41.5L859.3,44.3L854.3,52.4L843.5,53.4L830.4,46.4L793.2,63.0L778.0,59.7L773.5,62.2L763.5,82.4L738.6,75.9L714.3,72.6L693.0,60.3L665.6,48.9L647.7,59.7L634.8,76.6L631.8,99.9L610.3,98.0L587.8,92.4L567.9,110.1L550.4,141.1L546.9,131.4L545.4,116.2L530.2,105.5L517.9,88.3L515.0,76.3L499.3,58.9L502.0,49.0L498.6,34.9L501.2,9.1L509.2,3.1L526.0,-30.7L553.5,-33.2L559.7,-41.8L565.2,-41.2L573.5,-33.6L615.5,-46.4L629.7,-59.4L647.0,-71.0L643.7,-82.8L653.1,-85.8L685.3,-83.8L716.7,-99.2L740.8,-135.6L757.7,-149.1L778.8,-154.7L782.6,-140.5L801.8,-119.6L801.9,-106.0L796.5,-92.2L798.6,-81.8L810.2,-72.2L835.6,-57.6L853.8,-44.2L854.1,-33.3L876.6,-16.0L890.4,-1.6L898.9,18.4L923.8,31.6L929.1,42.2Z","M1041.3,494.7L1055.3,503.2L1068.5,508.7L1089.7,514.3L1108.6,524.4L1124.4,539.2L1132.9,567.5L1127.2,576.6L1120.5,603.6L1126.9,631.2L1116.4,642.8L1106.3,673.8L1123.8,682.4L1022.6,709.9L1025.8,733.6L1000.6,738.2L981.6,751.4L977.5,763.0L965.6,765.6L936.6,793.0L918.1,814.6L906.9,815.4L896.1,811.5L858.8,807.9L852.8,805.4L852.6,802.6L839.4,795.1L817.8,793.2L790.5,800.8L768.7,779.9L746.3,752.7L747.8,646.6L817.2,647.0L814.4,635.5L819.3,623.0L813.5,607.4L817.3,591.2L813.7,580.9L825.2,581.7L827.2,592.1L842.8,591.3L863.9,594.4L875.1,609.5L901.8,614.1L922.1,603.6L929.6,621.1L955.2,625.7L967.5,640.0L981.1,658.3L1006.7,658.6L1003.9,622.6L994.7,628.7L971.4,615.7L962.4,609.8L966.5,576.3L972.5,536.9L965.0,522.2L974.5,500.9L983.4,496.9L1028.2,491.3L1041.3,494.7Z","M427.4,420.0L441.2,415.5L450.8,416.1L462.5,412.1L560.9,412.6L569.1,437.4L578.7,457.4L586.3,468.2L599.1,485.6L621.1,482.9L632.1,478.2L650.6,482.9L655.6,474.6L663.9,455.2L684.6,453.9L686.4,448.1L703.4,448.0L700.5,460.0L740.9,459.7L741.5,480.7L748.3,493.5L743.4,513.6L745.8,534.1L757.0,546.5L755.2,586.2L763.4,583.1L777.9,583.9L798.6,578.9L813.7,580.9L817.3,591.2L813.5,607.4L819.3,623.0L814.4,635.5L817.2,647.0L747.8,646.6L746.3,752.7L768.7,779.9L790.5,800.8L729.2,814.4L648.5,809.6L625.4,793.7L490.3,795.1L485.3,797.4L465.4,782.4L443.8,781.4L423.8,787.1L407.8,793.4L404.7,772.4L409.3,743.1L420.8,712.6L422.5,698.3L433.3,668.3L441.3,654.6L460.4,632.8L471.1,618.0L474.6,593.3L472.9,574.4L462.9,562.5L454.0,542.2L445.8,522.2L447.6,515.3L457.9,502.1L447.8,469.9L440.9,447.6L424.2,426.5L427.4,420.0Z"];

// The water/land gradient ramps and the map ground, defined ONCE. Every
// variant used to carry its own literal copy; a palette retune had to find
// four of each, and one missed copy meant a sea that matched nothing.
const WATER_RAMP = { from: "#12222c", to: "#0a1319" };
const LAND_RAMP = { from: "#1d1811", to: "#12100c" };
const MAP_BG = "#080d11";

export const GEO = {
  hormuz: {
    defs: [{ id: "w", ...WATER_RAMP }, { id: "l", ...LAND_RAMP }],
    bg: "url(#w)",
    elements: [
      { el: "path", d: IRAN_HORMUZ, fill: "url(#l)", stroke: "landEdge", sw: 3 },
      // Musandam is the whole reason the strait is narrow — drawn as a spur.
      { el: "path", d: ARABIA_HORMUZ, fill: "url(#l)", stroke: "landEdge", sw: 3 },
      { el: "drawPath",
        d: "M60,300 C300,318 620,352 860,392 C960,408 1030,404 1096,380 C1210,338 1360,286 1540,250",
        len: 1500, color: "lime", width: 6, opacity: 0.95, anim: [0.10, 0.55] },
      { el: "pulseMarker", x: 1090, y: 384, ringR: 26, ringGrow: 20, ringW: 4, dotR: 14,
        color: "lime", anim: [0.55, 0.95] },
    ],
    labels: [
      { t: "IRAN", x: 150, y: 108, s: 40, c: "sub", a: [0.02, 0.20] },
      { t: "SAUDI ARABIA · UAE", x: 250, y: 590, s: 34, c: "sub", a: [0.06, 0.24], w: 640 },
      { t: "OMAN", x: 1240, y: 572, s: 30, c: "dim", a: [0.10, 0.30] },
      { t: "PERSIAN GULF", x: 330, y: 424, s: 30, c: "dim", a: [0.14, 0.34], w: 500 },
      { t: "GULF OF OMAN", x: 1270, y: 162, s: 30, c: "dim", a: [0.18, 0.38], w: 500 },
      { t: "STRAIT OF HORMUZ", x: 830, y: 250, s: 44, c: "lime", a: [0.55, 0.90], f: "Anton", w: 700, pinnable: true },
    ],
  },

  drc: {
    defs: [{ id: "wd", ...WATER_RAMP }, { id: "ld", ...LAND_RAMP }],
    bg: MAP_BG,
    elements: [
      ...DRC_NEIGH.map((d) => ({ el: "path", d, fill: "#100d08", stroke: "#241f17", sw: 2, opacity: 0.6 })),
      { el: "path", d: DRC_MAIN, fill: "url(#ld)", stroke: "landEdge", sw: 3.5 },
      { el: "regionFill", clip: { id: "drcclip", d: DRC_MAIN }, x: 958, color: "alertDim",
        edgeColor: "alert", anim: [0.16, 0.72] },
      { el: "dot", x: 990.7, y: 272.7, r: 7, color: "alert", anim: [0.34, 0.62] },
      { el: "dot", x: 978.7, y: 300.3, r: 7, color: "alert", anim: [0.42, 0.70] },
      { el: "pulseMarker", x: 1025, y: 164.7, ringR: 11, ringGrow: 13, ringW: 3.5, dotR: 8,
        color: "lime", anim: [0.55, 0.92] },
    ],
    labels: [
      { t: "DEM. REP. CONGO", x: 505, y: 392, s: 30, c: "dim", a: [0.02, 0.20], w: 460 },
      { t: "UGANDA", x: 1076, y: 210, s: 24, c: "sub", a: [0.10, 0.32], w: 260 },
      { t: "ITURI", x: 1042, y: 140, s: 26, c: "lime", a: [0.52, 0.86], w: 260 },
      { t: "NORTH KIVU", x: 1006, y: 262, s: 22, c: "alert", a: [0.34, 0.66], w: 300 },
      { t: "SOUTH KIVU", x: 994, y: 306, s: 22, c: "alert", a: [0.42, 0.74], w: 300 },
    ],
  },

  saudi: {
    defs: [{ id: "w2", ...WATER_RAMP }, { id: "l4", ...LAND_RAMP }],
    bg: MAP_BG,
    elements: [...bypassBase(), ...bypassRoute([966, 470], [148, 578], 826)],
    labels: bypassLabels(
      { t: "SAUDI ARABIA", x: 400, y: 636, s: 34, c: "dim", a: [0.04, 0.24], w: 640 },
      { mid: { t: "GULF COAST", x: 906, y: 402, s: 28, c: "sub", a: [0.10, 0.30], w: 420 },
        end: { t: "RED SEA", x: 90, y: 606, s: 28, c: "sub", a: [0.58, 0.78], w: 400 },
        blockY: 350 },
    ),
  },

  uae: {
    defs: [{ id: "w2", ...WATER_RAMP }, { id: "l4", ...LAND_RAMP }],
    bg: MAP_BG,
    elements: [...bypassBase(), ...bypassRoute([1040, 528], [1378, 452], 346)],
    labels: bypassLabels(
      { t: "UAE", x: 900, y: 640, s: 34, c: "dim", a: [0.04, 0.24] },
      { mid: { t: "HABSHAN", x: 946, y: 560, s: 28, c: "sub", a: [0.10, 0.30], w: 400 },
        end: { t: "FUJAIRAH", x: 1300, y: 486, s: 28, c: "sub", a: [0.58, 0.78], w: 400 },
        blockY: 320 },
    ),
  },
};
