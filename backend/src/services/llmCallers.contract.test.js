/**
 * Output contracts of the callers that go through llmQueue to Claude:
 * liveEvents, analysisService, igSummaryService, scriptWriter.
 *
 * Asserted on PUBLIC behaviour only — the request on the wire (model, caps,
 * temperature, timeout, JSON vs text mode), the parsed result each caller
 * returns, and the rejection log lines. The result shapes and log lines are the
 * same ones these callers had when they spoke to Gemini directly; the finish
 * reason vocabulary is preserved (Anthropic "max_tokens" -> MAX_TOKENS).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SCOOP_PERSISTENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "callers-test-"));
for (const k of ["ANTHROPIC_MODEL", "LLM_DISABLED", "LLM_HEALTH_PING_URL"]) delete process.env[k];
Object.assign(process.env, { ANTHROPIC_API_KEY: "a-key", SCRIPT_LLM_ENABLED: "1", LLM_DAILY_CALL_CAP: "100000", LLM_RETRY_DELAYS_MS: "1,1,1" });

const { default: axios } = await import("axios");
const { logger } = await import("./logger.js");
const { getDb } = await import("../models/database.js");
const { _test } = await import("../realityIndex/llmQueue.js");
const { writeScript } = await import("./scriptWriter.js");
const { ensureIgSummary } = await import("./igSummaryService.js");
const { getOrCreateDeepDive } = await import("./analysisService.js");
const { refreshEvent } = await import("./liveEvents.js");

const claudeOk = (text, usage = { input_tokens: 1000, output_tokens: 200 }, stop_reason = "end_turn") =>
  ({ content: [{ type: "text", text }], usage, stop_reason });
const err = (status, message) => Object.assign(new Error(message), { status });

/** Install a fake Claude; also stub axios.get (liveEvents' Yahoo quote) so nothing leaves the box. */
function stub(handler) {
  const calls = [];
  _test.setAnthropicClient({ messages: { create: async (params, opts) => { calls.push({ params, opts }); return handler(calls.length, params); } } });
  const origGet = axios.get;
  axios.get = async () => { throw err(500, "no network in tests"); };
  return { calls, restore: () => { axios.get = origGet; } };
}
function warnings() {
  const lines = [];
  const ow = logger.warn, oe = logger.error;
  logger.warn = (...a) => { lines.push(a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ")); };
  logger.error = (...a) => { lines.push(a.map(String).join(" ")); };
  return { lines, restore: () => { logger.warn = ow; logger.error = oe; } };
}

const SOURCE = "The Treasury announced a 25 percent tariff on imported steel on Tuesday. Officials said the measure takes effect in March. Industry groups criticised the plan.";
const ARTICLE = { id: "a-script-1", title: "Treasury announces steel tariff", description: SOURCE, content: SOURCE + " The announcement followed weeks of talks.", source_name: "Wire", category: "business", url: "https://x.test/1" };
const NARRATION = "The Treasury announced a 25 percent tariff on imported steel on Tuesday. Officials said the measure takes effect in March. Industry groups criticised the plan, and the announcement followed weeks of talks between the sides. The Treasury announced the tariff on Tuesday, and officials said the measure takes effect in March, while industry groups criticised the plan.";
const SCRIPT_JSON = JSON.stringify({
  narration: NARRATION, slides: ["Steel tariff", "25 percent", "March start"],
  titles: { youtube: "Steel tariff announced" }, description: "A tariff.", hashtags: ["#Steel", "tariff"], confidence: "high",
});

// ─── scriptWriter ──────────────────────────────────────────────────────────

test("scriptWriter: request shape and the full output contract", async () => {
  const s = stub(() => claudeOk(SCRIPT_JSON, { input_tokens: 1000, output_tokens: 200 }));
  try {
    const script = await writeScript(ARTICLE, { format: "short", targetSeconds: 40 });
    assert.ok(script, "script produced");
    assert.equal(s.calls.length, 1);
    const { params, opts } = s.calls[0];
    assert.equal(params.model, "claude-haiku-5-5");
    assert.equal(params.max_tokens, 4096);
    assert.equal(params.temperature, 0.4);
    assert.match(params.system, /valid JSON only/);
    assert.deepEqual(params.thinking, { type: "disabled" });
    assert.equal(opts.timeout, 25000);
    assert.deepEqual(Object.keys(script).sort(), ["description", "disclosure", "hashtags", "meta", "narration", "slides", "titles"]);
    assert.equal(script.disclosure, true);
    assert.deepEqual(script.slides, ["Steel tariff", "25 percent", "March start"]);
    assert.deepEqual(script.hashtags, ["steel", "tariff"]);
    assert.equal(script.description, "A tariff.");
    assert.ok(!/[()*_#`]/.test(script.narration));
    const m = script.meta;
    assert.equal(m.model, "claude-haiku-5-5");
    assert.equal(m.format, "short");
    assert.equal(m.wordBudget, 100);
    assert.ok(m.words >= 40);
    assert.equal(m.tokensIn, 1000);
    assert.equal(m.tokensOut, 200);
    assert.equal(m.costUsd, Number((1000 / 1e6 * 0.10 + 200 / 1e6 * 0.50).toFixed(5)));
    assert.equal(m.finishReason, "STOP");
    assert.equal(m.thoughtsTokenCount, 0);
    assert.equal(typeof m.ms, "number");
  } finally { s.restore(); }
});

test("scriptWriter: stop_reason max_tokens is a hard rejection, logged with the same fields", async () => {
  const s = stub(() => claudeOk(SCRIPT_JSON, undefined, "max_tokens"));
  const w = warnings();
  try {
    assert.equal(await writeScript(ARTICLE), null);
    const line = w.lines.find(l => /truncated_max_tokens/.test(l));
    assert.ok(line, w.lines.join("\n"));
    assert.match(line, /scriptWriter: rejected article a-script-1/);
    assert.match(line, /finishReason=MAX_TOKENS/);
    assert.match(line, /model=claude-haiku-5-5/);
    assert.match(line, new RegExp(`len=${SCRIPT_JSON.length}`));
  } finally { s.restore(); w.restore(); }
});

test("scriptWriter: empty text at stop_reason=max_tokens (the cap eaten before any text) is logged as the 'empty' rejection", async () => {
  const s = stub(() => ({ content: [{ type: "thinking", thinking: "..." }], usage: { input_tokens: 900, output_tokens: 4096 }, stop_reason: "max_tokens" }));
  const w = warnings();
  try {
    assert.equal(await writeScript(ARTICLE), null);
    assert.ok(w.lines.some(l => /EMPTY TEXT at stop_reason=max_tokens for task "script-writer"/.test(l)), w.lines.join("\n"));
    assert.ok(w.lines.some(l => /rejected article a-script-1 — empty/.test(l) && /finishReason=MAX_TOKENS/.test(l)));
  } finally { s.restore(); w.restore(); }
});

test("scriptWriter: unparseable JSON and empty text are rejected with their own reasons", async () => {
  let s = stub(() => claudeOk("{ not json"));
  let w = warnings();
  try {
    assert.equal(await writeScript(ARTICLE), null);
    assert.ok(w.lines.some(l => /unparseable_json/.test(l) && /finishReason=STOP/.test(l)), w.lines.join("\n"));
  } finally { s.restore(); w.restore(); }
  s = stub(() => ({ content: [], usage: { input_tokens: 5, output_tokens: 0 }, stop_reason: "end_turn" }));
  w = warnings();
  try {
    assert.equal(await writeScript(ARTICLE), null);
    assert.ok(w.lines.some(l => /rejected article a-script-1 — empty/.test(l)), w.lines.join("\n"));
  } finally { s.restore(); w.restore(); }
});

test("scriptWriter: a hard API error returns null, not a throw", async () => {
  const s = stub(() => { throw err(403, "denied"); });
  const w = warnings();
  try { assert.equal(await writeScript(ARTICLE), null); } finally { s.restore(); w.restore(); }
});

// ─── analysisService (deep dive) ───────────────────────────────────────────

function insertArticle(id) {
  getDb().prepare(`INSERT OR REPLACE INTO articles (id, title, description, content, url, source_name, category, published_at, fetched_at)
    VALUES (?, ?, ?, ?, ?, 'Wire', 'business', ?, ?)`)
    .run(id, "Treasury announces steel tariff", SOURCE, SOURCE, `https://x.test/${id}`, Date.now(), Date.now());
}

test("analysisService: deep-dive request shape and result contract (fenced JSON is accepted)", async () => {
  _test.breaker.recordSuccess("anthropic");
  insertArticle("a-dd-1");
  const s = stub(() => claudeOk('```json\n' + JSON.stringify({ takeaways: ["Tariff of 25 percent", "Starts in March"], tone: "negative", toneReason: "Industry criticism" }) + '\n```'));
  try {
    const r = await getOrCreateDeepDive("a-dd-1", { allowGenerate: true });
    assert.deepEqual(r, { article_id: "a-dd-1", takeaways: ["Tariff of 25 percent", "Starts in March"], tone: "negative", tone_reason: "Industry criticism", related_ids: [] });
    const { params, opts } = s.calls[0];
    assert.equal(opts.timeout, 25000);
    assert.equal(params.temperature, 0.2);
    assert.equal(params.max_tokens, 1024);
    assert.match(params.system, /valid JSON only/);
  } finally { s.restore(); }
});

test("analysisService: non-JSON output degrades to the neutral shell (a 503 is retried first)", async () => {
  insertArticle("a-dd-2");
  const s = stub((i) => { if (i === 1) throw err(503, "overloaded"); return claudeOk("this is prose, not JSON"); });
  const w = warnings();
  try {
    const r = await getOrCreateDeepDive("a-dd-2", { allowGenerate: true });
    const { related_ids, ...rest } = r; // related_ids depends on which articles earlier tests inserted
    assert.ok(Array.isArray(related_ids));
    assert.deepEqual(rest, { article_id: "a-dd-2", takeaways: [], tone: "neutral", tone_reason: null });
    assert.equal(s.calls.length, 2, "one transient retry, then the parse failure is final (not retried)");
  } finally { s.restore(); w.restore(); }
});

test("analysisService: without a cached/allowed generation nothing is called", async () => {
  insertArticle("a-dd-3");
  const s = stub(() => { throw new Error("must not call"); });
  try {
    const r = await getOrCreateDeepDive("a-dd-3", { allowGenerate: false });
    assert.equal(r.pending, true);
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
});

// ─── igSummaryService ──────────────────────────────────────────────────────

const IG_TEXT = "The Treasury will impose a 25 percent tariff on imported steel from March, officials said, prompting criticism from industry groups.";

test("igSummary: plain-text request (no JSON system prompt), trimmed result", async () => {
  const s = stub(() => claudeOk(`  ${IG_TEXT}\n`));
  try {
    const a = { id: "a-ig-1", title: "Treasury announces steel tariff", description: SOURCE, content: "<p>" + SOURCE + "</p>" };
    assert.equal(await ensureIgSummary(a), IG_TEXT);
    assert.equal(a.ig_summary, IG_TEXT);
    const { params, opts } = s.calls[0];
    assert.equal(params.system, undefined);
    assert.equal(params.temperature, 0.65);
    assert.equal(params.max_tokens, 512);
    assert.equal(opts.timeout, 18000);
    assert.match(params.messages[0].content, /Instagram caption body/);
  } finally { s.restore(); }
});

test("igSummary: a 503 is NOT retried; the length gate rejects with the existing log line", async () => {
  let s = stub(() => { throw err(503, "overloaded"); });
  const w = warnings();
  try {
    assert.equal(await ensureIgSummary({ id: "a-ig-2", title: "T", description: SOURCE }), null);
    assert.equal(s.calls.length, 1);
  } finally { s.restore(); }
  s = stub(() => claudeOk("too short", { input_tokens: 5, output_tokens: 2 }));
  try {
    assert.equal(await ensureIgSummary({ id: "a-ig-3", title: "T", description: SOURCE }), null);
    const line = w.lines.find(l => /igSummary: rejected article a-ig-3/.test(l));
    assert.ok(line, w.lines.join("\n"));
    assert.match(line, /too_short \(len=9, finishReason=STOP, thoughtsTokenCount=0\)/);
  } finally { s.restore(); w.restore(); }
});

// ─── liveEvents ────────────────────────────────────────────────────────────

test("liveEvents: synthesis request shape and stored brief contract", async () => {
  const now = Date.now();
  getDb().prepare(`INSERT OR REPLACE INTO articles (id, title, description, url, source_name, category, published_at, fetched_at)
    VALUES ('le-1', 'Zorbland ceasefire talks resume', 'Talks in Zorbland resume', 'https://x.test/le1', 'Wire', 'world', ?, ?)`).run(now, now);
  const s = stub(() => claudeOk(JSON.stringify({
    summary: "Talks resume", brief: [{ ts: "2026-10-01T00:00:00Z", text: "Delegations met.", sourceIndices: [1, 99] }],
    metrics: { casualties: { value: null, unit: "people", note: "n/a" } },
  })));
  try {
    const res = await refreshEvent({ id: "zorb", title: "Zorbland", subtitle: "s", emoji: "🧪", region: "x", status: "active", keywords: ["zorbland"], preferredSources: [] });
    assert.equal(res.briefCount, 1);
    assert.equal(res.articlesUsed, 1);
    const { params, opts } = s.calls[0];
    assert.equal(opts.timeout, 25000);
    assert.equal(params.temperature, 0.2);
    assert.equal(params.max_tokens, 1536);
    const stored = getDb().prepare("SELECT brief, summary, metrics FROM live_events WHERE id = 'zorb'").get();
    assert.equal(stored.summary, "Talks resume");
    assert.deepEqual(JSON.parse(stored.brief), [{ ts: "2026-10-01T00:00:00Z", text: "Delegations met.", sources: [{ name: "Wire", url: "https://x.test/le1" }] }]);
    assert.equal(JSON.parse(stored.metrics)._provenance.llmUsed, true);
  } finally { s.restore(); }
});

test("liveEvents: a model failure falls back to the deterministic brief", async () => {
  const s = stub(() => { throw err(403, "denied"); });
  const w = warnings();
  try {
    const res = await refreshEvent({ id: "zorb2", title: "Zorbland", subtitle: "s", emoji: "🧪", region: "x", status: "active", keywords: ["zorbland"], preferredSources: [] });
    assert.equal(res.briefCount, 1);
    const stored = getDb().prepare("SELECT summary FROM live_events WHERE id = 'zorb2'").get();
    assert.match(stored.summary, /1 recent updates from 1 outlets/);
  } finally { s.restore(); w.restore(); _test.breaker.recordSuccess("anthropic"); }
});
