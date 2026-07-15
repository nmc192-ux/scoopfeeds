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
 *
 * Embedding providers (EMBED_PROVIDER):
 *   cloudflare  — `@cf/baai/bge-base-en-v1.5` (768-dim — matches sqlite-vec)
 *   ollama      — nomic-embed-text locally (768-dim)
 *   gemini      — Gemini Embedding API (768-dim via outputDimensionality)
 *
 * Public interface (unchanged):
 *   callJson(prompt, { priority, tier, ...opts })
 *   embed(text, opts)
 *   getQueueStatus()
 */

import axios from "axios";
import { logger } from "../services/logger.js";
import { getDb } from "../models/database.js";

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
  // Cerebras / Groq / NIM have no embed models — fall back to ollama or gemini.
  if (PROVIDER === "cerebras" || PROVIDER === "groq" || PROVIDER === "nim") {
    return process.env.GEMINI_API_KEY ? "gemini" : "ollama";
  }
  return PROVIDER;
})();

// ─── Config ────────────────────────────────────────────────────────────────

const RPM_DEFAULTS = {
  cerebras: 30, cloudflare: 60, groq: 25, gemini: 15, ollama: 500, nim: 10,
};

const RPM_BY_PROVIDER = {
  cerebras:   Number.parseInt(process.env.CEREBRAS_RPM   || "", 10) || RPM_DEFAULTS.cerebras,
  cloudflare: Number.parseInt(process.env.CLOUDFLARE_RPM || "", 10) || RPM_DEFAULTS.cloudflare,
  groq:       Number.parseInt(process.env.GROQ_RPM       || "", 10) || RPM_DEFAULTS.groq,
  gemini:     Number.parseInt(process.env.GEMINI_RPM     || "", 10) || RPM_DEFAULTS.gemini,
  ollama:     Number.parseInt(process.env.OLLAMA_RPM     || "", 10) || RPM_DEFAULTS.ollama,
  nim:        Number.parseInt(process.env.NIM_RPM        || "", 10) || RPM_DEFAULTS.nim,
};
if (process.env.LLM_RPM) RPM_BY_PROVIDER[PROVIDER] = Number.parseInt(process.env.LLM_RPM, 10);

const DISABLED        = String(process.env.LLM_DISABLED || process.env.GEMINI_DISABLED || "").toLowerCase() === "1";
const RETRY_DELAYS_MS = [4000, 9000, 18000];
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

// Gemini
// PINNED model, never a "-latest" floating alias: on ~2026-07 the alias
// silently resolved to a THINKING model whose reasoning tokens bill as
// output — $23.33 of a $25.77 day was output SKU with zero rows persisted
// (2026-07-15 cost incident). Pricing for the pin (gemini-2.5-flash):
// $0.30/1M input, $2.50/1M output.
const GEMINI_KEY         = process.env.GEMINI_API_KEY  || "";
const GEMINI_GEN_MODEL   = process.env.GEMINI_GENERATION_MODEL || "gemini-2.5-flash";
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

