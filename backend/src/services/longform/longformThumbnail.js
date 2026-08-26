/**
 * longformThumbnail.js — the thumbnail, generalised (#78).
 *
 * The last stage `produceLongformFilm` listed as having no implementation.
 *
 * Generalised from `projects/bundibugyo/thumb.mjs`, which was authored per
 * film and carried two defects worth naming: a stale case count that shipped
 * into a scheduled upload, and two absolute paths to one developer's home
 * directory — the same regression class the engine relocation removed
 * everywhere else.
 *
 * THE RULES ARE REFUSALS, NOT ADVICE. `references/house-style.md` §Thumbnail
 * is specific, and every rule in it is here as a check that fails:
 *
 *   1280x720, under 2 MB          — YouTube rejects a larger file outright.
 *   Two lines of Anton MAXIMUM,   — "More does not survive the downscale."
 *     plus one lime line            A thumbnail is judged at ~168px wide.
 *   A smooth scrim ramp           — "a stepped one bands visibly".
 *
 * The banding fix is structural and must not be simplified: the type layer is
 * rendered ONCE at final size as transparent RGBA and overlaid 1:1. NOTHING IS
 * SCALED AFTER COMPOSITING — scaling a semi-transparent layer is what produced
 * the vertical stripes the original script was rewritten to avoid.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync, statSync, existsSync } from "fs";
import path from "path";

const execFileP = promisify(execFile);

export const W = 1280, H = 720;
export const MAX_BYTES = 2 * 1024 * 1024;
/** The size a thumbnail is actually chosen at. */
export const REVIEW_WIDTH = 168;
export const MAX_HEADLINE_LINES = 2;

const C = { lime: "#dde706", white: "#f5f2ea", dim: "#a9a396" };

/**
 * Check a spec against the house rules. Returns problems, empty when valid.
 * Pure, so the rules are testable without rendering anything.
 */
export function validateThumbSpec(spec = {}) {
  const errs = [];
  const lines = spec.lines || [];
  if (!lines.length) errs.push("no headline lines — a thumbnail with no type is an empty frame");
  if (lines.length > MAX_HEADLINE_LINES) {
    errs.push(`${lines.length} headline lines (max ${MAX_HEADLINE_LINES}) — more does not survive the downscale to ${REVIEW_WIDTH}px`);
  }
  for (const [i, l] of lines.entries()) {
    if (typeof l !== "string" || !l.trim()) errs.push(`lines[${i}] is empty`);
    else if (l.length > 22) errs.push(`lines[${i}] is ${l.length} chars — long lines shrink below legibility at ${REVIEW_WIDTH}px`);
  }
  if (spec.accent !== undefined) {
    if (typeof spec.accent !== "string" || !spec.accent.trim()) errs.push("accent line is empty");
    else if (spec.accent.length > 24) errs.push(`accent is ${spec.accent.length} chars — too long for the lime line`);
  }
  if (!spec.plateFrom) errs.push("no plateFrom — the thumbnail needs a source frame from the film's own footage");
  // THE PLATE COMES FROM FOOTAGE, NOT FROM THE FILM. A card-based film's own
  // frames are type on a dark ground, so a plate taken from one puts text
  // under text — the headline survives the downscale and the ghost does not,
  // which looks like a rendering fault rather than a choice. Caught in
  // testing by doing exactly this.
  if (spec.plateFrom && spec.film && path.resolve(spec.plateFrom) === path.resolve(spec.film)) {
    errs.push("plateFrom is the film itself — take the plate from footage, or the headline sits over the film's own card type");
  }
  return errs;
}

/**
 * Render the thumbnail.
 *
 * @returns {Promise<{file, review, bytes, width, height}>}
 * @throws  a NAMED error on any house-rule violation or size overrun — a
 *          thumbnail that breaks the standard should stop the film, not ship
 *          quietly and be discovered at 168px by a viewer who scrolls past.
 */
