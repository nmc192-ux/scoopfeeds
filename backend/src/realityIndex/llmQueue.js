/**
 * llmQueue — the single, rate-limited LLM caller. Claude is the ONLY
 * generation provider.
 *
 *   callJson(prompt, { priority, task, text, schema, strictJson, withMeta,
 *                      images, temperature, maxOutputTokens, timeoutMs,
 *                      retryDelaysMs, model })
 *   embed(text, opts)
 *   getQueueStatus()
 *
 * GENERATION: Anthropic Messages API (@anthropic-ai/sdk). Model from
 * ANTHROPIC_MODEL (default claude-haiku-5-5); a caller may pass `model`.
 * The old `tier` option is accepted and ignored — there is one provider.
 *
 * ERRORS ARE CLASSIFIED, NOT SWALLOWED. The handler returns an outcome
 * ({ok, value, errClass, hard, usage, ...}); callJson unwraps it, so callers
 * still get the parsed value or null.
 *   transient (503/429/529, resets, timeouts) — retried here with backoff.
 *   hard      (401/402/403, "credit balance is too low", model 404)
 *             — nothing a retry can fix. One loud logger.error, a Healthchecks
 *               /fail ping (LLM_HEALTH_PING_URL, optional), and after
 *               LLM_BREAKER_THRESHOLD consecutive hard failures the circuit
 *               breaker opens for ~15 min: calls return null immediately
 *               instead of hammering a dead account. After the cooldown one
 *               probe is allowed; its success closes the breaker and sends the
 *               recovery ping. There is no fallback provider.
 *   A plain success ping also goes out after a good call, at most once per 10 min
 *   per process, so the check (period 1h / grace 1h) alerts if no call succeeds
 *   for ~2h. Ping URLs are bearer tokens and are never logged.
 *
 * Every provider attempt writes one llm_usage row (llmUsage.js, prices in
 * llmPricing.js). The global daily call cap (llm_daily_calls) is consumed once
 * per callJson.
 *
 * EMBEDDINGS (EMBED_PROVIDER, default gemini / gemini-embedding-001, 768-dim).
 * Gemini is used for embeddings ONLY — there is no Gemini generation path.
 *   gemini      — Gemini Embedding API, 768-dim via outputDimensionality
 *   cloudflare  — `@cf/baai/bge-base-en-v1.5` (768-dim)          [dormant]
 *   ollama      — nomic-embed-text, self-hosted (768-dim)         [dormant]
 * Embed calls are logged to llm_usage (task "embed"; the embedContent API returns
 * no token usage, so tokens and cost are NULL) and watched by EMBED_HEALTH_PING_URL
 * (/fail on a hard billing/auth/permission error; a success ping at most once per
 * 10 min per process). Ping URLs are bearer tokens and are never logged.
 */

import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../services/logger.js";
import { getDb } from "../models/database.js";
import { HEARTBEAT_PING_URLS, pingFail, pingSuccess } from "../services/heartbeatPing.js";
import { estimateCostUsd } from "./llmPricing.js";
import { createBreaker } from "./llmBreaker.js";
import { recordLlmUsage } from "./llmUsage.js";

// ─── Config ────────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL   = process.env.ANTHROPIC_MODEL   || "claude-haiku-5-5";
const ANTHROPIC_RPM     = Number.parseInt(process.env.ANTHROPIC_RPM || "", 10) || 50;

const EMBED_PROVIDER = (process.env.EMBED_PROVIDER || "").toLowerCase() || "gemini";

const DISABLED = String(process.env.LLM_DISABLED || "").toLowerCase() === "1";
const RETRY_DELAYS_MS = (process.env.LLM_RETRY_DELAYS_MS || "")
  .split(",").map(x => Number.parseInt(x, 10)).filter(Number.isFinite)
  .slice(0, 6);
if (!RETRY_DELAYS_MS.length) RETRY_DELAYS_MS.push(4000, 9000, 18000);
const PRIORITIES = { high: 0, normal: 1, low: 2 };

