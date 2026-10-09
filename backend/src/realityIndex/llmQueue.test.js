/**
 * llmQueue — Anthropic provider, per-task routing, hard-error fallback,
 * circuit breaker, text mode and usage logging.
 *
 * llmQueue reads its config (keys, LLM_TASK_PROVIDER, ...) at import, so each
 * scenario imports a FRESH instance via a cache-busting query string after
 * setting env. Gemini is stubbed at axios.post; Anthropic through the module's
 * client seam. No network, no real keys.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Must precede the first import of models/database.js.
process.env.SCOOP_PERSISTENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "llmq-test-"));

const { default: axios } = await import("axios");
const { logger } = await import("../services/logger.js");
const { getDb } = await import("../models/database.js");

const PROVIDER_ENV = [
  "LLM_PROVIDER", "LLM_PREMIUM_PROVIDER", "LLM_TASK_PROVIDER", "LLM_DISABLED", "GEMINI_DISABLED",
  "CEREBRAS_API_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "GROQ_API_KEY",
  "DEEPSEEK_API_KEY", "NVIDIA_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL",
  "GEMINI_GENERATION_MODEL", "LLM_FALLBACK_DISABLED", "LLM_BREAKER_THRESHOLD",
];

let n = 0;
async function load(env = {}) {
  for (const k of PROVIDER_ENV) delete process.env[k];
  process.env.LLM_DAILY_CALL_CAP = "100000";
  process.env.LLM_RETRY_DELAYS_MS = "1,1,1";
  Object.assign(process.env, { GEMINI_API_KEY: "g-key", ANTHROPIC_API_KEY: "a-key", LLM_PROVIDER: "gemini" }, env);
  for (const [k, v] of Object.entries(env)) if (v === null) delete process.env[k];
  return import(`./llmQueue.js?t=${++n}`);
}

const httpErr = (status, message, data) => Object.assign(new Error(message), { status, response: { status, data } });
const geminiOk = (text, usage = { promptTokenCount: 100, candidatesTokenCount: 50 }, finishReason = "STOP") =>
  ({ data: { candidates: [{ content: { parts: [{ text }] }, finishReason }], usageMetadata: usage } });
const anthropicOk = (text, usage = { input_tokens: 1000, output_tokens: 500 }, stop_reason = "end_turn") =>
  ({ content: [{ type: "text", text }], usage, stop_reason });

function stubGemini(handler) {
  const calls = [];
  const orig = axios.post;
  axios.post = async (url, body, cfg) => { calls.push({ url, body, cfg }); return handler(calls.length, { url, body, cfg }); };
  return { calls, restore: () => { axios.post = orig; } };
}
function fakeAnthropic(handler) {
  const calls = [];
  return { calls, messages: { create: async (params, opts) => { calls.push({ params, opts }); return handler(calls.length, params); } } };
}
function captureWarnings() {
  const lines = [];
  const orig = logger.warn;
  logger.warn = (...a) => { lines.push(a.map(String).join(" ")); };
  return { lines, restore: () => { logger.warn = orig; } };
}
const usageRows = (task) => getDb().prepare("SELECT * FROM llm_usage WHERE task = ? ORDER BY id").all(task);
const budgetCalls = (task) => getDb().prepare("SELECT COALESCE(SUM(calls),0) AS c FROM llm_daily_calls WHERE task = ? AND day = date('now')").get(task).c;

// ─── routing ───────────────────────────────────────────────────────────────

test("parseTaskProviderMap: valid pairs parse, junk and unknown providers are dropped, empty is {}", async () => {
  const q = await load();
  const w = captureWarnings();
  try {
    assert.deepEqual(q.parseTaskProviderMap("ig-summary=anthropic, actors = Anthropic"), { "ig-summary": "anthropic", actors: "anthropic" });
    assert.deepEqual(q.parseTaskProviderMap("actors=notaprovider,=gemini,lonely"), {});
    assert.equal(w.lines.filter(l => /LLM_TASK_PROVIDER: ignoring/.test(l)).length, 3);
    assert.deepEqual(q.parseTaskProviderMap(""), {});
    assert.deepEqual(q.parseTaskProviderMap(undefined), {});
  } finally { w.restore(); }
});

test("routing: with LLM_TASK_PROVIDER unset, an unlisted task keeps tier routing (zero change)", async () => {
  const q = await load({ LLM_PROVIDER: "gemini" });
  assert.equal(q._test.resolveRoute("standard", "actors").provider, "gemini");
  const g = stubGemini(() => geminiOk('{"x":1}'));
  const a = fakeAnthropic(() => { throw new Error("anthropic must not be called"); });
  q._test.setAnthropicClient(a);
  try {
    assert.deepEqual(await q.callJson("p", { task: "actors" }), { x: 1 });
    assert.equal(g.calls.length, 1);
    assert.equal(a.calls.length, 0);
  } finally { g.restore(); }
});

test("routing: a listed task goes to Anthropic, an unlisted one stays on Gemini", async () => {
  const q = await load({ LLM_TASK_PROVIDER: "actors=anthropic" });
  const a = fakeAnthropic(() => anthropicOk('{"who":"claude"}'));
  q._test.setAnthropicClient(a);
  const g = stubGemini(() => geminiOk('{"who":"gemini"}'));
  try {
    assert.deepEqual(await q.callJson("p", { task: "actors" }), { who: "claude" });
    assert.deepEqual(await q.callJson("p", { task: "market-match" }), { who: "gemini" });
    assert.equal(a.calls.length, 1);
    assert.equal(g.calls.length, 1);
  } finally { g.restore(); }
});

test("routing: an env override to a provider with no credentials is ignored (normal routing, one warning)", async () => {
  const q = await load({ LLM_TASK_PROVIDER: "actors=anthropic", ANTHROPIC_API_KEY: null });
  const w = captureWarnings();
  const g = stubGemini(() => geminiOk('{"ok":true}'));
  try {
    assert.equal(q._test.resolveRoute("standard", "actors").provider, "gemini");
    await q.callJson("p", { task: "actors" });
    await q.callJson("p", { task: "actors" });
    assert.equal(g.calls.length, 2);
    assert.equal(w.lines.filter(l => /no credentials/.test(l)).length, 1);
  } finally { g.restore(); w.restore(); }
});

test("routing: the four formerly-direct tasks stay on Gemini even when LLM_PROVIDER is another provider", async () => {
  const q = await load({ LLM_PROVIDER: "groq", GROQ_API_KEY: "q" });
  for (const task of ["live-events", "analysis-brief", "analysis-persp", "analysis-explained", "deep-dive", "ig-summary", "script-writer"]) {
    assert.equal(q._test.resolveRoute("standard", task).provider, "gemini", task);
  }
  assert.equal(q._test.resolveRoute("standard", "actors").provider, "groq");
});

test("pinned task with no Gemini key returns null without touching the daily budget or the network", async () => {
  const q = await load({ GEMINI_API_KEY: null, ANTHROPIC_API_KEY: null });
  const g = stubGemini(() => { throw new Error("no network expected"); });
  try {
    const before = budgetCalls("ig-summary");
    assert.equal(await q.callJson("p", { task: "ig-summary", text: true }), null);
    assert.equal(budgetCalls("ig-summary"), before);
    assert.equal(q.isTaskRoutable("ig-summary"), false);
  } finally { g.restore(); }
});

test("isTaskRoutable: a Gemini-pinned task is routable via the Anthropic fallback when only Anthropic has a key", async () => {
  const q = await load({ GEMINI_API_KEY: null });
  assert.equal(q.isTaskRoutable("ig-summary"), true);
  const q2 = await load({ GEMINI_API_KEY: null, LLM_FALLBACK_DISABLED: "1" });
  assert.equal(q2.isTaskRoutable("ig-summary"), false);
});

// ─── Anthropic handler ─────────────────────────────────────────────────────

test("anthropic JSON mode: json system prompt, no prefill, tolerant parse of fenced output, default model", async () => {
  const q = await load({ LLM_PROVIDER: "anthropic" });
  const a = fakeAnthropic(() => anthropicOk('Here you go:\n```json\n{"a":[1,2]}\n```'));
  q._test.setAnthropicClient(a);
  const v = await q.callJson("hello", { task: "t-json", maxOutputTokens: 321, timeoutMs: 5555 });
  assert.deepEqual(v, { a: [1, 2] });
  const { params, opts } = a.calls[0];
  assert.equal(params.model, "claude-haiku-5-5");
  assert.equal(params.max_tokens, 321);
  assert.match(params.system, /valid JSON only/);
  assert.deepEqual(params.messages, [{ role: "user", content: "hello" }]);
  assert.equal(params.output_config, undefined);
  assert.equal(opts.timeout, 5555);
});

test("anthropic structured output: schema is sent as output_config.format json_schema", async () => {
  const q = await load({ LLM_PROVIDER: "anthropic" });
  const a = fakeAnthropic(() => anthropicOk('{"n":1}'));
  q._test.setAnthropicClient(a);
  const schema = { type: "object", properties: { n: { type: "integer" } }, required: ["n"], additionalProperties: false };
  assert.deepEqual(await q.callJson("p", { task: "t-schema", schema }), { n: 1 });
  assert.deepEqual(a.calls[0].params.output_config, { format: { type: "json_schema", schema } });
});

test("anthropic ANTHROPIC_MODEL env overrides the default model", async () => {
  const q = await load({ LLM_PROVIDER: "anthropic", ANTHROPIC_MODEL: "claude-test-9" });
  const a = fakeAnthropic(() => anthropicOk("{}"));
  q._test.setAnthropicClient(a);
  await q.callJson("p", { task: "t-model" });
  assert.equal(a.calls[0].params.model, "claude-test-9");
});

test("anthropic: a 400 rejecting temperature flips the flag and retries once without it", async () => {
  const q = await load({ LLM_PROVIDER: "anthropic" });
  const a = fakeAnthropic((i) => {
    if (i === 1) throw httpErr(400, "temperature is not supported for this model");
    return anthropicOk('{"ok":1}');
  });
  q._test.setAnthropicClient(a);
  assert.deepEqual(await q.callJson("p", { task: "t-temp" }), { ok: 1 });
  assert.equal(a.calls.length, 2);
  assert.equal("temperature" in a.calls[0].params, true);
  assert.equal("temperature" in a.calls[1].params, false);
});

test("anthropic stop_reason max_tokens maps to finishReason MAX_TOKENS + truncated (the callers' existing log vocabulary)", async () => {
  const q = await load({ LLM_PROVIDER: "anthropic" });
  q._test.setAnthropicClient(fakeAnthropic(() => anthropicOk('{"cut":', { input_tokens: 10, output_tokens: 20 }, "max_tokens")));
  const r = await q.callJson("p", { task: "t-trunc", withMeta: true });
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(r.finishReason, "MAX_TOKENS");
  assert.equal(r.provider, "anthropic");
  assert.deepEqual(r.rawUsage, { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 0 });
});

test("strictJson turns non-JSON output into null; without it the {_rawText} contract is unchanged", async () => {
  const q = await load({ LLM_PROVIDER: "anthropic" });
  q._test.setAnthropicClient(fakeAnthropic(() => anthropicOk("sorry, I cannot produce JSON")));
  assert.deepEqual(await q.callJson("p", { task: "t-strict" }), { _rawText: "sorry, I cannot produce JSON" });
  assert.equal(await q.callJson("p", { task: "t-strict", strictJson: true }), null);
});

test("anthropic RPM defaults to 50 and is overridable", async () => {
  const q = await load({ LLM_PROVIDER: "anthropic" });
  assert.equal(q.getQueueStatus().rpm.anthropic, 50);
});

// ─── text mode ─────────────────────────────────────────────────────────────

test("text mode (gemini): no responseMimeType, raw string returned", async () => {
  const q = await load();
  const g = stubGemini(() => geminiOk("  Two plain sentences.  "));
  try {
    assert.equal(await q.callJson("p", { task: "ig-summary", text: true, temperature: 0.65, maxOutputTokens: 512, timeoutMs: 18000 }), "  Two plain sentences.  ");
    const { body, cfg } = g.calls[0];
    assert.equal("responseMimeType" in body.generationConfig, false);
    assert.equal(body.generationConfig.temperature, 0.65);
    assert.equal(body.generationConfig.maxOutputTokens, 512);
    assert.equal(cfg.timeout, 18000);
  } finally { g.restore(); }
});

test("text mode (gemini): JSON mode still sets responseMimeType", async () => {
  const q = await load();
  const g = stubGemini(() => geminiOk('{"a":1}'));
  try {
    await q.callJson("p", { task: "t-j" });
    assert.equal(g.calls[0].body.generationConfig.responseMimeType, "application/json");
  } finally { g.restore(); }
});

test("text mode (anthropic): no JSON system prompt, no schema, raw string returned", async () => {
  const q = await load({ LLM_PROVIDER: "anthropic" });
  const a = fakeAnthropic(() => anthropicOk("A caption."));
  q._test.setAnthropicClient(a);
  assert.equal(await q.callJson("p", { task: "t-text", text: true, schema: { type: "object" } }), "A caption.");
  assert.equal(a.calls[0].params.system, undefined);
  assert.equal(a.calls[0].params.output_config, undefined);
});

test("text mode (openai-compat providers): no json response_format, raw string returned", async () => {
  const q = await load({ LLM_PROVIDER: "groq", GROQ_API_KEY: "q" });
  const g = stubGemini(() => ({ data: { choices: [{ message: { content: "plain words" } }] } }));
  try {
    assert.equal(await q.callJson("p", { task: "t-groq-text", text: true }), "plain words");
    assert.equal(g.calls[0].body.response_format, undefined);
    assert.equal(g.calls[0].body.messages.length, 1);
  } finally { g.restore(); }
});

// ─── fallback ──────────────────────────────────────────────────────────────

for (const [label, err] of [
  ["401", httpErr(401, "invalid x-api-key")],
  ["402", httpErr(402, "payment required")],
  ["403", httpErr(403, "forbidden")],
  ["credit balance too low (400)", httpErr(400, "Your credit balance is too low to access the Anthropic API")],
  ["model 404", httpErr(404, "model: claude-haiku-5-5")],
]) {
  test(`fallback: anthropic ${label} → retried ONCE on gemini; caller sees gemini's answer`, async () => {
    const q2 = await load({ LLM_TASK_PROVIDER: "fb-task=anthropic" });
    q2._test.breaker.recordSuccess("anthropic");
    const a2 = fakeAnthropic(() => { throw err; });
    q2._test.setAnthropicClient(a2);
    const g2 = stubGemini(() => geminiOk('{"from":"gemini"}'));
    try {
      assert.deepEqual(await q2.callJson("p", { task: "fb-task" }), { from: "gemini" });
      assert.equal(a2.calls.length, 1, "anthropic tried exactly once (hard errors are not retried)");
      assert.equal(g2.calls.length, 1, "gemini tried exactly once");
      const rows = usageRows("fb-task");
      const mine = rows.slice(-2);
      assert.deepEqual(mine.map(r => [r.provider, r.ok]), [["anthropic", 0], ["gemini", 1]]);
      assert.ok(mine[0].error_class && mine[0].error_class !== "unknown");
    } finally { g2.restore(); }
  });
}

test("fallback: gemini PERMISSION_DENIED (403) → retried once on anthropic", async () => {
  const q = await load();
  q._test.setAnthropicClient(fakeAnthropic(() => anthropicOk('{"from":"claude"}')));
  const g = stubGemini(() => { throw httpErr(403, "x", { error: { status: "PERMISSION_DENIED" } }); });
  try {
    assert.deepEqual(await q.callJson("p", { task: "fb-gem-403" }), { from: "claude" });
    assert.equal(g.calls.length, 1);
  } finally { g.restore(); }
});

test("fallback: gemini model 404 (dead pin) → anthropic; caller-supplied `model` is not forwarded across providers", async () => {
  const q = await load();
  const a = fakeAnthropic(() => anthropicOk('{"ok":1}'));
  q._test.setAnthropicClient(a);
  const g = stubGemini(() => { throw httpErr(404, "models/x is not found"); });
  const w = captureWarnings();
  try {
    assert.deepEqual(await q.callJson("p", { task: "fb-gem-404", model: "gemini-special" }), { ok: 1 });
    assert.match(g.calls[0].url, /gemini-special/);
    assert.equal(a.calls[0].params.model, "claude-haiku-5-5");
  } finally { g.restore(); w.restore(); }
});

test("fallback: transient errors retry on the SAME provider and never fall back", async () => {
  const q = await load({ LLM_PROVIDER: "anthropic" });
  const a = fakeAnthropic((i) => { if (i < 3) throw httpErr(529, "overloaded"); return anthropicOk('{"ok":1}'); });
  q._test.setAnthropicClient(a);
  const g = stubGemini(() => { throw new Error("gemini must not be called"); });
  try {
    assert.deepEqual(await q.callJson("p", { task: "t-transient" }), { ok: 1 });
    assert.equal(a.calls.length, 3);
    assert.equal(g.calls.length, 0);
  } finally { g.restore(); }
});

test("fallback: exhausted transient retries → null, and still NO fallback (retries never stack with a fallback)", async () => {
  const q = await load({ LLM_PROVIDER: "anthropic" });
  const a = fakeAnthropic(() => { throw httpErr(503, "unavailable"); });
  q._test.setAnthropicClient(a);
  const g = stubGemini(() => { throw new Error("gemini must not be called"); });
  const w = captureWarnings();
  try {
    assert.equal(await q.callJson("p", { task: "t-exhaust" }), null);
    assert.equal(a.calls.length, 4); // 1 + 3 retry delays
    assert.equal(g.calls.length, 0);
    assert.equal(usageRows("t-exhaust").at(-1).error_class, "transient");
  } finally { g.restore(); w.restore(); }
});

test("fallback: providers outside the anthropic/gemini pair keep today's behaviour (null, no fallback)", async () => {
  const q = await load({ LLM_PROVIDER: "groq", GROQ_API_KEY: "q" });
  q._test.setAnthropicClient(fakeAnthropic(() => { throw new Error("anthropic must not be called"); }));
  const urls = [];
  const orig = axios.post;
  axios.post = async (url) => { urls.push(url); throw httpErr(401, "bad key"); };
  const w = captureWarnings();
  try {
    assert.equal(await q.callJson("p", { task: "t-groq" }), null);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /groq\.com/);
  } finally { axios.post = orig; w.restore(); }
});

test("fallback: both providers hard-failing returns null after exactly one attempt each", async () => {
  const q = await load();
  const a = fakeAnthropic(() => { throw httpErr(401, "bad"); });
  q._test.setAnthropicClient(a);
  const g = stubGemini(() => { throw httpErr(403, "bad"); });
  const w = captureWarnings();
  try {
    assert.equal(await q.callJson("p", { task: "t-both-dead" }), null);
    assert.equal(g.calls.length, 1);
    assert.equal(a.calls.length, 1);
  } finally { g.restore(); w.restore(); }
});

test("fallback: LLM_FALLBACK_DISABLED=1 turns it off", async () => {
  const q = await load({ LLM_FALLBACK_DISABLED: "1" });
  const a = fakeAnthropic(() => anthropicOk("{}"));
  q._test.setAnthropicClient(a);
  const g = stubGemini(() => { throw httpErr(403, "bad"); });
  const w = captureWarnings();
  try {
    assert.equal(await q.callJson("p", { task: "t-nofb" }), null);
    assert.equal(a.calls.length, 0);
  } finally { g.restore(); w.restore(); }
});

test("fallback: the daily budget is consumed ONCE per callJson, even when it falls back", async () => {
  const q = await load({ LLM_TASK_PROVIDER: "budget-task=anthropic" });
  q._test.setAnthropicClient(fakeAnthropic(() => { throw httpErr(401, "bad"); }));
  const g = stubGemini(() => geminiOk('{"ok":1}'));
  const w = captureWarnings();
  try {
    const before = budgetCalls("budget-task");
    await q.callJson("p", { task: "budget-task" });
    assert.equal(budgetCalls("budget-task") - before, 1);
  } finally { g.restore(); w.restore(); }
});

// ─── circuit breaker (wired into callJson) ─────────────────────────────────

test("breaker: 3 consecutive hard failures open it; the 4th call skips the dead provider; exactly one OPEN warning", async () => {
  const q = await load({ LLM_TASK_PROVIDER: "brk-task=anthropic" });
  const a = fakeAnthropic(() => { throw httpErr(402, "Your credit balance is too low"); });
  q._test.setAnthropicClient(a);
  const g = stubGemini(() => geminiOk('{"from":"gemini"}'));
  const w = captureWarnings();
  try {
    for (let i = 0; i < 3; i++) assert.deepEqual(await q.callJson("p", { task: "brk-task" }), { from: "gemini" });
    assert.equal(a.calls.length, 3);
    assert.equal(q._test.breaker.isOpen("anthropic"), true);

    assert.deepEqual(await q.callJson("p", { task: "brk-task" }), { from: "gemini" });
    assert.equal(a.calls.length, 3, "open breaker: anthropic not hit again");
    assert.equal(g.calls.length, 4);

    const opens = w.lines.filter(l => /breaker OPEN for anthropic/.test(l));
    assert.equal(opens.length, 1);
    assert.match(opens[0], /credit balance is too low|billing/);
  } finally { g.restore(); w.restore(); }
});

test("breaker: an open breaker does not strand a task when there is no fallback configured (it still tries)", async () => {
  const q = await load({ LLM_PROVIDER: "anthropic", GEMINI_API_KEY: null, LLM_BREAKER_THRESHOLD: "1" });
  const a = fakeAnthropic((i) => { if (i === 1) throw httpErr(401, "bad"); return anthropicOk('{"ok":1}'); });
  q._test.setAnthropicClient(a);
  const w = captureWarnings();
  try {
    assert.equal(await q.callJson("p", { task: "brk-solo" }), null);
    assert.equal(q._test.breaker.isOpen("anthropic"), true);
    assert.deepEqual(await q.callJson("p", { task: "brk-solo" }), { ok: 1 });
    assert.equal(a.calls.length, 2);
  } finally { w.restore(); }
});

// ─── usage logging ─────────────────────────────────────────────────────────

test("usage: one llm_usage row per attempt with tokens, model and estimated cost", async () => {
  const q = await load({ LLM_PROVIDER: "anthropic" });
  q._test.setAnthropicClient(fakeAnthropic(() => anthropicOk('{"ok":1}', { input_tokens: 1000, output_tokens: 500 })));
  const t0 = Date.now();
  await q.callJson("p", { task: "usage-ok" });
  const [row] = usageRows("usage-ok");
  assert.equal(row.provider, "anthropic");
  assert.equal(row.model, "claude-haiku-5-5");
  assert.equal(row.input_tokens, 1000);
  assert.equal(row.output_tokens, 500);
  assert.ok(Math.abs(row.est_cost_usd - (0.001 * 0.10 + 0.0005 * 0.50)) < 1e-9, `cost ${row.est_cost_usd}`);
  assert.equal(row.ok, 1);
  assert.equal(row.error_class, null);
  assert.ok(row.ts >= t0 && row.ts <= Date.now());
});

test("usage: Gemini thinking tokens are counted as output; failures are logged with an error_class", async () => {
  const q = await load({ GEMINI_GENERATION_MODEL: "gemini-3.1-flash-lite", ANTHROPIC_API_KEY: null });
  const g = stubGemini((i) => i === 1
    ? geminiOk('{"ok":1}', { promptTokenCount: 2000, candidatesTokenCount: 100, thoughtsTokenCount: 400 })
    : (() => { throw httpErr(400, "bad request"); })());
  const w = captureWarnings();
  try {
    await q.callJson("p", { task: "usage-gem" });
    assert.equal(await q.callJson("p", { task: "usage-gem" }), null);
    const [ok, bad] = usageRows("usage-gem");
    assert.equal(ok.output_tokens, 500);
    assert.ok(Math.abs(ok.est_cost_usd - (0.002 * 0.25 + 0.0005 * 1.5)) < 1e-9);
    assert.equal(bad.ok, 0);
    assert.equal(bad.error_class, "http_400");
    assert.equal(bad.est_cost_usd, null);
  } finally { g.restore(); w.restore(); }
});

test("usage: a model missing from the price table records cost NULL and warns once per model", async () => {
  const q = await load({ LLM_PROVIDER: "anthropic", ANTHROPIC_MODEL: "claude-unpriced-1" });
  q._test.setAnthropicClient(fakeAnthropic(() => anthropicOk("{}")));
  const w = captureWarnings();
  try {
    await q.callJson("p", { task: "usage-unpriced" });
    await q.callJson("p", { task: "usage-unpriced" });
    const rows = usageRows("usage-unpriced");
    assert.equal(rows.length, 2);
    assert.ok(rows.every(r => r.est_cost_usd === null && r.input_tokens === 1000));
    assert.equal(w.lines.filter(l => /no entry for anthropic:claude-unpriced-1/.test(l)).length, 1);
  } finally { w.restore(); }
});

test("usage: summary groups by task/provider/model for the metrics endpoint", async () => {
  const { getLlmUsageSummary } = await import("./llmUsage.js");
  const s = getLlmUsageSummary(getDb());
  assert.ok(s.by_task_provider.length > 0);
  const row = s.by_task_provider.find(r => r.task === "usage-ok");
  assert.equal(row.calls, 1);
  assert.equal(row.provider, "anthropic");
  assert.ok(s.total.calls >= row.calls);
  assert.ok(Array.isArray(s.last_7_days) && Array.isArray(s.errors));
});

// ─── guard rails that must NOT change ──────────────────────────────────────

test("LLM_DISABLED still short-circuits to null; EMBED_PROVIDER routing untouched", async () => {
  const q = await load({ LLM_DISABLED: "1" });
  assert.equal(await q.callJson("p", { task: "x" }), null);
  // An explicit EMBED_PROVIDER is honoured verbatim; a derived one never lands on a provider with no embed model.
  const q2 = await load({ LLM_PROVIDER: "anthropic", EMBED_PROVIDER: "cloudflare" });
  assert.equal(q2.getQueueStatus().embedProvider, "cloudflare");
  delete process.env.EMBED_PROVIDER;
  const q3 = await load({ LLM_PROVIDER: "anthropic" });
  assert.equal(q3.getQueueStatus().embedProvider, "gemini");
});

test("the Gemini code default is no longer the retired model", async () => {
  const q = await load();
  assert.equal(q.getQueueStatus().genModel, "gemini-3.1-flash-lite");
});
