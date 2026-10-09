/**
 * Output contracts of the four callers that used to call Gemini directly
 * (liveEvents, analysisService, igSummaryService, scriptWriter) and now go
 * through llmQueue.
 *
 * These assertions are written against the PUBLIC behaviour only — request
 * shape on the wire, parsed result, rejection log lines — with Gemini stubbed
 * at axios.post. They were run unchanged against the pre-migration code on
 * main (green) and against the migrated code, which is the point: the move
 * onto llmQueue must not change what a caller gets back.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SCOOP_PERSISTENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "callers-test-"));
for (const k of ["LLM_PROVIDER", "LLM_PREMIUM_PROVIDER", "LLM_TASK_PROVIDER", "LLM_DISABLED", "GEMINI_DISABLED", "GEMINI_GENERATION_MODEL",
  "CEREBRAS_API_KEY", "CLOUDFLARE_API_TOKEN", "GROQ_API_KEY", "DEEPSEEK_API_KEY", "NVIDIA_API_KEY", "ANTHROPIC_API_KEY"]) delete process.env[k];
Object.assign(process.env, {
  GEMINI_API_KEY: "g-key", SCRIPT_LLM_ENABLED: "1", LLM_DAILY_CALL_CAP: "100000", LLM_RETRY_DELAYS_MS: "1,1,1",
});

const { default: axios } = await import("axios");
const { logger } = await import("./logger.js");
const { getDb } = await import("../models/database.js");
const { writeScript } = await import("./scriptWriter.js");
const { ensureIgSummary } = await import("./igSummaryService.js");
const { getOrCreateDeepDive } = await import("./analysisService.js");
const { refreshEvent } = await import("./liveEvents.js");

const geminiOk = (text, usage = { promptTokenCount: 1000, candidatesTokenCount: 200 }, finishReason = "STOP") =>
  ({ data: { candidates: [{ content: { parts: [{ text }] }, finishReason }], usageMetadata: usage } });
const err = (status, message) => Object.assign(new Error(message), { response: { status, data: message } });

function stub(handler) {
  const calls = [];
  const origPost = axios.post, origGet = axios.get;
  axios.post = async (url, body, cfg) => { calls.push({ url, body, cfg }); return handler(calls.length, body); };
  axios.get = async () => { throw err(500, "no network in tests"); };
  return { calls, restore: () => { axios.post = origPost; axios.get = origGet; } };
}
function warnings() {
  const lines = [];
  const orig = logger.warn;
  logger.warn = (...a) => { lines.push(a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ")); };
  return { lines, restore: () => { logger.warn = orig; } };
}

const SOURCE = "The Treasury announced a 25 percent tariff on imported steel on Tuesday. Officials said the measure takes effect in March. Industry groups criticised the plan.";
const ARTICLE = { id: "a-script-1", title: "Treasury announces steel tariff", description: SOURCE, content: SOURCE + " The announcement followed weeks of talks.", source_name: "Wire", category: "business", url: "https://x.test/1" };
const NARRATION = "The Treasury announced a 25 percent tariff on imported steel on Tuesday. Officials said the measure takes effect in March. Industry groups criticised the plan, and the announcement followed weeks of talks between the sides. The Treasury announced the tariff on Tuesday, and officials said the measure takes effect in March, while industry groups criticised the plan.";
const SCRIPT_JSON = JSON.stringify({
  narration: NARRATION, slides: ["Steel tariff", "25 percent", "March start"],
  titles: { youtube: "Steel tariff announced" }, description: "A tariff.", hashtags: ["#Steel", "tariff"], confidence: "high",
});

// ─── scriptWriter ──────────────────────────────────────────────────────────

test("scriptWriter: request shape and the full output contract are unchanged", async () => {
  const s = stub(() => geminiOk(SCRIPT_JSON, { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 0 }));
  try {
    const script = await writeScript(ARTICLE, { format: "short", targetSeconds: 40 });
    assert.ok(script, "script produced");
    // wire
    assert.equal(s.calls.length, 1);
    const { body, cfg, url } = s.calls[0];
    assert.match(url, /gemini-3\.1-flash-lite:generateContent/);
    assert.equal(cfg.timeout, 25000);
    assert.equal(body.generationConfig.temperature, 0.4);
    assert.equal(body.generationConfig.maxOutputTokens, 4096);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
    // contract
    assert.deepEqual(Object.keys(script).sort(), ["description", "disclosure", "hashtags", "meta", "narration", "slides", "titles"]);
    assert.equal(script.disclosure, true);
    assert.deepEqual(script.slides, ["Steel tariff", "25 percent", "March start"]);
    assert.deepEqual(script.hashtags, ["steel", "tariff"]);
    assert.equal(script.description, "A tariff.");
    assert.ok(!/[()*_#`]/.test(script.narration));
    const m = script.meta;
    assert.equal(m.model, "gemini-3.1-flash-lite");
    assert.equal(m.format, "short");
    assert.equal(m.wordBudget, 100);
    assert.ok(m.words >= 40);
    assert.equal(m.tokensIn, 1000);
    assert.equal(m.tokensOut, 200);
    assert.equal(m.costUsd, Number((1000 / 1e6 * 0.30 + 200 / 1e6 * 2.50).toFixed(5)));
    assert.equal(m.finishReason, "STOP");
    assert.equal(m.thoughtsTokenCount, 0);
    assert.equal(typeof m.ms, "number");
    assert.equal(m.words, script.narration.split(/\s+/).length);
  } finally { s.restore(); }
});

test("scriptWriter: MAX_TOKENS is a hard rejection with the same log line", async () => {
  const s = stub(() => geminiOk(SCRIPT_JSON, undefined, "MAX_TOKENS"));
  const w = warnings();
  try {
    assert.equal(await writeScript(ARTICLE), null);
    const line = w.lines.find(l => /truncated_max_tokens/.test(l));
    assert.ok(line, w.lines.join("\n"));
    assert.match(line, /scriptWriter: rejected article a-script-1/);
    assert.match(line, /finishReason=MAX_TOKENS/);
    assert.match(line, new RegExp(`len=${SCRIPT_JSON.length}`));
  } finally { s.restore(); w.restore(); }
});

test("scriptWriter: unparseable JSON and empty text are rejected with their own reasons", async () => {
  let s = stub(() => geminiOk("{ not json"));
  let w = warnings();
  try {
    assert.equal(await writeScript(ARTICLE), null);
    assert.ok(w.lines.some(l => /unparseable_json/.test(l) && /finishReason=STOP/.test(l)));
  } finally { s.restore(); w.restore(); }
  s = stub(() => ({ data: { candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }], usageMetadata: { thoughtsTokenCount: 9 } } }));
  w = warnings();
  try {
    assert.equal(await writeScript(ARTICLE), null);
    const line = w.lines.find(l => /rejected article a-script-1 — empty/.test(l));
    assert.ok(line, w.lines.join("\n"));
    assert.match(line, /finishReason=SAFETY/);
    assert.match(line, /thoughtsTokenCount=9/);
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

test("analysisService: deep-dive request shape and result contract are unchanged", async () => {
  insertArticle("a-dd-1");
  const s = stub(() => geminiOk(JSON.stringify({ takeaways: ["Tariff of 25 percent", "Starts in March"], tone: "negative", toneReason: "Industry criticism" })));
  try {
    const r = await getOrCreateDeepDive("a-dd-1", { allowGenerate: true });
    assert.deepEqual(r, { article_id: "a-dd-1", takeaways: ["Tariff of 25 percent", "Starts in March"], tone: "negative", tone_reason: "Industry criticism", related_ids: [] });
    const { body, cfg } = s.calls[0];
    assert.equal(cfg.timeout, 25000);
    assert.equal(body.generationConfig.temperature, 0.2);
    assert.equal(body.generationConfig.maxOutputTokens, 1024);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  } finally { s.restore(); }
});

test("analysisService: non-JSON model output degrades to the neutral shell (and a 503 is retried first)", async () => {
  insertArticle("a-dd-2");
  const s = stub((i) => { if (i === 1) throw err(503, "overloaded"); return geminiOk("this is prose, not JSON"); });
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

test("igSummary: plain-text request (no JSON mime type), trimmed result, no transient retry", async () => {
  const s = stub(() => geminiOk(`  ${IG_TEXT}\n`));
  try {
    const a = { id: "a-ig-1", title: "Treasury announces steel tariff", description: SOURCE, content: "<p>" + SOURCE + "</p>" };
    assert.equal(await ensureIgSummary(a), IG_TEXT);
    assert.equal(a.ig_summary, IG_TEXT);
    const { body, cfg } = s.calls[0];
    assert.equal("responseMimeType" in body.generationConfig, false);
    assert.equal(body.generationConfig.temperature, 0.65);
    assert.equal(body.generationConfig.maxOutputTokens, 512);
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
    assert.equal(cfg.timeout, 18000);
    assert.match(body.contents[0].parts[0].text, /Instagram caption body/);
  } finally { s.restore(); }
});

test("igSummary: a 503 is NOT retried; length gate rejects with the existing log line", async () => {
  let s = stub(() => { throw err(503, "overloaded"); });
  const w = warnings();
  try {
    assert.equal(await ensureIgSummary({ id: "a-ig-2", title: "T", description: SOURCE }), null);
    assert.equal(s.calls.length, 1);
  } finally { s.restore(); }
  s = stub(() => geminiOk("too short", { promptTokenCount: 5, candidatesTokenCount: 2, thoughtsTokenCount: 3 }));
  try {
    assert.equal(await ensureIgSummary({ id: "a-ig-3", title: "T", description: SOURCE }), null);
    const line = w.lines.find(l => /igSummary: rejected article a-ig-3/.test(l));
    assert.ok(line, w.lines.join("\n"));
    assert.match(line, /too_short \(len=9, finishReason=STOP, thoughtsTokenCount=3\)/);
  } finally { s.restore(); w.restore(); }
});

// ─── liveEvents ────────────────────────────────────────────────────────────

test("liveEvents: synthesis request shape and stored brief contract are unchanged", async () => {
  const now = Date.now();
  getDb().prepare(`INSERT OR REPLACE INTO articles (id, title, description, url, source_name, category, published_at, fetched_at)
    VALUES ('le-1', 'Zorbland ceasefire talks resume', 'Talks in Zorbland resume', 'https://x.test/le1', 'Wire', 'world', ?, ?)`).run(now, now);
  const s = stub(() => geminiOk(JSON.stringify({
    summary: "Talks resume", brief: [{ ts: "2026-10-01T00:00:00Z", text: "Delegations met.", sourceIndices: [1, 99] }],
    metrics: { casualties: { value: null, unit: "people", note: "n/a" } },
  })));
  try {
    const res = await refreshEvent({ id: "zorb", title: "Zorbland", subtitle: "s", emoji: "🧪", region: "x", status: "active", keywords: ["zorbland"], preferredSources: [] });
    assert.equal(res.briefCount, 1);
    assert.equal(res.articlesUsed, 1);
    const { body, cfg } = s.calls[0];
    assert.equal(cfg.timeout, 25000);
    assert.equal(body.generationConfig.temperature, 0.2);
    assert.equal(body.generationConfig.maxOutputTokens, 1536);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    const stored = getDb().prepare("SELECT brief, summary, metrics FROM live_events WHERE id = 'zorb'").get();
    assert.equal(stored.summary, "Talks resume");
    const brief = JSON.parse(stored.brief);
    assert.deepEqual(brief, [{ ts: "2026-10-01T00:00:00Z", text: "Delegations met.", sources: [{ name: "Wire", url: "https://x.test/le1" }] }]);
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
  } finally { s.restore(); w.restore(); }
});
