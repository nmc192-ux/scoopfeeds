/**
 * THE PROMPT MUST NAME WHAT THE VALIDATOR REJECTS.
 *
 * A validator that rejects something the prompt never mentions is a rejection
 * loop BY CONSTRUCTION. The model cannot learn the rule from the outside, so it
 * reaches for a neighbouring word and is rejected again, and every occurrence
 * costs a spec call and a video.
 *
 * This was found the expensive way (2026-08-16). `massiv` was on the stem list,
 * the gate caught it correctly on four consecutive runs of the same article, and
 * the prompt named only seven of the twenty-two stems — not that one. When the
 * retry note finally landed, the model dropped "massive" and reached ONE WORD TO
 * THE LEFT for "completely", which was also on the list and also unnamed. That is
 * the loop: the gate was working perfectly and the prompt was silent.
 *
 * WHY THIS IS A TEST AND NOT A CONVENTION. The audit that found the gap also
 * found its shape: every check written as a RULE was named, and the only two that
 * had drifted were both WORD LISTS — because adding a word to a list is a
 * one-line change that never prompts anyone to open the prompt. A convention
 * cannot catch that. A failing test can.
 *
 * Scope: the two word lists, checked across the prompt's flag matrix. Numeric
 * bounds are deliberately NOT asserted here — see the MAX_SLIDES case at the
 * bottom, which is the one place where "enforced but not named" is correct.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildSpecPrompt } from "./videoSpecWriter.js";
import { INTENSIFIER_STEMS, KICKER_BANNED_PHRASES, MAX_SLIDES } from "./videoSpecSchema.js";

// ── The prompt, in every shape it is emitted in ────────────────────────────
//
// The prompt is CONDITIONAL: the card grammar changes with the subject-visual
// flag and with whether the article has a photograph, and rule 3's attribution
// paragraphs appear only for a multi-source bundle. A rule that is named in one
// variant and absent from another is still a rejection loop in the variant that
// omits it, so coverage is asserted against the INTERSECTION — every variant
// must name every word.
const ARTICLE = {
  id: "coverage-fixture",
  title: "Court weighs a request to unseal the filing",
  description: "A hearing is set for Tuesday.",
  content: "The court will hear the request on Tuesday. The filing runs to 40 pages.",
  source_name: "Reuters",
  url: "https://example.com/a",
  published_at: Date.now(),
};

function variants() {
  const out = [];
  const prev = process.env.VIDEO_SUBJECT_VISUALS_ENABLED;
  for (const visuals of ["0", "1"]) {
    process.env.VIDEO_SUBJECT_VISUALS_ENABLED = visuals;
    for (const hasPhoto of [false, true]) {
      for (const sources of [["Reuters"], ["Reuters", "AP"]]) {
        out.push({
          label: `visuals=${visuals} photo=${hasPhoto} sources=${sources.length}`,
          text: buildSpecPrompt({
            article: { ...ARTICLE, image_url: hasPhoto ? "https://example.com/i.jpg" : null },
            allowedSources: sources,
            bodyText: ARTICLE.content,
          }).toLowerCase(),
        });
      }
    }
  }
  if (prev === undefined) delete process.env.VIDEO_SUBJECT_VISUALS_ENABLED;
  else process.env.VIDEO_SUBJECT_VISUALS_ENABLED = prev;
  return out;
}

const VARIANTS = variants();

// ── Coverage is asserted inside the BLOCK THAT OWNS THE RULE ───────────────
//
// Not anywhere in the prompt. The first draft of this test checked the whole
// string and reported `entirely` as already named — it was, in an unrelated
// sentence about beat counting ("...ARE NOT COUNTED"). An incidental occurrence
// in neighbouring prose teaches the model nothing and would have let a real gap
// ship green, which is the precise failure this file exists to prevent.
//
// So each list has a marker line in the prompt, and coverage is checked from
// that marker to the start of the next numbered rule — the block's actual
// extent. Renaming a marker breaks this test loudly rather than silently
// widening it to the whole prompt.
const NEXT_RULE = /\n\s*\d+[a-z]?\.\s/;

function block(prompt, marker) {
  const at = prompt.indexOf(marker.toLowerCase());
  if (at === -1) return null;
  const rest = prompt.slice(at);
  const end = rest.search(NEXT_RULE);
  return end === -1 ? rest : rest.slice(0, end);
}

function blockOrFail(v, marker) {
  const b = block(v.text, marker);
  assert.ok(
    b,
    `[${v.label}] the prompt has no "${marker}" block. That block is where the ` +
    `validator's word list is named for the model; if it was renamed, update this test ` +
    `to match — do not fall back to searching the whole prompt, which passes on ` +
    `incidental prose.`
  );
  return b;
}

// ── Stems are matched by PREFIX, not by equality ───────────────────────────
//
// The list holds `massiv`, `catastroph`, `unprecedent` — stems, so that the
// source saying "indefinite" licenses the script saying "indefinitely". A test
// demanding the literal stem appear in the prompt would force the prompt to
// print truncated fragments at the model ("do not write massiv"), which is worse
// writing and no clearer. So: some WORD in the prompt must START WITH the stem,
// which is the same containment the gate itself applies.
function namesStem(prompt, stem) {
  return new RegExp(`\\b${stem}[a-z]*`, "i").test(prompt);
}

test("every intensifier stem the validator rejects is named in the prompt", () => {
  for (const v of VARIANTS) {
    const scope = blockOrFail(v, "THE CHECKED WORDS, IN FULL");
    const missing = INTENSIFIER_STEMS.filter(s => !namesStem(scope, s));
    assert.deepEqual(
      missing, [],
      `[${v.label}] ${missing.length} intensifier stem(s) are rejected by ` +
      `unsupportedIntensifiers() but never named in the prompt: ${missing.join(", ")}.\n` +
      `The model cannot learn these from the outside — name them in rule 10c, or ` +
      `remove them from INTENSIFIER_STEMS.`
    );
  }
});

// ── Phrases: a named SUBSTRING covers its longer forms ─────────────────────
//
// The gate is `caption.includes(phrase)`, so naming "there you have it" already
// warns the model off "so there you have it" — any text that trips the longer
// phrase trips the shorter one too, and the shorter one is the one it will read.
// Demanding both verbatim would pad the prompt with redundant variants for no
// added instruction. "key takeaway" is NOT covered by "the takeaway", though,
// because neither contains the other — that one has to be named.
function namesPhrase(prompt, phrase) {
  if (prompt.includes(phrase)) return true;
  return KICKER_BANNED_PHRASES.some(
    other => other !== phrase && phrase.includes(other) && prompt.includes(other)
  );
}

test("every banned kicker phrase is named in the prompt, or covered by one that is", () => {
  for (const v of VARIANTS) {
    const scope = blockOrFail(v, "THE CHECKED PHRASES, IN FULL");
    const missing = KICKER_BANNED_PHRASES.filter(p => !namesPhrase(scope, p));
    assert.deepEqual(
      missing, [],
      `[${v.label}] ${missing.length} kicker phrase(s) are rejected by rule 16 but ` +
      `never named in the prompt: ${missing.map(p => `"${p}"`).join(", ")}.\n` +
      `Name them in rule 16, or remove them from KICKER_BANNED_PHRASES.`
    );
  }
});

// ── The deliberate exception ───────────────────────────────────────────────
//
// MAX_SLIDES must NOT be in the prompt, and this test exists so that a future
// sweep "fixing" the gap above does not helpfully add it.
//
// Stating a slide count is what produced flat specs: every article came back at
// the same length regardless of how much the source held. Length is an OUTCOME
// of the beat rubric, never an instruction. So the number lives in the RETRY
// note instead — where it is a correction to a spec that has already blown past
// it, rather than a target to fill.
test("MAX_SLIDES is deliberately absent from the prompt", () => {
  for (const v of VARIANTS) {
    assert.ok(
      !v.text.includes(String(MAX_SLIDES)),
      `[${v.label}] the prompt contains "${MAX_SLIDES}". If that is the slide ceiling ` +
      `it must come out: stating a count is what produced flat specs, and the bound is ` +
      `stated in the retry note instead (see stripCounts in videoSpecWriter.js).`
    );
  }
});
