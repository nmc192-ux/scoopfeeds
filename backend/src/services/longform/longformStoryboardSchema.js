/**
 * longformStoryboardSchema.js — the storyboard as DATA, validated (#77).
 *
 * WHY THIS EXISTS. A storyboard was an authored ES module: ~320-480 lines of
 * JavaScript that the render engine imports and executes. Automating long-form
 * production naively therefore means a model writing executable code that runs
 * on the production worker every cycle — the sharpest risk in the whole
 * programme, and an avoidable one.
 *
 * Inspection of the shipped storyboards showed they are already almost pure
 * data: `STORYBOARD` is a keyed object of declarative beat descriptors
 * (`{ card: "statement", lines: [...] }`, `{ footage: "F_TANKER_SEA" }`). Only
 * the plumbing around it is imperative. So: the model emits JSON against this
 * schema, `storyboardInterpreter.js` (a fixed, human-written file) turns it
 * into the shape `build.mjs` already consumes, and NO GENERATED CODE IS EVER
 * EXECUTED.
 *
 * REJECT, NEVER REPAIR. Every problem is returned naming the beat and the
 * field. Silently coercing a bad storyboard is how a film ships with a card
 * that renders `undefined`, and on an unattended run nobody sees it.
 *
 * The required-field lists below are DERIVED, not guessed: a field is required
 * when `render.mjs` dereferences it without a guard or a default. Optional
 * fields are the ones the renderer wraps in `...(x ? [...] : [])` or defaults.
 * Cross-checked against the 70 card beats of the shipped hormuz-strait film.
 */

/** Card types the renderer actually exports. Anything else is a typo. */
import { validateGeo } from "./engine/mapGeo.mjs";

export const CARD_TYPES = Object.freeze([
  "title", "chapter", "stat", "bars", "outro", "quote", "tweet", "map",
  "linechart", "multiline", "equation", "doc", "dotgrid", "pipeline",
  "statement", "ledger",
]);

/**
 * Per-card contract. `req` = dereferenced unguarded by the renderer.
 * `opt` = guarded or defaulted. Anything not listed is rejected, so a typo'd
 * field name cannot pass silently as "extra data the renderer will ignore".
 */
export const CARD_SPECS = Object.freeze({
  title:     { req: ["lines"],                                  opt: ["kicker", "sub"] },
  chapter:   { req: ["n", "name"],                              opt: [] },
  stat:      { req: ["figure", "label"],                        opt: ["kicker", "unit", "src", "roll"] },
  bars:      { req: ["items"],                                  opt: ["kicker", "title", "src"] },
  outro:     { req: [],                                         opt: [] },
  quote:     { req: ["text", "who", "role"],                    opt: [] },
  tweet:     { req: ["statementId"],                            opt: ["text", "sinceDeleted"] },
  map:       { req: [],                                         opt: ["kicker", "title", "variant", "geo", "note", "src", "pin"] },
  linechart: { req: ["points"],                                 opt: ["kicker", "title", "yMin", "yMax", "yPrefix", "ySuffix", "note", "src"] },
  multiline: { req: ["series"],                                 opt: ["kicker", "title", "xMax", "yMax", "xLabel", "yTicks", "note", "src"] },
  equation:  { req: ["numerator", "denominator", "result"],     opt: ["kicker", "note", "flipped", "wipe"] },
  doc:       { req: ["docKey"],                                 opt: ["eyebrow", "src"] },
  dotgrid:   { req: ["label"],                                  opt: ["kicker", "title", "total", "out", "src"] },
  pipeline:  { req: ["stages"],                                 opt: ["kicker", "title", "broken", "note", "src", "map"] },
  statement: { req: ["lines"],                                  opt: ["kicker", "src"] },
  ledger:    { req: ["rows"],                                   opt: ["kicker", "title", "src"] },
});

/** The widest beat range a short may cut. See the shorts check below. */
export const MAX_SHORT_BEATS = 10;
/**
 * The QC gate publishes nothing with fewer (longformQcGate GATES.minShorts).
 * Enforced by the WRITER, not validateStoryboard: hand-authored films keep
 * their cuts in shorts.json and validate storyboards with none.
 */
