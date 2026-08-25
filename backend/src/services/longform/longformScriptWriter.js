/**
 * longformScriptWriter.js — the narration, and the spine it serves (#78).
 *
 * Produces `script.md`: a STORY SPINE block and numbered beats, 1,000-1,400
 * words for 7-10 minutes. The storyboard (#77) then illustrates those beats,
 * so this file decides what the film ARGUES and the storyboard decides what is
 * on screen.
 *
 * THE SPINE IS DECIDED BEFORE THE BEATS, and that ordering is enforced rather
 * than requested. SKILL.md is explicit that a sequence of individually good
 * cards reads as a slide deck; four things make it a film — one through-line
 * object that escalates, a question posed early and answered last, one reveal,
 * and escalation. A generator asked for "a script with a spine" will emit
 * beats and then describe a spine it did not follow, so the spine is generated
 * FIRST, in its own call, and the beats are written against it.
 *
 * Grounding is screened, not trusted: every figure must appear in the supplied
 * article text. Same rule and same reasoning as the storyboard writer — a
 * hallucinated number in a news film cannot be quietly corrected once
 * published, and unlike the site there is no edit button.
 *
 * The fallback is `null`, and null abandons the film.
 *
 * Env: LONGFORM_SCRIPT_ENABLED=1 (dark by default),
 *      LONGFORM_SCRIPT_ATTEMPTS (default 2)
 */

import { logger } from "../logger.js";
import { callJson } from "../../realityIndex/llmQueue.js";
import { ungroundedFigures } from "../longformStoryboardWriter.js";

export const isLongformScriptEnabled = () =>
  process.env.LONGFORM_SCRIPT_ENABLED === "1";

const MAX_ATTEMPTS = () =>
  Math.max(1, Number.parseInt(process.env.LONGFORM_SCRIPT_ATTEMPTS || "", 10) || 2);

/** 7-10 minutes at the house narration pace. */
export const MIN_WORDS = 1000;
export const MAX_WORDS = 1400;

export const wordCount = (s) =>
  String(s || "").replace(/[*_`#]/g, "").split(/\s+/).filter(Boolean).length;

/**
 * Validate a script document. Returns problems, empty when valid.
 * Mechanical checks only — the editorial judgement is a human/QC concern, but
 * these four are the ones a generator gets wrong while sounding right.
 */
export function validateScript(doc) {
  const errs = [];
  if (!doc || typeof doc !== "object") return ["script: not an object"];

  const spine = doc.spine || {};
  for (const f of ["throughLine", "question", "reveal", "escalation"]) {
    if (!spine[f] || !String(spine[f]).trim()) errs.push(`spine.${f}: missing`);
  }
  if (!Array.isArray(doc.beats) || !doc.beats.length) {
    errs.push("beats: missing or empty");
    return errs;
  }
  doc.beats.forEach((b, i) => {
    if (!b || typeof b.text !== "string" || !b.text.trim()) {
      errs.push(`beats[${i}]: no text`);
    }
  });

  const words = doc.beats.reduce((a, b) => a + wordCount(b?.text), 0);
  if (words < MIN_WORDS) errs.push(`script is ${words} words (need >= ${MIN_WORDS}) — too short for 7 minutes`);
  if (words > MAX_WORDS) errs.push(`script is ${words} words (need <= ${MAX_WORDS}) — over ten minutes`);

  // THE QUESTION IS POSED EARLY AND ANSWERED LAST. Checked structurally,
  // because "create a debt and settle it" is exactly the instruction a model
  // satisfies in the spine text while front-loading the payoff in the beats.
  const n = doc.beats.length;
  if (Number.isFinite(spine.questionBeat)) {
    const cutoff = Math.max(2, Math.ceil(n * 0.2));
    if (spine.questionBeat > cutoff) {
      errs.push(`spine.questionBeat ${spine.questionBeat} of ${n} is not in the opening (expected <= ${cutoff})`);
    }
  } else errs.push("spine.questionBeat: missing");
  if (Number.isFinite(spine.answerBeat)) {
    const start = Math.floor(n * 0.8);
    if (spine.answerBeat < start) {
      errs.push(`spine.answerBeat ${spine.answerBeat} of ${n} is not in the closing (expected >= ${start})`);
    }
  } else errs.push("spine.answerBeat: missing");

  // The through-line must actually RECUR — an object named once is a prop.
  if (spine.throughLine && Array.isArray(doc.beats)) {
    const needle = String(spine.throughLine).toLowerCase().split(/\s+/)
      .filter((w) => w.length > 4).slice(0, 3);
    if (needle.length) {
      const hits = doc.beats.filter((b) =>
        needle.some((w) => String(b?.text || "").toLowerCase().includes(w))).length;
      if (hits < 3) {
        errs.push(`the through-line "${spine.throughLine}" appears in ${hits} beat(s) — it must recur and escalate, not be named once`);
      }
    }
  }
  return errs;
}

/** Render the validated document as the `script.md` the engine reads. */
export function renderScriptMarkdown(doc, { title = "" } = {}) {
  const s = doc.spine || {};
  const lines = [
    `# ${title || "Untitled"}`, "",
    "STORY SPINE", "",
    `- THROUGH-LINE OBJECT — ${s.throughLine}`,
    `- THE QUESTION (beat ${s.questionBeat}) — ${s.question}`,
    `- THE REVEAL — ${s.reveal}`,
    `- ESCALATION — ${s.escalation}`,
    `- ANSWERED — beat ${s.answerBeat}`,
    "",
  ];
  doc.beats.forEach((b, i) => lines.push(`${i + 1}. ${b.text}`, ""));
  return lines.join("\n");
}

