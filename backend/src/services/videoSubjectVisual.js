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
/**
 * THE PAPER-COLLAGE MOUNTS ARE DELETED (DrJ, 2026-08-30).
 *
 * `cutting`, `polaroid` and `pinned` — halftone on torn newsprint, bordered
 * prints, pinned photographs with drop shadows — together with tornMaskSvg,
 * PAPER_BONE and the tone/halftone/shadow chains that fed them, are GONE
 * rather than demoted to a rare accent. Watched on the Federer short: the
 * treatment made real photographs read as MODIFIED and unidentifiable, so a
 * viewer could not tell the event from an illustration of it. "Real photos
 * must look REAL."
 *
 * INCIDENT_GRADE is untouched — that lane's treatment answers a legal
 * requirement, not an aesthetic one.
 */

/**
 * FULL-BLEED, COLOUR, UNTOUCHED — the treatment for a news photograph.
 *
 * Fill the vertical frame, keep the colour, add nothing. The only processing is
 * what legibility requires:
 *
 *   COVER-CROP to the frame rather than letterbox. A landscape press photo
 *     letterboxed into 9:16 is two thirds black; filling the frame is what
 *     makes the picture the beat rather than a stamp on the beat.
 *   A BOTTOM SCRIM, and only where text sits — a dark band across the lower
 *     third so a kinetic word stays readable over a bright sky without
 *     dimming the photograph itself. Pass scrim:false for a beat with no text.
 */
