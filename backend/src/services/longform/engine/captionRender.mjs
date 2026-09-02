// One caption word, rendered as a tight transparent PNG.
//
// captions.mjs plans WHEN a word appears and WHERE it sits. This renders WHAT
// it looks like, and nothing else. The split is what lets the planner be tested
// offline: layout needs measured widths, and a width is only knowable by
// rendering, so rendering lives behind its own small surface.
//
// ── Why a PNG per word, not a PNG per caption state ─────────────────────────
//
// A caption of four words revealed one at a time is four states, and a film has
// hundreds of captions. Rendering states means thousands of full-frame renders
// through a renderer that leaks ~8.8 MB each. Rendering WORDS means one render
// per distinct word — English repeats enough that ~2,100 spoken words resolve
// to a few hundred — and each is a few hundred pixels rather than 1920×1080, so
// the leak per render is roughly a fiftieth of a card's.
//
// The cache key is the text plus the style, so "the" is rendered once for the
// whole film and "xylitol" once, not once per appearance.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { dep, ASSETS } from "./_deps.mjs";

const _satori = dep("satori");
const satori = _satori.default ?? _satori;
const { Resvg } = dep("@resvg/resvg-js");

const FONTS = [
  { name: "Anton", data: readFileSync(path.join(ASSETS, "fonts/Anton-Regular.ttf")), weight: 400, style: "normal" },
  { name: "Inter", data: readFileSync(path.join(ASSETS, "fonts/Inter-Bold.otf")), weight: 700, style: "normal" },
  { name: "Inter", data: readFileSync(path.join(ASSETS, "fonts/Inter-SemiBold.otf")), weight: 600, style: "normal" },
];

/**
 * Caption type.
 *
 * Inter Bold at 58px, not Anton. Anton is the film's display face and carries
 * its headline voice; putting the running narration in it would make every
 * spoken word look like a title card. Captions are meant to be read without
 * being looked at.
 *
 * The stroke is not decoration. Captions sit over footage whose brightness is
 * unknown and changes within the shot, so contrast cannot be guaranteed by
 * colour alone — a white word over a white lab coat is invisible for exactly as
 * long as the shot lasts. A dark outline makes the word legible over anything,
 * which is why every broadcaster does it.
 */
export const CAPTION_STYLE = Object.freeze({
  fontFamily: "Inter",
  fontWeight: 700,
  fontSize: 58,
  color: "#ffffff",
  stroke: "#0a0806",
  strokeWidth: 5,
  padding: 10,        // room for the stroke inside the PNG's own bounds
});

const styleKey = (s) => `${s.fontSize}-${s.fontWeight}-${s.color}-${s.strokeWidth}`.replace(/[^\w-]/g, "");

/**
 * Render one word to `dir`, or reuse the cached PNG.
 *
 * @returns {{file:string, width:number, height:number}}
 */
export async function renderWord(word, dir, style = CAPTION_STYLE) {
  mkdirSync(dir, { recursive: true });
  // The filename has to survive punctuation and case ("It's", "Thirty-seven.")
  // without colliding, and stay a legal filename on any host. Hex of the UTF-8
  // bytes is the least clever option that does both.
  const safe = Buffer.from(word, "utf8").toString("hex");
  const file = path.join(dir, `${styleKey(style)}_${safe}.png`);
  const meta = `${file}.json`;
  if (existsSync(file) && existsSync(meta)) {
    return { file, ...JSON.parse(readFileSync(meta, "utf8")) };
  }

  // satori needs a fixed canvas, so render into a generous box and let resvg
  // crop to the drawn content. Guessing a tight width up front is the thing
  // that clips descenders and long words.
  const box = { w: Math.max(200, word.length * style.fontSize), h: Math.round(style.fontSize * 2.2) };
  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: box.w, height: box.h, display: "flex",
          alignItems: "center", justifyContent: "flex-start",
        },
        children: {
          type: "div",
          props: {
            style: {
              fontFamily: style.fontFamily, fontWeight: style.fontWeight,
              fontSize: style.fontSize, color: style.color,
              padding: `0 ${style.padding}px`,
              // satori maps these to SVG paint-order stroke, which is what
              // keeps the outline OUTSIDE the glyph instead of eating into it.
              WebkitTextStroke: `${style.strokeWidth}px ${style.stroke}`,
              paintOrder: "stroke",
            },
            children: word,
          },
        },
      },
    },
    { width: box.w, height: box.h, fonts: FONTS },
  );

  const img = new Resvg(svg, { fitTo: { mode: "original" } }).render();
  writeFileSync(file, img.asPng());

  // MEASURE THE INK, NOT THE CANVAS. satori needs a fixed render box, so the
  // PNG is always the generous box above — using its width as the word's width
  // would space captions by how much padding each render happened to get, not
  // by how wide the word is. Scanning the alpha channel gives the true extent.
  //
  // The PNG is kept UNCROPPED and the ink's left offset is returned with it, so
  // the caller overlays at (x - inkLeft). That avoids re-encoding a cropped
  // copy, and there is no PNG encoder here to do it with anyway.
  const ink = inkBounds(img.pixels, img.width, img.height);
  const out = ink
    ? { width: ink.right - ink.left + 1, height: ink.bottom - ink.top + 1,
        inkLeft: ink.left, inkTop: ink.top, canvasW: img.width, canvasH: img.height }
    // A word that renders to nothing (a lone zero-width character) must not
    // report a width of zero and collapse the line it sits on.
    : { width: Math.round(style.fontSize * 0.4), height: style.fontSize,
        inkLeft: 0, inkTop: 0, canvasW: img.width, canvasH: img.height };
  writeFileSync(meta, JSON.stringify(out));
  return { file, ...out };
}

/** Tightest box containing any pixel above a small alpha threshold, or null. */
function inkBounds(px, w, h, alphaMin = 8) {
  let left = w, right = -1, top = h, bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > alphaMin) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return right < 0 ? null : { left, right, top, bottom };
}
