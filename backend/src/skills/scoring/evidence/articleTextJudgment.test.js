/**
 * articleTextJudgment.test.js — B.6.3c-1 judgment-module tests (node --test, offline).
 *
 * The three article-text judgments (2.2.a, 2.1.e, 2.3.d) via the makeArticleTextJudgment
 * factory, exercised with injected ctx.articleBodies + ctx.llmCall + ctx.buildPrompt
 * (no real LLM, no network). Proves: multi-article → modal bucket + confidence; all
 * per-article pending → source pending-llm; no ok bodies → couldn't-observe (NOT
 * levels[0]); levels[0] only when a locus quote is present; needsArticleBodies flag.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import sourceAttribution from "./modules/sourceAttribution_2_2_a.js";
import newsOpinion from "./modules/newsOpinionSeparation_2_1_e.js";
import sourcingQuality from "./modules/sourcingQuality_2_3_d.js";

const NOW = 1_750_000_000_000;

// A fake llmCall: a queue of raw results consumed in call order (harness calls it N×perBody).
function queueLLM(rawQueue) {
  let i = 0;
  const calls = [];
  const fn = async (prompt) => { calls.push(prompt); return rawQueue[i++] ?? null; };
  fn.calls = calls;
  return fn;
}
const j = (bucket, quote) => ({ bucket, groundingQuote: quote, reasoning: "r" });

function body(text, { ok = true, finalUrl = "https://x.example/a", truncated = false } = {}) {
  return { url: finalUrl, finalUrl, language: "en", category: "news", title: "t", text, truncated, ok };
}
const ctxWith = (bodies, llmCall) => ({ now: NOW, articleBodies: bodies, llmCall, buildPrompt: () => "PROMPT" });

// 3 bodies, each judged with 3 runs → 9 raw results in call order.
const TEXT = "An article body with enough prose to ground a quote about attribution and sourcing here.";
const QUOTE = "enough prose to ground a quote";

test("needsArticleBodies flag is set on all three", () => {
  for (const m of [sourceAttribution, newsOpinion, sourcingQuality]) assert.equal(m.needsArticleBodies, true);
  assert.equal(sourceAttribution.id, "2.2.a");
  assert.equal(newsOpinion.id, "2.1.e");
  assert.equal(sourcingQuality.id, "2.3.d");
  assert.equal(sourceAttribution.ttlDays, 120);
});

test("2.2.a — 3 bodies all judged 'mostly attributed' → source EVIDENCED, modalShare 1", async () => {
  const bodies = [body(TEXT), body(TEXT), body(TEXT)];
  const raw = [];
  for (let b = 0; b < 3; b++) for (let r = 0; r < 3; r++) raw.push(j("mostly attributed", QUOTE));
  const ev = await sourceAttribution.gather({ id: 1, name: "S" }, ctxWith(bodies, queueLLM(raw)));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.bucket, "mostly attributed");
  assert.equal(ev.value.modalShare, 1);
  assert.equal(ev.value.sampleCommitted, 3);
  assert.equal(ev.value.articlesSeen, 3);
  assert.equal(ev.gatheredAt, NOW);
  assert.ok(ev.value.quotes.length >= 1, "source verdict carries grounded quotes");
});

test("2.3.d — per-article disagreement across the sample → source aggregates modal bucket", async () => {
  // body1: 3× 'mixed'; body2: 3× 'mixed'; body3: 3× 'experts/primary sources'
  const bodies = [body(TEXT), body(TEXT), body(TEXT)];
  const raw = [
    j("mixed", QUOTE), j("mixed", QUOTE), j("mixed", QUOTE),
    j("mixed", QUOTE), j("mixed", QUOTE), j("mixed", QUOTE),
    j("experts/primary sources", QUOTE), j("experts/primary sources", QUOTE), j("experts/primary sources", QUOTE),
  ];
  const ev = await sourcingQuality.gather({ id: 1, name: "S" }, ctxWith(bodies, queueLLM(raw)));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.bucket, "mixed");           // 2 of 3 articles
  assert.equal(ev.value.modalShare, round2(2 / 3));
  assert.equal(ev.value.sampleCommitted, 3);
});

test("all per-article runs split → every article pending-llm → source PENDING-LLM (not levels[0])", async () => {
  const bodies = [body(TEXT), body(TEXT)];
  // each body: 3 distinct buckets → harness pending-llm; 2 bodies = 6 raw
  const raw = [
    j("only other news", QUOTE), j("mostly secondary", QUOTE), j("mixed", QUOTE),
    j("only other news", QUOTE), j("mostly secondary", QUOTE), j("experts/primary sources", QUOTE),
  ];
  const ev = await sourcingQuality.gather({ id: 1, name: "S" }, ctxWith(bodies, queueLLM(raw)));
  assert.equal(ev.status, "pending-llm");
  assert.equal(ev.value.reason, "no-committed-articles");
  assert.notEqual(ev.value.bucket, "only other news");
  assert.equal(ev.value.bucket, undefined);
  assert.equal(ev.value.founderFlag, true);
});

test("no ok bodies → couldn't-observe PENDING-LLM (NOT levels[0]), no LLM calls", async () => {
  const bodies = [body("", { ok: false }), body("", { ok: false })];
  const llm = queueLLM([j("unattributed", QUOTE)]);
  const ev = await sourceAttribution.gather({ id: 1, name: "S" }, ctxWith(bodies, llm));
  assert.equal(ev.status, "pending-llm");
  assert.equal(ev.value.reason, "no-article-bodies");
  assert.equal(ev.value.articlesSeen, 2);
  assert.equal(ev.value.bucket, undefined);
  assert.equal(llm.calls.length, 0, "no judgment attempted without ok bodies");
});

test("ctx.articleBodies null/absent → couldn't-observe PENDING-LLM", async () => {
  const ev = await newsOpinion.gather({ id: 1, name: "S" }, { now: NOW, llmCall: queueLLM([]), buildPrompt: () => "P" });
  assert.equal(ev.status, "pending-llm");
  assert.equal(ev.value.reason, "no-article-bodies");
});

test("levels[0] only reachable WITH a locus quote (grounded) → 2.1.e 'no separation' grounded", async () => {
  // Body text contains the offending opinion passage the model quotes as the locus.
  const opinion = "This reckless policy is an outrage and the minister must resign immediately.";
  const bodies = [body(`News intro. ${opinion} More text.`)];
  const raw = [j("no separation", opinion), j("no separation", opinion), j("no separation", opinion)];
  const ev = await newsOpinion.gather({ id: 1, name: "S" }, ctxWith(bodies, queueLLM(raw)));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.bucket, "no separation");
  assert.equal(ev.value.ungroundedAtSource, false, "locus quote grounds the lowest bucket");
  assert.equal(ev.value.quotes[0].quote, opinion);
});

test("levels[0] with an UNVERIFIABLE quote → ungroundedAtSource + founderFlag (not trusted)", async () => {
  const bodies = [body("Plain neutral news text with no opinion at all.")];
  const fake = "this offending passage is NOT in the body text";
  const raw = [j("no separation", fake), j("no separation", fake), j("no separation", fake)];
  const ev = await newsOpinion.gather({ id: 1, name: "S" }, ctxWith(bodies, queueLLM(raw)));
  // harness marks each run ungrounded → still evidenced 'no separation' but ungrounded;
  // aggregator finds no surviving quote → ungroundedAtSource + founderFlag.
  assert.equal(ev.value.bucket, "no separation");
  assert.equal(ev.value.ungroundedAtSource, true);
  assert.equal(ev.value.founderFlag, true);
});

function round2(n) { return Math.round(n * 100) / 100; }
