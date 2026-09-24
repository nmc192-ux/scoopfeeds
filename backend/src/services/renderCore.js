/**
 * renderCore.js — the shared satori→resvg primitive and the bundled fonts.
 *
 * Extracted from cardRenderer.js so the landscape video renderer reuses the
 * SAME font buffers and the SAME render call rather than standing up a second
 * rendering stack (brief §4: "do not start a second rendering stack"). It is
 * deliberately the smallest possible surface: fonts, a readiness check, and
 * one function that turns a satori tree into a PNG buffer.
 *
 * WHAT IS NOT HERE, and why. `ensureCard` is not called and nothing from it is
 * lifted: it is article-keyed, preset-validated, photo-fetching, and carries a
 * p0/p1 cache-filename scheme for photo-fallback renders. None of that applies
 * to a frame sequence keyed on a slide spec. The card path keeps its own
 * caching and its own photo-retry; only the two lines that both paths genuinely
 * share live here.
 *
 * CACHE KEYS MUST COVER BUILDER CODE. `sourceFingerprint` exists because of
 * the CARD_DESIGN_VER v12 incident: the card cache key hashed the SUBJECT and
 * the version constant but NOT the code that builds the tree, so changing
 * extractBullets silently kept serving stale PNGs until someone bumped the
 * constant by hand. A fingerprint over the builder's own source makes that
 * failure impossible — edit a layout function and the key changes, with no
 * human step to forget.
 */

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const FONT_DIR = path.join(BACKEND_ROOT, "assets", "fonts");

function readFontOnce(p) {
  try { return readFileSync(p); }
  catch { logger.warn(`renderCore: font missing at ${p}`); return null; }
}

// Same three faces cardRenderer has always loaded, read once at module scope.
export const FONT_SEMIBOLD = readFontOnce(path.join(FONT_DIR, "Inter-SemiBold.otf"));
export const FONT_BOLD     = readFontOnce(path.join(FONT_DIR, "Inter-Bold.otf"));
export const FONT_ANTON    = readFontOnce(path.join(FONT_DIR, "Anton-Regular.ttf"));

/**
 * The satori fonts array. Anton is appended only when present — the card path
 * treats it as required solely under CARD_STYLE=scoopfeeds, and registering an
 * unused face is harmless, so the conditional is preserved exactly.
 */
export function satoriFonts() {
  return [
    { name: "Inter", data: FONT_SEMIBOLD, weight: 600, style: "normal" },
    { name: "Inter", data: FONT_BOLD,     weight: 700, style: "normal" },
    ...(FONT_ANTON ? [{ name: "Anton", data: FONT_ANTON, weight: 400, style: "normal" }] : []),
  ];
}

/** Inter alone renders legacy cards; Anton is required for ScoopFeeds display type. */
export function fontsReady({ requireAnton = false } = {}) {
  if (!(FONT_SEMIBOLD && FONT_BOLD)) return false;
  if (requireAnton && !FONT_ANTON) return false;
  return true;
}

// ─── Fallback fonts for scripts the bundled faces lack ─────────────────────
//
// Inter and Anton carry Latin (and Inter Cyrillic/Greek). A Commons credit is
// whatever its author wrote — "Photo: 李平" rendered as boxes on the Phase 3
// contact sheet (DrJ, 24 Sep 2026). satori asks for a font per unsupported
// segment through `loadAdditionalAsset`; this answers with a Noto face SUBSET
// TO EXACTLY THOSE CHARACTERS from Google Fonts (TrueType, a few KB), cached on
// disk so a credit costs one fetch ever. Any failure returns nothing and the
// segment renders as it did before — a font is an enhancement, never a reason
// to lose a frame.
const NOTO_FOR = {
  "zh-CN": "Noto Sans SC", "zh-TW": "Noto Sans TC", "zh-HK": "Noto Sans HK", "ja-JP": "Noto Sans JP",
  "ko-KR": "Noto Sans KR", "ar-AR": "Noto Sans Arabic", "he-IL": "Noto Sans Hebrew", "th-TH": "Noto Sans Thai",
  "devanagari": "Noto Sans Devanagari", "bn-IN": "Noto Sans Bengali", "ta-IN": "Noto Sans Tamil", unknown: "Noto Sans",
};
let FONT_CACHE_DIR = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.join(process.env.SCOOP_PERSISTENT_DATA_DIR, "font-cache")
  : path.join(BACKEND_ROOT, "data", "font-cache");
