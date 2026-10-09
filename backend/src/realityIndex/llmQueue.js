/**
 * llmQueue — provider-agnostic, tier-aware rate-limited LLM caller.
 *
 * Two tiers:
 *   standard  — high-volume default. LLM_PROVIDER.
 *   premium   — low-volume, high-quality. LLM_PREMIUM_PROVIDER.
 *               Opt in per-call: callJson(prompt, { tier: "premium" }).
 *
 * Generation providers:
 *   cerebras    — Cerebras Cloud (1M tok/day free; Llama 3.3 70B; fastest in market)
 *   cloudflare  — Cloudflare Workers AI (10k neurons/day; Llama 3.3 70B; OpenAI-compat)
 *   groq        — Groq Cloud (~30 RPM free; Llama 3.1)
 *   nim         — NVIDIA NIM (build.nvidia.com; ~1000 free credits per model)
 *   ollama      — Local Ollama (unlimited; needs `ollama serve`)
 *   gemini      — Gemini Flash (15 RPM free; legacy)
 *   anthropic   — Claude via the Messages API (ANTHROPIC_API_KEY; default claude-haiku-5-5)
 *
 * Per-task routing (LLM_TASK_PROVIDER="ig-summary=anthropic,actors=anthropic"):
 * a listed task goes to that provider; unlisted tasks keep tier routing.
 * Fallback: anthropic <-> gemini ONLY, once, on a HARD error (401/402/403,
 * billing, dead model). Transient errors retry on the same provider and never
 * trigger a fallback. A per-provider circuit breaker stops a dead provider
 * being hit on every call. Every attempt writes an llm_usage row.
 *
 * Embedding providers (EMBED_PROVIDER):
 *   cloudflare  — `@cf/baai/bge-base-en-v1.5` (768-dim — matches sqlite-vec)
 *   ollama      — nomic-embed-text locally (768-dim)
 *   gemini      — Gemini Embedding API (768-dim via outputDimensionality)
 *
 * Public interface (unchanged):
 *   callJson(prompt, { priority, tier, task, text, schema, strictJson, withMeta, ...opts })
 *   embed(text, opts)
 *   getQueueStatus()
 */

import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../services/logger.js";
import { getDb } from "../models/database.js";
import { estimateCostUsd } from "./llmPricing.js";
import { createBreaker } from "./llmBreaker.js";
import { recordLlmUsage } from "./llmUsage.js";

// ─── Provider detection ────────────────────────────────────────────────────

const _PROVIDER_ENV = (process.env.LLM_PROVIDER || "").toLowerCase();
const PROVIDER = _PROVIDER_ENV || (() => {
  if (process.env.CEREBRAS_API_KEY)   return "cerebras";
  if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) return "cloudflare";
  if (process.env.GROQ_API_KEY)       return "groq";
  if (process.env.DEEPSEEK_API_KEY)   return "deepseek";
  if (process.env.GEMINI_API_KEY)     return "gemini";
  return "ollama";
})();

const _PREMIUM_ENV = (process.env.LLM_PREMIUM_PROVIDER || "").toLowerCase();
const PREMIUM_PROVIDER = _PREMIUM_ENV || (() => {
  if (process.env.NVIDIA_API_KEY)   return "nim";
  // Prefer Groq for premium when available: globally accessible + llama-3.3-70b-versatile
  // gives a differentiated model vs Cerebras standard tier.
  if (process.env.GROQ_API_KEY)     return "groq";
  if (process.env.CEREBRAS_API_KEY) return "cerebras";
  if (process.env.GEMINI_API_KEY)   return "gemini";
  return PROVIDER;
})();

const _EMBED_ENV = (process.env.EMBED_PROVIDER || "").toLowerCase();
const EMBED_PROVIDER = _EMBED_ENV || (() => {
  if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) return "cloudflare";
  // Cerebras / Groq / NIM / Anthropic have no embed models — fall back to ollama or gemini.
  if (PROVIDER === "cerebras" || PROVIDER === "groq" || PROVIDER === "nim" || PROVIDER === "anthropic") {
    return process.env.GEMINI_API_KEY ? "gemini" : "ollama";
  }
  return PROVIDER;
})();

// ─── Config ────────────────────────────────────────────────────────────────

const RPM_DEFAULTS = {
  cerebras: 30, cloudflare: 60, groq: 25, gemini: 15, ollama: 500, nim: 10, anthropic: 50,
};

const RPM_BY_PROVIDER = {
  cerebras:   Number.parseInt(process.env.CEREBRAS_RPM   || "", 10) || RPM_DEFAULTS.cerebras,
  cloudflare: Number.parseInt(process.env.CLOUDFLARE_RPM || "", 10) || RPM_DEFAULTS.cloudflare,
  groq:       Number.parseInt(process.env.GROQ_RPM       || "", 10) || RPM_DEFAULTS.groq,
  gemini:     Number.parseInt(process.env.GEMINI_RPM     || "", 10) || RPM_DEFAULTS.gemini,
  ollama:     Number.parseInt(process.env.OLLAMA_RPM     || "", 10) || RPM_DEFAULTS.ollama,
  nim:        Number.parseInt(process.env.NIM_RPM        || "", 10) || RPM_DEFAULTS.nim,
  anthropic:  Number.parseInt(process.env.ANTHROPIC_RPM  || "", 10) || RPM_DEFAULTS.anthropic,
};
if (process.env.LLM_RPM) RPM_BY_PROVIDER[PROVIDER] = Number.parseInt(process.env.LLM_RPM, 10);

const DISABLED        = String(process.env.LLM_DISABLED || process.env.GEMINI_DISABLED || "").toLowerCase() === "1";
const RETRY_DELAYS_MS = (process.env.LLM_RETRY_DELAYS_MS || "")
  .split(",").map(x => Number.parseInt(x, 10)).filter(Number.isFinite)
  .slice(0, 6);
if (!RETRY_DELAYS_MS.length) RETRY_DELAYS_MS.push(4000, 9000, 18000);
const PRIORITIES      = { high: 0, normal: 1, low: 2 };