export function markGeminiThinkingRejected(logger_) {
  if (!geminiThinkingRejected) {
    geminiThinkingRejected = true;
    logger_?.warn?.(`🧠 ${GEMINI_GEN_MODEL} rejected thinkingBudget:0 — continuing WITHOUT thinkingConfig (thinking tokens will bill as output; consider a different pin)`);
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

async function _callOpenAICompat({ endpoint, apiKey, model, prompt, temperature, maxOutputTokens, label, timeout }) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { data } = await axios.post(
        endpoint,
        {
          model,
          messages: [
            { role: "system", content: "You are a helpful assistant. Always respond with valid JSON only." },
            { role: "user",   content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature,
          max_tokens: maxOutputTokens,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          timeout,
        }
      );
      const text = data?.choices?.[0]?.message?.content;
      if (!text) return null;
      // Most OpenAI-compat providers (cerebras/groq/nim) return content as a JSON STRING;
      // Cloudflare Workers AI returns it as an ALREADY-PARSED object. Accept both. A string
      // that fails to parse still falls through to the _rawText fallback.
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

async function rawCallJsonCerebras({ prompt, temperature = 0.2, maxOutputTokens = 2048, model }) {
  if (!CEREBRAS_API_KEY) return null;
  return _callOpenAICompat({
    endpoint: CEREBRAS_ENDPOINT, apiKey: CEREBRAS_API_KEY,
    model: model || CEREBRAS_MODEL,
    prompt, temperature, maxOutputTokens, label: "Cerebras", timeout: 30_000,
  });
}

async function rawCallJsonCloudflare({ prompt, temperature = 0.2, maxOutputTokens = 2048, model }) {
  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) return null;
  return _callOpenAICompat({
    endpoint: CLOUDFLARE_GEN_ENDPOINT, apiKey: CLOUDFLARE_API_TOKEN,
    model: model || CLOUDFLARE_GEN_MODEL,
    prompt, temperature, maxOutputTokens, label: "Cloudflare", timeout: 60_000,
  });
}

async function rawCallJsonGroq({ prompt, temperature = 0.2, maxOutputTokens = 2048, model }) {
  if (!GROQ_API_KEY) return null;
  return _callOpenAICompat({
    endpoint: GROQ_ENDPOINT, apiKey: GROQ_API_KEY,
    model: model || GROQ_MODEL,
    prompt, temperature, maxOutputTokens, label: "Groq", timeout: 30_000,
  });
}

async function rawCallJsonDeepseek({ prompt, temperature = 0.2, maxOutputTokens = 2048, model }) {
  if (!DEEPSEEK_API_KEY) return null;
  return _callOpenAICompat({
    endpoint: DEEPSEEK_ENDPOINT, apiKey: DEEPSEEK_API_KEY,
    model: model || DEEPSEEK_MODEL,
    prompt, temperature, maxOutputTokens, label: "DeepSeek", timeout: 30_000,
  });
}

async function rawCallJsonNim({ prompt, temperature = 0.2, maxOutputTokens = 2048, model }) {
  if (!NVIDIA_API_KEY) return null;
  return _callOpenAICompat({
    endpoint: NIM_ENDPOINT, apiKey: NVIDIA_API_KEY,
    model: model || NIM_MODEL,
    prompt, temperature, maxOutputTokens, label: "NIM", timeout: 60_000,
  });
}

// ─── Generation: Ollama (custom shape) ─────────────────────────────────────

async function rawCallJsonOllama({ prompt, temperature = 0.2, maxOutputTokens = 2048, model }) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { data } = await axios.post(
        `${OLLAMA_BASE}/api/chat`,
        {
          model:    model || OLLAMA_MODEL,
          messages: [{ role: "user", content: prompt }],
          format:   "json",
          stream:   false,
          options:  { temperature, num_predict: maxOutputTokens },
        },
        { timeout: 120_000 }
      );
      const text = data?.message?.content;
      if (!text) return null;
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

// ─── Generation: Gemini ────────────────────────────────────────────────────

const _GEMINI_GEN_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;

async function rawCallJsonGemini({ prompt, temperature = 0.2, maxOutputTokens = 2048, model }) {
  if (!GEMINI_KEY) return null;
  const m = model || GEMINI_GEN_MODEL;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { data } = await axios.post(
        _GEMINI_GEN_URL(m),
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: buildGeminiGenerationConfig({ temperature, responseMimeType: "application/json", maxOutputTokens }),
        },
        { timeout: 30_000 }
      );
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        // Log the shape of empty responses: during the 2026-07-15 incident
        // thinking silently consumed the output budget and this branch hid it.
        const fr = data?.candidates?.[0]?.finishReason;
        const thought = data?.usageMetadata?.thoughtsTokenCount;
        logger.warn(`🧠 Gemini empty text (finishReason=${fr ?? "?"}, thoughtsTokenCount=${thought ?? "?"})`);
        return null;
      }
      try { return JSON.parse(text); }
      catch { return { _rawText: text }; }
    } catch (err) {
      if (isGeminiThinkingRejection(err)) {
        markGeminiThinkingRejected(logger);
        continue; // same attempt budget, now without thinkingConfig
      }
      const status    = err.response?.status;
      const transient = status === 503 || status === 429 || err.code === "ECONNRESET" || err.code === "ETIMEDOUT";
      if (transient && attempt < RETRY_DELAYS_MS.length) {
        logger.warn(`🧠 Gemini ${status || err.code} — retry ${attempt + 1}`);
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      logger.warn(`🧠 Gemini call failed: ${status || err.code} ${err.message}`);
      return null;
    }
  }
  return null;
}

// ─── Tier → provider routing ───────────────────────────────────────────────

const GEN_HANDLERS = {
  cerebras:   rawCallJsonCerebras,
  cloudflare: rawCallJsonCloudflare,
  groq:       rawCallJsonGroq,
  deepseek:   rawCallJsonDeepseek,
  nim:        rawCallJsonNim,
  ollama:     rawCallJsonOllama,
  gemini:     rawCallJsonGemini,
};
const TIER_TO_PROVIDER = { standard: PROVIDER, premium: PREMIUM_PROVIDER };

function resolveProvider(tier) {
  const p = TIER_TO_PROVIDER[tier] || PROVIDER;
  if (GEN_HANDLERS[p]) return p;
  if (tier === "premium" && GEN_HANDLERS[PROVIDER]) return PROVIDER;
  return null;
}

export function callJson(prompt, opts = {}) {
  if (DISABLED) return Promise.resolve(null);
  const { priority = "normal", tier = "standard", task = "untagged", ...rest } = opts;
  const provider = resolveProvider(tier);
  if (!provider) {
    logger.warn(`🧠 No handler for tier="${tier}" (provider="${PROVIDER}", premium="${PREMIUM_PROVIDER}")`);
    return Promise.resolve(null);
  }
  if (!consumeLlmBudget(task)) return Promise.resolve(null);
  return enqueue(() => GEN_HANDLERS[provider]({ prompt, ...rest }), priority, provider);
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
