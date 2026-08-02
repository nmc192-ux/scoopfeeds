/**
 * videoSpecWriter.test.js — the tolerant JSON extractor.
 *
 * The live 2026-08-02 run lost specs to "unparseable_json" with no visible
 * cause. The extractor exists so a cosmetic wrapper (markdown fence, a line of
 * prose around the object) never costs an article; a genuinely truncated
 * payload must still come back null, because "tolerant" must never mean
 * "accepts a spec the model didn't finish".
 */

import test from "node:test";
import assert from "node:assert/strict";
import { _internals } from "./videoSpecWriter.js";

const { extractJsonPayload } = _internals;

test("exact JSON parses", () => {
  assert.deepEqual(extractJsonPayload('{"slides":[{"t":"title"}]}'), { slides: [{ t: "title" }] });
});

test("a markdown fence is stripped", () => {
  assert.deepEqual(extractJsonPayload('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonPayload('```\n{"a":1}\n```'), { a: 1 });
});

test("prose around the object is tolerated", () => {
  const raw = 'Here is the spec you asked for:\n{"a":{"b":[1,2]}}\nHope this helps!';
  assert.deepEqual(extractJsonPayload(raw), { a: { b: [1, 2] } });
});

test("braces and escaped quotes inside string values do not fool the scanner", () => {
  const raw = 'note: {"caption":"use } and { freely, say \\"hi\\"","x":1} trailing';
  assert.deepEqual(extractJsonPayload(raw), { caption: 'use } and { freely, say "hi"', x: 1 });
});

// ─── Trailing commas — the measured 2026-08-02 cause ────────────────────────

test("a trailing comma before } is repaired", () => {
  assert.deepEqual(extractJsonPayload('{"a":1,"b":2,}'), { a: 1, b: 2 });
});

test("a trailing comma before ] is repaired", () => {
  assert.deepEqual(extractJsonPayload('{"slides":[{"t":"title"},{"t":"kicker"},]}'), {
    slides: [{ t: "title" }, { t: "kicker" }],
  });
});

test("trailing commas are repaired inside a fence and around prose", () => {
  assert.deepEqual(extractJsonPayload('```json\n{"a":[1,2,],}\n```'), { a: [1, 2] });
  assert.deepEqual(extractJsonPayload('Here you go:\n{"a":[1,],}\ndone'), { a: [1] });
});

test("a comma before } INSIDE a string value is untouched", () => {
  const raw = '{"caption":"anchors, storms, and }, that is all","n":1,}';
  assert.deepEqual(extractJsonPayload(raw), { caption: "anchors, storms, and }, that is all", n: 1 });
});

test("repair does not rescue a genuinely truncated payload", () => {
  assert.equal(extractJsonPayload('{"slides":[{"t":"title"},'), null);
});

test("a truncated payload stays null — tolerance never accepts an unfinished spec", () => {
  assert.equal(extractJsonPayload('{"slides":[{"t":"title","lines":[["A","white"'), null);
});

test("no object at all stays null", () => {
  assert.equal(extractJsonPayload("I cannot produce a spec for this article."), null);
  assert.equal(extractJsonPayload(""), null);
  assert.equal(extractJsonPayload(null), null);
});