// ─── Daily generation-call budget (2026-07-15 cost incident) ──────────────
// A hard global ceiling on generation calls per UTC day, across every task
// and every provider (a misroute to a paid provider must still hit the
// rail). Persisted in llm_daily_calls (migration 016) so restarts do not
// reset the count. On breach: the call is refused, the caller falls back to
// its deterministic path, and we log once per task per breach-day. Embeds
// are NOT counted (tiny, capped upstream); this is a generation rail.
const DAILY_CALL_CAP = Number.parseInt(process.env.LLM_DAILY_CALL_CAP || "2000", 10);
const _budgetWarned = new Set(); // "day:task" keys already warned

function _utcDay() { return new Date().toISOString().slice(0, 10); }

/**
 * Check-and-count one generation call against the daily rail.
 * Returns true if the call may proceed. Fail-open on DB errors (a broken
 * counter must not take down the pipeline) but logs at error level.
 */
export function consumeLlmBudget(task = "untagged") {
  try {
    const db  = getDb();
    const day = _utcDay();
    const row = db.prepare(`SELECT SUM(calls) AS total FROM llm_daily_calls WHERE day = ?`).get(day);
    if ((row?.total || 0) >= DAILY_CALL_CAP) {
      const key = `${day}:${task}`;
      if (!_budgetWarned.has(key)) {
        _budgetWarned.add(key);
        logger.error(`💸 LLM daily call cap reached (${DAILY_CALL_CAP}) — refusing "${task}" generation calls until UTC midnight (deterministic fallbacks in effect)`);
      }
      return false;
    }
    db.prepare(`
      INSERT INTO llm_daily_calls (day, task, calls) VALUES (?, ?, 1)
      ON CONFLICT(day, task) DO UPDATE SET calls = calls + 1
    `).run(day, task);
    return true;
  } catch (err) {
    logger.error(`💸 LLM budget counter failed (fail-open): ${err.message}`);
    return true;
  }
}

/** Today's per-task call counts — consumed by ops/status surfaces. */
export function getLlmBudgetStatus() {
  try {
    const day  = _utcDay();
    const rows = getDb().prepare(`SELECT task, calls FROM llm_daily_calls WHERE day = ? ORDER BY calls DESC`).all(day);
    const total = rows.reduce((s, r) => s + r.calls, 0);
    return { day, cap: DAILY_CALL_CAP, total, remaining: Math.max(0, DAILY_CALL_CAP - total), byTask: rows };
  } catch {
    return { day: _utcDay(), cap: DAILY_CALL_CAP, total: null, remaining: null, byTask: [] };
  }
}

// Cerebras
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || "";
const CEREBRAS_MODEL   = process.env.CEREBRAS_MODEL   || "llama-3.3-70b";
const CEREBRAS_ENDPOINT = "https://api.cerebras.ai/v1/chat/completions";

// Cloudflare Workers AI
const CLOUDFLARE_ACCOUNT_ID  = process.env.CLOUDFLARE_ACCOUNT_ID  || "";
const CLOUDFLARE_API_TOKEN   = process.env.CLOUDFLARE_API_TOKEN   || "";
const CLOUDFLARE_GEN_MODEL   = process.env.CLOUDFLARE_GEN_MODEL   || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const CLOUDFLARE_EMBED_MODEL = process.env.CLOUDFLARE_EMBED_MODEL || "@cf/baai/bge-base-en-v1.5";
const CLOUDFLARE_GEN_ENDPOINT = CLOUDFLARE_ACCOUNT_ID
  ? `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`
  : "";
const CLOUDFLARE_EMBED_ENDPOINT = CLOUDFLARE_ACCOUNT_ID
  ? `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${CLOUDFLARE_EMBED_MODEL}`
  : "";

// Groq
const GROQ_API_KEY  = process.env.GROQ_API_KEY || "";
const GROQ_MODEL    = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// DeepSeek (OpenAI-compatible). Default to the durable current id "deepseek-v4-flash"
// (the "deepseek-chat" alias retires 2026-07-24). Override via DEEPSEEK_MODEL.
const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_MODEL    = process.env.DEEPSEEK_MODEL    || "deepseek-v4-flash";
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";

// Ollama
const OLLAMA_BASE        = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");
const OLLAMA_MODEL       = process.env.OLLAMA_MODEL       || "llama3.1:8b";
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

// NVIDIA NIM
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const NIM_MODEL      = process.env.NIM_MODEL      || "meta/llama-3.3-70b-instruct";
const NIM_ENDPOINT   = (process.env.NIM_BASE_URL  || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "") + "/chat/completions";

// Anthropic (Messages API via the official SDK). maxRetries is 0 on purpose:
// this module owns the retry/backoff loop so every provider behaves the same.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL   = process.env.ANTHROPIC_MODEL   || "claude-haiku-5-5";
let _anthropicClient = null;
let _anthropicInjected = false; // tests only
let anthropicTemperatureRejected = false;

function getAnthropicClient() {
  if (!_anthropicClient) _anthropicClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 0 });
  return _anthropicClient;
}

// Gemini
// PINNED model, never a "-latest" floating alias: on ~2026-07 the alias
// silently resolved to a THINKING model whose reasoning tokens bill as
// output — $23.33 of a $25.77 day was output SKU with zero rows persisted
// (2026-07-15 cost incident). Rates live in llmPricing.js.
const GEMINI_KEY         = process.env.GEMINI_API_KEY  || "";
const GEMINI_GEN_MODEL   = process.env.GEMINI_GENERATION_MODEL || "gemini-3.1-flash-lite";
const GEMINI_EMBED_MODEL = process.env.GEMINI_EMBEDDING_MODEL  || "gemini-embedding-001";
// Disable "thinking" on every generateContent call: these are structured-
// JSON extraction tasks; dynamic thinking multiplies output-billed tokens
// and can eat maxOutputTokens so the visible JSON comes back empty. Models
// with a mandatory minimum budget reject thinkingBudget:0 with a 400 —
// geminiThinkingRejected flips and we degrade gracefully (retry without
// thinkingConfig) instead of crashing the queue.
const GEMINI_THINKING_CONFIG = { thinkingBudget: 0 };
let geminiThinkingRejected = false;

export function buildGeminiGenerationConfig(base) {
  return geminiThinkingRejected
    ? { ...base }
    : { ...base, thinkingConfig: { ...GEMINI_THINKING_CONFIG } };
}

