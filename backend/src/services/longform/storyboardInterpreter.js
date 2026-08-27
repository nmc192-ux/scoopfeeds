/**
 * storyboardInterpreter.js — validated JSON → the shape build.mjs consumes (#77).
 *
 * THIS FILE IS NEVER GENERATED. It is the whole point of the design: a model
 * emits data, and a fixed, human-written interpreter does every imperative
 * thing the old hand-authored `storyboard.mjs` modules did inline — resolving
 * `rects.json`, assigning grades, expanding shared source constants, building
 * doc descriptors, wiring statement records. Nothing model-written executes.
 *
 * The output is deliberately identical in shape to what `import`ing a
 * storyboard module yields, so `build.mjs`, `shorts.mjs` and `music.mjs` need
 * no changes at all:
 *
 *   { STORYBOARD, FOOTAGE, PHOTOS, DOCS, GRADES, TITLE_SEGMENT, INSERTS,
 *     SHORTS, REVEAL, BEAT_COUNT }
 *
 * The golden test (storyboardInterpreter.test.js) holds this to the real
 * 73-beat hormuz-strait film: the JSON representation must reproduce what the
 * authored module produces, or the representation is not expressive enough and
 * we learn it before anything depends on it.
 */

import { existsSync, readFileSync } from "fs";
import path from "path";
import { validateStoryboard } from "./longformStoryboardSchema.js";

/**
 * Grades are ENGINE behaviour, not per-film judgement — the same four the
 * shipped storyboards define, kept here so every film gets the palette right
 * without an author restating ffmpeg filter strings.
 */
export const GRADES = Object.freeze({
  default:
    "eq=saturation=0.42:contrast=1.14:brightness=-0.10:gamma=0.94," +
    "colorbalance=rs=-0.06:gs=0.02:bs=-0.08:rm=-0.03:gm=0.03:bm=-0.06,vignette=PI/4.2",
  people:
    "eq=saturation=0.62:contrast=1.10:brightness=-0.07:gamma=0.96," +
    "colorbalance=rs=-0.03:gs=0.02:bs=-0.05:rm=-0.02:gm=0.02:bm=-0.04,vignette=PI/4.6",
  marine:
    "eq=saturation=0.30:contrast=1.22:brightness=-0.12:gamma=0.92," +
    "colorbalance=rs=-0.08:gs=0.00:bs=0.04:rm=-0.04:gm=0.01:bm=0.03,vignette=PI/3.9",
  warm:
    "eq=saturation=0.38:contrast=1.28:brightness=-0.14:gamma=0.88," +
    "colorbalance=rs=0.03:gs=0.04:bs=-0.10:rm=0.04:gm=0.03:bm=-0.09,vignette=PI/3.6",
});

/**
 * Interpret a validated storyboard document.
 *
 * @param {object} doc      the JSON storyboard (see longformStoryboardSchema)
 * @param {object} opts
 * @param {(...a:string[]) => string} opts.P   project path helper
 * @param {(id:string) => object} [opts.loadStatement]  evidence archive reader
 * @param {boolean} [opts.strict=true]  validate first and throw on problems
 */