export function buildSpinePrompt({ event, sources }) {
  return `You are deciding the STORY SPINE for a 7-10 minute explainer film, BEFORE any narration is written.

Return ONE JSON object and nothing else:
{ "throughLine": "...", "question": "...", "reveal": "...", "escalation": "..." }

A sequence of individually good scenes reads as a slide deck. These four things
are what make it a film:

- THROUGH-LINE OBJECT: a single CONCRETE thing the viewer can picture, which
  appears in nearly every chapter and ESCALATES. Not a theme. Not an abstraction.
  It carries the argument when the numbers change.
- THE QUESTION: stated plainly in the opening and NOT answered until the end.
  Create a debt and settle it. Do not open on the reversal.
- THE REVEAL: one moment that reframes everything before it — a number that
  recontextualises the opening, a scale change, a name.
- ESCALATION: how each chapter raises the stakes on the last.

STORY
${event?.title || ""}
${event?.summary || ""}

SOURCES (the only permissible basis for any claim)
${(sources || []).map((s, i) => `[${i + 1}] ${s}`).join("\n")}`;
}

export function buildScriptPrompt({ event, spine, sources, errors = null }) {
  const base = `Write the narration for a 7-10 minute explainer film, serving the SPINE below.

Return ONE JSON object and nothing else:
{
  "spine": { "throughLine", "question", "reveal", "escalation",
             "questionBeat": <beat number>, "answerBeat": <beat number> },
  "beats": [ { "text": "one or two sentences" }, ... ]
}

RULES
- ${MIN_WORDS}-${MAX_WORDS} words TOTAL across all beats. This is a hard range.
- One or two sentences per beat. A beat is what one shot illustrates.
- GROUNDING: every figure must appear in the SOURCES. Invent nothing. If a
  number cannot be sourced, leave it out — omitting a figure is correct;
  inventing one is not publishable.
- The through-line object must RECUR and escalate across the film, not be
  named once.
- Pose the question in the opening beats; answer it only in the closing beats.
  questionBeat and answerBeat must point at the beats where each happens.
- Neutral register: dates and declarations, attributed. Assign no blame.
- Narration only. No stage directions, no card text, no headings.

SPINE (decided; serve it)
${JSON.stringify(spine, null, 1)}

STORY
${event?.title || ""}
${event?.summary || ""}

SOURCES
${(sources || []).map((s, i) => `[${i + 1}] ${s}`).join("\n")}`;

  if (!errors?.length) return base;
  return `${base}

A PREVIOUS ATTEMPT WAS REJECTED. Fix exactly these problems and return the
corrected JSON. Change nothing else:
${errors.map((e) => `  - ${e}`).join("\n")}`;
}

/**
 * Write a film's script, or return null to abandon the topic.
 *
 * @returns {Promise<{doc:object, markdown:string}|null>}
 */
export async function writeLongformScript({
  event, sources = [], sourceText = "", call = callJson,
} = {}) {
  const slug = event?.slug || event?.id || "untitled";
  if (!isLongformScriptEnabled()) {
    logger.info("🎬 longform script DISABLED (LONGFORM_SCRIPT_ENABLED != 1)");
    return null;
  }
  if (!event || !sources.length) {
    logger.warn(`🎬 ${slug}: no event or no sources — a film cannot be grounded in nothing`);
    return null;
  }

  // 1. THE SPINE FIRST, in its own call. Asked for together, a model emits
  //    beats and then describes a spine it did not actually follow.
  let spine;
  try {
    spine = await call(buildSpinePrompt({ event, sources }),
      { task: "longform-spine", tier: "premium", priority: "low" });
  } catch (e) {
    logger.warn(`🎬 ${slug}: spine call failed — ${e.message}`);
    return null;
  }
  if (!spine?.throughLine) {
    logger.warn(`🎬 ${slug}: no usable spine returned — abandoning`);
    return null;
  }
  logger.info(`🎬 ${slug}: spine — through-line "${spine.throughLine}"`);

  // 2. The beats, written against it.
  const attempts = MAX_ATTEMPTS();
  let errors = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let doc;
    try {
      doc = await call(buildScriptPrompt({ event, spine, sources, errors }),
        { task: "longform-script", tier: "premium", priority: "low" });
    } catch (e) {
      logger.warn(`🎬 ${slug}: script call failed on attempt ${attempt} — ${e.message}`);
      return null;
    }
    if (!doc) {
      logger.warn(`🎬 ${slug}: no script returned (attempt ${attempt}/${attempts})`);
      return null;
    }

    const structural = validateScript(doc);
    // Grounding reuses the storyboard writer's screen — one implementation,
    // so a figure that would be caught on a card is caught in narration too.
    const ungrounded = ungroundedFigures(
      { beats: Object.fromEntries((doc.beats || []).map((b, i) => [i + 1, { card: "statement", lines: [b?.text || ""] }])) },
      sourceText);

    if (ungrounded.length) {
      logger.error(`🎬 ${slug}: ABANDONED — ${ungrounded.length} ungrounded figure(s):\n  ` +
        ungrounded.slice(0, 5).join("\n  "));
      return null;
    }
    if (!structural.length) {
      const words = doc.beats.reduce((a, b) => a + wordCount(b.text), 0);
      logger.info(`🎬 ${slug}: script accepted — ${doc.beats.length} beats, ${words} words (attempt ${attempt})`);
      return { doc, markdown: renderScriptMarkdown(doc, { title: event.title }) };
    }
    logger.warn(`🎬 ${slug}: script rejected on attempt ${attempt}/${attempts}: ${structural.length} problem(s)`);
    errors = structural.slice(0, 15);
  }
  logger.error(`🎬 ${slug}: script ABANDONED after ${attempts} attempts — no degraded long-form is published`);
  return null;
}