export const MIN_SHORTS = 3;

/** Non-card beats: the imagery the film cuts to. */
export const MEDIA_KINDS = Object.freeze(["footage", "photo"]);

const isStr = (v) => typeof v === "string" && v.trim().length > 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isArr = (v) => Array.isArray(v) && v.length > 0;

/** Shape checks for the fields whose INTERNAL structure the renderer walks. */
const FIELD_SHAPE = {
  lines:  (v) => (isArr(v) && v.every(isStr)) || "must be a non-empty array of strings",
  // `what` may be EMPTY: a ledger is sometimes a bare list of names with no
  // annotation (the shipped film lists five crew nationalities that way), and
  // rejecting that would have forced authors to invent filler prose.
  // `hot` marks the row the payoff lands on.
  rows:   (v) => (isArr(v) && v.every((r) => isStr(r?.who) && typeof r?.what === "string"))
                 || 'must be a non-empty array of { who, what } (what may be "")',
  items:  (v) => (isArr(v) && v.every((i) => isStr(i?.label) && isNum(i?.value) && isStr(i?.display)))
                 || 'must be a non-empty array of { label, value:number, display }',
  points: (v) => (isArr(v) && v.every((d) => isNum(d?.v))) || "must be a non-empty array of { v:number }",
  series: (v) => (isArr(v)) || "must be a non-empty array",
  stages: (v) => (isArr(v) && v.every((s) => isStr(s?.name))) || "must be a non-empty array of { name }",
  n:      (v) => isStr(v) || isNum(v) || "must be a string or number",
  total:  (v) => isNum(v) || "must be a number",
  out:    (v) => isNum(v) || "must be a number",
};

/**
 * Validate a storyboard document.
 *
 * @param {object} doc
 *   {
 *     beats:    { "1": {...}, "2": {...} },   // keyed by beat number, contiguous from 1
 *     footage?: { "1": { file, in?, grade? } },
 *     photos?:  { KEY: "prompt or description" },
 *     docs?:    { KEY: {...} },
 *     shorts?:  [ { name, from, to, title, hook } ],
 *     reveal?:  <beat number>
 *   }
 * @param {object} [opts]
 * @param {Set<string>|string[]} [opts.statementIds] ids present in the evidence archive
 * @returns {string[]} problems, empty when valid
 */