export function interpretStoryboard(doc, { P, loadStatement = null, strict = true } = {}) {
  if (!P) throw new Error("interpretStoryboard: P (project path helper) required");
  if (strict) {
    const errs = validateStoryboard(doc);
    if (errs.length) {
      throw new Error(`interpretStoryboard: invalid storyboard:\n  ${errs.join("\n  ")}`);
    }
  }

  // ── docs: rects.json is read ONCE, not per beat ───────────────────────────
  // capture-measured.mjs emits per-line DOM Range rectangles for the exact
  // highlighted phrase. A doc card whose key has no rects renders as a plain
  // screenshot rather than throwing — the film is still correct, just without
  // the sweep — but the ABSENCE is reported, because silently losing the
  // highlight is what the measured-rects design exists to prevent.
  const rectsPath = P("out/docs/rects.json");
  const RECTS = existsSync(rectsPath) ? JSON.parse(readFileSync(rectsPath, "utf8")) : {};
  const missingRects = [];

  const DOCS = {};
  for (const [key, d] of Object.entries(doc.docs || {})) {
    const r = RECTS[key];
    if (!r) missingRects.push(key);
    DOCS[key] = {
      card: "doc",
      image: P(`out/docs/${d.file || `${key}.png`}`),
      imgW: r?.w ?? d.imgW ?? 0,
      imgH: r?.h ?? d.imgH ?? 0,
      rects: r?.rects ?? [],
      eyebrow: d.eyebrow,
      src: d.src,
    };
  }

  // ── footage: keys → files, with grades applied by declaration ─────────────
  const FOOTAGE = {};
  for (const [beat, f] of Object.entries(doc.footage || {})) {
    FOOTAGE[Number(beat)] = {
      file: f.file,
      in: f.in ?? 1,
      ...(f.grade ? { grade: f.grade } : {}),
      ...(f.crop ? { crop: f.crop } : {}),
    };
  }
  // A beat's `footage: KEY` names the same key the footage table's `file`
  // would — the table only adds refinements (in-point, grade, crop). Models
  // emit the beat and skip the table, which is schema-legal and rendered as
  // an ffmpeg command with an EMPTY input path (build.mjs reads only the
  // table). Deriving the default entry is mechanical: key = file, in = 1,
  // the same default the explicit path takes.
  for (const [beat, b] of Object.entries(doc.beats || {})) {
    const n = Number(beat);
    if (b?.footage && !FOOTAGE[n]) FOOTAGE[n] = { file: b.footage, in: 1 };
  }

  const PHOTOS = { ...(doc.photos || {}) };

  // ── beats ─────────────────────────────────────────────────────────────────
  // Shared source strings are expanded here so a film states each citation
  // once. `src: "$SRC_IMO"` in the data becomes the full attribution line.
  const SOURCES = doc.sources || {};
  const expand = (v) =>
    typeof v === "string" && v.startsWith("$") ? (SOURCES[v.slice(1)] ?? v) : v;

  const STORYBOARD = {};
  for (const [id, b] of Object.entries(doc.beats)) {
    const n = Number(id);
    if (b.footage) { STORYBOARD[n] = { footage: b.footage }; continue; }
    if (b.photo) {
      STORYBOARD[n] = { photo: b.photo, ...(b.ken ? { ken: b.ken } : {}),
                        ...(b.parallax ? { parallax: b.parallax } : {}) };
      continue;
    }
    if (b.card === "doc") { STORYBOARD[n] = { doc: b.docKey }; continue; }

    const out = { ...b };
    if (out.src !== undefined) out.src = expand(out.src);
    if (out.note !== undefined) out.note = expand(out.note);

    // House style writes chapter numerals as "01"; models emit n: 1. Satori
    // additionally refuses a NUMERIC text child outright, so the coercion is
    // correctness, the padding is style.
    if (b.card === "chapter" && typeof out.n === "number") {
      out.n = String(out.n).padStart(2, "0");
    }

    // A tweet card carries the ARCHIVED RECORD, never free text — the card
    // itself re-checks the words against the archive on every frame.
    if (b.card === "tweet") {
      if (!loadStatement) {
        throw new Error(`beat ${n}: a tweet card needs loadStatement to resolve "${b.statementId}"`);
      }
      out.statement = loadStatement(String(b.statementId));
      delete out.statementId;
    }
    STORYBOARD[n] = out;
  }

  const beatIds = Object.keys(STORYBOARD).map(Number).sort((a, b) => a - b);

  return {
    STORYBOARD,
    FOOTAGE,
    PHOTOS,
    DOCS,
    GRADES,
    INSERTS: doc.inserts || {},
    SHORTS: doc.shorts || [],
    TITLE_SEGMENT: doc.titleSegment || null,
    REVEAL: doc.reveal ?? null,
    BEAT_COUNT: beatIds.length,
    // Diagnostics the caller may surface; never thrown, never silent.
    warnings: missingRects.length
      ? [`doc rects missing for: ${missingRects.join(", ")} — those cards render without a highlight sweep`]
      : [],
  };
}

/**
 * Round-trip an AUTHORED storyboard module into the JSON representation.
 *
 * Used by the golden test to prove the representation is expressive enough for
 * a real film, and available as a migration aid. Deliberately lossy in one
 * direction only: it reads the data an authored module exports, it does not
 * try to recover the imperative helpers — those are the interpreter's job.
 */
export function moduleToDoc(mod) {
  const beats = {};
  for (const [id, v] of Object.entries(mod.STORYBOARD || {})) {
    if (v.footage) { beats[id] = { footage: v.footage }; continue; }
    if (v.photo) { beats[id] = { photo: v.photo, ...(v.ken ? { ken: v.ken } : {}) }; continue; }
    if (v.doc) { beats[id] = { card: "doc", docKey: v.doc }; continue; }
    beats[id] = { ...v };
  }
  const footage = {};
  for (const [beat, f] of Object.entries(mod.FOOTAGE || {})) {
    footage[beat] = { file: f.file, in: f.in, ...(f.grade ? { grade: f.grade } : {}),
                      ...(f.crop ? { crop: f.crop } : {}) };
  }
  return {
    beats,
    footage,
    photos: { ...(mod.PHOTOS || {}) },
    // DOCS keys must survive even when their VALUES are null: mkDoc returns
    // null until capture-measured has produced rects.json, and the beats still
    // reference the keys. Dropping them made every doc beat look dangling.
    docs: Object.fromEntries(Object.keys(mod.DOCS || {}).map((k) => [k, (mod.DOCS || {})[k] || {}])),
    inserts: mod.INSERTS || {},
    shorts: mod.SHORTS || [],
    titleSegment: mod.TITLE_SEGMENT || null,
    ...(mod.REVEAL != null ? { reveal: mod.REVEAL } : {}),
  };
}