export function isGeminiThinkingRejection(err) {
  const status = err?.response?.status;
  const msg = JSON.stringify(err?.response?.data || err?.message || "");
  return status === 400 && /thinking/i.test(msg);
}

// `model` names the model that ACTUALLY made the rejected call. Without it the
// warning printed this module's own GEMINI_GEN_MODEL — which is resolved once
// at import and is not the caller's pin. Observed 2026-08-02: the line read
// "gemini-3.1-flash-lite rejected thinkingBudget:0" while gemini-3.1-pro-preview
// was the caller, i.e. it named an innocent model as the culprit. Callers that
// carry their own pin (igSummaryService, scriptWriter, videoSpecWriter) should
// pass it; the default preserves the old behaviour for llmQueue's own calls.
export function markGeminiThinkingRejected(logger_, model = GEMINI_GEN_MODEL) {
  if (!geminiThinkingRejected) {
    geminiThinkingRejected = true;
    logger_?.warn?.(`🧠 ${model} rejected thinkingBudget:0 — continuing WITHOUT thinkingConfig for ALL Gemini callers in this process (thinking tokens will bill as output; consider a different pin)`);
  }
}

// A pinned model can be deprecated out from under us (the 2026-07-16
// pre-test found the then-pinned model returning 404 "no longer available to
// new users") — the floating-alias problem from the other side. A 404 on
// generateContent means the pin is DEAD for this key: fail LOUDLY once per
// model per process and fall back deterministically; never retry, never
// die silently (silent enrichment death is how this codebase's worst
// outages started).
const _modelGoneWarned = new Set();

export function isGeminiModelGone(err) {
  return err?.response?.status === 404;
}

export function markGeminiModelGone(model, logger_) {
  if (!_modelGoneWarned.has(model)) {
    _modelGoneWarned.add(model);
    logger_?.error?.(`🧠 GEMINI MODEL GONE: "${model}" returned 404 — the pin is dead for this key. Set GEMINI_GENERATION_MODEL to an available model (list them: node scripts/llm-thinking-pretest.mjs --list-models). Deterministic fallbacks in effect.`);
  }
}

// Embedding dimensions — must match the vec0 schema in schema.js (FLOAT[768])
const EMBED_DIMS = Number.parseInt(process.env.LLM_EMBED_DIMS || process.env.GEMINI_EMBED_DIMS || "768", 10);

// ─── Per-provider RPM tracking ─────────────────────────────────────────────

const queue = [];
let inflight = false;
const callTimestamps = {};

function getStamps(p) { return callTimestamps[p] || (callTimestamps[p] = []); }
function sleep(ms)    { return new Promise(r => setTimeout(r, ms)); }

function withinBudget(p) {
  const stamps = getStamps(p);
  const cutoff = Date.now() - 60_000;
  while (stamps.length && stamps[0] < cutoff) stamps.shift();
  return stamps.length < (RPM_BY_PROVIDER[p] || 15);
}
function timeUntilSlotMs(p) {
  const stamps = getStamps(p);
  const limit = RPM_BY_PROVIDER[p] || 15;
  if (stamps.length < limit) return 0;
  return Math.max(0, stamps[0] + 60_000 - Date.now());
}

async function pump() {
  if (inflight)      return;
  if (!queue.length) return;
  inflight = true;
  try {
    while (queue.length) {
      queue.sort((a, b) => (a.prio - b.prio) || (a.enqueuedAt - b.enqueuedAt));
      const task = queue.shift();
      if (!withinBudget(task.provider)) {
        const wait = timeUntilSlotMs(task.provider);
        if (wait > 0) await sleep(wait + 50);
      }
      getStamps(task.provider).push(Date.now());
      try       { task.resolve(await task.run()); }
      catch (e) { task.reject(e); }
    }
  } finally {
    inflight = false;
  }
}

function enqueue(run, priority, provider) {
  return new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject, prio: PRIORITIES[priority] ?? 1, enqueuedAt: Date.now(), provider });
    pump();
  });
}

// ─── Shared OpenAI-compatible chat call ────────────────────────────────────

async function _callOpenAICompat({ endpoint, apiKey, model, prompt, temperature, maxOutputTokens, label, timeout, text: textMode = false }) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { data } = await axios.post(
        endpoint,
        {
          model,
          messages: textMode
            ? [{ role: "user", content: prompt }]
            : [
                { role: "system", content: "You are a helpful assistant. Always respond with valid JSON only." },
                { role: "user",   content: prompt },
              ],
          ...(textMode ? {} : { response_format: { type: "json_object" } }),
          temperature,
          max_tokens: maxOutputTokens,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          timeout,
        }
      );
      const text = data?.choices?.[0]?.message?.content;
      if (!text) {
        // An empty 200 is a real provider behaviour (observed on DeepSeek:
        // intermittent empty content on the same prompt that succeeds moments
        // later — likely a content-filter flinch). finish_reason is the only
        // clue, so log it; a bare null reads as "network problem" and is not.
        logger.warn(`🧠 ${label} returned EMPTY content (finish_reason=${data?.choices?.[0]?.finish_reason ?? "?"}) — null`);
        return null;
      }
      // Most OpenAI-compat providers (cerebras/groq/nim) return content as a JSON STRING;
      // Cloudflare Workers AI returns it as an ALREADY-PARSED object. Accept both. A string
      // that fails to parse still falls through to the _rawText fallback.
      if (textMode) return String(text);
      if (typeof text === "object") return text;
      try { return JSON.parse(text); }
      catch { return { _rawText: text }; }
    } catch (err) {
      const status    = err.response?.status;
      const transient = status === 503 || status === 429 || err.code === "ECONNRESET" || err.code === "ETIMEDOUT";
      if (transient && attempt < RETRY_DELAYS_MS.length) {
        logger.warn(`🧠 ${label} ${status || err.code} — retry ${attempt + 1}`);
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      logger.warn(`🧠 ${label} call failed: ${status || err.code} ${err.message}`);
      return null;
    }
  }
  return null;
}

// ─── Generation handlers (OpenAI-compatible) ───────────────────────────────

