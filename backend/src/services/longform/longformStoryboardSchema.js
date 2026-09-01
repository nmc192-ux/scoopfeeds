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
import { confusablesIn } from "./engine/confusables.mjs";
import { cardStrings } from "./engine/cardWords.mjs";

export const CARD_TYPES = Object.freeze([
  "title", "chapter", "stat", "bars", "outro", "quote", "tweet", "map",
  "linechart", "multiline", "equation", "doc", "dotgrid", "pipeline",
  "statement", "ledger", "decay", "split",
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
  ledger:    { req: ["rows"],                                   opt: ["kicker", "title", "src", "muted"] },
  // The curve is COMPUTED from peak/halfLife/xMax — see render.mjs. Authoring
  // a decay as points would let a typo draw a curve that contradicts the
  // half-life the card prints beside it.
  decay:     { req: ["peak", "halfLife", "xMax"],               opt: ["kicker", "title", "baseline", "xAxis", "yAxis", "marks", "beyond", "note", "src"] },
  split:     { req: ["left", "right"],                          opt: ["kicker", "title", "note", "src"] },
});

/**
 * Cards that hold something back for the payoff phase, and may therefore anchor
 * that payoff to a WORD with `revealOn: "<phrase>"` (see engine/wordTimings.mjs).
 *
 * DUPLICATES render.mjs's HAS_PAYOFF on purpose: importing render.mjs here would
 * pull satori and resvg into every consumer of this schema, including the
 * storyboard writer. decaySplit.test.mjs asserts the two lists agree, so the
 * duplication cannot drift.
 */
export const PAYOFF_CARDS = Object.freeze([
  "stat", "statement", "equation", "bars", "ledger", "doc", "dotgrid",
  "pipeline", "map", "linechart", "multiline", "decay", "split",
]);

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
  // The phrase itself is only checkable against the beat's narration, which
  // this validator does not have; build.mjs throws if it does not occur.
  revealOn: (v) => isStr(v) || "must be a non-empty phrase from that beat's narration",
  ground:   (v) => isStr(v) || "must be a ground key resolving to out/grounds/<key>.png",
  // decay. `xMax` is shared with multiline, where it is also a number.
  peak:     (v) => isNum(v) || "must be a number",
  baseline: (v) => isNum(v) || "must be a number",
  halfLife: (v) => (isNum(v) && v > 0) || "must be a positive number",
  xMax:     (v) => (isNum(v) && v > 0) || "must be a positive number",
  xAxis:    (v) => isTickList(v) || "must be a non-empty array of { at:number, label:string }",
  yAxis:    (v) => isTickList(v) || "must be a non-empty array of { at:number, label:string }",
  marks:    (v) => isTickList(v) || "must be a non-empty array of { at:number, label:string }",
  beyond:   (v) => (v && typeof v === "object" && isStr(v.label)) || "must be { label:string }",
  // split. A panel shows a figure OR declares one absent with a stamp — never
  // both, because a panel with both is an author who meant one and got the
  // other rendered.
  left:   (v) => isPanel(v) || 'must be { label, figure } or { label, stamp } — exactly one of figure/stamp',
  right:  (v) => isPanel(v) || 'must be { label, figure } or { label, stamp } — exactly one of figure/stamp',
};