export async function renderThumbnail({
  spec, outDir, ffmpegPath, fontsDir, satori, Resvg,
} = {}) {
  for (const [name, v] of [["outDir", outDir], ["ffmpegPath", ffmpegPath],
                           ["fontsDir", fontsDir], ["satori", satori], ["Resvg", Resvg]]) {
    if (!v) throw new Error(`renderThumbnail: ${name} is required`);
  }
  const errs = validateThumbSpec(spec);
  if (errs.length) throw new Error(`thumbnail spec violates house-style.md:\n  ${errs.join("\n  ")}`);
  if (!existsSync(spec.plateFrom)) {
    throw new Error(`thumbnail: source frame not found at ${spec.plateFrom}`);
  }

  const ff = (args) => execFileP(ffmpegPath, ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", ...args]);
  const plate = path.join(outDir, "_thumbplate.png");
  const type = path.join(outDir, "_thumbtype.png");
  const file = path.join(outDir, "THUMB.png");
  const review = path.join(outDir, `THUMB_${REVIEW_WIDTH}.png`);

  // 1 — THE PLATE: a still from the film's own footage, graded to match, with a
  //     SMOOTH left-to-right darkening ramp so type sits on ground, not detail.
  //     Computed per-pixel on the frame BEFORE any overlay; a stepped ramp
  //     bands visibly.
  const x0 = Math.round(W * 0.32), span = Math.round(W * 0.30);
  const ramp = (ch) => `${ch}(X,Y)*(0.20+0.80*min(1,max(0,(X-${x0})/${span})))`;
  await ff([
    ...(spec.plateAt ? ["-ss", String(spec.plateAt)] : []),
    "-i", spec.plateFrom, "-frames:v", "1",
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},`
         + `eq=saturation=0.42:contrast=1.20:brightness=-0.14,`
         + `geq=r='${ramp("r")}':g='${ramp("g")}':b='${ramp("b")}'`,
    plate,
  ]);

  // 2 — THE TYPE, transparent, at FINAL SIZE. Never scaled afterwards.
  const fonts = [
    { name: "Anton", data: readFileSync(path.join(fontsDir, "Anton-Regular.ttf")), weight: 400, style: "normal" },
    { name: "Inter", data: readFileSync(path.join(fontsDir, "Inter-Bold.otf")), weight: 700, style: "normal" },
  ];
  const h = (t, style, children) => ({ type: t, props: { style, children } });
  const svg = await satori(
    h("div", {
      display: "flex", flexDirection: "column", justifyContent: "center",
      width: W, height: H, paddingLeft: 58, paddingRight: 520,
    }, [
      ...spec.lines.map((t) =>
        h("div", { fontFamily: "Anton", fontSize: 106, color: C.white, lineHeight: 1.02 }, t)),
      ...(spec.accent ? [
        h("div", { width: 300, height: 10, backgroundColor: C.lime, marginTop: 30, marginBottom: 30 }, ""),
        h("div", { fontFamily: "Anton", fontSize: 76, color: C.lime, lineHeight: 1.02 }, spec.accent),
      ] : []),
      ...(spec.sub ? [
        h("div", { fontFamily: "Inter", fontWeight: 700, fontSize: 33, color: C.dim, marginTop: 36 }, spec.sub),
      ] : []),
    ]),
    { width: W, height: H, fonts });
  writeFileSync(type, new Resvg(svg,
    { background: "rgba(0,0,0,0)", fitTo: { mode: "width", value: W } }).render().asPng());

  // 3 — ONE 1:1 overlay. Nothing is scaled after this point.
  await ff(["-i", plate, "-i", type, "-filter_complex", "[0][1]overlay=0:0:format=auto",
            "-frames:v", "1", file]);
  // The review copy is a SEPARATE downscale of the finished image, never a
  // step in producing it.
  await ff(["-i", file, "-vf", `scale=${REVIEW_WIDTH}:-2`, review]);

  const bytes = statSync(file).size;
  if (bytes > MAX_BYTES) {
    throw new Error(
      `thumbnail is ${(bytes / 1048576).toFixed(2)} MB, over YouTube's 2 MB limit — ` +
      `the upload would be rejected outright`);
  }
  return { file, review, bytes, width: W, height: H };
}

/**
 * The `makeThumbnail` stage produceLongformFilm expects.
 *
 * The headline comes from the STORY SPINE's question, not from the film's
 * title: the title is what the video is called, the question is what makes
 * someone click. Falls back to the title when no question is available rather
 * than inventing one.
 */
export function makeThumbnailStage({ outDir, ffmpegPath, fontsDir, satori, Resvg, plateFrom, plateAt }) {
  return async ({ slug, title, spine, sub }) => {
    const source = String(spine?.question || title || "").toUpperCase().replace(/[^\w\s—-]/g, "").trim();
    const words = source.split(/\s+/).filter(Boolean);
    // Two lines, split near the middle so neither is a stub.
    const mid = Math.ceil(words.length / 2);
    const lines = words.length > 3
      ? [words.slice(0, mid).join(" "), words.slice(mid).join(" ")]
      : [source];
    return renderThumbnail({
      spec: { lines: lines.filter(Boolean).slice(0, MAX_HEADLINE_LINES), sub, plateFrom, plateAt },
      outDir, ffmpegPath, fontsDir, satori, Resvg,
    });
  };
}