// Cloudflare Workers AI (embeddings only)
const CLOUDFLARE_ACCOUNT_ID  = process.env.CLOUDFLARE_ACCOUNT_ID  || "";
const CLOUDFLARE_API_TOKEN   = process.env.CLOUDFLARE_API_TOKEN   || "";
const CLOUDFLARE_EMBED_MODEL = process.env.CLOUDFLARE_EMBED_MODEL || "@cf/baai/bge-base-en-v1.5";
const CLOUDFLARE_EMBED_ENDPOINT = CLOUDFLARE_ACCOUNT_ID
  ? `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${CLOUDFLARE_EMBED_MODEL}`
  : "";

// Gemini (EMBEDDINGS ONLY). Pinned model; never a floating alias.
const GEMINI_KEY         = process.env.GEMINI_API_KEY || "";
const GEMINI_EMBED_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";

// Ollama (embeddings only, dormant)
const OLLAMA_BASE        = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

// Embedding dimensions — must match the vec0 schema in schema.js (FLOAT[768])
const EMBED_DIMS = Number.parseInt(process.env.LLM_EMBED_DIMS || process.env.GEMINI_EMBED_DIMS || "768", 10);

// ─── Daily generation-call budget (2026-07-15 cost incident) ──────────────
// A hard global ceiling on generation calls per UTC day, across every task.
// Persisted in llm_daily_calls (migration 016) so restarts do not reset the
// count. On breach: the call is refused, the caller falls back to its
// deterministic path, and we log once per task per breach-day. Embeds are NOT
// counted (tiny, capped upstream); this is a generation rail.
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

// ─── Anthropic client ──────────────────────────────────────────────────────
// maxRetries is 0 on purpose: this module owns the retry/backoff loop.
let _anthropicClient = null;
let _anthropicInjected = false; // tests only
let anthropicTemperatureRejected = false;
// Thinking is sent as {type:"disabled"} on every call by default (see rawCallAnthropic).
// If a model ever rejects that with a 400, this flips for the process.
let anthropicThinkingDisabledRejected = false;

function getAnthropicClient() {
  if (!_anthropicClient) _anthropicClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 0 });
  return _anthropicClient;
}

/** Is there a credential to call Claude with (and is the kill switch off)? */
export function isLlmAvailable() {
  return !DISABLED && (Boolean(ANTHROPIC_API_KEY) || _anthropicInjected);
}

// ─── RPM window + serial queue ─────────────────────────────────────────────

const queue = [];
let inflight = false;
const callTimestamps = [];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function withinBudget() {
  const cutoff = Date.now() - 60_000;
  while (callTimestamps.length && callTimestamps[0] < cutoff) callTimestamps.shift();
  return callTimestamps.length < ANTHROPIC_RPM;
}
function timeUntilSlotMs() {
  if (callTimestamps.length < ANTHROPIC_RPM) return 0;
  return Math.max(0, callTimestamps[0] + 60_000 - Date.now());
}

async function pump() {
  if (inflight)      return;
  if (!queue.length) return;
  inflight = true;
  try {
    while (queue.length) {
      queue.sort((a, b) => (a.prio - b.prio) || (a.enqueuedAt - b.enqueuedAt));
      const task = queue.shift();
      if (!withinBudget()) {
        const wait = timeUntilSlotMs();
        if (wait > 0) await sleep(wait + 50);
      }
      callTimestamps.push(Date.now());
      try       { task.resolve(await task.run()); }
      catch (e) { task.reject(e); }
    }
  } finally {
    inflight = false;
  }
}

function enqueue(run, priority) {
  return new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject, prio: PRIORITIES[priority] ?? 1, enqueuedAt: Date.now() });
    pump();
  });
}

// ─── Outcomes + error classification ───────────────────────────────────────

const OUTCOME = "__llmOutcome";
const okOutcome   = (value, extra = {}) => ({ [OUTCOME]: true, ok: true, value, ...extra });
const failOutcome = (errClass, extra = {}) => ({ [OUTCOME]: true, ok: false, value: null, errClass, hard: false, ...extra });

function errText(err) {
  const body = err?.response?.data ?? err?.error;
  return `${typeof body === "string" ? body : JSON.stringify(body ?? "")} ${err?.message ?? ""}`;
}

/** 503/429/529 and network resets: retried with backoff, never "hard". */
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
  if (status === 403 || /PERMISSION_DENIED|permission_error/.test(text)) return { errClass: "permission", status };
  if (status === 404) return { errClass: "model_gone", status };
  return null;
}

/** Tolerant JSON extraction (fences, preamble) for Claude's no-schema JSON mode. */
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

