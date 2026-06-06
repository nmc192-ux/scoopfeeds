/**
 * aggregateAcrossArticles.test.js — B.6.3c-1 aggregator unit tests (deterministic;
 * no network, no LLM). Covers unanimous, conservative-lower tie-break,
 * modalShare→confidence math, ungrounded-article quote exclusion, N===0 → pending-llm,
 * and mixed committed/pending input.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateAcrossArticles } from "./llm/aggregateAcrossArticles.js";

const LEVELS = ["only other news", "mostly secondary", "mixed", "experts/primary sources"];

// Build a per-article evidenced result.
const ev = (bucket, confidence, quotes = ["a verbatim grounded quote"], url = "https://x.example/a") => ({
  status: "evidenced",
  confidence,
  evidenceUrl: url,
  value: { bucket, groundingQuotes: quotes, ungrounded: quotes.length === 0 },
});
const pending = () => ({ status: "pending-llm", confidence: 0, evidenceUrl: null, value: { reason: "runs-disagree" } });

test("unanimous → that bucket, modalShare 1, confidence = mean", () => {
  const r = aggregateAcrossArticles([ev("mixed", 0.8), ev("mixed", 0.6), ev("mixed", 1.0)], { levels: LEVELS });
  assert.equal(r.status, "evidenced");
  assert.equal(r.value.bucket, "mixed");
  assert.equal(r.value.modalShare, 1);
  assert.equal(r.value.meanConfidence, 0.8);
  assert.equal(r.confidence, 0.8); // 0.8 × 1
  assert.equal(r.value.sampleCommitted, 3);
  assert.equal(r.value.articlesSeen, 3);
});

test("tie → resolves to the LOWER bucket (conservative)", () => {
  // 1 'mixed' (idx2) vs 1 'mostly secondary' (idx1) → tie → lower = 'mostly secondary'.
  const r = aggregateAcrossArticles([ev("mixed", 0.9), ev("mostly secondary", 0.9)], { levels: LEVELS });
  assert.equal(r.value.bucket, "mostly secondary");
  assert.equal(r.value.modalShare, 0.5);
  assert.equal(r.confidence, round2(0.9 * 0.5));
});

test("modalShare depresses confidence (2 of 3 modal)", () => {
  const r = aggregateAcrossArticles([ev("experts/primary sources", 0.9), ev("experts/primary sources", 0.9), ev("mixed", 0.6)], { levels: LEVELS });
  assert.equal(r.value.bucket, "experts/primary sources");
  assert.equal(r.value.modalShare, round2(2 / 3)); // 0.67
  assert.equal(r.value.meanConfidence, 0.8); // (0.9+0.9+0.6)/3
  // confidence uses the REPORTED (rounded) modalShare so the shown fields multiply out:
  assert.equal(r.confidence, round2(0.8 * 0.67)); // 0.54

});

test("quotes come ONLY from modal-bucket articles; ungrounded modal article contributes none", () => {
  const r = aggregateAcrossArticles([
    ev("mixed", 0.8, ["quote from mixed art 1"], "https://x.example/1"),
    ev("mixed", 0.8, [], "https://x.example/2"),                 // modal but ungrounded → no quote
    ev("only other news", 0.8, ["should NOT appear"], "https://x.example/3"), // non-modal
  ], { levels: LEVELS });
  assert.equal(r.value.bucket, "mixed");
  assert.equal(r.value.quotes.length, 1);
  assert.equal(r.value.quotes[0].quote, "quote from mixed art 1");
  assert.equal(r.value.quotes[0].article, "https://x.example/1");
  assert.equal(r.value.ungroundedAtSource, false);
});

test("modal bucket with NO surviving quotes → ungroundedAtSource + founderFlag", () => {
  const r = aggregateAcrossArticles([ev("mixed", 0.9, []), ev("mixed", 0.9, [])], { levels: LEVELS });
  assert.equal(r.value.bucket, "mixed");
  assert.equal(r.value.ungroundedAtSource, true);
  assert.equal(r.value.founderFlag, true);
});

test("N === 0 (all pending) → source PENDING-LLM, never levels[0]", () => {
  const r = aggregateAcrossArticles([pending(), pending()], { levels: LEVELS });
  assert.equal(r.status, "pending-llm");
  assert.equal(r.value.reason, "no-committed-articles");
  assert.equal(r.value.sampleCommitted, 0);
  assert.equal(r.value.articlesSeen, 2);
  assert.notEqual(r.value.bucket, LEVELS[0]);
  assert.equal(r.value.bucket, undefined);
});

test("mixed committed/pending — only committed count toward N + modal", () => {
  const r = aggregateAcrossArticles([ev("mixed", 0.8), pending(), ev("mixed", 0.6), pending()], { levels: LEVELS });
  assert.equal(r.status, "evidenced");
  assert.equal(r.value.sampleCommitted, 2);
  assert.equal(r.value.articlesSeen, 4);
  assert.equal(r.value.bucket, "mixed");
  assert.equal(r.value.modalShare, 1);
});

test("founderFlag set when confidence < 0.5", () => {
  const r = aggregateAcrossArticles([ev("mixed", 0.4), ev("only other news", 0.4)], { levels: LEVELS }); // tie→lower, conf 0.4×0.5=0.2
  assert.ok(r.confidence < 0.5);
  assert.equal(r.value.founderFlag, true);
});

test("out-of-rubric bucket is ignored (defensive)", () => {
  const r = aggregateAcrossArticles([ev("mixed", 0.8), ev("not-a-level", 0.9)], { levels: LEVELS });
  assert.equal(r.value.sampleCommitted, 1);
  assert.equal(r.value.bucket, "mixed");
});

test("requires levels", () => {
  assert.throws(() => aggregateAcrossArticles([], {}), /levels/);
});

function round2(n) { return Math.round(n * 100) / 100; }
