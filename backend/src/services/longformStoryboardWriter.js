/**
 * longformStoryboardWriter.js — the model half of storyboards-as-data (#77).
 *
 * Emits JSON against longformStoryboardSchema, never JavaScript. Pairs with
 * storyboardInterpreter.js, which is fixed and human-written; between them no
 * generated code is ever executed.
 *
 * DESIGN RULES, inherited from scriptWriter/videoSpecWriter rather than
 * reinvented — one pattern, not two:
 *
 *   1. THE FALLBACK IS `null`, AND NULL ABANDONS THE FILM. The shorts pipeline
 *      can fall back to a deterministic template because a mechanical 60s clip
 *      is still worth publishing. A long-form film is not: eight minutes of
 *      degraded narration with mismatched cards is worse than no film. So
 *      every failure path returns null and the caller skips this topic.
 *
 *   2. GROUNDING IS SCREENED, NOT REQUESTED. The prompt forbids claims absent
 *      from the supplied sources, and `ungroundedFigures()` then checks the
 *      output — because a prompt instruction is not a guarantee. A hallucinated
 *      number in a news film cannot be quietly corrected after publication.
 *
 *   3. DARK SHIP. Off unless LONGFORM_STORYBOARD_ENABLED=1. With it off,
 *      behaviour is byte-identical to today's.
 *
 *   4. VALIDATION ERRORS ARE FED BACK, BOUNDED. A schema violation is a
 *      correctable mistake, so the model gets the exact messages and a fixed
 *      number of attempts. It never loops.
 *
 * Required env:  LONGFORM_STORYBOARD_ENABLED=1, plus whatever llmQueue's
 *                configured provider needs.
 * Optional env:  LONGFORM_STORYBOARD_ATTEMPTS (default 3)
 */

import { logger } from "./logger.js";
import { callJson } from "../realityIndex/llmQueue.js";
import {
  validateStoryboard, validateSpine, CARD_TYPES, CARD_SPECS,
} from "./longform/longformStoryboardSchema.js";

export const isLongformStoryboardEnabled = () =>
  process.env.LONGFORM_STORYBOARD_ENABLED === "1";

const MAX_ATTEMPTS = () =>
  Math.max(1, Number.parseInt(process.env.LONGFORM_STORYBOARD_ATTEMPTS || "", 10) || 3);

/**
 * Numbers the storyboard asserts that the sources never state.
 *
 * Deliberately narrow: FIGURES only, not prose. A number is the claim a viewer
 * carries away and the one a correction request cites, and it is checkable
 * without judging language. Prose grounding stays a human/QC concern.
 *
 * Ignores small integers (chapter numerals, list counts, years the script
 * legitimately restates) — matching on those produced only noise.
 */