export async function buildFullBleed({ imageUrl, work, out = null, ffmpegPath = null,
  sourceBuffer = null, ledger = null,
  width = VERTICAL.canvas.w, height = VERTICAL.canvas.h } = {}) {
  const ff = ffmpegPath || getFFmpegPath();
  if (!ff) { logger.warn("🎬 subject visual: no ffmpeg, skipping the picture"); return null; }
  if (!imageUrl && !sourceBuffer) return null;
  mkdirSync(work, { recursive: true });

  const raw = path.join(work, "fb-source.img");
  try {
    let buf = sourceBuffer;
    if (!buf) {
      const res = await fetch(imageUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ScoopBot/1.0; +https://scoopfeeds.com)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) { logger.warn(`🎬 subject visual: photo fetch ${res.status}`); return null; }
      buf = Buffer.from(await res.arrayBuffer());
    }
    if (buf.length < 8 * 1024) { logger.warn(`🎬 subject visual: photo is ${buf.length}B — too small`); return null; }
    // CLAIM BEFORE TREATING, on the SOURCE bytes: treatment is what makes one
    // photograph look like several, so the ledger has to see it beforehand.
    if (ledger && !ledger.claim(buf, { label: imageUrl || "resolved bytes" })) {
      logger.info("🎬 subject visual: this photograph is already in the video — rendering without it");
      return null;
    }
    writeFileSync(raw, buf);
  } catch (err) {
    logger.warn(`🎬 subject visual: photo fetch failed — ${String(err.message).slice(0, 110)}`);
    return null;
  }

  // ONE FRAME, WITHOUT THE METADATA — the C2PA trap. Agency photographs ship
  // content credentials that embed a SECOND image, so ffmpeg's image2 muxer
  // sees a two-frame input and dies. Normalising first is what makes the rest
  // safe, and this is the one piece of the old path worth keeping.
  const flat = path.join(work, "fb-flat.png");
  try {
    execFileSync(ff, ["-y", "-loglevel", "error", "-i", raw, "-map", "0:v:0", "-frames:v", "1",
      "-vf", "scale='min(2600,iw)':-2:flags=lanczos", flat], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    logger.warn(`🎬 subject visual: could not normalise the source — ${String(err.message).slice(0, 110)}`);
    return null;
  }

  const dest = out || path.join(work, "fullbleed.png");

  // MEASURE THE SOURCE FIRST. Serper's numbers are thumbnails and a CDN can
  // serve anything, so the decision is made on the real decoded pixels.
  let W = 0, H = 0;
  try {
    const probe = execFileSync(ff, ["-hide_banner", "-i", flat], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
    throw new Error(probe);
  } catch (err) {
    const m = String(err.message || err.stderr || "").match(/,\s*(\d{2,5})x(\d{2,5})/);
    if (m) { W = Number(m[1]); H = Number(m[2]); }
  }

  // TWO TREATMENTS, decided by resolution (DrJ, defect 2). A sharp source
  // covers the frame; a small one must NOT be blown to 1080x1920 — it
  // pixelates. Small sources get the standard vertical treatment instead: the
  // same image blurred and darkened as the frame fill, with the sharp image at
  // its natural aspect centred on top. This also renders editorial 2-up
  // composites as what they are, instead of cover-cropping across the split.
  //
  // NO SCRIM HERE ANY MORE. The old drawbox band had a hard edge that read as
  // a seam across every photograph (and as a grey card over light ones) — the
  // defect DrJ called out from the strips. Text legibility is the LAYOUT's
  // job now: the kinetic block carries its own gradient backing, so the
  // darkening exists exactly where text sits and nowhere else.
  const SHARP_MIN_W = 1000;
  const cover = `scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2:flags=lanczos,crop=${width}:${height}`;
  try {
    if (W >= SHARP_MIN_W || !W) {
      execFileSync(ff, ["-y", "-loglevel", "error", "-i", flat, "-vf", `${cover},format=rgba`, "-frames:v", "1", dest],
        { stdio: ["ignore", "ignore", "pipe"] });
    } else {
      // Blur-fill: fill = blurred, darkened cover; subject = natural aspect,
      // fitted to the frame width, centred. gblur after a heavy downscale is
      // cheap and looks like every professional vertical channel's fallback.
      execFileSync(ff, ["-y", "-loglevel", "error", "-i", flat, "-filter_complex",
        `[0:v]split=2[bg][fg];` +
        `[bg]${cover},gblur=sigma=28,eq=brightness=-0.18:saturation=0.85[b];` +
        `[fg]scale=${width}:-2:flags=lanczos[f];` +
        `[b][f]overlay=(W-w)/2:(H-h)/2:format=auto,format=rgba`,
        "-frames:v", "1", dest], { stdio: ["ignore", "ignore", "pipe"] });
      logger.info(`🎬 subject visual: ${W}x${H} source below ${SHARP_MIN_W}px — blur-fill treatment`);
    }
    return dest;
  } catch (err) {
    logger.warn(`🎬 subject visual: full-bleed render failed — ${String(err.message).slice(0, 110)}`);
    return null;
  }
}

/**
 * A HARD-CUT SEQUENCE OF STILLS, as one video clip for the cutaway seam.
 *
 * The pacing rule (DrJ, defect 5): no single visual holds longer than ~3
 * seconds. A 7-second narration beat becomes two or three visuals cut hard —
 * a second photograph where one exists, else a reframed crop of the same one
 * (wide, then tight). The reference shows a new visual roughly every second;
 * this is the interim, beat-level version until TTS word timestamps land.
 *
 * Implemented as a tiny mp4 rather than by widening the assembler: the
 * cutaway seam already takes a video stream that ends and hands the frame
 * back, and a pre-cut sequence IS such a stream. No graph changes, no new
 * composition path, and the seam's clamp/credit/audio behaviour all hold.
 */
export function buildStillSequence({ frames, secsEach, out, work, ffmpegPath = null, fps = 25 }) {
  const ff = ffmpegPath || getFFmpegPath();
  if (!ff || !frames?.length) return null;
  mkdirSync(work, { recursive: true });
  const args = ["-y", "-loglevel", "error"];
  for (const f of frames) args.push("-loop", "1", "-t", String(secsEach), "-i", f);
  const labels = frames.map((_, i) => `[v${i}]`).join("");
  const chain = frames.map((_, i) =>
    `[${i}:v]scale=${VERTICAL.canvas.w}:${VERTICAL.canvas.h}:force_original_aspect_ratio=increase:force_divisible_by=2,` +
    `crop=${VERTICAL.canvas.w}:${VERTICAL.canvas.h},setsar=1,fps=${fps}[v${i}]`).join(";");
  args.push("-filter_complex", `${chain};${labels}concat=n=${frames.length}:v=1:a=0[o]`,
    "-map", "[o]", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", out);
  try { execFileSync(ff, args, { stdio: ["ignore", "ignore", "pipe"] }); return out; }
  catch (err) {
    logger.warn(`🎬 still sequence failed — ${String(err.message).slice(0, 100)}`);
    return null;
  }
}

/**
 * The TIGHT reframe of a photograph — the second "visual" when a beat has only
 * one image. Centre 62% of the frame, re-covered, so the cut reads as wide →
 * close rather than as the same slide twice.
 */
export function buildTightCrop({ sourcePath, out, ffmpegPath = null, zoom = 1.6 }) {
  const ff = ffmpegPath || getFFmpegPath();
  if (!ff) return null;
  const f = (1 / zoom).toFixed(4);
  try {
    execFileSync(ff, ["-y", "-loglevel", "error", "-i", sourcePath, "-vf",
      `crop=iw*${f}:ih*${f},scale=${VERTICAL.canvas.w}:${VERTICAL.canvas.h}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${VERTICAL.canvas.w}:${VERTICAL.canvas.h},format=rgba`,
      "-frames:v", "1", out], { stdio: ["ignore", "ignore", "pipe"] });
    return out;
  } catch (err) {
    logger.warn(`🎬 tight crop failed — ${String(err.message).slice(0, 100)}`);
    return null;
  }
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
