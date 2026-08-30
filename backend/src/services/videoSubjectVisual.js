/**
 * videoSubjectVisual.js — how a story's SUBJECT arrives on screen.
 *
 * THE TAXONOMY. A card type is not the same thing as a subject, and conflating
 * them is what put two unreadable people on a story about a tariff system. The
 * subject decides the visual:
 *
 *   geographic  → a locator MAP, built from a country list
 *   named person → the article's photograph, on a MOUNT
 *   document / evidence → the same photograph as a news CUTTING
 *   abstract quantity → a data card (stat, bars) — no imagery
 *   nothing concrete → typographic (title, turn, kicker)
 *
 * ONE GROUND, ALWAYS. The near-black never changes; a photograph arrives as an
 * OBJECT placed on it. That decision (DrJ, 2026-08-14) dissolved four palette
 * conflicts at once, all of which came from the ground moving rather than from
 * the treatment.
 *
 * WHY A LIGHT PAPER BODY IS NOT OPTIONAL. On a 9/255 ground a torn edge reads as
 * a HOLE unless the object is lighter than what surrounds it. Measured: the drop
 * shadow contributes at most 9 levels of separation — it cannot darken a ground
 * that is already almost black — while the bone body gives 227. Every mount
 * therefore lifts the image's blacks to ~20% and prints onto bone. The shadow
 * still ships, because it earns its place where objects overlap and costs
 * nothing, but it is not what does the work.
 *
 * Everything here is ffmpeg + resvg. No new dependency, no stock, no rights.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { logger } from "./logger.js";
import { getFFmpegPath } from "./videoGenerator.js";
import { VERTICAL } from "./videoGeometry.js";
import { COLORS } from "./videoSlideChrome.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEO_PATH = path.resolve(HERE, "../../assets/geo/countries-50m.geo.json");

/** The body every mount is printed on. Light, by contract — see the header. */
export const PAPER_BONE = "#efe7d6";
const SHADOW_BLUR = 20, SHADOW_DX = -12, SHADOW_DY = 18;
/** Blacks are lifted to this before any treatment. 0 would equal the ground. */
const BLACK_LIFT = 0.20;

export const SUBJECT_VISUAL = Object.freeze({
  geographic: "map",
  person: "mount",
  document: "cutting",
  abstract: "data",
  none: "typographic",
});

/** Deterministic jitter — a torn edge must be identical on every re-render, or
 *  the render cache stops meaning anything. */
function rng(seed) {
  let s = [...String(seed)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 11);
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** A torn-paper outline as an SVG alpha mask. White = keep. */
export function tornMaskSvg({ w, h, seed, amp = 13, step = 24, nickChance = 0.09, nickDepth = 30 }) {
  const r = rng(seed), pts = [];
  const walk = (x0, y0, x1, y1) => {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    const n = Math.max(2, Math.round(len / step));
    const nx = -dy / len, ny = dx / len;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const deep = r() < nickChance ? nickDepth * r() : 0;
      const off = (r() - 0.5) * 2 * amp - deep;
      pts.push([x0 + dx * t + nx * off, y0 + dy * t + ny * off]);
    }
  };
  walk(0, 0, w, 0); walk(w, 0, w, h); walk(w, h, 0, h); walk(0, h, 0, 0);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("") + "Z";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="${d}" fill="#fff"/></svg>`;
}

/** Grayscale, shaped, and blacks LIFTED so nothing in the image equals the ground. */
const toneChain = (lift = BLACK_LIFT) =>
  `format=gray,eq=contrast=1.10:brightness=0.06:gamma=1.20,curves=all='0/${lift} 0.5/0.56 1/0.98'`;

/** A halftone dot screen on a 45-degree grid. */
function halftoneChain(pitch = 5) {
  const A = Math.PI / 4, cs = Math.cos(A).toFixed(4), sn = Math.sin(A).toFixed(4);
  const XR = `(X*${cs}+Y*${sn})`, YR = `(Y*${cs}-X*${sn})`;
  return `geq=lum='if(gt(lum(X,Y),128+118*sin(${XR}*PI/${pitch})*sin(${YR}*PI/${pitch})),255,0)':cb=128:cr=128`;
}

function shadowAndTilt(ff, src, out, { tilt, pad = 110 }) {
  const rot = (tilt * Math.PI / 180).toFixed(5);
  execFileSync(ff, ["-y", "-loglevel", "error", "-i", src, "-filter_complex",
    `[0:v]format=rgba,pad=iw+${pad * 2}:ih+${pad * 2}:${pad}:${pad}:color=#00000000,split=2[img][sh];` +
    // The shadow is the object's OWN alpha — a torn edge must cast a torn
    // shadow, or the illusion breaks at the interesting part.
    `[sh]geq=r=0:g=0:b=0:a='alpha(X,Y)*0.72',boxblur=${SHADOW_BLUR}:2,rotate=${rot}:c=none:ow=rotw(${rot}):oh=roth(${rot})[shadow];` +
    `[img]rotate=${rot}:c=none:ow=rotw(${rot}):oh=roth(${rot})[top];` +
    `[shadow][top]overlay=x=${SHADOW_DX}:y=${SHADOW_DY}:format=auto[out]`,
    "-map", "[out]", out]);
  return out;
}