export function ungroundedFigures(doc, sourceText) {
  const src = String(sourceText || "");
  // Normalise the sources once: strip separators so "1,240" matches "1240".
  const srcDigits = src.replace(/[,\s]/g, "");
  const bad = [];
  const seen = new Set();

  for (const [id, b] of Object.entries(doc?.beats || {})) {
    if (!b?.card) continue;
    const fields = [b.figure, b.unit, b.label, b.note, b.result,
                    ...(b.lines || []), ...(b.items || []).map((i) => i.display),
                    ...(b.rows || []).map((r) => r.what)];
    for (const f of fields) {
      if (typeof f !== "string") continue;
      for (const m of f.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
        const raw = m[0];
        const plain = raw.replace(/,/g, "");
        // Skip small integers and 4-digit years — too common to be evidence.
        if (!plain.includes(".") && Number(plain) < 100) continue;
        if (/^(19|20)\d{2}$/.test(plain)) continue;
        const key = `${id}:${plain}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!srcDigits.includes(plain)) {
          bad.push(`beat ${id}: figure "${raw}" appears in no supplied source`);
        }
      }
    }
  }
  return bad;
}

/** The card grammar, rendered for the prompt from the schema itself. */
function cardReference() {
  return CARD_TYPES.map((c) => {
    const { req, opt } = CARD_SPECS[c];
    return `  ${c}: required { ${req.join(", ") || "—"} }` +
           (opt.length ? `, optional { ${opt.join(", ")} }` : "");
  }).join("\n");
}

export function buildStoryboardPrompt({ script, spine, mediaKeys = {}, sources = [], errors = null }) {
  const { footage = [], photos = [], docs = [], statements = [] } = mediaKeys;
  const base = `You are storyboarding a 7-10 minute explainer film for ScoopFeeds.

Return ONE JSON object and nothing else. No markdown fence, no commentary.

SHAPE
{
  "spine": { "throughLine", "question", "reveal", "escalation",
             "questionBeat": <n>, "answerBeat": <n> },
  "beats": { "1": {...}, "2": {...}, ... },   // contiguous from 1, no gaps
  "shorts": [ { "name", "from": <beat>, "to": <beat>, "title", "hook" } ],
             // a short is a MOMENT of at most 10 beats, never a chapter
  "reveal": <beat number of the film's one remembered moment>
}

A beat is EXACTLY ONE of:
  - a card:    { "card": "<type>", ...that type's fields }
  - footage:   { "footage": "<key>" }
  - a photo:   { "photo": "<key>" }

CARD TYPES — use only these, and only these fields. An unknown field is rejected.
${cardReference()}

MEDIA KEYS — reference only what exists. USE the footage: several beats of
real footage between card runs are what keep a card film from reading as a
slide deck — aim for a footage beat at least every 8-10 beats when keys exist:
  footage:    ${footage.join(", ") || "(none)"}
  photos:     ${photos.join(", ") || "(none)"}
  docs:       ${docs.join(", ") || "(none)"}
  statements: ${statements.join(", ") || "(none)"}

HARD RULES
- GROUNDING: every figure must appear in the SOURCES below. Invent nothing. If
  a number cannot be sourced, leave it out — a film that omits a figure is
  correct; one that invents a figure is not publishable.
- The STORY SPINE is decided first and the beats serve it: one through-line
  object that escalates, a question posed in the opening and answered only at
  the end, one reveal, and each chapter raising the stakes on the last.
- Chapter dividers (card "chapter") separate sections. A Short may never open
  on one — it wastes the only second that matters.
- Cards carry DISPLAY TYPE, not narration: short lines, no sentences running
  past a few words per line.
- Attribute claims with "src". Neutral register: dates and declarations only.

SOURCES (the only permissible basis for any claim)
${sources.map((s, i) => `[${i + 1}] ${s}`).join("\n") || "(none supplied)"}

STORY SPINE (decided; serve it)
${JSON.stringify(spine || {}, null, 1)}

SCRIPT (the narration these beats must illustrate, beat by beat)
${script}`;

  if (!errors?.length) return base;
  // A schema violation is correctable — hand back the exact messages.
  return `${base}

A PREVIOUS ATTEMPT WAS REJECTED. Fix exactly these problems and return the
corrected JSON object. Change nothing else:
${errors.map((e) => `  - ${e}`).join("\n")}`;
}

/**
 * Generate a validated storyboard document, or null.
 *
 * @returns {Promise<object|null>} the document, or null to abandon the film
 */
export async function writeStoryboard({
  script, spine, mediaKeys = {}, sources = [], sourceText = "",
  slug = "untitled", call = callJson,
} = {}) {
  if (!isLongformStoryboardEnabled()) {
    logger.info("🎬 longform storyboard DISABLED (LONGFORM_STORYBOARD_ENABLED != 1)");
    return null;
  }
  if (!script || !String(script).trim()) {
    logger.warn(`🎬 ${slug}: no script supplied — nothing to storyboard`);
    return null;
  }

  const attempts = MAX_ATTEMPTS();
  let errors = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const prompt = buildStoryboardPrompt({ script, spine, mediaKeys, sources, errors });
    let doc;
    try {
      // Same output-cap reasoning as the script writer: ~70 beats of card
      // JSON does not fit the 2048-token default, and JSON-mode providers
      // reject truncated output with an unhelpful 400.
      // 32k, matching the script call: a 79-beat storyboard's JSON plus a
      // hybrid reasoner's thinking measured over 24k (finish_reason=length,
      // empty content, two attempts in a row).
      doc = await call(prompt, { task: "longform-storyboard", tier: "premium", priority: "low", maxOutputTokens: 32_000, timeoutMs: 300_000 });
    } catch (e) {
      logger.warn(`🎬 ${slug}: storyboard call failed on attempt ${attempt}/${attempts} — ${e.message}`);
      doc = null;
    }
    if (!doc) {
      // A null is TRANSIENT more often than terminal — measured on the first
      // real run (intermittent empty responses on the same prompt). It
      // consumes an attempt, bounded by LONGFORM_STORYBOARD_ATTEMPTS.
      logger.warn(`🎬 ${slug}: no storyboard returned (attempt ${attempt}/${attempts})`);
      continue;
    }

    const schemaErrs = validateStoryboard(doc, { statementIds: mediaKeys.statements || [] });
    const spineErrs = validateSpine(doc);
    const groundErrs = ungroundedFigures(doc, sourceText);
    const all = [...schemaErrs, ...spineErrs, ...groundErrs];

    if (!all.length) {
      const n = Object.keys(doc.beats).length;
      logger.info(`🎬 ${slug}: storyboard accepted — ${n} beats, reveal at ${doc.reveal ?? "unset"} (attempt ${attempt})`);
      return doc;
    }

    // UNGROUNDED FIGURES ARE NOT RETRIED INTO. A schema violation is a
    // formatting mistake the model can fix; an invented number means it is
    // sourcing from itself, and asking again invites a plausible-looking
    // substitute rather than an honest omission.
    if (groundErrs.length) {
      logger.error(
        `🎬 ${slug}: ABANDONED — ${groundErrs.length} ungrounded figure(s), film discarded:\n  ` +
        groundErrs.slice(0, 5).join("\n  "));
      return null;
    }

    // The problems themselves — a count cannot tell a bad shorts span from a
    // hallucinated figure, and an unattended cycle's log is all anyone gets.
    logger.warn(`🎬 ${slug}: storyboard rejected on attempt ${attempt}/${attempts}, ${all.length} problem(s)\n  ` +
      all.slice(0, 8).join("\n  "));
    errors = all.slice(0, 25);
  }

  logger.error(`🎬 ${slug}: storyboard ABANDONED after ${attempts} attempts — no degraded long-form is published`);
  return null;
}
