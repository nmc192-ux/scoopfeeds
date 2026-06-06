/**
 * findRelevantJudgment.test.js — B.6.3c-2a gate tests (node --test, offline).
 *
 * Part A: the relevance-gate mechanism — parseJudgment sentinel, the harness
 * not-applicable reason, and the makeFindRelevantJudgment partition logic. Part B:
 * 2.2.c via the same factory. Mocked llmCall + buildPrompt + ctx.articleBodies; no
 * network, no real LLM.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseJudgment } from "./llm/groundedSchema.js";
import { evaluateWithConfidence } from "./llm/judgmentHarness.js";
import { makeFindRelevantJudgment } from "./llm/findRelevantJudgment.js";
import sourceMethodology from "./modules/sourceMethodologyDisclosure_2_2_c.js";

const NOW = 1_750_000_000_000;
const LEVELS = ["no disclosure", "partial", "most elements", "full (method+N+MoE+limits)"];

// ── parseJudgment sentinel ────────────────────────────────────────────────────
test("parseJudgment — reserved 'not-applicable' sentinel → bucket:null + notApplicable:true", () => {
  const r = parseJudgment({ bucket: "not-applicable", groundingQuote: "q", reasoning: "x" }, LEVELS);
  assert.equal(r.bucket, null);
  assert.equal(r.notApplicable, true);
});
test("parseJudgment — OTHER out-of-levels value → bucket:null, NO flag (garbage stays garbage)", () => {
  const r = parseJudgment({ bucket: "wat", groundingQuote: "q" }, LEVELS);
  assert.equal(r.bucket, null);
  assert.equal(r.notApplicable, undefined);
});
test("parseJudgment — in-rubric bucket → committed, no flag", () => {
  const r = parseJudgment({ bucket: "partial", groundingQuote: "q" }, LEVELS);
  assert.equal(r.bucket, "partial");
  assert.equal(r.notApplicable, undefined);
});

// ── harness not-applicable reason ─────────────────────────────────────────────
const NA = { bucket: "not-applicable", groundingQuote: "", reasoning: "not a data piece" };
function queueLLM(raws) { let i = 0; const calls = []; const fn = async (p) => { calls.push(p); return raws[i++] ?? null; }; fn.calls = calls; return fn; }
const hctx = (llmCall) => ({ now: NOW, llmCall, buildPrompt: () => "P" });

test("harness — all-sentinel runs → pending-llm reason 'not-applicable' (distinct from no-committed)", async () => {
  const ev = await evaluateWithConfidence({ subCriterion: "2.2.c", rubric: { levels: LEVELS }, input: { text: "straight news" }, ctx: hctx(queueLLM([NA, NA, NA])) });
  assert.equal(ev.status, "pending-llm");
  assert.equal(ev.value.reason, "not-applicable");
  assert.equal(ev.value.notApplicable, true);
});
test("harness — sentinel-dominant (2 of 3) → 'not-applicable'", async () => {
  const ev = await evaluateWithConfidence({ subCriterion: "2.2.c", rubric: { levels: LEVELS }, input: { text: "x" }, ctx: hctx(queueLLM([NA, NA, null])) });
  assert.equal(ev.value.reason, "not-applicable");
});
test("harness — only 1 sentinel of 3 (rest can't-decide) → 'no-committed-runs' (NOT not-applicable)", async () => {
  const ev = await evaluateWithConfidence({ subCriterion: "2.2.c", rubric: { levels: LEVELS }, input: { text: "x" }, ctx: hctx(queueLLM([NA, null, null])) });
  assert.equal(ev.value.reason, "no-committed-runs");
  assert.equal(ev.value.notApplicable, undefined);
});

// ── makeFindRelevantJudgment partition ────────────────────────────────────────
const j = (bucket, quote) => ({ bucket, groundingQuote: quote, reasoning: "r" });
function body(text, { ok = true, finalUrl = "https://x.example/a" } = {}) {
  return { url: finalUrl, finalUrl, language: "en", category: "tech", title: "t", text, truncated: false, ok };
}
const TEXT = "An article body long enough to ground a verbatim quote about disclosure and methodology here.";
const Q = "ground a verbatim quote about disclosure";
const gate = makeFindRelevantJudgment({ id: "_gate_test", component: "MT", levels: LEVELS });
const ctxBodies = (bodies, raws) => ({ now: NOW, articleBodies: bodies, llmCall: queueLLM(raws), buildPrompt: () => "P" });

test("committed > 0 → EVIDENCED via aggregator (non-applicable articles dropped)", async () => {
  const bodies = [body(TEXT), body(TEXT)];
  // body1: 3× 'most elements'; body2: 3× sentinel (not a data piece)
  const raws = [j("most elements", Q), j("most elements", Q), j("most elements", Q), NA, NA, NA];
  const ev = await gate.gather({ id: 1, name: "S" }, ctxBodies(bodies, raws));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.bucket, "most elements");
  assert.equal(ev.value.sampleCommitted, 1, "aggregated over the 1 relevant article only");
  assert.equal(ev.value.articlesSeen, 2);
});

test("all-not-applicable → UNAVAILABLE 'no-relevant-article-in-sample' (NOT levels[0], NOT fetch-fail)", async () => {
  const bodies = [body(TEXT), body(TEXT), body(TEXT)];
  const raws = [NA, NA, NA, NA, NA, NA, NA, NA, NA];
  const ev = await gate.gather({ id: 1, name: "S" }, ctxBodies(bodies, raws));
  assert.equal(ev.status, "unavailable");
  assert.equal(ev.value.reason, "no-relevant-article-in-sample");
  assert.equal(ev.value.notApplicableCount, 3);
  assert.equal(ev.value.articlesSeen, 3);
  assert.equal(ev.value.bucket, undefined);
  assert.equal(ev.value.founderFlag, false);
});

test("no ok bodies → pending-llm 'no-article-bodies' (couldn't-observe, NOT no-relevant)", async () => {
  const bodies = [body("", { ok: false }), body("", { ok: false })];
  const llm = queueLLM([j("partial", Q)]);
  const ev = await gate.gather({ id: 1, name: "S" }, { now: NOW, articleBodies: bodies, llmCall: llm, buildPrompt: () => "P" });
  assert.equal(ev.status, "pending-llm");
  assert.equal(ev.value.reason, "no-article-bodies");
  assert.equal(llm.calls.length, 0);
});

test("genuine split dominates (no sentinel) → pending-llm 'no-committed-articles'", async () => {
  const bodies = [body(TEXT)];
  const raws = [j("no disclosure", Q), j("partial", Q), j("most elements", Q)]; // 3 distinct → harness pending-llm no-committed-runs
  const ev = await gate.gather({ id: 1, name: "S" }, ctxBodies(bodies, raws));
  assert.equal(ev.status, "pending-llm");
  assert.equal(ev.value.reason, "no-committed-articles");
  assert.equal(ev.value.notApplicableCount, 0);
});

test("mixed: 1 committed data piece + 2 N/A → EVIDENCED over the committed one", async () => {
  const bodies = [body(TEXT), body(TEXT), body(TEXT)];
  const raws = [j("full (method+N+MoE+limits)", Q), j("full (method+N+MoE+limits)", Q), j("full (method+N+MoE+limits)", Q), NA, NA, NA, NA, NA, NA];
  const ev = await gate.gather({ id: 1, name: "S" }, ctxBodies(bodies, raws));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.bucket, "full (method+N+MoE+limits)");
  assert.equal(ev.value.sampleCommitted, 1);
});

// ── Part B — 2.2.c module ─────────────────────────────────────────────────────
test("2.2.c — module shape: id/component/needsArticleBodies/ttl", () => {
  assert.equal(sourceMethodology.id, "2.2.c");
  assert.equal(sourceMethodology.component, "MT");
  assert.equal(sourceMethodology.needsArticleBodies, true);
  assert.equal(sourceMethodology.ttlDays, 120);
});

test("2.2.c — full-disclosure data body → high bucket; quant-no-method → levels[0] grounded; straight-news → unavailable", async () => {
  // full disclosure
  let ev = await sourceMethodology.gather({ id: 1, name: "S" }, ctxBodies([body("Survey of 1,200 adults, ±3% margin of error, methodology described.")], [j("full (method+N+MoE+limits)", "±3% margin of error"), j("full (method+N+MoE+limits)", "±3% margin of error"), j("full (method+N+MoE+limits)", "methodology described")]));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.bucket, "full (method+N+MoE+limits)");

  // quant claim, no method → levels[0] with a locus quote
  const quant = "A poll found 62% support, but no methodology or sample size is given.";
  ev = await sourceMethodology.gather({ id: 1, name: "S" }, ctxBodies([body(quant)], [j("no disclosure", "A poll found 62% support"), j("no disclosure", "A poll found 62% support"), j("no disclosure", "no methodology or sample size")]));
  assert.equal(ev.value.bucket, "no disclosure");
  assert.equal(ev.value.ungroundedAtSource, false);

  // straight news → all sentinel → unavailable
  ev = await sourceMethodology.gather({ id: 1, name: "S" }, ctxBodies([body("A council approved a budget on Tuesday.")], [NA, NA, NA]));
  assert.equal(ev.status, "unavailable");
  assert.equal(ev.value.reason, "no-relevant-article-in-sample");
});
