/**
 * llm-ab — A/B the video SPEC prompt on two models. Read-only.
 *
 *   node scripts/llm-ab.mjs                       # 5 freshest candidates, gemini-3.5-flash vs claude-haiku-5-5
 *   node scripts/llm-ab.mjs --n 10
 *   node scripts/llm-ab.mjs --ids id1,id2,id3
 *   node scripts/llm-ab.mjs --models gemini-3.5-flash,claude-haiku-5-5
 *   node scripts/llm-ab.mjs --dry                 # build prompts, make NO model call, spend nothing
 *   node scripts/llm-ab.mjs --json                # machine-readable report on stdout
 *
 * For each article it builds the spec prompt with videoSpecWriter's own
 * buildSpecPrompt (so the prompt is exactly what production sends), sends the
 * SAME prompt to each model with the same output cap and temperature, then
 * judges the answer with the production validator (validateSpec) after the
 * production decoration. It reports per model:
 *
 *   success rate   valid spec by validateSpec (a parse failure counts as a failure)
 *   beat count     spec.beats.length on the valid specs (mean + range)
 *   latency        wall-clock per call (median / p90)
 *   cost           from the llmPricing.js table; unknown model → "n/a", never a guess
 *
 * WHAT IT DOES NOT DO. One attempt per (article, model): production gives a
 * spec one regeneration retry after a spec-level rejection, so these success
 * rates are a first-attempt rate and read pessimistic against the live loop —
 * equally for both models. It uses the STORED article body (no full-text fetch),
 * so it is deterministic across runs. It does not render, publish or claim
 * anything.
 *
 * READ-ONLY at the handle level: the database is opened with readonly:true
 * (which is why this does not call getDb() — that would apply migrations). It
 * does not go through llmQueue either, so it writes no llm_usage rows and does
 * not touch the daily call budget. It DOES spend real API money: two calls per
 * article. The estimate is printed first; --dry spends nothing.
 *
 * Keys: GEMINI_API_KEY and ANTHROPIC_API_KEY (backend/.env, ~/.scoopfeeds.env,
 * or the environment). Database: SCOOP_DB_PATH, else $SCOOP_PERSISTENT_DATA_DIR/news.db.
 */

import "../src/config/env.js";
import path from "node:path";
import { existsSync } from "node:fs";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const N = Math.max(1, Number.parseInt(opt("n", "5"), 10) || 5);
const IDS = opt("ids", "") ? opt("ids", "").split(",").map(s => s.trim()).filter(Boolean) : [];
const MODELS = opt("models", "gemini-3.5-flash,claude-haiku-5-5").split(",").map(s => s.trim()).filter(Boolean);
const DRY = flag("dry");
const AS_JSON = flag("json");

const TEMPERATURE = 0.3;
const MAX_OUTPUT_TOKENS = Number.parseInt(process.env.VIDEO_SPEC_MAX_OUTPUT_TOKENS || "8192", 10);
const TIMEOUT_MS = 90_000;
const WPM = Number.parseInt(process.env.VIDEO_SPEC_WPM || "150", 10);

const providerOf = (m) => (/^claude/i.test(m) ? "anthropic" : "gemini");
const log = (...a) => { if (!AS_JSON) console.log(...a); };

// ── database, read-only ────────────────────────────────────────────────────
const dataDir = process.env.SCOOP_PERSISTENT_DATA_DIR || "/var/lib/scoop";
const dbPath = process.env.SCOOP_DB_PATH || path.join(dataDir, "news.db");
if (!existsSync(dbPath)) {
  console.error(`no database at ${dbPath}\nset SCOOP_DB_PATH (e.g. a node scripts/pull-prod-db.mjs copy).`);
  process.exit(2);
}
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const COLS = `a.id, a.title, a.description, a.content, a.category, a.source_name, a.published_at, a.credibility, a.url, a.tags, a.image_url`;
let articles;
if (IDS.length) {
  articles = IDS.map(id => db.prepare(`SELECT ${COLS} FROM articles a WHERE a.id = ?`).get(id)).filter(Boolean);
} else {
  articles = db.prepare(`
    SELECT ${COLS} FROM articles a
    WHERE a.published_at > ? AND a.credibility >= 7 AND a.is_duplicate = 0
    ORDER BY LENGTH(COALESCE(a.content, '')) DESC LIMIT ?
  `).all(Date.now() - 48 * 3600_000, N);
}
db.close();
if (!articles.length) { console.error("no articles found (try --ids, or a fresher database copy)."); process.exit(1); }

