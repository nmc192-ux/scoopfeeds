/**
 * judgmentHarness.test.js — B.6.3a tests (node --test, offline; MOCKED llmCall —
 * NO real LLM calls in the suite). Proves the honest-confidence mechanism:
 * agreement→confidence, grounding verification, language down-weighting, the
 * pending-llm-on-split mapping, the LLM-disabled kill switch, and the gitignored
 * prompt loader.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateWithConfidence } from "./judgmentHarness.js";
import { loadPrompt } from "./promptLoader.js";
import { parseJudgment, groundedRubricInstruction } from "./groundedSchema.js";

const NOW = 1_750_000_000_000;
const LEVELS = ["no-process", "not-transparent", "transparent-timely", "public-log"];
const TEXT = "We correct errors promptly. A correction notice with a timestamp is appended to the original article, describing the original mistake.";
const QUOTE = "A correction notice with a timestamp is appended to the original article";

// A mock llmCall that replays a fixed list of run results (one per call), each a
// raw model object {bucket, groundingQuote, reasoning} or null (failed/refused).
function mockLLM(runResults) {
  let i = 0;
  const calls = [];
  const fn = async (prompt) => { calls.push(prompt); return runResults[i++] ?? null; };
  fn.calls = calls;
  return fn;
}
const run = (bucket, quote = QUOTE, reasoning = "r") => ({ bucket, groundingQuote: quote, reasoning });
const base = (llmCall, extra = {}) => ({
  subCriterion: "_test", rubric: { levels: LEVELS }, tier: "standard",
  input: { text: TEXT, language: "en", evidenceUrl: "https://x.example/corrections", ...(extra.input || {}) },
  ctx: { now: NOW, llmCall, buildPrompt: () => "PROMPT", ...(extra.ctx || {}) },
});

// ── agreement → confidence ──────────────────────────────────────────────────
test("3/3 agreement, grounded → EVIDENCED, high confidence", async () => {
  const ev = await evaluateWithConfidence(base(mockLLM([run("public-log"), run("public-log"), run("public-log")])));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.bucket, "public-log");
  assert.equal(ev.value.agreement, 1);
  assert.equal(ev.confidence, 1);
  assert.equal(ev.value.ungrounded, false);
  assert.ok(ev.value.groundingQuotes.length >= 1);
  assert.equal(ev.value.founderFlag, false);
  assert.equal(ev.evidenceUrl, "https://x.example/corrections");
  assert.equal(ev.gatheredAt, NOW);
});

test("2/3 agreement → EVIDENCED, moderate confidence on the modal bucket", async () => {
  const ev = await evaluateWithConfidence(base(mockLLM([run("public-log"), run("public-log"), run("transparent-timely")])));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.bucket, "public-log");
  assert.equal(ev.value.agreement, 0.67);
  assert.equal(ev.confidence, 0.67); // 0.67 × grounding 1 × language 1
});

test("all-3-differ → PENDING-LLM (never a confident pick)", async () => {
  const ev = await evaluateWithConfidence(base(mockLLM([run("no-process"), run("not-transparent"), run("public-log")])));
  assert.equal(ev.status, "pending-llm");
  assert.equal(ev.value.reason, "runs-disagree");
  assert.equal(ev.value.founderFlag, true);
  assert.equal(ev.confidence, 0);
});

test("tie (2 buckets at equal count, no majority) → PENDING-LLM", async () => {
  // N=4: 2 vs 2 → tie, no majority.
  const ev = await evaluateWithConfidence(base(mockLLM([run("public-log"), run("public-log"), run("transparent-timely"), run("transparent-timely")]), { ctx: { runs: 4 } }));
  assert.equal(ev.status, "pending-llm");
  assert.equal(ev.value.reason, "runs-tie");
});

// ── grounding ────────────────────────────────────────────────────────────────
test("missing/ungrounded quote → confidence penalty + ungrounded flag (not a confident answer)", async () => {
  // 3/3 on bucket, but quotes are NOT in the text → ungrounded.
  const fake = "this passage does not appear anywhere in the source text at all";
  const ev = await evaluateWithConfidence(base(mockLLM([run("public-log", fake), run("public-log", ""), run("public-log", fake)])));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.ungrounded, true);
  assert.equal(ev.value.groundingFactor, 0);
  assert.equal(ev.confidence, 0.4); // agreement 1 × UNGROUNDED_FACTOR 0.4 × language 1
  assert.equal(ev.value.founderFlag, true); // ungrounded always flags
});

test("grounding quote must actually appear in the text (verbatim, not paraphrase)", () => {
  // parseJudgment keeps the raw; isGrounded is enforced inside the harness via the
  // 3/3-ungrounded test above. Here assert parseJudgment rejects out-of-rubric bucket.
  assert.equal(parseJudgment({ bucket: "made-up-level", groundingQuote: QUOTE }, LEVELS).bucket, null);
  assert.equal(parseJudgment({ bucket: "public-log", groundingQuote: QUOTE }, LEVELS).bucket, "public-log");
  assert.equal(parseJudgment(null, LEVELS).bucket, null);
});

// ── language / observability factor (§7.4) ────────────────────────────────────
test("language factor: same agreement, less-supported language → LOWER confidence (visible)", async () => {
  const en = await evaluateWithConfidence(base(mockLLM([run("public-log"), run("public-log"), run("public-log")]), { input: { language: "en" } }));
  const sw = await evaluateWithConfidence(base(mockLLM([run("public-log"), run("public-log"), run("public-log")]), { input: { language: "sw" } }));
  assert.equal(en.confidence, 1);
  assert.equal(sw.value.languageFactor, 0.7);
  assert.equal(sw.value.language, "sw");
  assert.ok(sw.confidence < en.confidence, `low-resource language must lower confidence (en=${en.confidence} sw=${sw.confidence})`);
  assert.equal(sw.confidence, 0.7);
});

test("unspecified language → factor 1 but recorded as 'unspecified' (absence visible, no invented penalty)", async () => {
  const ev = await evaluateWithConfidence(base(mockLLM([run("public-log"), run("public-log"), run("public-log")]), { input: { language: undefined } }));
  assert.equal(ev.value.languageFactor, 1);
  assert.equal(ev.value.language, "unspecified");
});

// ── kill switch + no-input + no-commit ───────────────────────────────────────
test("LLM_DISABLED → PENDING-LLM, no fabricated score, NO calls made", async () => {
  const prev = process.env.LLM_DISABLED;
  process.env.LLM_DISABLED = "1";
  try {
    const llm = mockLLM([run("public-log")]);
    const ev = await evaluateWithConfidence(base(llm));
    assert.equal(ev.status, "pending-llm");
    assert.equal(ev.value.reason, "llm-disabled");
    assert.equal(ev.confidence, 0);
    assert.equal(llm.calls.length, 0, "must not call the LLM when disabled");
  } finally {
    if (prev === undefined) delete process.env.LLM_DISABLED; else process.env.LLM_DISABLED = prev;
  }
});

test("no usable input text → UNAVAILABLE", async () => {
  const ev = await evaluateWithConfidence(base(mockLLM([]), { input: { text: "   " } }));
  assert.equal(ev.status, "unavailable");
  assert.equal(ev.value.reason, "no-input-text");
});

test("all runs fail/refuse (null) → PENDING-LLM (no-committed-runs), not a confident 0", async () => {
  const ev = await evaluateWithConfidence(base(mockLLM([null, null, null])));
  assert.equal(ev.status, "pending-llm");
  assert.equal(ev.value.reason, "no-committed-runs");
  assert.equal(ev.value.founderFlag, true);
});

test("failed runs depress agreement honestly (2 commit same bucket of 3 → 0.67, not 1.0)", async () => {
  const ev = await evaluateWithConfidence(base(mockLLM([run("public-log"), run("public-log"), null])));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.agreement, 0.67, "a failed 3rd run lowers agreement vs 2 successes");
});

test("rubric without levels throws (programmer error, surfaced loudly)", async () => {
  await assert.rejects(
    evaluateWithConfidence({ subCriterion: "_test", input: { text: TEXT }, rubric: {}, ctx: { llmCall: mockLLM([]), buildPrompt: () => "P" } }),
    /rubric\.levels/,
  );
});

// ── promptLoader (the gitignored-prompt mechanism) ───────────────────────────
test("promptLoader loads the committed redacted template + builds a grounded prompt", async () => {
  const { buildPrompt, meta } = await loadPrompt("_example.template");
  assert.equal(typeof buildPrompt, "function");
  assert.equal(meta.subCriterion, "_example");
  const prompt = buildPrompt({ text: "By Jane Smith" }, { levels: LEVELS });
  assert.match(prompt, /RUBRIC LEVELS/);
  assert.match(prompt, /"bucket"/);          // the grounded-schema instruction is present
  assert.match(prompt, /By Jane Smith/);     // the input text is embedded
});

test("promptLoader: missing prompt → CLEAR actionable error (the fresh-clone case)", async () => {
  await assert.rejects(loadPrompt("2.9.z"), /not found .* gitignored|copy _example\.template\.js/i);
});

test("promptLoader: invalid id (path traversal) → rejected", async () => {
  await assert.rejects(loadPrompt("../../etc/passwd"), /invalid sub-criterion id/);
});

// ── schema helper ────────────────────────────────────────────────────────────
test("groundedRubricInstruction lists exactly the allowed buckets + forbids a confidence field", () => {
  const instr = groundedRubricInstruction(LEVELS);
  for (const l of LEVELS) assert.ok(instr.includes(JSON.stringify(l)), `instruction must list level ${l}`);
  assert.match(instr, /Do NOT include a confidence field/);
});