/**
 * THE MOUNT LIBRARY — how a photograph is presented as an object.
 *
 * `taped` is deliberately absent. It has no border, so the print's own dark
 * edges meet the ground with nothing between them: the one mount of the four
 * that still risked reading as a hole. It needs a bone border before it belongs.
 */
export const MOUNTS = {
  /** Halftone printed on torn newsprint. For documents and evidence. */
  cutting(ff, { src, out, crop, work, seed = "c", tilt = -3, pitch = 5 }) {
    const { cw, ch } = crop;
    const ink = path.join(work, "sv-ink.png"), body = path.join(work, "sv-body.png");
    const mask = path.join(work, "sv-mask.png"), torn = path.join(work, "sv-torn.png");
    execFileSync(ff, ["-y", "-loglevel", "error", "-i", src, "-vf",
      `crop=${cw}:${ch}:${crop.cx}:${crop.cy},${toneChain(0.34)},${halftoneChain(pitch)},format=gray`, ink]);
    // MULTIPLIED ONTO BONE so the paper shows through the dots, rather than the
    // video ground showing through them — which is the hole, exactly.
    execFileSync(ff, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${PAPER_BONE}:s=${cw}x${ch}`,
      "-i", ink, "-filter_complex",
      "[0:v]format=rgba[p];[1:v]format=gray,format=rgba[i];[p][i]blend=all_mode=multiply:all_opacity=0.78,format=rgba[o]",
      "-map", "[o]", "-frames:v", "1", body]);
    writeFileSync(mask, new Resvg(tornMaskSvg({ w: cw, h: ch, seed }), { fitTo: { mode: "original" } }).render().asPng());
    execFileSync(ff, ["-y", "-loglevel", "error", "-i", body, "-i", mask, "-filter_complex",
      "[0:v]format=rgba[a];[1:v]format=gray[m];[a][m]alphamerge[o]", "-map", "[o]", torn]);
    return shadowAndTilt(ff, torn, out, { tilt });
  },

  /** Continuous tone, thick white border, heavier at the foot. The most legible. */
  polaroid(ff, { src, out, crop, work, tilt = 2.5, border = 34, foot = 96 }) {
    const { cw, ch } = crop;
    const img = path.join(work, "sv-img.png"), framed = path.join(work, "sv-frame.png");
    execFileSync(ff, ["-y", "-loglevel", "error", "-i", src, "-vf",
      `crop=${cw}:${ch}:${crop.cx}:${crop.cy},${toneChain()},format=rgba`, img]);
    execFileSync(ff, ["-y", "-loglevel", "error", "-i", img, "-vf",
      `pad=${cw + border * 2}:${ch + border + foot}:${border}:${border}:color=${PAPER_BONE},format=rgba`, framed]);
    return shadowAndTilt(ff, framed, out, { tilt });
  },

  /** A thin-bordered print with a pin through the top edge. */
  pinned(ff, { src, out, crop, work, tilt = -2.5, border = 16, pin = "#c8402f" }) {
    const { cw, ch } = crop;
    const img = path.join(work, "sv-img.png"), framed = path.join(work, "sv-frame.png");
    const full = path.join(work, "sv-full.png"), mark = path.join(work, "sv-pin.png");
    execFileSync(ff, ["-y", "-loglevel", "error", "-i", src, "-vf",
      `crop=${cw}:${ch}:${crop.cx}:${crop.cy},${toneChain()},format=rgba`, img]);
    execFileSync(ff, ["-y", "-loglevel", "error", "-i", img, "-vf",
      `pad=${cw + border * 2}:${ch + border * 2}:${border}:${border}:color=${PAPER_BONE},format=rgba`, framed]);
    // The pin goes on BEFORE the tilt — it must lean with the card, not stand
    // upright on a leaning one.
    const W = cw + border * 2, cx = Math.round(W / 2), cy = 30;
    writeFileSync(mark, new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${ch + border * 2}">
        <ellipse cx="${cx}" cy="${cy + 3}" rx="21" ry="21" fill="#000" opacity="0.28"/>
        <circle cx="${cx}" cy="${cy}" r="19" fill="${pin}"/>
        <circle cx="${cx - 6}" cy="${cy - 6}" r="6" fill="#fff" opacity="0.5"/></svg>`,
      { fitTo: { mode: "original" } }).render().asPng());
    execFileSync(ff, ["-y", "-loglevel", "error", "-i", framed, "-i", mark, "-filter_complex",
      "[0:v][1:v]overlay=0:0:format=auto[o]", "-map", "[o]", full]);
    return shadowAndTilt(ff, full, out, { tilt });
  },
};
export const MOUNT_NAMES = Object.freeze(Object.keys(MOUNTS));

