// Thumbnail — 1280x720, authored per film.
//
// The previous one shipped two defects into a scheduled upload: a stale case
// count (5,021, superseded by CDC's 5,105) and vertical banding where a scaled
// semi-transparent layer was composited. Both are structural, so this is a
// script rather than an ad-hoc ffmpeg line.
//
//   node thumb.mjs        # writes out/THUMB.png and out/THUMB_168.png
//
// HOW IT AVOIDS THE BANDING: the text layer is rendered ONCE at final size as
// transparent RGBA and overlaid at 1:1. Nothing is scaled after compositing,
// which is what produced the stripes. The darkening ramp is computed per-pixel
// on the frame itself, before any overlay.
//
// Check THUMB_168.png before shipping — a thumbnail is chosen at ~168px wide.

import { readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import path from "path";
import { createRequire } from "module";
import { ffmpegPath, P, ASSETS } from "/Users/jahanzebhussain/Downloads/scoop-news/.claude/skills/video-factory/engine/_deps.mjs";

const require = createRequire("/Users/jahanzebhussain/Downloads/scoop-news/backend/package.json");
const _satori = require("satori"); const satori = _satori.default ?? _satori;
const { Resvg } = require("@resvg/resvg-js");

const W = 1280, H = 720;
const CASES = "5,105";              // CDC, DRC as of 17 Aug 2026 — same figure as card 3
const C = { lime: "#dde706", white: "#f5f2ea", dim: "#a9a396" };
const FONTS = [
  { name: "Anton", data: readFileSync(path.join(ASSETS, "fonts/Anton-Regular.ttf")), weight: 400, style: "normal" },
  { name: "Inter", data: readFileSync(path.join(ASSETS, "fonts/Inter-Bold.otf")), weight: 700, style: "normal" },
];
const h = (type, style, children) => ({ type, props: { style, children } });

// 1 — the plate: a still from the film's own footage, graded to match, with a
//     left-to-right darkening ramp so type sits on ground rather than detail.
const PLATE = P("out/_thumbplate.png");
const ramp = (ch) => `${ch}(X,Y)*(0.20+0.80*min(1,max(0,(X-${Math.round(W*0.32)})/${Math.round(W*0.30)})))`;
execFileSync(ffmpegPath, ["-y", "-nostdin", "-hide_banner", "-loglevel", "error",
  "-ss", "3.2", "-i", P("out/footage/F_LAB.mp4"), "-frames:v", "1",
  "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},`
       + `eq=saturation=0.42:contrast=1.20:brightness=-0.14,`
       + `geq=r='${ramp("r")}':g='${ramp("g")}':b='${ramp("b")}'`,
  PLATE]);

// 2 — the type, transparent, at final size.
const svg = await satori(
  h("div", {
    display: "flex", flexDirection: "column", justifyContent: "center",
    width: W, height: H, paddingLeft: 58, paddingRight: 520,
  }, [
    h("div", { fontFamily: "Anton", fontSize: 106, color: C.white, lineHeight: 1.02 }, "NO VACCINE"),
    h("div", { fontFamily: "Anton", fontSize: 106, color: C.white, lineHeight: 1.02 }, "FOR THIS ONE"),
    h("div", { width: 300, height: 10, backgroundColor: C.lime, marginTop: 30, marginBottom: 30 }, ""),
    h("div", { fontFamily: "Anton", fontSize: 76, color: C.lime, lineHeight: 1.02 }, "THAT IS NOT WHY"),
    h("div", { fontFamily: "Inter", fontWeight: 700, fontSize: 33, color: C.dim, marginTop: 36 },
      `DR Congo · ${CASES} cases`),
  ]),
  { width: W, height: H, fonts: FONTS }
);
const TYPE = P("out/_thumbtype.png");
writeFileSync(TYPE, new Resvg(svg, { background: "rgba(0,0,0,0)", fitTo: { mode: "width", value: W } }).render().asPng());

// 3 — one 1:1 overlay. No scaling after this point.
execFileSync(ffmpegPath, ["-y", "-nostdin", "-hide_banner", "-loglevel", "error",
  "-i", PLATE, "-i", TYPE, "-filter_complex", "[0][1]overlay=0:0:format=auto",
  "-frames:v", "1", P("out/THUMB.png")]);
execFileSync(ffmpegPath, ["-y", "-nostdin", "-hide_banner", "-loglevel", "error",
  "-i", P("out/THUMB.png"), "-vf", "scale=168:-2", P("out/THUMB_168.png")]);

console.log(`THUMB.png  ${W}x${H}  ${(readFileSync(P("out/THUMB.png")).length/1048576).toFixed(2)} MB  (YouTube limit 2 MB)`);
console.log(`case count: ${CASES}  — must match card 3`);