async function rawCallJsonCerebras({ prompt, temperature = 0.2, maxOutputTokens = 2048, model, timeoutMs, text }) {
  if (!CEREBRAS_API_KEY) return null;
  return _callOpenAICompat({
    endpoint: CEREBRAS_ENDPOINT, apiKey: CEREBRAS_API_KEY,
    model: model || CEREBRAS_MODEL,
    prompt, temperature, maxOutputTokens, label: "Cerebras", timeout: timeoutMs ?? 30_000, text,
  });
}

async function rawCallJsonCloudflare({ prompt, temperature = 0.2, maxOutputTokens = 2048, model, text }) {
  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) return null;
  return _callOpenAICompat({
    endpoint: CLOUDFLARE_GEN_ENDPOINT, apiKey: CLOUDFLARE_API_TOKEN,
    model: model || CLOUDFLARE_GEN_MODEL,
    prompt, temperature, maxOutputTokens, label: "Cloudflare", timeout: 60_000, text,
  });
}

async function rawCallJsonGroq({ prompt, temperature = 0.2, maxOutputTokens = 2048, model, timeoutMs, text }) {
  if (!GROQ_API_KEY) return null;
  return _callOpenAICompat({
    endpoint: GROQ_ENDPOINT, apiKey: GROQ_API_KEY,
    model: model || GROQ_MODEL,
    prompt, temperature, maxOutputTokens, label: "Groq", timeout: timeoutMs ?? 30_000, text,
  });
}

async function rawCallJsonDeepseek({ prompt, temperature = 0.2, maxOutputTokens = 2048, model, timeoutMs, text }) {
  if (!DEEPSEEK_API_KEY) return null;
  return _callOpenAICompat({
    endpoint: DEEPSEEK_ENDPOINT, apiKey: DEEPSEEK_API_KEY,
    model: model || DEEPSEEK_MODEL,
    prompt, temperature, maxOutputTokens, label: "DeepSeek", timeout: timeoutMs ?? 30_000, text,
  });
}

async function rawCallJsonNim({ prompt, temperature = 0.2, maxOutputTokens = 2048, model, timeoutMs, text }) {
  if (!NVIDIA_API_KEY) return null;
  return _callOpenAICompat({
    endpoint: NIM_ENDPOINT, apiKey: NVIDIA_API_KEY,
    model: model || NIM_MODEL,
    prompt, temperature, maxOutputTokens, label: "NIM", timeout: 60_000, text,
  });
}

// ─── Generation: Ollama (custom shape) ─────────────────────────────────────

async function rawCallJsonOllama({ prompt, temperature = 0.2, maxOutputTokens = 2048, model, text: textMode = false }) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { data } = await axios.post(
        `${OLLAMA_BASE}/api/chat`,
        {
          model:    model || OLLAMA_MODEL,
          messages: [{ role: "user", content: prompt }],
          ...(textMode ? {} : { format: "json" }),
          stream:   false,
          options:  { temperature, num_predict: maxOutputTokens },
        },
        { timeout: 120_000 }
      );
      const text = data?.message?.content;
      if (!text) return null;
      if (textMode) return String(text);
      try { return JSON.parse(text); }
      catch { return { _rawText: text }; }
    } catch (err) {
      const status    = err.response?.status;
      const transient = status === 503 || status === 429 || err.code === "ECONNRESET" || err.code === "ETIMEDOUT" || err.code === "ECONNREFUSED";
      if (transient && attempt < RETRY_DELAYS_MS.length) {
        logger.warn(`🧠 Ollama ${status || err.code} — retry ${attempt + 1}`);
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      if (err.code === "ECONNREFUSED") {
        logger.warn("🧠 Ollama not reachable — is it running? (ollama serve)");
        return null;
      }
      logger.warn(`🧠 Ollama call failed: ${status || err.code} ${err.message}`);
      return null;
    }
  }
  return null;
}

// ─── Outcomes ──────────────────────────────────────────────────────────────
//
// Gemini and Anthropic handlers return a CLASSIFIED OUTCOME instead of a bare
// value/null, so callJson can tell a hard failure (fall back, trip the
// breaker) from a transient one (already retried on the same provider) and can
// write token usage. Callers never see an outcome: callJson unwraps it to the
// parsed value, or null on failure — exactly as before. Legacy handlers still
// return a bare value/null and are wrapped by attemptProvider().

const OUTCOME = "__llmOutcome";
const okOutcome   = (value, extra = {}) => ({ [OUTCOME]: true, ok: true, value, ...extra });
const failOutcome = (errClass, extra = {}) => ({ [OUTCOME]: true, ok: false, value: null, errClass, hard: false, ...extra });
const isOutcome   = (x) => Boolean(x && x[OUTCOME] === true);

function errText(err) {
  const body = err?.response?.data ?? err?.error;
  return `${typeof body === "string" ? body : JSON.stringify(body ?? "")} ${err?.message ?? ""}`;
}

/** 503/429/529 and network resets: retried on the SAME provider, never a fallback. */
function isTransientError(err) {
  const status = err?.status ?? err?.response?.status;
  return status === 503 || status === 429 || status === 529
    || err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT"
    || err?.name === "APIConnectionTimeoutError" || err?.name === "APIConnectionError";
}

/**
 * Hard = no retry can fix it: auth / billing / permission / dead model.
 * Returns null for anything else (including every transient error).
 */
export function classifyHardError(err) {
  const status = err?.status ?? err?.response?.status;
  const text = errText(err);
  if (/credit balance is too low/i.test(text)) return { errClass: "billing", status };
  if (status === 401) return { errClass: "auth", status };
  if (status === 402) return { errClass: "billing", status };
  if (status === 403 || /PERMISSION_DENIED/.test(text)) return { errClass: "permission", status };
  if (status === 404) return { errClass: "model_gone", status };
  if (/API key not valid|API_KEY_INVALID/i.test(text)) return { errClass: "auth", status };
  return null;
}

