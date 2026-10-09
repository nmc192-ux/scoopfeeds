/**
 * videoSpecWriter.callModel on llmQueue/Claude — the retry and rejection
 * behaviour that stayed in this module when the provider plumbing moved out:
 * the JSON-only reminder retry, the MAX_TOKENS hard rejection, the tolerant
 * trailing-comma extractor, and the rejection log lines.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SCOOP_PERSISTENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vsw-llm-"));
for (const k of ["VIDEO_SPEC_MODEL", "ANTHROPIC_MODEL", "LLM_DISABLED", "LLM_HEALTH_PING_URL"]) delete process.env[k];
Object.assign(process.env, { ANTHROPIC_API_KEY: "a-key", LLM_DAILY_CALL_CAP: "100000", LLM_RETRY_DELAYS_MS: "1,1,1", VIDEO_SPEC_ENABLED: "1" });

const { logger } = await import("./logger.js");
const { _test } = await import("../realityIndex/llmQueue.js");
const { _internals, isVideoSpecEnabled } = await import("./videoSpecWriter.js");
const { callModel } = _internals;

const claudeOk = (text, usage = { input_tokens: 2000, output_tokens: 1000 }, stop_reason = "end_turn") =>
  ({ content: [{ type: "text", text }], usage, stop_reason });
const err = (status, message) => Object.assign(new Error(message), { status });
function claude(handler) {
  const calls = [];
  _test.setAnthropicClient({ messages: { create: async (params, opts) => { calls.push({ params, opts }); return handler(calls.length, params); } } });
  return calls;
}
function warnings() {
  const lines = [];
  const ow = logger.warn, oe = logger.error;
  logger.warn = (...a) => { lines.push(a.map(String).join(" ")); };
  logger.error = (...a) => { lines.push(a.map(String).join(" ")); };
  return { lines, restore: () => { logger.warn = ow; logger.error = oe; } };
}
const OPTS = { articleId: "art-1", tag: "videoSpec", model: "claude-haiku-5-5", maxOutputTokens: 8192 };

test("isVideoSpecEnabled needs the flag AND an LLM credential", () => {
  assert.equal(isVideoSpecEnabled(), true);
  const k = process.env.VIDEO_SPEC_ENABLED; process.env.VIDEO_SPEC_ENABLED = "0";
  assert.equal(isVideoSpecEnabled(), false);
  process.env.VIDEO_SPEC_ENABLED = k;
});

test("spec call: request shape, parsed result, usage and cost from the price table", async () => {
  const calls = claude(() => claudeOk('{"slides":[],"beats":[]}'));
  const r = await callModel("PROMPT", OPTS);
  assert.deepEqual(r.parsed, { slides: [], beats: [] });
  assert.equal(r.finishReason, "STOP");
  assert.deepEqual(r.usage, { promptTokenCount: 2000, candidatesTokenCount: 1000, thoughtsTokenCount: 0 });
  assert.ok(Math.abs(r.cost - (0.002 * 0.10 + 0.001 * 0.50)) < 1e-9);
  const { params, opts } = calls[0];
  assert.equal(params.model, "claude-haiku-5-5");
  assert.equal(params.max_tokens, 8192);
  assert.equal(params.temperature, 0.3);
  assert.equal(opts.timeout, 60000);
});

test("a per-call model (e.g. VIDEO_SPEC_MODEL=claude-sonnet-5-5) is passed through and priced at sonnet rates", async () => {
  const calls = claude(() => claudeOk("{}", { input_tokens: 1_000_000, output_tokens: 100_000 }));
  const r = await callModel("PROMPT", { ...OPTS, model: "claude-sonnet-5-5" });
  assert.equal(calls[0].params.model, "claude-sonnet-5-5");
  assert.ok(Math.abs(r.cost - (2 + 1)) < 1e-9);
});

test("MAX_TOKENS is a HARD rejection with the existing log line, even though the JSON parses", async () => {
  claude(() => claudeOk('{"slides":[]}', undefined, "max_tokens"));
  const w = warnings();
  try {
    assert.equal(await callModel("PROMPT", OPTS), null);
    const line = w.lines.find(l => /truncated_max_tokens/.test(l));
    assert.ok(line, w.lines.join("\n"));
    assert.match(line, /videoSpec: rejected article art-1/);
    assert.match(line, /model=claude-haiku-5-5, finishReason=MAX_TOKENS/);
  } finally { w.restore(); }
});

test("non-JSON payload → ONE retry carrying the JSON-only reminder; the retry's answer is used", async () => {
  const calls = claude((i) => claudeOk(i === 1 ? "Sure! Here is the spec you asked for." : '{"ok":true}'));
  const w = warnings();
  try {
    const r = await callModel("PROMPT", OPTS);
    assert.deepEqual(r.parsed, { ok: true });
    assert.equal(calls.length, 2);
    assert.ok(!/STRICT OUTPUT REMINDER/.test(calls[0].params.messages[0].content));
    assert.match(calls[1].params.messages[0].content, /STRICT OUTPUT REMINDER/);
    assert.ok(w.lines.some(l => /non-JSON payload for article art-1 — one retry with JSON-only reminder\. head=/.test(l)));
  } finally { w.restore(); }
});

test("non-JSON twice → null with 'persisted after reminder retry' and an unparseable_json rejection", async () => {
  const calls = claude(() => claudeOk("still not json"));
  const w = warnings();
  try {
    assert.equal(await callModel("PROMPT", OPTS), null);
    assert.equal(calls.length, 2);
    assert.ok(w.lines.some(l => /persisted after reminder retry/.test(l)));
    assert.ok(w.lines.some(l => /unparseable_json/.test(l) && /model=claude-haiku-5-5/.test(l)));
  } finally { w.restore(); }
});

test("a trailing comma (the real 2026-08-02 failure) is repaired by this module's extractor, no retry spent", async () => {
  const calls = claude(() => claudeOk('{"slides":[1,2,],"beats":["a",],}'));
  const r = await callModel("PROMPT", OPTS);
  assert.deepEqual(r.parsed, { slides: [1, 2], beats: ["a"] });
  assert.equal(calls.length, 1);
});

test("transient 529 is retried by llmQueue (the module no longer sleeps); a hard 401 returns null with the caller-side log line", async () => {
  let calls = claude((i) => { if (i === 1) throw err(529, "overloaded"); return claudeOk('{"ok":1}'); });
  assert.deepEqual((await callModel("PROMPT", OPTS)).parsed, { ok: 1 });
  assert.equal(calls.length, 2);
  _test.breaker.recordSuccess("anthropic");
  calls = claude(() => { throw err(401, "invalid x-api-key"); });
  const w = warnings();
  try {
    assert.equal(await callModel("PROMPT", OPTS), null);
    assert.equal(calls.length, 1);
    assert.ok(w.lines.some(l => /videoSpec: call failed — model=claude-haiku-5-5 error=auth/.test(l)));
  } finally { w.restore(); _test.breaker.recordSuccess("anthropic"); }
});

test("empty body → 'empty' rejection naming the model", async () => {
  claude(() => ({ content: [], usage: { input_tokens: 10, output_tokens: 0 }, stop_reason: "end_turn" }));
  const w = warnings();
  try {
    assert.equal(await callModel("PROMPT", { ...OPTS, tag: "videoPackaging" }), null);
    assert.ok(w.lines.some(l => /videoPackaging: rejected article art-1 — empty/.test(l) && /model=claude-haiku-5-5/.test(l)));
  } finally { w.restore(); }
});
