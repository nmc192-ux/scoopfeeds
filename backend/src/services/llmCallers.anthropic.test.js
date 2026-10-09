/**
 * The migrated callers routed to Claude (LLM_TASK_PROVIDER) — and falling back
 * to Gemini when Claude hard-fails. Complements llmCallers.contract.test.js,
 * which pins the Gemini-routed behaviour.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SCOOP_PERSISTENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "callers-anth-"));
for (const k of ["LLM_PROVIDER", "LLM_PREMIUM_PROVIDER", "LLM_DISABLED", "GEMINI_DISABLED", "GEMINI_GENERATION_MODEL",
  "CEREBRAS_API_KEY", "CLOUDFLARE_API_TOKEN", "GROQ_API_KEY", "DEEPSEEK_API_KEY", "NVIDIA_API_KEY"]) delete process.env[k];
Object.assign(process.env, {
  GEMINI_API_KEY: "g-key", ANTHROPIC_API_KEY: "a-key", SCRIPT_LLM_ENABLED: "1",
  LLM_TASK_PROVIDER: "script-writer=anthropic,ig-summary=anthropic,deep-dive=anthropic",
  LLM_DAILY_CALL_CAP: "100000", LLM_RETRY_DELAYS_MS: "1,1,1",
});

const { default: axios } = await import("axios");
const { logger } = await import("../services/logger.js");
const { getDb } = await import("../models/database.js");
const { _test } = await import("../realityIndex/llmQueue.js");
const { writeScript } = await import("./scriptWriter.js");
const { ensureIgSummary } = await import("./igSummaryService.js");
const { getOrCreateDeepDive } = await import("./analysisService.js");

const claudeOk = (text, stop_reason = "end_turn", usage = { input_tokens: 1000, output_tokens: 200 }) =>
  ({ content: [{ type: "text", text }], usage, stop_reason });
const httpErr = (status, message) => Object.assign(new Error(message), { status, response: { status, data: message } });

function claude(handler) {
  const calls = [];
  _test.setAnthropicClient({ messages: { create: async (params, opts) => { calls.push({ params, opts }); return handler(calls.length, params); } } });
  return calls;
}
function gemini(handler) {
  const calls = [];
  const orig = axios.post;
  axios.post = async (url, body, cfg) => { calls.push({ url, body, cfg }); return handler(calls.length); };
  return { calls, restore: () => { axios.post = orig; } };
}
function warnings() {
  const lines = [];
  const orig = logger.warn;
  logger.warn = (...a) => { lines.push(a.map(String).join(" ")); };
  return { lines, restore: () => { logger.warn = orig; } };
}
const geminiOk = (text) => ({ data: { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } } });

const SOURCE = "The Treasury announced a 25 percent tariff on imported steel on Tuesday. Officials said the measure takes effect in March. Industry groups criticised the plan.";
const ARTICLE = { id: "c-1", title: "Treasury announces steel tariff", description: SOURCE, content: SOURCE + " The announcement followed weeks of talks.", source_name: "Wire", category: "business", url: "https://x.test/c1" };
const NARRATION = "The Treasury announced a 25 percent tariff on imported steel on Tuesday. Officials said the measure takes effect in March. Industry groups criticised the plan, and the announcement followed weeks of talks between the sides. The Treasury announced the tariff on Tuesday, and officials said the measure takes effect in March, while industry groups criticised the plan.";
const SCRIPT_JSON = JSON.stringify({ narration: NARRATION, slides: ["a"], titles: { youtube: "t" }, description: "d", hashtags: ["x"], confidence: "high" });

test("scriptWriter via Claude: same output contract; model and cost come from the answering provider", async () => {
  const calls = claude(() => claudeOk(SCRIPT_JSON));
  const script = await writeScript(ARTICLE);
  assert.ok(script);
  assert.equal(calls[0].params.model, "claude-haiku-5-5");
  assert.equal(calls[0].params.max_tokens, 4096);
  assert.equal(calls[0].opts.timeout, 25000);
  assert.deepEqual(Object.keys(script).sort(), ["description", "disclosure", "hashtags", "meta", "narration", "slides", "titles"]);
  assert.equal(script.meta.model, "claude-haiku-5-5");
  assert.equal(script.meta.tokensIn, 1000);
  assert.equal(script.meta.tokensOut, 200);
  assert.equal(script.meta.finishReason, "STOP");
  assert.equal(script.meta.costUsd, Number((1000 / 1e6 * 0.10 + 200 / 1e6 * 0.50).toFixed(5)));
});

test("scriptWriter via Claude: stop_reason max_tokens → the same truncated_max_tokens rejection line", async () => {
  claude(() => claudeOk(SCRIPT_JSON, "max_tokens"));
  const w = warnings();
  try {
    assert.equal(await writeScript(ARTICLE), null);
    const line = w.lines.find(l => /truncated_max_tokens/.test(l));
    assert.ok(line, w.lines.join("\n"));
    assert.match(line, /scriptWriter: rejected article c-1/);
    assert.match(line, /finishReason=MAX_TOKENS/);
    assert.match(line, /model=claude-haiku-5-5/);
    assert.match(line, new RegExp(`len=${SCRIPT_JSON.length}`));
  } finally { w.restore(); }
});

test("scriptWriter: Claude hard-fails (credit balance) → falls back to Gemini and still produces the script", async () => {
  claude(() => { throw httpErr(400, "Your credit balance is too low to access the Anthropic API"); });
  const g = gemini(() => geminiOk(SCRIPT_JSON));
  const w = warnings();
  try {
    const script = await writeScript(ARTICLE);
    assert.ok(script);
    assert.equal(g.calls.length, 1);
    assert.match(script.meta.model, /^gemini/);
    // cost on a Gemini answer keeps the original documented formula
    assert.equal(script.meta.costUsd, Number((10 / 1e6 * 0.30 + 5 / 1e6 * 2.50).toFixed(5)));
  } finally { g.restore(); w.restore(); }
});

test("igSummary via Claude: plain-text mode (no JSON system prompt), trimmed", async () => {
  const text = "The Treasury will impose a 25 percent tariff on imported steel from March, officials said, prompting criticism from industry groups.";
  const calls = claude(() => claudeOk(`\n${text}  `));
  assert.equal(await ensureIgSummary({ id: "c-ig-1", title: "T", description: SOURCE }), text);
  assert.equal(calls[0].params.system, undefined);
  assert.equal(calls[0].params.max_tokens, 512);
  assert.equal(calls[0].opts.timeout, 18000);
});

test("deep dive via Claude: fenced JSON is parsed into the same result contract", async () => {
  getDb().prepare(`INSERT OR REPLACE INTO articles (id, title, description, content, url, source_name, category, published_at, fetched_at)
    VALUES ('c-dd-1', 'Treasury announces steel tariff', ?, ?, 'https://x.test/cdd1', 'Wire', 'business', ?, ?)`).run(SOURCE, SOURCE, Date.now(), Date.now());
  claude(() => claudeOk('```json\n{"takeaways":["25 percent tariff"],"tone":"negative","toneReason":"criticism"}\n```'));
  const r = await getOrCreateDeepDive("c-dd-1", { allowGenerate: true });
  assert.equal(r.article_id, "c-dd-1");
  assert.deepEqual(r.takeaways, ["25 percent tariff"]);
  assert.equal(r.tone, "negative");
  assert.equal(r.tone_reason, "criticism");
});

test("deep dive: Claude 401 → Gemini answers; the caller sees the normal contract", async () => {
  getDb().prepare(`INSERT OR REPLACE INTO articles (id, title, description, content, url, source_name, category, published_at, fetched_at)
    VALUES ('c-dd-2', 'Treasury announces steel tariff', ?, ?, 'https://x.test/cdd2', 'Wire', 'business', ?, ?)`).run(SOURCE, SOURCE, Date.now(), Date.now());
  claude(() => { throw httpErr(401, "invalid x-api-key"); });
  const g = gemini(() => geminiOk(JSON.stringify({ takeaways: ["fallback worked"], tone: "neutral", toneReason: null })));
  const w = warnings();
  try {
    const r = await getOrCreateDeepDive("c-dd-2", { allowGenerate: true });
    assert.deepEqual(r.takeaways, ["fallback worked"]);
    assert.equal(g.calls.length, 1);
  } finally { g.restore(); w.restore(); }
});