export function validateStoryboard(doc, { statementIds = [], docKeys: capturedDocKeys = null, photoKeys: acquiredPhotoKeys = null } = {}) {
  const errs = [];
  const known = statementIds instanceof Set ? statementIds : new Set(statementIds);
  // null means "no doc-key roster supplied" (hand-authored films manage their
  // own out/docs). When a roster IS supplied, an unknown docKey is a beat the
  // interpreter would resolve to undefined and build.mjs would then crash on.
  const knownDocs = capturedDocKeys == null ? null
    : (capturedDocKeys instanceof Set ? capturedDocKeys : new Set(capturedDocKeys));
  const knownPhotos = acquiredPhotoKeys == null ? null
    : (acquiredPhotoKeys instanceof Set ? acquiredPhotoKeys : new Set(acquiredPhotoKeys));
  if (!doc || typeof doc !== "object") return ["storyboard: not an object"];
  if (!doc.beats || typeof doc.beats !== "object") return ["storyboard.beats: missing or not an object"];

  const ids = Object.keys(doc.beats).map(Number).sort((a, b) => a - b);
  if (!ids.length) return ["storyboard.beats: empty"];

  // CONTIGUITY. Beats are addressed by number from the SRT, the Shorts
  // definitions and the film's own comments; a gap silently shifts everything
  // downstream of it.
  if (ids[0] !== 1) errs.push(`beats must start at 1 (starts at ${ids[0]})`);
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] !== ids[i - 1] + 1) errs.push(`beats are not contiguous: ${ids[i - 1]} → ${ids[i]}`);
  }
  for (const k of Object.keys(doc.beats)) {
    if (!/^\d+$/.test(k)) errs.push(`beat key "${k}" is not a number`);
  }

  const photoKeys = new Set(Object.keys(doc.photos || {}));
  const docKeys = new Set(Object.keys(doc.docs || {}));
  const chapterBeats = new Set();

  for (const id of ids) {
    const b = doc.beats[String(id)];
    const at = `beat ${id}`;
    if (!b || typeof b !== "object") { errs.push(`${at}: not an object`); continue; }

    const kinds = [b.card && "card", ...MEDIA_KINDS.filter((k) => b[k])].filter(Boolean);
    if (kinds.length === 0) { errs.push(`${at}: is neither a card nor media (needs card, footage or photo)`); continue; }
    if (kinds.length > 1) { errs.push(`${at}: is both ${kinds.join(" and ")} — a beat is one thing`); continue; }

    // Like docs: the photos TABLE is acquisition-derived and merged after
    // validation, so an acquired key is known before its table row exists.
    if (b.photo && !photoKeys.has(b.photo) && !knownPhotos?.has(b.photo)) {
      errs.push(knownPhotos
        ? `${at}: photo ${JSON.stringify(b.photo)} is not an acquired photo (have: ${[...knownPhotos].join(", ") || "none"})`
        : `${at}: photo "${b.photo}" is not in storyboard.photos`);
    }
    if (b.photo && b.ken !== undefined && b.ken !== "in" && b.ken !== "out") {
      errs.push(`${at}: ken ${JSON.stringify(b.ken)} — the only moves are "in" and "out"`);
    }
    if (b.footage && !isStr(b.footage)) errs.push(`${at}: footage must be a key string`);

    if (!b.card) continue;
    if (b.card === "chapter") chapterBeats.add(id);

    const spec = CARD_SPECS[b.card];
    if (!spec) {
      errs.push(`${at}: unknown card type "${b.card}" (known: ${CARD_TYPES.join(", ")})`);
      continue;
    }
    for (const f of spec.req) {
      if (b[f] === undefined) errs.push(`${at} (${b.card}): missing required field "${f}"`);
    }
    if (b.card === "doc" && knownDocs && !knownDocs.has(b.docKey)) {
      errs.push(`${at} (doc): docKey ${JSON.stringify(b.docKey)} is not a captured document (have: ${[...knownDocs].join(", ") || "none"})`);
    }
        // A PRESENT geo must parse. The variant-or-geo rule below already forces
    // a map to name its geography, but a truthy geo of the wrong SHAPE
    // ("geo": "AU-NSW", a region code) satisfied it and died in geoSvg 45
    // segments into the build — validateGeo was written "so the storyboard
    // schema can call it long before a render is attempted", and nothing
    // here called it.
    if (b.card === "map" && b.geo !== undefined) {
      for (const e of validateGeo(b.geo)) errs.push(`${at} (map): geo ${e}`);
    }
    const allowed = new Set(["card", ...spec.req, ...spec.opt]);
    for (const f of Object.keys(b)) {
      if (!allowed.has(f)) {
        errs.push(`${at} (${b.card}): unknown field "${f}" — a typo'd field would otherwise pass as ignorable`);
      }
    }
    for (const [f, check] of Object.entries(FIELD_SHAPE)) {
      if (b[f] === undefined || !allowed.has(f)) continue;
      const verdict = check(b[f]);
      if (verdict !== true) errs.push(`${at} (${b.card}): "${f}" ${verdict}`);
    }
    // Media references that resolve to nothing.
    // A key on the captured roster is known even before its table row exists:
    // the docs TABLE (eyebrow, src) is capture-derived and merged in AFTER
    // validation, precisely so the model references keys without authoring
    // provenance rows.
    if (b.card === "doc" && b.docKey && !docKeys.has(b.docKey) && !knownDocs?.has(b.docKey)) {
      errs.push(`${at} (doc): docKey "${b.docKey}" is not in storyboard.docs`);
    }
    if (b.card === "tweet" && b.statementId && known.size && !known.has(String(b.statementId))) {
      errs.push(`${at} (tweet): statement "${b.statementId}" is not in the evidence archive — capture it first`);
    }
    // A map needs one of the two, never neither.
    if (b.card === "map" && b.variant === undefined && b.geo === undefined) {
      errs.push(`${at} (map): needs "variant" (registry) or "geo" (inline data)`);
    }
  }

  // SHORTS BOUNDARIES. The engine already rejects a Short that opens on a
  // chapter divider — it wastes the only second that matters. Catching it here
  // means the author learns before a render, not after one.
  for (const [i, s] of (doc.shorts || []).entries()) {
    const at = `shorts[${i}]${s?.name ? ` (${s.name})` : ""}`;
    // A short is a MOMENT, not a chapter. At the enforced beat granularity
    // (~14 words ≈ 5-6s a beat), ten beats is the whole 59s budget; the
    // first real storyboard cut 33-beat "shorts" that measured 150s+ and
    // failed the duration gate after the render was paid for.
    if (isNum(s?.from) && isNum(s?.to) && s.to - s.from + 1 > MAX_SHORT_BEATS) {
      errs.push(`${at}: spans ${s.to - s.from + 1} beats (max ${MAX_SHORT_BEATS}) — a short is a moment, not a chapter; at ~5-6s a beat this cannot fit the 59s Shorts budget`);
    }
    for (const f of ["name", "from", "to", "title", "hook"]) {
      if (s?.[f] === undefined) errs.push(`${at}: missing "${f}"`);
    }
    if (isNum(s?.from) && isNum(s?.to)) {
      if (s.to <= s.from) errs.push(`${at}: "to" (${s.to}) must be after "from" (${s.from})`);
      if (!ids.includes(s.from)) errs.push(`${at}: "from" beat ${s.from} does not exist`);
      if (!ids.includes(s.to)) errs.push(`${at}: "to" beat ${s.to} does not exist`);
      if (chapterBeats.has(s.from)) {
        errs.push(`${at}: opens on chapter divider beat ${s.from} — a Short must open on content`);
      }
    }
  }

  // The reveal names a real beat, so music.mjs cannot resolve it to undefined.
  if (doc.reveal !== undefined) {
    if (!isNum(doc.reveal) || !ids.includes(doc.reveal)) {
      errs.push(`storyboard.reveal: ${JSON.stringify(doc.reveal)} is not one of the film's beats`);
    }
  }

  return errs;
}

