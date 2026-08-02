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
import { readFileSync } from "node:fs";
import { _internals, writeVideoSpec } from "./videoSpecWriter.js";

const { extractJsonPayload, buildSpecPrompt } = _internals;

// ─── The return contract: a result object on EVERY path, never null ─────────
//
// The prod dry run of 2026-08-03 died here. d7e2c6e changed writeVideoSpec from
// null-or-spec to `{ ok, spec, costUsd, reason, attempts }` and the caller
// started reading `r.costUsd` BEFORE `r.ok` — but the too-thin path still
// returned bare null. The first thin article therefore threw
// "Cannot read properties of null (reading 'costUsd')" out of the whole cycle,
// and every later candidate was never attempted. One survivor of an old
// contract cost the entire run.
//
// Both halves are pinned: the shape is asserted, and the source is walked so a
// future `return null` cannot be reintroduced without failing.

const SPEC_KEYS = ["ok", "spec", "costUsd", "reason", "attempts"];

function assertResultShape(r, label) {
  assert.notEqual(r, null, `${label}: writeVideoSpec returned null — the contract is a result object`);
  assert.equal(typeof r, "object", `${label}: expected an object`);
  for (const k of SPEC_KEYS) {
    assert.ok(k in r, `${label}: result is missing "${k}" — the caller reads all five`);
  }
  assert.equal(typeof r.ok, "boolean", `${label}: ok must be a boolean`);
  assert.equal(typeof r.costUsd, "number", `${label}: costUsd must be a number, the caller sums it`);
  assert.ok(Number.isFinite(r.costUsd), `${label}: costUsd must be finite`);
  if (!r.ok) {
    assert.equal(r.spec, null, `${label}: a rejection must carry spec:null`);
    assert.equal(typeof r.reason, "string", `${label}: a rejection must explain itself`);
    assert.ok(r.reason.length > 0, `${label}: reason must not be empty`);
  }
}

test("writeVideoSpec has no `return null` — every exit is a result object", () => {
  const raw = readFileSync(new URL("./videoSpecWriter.js", import.meta.url), "utf8");
  const start = raw.indexOf("export async function writeVideoSpec");
  assert.ok(start !== -1, "writeVideoSpec not found");
  // Ends at the next top-level export — writePackaging.
  const end = raw.indexOf("\nexport ", start + 1);
  assert.ok(end > start, "could not bound writeVideoSpec's body");
  const body = raw.slice(start, end);

  const returns = [...body.matchAll(/\breturn\b([^\n]*)/g)].map(m => m[1].trim());
  assert.ok(returns.length >= 6, `expected every exit path present, found ${returns.length}`);
  for (const r of returns) {
    assert.ok(
      r.startsWith("reject(") || r.startsWith("{ ok: true"),
      `writeVideoSpec exit must be reject(...) or a { ok: true } object, found: return ${r}`
    );
  }
  assert.ok(!/\breturn\s+null\b/.test(body),
    "writeVideoSpec must never return null — the caller reads .costUsd before .ok");
});

