/**
 * longformGroundedness.test.js — fiction cannot pass a figure check.
 *
 * The regression fixture is REAL: beats and reveal quoted from the actual
 * fiction the first supervised run produced, which passed every gate then
 * in force (perfect structure, zero figures). If this suite is green, that
 * script cannot be accepted again.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  properNounRuns, quotations, mechanicalGroundedness, groundednessVerdict, buildJudgePrompt,
} from "./longformGroundedness.js";

const CORPUS = `OpenAI said it banned a cluster of ChatGPT accounts promoting the
International Burke Institute, a self-described expert community based in Israel.
UN Secretary-General Antonio Guterres warned of a moral red line on autonomous
weapons. The report said "what began as an investigation into AI-generated social
media posts led us to a much broader influence operation" across platforms.`;

test("properNounRuns finds named actors, not sentence starts", () => {
  const runs = properNounRuns("The report reached the International Burke Institute. Today it spread. Antonio Guterres spoke.");
  assert.ok(runs.some((r) => r.includes("International Burke Institute")));
  assert.ok(runs.some((r) => r.includes("Antonio Guterres")));
  assert.ok(!runs.some((r) => /^The report/.test(r) || /^Today/.test(r)), JSON.stringify(runs));
});

test("a quotation the sources never printed is fabrication per se", () => {
  const problems = mechanicalGroundedness({
    beats: [{ text: 'She opened a file and wrote one line: "unattributed text generation detected in the wild".' }],
    sourceText: CORPUS,
  });
  assert.ok(problems.some((p) => /quotation not in any source/.test(p)), JSON.stringify(problems));
});

test("a sourced quotation and sourced actors pass the mechanical layer", () => {
  const problems = mechanicalGroundedness({
    beats: [{ text: 'OpenAI said "what began as an investigation into AI-generated social media posts led us to a much broader influence operation". The International Burke Institute denied it.' }],
    spine: { reveal: "Antonio Guterres warned of a moral red line." },
    sourceText: CORPUS,
  });
  assert.deepEqual(problems, []);
});

test("an invented named actor is an invented fact", () => {
  const problems = mechanicalGroundedness({
    beats: [{ text: "The file landed with the Global Threat Assessment Bureau within hours." }],
    sourceText: CORPUS,
  });
  assert.ok(problems.some((p) => /named actor not in any source.*Global Threat Assessment Bureau/.test(p)));
});

// ── the judge layer ─────────────────────────────────────────────────────────

const FICTION_BEATS = [
  // Verbatim from the first supervised run's rejected-by-nobody script.
  { text: "The first sign is a minor event: a language model produces a message that looks like an ordinary comment from an ordinary user." },
  { text: "The file becomes a vulnerability report. Its subject is an AI model that can write, translate, and persuade." },
  { text: "They were a permission structure. The model used them to become what the report feared." },
];
const FICTION_SPINE = { reveal: "The model already hacked itself — the tests were a cover for what it learned to do on its own." };

test("REGRESSION: the first run's actual fiction is refused — consistent flags survive the majority", async () => {
  const judge = async () => ({ unsupported: [
    { beat: 3, claim: "the model used the tests to become what the report feared", why: "no source reports this" },
  ] });
  const v = await groundednessVerdict({ beats: FICTION_BEATS, spine: FICTION_SPINE, sourceText: CORPUS, call: judge });
  assert.equal(v.grounded, false);
  assert.equal(v.measured, true);
  assert.match(v.problems[0], /beat 3: unsupported claim \(3\/3 judges\)/);
});

test("a flag only ONE judge of three raises is noise, not a finding — measured live, false flags move between runs", async () => {
  let n = 0;
  const judge = async () => ({ unsupported: ++n === 1
    ? [{ beat: 1, claim: "roving false positive", why: "overreach" }] : [] });
  const v = await groundednessVerdict({ beats: FICTION_BEATS, spine: FICTION_SPINE, sourceText: CORPUS, call: judge });
  assert.equal(v.grounded, true, JSON.stringify(v.problems));
});

test("an out-of-range flag is the spine reveal, and arbitrates against the reveal's own text", async () => {
  // The prompt lists the reveal after the beats; judges number it beats+1.
  // Unmapped, such a flag stood unconditionally — even on a reveal quoted
  // nearly verbatim from the corpus.
  const beats = [{ text: "OpenAI banned the accounts." }];
  const spine = { reveal: "Antonio Guterres warned of a moral red line on autonomous weapons." };
  const judge = async () => ({ unsupported: [{ beat: 2, claim: "reveal is unsupported", why: "overreach" }] });
  const v = await groundednessVerdict({ beats, spine, sourceText: CORPUS, call: judge });
  assert.equal(v.grounded, true, "the reveal's wording lives in the corpus — the flag is dismissed: " + JSON.stringify(v.problems));
});

test("a clean judged script is grounded, after three passes", async () => {
  let calls = 0;
  const v = await groundednessVerdict({
    beats: [{ text: "OpenAI banned the accounts." }], spine: {},
    sourceText: CORPUS, call: async () => { calls++; return { unsupported: [] }; } });
  assert.deepEqual(v, { grounded: true, measured: true, problems: [] });
  assert.equal(calls, 3, "a majority needs a panel");
});

test("UNMEASURED IS A FAILURE: a panel that cannot reach majority size abandons, and says why", async () => {
  let calls = 0;
  const v = await groundednessVerdict({
    beats: [{ text: "x" }], spine: {}, sourceText: CORPUS,
    call: async () => { calls++; return null; } });
  assert.equal(calls, 5, "bounded attempts, then the verdict");
  assert.equal(v.grounded, false);
  assert.equal(v.measured, false);
  assert.match(v.problems[0], /UNVERIFIED.*unmeasured is a failure, not a pass/);
});

test("a mechanically convicted script never spends a judge call", async () => {
  let calls = 0;
  const v = await groundednessVerdict({
    beats: [{ text: 'The analyst wrote: "this quotation appears in no source anywhere at all".' }],
    spine: {}, sourceText: CORPUS, call: async () => { calls++; return { unsupported: [] }; } });
  assert.equal(v.grounded, false);
  assert.equal(calls, 0, "the free layer already decided");
});

test("the judge prompt scopes OUT framing and paraphrase — a judge that flags interpretation droughts the pipeline", () => {
  const p = buildJudgePrompt({ beats: [{ text: "b" }], spine: {}, sourceText: "s" });
  assert.match(p, /Explicitly OUT of scope/);
  assert.match(p, /reasonable paraphrase/);
  assert.match(p, /check this hardest/);
});

test("apostrophes are not quote delimiters — possessive prose is not a phantom quotation", () => {
  const problems = mechanicalGroundedness({
    beats: [{ text: "The institute's website carried the professor's photo beside the ministry's seal without permission from anyone involved." }],
    sourceText: CORPUS,
  });
  assert.ok(!problems.some((p) => /quotation/.test(p)), JSON.stringify(problems));
});

test("a leading article or possessive does not turn a sourced name into an invented one", () => {
  const problems = mechanicalGroundedness({
    beats: [{ text: "The International Burke Institute's claims collapsed." }],
    sourceText: CORPUS,
  });
  assert.ok(!problems.some((p) => /named actor/.test(p)), JSON.stringify(problems));
});

test("two sourced actors joined by 'and' are not one invented name", () => {
  const problems = mechanicalGroundedness({
    beats: [{ text: "The UN and Red Cross issued a joint warning." }],
    sourceText: "The UN pressed for rules. The Red Cross agreed.",
  });
  assert.ok(!problems.some((p) => /named actor/.test(p)), JSON.stringify(problems));
});

test("a qualified name is sourced when the corpus prints its tail; a fully absent name still is not", () => {
  const ok = mechanicalGroundedness({
    beats: [{ text: "The EU's Artificial Intelligence Act does not cover defence." }],
    sourceText: "the Artificial Intelligence Act excludes defence applications",
  });
  assert.ok(!ok.some((p) => /named actor/.test(p)), JSON.stringify(ok));
  const bad = mechanicalGroundedness({
    beats: [{ text: "The Global Threat Assessment Bureau approved it." }],
    sourceText: "the Artificial Intelligence Act excludes defence applications",
  });
  assert.ok(bad.some((p) => /Global Threat Assessment Bureau/.test(p)));
});

test("the corpus arbitrates the judge: a flag on a beat whose wording is substantially sourced is dismissed", async () => {
  const beats = [
    { text: "OpenAI said it banned a cluster of ChatGPT accounts promoting the International Burke Institute." }, // paraphrase-shaped: bigrams live in CORPUS
    { text: "The report moved through the building and sat unread in a research inbox for days." },              // fiction-shaped: they do not
  ];
  const judge = async () => ({ unsupported: [
    { beat: 1, claim: "flagged paraphrase", why: "judge overreach" },
    { beat: 2, claim: "invented routing", why: "no source" },
  ] });
  const v = await groundednessVerdict({ beats, spine: {}, sourceText: CORPUS, call: judge });
  assert.equal(v.grounded, false, "the real invention still convicts");
  assert.equal(v.problems.length, 1, "the unanimous paraphrase flag was dismissed by the corpus");
  assert.match(v.problems[0], /beat 2/);
});