/**
 * The STORY SPINE's mechanical parts, checked against the beats.
 *
 * SKILL.md requires a through-line object, a question posed early and answered
 * last, one reveal, and escalation — decided BEFORE any beat is written. Most
 * of that is editorial and unenforceable, but three parts are mechanical and
 * worth failing on, because a generator will otherwise satisfy the prompt in
 * words and not in structure.
 */
export function validateSpine(doc) {
  const errs = [];
  const ids = Object.keys(doc?.beats || {}).map(Number).sort((a, b) => a - b);
  if (!ids.length) return ["spine: no beats"];
  const spine = doc.spine || {};
  for (const f of ["throughLine", "question", "reveal", "escalation"]) {
    if (!isStr(spine[f])) errs.push(`spine.${f}: missing — the four spine elements are decided before beats`);
  }
  // The question is posed EARLY: within the first fifth of the film.
  if (isNum(spine.questionBeat)) {
    const cutoff = ids[0] + Math.ceil(ids.length * 0.2);
    if (spine.questionBeat > cutoff) {
      errs.push(`spine.questionBeat ${spine.questionBeat} is not early (expected <= ${cutoff}) — the debt must be created up front`);
    }
  }
  // And answered LAST: in the final fifth.
  if (isNum(spine.answerBeat)) {
    const start = ids[ids.length - 1] - Math.ceil(ids.length * 0.2);
    if (spine.answerBeat < start) {
      errs.push(`spine.answerBeat ${spine.answerBeat} is not late (expected >= ${start}) — answering early leaves the viewer owed nothing`);
    }
  }
  if (isNum(spine.questionBeat) && isNum(spine.answerBeat) && spine.answerBeat <= spine.questionBeat) {
    errs.push("spine: the answer must come after the question");
  }
  return errs;
}