test("the too-thin path returns a result carrying its spend, not null", () => {
  // The exact prod sequence, pinned at the source level: the too-thin branch is
  // the one that regressed, and it must hand back both spentUsd and attempts —
  // a rejected article still paid for its model call.
  const raw = readFileSync(new URL("./videoSpecWriter.js", import.meta.url), "utf8");
  const branch = raw.slice(raw.indexOf("if (v.errors.some(isThinnessError))"));
  const exit = branch.slice(0, branch.indexOf("if (attempts === 1)"));
  assert.match(exit, /return reject\(/, "the too-thin branch must return a rejection object");
  assert.match(exit, /spentUsd/, "the too-thin rejection must carry the spend it already incurred");
  assert.match(exit, /attempts/, "the too-thin rejection must carry the attempt count");
});

test("every reachable rejection path has the full result shape", async () => {
  // No network: both of these exit before any model call.
  const saved = process.env.VIDEO_SPEC_ENABLED;
  process.env.VIDEO_SPEC_ENABLED = "";
  try {
    assertResultShape(await writeVideoSpec({ id: "a", title: "T" }), "flag unset");
  } finally {
    if (saved === undefined) delete process.env.VIDEO_SPEC_ENABLED;
    else process.env.VIDEO_SPEC_ENABLED = saved;
  }
});

// ─── The prompt must contain NO slide count ─────────────────────────────────
//
// Measured 2026-08-02: given "AT LEAST 6 and AT MOST N", all three articles
// returned EXACTLY 6 — the floor — with an identical card mix, including a
// story carrying 30 allowed sources. The run before that anchored on the
// ceiling and padded to it. The model does not weigh a stated range; it
// anchors on the nearest number. These tests exist so a well-meaning future
// edit cannot quietly reintroduce one.

const promptFor = (over = {}) => buildSpecPrompt({
  article: { title: "T", description: "D", content: "C", source_name: "Reuters", category: "world" },
  allowedSources: ["Reuters", "BBC News"],
  ...over,
});

test("the spec prompt states no slide count, in any form", () => {
  const p = promptFor();
  // Scoped to the VIDEO'S LENGTH. Per-card field constraints are a different
  // thing entirely and must survive — see the bars assertion below.
  const banned = [
    /\bAT LEAST \d+ cards?\b/i, /\bAT MOST \d+ cards?\b/i,
    /\bemit \d+ cards?\b/i, /\bexactly \d+ cards?\b/i,
    /\b\d+\s*(?:to|-|–)\s*\d+\s*cards?\b/i,
    /\baim for (?:about |roughly )?\d+\s*(?:cards?|slides?|words?)\b/i,
    /\b\d+\s*seconds?\b/i, /\b\d+\s*slides?\b/i, /\b\d+\s*minutes?\b/i,
    /target duration/i, /maximum runtime/i,
  ];
  for (const re of banned) {
    const m = p.match(re);
    assert.ok(!m, `prompt must not contain a length instruction matching ${re} — found ${JSON.stringify(m?.[0])}`);
  }
});

test("per-card field constraints survive — they are not length instructions", () => {
  const p = promptFor();
  assert.match(p, /"bars" MUST contain AT LEAST 2 entries/);
  assert.match(p, /AT MOST ONE line may have the colour "lime"/);
});

test("the prompt demands beats AS OUTPUT, before the slides", () => {
  const p = promptFor();
  assert.match(p, /ENUMERATE THE BEATS — AS OUTPUT, BEFORE THE SLIDES/);
  for (const kind of ["figure", "mechanism", "turn", "consequence"]) {
    assert.match(p, new RegExp(`"${kind}"`));
  }
  assert.match(p, /KINDS, not a checklist/);
  assert.match(p, /ONE CARD PER BEAT/i);
  assert.match(p, /a discovery you make, never a decision/);
  // The return shape names beats before slides.
  const shape = p.slice(p.lastIndexOf("Return ONLY a JSON object"));
  assert.ok(shape.indexOf('"beats"') !== -1 && shape.indexOf('"beats"') < shape.indexOf('"slides"'),
    "return shape must show beats before slides");
});

test("the worked example enumerates 12+ beats and is fenced off from grounding", () => {
  const p = promptFor();
  const example = p.slice(p.indexOf("WORKED EXAMPLE"));
  assert.ok(example.length > 100, "worked example must be present");
  const beatEntries = (example.match(/"kind":\s*"/g) || []).length;
  assert.ok(beatEntries >= 12, `worked example must show 12+ beats, found ${beatEntries}`);
  assert.match(example, /Twelve beats, because that source established twelve distinct things/);
  assert.match(example, /A thinner source might establish four/);
  assert.match(p, /ILLUSTRATIVE ONLY/);
  assert.match(p, /never reuse its facts, figures, or wording/);
});

// ─── Regression guard: every rejection log names its model ──────────────────

test("no logRejection call site omits `model`", () => {
  // a63b45d made the model per-call and updated three of five sites. The two it
  // missed logged `model=undefined` in production, on the too-thin and
  // exhausted-retries paths — invisible until a live run surfaced it.
  const raw = readFileSync(new URL("./videoSpecWriter.js", import.meta.url), "utf8");
  const calls = [...raw.matchAll(/logRejection\(\{[\s\S]*?\}\);/g)].map(m => m[0]);
  assert.ok(calls.length >= 6, `expected every rejection path covered, found ${calls.length}`);
  for (const c of calls) {
    assert.match(c, /\bmodel\b\s*[:,}]/, `logRejection call omits model:\n${c}`);
  }
});

// ─── INVALID_ARGUMENT classifier (evidence-gated, not a widened match) ──────

test("isInvalidArgument matches a bare 400 with no mention of thinking", () => {
  const { isInvalidArgument } = _internals;
  const err = { response: { status: 400, data: { error: { code: 400, message: "Request contains an invalid argument", status: "INVALID_ARGUMENT" } } } };
  assert.equal(isInvalidArgument(err), true);
});

test("isInvalidArgument ignores non-400s and unrelated 400s", () => {
  const { isInvalidArgument } = _internals;
  assert.equal(isInvalidArgument({ response: { status: 404 } }), false);
  assert.equal(isInvalidArgument({ response: { status: 429, data: { error: { message: "quota" } } } }), false);
  assert.equal(isInvalidArgument({ response: { status: 400, data: { error: { message: "API key not valid" } } } }), false);
});

test("the shared thinking classifier is NOT widened to bare 400s", () => {
  // Widening llmQueue's predicate would let any malformed request flip the
  // process-wide flag for igSummary, scriptWriter and llmQueue itself. The
  // probe lives here, gated on the retry's outcome, precisely to avoid that.
  const raw = readFileSync(new URL("../realityIndex/llmQueue.js", import.meta.url), "utf8");
  const fn = raw.slice(raw.indexOf("export function isGeminiThinkingRejection"));
  assert.match(fn.slice(0, 300), /\/thinking\/i\.test/);
  assert.ok(!/INVALID_ARGUMENT/.test(fn.slice(0, 300)),
    "the shared classifier must stay evidence-specific");
});

test("the probe only fires when thinkingConfig was actually sent", () => {
  const raw = readFileSync(new URL("./videoSpecWriter.js", import.meta.url), "utf8");
  assert.match(raw, /isInvalidArgument\(err\) && sentThinkingConfig && !thinkingRetryUsed/);
  // And the shared flag is flipped only after the retry SUCCEEDS.
  assert.match(raw, /if \(forceNoThinking && !thinkingConfirmed\)[\s\S]{0,200}markGeminiThinkingRejected/);
});

test("the prompt carries the SUPPLIED body text, not the stored content", () => {
  // Grounding and generation must see the same bytes: prompting with fetched
  // full text while screening against stored content would drop every
  // correctly-sourced figure drawn from the part the validator could not see.
  const p = buildSpecPrompt({
    article: { title: "T", description: "D", content: "STORED-ONLY-MARKER", source_name: "Reuters" },
    allowedSources: ["Reuters"],
    bodyText: "FETCHED-FULL-TEXT-MARKER with a great deal more detail.",
  });
  assert.match(p, /FETCHED-FULL-TEXT-MARKER/);
  assert.ok(!/STORED-ONLY-MARKER/.test(p), "stored content must not leak in when bodyText is supplied");
});

test("without bodyText the prompt falls back to stored content", () => {
  const p = buildSpecPrompt({
    article: { title: "T", content: "STORED-BODY-MARKER", source_name: "Reuters" },
    allowedSources: ["Reuters"],
  });
  assert.match(p, /STORED-BODY-MARKER/);
});

test("the retry correction note strips slide counts before the model sees it", () => {
  const { stripCounts } = _internals;
  assert.equal(stripCounts('only 4 slides remain after dropping 3 (< 6) — too thin for a video'), "too thin for a video");
  assert.match(stripCounts("too many slides: 41 > 34"), /enumerate the beats again/);
  assert.ok(!/\d/.test(stripCounts("too many slides: 41 > 34")));
  // Card-level adjacency facts are NOT counts of the video's length, and stay.
  assert.match(stripCounts('3 consecutive "stat" cards (max 2 in a row)'), /consecutive "stat" cards/);
});

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