let _fontFetch = (u, o) => fetch(u, o);
export function _setFontFetch(fn) { _fontFetch = fn; }
export function _setFontCacheDir(dir) { FONT_CACHE_DIR = dir; }

/** TrueType (00 01 00 00 / "true") or CFF OpenType ("OTTO"). */
export function isFontData(buf) {
  if (!buf || buf.length < 100) return false;
  const sig = buf.subarray(0, 4);
  return sig.equals(Buffer.from([0, 1, 0, 0])) || ["OTTO", "true"].includes(sig.toString("latin1"));
}

export async function loadFallbackFont(code, segment) {
  if (code === "emoji") return [];
  // Han characters arrive as ONE combined code, "ja-JP|zh-CN|zh-TW|zh-HK" —
  // they are shared across the languages. Prefer Simplified Chinese (the
  // widest Han coverage), then the rest in the order given.
  const codes = String(code).split("|");
  const pick = codes.includes("zh-CN") ? "zh-CN" : codes.find((c) => NOTO_FOR[c]);
  const family = NOTO_FOR[pick] || NOTO_FOR.unknown;
  const text = [...new Set([...String(segment)])].join("");
  if (!text.trim()) return [];
  const key = createHash("sha1").update(`${family}|${text}`).digest("hex").slice(0, 20);
  const file = path.join(FONT_CACHE_DIR, `${key}.ttf`);
  try {
    if (existsSync(file)) {
      const cached = readFileSync(file);
      if (isFontData(cached)) return [{ name: family, data: cached, weight: 400, style: "normal" }];
    }
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&text=${encodeURIComponent(text)}`;
    // No browser UA on purpose: without one Google serves TrueType, which is
    // what satori reads (it cannot read WOFF2).
    const cssRes = await _fontFetch(cssUrl, { signal: AbortSignal.timeout(8000) });
    if (!cssRes.ok) return [];
    const css = await cssRes.text();
    const m = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/);
    if (!m) return [];
    const fontRes = await _fontFetch(m[1], { signal: AbortSignal.timeout(8000) });
    if (!fontRes.ok) return [];
    const data = Buffer.from(await fontRes.arrayBuffer());
    // VERIFIED BY SIGNATURE. satori throws on anything that is not a font, and
    // a throw here would lose the frame — an HTML error page must return [].
    if (!isFontData(data)) return [];
    try { mkdirSync(FONT_CACHE_DIR, { recursive: true }); writeFileSync(file, data); } catch { /* cache is optional */ }
    return [{ name: family, data, weight: 400, style: "normal" }];
  } catch (err) {
    logger.warn(`renderCore: no fallback font for ${code} "${text.slice(0, 12)}" — ${String(err.message).slice(0, 60)}`);
    return [];
  }
}

/**
 * Tree → PNG. The whole primitive.
 *
 * Measured 2026-08-02 at 1920x1080 on Apple silicon: satori 1.8ms, resvg
 * 81.6ms, 41 KB per frame. The 98:1 split is why the video renderer draws
 * KEYFRAME STATES and lets ffmpeg interpolate between them rather than
 * rasterising every frame — 30fps would be 150s of CPU and 71 MB of scratch
 * per video, for motion ffmpeg produces for free.
 */
export async function renderTreeToPng(tree, { width, height, background, fonts = null }) {
  const svg = await satori(tree, { width, height, fonts: fonts || satoriFonts(), loadAdditionalAsset: loadFallbackFont });
  return new Resvg(svg, { background, fitTo: { mode: "original" } }).render().asPng();
}

/**
 * A stable hash of one or more source files — the builder-code half of a cache
 * key. Read once at module load; these files cannot change under a running
 * process, so there is no invalidation problem and no reason to re-read.
 *
 * @param {string[]} fileUrls — import.meta.url values of the modules whose code
 *        determines the rendered output.
 */
export function sourceFingerprint(fileUrls) {
  const h = createHash("sha1");
  for (const u of fileUrls) {
    try { h.update(readFileSync(fileURLToPath(u))); }
    catch { h.update(`unreadable:${u}`); }   // fail loud-ish: key changes, forcing a re-render
  }
  return h.digest("hex").slice(0, 12);
}

// ─── Text measurement ───────────────────────────────────────────────────────
//
// MEASURED, NOT PREDICTED. Caption wrapping used a characters-per-line
// estimate, and it was conservative: of four slides it flagged as three-line,
// two rendered as two. Tightening captions against a wrong predictor would
// have shortened narration for nothing.
//
// The measurement renders the text with the SAME font file at the SAME pixel
// size the caption is drawn at, then finds the horizontal extent of the ink.
// Word widths are cached and summed — text advance is additive across a space,
// and any kerning inside a word is already contained in that word's own
// measurement — so a caption costs one render per NEW word, not one per
// prefix, and repeated words across a video are free.
const _wordWidth = new Map();

// CALIBRATION, measured 2026-08-02. satori and ffmpeg drawtext use the same
// font file but disagree slightly on advance: across three real captions
// satori came out 2.0%, 2.5% and 2.7% NARROWER than what drawtext actually
// rendered. The bias is systematic and in the dangerous direction — an
// under-measure wraps too late and overflows the line — so measurements are
// scaled up by a margin that covers the observed spread.
// Re-derive by rendering a caption both ways and comparing ink extents.
export const DRAWTEXT_WIDTH_RATIO = 1.04;

async function inkWidth(text, fontSize, fonts) {
  // Sized for ONE word, not a line: measurement is per-word and summed, so a
  // 4096-wide canvas was ~20x the pixels needed and dominated the cost.
  const W = 1024, H = Math.ceil(fontSize * 2.0);
  const tree = {
    type: "div",
    props: {
      style: { display: "flex", width: W, height: H, background: "#000000", alignItems: "center" },
      children: [{
        type: "div",
        props: {
          style: { display: "flex", fontFamily: "Inter", fontWeight: 600, fontSize, color: "#ffffff", whiteSpace: "pre" },
          children: [{ type: "span", props: { children: text } }],
        },
      }],
    },
  };
  const svg = await satori(tree, { width: W, height: H, fonts: fonts || satoriFonts() });
  // .pixels is raw RGBA — no PNG encode/decode round-trip just to find ink.
  const raw = new Resvg(svg, { background: "#000000", fitTo: { mode: "original" } }).render().pixels;
  let maxX = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = W - 1; x > maxX; x--) {
      if (raw[row + x * 4] > 24) { if (x > maxX) maxX = x; break; }
    }
  }
  return maxX + 1;
}

/**
 * Width of `text` in pixels at `fontSize`, measured through the real font.
 * Space width is measured once and reused.
 */
export async function measureTextWidth(text, { fontSize }) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const spaceKey = `__space__@${fontSize}`;
  if (!_wordWidth.has(spaceKey)) {
    const [a, ab] = [await inkWidth("nn", fontSize), await inkWidth("n n", fontSize)];
    _wordWidth.set(spaceKey, Math.max(1, ab - a));
  }
  const space = _wordWidth.get(spaceKey);
  let total = 0;
  for (const w of words) {
    const k = `${w}@${fontSize}`;
    if (!_wordWidth.has(k)) _wordWidth.set(k, await inkWidth(w, fontSize));
    total += _wordWidth.get(k);
  }
  return Math.round((total + space * (words.length - 1)) * DRAWTEXT_WIDTH_RATIO);
}

/** Greedy wrap driven by MEASURED width rather than a character estimate. */
export async function wrapToWidth(text, { fontSize, maxWidth }) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = [];
  for (const w of words) {
    const trial = [...cur, w];
    if (cur.length && await measureTextWidth(trial.join(" "), { fontSize }) > maxWidth) {
      lines.push(cur.join(" "));
      cur = [w];
    } else cur = trial;
  }
  if (cur.length) lines.push(cur.join(" "));
  return lines;
}

export const _internals = { FONT_DIR, inkWidth, _wordWidth };