// ─── Generation: Anthropic (Messages API) ──────────────────────────────────

const ANTHROPIC_JSON_SYSTEM = "You are a helpful assistant. Respond with valid JSON only — no prose, no markdown fences.";
// Anthropic stop_reason → the finishReason vocabulary the callers' truncation /
// diagnostic log lines already speak ("MAX_TOKENS" is the load-bearing one).
const ANTHROPIC_FINISH = { end_turn: "STOP", stop_sequence: "STOP", max_tokens: "MAX_TOKENS", refusal: "SAFETY", tool_use: "STOP", pause_turn: "STOP" };

function imageBlock(img, mediaType) {
  const data = typeof img === "string" ? img : Buffer.from(img).toString("base64");
  return { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

/**
 * THINKING IS OFF BY DEFAULT. claude-haiku-5-5 emits a `thinking` block unless told
 * not to, and thinking tokens count against max_tokens: on 2026-10-09 the first
 * production live-events call returned stop_reason=max_tokens, output_tokens=1536
 * and NO text — the whole cap spent thinking. These are structured-JSON tasks with
 * tight caps, so every call sends thinking:{type:"disabled"} unless the caller opts
 * in with `thinking`:
 *   undefined / false → {type:"disabled"}
 *   true              → send nothing (the model's own default, i.e. thinking on —
 *                       size maxOutputTokens for it)
 *   object            → sent verbatim (e.g. {type:"adaptive"})
 * A model that rejects {type:"disabled"} with a 400 degrades once per process.
 */
function thinkingParam(thinking) {
  if (thinking === true) return undefined;
  if (thinking && typeof thinking === "object") return thinking;
  return anthropicThinkingDisabledRejected ? undefined : { type: "disabled" };
}

async function rawCallAnthropic({
  prompt, temperature = 0.2, maxOutputTokens = 2048, model, timeoutMs, text: textMode = false,
  schema, retryDelaysMs, images, imageMediaType = "image/jpeg", thinking, task = "untagged",
}) {
  if (!ANTHROPIC_API_KEY && !_anthropicInjected) return failOutcome("unconfigured");
  const m = model || ANTHROPIC_MODEL;
  const delays = retryDelaysMs || RETRY_DELAYS_MS;
  let freeTempRetryUsed = false, freeThinkingRetryUsed = false;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    let sentThinking;
    try {
      // Images first, then the text that refers to them.
      const content = images?.length
        ? [...images.map(i => imageBlock(i, imageMediaType)), { type: "text", text: prompt }]
        : prompt;
      const params = { model: m, max_tokens: maxOutputTokens, messages: [{ role: "user", content }] };
      if (!textMode) {
        params.system = ANTHROPIC_JSON_SYSTEM;
        // Structured output when the caller supplied a schema; otherwise the
        // system instruction + tolerant parse below. Never assistant prefill.
        if (schema) params.output_config = { format: { type: "json_schema", schema } };
      }
      if (!anthropicTemperatureRejected) params.temperature = temperature;
      sentThinking = thinkingParam(thinking);
      if (sentThinking) params.thinking = sentThinking;
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
        if (msg?.stop_reason === "max_tokens") {
          // A DISTINCT class: the output cap was spent before any text appeared
          // (thinking tokens, or a cap far too small). It must never hide behind a
          // generic "empty" — it is what silently emptied every call on 2026-10-09.
          const kinds = (msg?.content || []).map(b => b.type).join(",") || "none";
          logger.warn(
            `🧠 Anthropic EMPTY TEXT at stop_reason=max_tokens for task "${task}" (model=${m}, ` +
            `output_tokens=${u.output_tokens ?? "?"} of max_tokens=${maxOutputTokens}, blocks=${kinds}, ` +
            `thinking=${sentThinking ? sentThinking.type : "model-default"}) — the cap was consumed before any text. ` +
            `Raise this task's maxOutputTokens or keep thinking disabled.`
          );
          return failOutcome("empty_max_tokens", meta);
        }
        logger.warn(`🧠 Anthropic empty text (stop_reason=${msg?.stop_reason ?? "?"}, output_tokens=${u.output_tokens ?? "?"}, task "${task}")`);
        return failOutcome("empty", meta);
      }
      meta.textLength = out.length;
      if (textMode) return okOutcome(out, meta);
      const parsed = parseJsonLoose(out);
      return okOutcome(parsed === undefined ? { _rawText: out } : parsed, meta);
    } catch (err) {
      const status = err?.status;
      // Some models reject sampling params with a 400. Flip once for the
      // process and retry immediately without temperature (a free retry).
      if (status === 400 && !anthropicTemperatureRejected && /temperature|top_p|top_k|sampling/i.test(errText(err))) {
        anthropicTemperatureRejected = true;
        logger.warn(`🧠 Anthropic model ${m} rejected the temperature parameter — continuing WITHOUT it for all calls in this process`);
        if (!freeTempRetryUsed) { freeTempRetryUsed = true; attempt--; }
        continue;
      }
      // The same degrade for the default thinking:{type:"disabled"}: a model that
      // rejects it gets one immediate retry without it, for the rest of the process.
      // LOUD, because it silently re-exposes the max_tokens-consumed-by-thinking
      // failure for every task with a tight cap.
      if (status === 400 && sentThinking?.type === "disabled" && !anthropicThinkingDisabledRejected && /thinking/i.test(errText(err))) {
        anthropicThinkingDisabledRejected = true;
        logger.warn(
          `⚠️ Anthropic model ${m} REJECTED thinking:{type:"disabled"} — continuing WITHOUT it for ALL calls in this process. ` +
          `Thinking tokens now count against max_tokens again; tasks with small caps may return empty text ` +
          `(watch for "EMPTY TEXT at stop_reason=max_tokens"). Pick a model that accepts it, or raise the caps.`
        );
        if (!freeThinkingRetryUsed) { freeThinkingRetryUsed = true; attempt--; }
        continue;
      }
      const hard = classifyHardError(err);
      if (hard) {
        return failOutcome(hard.errClass, { hard: true, status: hard.status, model: m, message: errText(err).slice(0, 200) });
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

// ─── Health: loud error + Healthchecks ping + circuit breaker ──────────────

const breaker = createBreaker({
  threshold: Number.parseInt(process.env.LLM_BREAKER_THRESHOLD || "", 10) || 3,
  cooldownMs: Number.parseInt(process.env.LLM_BREAKER_COOLDOWN_MS || "", 10) || 15 * 60_000,
  logger,
});
let llmUnhealthy = false; // a hard failure has been reported and not yet recovered from

/**
 * No URLs, no key material — in the /fail ping body AND in the log line. The
 * ping URL is a bearer token (see heartbeatPing.js) and an API error body is
 * third-party text; neither belongs in a log sink.
 */
function scrub(text) {
  return String(text || "")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/https?:\/\/\S+/g, "[url]");
}
function pingReason(o, task) {
  return scrub(`llm ${o.errClass}${o.status ? ` ${o.status}` : ""} (model ${o.model || ANTHROPIC_MODEL}, task ${task}): ${o.message || ""}`).slice(0, 400);
}

function onHardFailure(o, task) {
  llmUnhealthy = true;
  logger.error(
    `🚨 LLM HARD FAILURE (${o.errClass}${o.status ? ` ${o.status}` : ""}) for model ${o.model || ANTHROPIC_MODEL}, task "${task}" — ` +
    `generation is DOWN until this is fixed (billing / API key / model access); deterministic fallbacks are in effect. ${scrub(o.message).slice(0, 160)}`
  );
  pingFail(HEARTBEAT_PING_URLS.llm, pingReason(o, task));
  breaker.recordHardFailure("anthropic", `${o.errClass}${o.status ? ` ${o.status}` : ""} ${scrub(o.message).slice(0, 120)}`.trim());
}

// Success ping: at most once per interval per PROCESS (web / worker / scheduler
// each ping on their own clock). The Healthchecks check is period 1h / grace 1h,
// so it alerts when no call has succeeded anywhere for ~2h, and the /fail ping
// above turns it red immediately on a hard error. The first success after a
// hard failure pings at once (recovery), regardless of the interval.
const HEALTH_PING_INTERVAL_MS = Number.parseInt(process.env.LLM_HEALTH_PING_INTERVAL_MS || "", 10) || 10 * 60_000;
let lastOkPingAt = 0;

function onSuccess() {
  breaker.recordSuccess("anthropic");
  const now = Date.now();
  if (llmUnhealthy) {
    llmUnhealthy = false;
    logger.warn("✅ LLM recovered — a call succeeded after a hard failure");
    lastOkPingAt = now;
    pingSuccess(HEARTBEAT_PING_URLS.llm); // clears the Healthchecks fail state
  } else if (now - lastOkPingAt >= HEALTH_PING_INTERVAL_MS) {
    lastOkPingAt = now;
    pingSuccess(HEARTBEAT_PING_URLS.llm); // never awaited, never throws, URL never logged
  }
}

// ─── callJson ──────────────────────────────────────────────────────────────

async function runGeneration({ task, prompt, handlerOpts }) {
  let raw;
  try { raw = await rawCallAnthropic({ prompt, ...handlerOpts }); }
  catch (err) { raw = failOutcome("handler_threw", { message: String(err?.message || err).slice(0, 160) }); }

  const model = raw.model || handlerOpts.model || ANTHROPIC_MODEL;
  const estCostUsd = estimateCostUsd("anthropic", model, raw.inputTokens, raw.outputTokens, { logger });
  if (raw.errClass !== "unconfigured") {
    recordLlmUsage({
      task, provider: "anthropic", model,
      inputTokens: raw.inputTokens, outputTokens: raw.outputTokens,
      estCostUsd, ok: raw.ok, errorClass: raw.errClass,
    });
    if (raw.ok) onSuccess();
    else if (raw.hard) onHardFailure({ ...raw, model }, task);
  }
  return { ...raw, provider: "anthropic", model, estCostUsd };
}

function finalize(r, { task, text, strictJson, withMeta }) {
  if (withMeta) {
    return {
      ok: r.ok, value: r.value, provider: r.provider, model: r.model,
      finishReason: r.finishReason ?? null, truncated: Boolean(r.truncated), textLength: r.textLength ?? null,
      rawUsage: r.rawUsage || {}, inputTokens: r.inputTokens ?? null, outputTokens: r.outputTokens ?? null,
      estCostUsd: r.estCostUsd ?? null, errClass: r.errClass || null,
    };
  }
  if (!r.ok) return null;
  if (!text && strictJson && r.value && typeof r.value === "object" && "_rawText" in r.value) {
    logger.warn(`🧠 ${task}: model returned non-JSON — treating as failure (strictJson)`);
    return null;
  }
  return r.value;
}

/**
 * `timeoutMs` rides through to the handler (default stays 30s). Added for
 * long-form generation: a film script at ~8k output tokens takes longer than
 * 30s, and the abort surfaces as ECONNRESET — which reads as a network fault,
 * not as "your timeout is smaller than your output budget".
 *
 * Opt-ins (all default off → plain parsed-JSON-or-null):
 *   text       return the raw string instead of parsed JSON
 *   schema     JSON schema → Anthropic structured output
 *   strictJson non-JSON output (`{_rawText}`) becomes null instead of a value
 *   withMeta   resolve to { ok, value, finishReason, truncated, rawUsage,
 *              model, estCostUsd, errClass, ... } — also on failure
 *   images     [Buffer | base64 string] sent as image blocks before the prompt
 *   thinking   undefined/false → thinking DISABLED (default); true → model default
 *              (thinking on); object → sent verbatim, e.g. {type:"adaptive"}
 *   retryDelaysMs  override the transient-retry backoff for this call
 */
export function callJson(prompt, opts = {}) {
  if (DISABLED) return Promise.resolve(null);
  // `tier` is accepted for source compatibility and ignored: one provider.
  const { priority = "normal", tier: _tier, task = "untagged", text = false, strictJson = false, withMeta = false, ...rest } = opts;
  if (!ANTHROPIC_API_KEY && !_anthropicInjected) return Promise.resolve(null);
  // Open breaker: do not hammer a dead account. Return before the budget and
  // the queue; the cooldown elapsing turns the next call into the probe.
  if (breaker.isOpen("anthropic")) return Promise.resolve(null);
  if (!consumeLlmBudget(task)) return Promise.resolve(null);
  const handlerOpts = { ...rest, text, task };
  return enqueue(
    async () => finalize(await runGeneration({ task, prompt, handlerOpts }), { task, text, strictJson, withMeta }),
    priority
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

// ─── Embeddings: Gemini ────────────────────────────────────────────────────

const EMBED = "__embedOutcome";
const embedOk   = (vec) => ({ [EMBED]: true, vec, errClass: null, hard: false });
const embedFail = (errClass, extra = {}) => ({ [EMBED]: true, vec: null, errClass, hard: false, ...extra });

/** Hard for embeddings: billing / auth / permission / dead model (Gemini reports a bad key as a 400). */
function classifyEmbedHardError(err) {
  const hard = classifyHardError(err);
  if (hard) return hard;
  if (/API key not valid|API_KEY_INVALID/i.test(errText(err))) return { errClass: "auth", status: err?.response?.status };
  return null;
}

const _GEMINI_EMBED_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GEMINI_KEY}`;

async function rawEmbedGemini({ text, taskType = "RETRIEVAL_DOCUMENT" }) {
  if (!GEMINI_KEY) return embedFail("unconfigured");
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
      if (!Array.isArray(vec) || !vec.length) return embedFail("empty");
      return embedOk(vec);
    } catch (err) {
      const hard = classifyEmbedHardError(err);
      if (hard) return embedFail(hard.errClass, { hard: true, status: hard.status, message: errText(err).slice(0, 200) });
      const status    = err.response?.status;
      const transient = isTransientError(err);
      if (transient && attempt < RETRY_DELAYS_MS.length) {
        logger.warn(`🧮 Gemini embed ${status || err.code} — retry ${attempt + 1}`);
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      logger.warn(`🧮 Gemini embed failed: ${status || err.code} ${err.message}`);
      return embedFail(transient ? "transient" : `http_${status || err.code || "error"}`, { status });
    }
  }
  return embedFail("exhausted");
}

// ─── Embeddings: Ollama ────────────────────────────────────────────────────

// nomic-embed-text is trained with task prefixes; unprefixed input measurably
// degrades retrieval. Documents (stored vectors) and queries (lookups) get
// their documented prefix. OLLAMA_EMBED_PREFIX=0 turns this off.
const OLLAMA_PREFIX_ON = String(process.env.OLLAMA_EMBED_PREFIX ?? "1") !== "0" && /^nomic-embed-text/i.test(OLLAMA_EMBED_MODEL);
function ollamaInput(text, taskType) {
  if (!OLLAMA_PREFIX_ON) return text;
  return `${taskType === "RETRIEVAL_QUERY" ? "search_query" : "search_document"}: ${text}`;
}

async function rawEmbedOllama({ text, taskType = "RETRIEVAL_DOCUMENT" }) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { data } = await axios.post(
        `${OLLAMA_BASE}/api/embeddings`,
        { model: OLLAMA_EMBED_MODEL, prompt: ollamaInput(text, taskType) },
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
        logger.warn("🧮 Ollama not reachable for embeddings — is the `ollama` service up? (OLLAMA_BASE_URL)");
        return null;
      }
      logger.warn(`🧮 Ollama embed failed: ${status || err.code} ${err.message}`);
      return null;
    }
  }
  return null;
}

const EMBED_HANDLERS = {
  gemini:     rawEmbedGemini,
  cloudflare: rawEmbedCloudflare, // dormant
  ollama:     rawEmbedOllama,     // dormant
};

// ─── Embedding health + usage ──────────────────────────────────────────────
// Same pattern as the generation path, minus the breaker: a hard error (billing /
// auth / permission) logs ONE loud line and pings /fail on EMBED_HEALTH_PING_URL —
// rate-limited, because embeds run at ingest rate and a dead key would otherwise
// fire per article. A success ping goes out at most once per interval per process;
// the first success after a failure pings at once (recovery).
let embedUnhealthy = false;
let lastEmbedOkPingAt = 0;
let lastEmbedFailAt = 0;
let embedCostWarned = false;

function onEmbedHardFailure(o) {
  embedUnhealthy = true;
  const now = Date.now();
  if (now - lastEmbedFailAt < HEALTH_PING_INTERVAL_MS) return;
  lastEmbedFailAt = now;
  logger.error(
    `🚨 EMBEDDING HARD FAILURE (${o.errClass}${o.status ? ` ${o.status}` : ""}) on ${EMBED_PROVIDER}/${EMBED_MODEL_BY_PROVIDER[EMBED_PROVIDER]} — ` +
    `new articles are NOT being embedded until this is fixed (billing / API key / model access). ${scrub(o.message).slice(0, 160)}`
  );
  pingFail(HEARTBEAT_PING_URLS.embed, scrub(`embed ${o.errClass}${o.status ? ` ${o.status}` : ""} (${EMBED_PROVIDER}): ${o.message || ""}`).slice(0, 400));
}

function onEmbedSuccess() {
  const now = Date.now();
  if (embedUnhealthy) {
    embedUnhealthy = false;
    logger.warn("✅ Embeddings recovered — an embed succeeded after a hard failure");
    lastEmbedOkPingAt = now;
    pingSuccess(HEARTBEAT_PING_URLS.embed);
  } else if (now - lastEmbedOkPingAt >= HEALTH_PING_INTERVAL_MS) {
    lastEmbedOkPingAt = now;
    pingSuccess(HEARTBEAT_PING_URLS.embed); // never awaited, never throws, URL never logged
  }
}

function noteEmbed(o) {
  if (o.errClass === "unconfigured") return;
  // embedContent returns no token usage and the price table has no embedding
  // rate, so tokens and cost are recorded as NULL — not guessed.
  if (!embedCostWarned) {
    embedCostWarned = true;
    logger.warn(`💲 embed usage: ${EMBED_MODEL_BY_PROVIDER[EMBED_PROVIDER]} returns no token usage and has no entry in llmPricing.js — llm_usage rows for task "embed" carry NULL tokens and est_cost_usd (calls and failures are still counted)`);
  }
  recordLlmUsage({
    task: "embed", provider: EMBED_PROVIDER, model: EMBED_MODEL_BY_PROVIDER[EMBED_PROVIDER],
    inputTokens: null, outputTokens: null, estCostUsd: null, ok: Boolean(o.vec), errorClass: o.errClass,
  });
  if (o.vec) onEmbedSuccess();
  else if (o.hard) onEmbedHardFailure(o);
}

let embedInflight = 0;
const EMBED_CONCURRENCY = Number.parseInt(process.env.LLM_EMBED_CONCURRENCY || "4", 10);

export async function embed(text, opts = {}) {
  if (DISABLED || !text) return null;
  const handler = EMBED_HANDLERS[EMBED_PROVIDER];
  if (!handler) {
    logger.warn(`🧮 Unknown EMBED_PROVIDER "${EMBED_PROVIDER}" (want gemini | cloudflare | ollama)`);
    return null;
  }
  while (embedInflight >= EMBED_CONCURRENCY) await sleep(40);
  embedInflight++;
  try {
    const raw = await handler({ text: text.slice(0, 8000), ...opts });
    // Gemini returns an outcome; the dormant handlers return a bare vector / null.
    const o = raw && raw[EMBED] ? raw : (raw ? embedOk(raw) : embedFail("no_result"));
    noteEmbed(o);
    return o.vec;
  } finally {
    embedInflight--;
  }
}

// ─── Status helpers ────────────────────────────────────────────────────────

const EMBED_MODEL_BY_PROVIDER = {
  gemini:     GEMINI_EMBED_MODEL,
  ollama:     OLLAMA_EMBED_MODEL,
  cloudflare: CLOUDFLARE_EMBED_MODEL,
};

export function getQueueStatus() {
  return {
    provider:        "anthropic",
    premiumProvider: "anthropic",
    embedProvider:   EMBED_PROVIDER,
    pending:         queue.length,
    inflight,
    rpm:             { anthropic: ANTHROPIC_RPM },
    callsLastMinute: { anthropic: callTimestamps.filter(t => t > Date.now() - 60_000).length },
    embedInflight,
    disabled:        DISABLED,
    configured:      Boolean(ANTHROPIC_API_KEY),
    genModel:        ANTHROPIC_MODEL,
    premiumModel:    ANTHROPIC_MODEL,
    embedModel:      EMBED_MODEL_BY_PROVIDER[EMBED_PROVIDER] || EMBED_PROVIDER,
    breaker:         breaker.snapshot(),
    unhealthy:       llmUnhealthy,
    embedUnhealthy,
  };
}

// ─── Test seams ────────────────────────────────────────────────────────────

export const _test = {
  breaker,
  setAnthropicClient(c) { _anthropicClient = c; _anthropicInjected = Boolean(c); },
};