/** Tolerant JSON extraction for providers without a JSON mode (fences, preamble). */
export function parseJsonLoose(t) {
  if (typeof t !== "string") return undefined;
  const tryParse = (x) => { try { return JSON.parse(x); } catch { return undefined; } };
  let v = tryParse(t.trim());
  if (v !== undefined) return v;
  const unfenced = t.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  v = tryParse(unfenced.trim());
  if (v !== undefined) return v;
  const a = unfenced.search(/[[{]/);
  const b = Math.max(unfenced.lastIndexOf("}"), unfenced.lastIndexOf("]"));
  return a >= 0 && b > a ? tryParse(unfenced.slice(a, b + 1)) : undefined;
}

// ─── Generation: Gemini ────────────────────────────────────────────────────

const _GEMINI_GEN_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;

async function rawCallJsonGemini({ prompt, temperature = 0.2, maxOutputTokens = 2048, model, timeoutMs, text: textMode = false, retryDelaysMs }) {
  if (!GEMINI_KEY) return failOutcome("unconfigured");
  const m = model || GEMINI_GEN_MODEL;
  const delays = retryDelaysMs || RETRY_DELAYS_MS;
  let thinkingRetried = false;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const base = { temperature, maxOutputTokens };
      if (!textMode) base.responseMimeType = "application/json";
      const { data } = await axios.post(
        _GEMINI_GEN_URL(m),
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: buildGeminiGenerationConfig(base),
        },
        { timeout: timeoutMs ?? 30_000 }
      );
      const cand = data?.candidates?.[0];
      const um   = data?.usageMetadata || {};
      const finishReason = cand?.finishReason;
      const meta = {
        model: m,
        finishReason: finishReason ?? null,
        truncated: finishReason === "MAX_TOKENS",
        rawUsage: um,
        // Thinking tokens bill as output, so they count toward output here.
        inputTokens:  um.promptTokenCount ?? null,
        outputTokens: um.promptTokenCount == null && um.candidatesTokenCount == null
          ? null : (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0),
      };
      const out = cand?.content?.parts?.[0]?.text;
      if (!out) {
        // Log the shape of empty responses: during the 2026-07-15 incident
        // thinking silently consumed the output budget and this branch hid it.
        logger.warn(`🧠 Gemini empty text (finishReason=${finishReason ?? "?"}, thoughtsTokenCount=${um.thoughtsTokenCount ?? "?"})`);
        return failOutcome("empty", meta);
      }
      meta.textLength = out.length;
      if (textMode) return okOutcome(out, meta);
      try { return okOutcome(JSON.parse(out), meta); }
      catch { return okOutcome({ _rawText: out }, meta); }
    } catch (err) {
      if (isGeminiThinkingRejection(err)) {
        markGeminiThinkingRejected(logger);
        // The degrade retry is free: it must work even with retryDelaysMs=[]
        // (igSummary never retried transient errors, only this).
        if (!thinkingRetried) { thinkingRetried = true; attempt--; }
        continue; // now without thinkingConfig
      }
      if (isGeminiModelGone(err)) {
        markGeminiModelGone(m, logger);
        return failOutcome("model_gone", { hard: true, status: 404, model: m, message: errText(err).slice(0, 160) });
      }
      const hard = classifyHardError(err);
      if (hard) {
        logger.warn(`🧠 Gemini hard failure (${hard.errClass} ${hard.status ?? ""}): ${err.message}`);
        return failOutcome(hard.errClass, { hard: true, status: hard.status, model: m, message: errText(err).slice(0, 160) });
      }
      const status = err.response?.status;
      if (isTransientError(err) && attempt < delays.length) {
        logger.warn(`🧠 Gemini ${status || err.code} — retry ${attempt + 1}`);
        await sleep(delays[attempt]);
        continue;
      }
      logger.warn(`🧠 Gemini call failed: ${status || err.code} ${err.message}`);
      return failOutcome(isTransientError(err) ? "transient" : `http_${status || err.code || "error"}`, { status, model: m });
    }
  }
  return failOutcome("exhausted", { model: m });
}

// ─── Generation: Anthropic (Messages API) ──────────────────────────────────

const ANTHROPIC_JSON_SYSTEM = "You are a helpful assistant. Respond with valid JSON only — no prose, no markdown fences.";
// Anthropic stop_reason → the Gemini finishReason vocabulary the callers'
// existing truncation/diagnostic log lines already speak.
const ANTHROPIC_FINISH = { end_turn: "STOP", stop_sequence: "STOP", max_tokens: "MAX_TOKENS", refusal: "SAFETY", tool_use: "STOP", pause_turn: "STOP" };

async function rawCallJsonAnthropic({ prompt, temperature = 0.2, maxOutputTokens = 2048, model, timeoutMs, text: textMode = false, schema, retryDelaysMs }) {
  if (!ANTHROPIC_API_KEY && !_anthropicInjected) return failOutcome("unconfigured");
  const m = model || ANTHROPIC_MODEL;
  const delays = retryDelaysMs || RETRY_DELAYS_MS;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const params = { model: m, max_tokens: maxOutputTokens, messages: [{ role: "user", content: prompt }] };
      if (!textMode) {
        params.system = ANTHROPIC_JSON_SYSTEM;
        // Structured output when the caller supplied a schema; otherwise the
        // system instruction + tolerant parse below. Never assistant prefill.
        if (schema) params.output_config = { format: { type: "json_schema", schema } };
      }
      if (!anthropicTemperatureRejected) params.temperature = temperature;
      const msg = await getAnthropicClient().messages.create(params, { timeout: timeoutMs ?? 30_000 });

      const u = msg?.usage || {};
      const meta = {
        model: m,
        finishReason: ANTHROPIC_FINISH[msg?.stop_reason] ?? msg?.stop_reason ?? null,
        truncated: msg?.stop_reason === "max_tokens",
        rawUsage: { promptTokenCount: u.input_tokens, candidatesTokenCount: u.output_tokens, thoughtsTokenCount: 0 },
        inputTokens:  u.input_tokens ?? null,
        outputTokens: u.output_tokens ?? null,
      };
      if (msg?.stop_reason === "refusal") {
        logger.warn(`🧠 Anthropic refused (stop_reason=refusal, model=${m})`);
        return failOutcome("refusal", meta);
      }
      const out = (msg?.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      if (!out) {
        logger.warn(`🧠 Anthropic empty text (stop_reason=${msg?.stop_reason ?? "?"}, output_tokens=${u.output_tokens ?? "?"})`);
        return failOutcome("empty", meta);
      }
      meta.textLength = out.length;
      if (textMode) return okOutcome(out, meta);
      const parsed = parseJsonLoose(out);
      return okOutcome(parsed === undefined ? { _rawText: out } : parsed, meta);
    } catch (err) {
      const status = err?.status;
      // Mirror of the Gemini thinking degrade: some models reject sampling
      // params. Flip once for the process and retry without temperature.
      if (status === 400 && !anthropicTemperatureRejected && /temperature|top_p|top_k|sampling/i.test(errText(err))) {
        anthropicTemperatureRejected = true;
        logger.warn(`🧠 Anthropic model ${m} rejected the temperature parameter — continuing WITHOUT it for all Anthropic calls in this process`);
        attempt--; // free retry, as with the Gemini thinking degrade
        continue;
      }
      const hard = classifyHardError(err);
      if (hard) {
        logger.warn(`🧠 Anthropic hard failure (${hard.errClass} ${hard.status ?? ""}): ${err.message}`);
        return failOutcome(hard.errClass, { hard: true, status: hard.status, model: m, message: errText(err).slice(0, 160) });
      }
      if (isTransientError(err) && attempt < delays.length) {
        logger.warn(`🧠 Anthropic ${status || err.code || err.name} — retry ${attempt + 1}`);
        await sleep(delays[attempt]);
        continue;
      }
      logger.warn(`🧠 Anthropic call failed: ${status || err.code || err.name} ${err.message}`);
      return failOutcome(isTransientError(err) ? "transient" : `http_${status || err.code || "error"}`, { status, model: m });
    }
  }
  return failOutcome("exhausted", { model: m });
}