// ── production pieces, reused verbatim ─────────────────────────────────────
const { _internals } = await import("../src/services/videoSpecWriter.js");
const { validateSpec } = await import("../src/services/videoSpecSchema.js");
const { resolveAttribution } = await import("../src/services/videoAttribution.js");
const { buildGeminiGenerationConfig, isGeminiThinkingRejection, markGeminiThinkingRejected } = await import("../src/realityIndex/llmQueue.js");
const { estimateCostUsd } = await import("../src/realityIndex/llmPricing.js");
const { buildSpecPrompt, decorateParsedSpec, extractJsonPayload } = _internals;

const jobs = articles.map(article => {
  const credit = resolveAttribution(article);
  const allowedSources = [credit?.publisher].filter(Boolean);
  const bodyText = String(article.content || "");
  return {
    article, credit,
    prompt: buildSpecPrompt({ article, allowedSources, bodyText }),
    validateOpts: {
      allowedSources,
      sourceText: `${article.title || ""} ${article.description || ""} ${bodyText}`,
      preCreditedSources: [credit?.publisher].filter(Boolean),
      headline: String(article.title || ""),
      shotList: false, wpm: WPM,
    },
  };
});

// ── model callers (one attempt, no queue, no DB) ───────────────────────────
async function callGemini(model, prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY unset");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await axios.post(url, {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: buildGeminiGenerationConfig({ temperature: TEMPERATURE, responseMimeType: "application/json", maxOutputTokens: MAX_OUTPUT_TOKENS }),
      }, { timeout: TIMEOUT_MS });
      const um = data?.usageMetadata || {};
      return {
        text: data?.candidates?.[0]?.content?.parts?.[0]?.text || "",
        finishReason: data?.candidates?.[0]?.finishReason,
        inputTokens: um.promptTokenCount ?? null,
        outputTokens: um.promptTokenCount == null ? null : (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0),
      };
    } catch (err) {
      if (attempt === 0 && isGeminiThinkingRejection(err)) { markGeminiThinkingRejected(null, model); continue; }
      throw err;
    }
  }
  throw new Error("gemini: unreachable");
}

let _anthropic;
async function callClaude(model, prompt) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY unset");
  _anthropic ||= new Anthropic({ maxRetries: 0 });
  let params = {
    model, max_tokens: MAX_OUTPUT_TOKENS, temperature: TEMPERATURE,
    system: "You are a helpful assistant. Respond with valid JSON only — no prose, no markdown fences.",
    messages: [{ role: "user", content: prompt }],
  };
  let msg;
  try { msg = await _anthropic.messages.create(params, { timeout: TIMEOUT_MS }); }
  catch (err) {
    if (err?.status === 400 && /temperature|sampling/i.test(String(err.message))) {
      const { temperature: _t, ...rest } = params; // same degrade as llmQueue
      msg = await _anthropic.messages.create(rest, { timeout: TIMEOUT_MS });
    } else throw err;
  }
  return {
    text: (msg.content || []).filter(b => b.type === "text").map(b => b.text).join(""),
    finishReason: msg.stop_reason,
    inputTokens: msg.usage?.input_tokens ?? null,
    outputTokens: msg.usage?.output_tokens ?? null,
  };
}

async function runOne(model, job) {
  const provider = providerOf(model);
  const t0 = Date.now();
  const row = { article: job.article.id, model, provider, ok: false, beats: null, ms: null, cost: null, reason: null, finishReason: null };
  try {
    const r = provider === "anthropic" ? await callClaude(model, job.prompt) : await callGemini(model, job.prompt);
    row.ms = Date.now() - t0;
    row.finishReason = r.finishReason ?? null;
    row.cost = estimateCostUsd(provider, model, r.inputTokens, r.outputTokens, { logger: { warn: (m) => console.error(m) } });
    row.tokens = { in: r.inputTokens, out: r.outputTokens };
    if (!r.text) { row.reason = `empty response (finish=${r.finishReason})`; return row; }
    const parsed = extractJsonPayload(r.text);
    if (!parsed) { row.reason = `unparseable JSON (finish=${r.finishReason})`; return row; }
    const v = validateSpec(decorateParsedSpec(parsed, job.article, job.credit), job.validateOpts);
    row.beats = (v.spec?.beats || parsed.beats || []).length;
    if (!v.ok) { row.reason = `invalid spec: ${v.errors.slice(0, 2).join(" | ")}`; return row; }
    row.ok = true;
    return row;
  } catch (err) {
    row.ms = Date.now() - t0;
    row.reason = `call failed: ${err?.status || err?.code || ""} ${String(err?.message || err).slice(0, 120)}`.trim();
    return row;
  }
}