const isTickList = (v) => isArr(v) && v.every((t) => isNum(t?.at) && isStr(t?.label));
const isPanel = (v) => !!v && typeof v === "object" && isStr(v.label)
  && (isStr(v.figure) ? !v.stamp : isStr(v.stamp));

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
    // A decay curve that falls the wrong way, or an annotation pinned to the
    // edge of the axis because it sits past xMax, renders happily and argues
    // for the opposite of what the author meant. `beyond` is the supported way
    // to point at a moment off the chart.
    if (b.card === "decay") {
      const base = b.baseline ?? 0;
      if (isNum(b.peak) && isNum(base) && b.peak <= base) {
        errs.push(`${at} (decay): peak (${b.peak}) must be above baseline (${base}) — the curve decays to the baseline`);
      }
      for (const key of ["marks", "xAxis"]) {
        if (!Array.isArray(b[key]) || !isNum(b.xMax)) continue;
        for (const m of b[key]) {
          if (isNum(m?.at) && (m.at < 0 || m.at > b.xMax)) {
            errs.push(`${at} (decay): ${key} entry "${m.label}" at ${m.at} is outside the axis (0–${b.xMax}) — use "beyond" for a moment off the chart`);
          }
        }
      }
      // X TICKS THAT OVERPRINT. Labels render in a fixed ~160px box on a ~920px
      // plot, so two ticks closer than ~17% of the axis overlap. The first cut
      // of this card put "DRINK" at 0 and "13 MIN" at 13 on a 360-minute axis
      // and rendered the word "DRISKMIN". Caught here rather than in a frame,
      // and left slightly permissive (12%) because short labels pack tighter.
      if (Array.isArray(b.xAxis) && isNum(b.xMax)) {
        const sorted = b.xAxis.filter((t) => isNum(t?.at)).slice().sort((x, y) => x.at - y.at);
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i].at - sorted[i - 1].at < b.xMax * 0.12) {
            errs.push(`${at} (decay): xAxis labels "${sorted[i - 1].label}" and "${sorted[i].label}" are ${sorted[i].at - sorted[i - 1].at} apart on a ${b.xMax} axis — they will overprint; keep ticks ≥${(b.xMax * 0.12).toFixed(0)} apart and put the detail in "marks"`);
          }
        }
      }
    }
    // CHARACTERS THAT DRAW AS A DIFFERENT CHARACTER. Anton's "≠" outline is an
    // equals sign, so a caveat card authored as TERTILES ≠ QUARTILES rendered
    // TERTILES = QUARTILES — the opposite claim, and nothing caught it. See
    // engine/confusables.mjs.
    for (const c of confusablesIn(cardStrings(b))) {
      errs.push(`${at} (${b.card}): ${JSON.stringify(c.char)} renders as ${JSON.stringify(c.renders)} in this font — `
        + `${c.why}. In "${c.inText}". Instead, ${c.instead}.`);
    }
    // `muted` recedes every row; `hot` lights one. Asking for both is an author
    // who means one of them, and the renderer would silently honour hot.
    if (b.card === "ledger" && b.muted && Array.isArray(b.rows) && b.rows.some((r) => r?.hot)) {
      errs.push(`${at} (ledger): "muted" recedes every row, so a "hot" row contradicts it — pick one`);
    }
    // `ground` is legal on ANY card — it is chrome, not content: render.mjs
    // composites the named backplate behind the frame and darkens it under a
    // scrim. A ground that is not on disk falls back to flat near-black and
    // says so, so a missing file cannot fail a build.
    const allowed = new Set(["card", "ground", ...spec.req, ...spec.opt,
      ...(PAYOFF_CARDS.includes(b.card) ? ["revealOn"] : [])]);
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

  // EVERY FILM NEEDS A TITLE SEGMENT, and build.mjs hard-fails without one —
  // 300 lines in, after narration has already been paid for. Nothing here
  // looked at it, so a storyboard could validate clean and then die at
  // assembly; that is exactly what happened to the xylitol film on its first
  // real build, having just synthesised 116 takes.
  //
  // It is NOT a beat: build.mjs inserts it silently after `after` and holds it
  // for `seconds`, carrying no narration of its own.
  if (!doc.titleSegment || typeof doc.titleSegment !== "object") {
    errs.push('storyboard.titleSegment: missing — every film needs a title card. '
      + '{ after: <beat>, seconds: <n>, spec: { card: "title", lines: [...] } }');
  } else {
    const t = doc.titleSegment;
    if (!isNum(t.after) || !ids.includes(t.after)) {
      errs.push(`storyboard.titleSegment.after: ${JSON.stringify(t.after)} is not one of the film's beats`);
    }
    if (!isNum(t.seconds) || t.seconds <= 0) {
      errs.push(`storyboard.titleSegment.seconds: must be a positive number (got ${JSON.stringify(t.seconds)})`);
    }
    if (!t.spec || typeof t.spec !== "object") {
      errs.push("storyboard.titleSegment.spec: missing — this is the card build.mjs renders");
    } else if (t.spec.card !== "title") {
      errs.push(`storyboard.titleSegment.spec.card: must be "title" (got ${JSON.stringify(t.spec.card)})`);
    } else {
      // The spec is a real card and is held to the same contract as any other.
      for (const f of CARD_SPECS.title.req) {
        if (t.spec[f] === undefined) errs.push(`storyboard.titleSegment.spec: missing required field "${f}"`);
      }
      const allowedT = new Set(["card", "ground", ...CARD_SPECS.title.req, ...CARD_SPECS.title.opt]);
      for (const f of Object.keys(t.spec)) {
        if (!allowedT.has(f)) errs.push(`storyboard.titleSegment.spec: unknown field "${f}"`);
      }
      for (const c of confusablesIn(cardStrings(t.spec))) {
        errs.push(`storyboard.titleSegment.spec: ${JSON.stringify(c.char)} renders as ${JSON.stringify(c.renders)} — ${c.why}`);
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