// ─── Tier / task → provider routing ────────────────────────────────────────

const GEN_HANDLERS = {
  cerebras:   rawCallJsonCerebras,
  cloudflare: rawCallJsonCloudflare,
  groq:       rawCallJsonGroq,
  deepseek:   rawCallJsonDeepseek,
  nim:        rawCallJsonNim,
  ollama:     rawCallJsonOllama,
  gemini:     rawCallJsonGemini,
  anthropic:  rawCallJsonAnthropic,
};
const TIER_TO_PROVIDER = { standard: PROVIDER, premium: PREMIUM_PROVIDER };

/**
 * LLM_TASK_PROVIDER="ig-summary=anthropic,actors=anthropic". Unknown providers
 * are dropped with a warning; empty/unset yields {} (zero behaviour change).
 */
export function parseTaskProviderMap(str, log = logger) {
  const out = {};
  for (const part of String(str || "").split(",")) {
    const [k, v] = part.split("=").map(x => x?.trim());
    if (!k && !v) continue;
    if (!k || !v || !GEN_HANDLERS[v.toLowerCase()]) {
      log?.warn?.(`🧠 LLM_TASK_PROVIDER: ignoring "${part.trim()}" (want task=provider, provider one of ${Object.keys(GEN_HANDLERS).join("/")})`);
      continue;
    }
    out[k] = v.toLowerCase();
  }
  return out;
}

const ENV_TASK_PROVIDER = parseTaskProviderMap(process.env.LLM_TASK_PROVIDER);

// Tasks that used to call Gemini DIRECTLY, bypassing LLM_PROVIDER. They are
// pinned to gemini here so moving them onto llmQueue changes nothing in prod
// until LLM_TASK_PROVIDER says otherwise. Unlike an env override, a pin is
// strict: if Gemini is not configured the call returns null (as it did when
// the caller's own `if (!GEMINI_API_KEY) return null` fired).
const DEFAULT_TASK_PROVIDER = {
  "live-events":        "gemini",
  "analysis":           "gemini",
  "analysis-brief":     "gemini",
  "analysis-persp":     "gemini",
  "analysis-explained": "gemini",
  "deep-dive":          "gemini",
  "ig-summary":         "gemini",
  "script-writer":      "gemini",
};

// Fallback exists ONLY between these two. Everything else keeps today's behaviour.
const FALLBACK_OF = { anthropic: "gemini", gemini: "anthropic" };
const FALLBACK_DISABLED = String(process.env.LLM_FALLBACK_DISABLED || "") === "1";

const breaker = createBreaker({
  threshold: Number.parseInt(process.env.LLM_BREAKER_THRESHOLD || "", 10) || 3,
  cooldownMs: Number.parseInt(process.env.LLM_BREAKER_COOLDOWN_MS || "", 10) || 15 * 60_000,
  logger,
});

function isProviderConfigured(p) {
  switch (p) {
    case "gemini":     return Boolean(GEMINI_KEY);
    case "anthropic":  return Boolean(ANTHROPIC_API_KEY) || _anthropicInjected;
    case "cerebras":   return Boolean(CEREBRAS_API_KEY);
    case "cloudflare": return Boolean(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ACCOUNT_ID);
    case "groq":       return Boolean(GROQ_API_KEY);
    case "deepseek":   return Boolean(DEEPSEEK_API_KEY);
    case "nim":        return Boolean(NVIDIA_API_KEY);
    default:           return true; // ollama: no key
  }
}

const _routeWarned = new Set();

/** → { provider, pinned } | null. */
function resolveRoute(tier, task) {
  const env = ENV_TASK_PROVIDER[task];
  if (env && GEN_HANDLERS[env]) {
    if (isProviderConfigured(env)) return { provider: env, pinned: false };
    if (!_routeWarned.has(task)) {
      _routeWarned.add(task);
      logger.warn(`🧠 LLM_TASK_PROVIDER routes "${task}" to ${env}, which has no credentials — using normal routing for it`);
    }
  } else if (DEFAULT_TASK_PROVIDER[task] && GEN_HANDLERS[DEFAULT_TASK_PROVIDER[task]]) {
    return { provider: DEFAULT_TASK_PROVIDER[task], pinned: true };
  }
  const p = TIER_TO_PROVIDER[tier] || PROVIDER;
  if (GEN_HANDLERS[p]) return { provider: p, pinned: false };
  if (tier === "premium" && GEN_HANDLERS[PROVIDER]) return { provider: PROVIDER, pinned: false };
  return null;
}

/**
 * Can this task produce output right now? True if its provider — or, for the
 * anthropic/gemini pair, its fallback — has credentials. Used by the
 * formerly-direct callers in place of their old `GEMINI_API_KEY` checks.
 */
export function isTaskRoutable(task, tier = "standard") {
  if (DISABLED) return false;
  const route = resolveRoute(tier, task);
  if (!route) return false;
  if (isProviderConfigured(route.provider)) return true;
  const alt = FALLBACK_DISABLED ? null : FALLBACK_OF[route.provider];
  return Boolean(alt && isProviderConfigured(alt));
}