// ── run ────────────────────────────────────────────────────────────────────
log("─".repeat(78));
log(`llm-ab · ${jobs.length} article(s) × ${MODELS.length} model(s) · temp ${TEMPERATURE} · cap ${MAX_OUTPUT_TOKENS} tok · first attempt only`);
for (const j of jobs) log(`  ${j.article.id}  ${String(j.article.source_name).padEnd(16)} ${String(j.article.title).slice(0, 60)}  [prompt ${j.prompt.length} chars]`);
log("─".repeat(78));

if (DRY) {
  log(`--dry: ${jobs.length * MODELS.length} call(s) NOT made, nothing spent.`);
  process.exit(0);
}
log(`making ${jobs.length * MODELS.length} real API call(s)…\n`);

const rows = [];
for (const job of jobs) {
  const pair = await Promise.all(MODELS.map(m => runOne(m, job)));
  for (const r of pair) {
    rows.push(r);
    log(`  ${r.article.slice(0, 14).padEnd(14)} ${r.model.padEnd(22)} ${r.ok ? "OK  " : "FAIL"} beats=${String(r.beats ?? "-").padEnd(3)} ${String(r.ms ?? "-").padStart(6)}ms  ${r.cost == null ? "cost n/a" : "$" + r.cost.toFixed(5)}${r.reason ? "  — " + r.reason : ""}`);
  }
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const summary = MODELS.map(model => {
  const mine = rows.filter(r => r.model === model);
  const good = mine.filter(r => r.ok);
  const costs = mine.map(r => r.cost);
  const costKnown = costs.every(c => c != null) && costs.length > 0;
  const total = costKnown ? costs.reduce((a, b) => a + b, 0) : null;
  const beats = good.map(r => r.beats);
  return {
    model, provider: providerOf(model), calls: mine.length, ok: good.length,
    success_rate: mine.length ? good.length / mine.length : null,
    beats_mean: beats.length ? beats.reduce((a, b) => a + b, 0) / beats.length : null,
    beats_min: beats.length ? Math.min(...beats) : null,
    beats_max: beats.length ? Math.max(...beats) : null,
    latency_ms_median: pct(mine.map(r => r.ms).filter(x => x != null), 0.5),
    latency_ms_p90: pct(mine.map(r => r.ms).filter(x => x != null), 0.9),
    cost_total_usd: total,
    cost_per_valid_spec_usd: total != null && good.length ? total / good.length : null,
    cost_known_for_all_calls: costKnown,
  };
});

if (AS_JSON) {
  console.log(JSON.stringify({ n_articles: jobs.length, models: MODELS, summary, rows }, null, 2));
} else {
  console.log("\n" + "─".repeat(78));
  console.log("SUMMARY (first attempt, stored article body)");
  console.log("─".repeat(78));
  const f = (x, d = 1) => (x == null ? "n/a" : x.toFixed(d));
  for (const s of summary) {
    console.log(`${s.model}`);
    console.log(`  success      ${s.ok}/${s.calls}  (${f(s.success_rate * 100, 0)}%)`);
    console.log(`  beats        mean ${f(s.beats_mean)}  range ${s.beats_min ?? "n/a"}–${s.beats_max ?? "n/a"}  (valid specs only)`);
    console.log(`  latency      median ${s.latency_ms_median ?? "n/a"}ms  p90 ${s.latency_ms_p90 ?? "n/a"}ms`);
    console.log(`  cost         total ${s.cost_total_usd == null ? "n/a" + (s.cost_known_for_all_calls ? "" : " (a model/usage is missing from the price table)") : "$" + s.cost_total_usd.toFixed(5)}   per valid spec ${s.cost_per_valid_spec_usd == null ? "n/a" : "$" + s.cost_per_valid_spec_usd.toFixed(5)}`);
  }
  console.log("\nSmall-N caveat: with a handful of articles a difference of one spec is a 20-point swing. Read the per-article rows above, not just the percentages.");
}