/**
 * Build the mount PNG for one article photograph.
 *
 * Returns null rather than throwing on every failure path — a missing or
 * unfetchable photo means "no photo card", never "no video".
 */
export async function buildMount({ imageUrl, mount, work, seed, ffmpegPath = null,
  // BYTES WE ALREADY HAVE. The beat resolver has fetched and validated its
  // picture before it ever gets here; re-fetching would be a second request for
  // the same image and, on a CDN that varies renditions, potentially a
  // different one. Given sourceBuffer, the fetch below is skipped entirely.
  sourceBuffer = null,
  // The per-video image ledger (videoBeatImagery.createImageLedger). Both this
  // path and the resolver claim through it, so whichever runs first wins the
  // picture and the other renders without one rather than repeating it.
  ledger = null,
} = {}) {
  const ff = ffmpegPath || getFFmpegPath();
  if (!ff) { logger.warn("🎬 subject visual: no ffmpeg, skipping the mount"); return null; }
  if (!MOUNTS[mount]) { logger.warn(`🎬 subject visual: unknown mount "${mount}"`); return null; }
  if (!imageUrl && !sourceBuffer) return null;
  mkdirSync(work, { recursive: true });
  const raw = path.join(work, "sv-source.img");
  try {
    let buf = sourceBuffer;
    if (!buf) {
      const res = await fetch(imageUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ScoopBot/1.0; +https://scoopfeeds.com)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) { logger.warn(`🎬 subject visual: photo fetch ${res.status} for ${imageUrl.slice(0, 80)}`); return null; }
      buf = Buffer.from(await res.arrayBuffer());
    }
    if (buf.length < 8 * 1024) { logger.warn(`🎬 subject visual: photo is ${buf.length}B — too small to mount`); return null; }
    // CLAIM BEFORE TREATING. The ledger is keyed on the SOURCE bytes, because
    // treatment is exactly what makes one photograph look like three: the same
    // picture mounted, then full-bleed, then halftoned, hashes differently at
    // every stage but is one photograph to a viewer.
    if (ledger && !ledger.claim(buf, { label: imageUrl || "resolved bytes" })) {
      logger.info(`🎬 subject visual: this photograph is already in the video — rendering without it`);
      return null;
    }
    writeFileSync(raw, buf);
  } catch (err) {
    logger.warn(`🎬 subject visual: photo fetch failed — ${err.message}`);
    return null;
  }
  // ONE FRAME, BOUNDED, WITHOUT THE METADATA.
  //
  // Found on the first live DVIDS fetch. DoD photographs now ship with C2PA
  // content credentials, and the C2PA block embeds a SECOND image. ffmpeg's
  // image2 muxer therefore sees a two-frame input and dies writing the mount's
  // intermediate: "Could not get frame filename number 2 from pattern". The
  // mount returned null and the slide fell back to bare type — for every DVIDS
  // photograph, silently.
  //
  // (The loud "unable to decode APP fields" warnings alongside it are a red
  // herring; the pixels decode fine. The frame COUNT was the failure.)
  //
  // The same trap catches an animated GIF article image, which has always been
  // possible and would have failed the same way. So this is normalisation, not
  // a DVIDS patch: take the first video frame and nothing else.
  //
  // Bounded to 2000px on the long edge because the mount crops to roughly 700px
  // and a 5000x3300 source costs a 23MB intermediate to gain nothing.
  const flat = path.join(work, "sv-flat.png");
  try {
    execFileSync(ff, [
      "-y", "-loglevel", "error", "-i", raw, "-map", "0:v:0", "-frames:v", "1",
      "-vf", "scale='min(2000,iw)':-2:flags=lanczos", flat,
    ], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    logger.warn(`🎬 subject visual: could not normalise the source — ${String(err.message).slice(0, 120)}`);
    return null;
  }

  const out = path.join(work, `mount-${mount}.png`);
  try {
    // A 5:6 crop from the middle of the frame. Publisher photos are landscape
    // and their subject is centred far more often than not; this is a crop rule,
    // not face detection, and it is stated as such rather than implied.
    const probe = execFileSync(ff, ["-hide_banner", "-i", flat], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
    return mountFrom(ff, flat, out, work, mount, seed, probe);
  } catch (err) {
    // ffmpeg writes stream info to stderr and exits non-zero on -i alone.
    try { return mountFrom(ff, flat, out, work, mount, seed, String(err.stderr || "")); }
    catch (e2) { logger.warn(`🎬 subject visual: mount failed — ${e2.message.slice(0, 120)}`); return null; }
  }
}

function mountFrom(ff, raw, out, work, mount, seed, probeText) {
  const m = String(probeText).match(/,\s*(\d{2,5})x(\d{2,5})/);
  const W = m ? Number(m[1]) : 1920, H = m ? Number(m[2]) : 1080;
  // EVERY CROP DIMENSION AND OFFSET IS EVEN, because `crop` runs on the source's
  // native pixel format and article photographs are JPEG — yuv420p, whose chroma
  // planes are half-resolution. ffmpeg silently rounds an odd crop DOWN to the
  // chroma grid, so a nominal 711x853 comes out 710x852.
  //
  // Nothing complained until `cutting`, which renders its torn-paper alpha mask
  // at the NOMINAL size and alphamerges it onto the ACTUAL one: "Input frame
  // sizes do not match (710x852 vs 711x853)", the mount returns null, and the
  // slide falls back to "rendering the type alone" — a bare type card, which is
  // exactly the flatness this format exists to avoid. It stayed invisible
  // because that fallback is a warning, not an error, and the video publishes.
  //
  // polaroid and pinned survived only by luck: they pad rather than alphamerge,
  // so a silently-shrunk crop just makes a marginally smaller print.
  // Dimensions floor to even with a floor of 2 (a zero-size crop errors out);
  // OFFSETS floor to even with a floor of ZERO. Clamping an offset to 2 as well
  // pushes the window 2px past the bottom edge on any source whose height is
  // odd — which is most of them, since that is the case being fixed here.
  const evenDim = (n) => Math.max(2, n - (n % 2));
  const evenOff = (n) => Math.max(0, n - (n % 2));
  const ch = evenDim(Math.min(H, Math.round(W * 6 / 5)));
  const cw = evenDim(Math.min(W, Math.round(ch * 5 / 6)));
  const crop = { cw, ch, cx: evenOff(Math.round((W - cw) / 2)), cy: evenOff(Math.round((H - ch) / 2)) };
  MOUNTS[mount](ff, { src: raw, out, crop, work, seed });
  return out;
}

// ─── The locator map ────────────────────────────────────────────────────────

let _geo = null;
function geo() {
  if (_geo) return _geo;
  if (!existsSync(GEO_PATH)) throw new Error(`videoSubjectVisual: missing ${GEO_PATH}`);
  _geo = JSON.parse(readFileSync(GEO_PATH, "utf8"));
  return _geo;
}
export function knownCountry(code) {
  return geo().features.some(f => f.id === String(code || "").toUpperCase());
}
const ringsOf = (f) => f.geometry.type === "Polygon" ? f.geometry.coordinates
  : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.flat() : [];

/** Centroid of a country's LARGEST ring — the mainland, not an outlying islet. */
function centroidOf(f) {
  const rings = ringsOf(f);
  if (!rings.length) return null;
  const biggest = rings.reduce((a, b) => (b.length > a.length ? b : a), rings[0]);
  let x = 0, y = 0;
  for (const [lon, lat] of biggest) { x += lon; y += lat; }
  return [x / biggest.length, y / biggest.length];
}

/**
 * A locator map, from a country list. No stock, no rights, no tracing.
 *
 * THE EXCEPTION IS ANNOTATED, NOT MERELY COLOURED (DrJ, 2026-08-15). Eswatini is
 * about two pixels wide at this scale, and "all but one" is unreadable if the one
 * cannot be found: the map showed the set correctly and lost the story. The
 * callout is placed from the country's own CENTROID rather than a hardcoded
 * coordinate, so it generalises to whichever country the next story excepts.
 */
export function buildLocatorMap({ codes, exception = null, w = VERTICAL.canvas.w, h = VERTICAL.canvas.h, pad = 140 }) {
  const want = new Set((codes || []).map(c => String(c).toUpperCase()));
  const feats = geo().features.filter(f => want.has(f.id));
  if (!feats.length) return null;

  let minL = 180, maxL = -180, minP = 90, maxP = -90;
  for (const f of feats) for (const ring of ringsOf(f)) for (const [lon, lat] of ring) {
    if (lon < minL) minL = lon; if (lon > maxL) maxL = lon;
    if (lat < minP) minP = lat; if (lat > maxP) maxP = lat;
  }
  // Equirectangular, longitude flattened at the mid-latitude. Good enough for a
  // diagram of WHICH countries; this is not a navigational chart.
  const kx = Math.cos(((minP + maxP) / 2) * Math.PI / 180);
  const spanX = Math.max(1e-6, (maxL - minL) * kx), spanY = Math.max(1e-6, maxP - minP);
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const offX = (w - spanX * scale) / 2, offY = (h - spanY * scale) / 2;
  const proj = ([lon, lat]) => [offX + (lon - minL) * kx * scale, offY + (maxP - lat) * scale];
  const d = (f) => ringsOf(f).map(ring =>
    "M" + ring.map(proj).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z").join("");

  const ex = exception ? String(exception).toUpperCase() : null;
  const paths = feats.map(f =>
    `<path d="${d(f)}" fill="${f.id === ex ? "#2a2721" : COLORS.lime}" stroke="${COLORS.base}" stroke-width="1.2"/>`
  ).join("\n");

  let callout = "";
  const exFeat = ex ? feats.find(f => f.id === ex) : null;
  if (exFeat) {
    const c = centroidOf(exFeat);
    if (c) {
      const [px, py] = proj(c);
      // Lead to whichever side has room, so the label never runs off the frame.
      const right = px < w * 0.62;
      const lx = right ? px + 26 : px - 26, tx = right ? px + 176 : px - 176;
      const anchor = right ? "start" : "end";
      const label = String(exFeat.properties?.name || ex).toUpperCase();
      callout =
        `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="13" fill="${COLORS.white}"/>` +
        `<line x1="${lx.toFixed(1)}" y1="${py.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${COLORS.white}" stroke-width="2"/>` +
        `<text x="${(tx + (right ? 12 : -12)).toFixed(1)}" y="${(py - 6).toFixed(1)}" text-anchor="${anchor}" ` +
        `font-family="Inter" font-size="30" font-weight="700" letter-spacing="3" fill="${COLORS.white}">${label}</text>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${paths}
${callout}
</svg>`;
}

/** Rasterise a locator map onto the ground. Returns the path, or null. */
export function buildMapPng({ codes, exception, out, work }) {
  const svg = buildLocatorMap({ codes, exception });
  if (!svg) { logger.warn(`🎬 subject visual: no known countries in [${(codes || []).join(", ")}]`); return null; }
  mkdirSync(work, { recursive: true });
  writeFileSync(out, new Resvg(svg, { background: COLORS.base, fitTo: { mode: "original" } }).render().asPng());
  return out;
}