async function acquireSlot(p) {
  while (!withinBudget(p)) await sleep(timeUntilSlotMs(p) + 50);
  getStamps(p).push(Date.now());
}

/** One provider attempt: call, normalise, write a usage row, update the breaker. */
async function attemptProvider(provider, { task, prompt, handlerOpts, acquire }) {
  if (acquire) await acquireSlot(provider);
  let raw;
  try { raw = await GEN_HANDLERS[provider]({ prompt, ...handlerOpts }); }
  catch (err) { raw = failOutcome("handler_threw", { message: String(err?.message || err).slice(0, 160) }); }

  const o = isOutcome(raw)
    ? raw
    : (raw != null ? okOutcome(raw) : failOutcome("no_result"));
  const model = o.model || handlerOpts.model || GEN_MODEL_BY_PROVIDER[provider];
  const estCostUsd = estimateCostUsd(provider, model, o.inputTokens, o.outputTokens, { logger });

  if (o.errClass !== "unconfigured") {
    recordLlmUsage({
      task, provider, model,
      inputTokens: o.inputTokens, outputTokens: o.outputTokens,
      estCostUsd, ok: o.ok, errorClass: o.errClass,
    });
    if (o.ok) breaker.recordSuccess(provider);
    else if (o.hard) breaker.recordHardFailure(provider, `${o.errClass}${o.status ? ` ${o.status}` : ""} ${o.message || ""}`.trim());
  }
  return { ...o, provider, model, estCostUsd };
}

async function runGeneration({ queuedProvider, task, prompt, handlerOpts }) {
  const alt = FALLBACK_DISABLED ? null : FALLBACK_OF[queuedProvider];
  const altOk = Boolean(alt && isProviderConfigured(alt));
  // Strip a caller-supplied `model` for the other provider: it names a model
  // that provider does not have.
  const { model: _drop, ...altOpts } = handlerOpts;

  let first = queuedProvider;
  let routedAround = false;
  if (altOk && breaker.isOpen(queuedProvider) && !breaker.isOpen(alt)) {
    first = alt; routedAround = true; // don't pay a doomed round trip
  }
  let r = await attemptProvider(first, {
    task, prompt, acquire: first !== queuedProvider,
    handlerOpts: first === queuedProvider ? handlerOpts : altOpts,
  });
  if (routedAround) r.fellBackFrom = queuedProvider;
  else if (!r.ok && r.hard && altOk) {
    logger.warn(`🔀 LLM "${task}": ${first} hard-failed (${r.errClass}${r.status ? ` ${r.status}` : ""}) — retrying once on ${alt}`);
    r = await attemptProvider(alt, { task, prompt, handlerOpts: altOpts, acquire: true });
    r.fellBackFrom = first;
  }
  return r;
}

function finalize(r, { task, text, strictJson, withMeta }) {
  if (withMeta) {
    return {
      ok: r.ok, value: r.value, provider: r.provider, model: r.model,
      finishReason: r.finishReason ?? null, truncated: Boolean(r.truncated), textLength: r.textLength ?? null,
      rawUsage: r.rawUsage || {}, inputTokens: r.inputTokens ?? null, outputTokens: r.outputTokens ?? null,
      estCostUsd: r.estCostUsd ?? null, errClass: r.errClass || null, fellBackFrom: r.fellBackFrom || null,
    };
  }
  if (!r.ok) return null;
  if (!text && strictJson && r.value && typeof r.value === "object" && "_rawText" in r.value) {
    logger.warn(`🧠 ${task}: ${r.provider} returned non-JSON — treating as failure (strictJson)`);
    return null;
  }
  return r.value;
}

/**
 * `timeoutMs` rides through to the provider handlers (default stays 30s).
 * Added for long-form generation: a film script at ~8k output tokens takes
 * longer than 30s on every provider, and the abort surfaces as ECONNRESET —
 * which reads as a network fault, not as "your timeout is smaller than your
 * output budget". Found on the first real run.
 *
 * Opt-ins (all default off → unchanged behaviour):
 *   text       return the raw string instead of parsed JSON
 *   schema     JSON schema; Anthropic uses it for structured output
 *   strictJson non-JSON output (`{_rawText}`) becomes null instead of a value
 *   withMeta   resolve to { ok, value, finishReason, truncated, rawUsage,
 *              provider, model, estCostUsd, ... } — also on failure
 *   retryDelaysMs  override the transient-retry backoff for this call
 */
export function callJson(prompt, opts = {}) {
  if (DISABLED) return Promise.resolve(null);
  const { priority = "normal", tier = "standard", task = "untagged", text = false, strictJson = false, withMeta = false, ...rest } = opts;
  const route = resolveRoute(tier, task);
  if (!route) {
    logger.warn(`🧠 No handler for tier="${tier}" (provider="${PROVIDER}", premium="${PREMIUM_PROVIDER}")`);
    return Promise.resolve(null);
  }
  const queuedProvider = route.provider;
  // A pinned task whose provider has no credentials never reaches the budget
  // or the queue — same as the old per-caller `if (!key) return null`.
  if (route.pinned && !isProviderConfigured(queuedProvider)) return Promise.resolve(null);
  if (!consumeLlmBudget(task)) return Promise.resolve(null);
  const handlerOpts = { ...rest, text };
  return enqueue(
    async () => finalize(
      await runGeneration({ queuedProvider, task, prompt, handlerOpts }),
      { task, text, strictJson, withMeta }
    ),
    priority, queuedProvider
  );
}

// ─── Embeddings: Cloudflare Workers AI ─────────────────────────────────────

