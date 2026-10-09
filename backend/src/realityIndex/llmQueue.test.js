/**
 * llmQueue — Claude as the only generation provider: the Anthropic handler,
 * text / images / schema modes, hard-error handling (loud error + Healthchecks
 * ping + circuit breaker), transient retry, usage logging, and the Ollama /
 * Cloudflare embedding lane.
 *
 * llmQueue reads its config (keys, EMBED_PROVIDER, breaker settings) at import,
 * so each scenario imports a FRESH instance via a cache-busting query string
 * after setting env. Anthropic goes through the module's client seam; axios is
 * stubbed for pings and embeddings. No network, no real keys.
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

const CONFIG_ENV = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_RPM", "LLM_DISABLED", "LLM_BREAKER_THRESHOLD",
  "LLM_BREAKER_COOLDOWN_MS", "LLM_HEALTH_PING_URL", "EMBED_PROVIDER", "OLLAMA_EMBED_MODEL",
  "OLLAMA_EMBED_PREFIX", "OLLAMA_BASE_URL", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID",
];

let n = 0;
async function load(env = {}) {
  for (const k of CONFIG_ENV) delete process.env[k];
  process.env.LLM_DAILY_CALL_CAP = "100000";
  process.env.LLM_RETRY_DELAYS_MS = "1,1,1";
  Object.assign(process.env, { ANTHROPIC_API_KEY: "a-key" }, env);
  for (const [k, v] of Object.entries(env)) if (v === null) delete process.env[k];
  return import(`./llmQueue.js?t=${++n}`);
}

const httpErr = (status, message) => Object.assign(new Error(message), { status });
const claudeOk = (text, usage = { input_tokens: 1000, output_tokens: 500 }, stop_reason = "end_turn") =>
  ({ content: [{ type: "text", text }], usage, stop_reason });

function fakeClaude(handler) {
  const calls = [];
  return { calls, messages: { create: async (params, opts) => { calls.push({ params, opts }); return handler(calls.length, params); } } };
}
function capture() {
  const warns = [], errors = [];
  const ow = logger.warn, oe = logger.error;
  logger.warn = (...a) => { warns.push(a.map(String).join(" ")); };
  logger.error = (...a) => { errors.push(a.map(String).join(" ")); };
  return { warns, errors, restore: () => { logger.warn = ow; logger.error = oe; } };
}
function stubAxios(handler = () => ({ status: 200, data: {} })) {
  const posts = [], gets = [];
  const op = axios.post, og = axios.get;
  axios.post = async (url, body, cfg) => { posts.push({ url, body, cfg }); return handler("post", url, body); };
  axios.get = async (url, cfg) => { gets.push({ url, cfg }); return handler("get", url); };
  return { posts, gets, restore: () => { axios.post = op; axios.get = og; } };
}
const usageRows = (task) => getDb().prepare("SELECT * FROM llm_usage WHERE task = ? ORDER BY id").all(task);
const budgetCalls = (task) => getDb().prepare("SELECT COALESCE(SUM(calls),0) AS c FROM llm_daily_calls WHERE task = ? AND day = date('now')").get(task).c;
const settle = () => new Promise(r => setTimeout(r, 15)); // pings are fire-and-forget

// ─── availability / kill switches ──────────────────────────────────────────

test("no ANTHROPIC_API_KEY → callJson resolves null without touching the budget; isLlmAvailable is false", async () => {
  const q = await load({ ANTHROPIC_API_KEY: null });
  const before = budgetCalls("no-key");
  assert.equal(await q.callJson("p", { task: "no-key" }), null);
  assert.equal(budgetCalls("no-key"), before);
  assert.equal(q.isLlmAvailable(), false);
});

test("LLM_DISABLED=1 short-circuits to null and reports unavailable", async () => {
  const q = await load({ LLM_DISABLED: "1" });
  q._test.setAnthropicClient(fakeClaude(() => { throw new Error("must not be called"); }));
  assert.equal(await q.callJson("p", { task: "x" }), null);
  assert.equal(q.isLlmAvailable(), false);
});

test("the old `tier` option is accepted and ignored: one provider, one model", async () => {
  const q = await load();
  const c = fakeClaude(() => claudeOk('{"ok":1}'));
  q._test.setAnthropicClient(c);
  assert.deepEqual(await q.callJson("p", { task: "t-tier", tier: "premium" }), { ok: 1 });
  assert.equal(c.calls[0].params.model, "claude-haiku-5-5");
  assert.equal(q.getQueueStatus().provider, "anthropic");
  assert.equal(q.getQueueStatus().premiumProvider, "anthropic");
});

// ─── handler: JSON / schema / text / images ────────────────────────────────

test("JSON mode: json system prompt, no prefill, tolerant parse of fenced output, default model, timeout passthrough", async () => {
  const q = await load();
  const c = fakeClaude(() => claudeOk('Here you go:\n```json\n{"a":[1,2]}\n```'));
  q._test.setAnthropicClient(c);
  assert.deepEqual(await q.callJson("hello", { task: "t-json", maxOutputTokens: 321, timeoutMs: 5555 }), { a: [1, 2] });
  const { params, opts } = c.calls[0];
  assert.equal(params.model, "claude-haiku-5-5");
  assert.equal(params.max_tokens, 321);
  assert.match(params.system, /valid JSON only/);
  assert.deepEqual(params.messages, [{ role: "user", content: "hello" }]);
  assert.equal(params.output_config, undefined);
  assert.equal(opts.timeout, 5555);
});

test("schema → output_config.format json_schema", async () => {
  const q = await load();
  const c = fakeClaude(() => claudeOk('{"n":1}'));
  q._test.setAnthropicClient(c);
  const schema = { type: "object", properties: { n: { type: "integer" } }, required: ["n"], additionalProperties: false };
  assert.deepEqual(await q.callJson("p", { task: "t-schema", schema }), { n: 1 });
  assert.deepEqual(c.calls[0].params.output_config, { format: { type: "json_schema", schema } });
});

test("model: ANTHROPIC_MODEL env sets the default; a per-call `model` overrides it", async () => {
  const q = await load({ ANTHROPIC_MODEL: "claude-test-9" });
  const c = fakeClaude(() => claudeOk("{}"));
  q._test.setAnthropicClient(c);
  await q.callJson("p", { task: "t-model" });
  await q.callJson("p", { task: "t-model", model: "claude-sonnet-5-5" });
  assert.deepEqual(c.calls.map(x => x.params.model), ["claude-test-9", "claude-sonnet-5-5"]);
});

test("text mode: no JSON system prompt, no schema, raw string back", async () => {
  const q = await load();
  const c = fakeClaude(() => claudeOk("  A caption.  "));
  q._test.setAnthropicClient(c);
  assert.equal(await q.callJson("p", { task: "t-text", text: true, schema: { type: "object" } }), "  A caption.  ");
  assert.equal(c.calls[0].params.system, undefined);
  assert.equal(c.calls[0].params.output_config, undefined);
});

test("images: sent as base64 image blocks BEFORE the prompt text (Buffer and string inputs)", async () => {
  const q = await load();
  const c = fakeClaude(() => claudeOk('{"frames":[]}'));
  q._test.setAnthropicClient(c);
  await q.callJson("which frame?", { task: "t-img", images: [Buffer.from("abc"), "ZGVm"], withMeta: true });
  const content = c.calls[0].params.messages[0].content;
  assert.equal(content.length, 3);
  assert.deepEqual(content[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from("abc").toString("base64") } });
  assert.deepEqual(content[1].source.data, "ZGVm");
  assert.deepEqual(content[2], { type: "text", text: "which frame?" });
});

test("a 400 rejecting temperature flips the flag and retries once without it (a free retry, even with retryDelaysMs=[])", async () => {
  const q = await load();
  const c = fakeClaude((i) => { if (i === 1) throw httpErr(400, "temperature is not supported for this model"); return claudeOk('{"ok":1}'); });
  q._test.setAnthropicClient(c);
  assert.deepEqual(await q.callJson("p", { task: "t-temp", retryDelaysMs: [] }), { ok: 1 });
  assert.equal("temperature" in c.calls[0].params, true);
  assert.equal("temperature" in c.calls[1].params, false);
});

test("stop_reason max_tokens → finishReason MAX_TOKENS + truncated + textLength (the callers' log vocabulary)", async () => {
  const q = await load();
  q._test.setAnthropicClient(fakeClaude(() => claudeOk('{"cut":', { input_tokens: 10, output_tokens: 20 }, "max_tokens")));
  const r = await q.callJson("p", { task: "t-trunc", withMeta: true });
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(r.finishReason, "MAX_TOKENS");
  assert.equal(r.textLength, 7);
  assert.deepEqual(r.rawUsage, { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 0 });
});

test("strictJson: non-JSON → null; without it the {_rawText} contract is preserved", async () => {
  const q = await load();
  q._test.setAnthropicClient(fakeClaude(() => claudeOk("sorry, no JSON")));
  const w = capture();
  try {
    assert.deepEqual(await q.callJson("p", { task: "t-strict" }), { _rawText: "sorry, no JSON" });
    assert.equal(await q.callJson("p", { task: "t-strict", strictJson: true }), null);
  } finally { w.restore(); }
});

test("empty text and refusals are non-hard failures: null to callers, no ping, no breaker", async () => {
  const q = await load({ LLM_HEALTH_PING_URL: "https://hc.test/abc" });
  const ax = stubAxios();
  q._test.setAnthropicClient(fakeClaude((i) => i === 1 ? { content: [], usage: {}, stop_reason: "end_turn" } : { content: [{ type: "text", text: "no" }], usage: {}, stop_reason: "refusal" }));
  const w = capture();
  try {
    const a = await q.callJson("p", { task: "t-empty", withMeta: true });
    const b = await q.callJson("p", { task: "t-empty", withMeta: true });
    assert.deepEqual([a.ok, a.errClass, b.ok, b.errClass], [false, "empty", false, "refusal"]);
    await settle();
    assert.equal(ax.posts.length + ax.gets.length, 0);
    assert.equal(q._test.breaker.isOpen("anthropic"), false);
  } finally { ax.restore(); w.restore(); }
});

test("RPM defaults to 50 and ANTHROPIC_RPM overrides it", async () => {
  assert.equal((await load()).getQueueStatus().rpm.anthropic, 50);
  assert.equal((await load({ ANTHROPIC_RPM: "7" })).getQueueStatus().rpm.anthropic, 7);
});

// ─── transient errors ──────────────────────────────────────────────────────

test("transient 529/503: retried on the same call with backoff, then succeeds; nothing escalates", async () => {
  const q = await load({ LLM_HEALTH_PING_URL: "https://hc.test/abc" });
  const ax = stubAxios();
  const c = fakeClaude((i) => { if (i < 3) throw httpErr(i === 1 ? 529 : 503, "overloaded"); return claudeOk('{"ok":1}'); });
  q._test.setAnthropicClient(c);
  const w = capture();
  try {
    assert.deepEqual(await q.callJson("p", { task: "t-transient" }), { ok: 1 });
    assert.equal(c.calls.length, 3);
    await settle();
    assert.equal(ax.posts.length + ax.gets.length, 0);
    assert.equal(w.errors.length, 0);
  } finally { ax.restore(); w.restore(); }
});

test("exhausted transient retries → null, classified 'transient' in llm_usage, NOT hard (no error, no ping, breaker untouched)", async () => {
  const q = await load({ LLM_HEALTH_PING_URL: "https://hc.test/abc" });
  const ax = stubAxios();
  const c = fakeClaude(() => { throw httpErr(503, "unavailable"); });
  q._test.setAnthropicClient(c);
  const w = capture();
  try {
    assert.equal(await q.callJson("p", { task: "t-exhaust" }), null);
    assert.equal(c.calls.length, 4); // 1 + 3 retry delays
    assert.equal(usageRows("t-exhaust").at(-1).error_class, "transient");
    await settle();
    assert.equal(ax.posts.length, 0);
    assert.equal(w.errors.length, 0);
    assert.equal(q._test.breaker.isOpen("anthropic"), false);
  } finally { ax.restore(); w.restore(); }
});

// ─── hard errors: loud error + ping + breaker ──────────────────────────────

for (const [label, err, errClass] of [
  ["401 auth", httpErr(401, "invalid x-api-key"), "auth"],
  ["402 billing", httpErr(402, "payment required"), "billing"],
  ["403 permission", httpErr(403, "forbidden"), "permission"],
  ["credit balance too low (400)", httpErr(400, "Your credit balance is too low to access the Anthropic API"), "billing"],
  ["model 404", httpErr(404, "model: claude-haiku-5-5"), "model_gone"],
]) {
  test(`hard error ${label}: not retried, null to caller, ONE loud error, a /fail ping with a reason, a usage row`, async () => {
    const q = await load({ LLM_HEALTH_PING_URL: "https://hc.test/SECRET-UUID" });
    const ax = stubAxios();
    const c = fakeClaude(() => { throw err; });
    q._test.setAnthropicClient(c);
    const w = capture();
    const task = `hard-${errClass}`;
    try {
      assert.equal(await q.callJson("p", { task }), null);
      assert.equal(c.calls.length, 1, "hard errors are never retried");
      assert.equal(w.errors.length, 1);
      assert.match(w.errors[0], /LLM HARD FAILURE/);
      assert.match(w.errors[0], new RegExp(errClass));
      await settle();
      assert.equal(ax.posts.length, 1);
      assert.equal(ax.posts[0].url, "https://hc.test/SECRET-UUID/fail");
      assert.match(ax.posts[0].body, new RegExp(`llm ${errClass}`));
      const row = usageRows(task).at(-1);
      assert.deepEqual([row.ok, row.error_class], [0, errClass]);
    } finally { ax.restore(); w.restore(); }
  });
}

test("ping token safety: the ping URL never appears in logs or in the ping body; key material is redacted", async () => {
  const q = await load({ LLM_HEALTH_PING_URL: "https://hc.test/SECRET-UUID" });
  const ax = stubAxios();
  q._test.setAnthropicClient(fakeClaude(() => { throw httpErr(401, "invalid x-api-key sk-ant-api03-LEAKY-KEY-1234 see https://hc.test/SECRET-UUID"); }));
  const w = capture();
  try {
    await q.callJson("p", { task: "t-redact" });
    await settle();
    assert.ok(!/sk-ant-api03-LEAKY/.test(ax.posts[0].body), "key redacted from the ping body");
    assert.ok(!/SECRET-UUID/.test(ax.posts[0].body), "ping URL redacted from the ping body");
    assert.ok(![...w.warns, ...w.errors].some(l => /SECRET-UUID/.test(l)), "ping URL never logged");
  } finally { ax.restore(); w.restore(); }
});

test("no LLM_HEALTH_PING_URL → hard errors still log loudly, the ping is a silent no-op", async () => {
  const q = await load();
  const ax = stubAxios();
  q._test.setAnthropicClient(fakeClaude(() => { throw httpErr(402, "payment required"); }));
  const w = capture();
  try {
    assert.equal(await q.callJson("p", { task: "t-noping" }), null);
    await settle();
    assert.equal(w.errors.length, 1);
    assert.equal(ax.posts.length + ax.gets.length, 0);
  } finally { ax.restore(); w.restore(); }
});

test("breaker: 3 consecutive hard failures open it; calls then return null WITHOUT touching the API or the daily budget; one OPEN warning", async () => {
  const q = await load({ LLM_HEALTH_PING_URL: "https://hc.test/abc" });
  const ax = stubAxios();
  const c = fakeClaude(() => { throw httpErr(402, "Your credit balance is too low"); });
  q._test.setAnthropicClient(c);
  const w = capture();
  try {
    for (let i = 0; i < 3; i++) assert.equal(await q.callJson("p", { task: "brk" }), null);
    assert.equal(q._test.breaker.isOpen("anthropic"), true);
    const budgetBefore = budgetCalls("brk");
    assert.equal(await q.callJson("p", { task: "brk" }), null);
    assert.equal(c.calls.length, 3, "open breaker: the API is not hit again");
    assert.equal(budgetCalls("brk"), budgetBefore, "and no budget is spent");
    const opens = w.warns.filter(l => /breaker OPEN for anthropic/.test(l));
    assert.equal(opens.length, 1);
    assert.match(opens[0], /billing|credit balance/);
    assert.equal(q.getQueueStatus().breaker.anthropic.open, true);
  } finally { ax.restore(); w.restore(); }
});

test("breaker: after the cooldown ONE probe goes through; success closes it, logs CLOSED, sends the recovery ping", async () => {
  const q = await load({ LLM_HEALTH_PING_URL: "https://hc.test/abc", LLM_BREAKER_THRESHOLD: "1", LLM_BREAKER_COOLDOWN_MS: "40" });
  const ax = stubAxios();
  let healthy = false;
  const c = fakeClaude(() => { if (!healthy) throw httpErr(401, "bad key"); return claudeOk('{"ok":1}'); });
  q._test.setAnthropicClient(c);
  const w = capture();
  try {
    assert.equal(await q.callJson("p", { task: "probe" }), null);
    assert.equal(q._test.breaker.isOpen("anthropic"), true);
    assert.equal(await q.callJson("p", { task: "probe" }), null);       // still open
    assert.equal(c.calls.length, 1);
    await new Promise(r => setTimeout(r, 60));                           // cooldown elapses
    healthy = true;
    assert.deepEqual(await q.callJson("p", { task: "probe" }), { ok: 1 }); // the probe
    assert.equal(q._test.breaker.isOpen("anthropic"), false);
    assert.equal(w.warns.filter(l => /breaker CLOSED for anthropic/.test(l)).length, 1);
    await settle();
    assert.equal(ax.posts[0].url, "https://hc.test/abc/fail");
    assert.equal(ax.gets.at(-1).url, "https://hc.test/abc", "success ping clears the Healthchecks fail state");
    assert.equal(q.getQueueStatus().unhealthy, false);
  } finally { ax.restore(); w.restore(); }
});

test("breaker: a failed probe re-opens it for another cooldown", async () => {
  const q = await load({ LLM_BREAKER_THRESHOLD: "1", LLM_BREAKER_COOLDOWN_MS: "40" });
  const c = fakeClaude(() => { throw httpErr(401, "bad key"); });
  q._test.setAnthropicClient(c);
  const w = capture();
  try {
    await q.callJson("p", { task: "reopen" });
    await new Promise(r => setTimeout(r, 60));
    assert.equal(await q.callJson("p", { task: "reopen" }), null);       // the probe, fails
    assert.equal(c.calls.length, 2);
    assert.equal(q._test.breaker.isOpen("anthropic"), true);
    assert.equal(w.warns.filter(l => /RE-OPENED/.test(l)).length, 1);
  } finally { w.restore(); }
});

test("the daily budget is consumed ONCE per callJson, including transient retries", async () => {
  const q = await load();
  q._test.setAnthropicClient(fakeClaude((i) => { if (i < 3) throw httpErr(503, "x"); return claudeOk("{}"); }));
  const before = budgetCalls("budget-once");
  await q.callJson("p", { task: "budget-once" });
  assert.equal(budgetCalls("budget-once") - before, 1);
});

// ─── usage logging ─────────────────────────────────────────────────────────

test("usage: one llm_usage row per call with tokens, model and estimated cost (haiku and sonnet prices)", async () => {
  const q = await load();
  q._test.setAnthropicClient(fakeClaude(() => claudeOk('{"ok":1}', { input_tokens: 1000, output_tokens: 500 })));
  const t0 = Date.now();
  await q.callJson("p", { task: "usage-ok" });
  await q.callJson("p", { task: "usage-ok", model: "claude-sonnet-5-5" });
  const [h, s] = usageRows("usage-ok");
  assert.deepEqual([h.provider, h.model, h.input_tokens, h.output_tokens, h.ok, h.error_class], ["anthropic", "claude-haiku-5-5", 1000, 500, 1, null]);
  assert.ok(Math.abs(h.est_cost_usd - (0.001 * 0.10 + 0.0005 * 0.50)) < 1e-9);
  assert.equal(s.model, "claude-sonnet-5-5");
  assert.ok(Math.abs(s.est_cost_usd - (0.001 * 2 + 0.0005 * 10)) < 1e-9);
  assert.ok(h.ts >= t0 && h.ts <= Date.now());
});

test("usage: a model missing from the price table records cost NULL and warns once per model", async () => {
  const q = await load({ ANTHROPIC_MODEL: "claude-unpriced-1" });
  q._test.setAnthropicClient(fakeClaude(() => claudeOk("{}")));
  const w = capture();
  try {
    await q.callJson("p", { task: "usage-unpriced" });
    await q.callJson("p", { task: "usage-unpriced" });
    const rows = usageRows("usage-unpriced");
    assert.ok(rows.every(r => r.est_cost_usd === null && r.input_tokens === 1000));
    assert.equal(w.warns.filter(l => /no entry for anthropic:claude-unpriced-1/.test(l)).length, 1);
  } finally { w.restore(); }
});

test("usage: summary groups by task/provider/model for the metrics endpoint", async () => {
  const { getLlmUsageSummary } = await import("./llmUsage.js");
  const s = getLlmUsageSummary(getDb());
  const row = s.by_task_provider.find(r => r.task === "usage-ok" && r.model === "claude-haiku-5-5");
  assert.equal(row.calls, 1);
  assert.ok(s.total.calls >= 2 && Array.isArray(s.last_7_days) && Array.isArray(s.errors));
});

// ─── embeddings: Ollama default, no Gemini ─────────────────────────────────

test("embeddings: EMBED_PROVIDER defaults to ollama / nomic-embed-text and applies the documented task prefixes", async () => {
  const q = await load();
  assert.equal(q.getQueueStatus().embedProvider, "ollama");
  assert.equal(q.getQueueStatus().embedModel, "nomic-embed-text");
  const ax = stubAxios(() => ({ data: { embedding: new Array(768).fill(0.1) } }));
  try {
    const d = await q.embed("breaking news", { taskType: "RETRIEVAL_DOCUMENT" });
    const k = await q.embed("breaking news", { taskType: "RETRIEVAL_QUERY" });
    assert.equal(d.length, 768);
    assert.equal(k.length, 768);
    assert.match(ax.posts[0].url, /\/api\/embeddings$/);
    assert.equal(ax.posts[0].body.model, "nomic-embed-text");
    assert.equal(ax.posts[0].body.prompt, "search_document: breaking news");
    assert.equal(ax.posts[1].body.prompt, "search_query: breaking news");
  } finally { ax.restore(); }
});

test("embeddings: OLLAMA_EMBED_PREFIX=0 sends text verbatim; OLLAMA_BASE_URL is honoured", async () => {
  const q = await load({ OLLAMA_EMBED_PREFIX: "0", OLLAMA_BASE_URL: "http://ollama:11434/" });
  const ax = stubAxios(() => ({ data: { embedding: new Array(768).fill(0) } }));
  try {
    await q.embed("plain");
    assert.equal(ax.posts[0].url, "http://ollama:11434/api/embeddings");
    assert.equal(ax.posts[0].body.prompt, "plain");
  } finally { ax.restore(); }
});

test("embeddings: a wrong-width vector is refused (the vec0 table is FLOAT[768]); an unreachable Ollama yields null", async () => {
  const q = await load();
  let ax = stubAxios(() => ({ data: { embedding: new Array(384).fill(0) } }));
  const w = capture();
  try { assert.equal(await q.embed("x"), null); } finally { ax.restore(); }
  ax = stubAxios(() => { throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" }); });
  try { assert.equal(await q.embed("x"), null); } finally { ax.restore(); w.restore(); }
});

test("embeddings: cloudflare stays selectable; an unknown provider (e.g. the removed 'gemini') yields null with a warning", async () => {
  const q = await load({ EMBED_PROVIDER: "cloudflare", CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "acct" });
  const ax = stubAxios(() => ({ data: { result: { data: [new Array(768).fill(0.2)] } } }));
  try {
    assert.equal((await q.embed("x")).length, 768);
    assert.match(ax.posts[0].url, /cloudflare\.com.*acct/);
  } finally { ax.restore(); }
  const g = await load({ EMBED_PROVIDER: "gemini" });
  const w = capture();
  try {
    assert.equal(await g.embed("x"), null);
    assert.ok(w.warns.some(l => /Unknown EMBED_PROVIDER "gemini"/.test(l)));
  } finally { w.restore(); }
});

test("the module carries no Gemini code or env", async () => {
  const src = fs.readFileSync(new URL("./llmQueue.js", import.meta.url), "utf8");
  assert.ok(!/generativelanguage|GEMINI_|buildGeminiGenerationConfig|thinkingBudget|FALLBACK_OF|LLM_TASK_PROVIDER/.test(src));
});
