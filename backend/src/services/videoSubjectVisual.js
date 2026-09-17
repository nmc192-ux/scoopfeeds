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
// Natural Earth 1:50m populated places, trimmed and COMMITTED like the atlas.
// No runtime fetch: a map that needs the network fails at :12 on a morning
// when it did not before.
const CITIES_PATH = path.resolve(HERE, "../../assets/geo/cities-50m.json");

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
export function buildStillSequence({ frames, secsEach, out, work, ffmpegPath = null, fps = 25, motion = false }) {
  const ff = ffmpegPath || getFFmpegPath();
  if (!ff || !frames?.length) return null;
  mkdirSync(work, { recursive: true });
  const args = ["-y", "-loglevel", "error"];
  for (const f of frames) args.push("-loop", "1", "-t", String(secsEach), "-i", f);
  const labels = frames.map((_, i) => `[v${i}]`).join("");
  // SUBTLE MOTION, per segment, flag-gated. The reference is ~80% stills with
  // slight movement; a dead-static still inside a hard-cut sequence reads as a
  // freeze frame. 4% push over the segment, alternating in/out so consecutive
  // cuts do not all drift the same way. The slide pan was killed for EYE
  // STRAIN — that was a 6px/s whole-frame drift for the full slide; this is a
  // slow push inside a <=3s window, and it ships dark until DrJ judges it on
  // the sample, exactly as the motion flag was reserved for.
  const Z = 0.04;
  const segFrames = Math.max(1, Math.round(secsEach * fps));
  const cover = (i) =>
    `[${i}:v]scale=${VERTICAL.canvas.w}:${VERTICAL.canvas.h}:force_original_aspect_ratio=increase:force_divisible_by=2,` +
    `crop=${VERTICAL.canvas.w}:${VERTICAL.canvas.h},setsar=1,fps=${fps}`;
  const push = (i) => {
    const inward = i % 2 === 0;
    const z0 = inward ? 1 : 1 + Z, z1 = inward ? 1 + Z : 1;
    return `,scale=${VERTICAL.canvas.w * 2}:${VERTICAL.canvas.h * 2},` +
      `zoompan=z='${z0.toFixed(3)}+${(z1 - z0).toFixed(3)}*on/${segFrames}':` +
      `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${VERTICAL.canvas.w}x${VERTICAL.canvas.h}:fps=${fps}`;
  };
  const chain = frames.map((_, i) => `${cover(i)}${motion ? push(i) : ""}[v${i}]`).join(";");
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
 * ─── THE LOCATOR MAP ────────────────────────────────────────────────────────
 *
 * "A flat coloured shape with no names is not a map" (DrJ, 2026-09-17), and the
 * previous one was exactly that: the highlighted countries as a single lime
 * blob on black, no land, no water, no borders between them, and no names
 * except the exception callout. A viewer who did not already know the geography
 * learned nothing from it.
 *
 * WHAT WAS ACTUALLY WRONG, measured rather than eyeballed:
 *
 *   THE BOUNDING BOX USED EVERY RING. `centroidOf` already knew to take a
 *   country's LARGEST ring — the mainland, not an outlying islet — but the
 *   extent did not. So for {GBR, FRA, NLD} the frame spanned 124° of longitude
 *   (Guadeloupe at −61.8° to Réunion at +55.8°, plus the Caribbean Netherlands
 *   at −68.4°) to show a story that spans 16° of Europe. A 7.75x over-scale,
 *   which is the whole reason the map rendered as a speck. Overseas territories
 *   are still DRAWN — they are really there — they just no longer get a vote on
 *   where the camera points.
 *
 * WHAT A MAP NEEDS TO BE ONE:
 *
 *   LAND VS WATER. Water is the house ground, unchanged — the near-black is not
 *   negotiable. Land is every country in view drawn in a low, on-palette tone,
 *   so a coastline exists at all. This needs NO new data: the atlas already
 *   carries all 242 countries, and the previous code simply filtered them away.
 *   Borders are hairlines in the ground colour, so the countries separate
 *   without the map turning into a wireframe.
 *
 *   NAMES. Subjects are labelled in white; the neighbours a viewer orients by
 *   are labelled in the RECEDED token, which is the palette's existing word for
 *   "present, legible, obviously not the subject" (videoSlideChrome).
 *
 *   CITIES, when the spec names one — marker and label, from Natural Earth's
 *   1:50m populated places, committed beside the atlas exactly as the atlas is.
 *   No runtime fetch: a map that needs the network is a map that fails at
 *   :12 on a morning when it did not before.
 *
 * ── THE MAP MUST NOT ASSERT MORE THAN THE CAPTION ──────────────────────────
 *
 * The standing rule, kept and now enforced in a second place: sub-national
 * geography FALLS BACK rather than lighting a whole country. A city is not its
 * country. So when the spec names a city, the city is marked and ITS COUNTRY IS
 * NOT FILLED — it stays a neighbour. Filling France because something happened
 * in Marseille is the map claiming a national story the caption never made, and
 * it is the same class of error as the tariffs photograph.
 *
 * ── LABELS ─────────────────────────────────────────────────────────────────
 *
 * Every label is placed inside marginX and the vertical safe margins, and a
 * label that collides with one already placed is dropped rather than drawn over
 * it. Dropping is deliberate: two overlapping names are less readable than one
 * name, and the subject labels are placed first so they are never the ones lost.
 */

const LAND        = "#1b1813";   // land in the water; a step off the ground, not a colour
const LAND_EDGE   = "#090706";   // COLORS.base — borders read as gaps between land masses
const SUBJECT     = COLORS.lime;
const EXCEPT_FILL = "#2a2721";   // COLORS.rule — the excepted member, present but not lit

/** Bounding box of a feature's MAINLAND only — see the note above. */
function mainlandExtent(f) {
  const rings = ringsOf(f);
  if (!rings.length) return null;
  const biggest = rings.reduce((a, b) => (b.length > a.length ? b : a), rings[0]);
  let minL = 180, maxL = -180, minP = 90, maxP = -90;
  for (const [lon, lat] of biggest) {
    if (lon < minL) minL = lon; if (lon > maxL) maxL = lon;
    if (lat < minP) minP = lat; if (lat > maxP) maxP = lat;
  }
  return { minL, maxL, minP, maxP };
}

let _cities = null;
function cities() {
  if (_cities) return _cities;
  if (!existsSync(CITIES_PATH)) throw new Error(`videoSubjectVisual: missing ${CITIES_PATH}`);
  _cities = JSON.parse(readFileSync(CITIES_PATH, "utf8")).places || [];
  return _cities;
}

/**
 * Resolve a spec's city name to a place. Case- and accent-insensitive, and
 * scoped to `withinCodes` when the spec also named countries, so "Cambridge"
 * in a UK story cannot silently resolve to Massachusetts. Ties go to the
 * larger place, which is what a reader means by a bare city name.
 */
export function findCity(name, withinCodes = null) {
  const want = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (!want) return null;
  const scope = withinCodes?.length ? new Set(withinCodes.map((c) => String(c).toUpperCase())) : null;
  const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hits = cities().filter((c) => norm(c.n) === want && (!scope || scope.has(c.c)));
  if (!hits.length) return null;
  return hits.reduce((a, b) => (b.p > a.p ? b : a));
}

/** Is this a city the atlas can place? Used by the spec schema, like knownCountry. */
export function knownCity(name, withinCodes = null) {
  return Boolean(findCity(name, withinCodes));
}

/**
 * A locator map. No stock, no rights, no tracing.
 *
 * @param codes      ISO3 countries the story is ABOUT — filled, labelled white.
 * @param exception  the ONE member of `codes` the story excludes.
 * @param city       a place name inside `codes`; marking it SUPPRESSES the
 *                   country fill, because a city is not its country.
 */
export function buildLocatorMap({
  codes, exception = null, city = null,
  w = VERTICAL.canvas.w, h = VERTICAL.canvas.h, pad = 140,
  safeTop = VERTICAL.safeTop, safeBottom = VERTICAL.safeBottom, marginX = VERTICAL.marginX,
}) {
  const want = new Set((codes || []).map(c => String(c).toUpperCase()));
  const feats = geo().features.filter(f => want.has(f.id));
  if (!feats.length) return null;

  const place = city ? findCity(city, [...want]) : null;
  if (city && !place) {
    logger.warn(`🎬 subject visual: "${city}" is not in the populated-places atlas — map falls back to the country`);
  }

  // ── the camera: mainlands of the subjects, plus the city if there is one ──
  let minL = 180, maxL = -180, minP = 90, maxP = -90;
  for (const f of feats) {
    const e = mainlandExtent(f);
    if (!e) continue;
    if (e.minL < minL) minL = e.minL; if (e.maxL > maxL) maxL = e.maxL;
    if (e.minP < minP) minP = e.minP; if (e.maxP > maxP) maxP = e.maxP;
  }
  if (place) {
    const [clon, clat] = place.o;
    if (clon < minL) minL = clon; if (clon > maxL) maxL = clon;
    if (clat < minP) minP = clat; if (clat > maxP) maxP = clat;
  }
  if (minL > maxL || minP > maxP) return null;

  // Breathing room around the subject, so neighbours are visible around it and
  // a single small country is not rendered as a dot in the middle of nothing.
  const padLon = Math.max(2.2, (maxL - minL) * 0.34);
  const padLat = Math.max(1.6, (maxP - minP) * 0.34);
  minL -= padLon; maxL += padLon; minP -= padLat; maxP += padLat;

  // Equirectangular, longitude flattened at the mid-latitude. Good enough for a
  // diagram of WHICH countries; this is not a navigational chart.
  const kx = Math.cos(((minP + maxP) / 2) * Math.PI / 180);
  const spanX = Math.max(1e-6, (maxL - minL) * kx), spanY = Math.max(1e-6, maxP - minP);
  // The drawable band: inside marginX horizontally and the safe margins
  // vertically, so nothing lands under platform furniture.
  const boxW = w - marginX * 2, boxH = h - safeTop - safeBottom;
  const scale = Math.min(boxW / spanX, boxH / spanY);
  const offX = marginX + (boxW - spanX * scale) / 2;
  const offY = safeTop + (boxH - spanY * scale) / 2;
  const proj = ([lon, lat]) => [offX + (lon - minL) * kx * scale, offY + (maxP - lat) * scale];
  const d = (f) => ringsOf(f).map(ring =>
    "M" + ring.map(proj).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z").join("");

  // ── what is in frame at all: the land layer ─────────────────────────────
  const inView = geo().features.filter((f) => {
    for (const ring of ringsOf(f)) {
      for (const [lon, lat] of ring) {
        if (lon >= minL && lon <= maxL && lat >= minP && lat <= maxP) return true;
      }
    }
    return false;
  });

  const ex = exception ? String(exception).toUpperCase() : null;
  // A named city suppresses the fill — the map may not claim the whole country.
  const fillSubjects = !place;

  const layers = [];
  // Land first, every country in view, so water is the ground showing through.
  layers.push(inView.map(f =>
    `<path d="${d(f)}" fill="${LAND}" stroke="${LAND_EDGE}" stroke-width="1.1"/>`).join("\n"));
  // Then the subjects on top of it.
  if (fillSubjects) {
    layers.push(feats.map(f =>
      `<path d="${d(f)}" fill="${f.id === ex ? EXCEPT_FILL : SUBJECT}" stroke="${LAND_EDGE}" stroke-width="1.2"/>`
    ).join("\n"));
  }

  // ── labels ───────────────────────────────────────────────────────────────
  //
  // Placed subjects-first, then neighbours, then the city, and anything that
  // collides with something already placed is DROPPED. Boxes are estimated from
  // the glyph budget rather than measured: satori is not in this path (resvg
  // rasterises the SVG directly), and an estimate that errs wide simply drops a
  // marginal label, which is the safe direction.
  const placed = [];
  const fits = (x, y, wid, hgt) => {
    if (x < marginX || x + wid > w - marginX) return false;
    if (y - hgt < safeTop || y > h - safeBottom) return false;
    for (const b of placed) {
      if (x < b.x + b.w + 10 && x + wid + 10 > b.x && y - hgt < b.y + 8 && y + 8 > b.y - b.h) return false;
    }
    return true;
  };
  const labels = [];
  const addLabel = (text, [px, py], { size, colour, weight = 700, spacing = 3, anchor = "middle", dy = 0 }) => {
    const wid = String(text).length * size * 0.62 + (String(text).length - 1) * spacing;
    const hgt = size * 1.1;
    const x = anchor === "middle" ? px - wid / 2 : px;
    const y = py + dy;
    if (!fits(x, y, wid, hgt)) return false;
    placed.push({ x, y, w: wid, h: hgt });
    labels.push(
      `<text x="${px.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" ` +
      `font-family="Inter" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}" ` +
      `fill="${colour}">${escapeXml(String(text).toUpperCase())}</text>`);
    return true;
  };

  const nameOf = (f) => String(f.properties?.name || f.id);
  // Subjects: white, and skipped for the excepted one (its callout names it).
  for (const f of feats) {
    if (f.id === ex) continue;
    const c = centroidOf(f);
    if (c) addLabel(nameOf(f), proj(c), { size: 30, colour: COLORS.white, spacing: 3 });
  }
  // Neighbours: the receded token — present, legible, obviously not the subject.
  for (const f of inView) {
    if (want.has(f.id)) continue;
    const e = mainlandExtent(f);
    // Only label a country with real presence in frame; a sliver of coastline
    // carrying a name is noise, not orientation.
    if (!e) continue;
    const [x0, y0] = proj([e.minL, e.maxP]), [x1, y1] = proj([e.maxL, e.minP]);
    if (Math.abs(x1 - x0) < 90 || Math.abs(y1 - y0) < 50) continue;
    const c = centroidOf(f);
    if (c) addLabel(nameOf(f), proj(c), { size: 24, colour: COLORS.recededText, spacing: 2, weight: 600 });
  }

  // ── the city ─────────────────────────────────────────────────────────────
  let cityMark = "";
  if (place) {
    const [cx, cy] = proj(place.o);
    cityMark =
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="11" fill="${SUBJECT}" stroke="${LAND_EDGE}" stroke-width="2.5"/>`;
    // Below the marker if there is room, else above — a city label is the one
    // the map is actually about, so it gets two chances before being dropped.
    const ok = addLabel(place.n, [cx, cy + 46], { size: 32, colour: COLORS.white, spacing: 3 });
    if (!ok) addLabel(place.n, [cx, cy - 26], { size: 32, colour: COLORS.white, spacing: 3 });
  }

  // ── the exception callout, unchanged in intent ───────────────────────────
  //
  // THE EXCEPTION IS ANNOTATED, NOT MERELY COLOURED (DrJ, 2026-08-15). Eswatini
  // is about two pixels wide at this scale, and "all but one" is unreadable if
  // the one cannot be found: the map showed the set correctly and lost the
  // story. Placed from the country's own centroid, so it generalises.
  let callout = "";
  const exFeat = ex ? feats.find(f => f.id === ex) : null;
  if (exFeat) {
    const c = centroidOf(exFeat);
    if (c) {
      const [px, py] = proj(c);
      const right = px < w * 0.62;
      const lx = right ? px + 26 : px - 26, tx = right ? px + 176 : px - 176;
      const anchor = right ? "start" : "end";
      const label = String(exFeat.properties?.name || ex).toUpperCase();
      // The callout's own text is kept inside the margins too.
      const tipX = Math.min(Math.max(tx, marginX), w - marginX);
      callout =
        `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="13" fill="${COLORS.white}"/>` +
        `<line x1="${lx.toFixed(1)}" y1="${py.toFixed(1)}" x2="${tipX.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${COLORS.white}" stroke-width="2"/>` +
        `<text x="${(tipX + (right ? 12 : -12)).toFixed(1)}" y="${(py - 6).toFixed(1)}" text-anchor="${anchor}" ` +
        `font-family="Inter" font-size="30" font-weight="700" letter-spacing="3" fill="${COLORS.white}">${escapeXml(label)}</text>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${layers.join("\n")}
${cityMark}
${labels.join("\n")}
${callout}
</svg>`;
}

/** SVG is XML: a country or city name carrying & or < must not break the document. */
function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

/** Rasterise a locator map onto the ground. Returns the path, or null. */
export function buildMapPng({ codes, exception, city = null, out, work }) {
  const svg = buildLocatorMap({ codes, exception, city });
  if (!svg) { logger.warn(`🎬 subject visual: no known countries in [${(codes || []).join(", ")}]`); return null; }
  mkdirSync(work, { recursive: true });
  writeFileSync(out, new Resvg(svg, { background: COLORS.base, fitTo: { mode: "original" } }).render().asPng());
  return out;
}
