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
import { readFileSync } from "fs";
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
  const svg = await satori(tree, { width, height, fonts: fonts || satoriFonts() });
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

export const _internals = { FONT_DIR };