async function rawEmbedCloudflare({ text }) {
  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) return null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { data } = await axios.post(
        CLOUDFLARE_EMBED_ENDPOINT,
        { text },
        {
          headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
          timeout: 30_000,
        }
      );
      // Cloudflare response: { result: { shape: [1, 768], data: [[...]] }, success: true }
      const vec = data?.result?.data?.[0];
      if (!Array.isArray(vec) || !vec.length) return null;
      if (vec.length !== EMBED_DIMS) {
        logger.warn(`Cloudflare embed dims mismatch: got ${vec.length}, want ${EMBED_DIMS}.`);
        return vec.length > EMBED_DIMS ? vec.slice(0, EMBED_DIMS) : null;
      }
      return vec;
    } catch (err) {
      const status    = err.response?.status;
      const transient = status === 503 || status === 429 || err.code === "ECONNRESET" || err.code === "ETIMEDOUT";
      if (transient && attempt < RETRY_DELAYS_MS.length) {
        logger.warn(`🧮 Cloudflare embed ${status || err.code} — retry ${attempt + 1}`);
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      logger.warn(`🧮 Cloudflare embed failed: ${status || err.code} ${err.message}`);
      return null;
    }
  }
  return null;
}

// ─── Embeddings: Ollama ────────────────────────────────────────────────────

async function rawEmbedOllama({ text }) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { data } = await axios.post(
        `${OLLAMA_BASE}/api/embeddings`,
        { model: OLLAMA_EMBED_MODEL, prompt: text },
        { timeout: 60_000 }
      );
      const vec = data?.embedding;
      if (!Array.isArray(vec) || !vec.length) return null;
      if (vec.length !== EMBED_DIMS) {
        logger.warn(`Ollama embed dims mismatch: got ${vec.length}, want ${EMBED_DIMS}.`);
        return vec.length > EMBED_DIMS ? vec.slice(0, EMBED_DIMS) : null;
      }
      return vec;
    } catch (err) {
      const status    = err.response?.status;
      const transient = status === 503 || status === 429 || err.code === "ECONNRESET" || err.code === "ETIMEDOUT" || err.code === "ECONNREFUSED";
      if (transient && attempt < RETRY_DELAYS_MS.length) {
        logger.warn(`🧮 Ollama embed ${status || err.code} — retry ${attempt + 1}`);
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      if (err.code === "ECONNREFUSED") {
        logger.warn("🧮 Ollama not reachable for embeddings — is it running?");
        return null;
      }
      logger.warn(`🧮 Ollama embed failed: ${status || err.code} ${err.message}`);
      return null;
    }
  }
  return null;
}

// ─── Embeddings: Gemini ────────────────────────────────────────────────────

const _GEMINI_EMBED_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GEMINI_KEY}`;

async function rawEmbedGemini({ text, taskType = "RETRIEVAL_DOCUMENT" }) {
  if (!GEMINI_KEY) return null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { data } = await axios.post(
        _GEMINI_EMBED_URL(GEMINI_EMBED_MODEL),
        {
          model:   `models/${GEMINI_EMBED_MODEL}`,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: EMBED_DIMS,
        },
        { timeout: 20_000 }
      );
      const vec = data?.embedding?.values;
      if (!Array.isArray(vec) || !vec.length) return null;
      return vec;
    } catch (err) {
      const status    = err.response?.status;
      const transient = status === 503 || status === 429 || err.code === "ECONNRESET" || err.code === "ETIMEDOUT";
      if (transient && attempt < RETRY_DELAYS_MS.length) {
        logger.warn(`🧮 Gemini embed ${status || err.code} — retry ${attempt + 1}`);
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      logger.warn(`🧮 Gemini embed failed: ${status || err.code} ${err.message}`);
      return null;
    }
  }
  return null;
}

const EMBED_HANDLERS = {
  cloudflare: rawEmbedCloudflare,
  ollama:     rawEmbedOllama,
  gemini:     rawEmbedGemini,
};

let embedInflight = 0;
const EMBED_CONCURRENCY = Number.parseInt(process.env.LLM_EMBED_CONCURRENCY || process.env.GEMINI_EMBED_CONCURRENCY || "4", 10);

export async function embed(text, opts = {}) {
  if (DISABLED || !text) return null;
  const handler = EMBED_HANDLERS[EMBED_PROVIDER];
  if (!handler) {
    logger.warn(`🧮 Unknown EMBED_PROVIDER "${EMBED_PROVIDER}"`);
    return null;
  }
  while (embedInflight >= EMBED_CONCURRENCY) await sleep(40);
  embedInflight++;
  try {
    return await handler({ text: text.slice(0, 8000), ...opts });
  } finally {
    embedInflight--;
  }
}

// ─── Status helpers ────────────────────────────────────────────────────────

const GEN_MODEL_BY_PROVIDER = {
  cerebras:   CEREBRAS_MODEL,
  cloudflare: CLOUDFLARE_GEN_MODEL,
  groq:       GROQ_MODEL,
  deepseek:   DEEPSEEK_MODEL,
  ollama:     OLLAMA_MODEL,
  nim:        NIM_MODEL,
  gemini:     GEMINI_GEN_MODEL,
  anthropic:  ANTHROPIC_MODEL,
};
const EMBED_MODEL_BY_PROVIDER = {
  cloudflare: CLOUDFLARE_EMBED_MODEL,
  ollama:     OLLAMA_EMBED_MODEL,
  gemini:     GEMINI_EMBED_MODEL,
};

export function getQueueStatus() {
  return {
    provider:        PROVIDER,
    premiumProvider: PREMIUM_PROVIDER,
    embedProvider:   EMBED_PROVIDER,
    taskProviders:   { ...DEFAULT_TASK_PROVIDER, ...ENV_TASK_PROVIDER },
    anthropicModel:  ANTHROPIC_API_KEY ? ANTHROPIC_MODEL : null,
    breaker:         breaker.snapshot(),
    pending:         queue.length,
    inflight,
    rpm:             RPM_BY_PROVIDER,
    callsLastMinute: Object.fromEntries(Object.entries(callTimestamps).map(([k, v]) => [k, v.length])),
    embedInflight,
    disabled:        DISABLED,
    genModel:        GEN_MODEL_BY_PROVIDER[PROVIDER]         || PROVIDER,
    premiumModel:    GEN_MODEL_BY_PROVIDER[PREMIUM_PROVIDER] || PREMIUM_PROVIDER,
    embedModel:      EMBED_MODEL_BY_PROVIDER[EMBED_PROVIDER] || EMBED_PROVIDER,
  };
}

// ─── Test seams ────────────────────────────────────────────────────────────

export const _test = {
  breaker,
  setAnthropicClient(c) { _anthropicClient = c; _anthropicInjected = Boolean(c); },
  resolveRoute,
  isProviderConfigured,
};
