/**
 * scriptWriter.js — LLM-written video narration, with deterministic fallback.
 *
 * Phase V2 of docs/specs/video_production_pipeline.md.
 *
 * Replaces the mechanical template in ttsService.buildVideoScript() with a
 * model-written script that has a hook, an arc, and per-platform metadata.
 * Retention is the variable every platform's algorithm optimises for and
 * every monetization programme pays against; a templated script caps it
 * structurally no matter how good the visuals are.
 *
 * DESIGN RULES (spec §4.2) — these are the load-bearing parts:
 *
 *   1. FALLBACK IS MANDATORY. Every failure path returns null and the caller
 *      falls back to buildVideoScript(). The pipeline must never lose the
 *      ability to produce video because an API is down. Same discipline as
 *      ttsService's five-tier chain.
 *
 *   2. GROUNDING. The prompt forbids any claim not present in the supplied
 *      text. A hallucinated fact in a news video is an existential
 *      credibility risk for a product whose differentiator is source
 *      credibility — and unlike a website error, a published video cannot be
 *      quietly corrected. Output is additionally screened (§ verifyGrounding).
 *
 *   3. DARK SHIP. Off unless SCRIPT_LLM_ENABLED=1. With it off, behaviour is
 *      byte-identical to today's. Same posture as EVENT_FACETS_PERSIST.
 *
 * Required env:
 *   SCRIPT_LLM_ENABLED=1        — master switch (default off)
 *   ANTHROPIC_API_KEY           — Claude, via llmQueue (task "script-writer")
 *
 * Optional env:
 *   ANTHROPIC_MODEL             — model (default claude-haiku-5-5)
 *   SCRIPT_LLM_MAX_OUTPUT_TOKENS — output cap (default 4096)
 *   SCRIPT_LLM_WPM              — words-per-minute for duration budget (default 150)
 */

import { logger } from "./logger.js";
import { callJson, isLlmAvailable } from "../realityIndex/llmQueue.js";

// Task "script-writer". Model selection, the transient-retry loop, hard-error
// handling (loud error + health ping + circuit breaker), the daily call cap and
// usage logging all live in llmQueue. MODEL is only the default for log lines —
// the model that actually answered is on the llmQueue result and wins in
// meta.model.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";

// 4096, NOT the original 1024. Two reasons, and the second is the load-bearing
// one. (1) A full script is not a caption: the `dossier` format targets 3-6
// minutes, ~750 words of narration alone (~1000 tokens) before slides, four
// titles, description and hashtags — 1024 truncates it outright. (2) The
// thinking-rejection degrade path retries WITHOUT thinkingConfig, i.e. back on
// a reasoning model whose thinking tokens share this budget; a tight ceiling is
// precisely what returned empty text in the 2026-05 igSummary failure. Sizing
// the cap for the fallback, not the happy path, is the point.
const MAX_OUTPUT_TOKENS = Number.parseInt(process.env.SCRIPT_LLM_MAX_OUTPUT_TOKENS || "4096", 10);
const WPM = Number.parseInt(process.env.SCRIPT_LLM_WPM || "150", 10);
const TIMEOUT_MS = 25000;

export function isScriptWriterEnabled() {
  return process.env.SCRIPT_LLM_ENABLED === "1" && isLlmAvailable();
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

const FORMAT_BRIEFS = {
  short: `A 40-second vertical short for YouTube Shorts, Instagram Reels, Facebook Reels and TikTok.
Open with the single most consequential fact — no throat-clearing, no "in today's news".
Four beats: hook, what happened, why it matters, close.`,

  recap: `A 60-second vertical recap covering several stories.
Open by framing what the stories have in common or how many there are.
One tight beat per story. Close with a single line.`,

  dossier: `A 3-6 minute landscape explainer covering one developing story in depth.
Open with the latest development, then step back through how it developed.
Chapters: cold open, timeline, coverage, angles, actors, close.
This is the long-form format — it can breathe, but every sentence must earn its place.`,
};

function buildPrompt({ article, format, targetSeconds }) {
  const wordBudget = Math.round((targetSeconds / 60) * WPM);
  const brief = FORMAT_BRIEFS[format] || FORMAT_BRIEFS.short;

  const sourceText = [
    `HEADLINE: ${article.title || ""}`,
    article.description ? `SUMMARY: ${article.description}` : "",
    article.content ? `BODY: ${String(article.content).slice(0, 4000)}` : "",
    `PUBLISHER: ${article.source_name || "unknown"}`,
    article.category ? `CATEGORY: ${article.category}` : "",
  ].filter(Boolean).join("\n");

  return `You are a wire-service scriptwriter for ScoopFeeds, a news-intelligence product. You write narration for short news videos.

SOURCE MATERIAL — this is the ONLY information you may use:
"""
${sourceText}
"""

FORMAT: ${brief}

HARD RULES — violating any of these makes the output unusable:

1. GROUNDING. Every factual claim must appear in the source material above. Do not add context you happen to know. Do not infer causes, motives, or consequences. Do not predict outcomes. If the source doesn't say why something happened, the script doesn't say why either.
2. UNCERTAINTY. Preserve the source's hedging. If the source says "reportedly" or "officials say", keep that attribution. Never upgrade a claim's confidence.
3. TONE. Neutral wire-service register. No editorialising, no outrage, no clickbait, no rhetorical questions, no "you won't believe". The hook comes from a specific fact being genuinely interesting, never from sensational phrasing.
4. TTS-SAFE. The narration is read aloud by text-to-speech. Plain prose only: no markdown, no bullet characters, no parentheses, no quotation marks, no emoji. Write URLs as spoken words ("scoopfeeds dot com"). Expand abbreviations and symbols ("percent" not "%", "United Nations" not "UN" on first use). Write numbers as a newsreader would say them.
5. LENGTH. The narration must be approximately ${wordBudget} words (target duration ${targetSeconds} seconds). Staying within ten percent matters.
6. CLOSE. End the narration with a natural pointer to the full story at scoopfeeds dot com.

Return ONLY a JSON object, no markdown fence, with exactly this shape:

{
  "narration": "the full spoken script as one plain-prose string",
  "slides": [{"heading": "3-5 words", "body": "one short line, max 12 words"}],
  "titles": {
    "youtube": "max 70 chars, specific, no clickbait",
    "tiktok": "max 60 chars, plainer phrasing",
    "instagram": "max 60 chars",
    "facebook": "max 70 chars"
  },
  "description": "2-3 sentences for the video description, ending with the scoopfeeds.com link line",
  "hashtags": ["5-8 relevant tags, no # symbol, lowercase"],
  "confidence": "high | medium | low — your confidence that the source material was rich enough to script accurately"
}

Provide one slide per narration beat (4-5 for short, 6-8 for dossier). Slide text is what appears on screen; it should reinforce the narration, not duplicate it word for word.`;
}

// ─── Model call ─────────────────────────────────────────────────────────────

/**
 * Every rejection path logs the same four fields. A script can be dropped for
 * five different reasons and, until now, four of them logged something
 * different (or nothing) — which is how igSummary's length gate hid a ~100%
 * failure rate from 2026-05 until the Jul snapshot. `finishReason` +
 * `thoughtsTokenCount` are what distinguish "the model had nothing to say"
 * from "reasoning tokens ate the output budget", and they are the difference
 * between a real diagnosis and a shrug.
 */
function logRejection(articleId, reason, len, finishReason, usage, model = MODEL) {
  logger.warn(
    `🎬 scriptWriter: rejected article ${articleId} — ${reason} (len=${len}, ` +
    `model=${model}, finishReason=${finishReason ?? "?"}, ` +
    `thoughtsTokenCount=${usage?.thoughtsTokenCount ?? "?"})`
  );
}

async function callModel(prompt, articleId) {
  if (!isLlmAvailable()) return null;

  // temperature 0.4: low but not zero — scripts need some variation in phrasing
  // or every video opens the same way, which reads as automated.
  // retryDelaysMs [4000, 9000]: this caller's own transient-retry schedule.
  const res = await callJson(prompt, {
    task: "script-writer",
    temperature: 0.4,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: TIMEOUT_MS,
    retryDelaysMs: [4000, 9000],
    withMeta: true,
  });
  if (!res) return null;

  // Log the resolved model on every call so a silent repoint (via env) or a
  // dead pin is visible in the logs rather than invisible drift.
  logger.info(`🎬 scriptWriter: ${res.provider || "llm"} model=${res.model} for article ${articleId}`);

  const finishReason = res.finishReason ?? undefined;
  const usage        = res.rawUsage || {};

  if (!res.ok) {
    // Transport/auth failures were already logged by llmQueue with their
    // status. An empty body is the content failure this log line exists for.
    if (res.errClass === "empty") logRejection(articleId, "empty", 0, finishReason, usage, res.model);
    return null;
  }

  // MAX_TOKENS is a HARD rejection, never a salvage attempt. The 2026-08-02
  // live verification only exercised format=short (414-445 output tokens);
  // the production format is 5-8x that, so the 4096 cap is UNTESTED at the
  // size that matters and truncation is the failure it will produce. A
  // truncated script that happens to parse is the worst outcome available:
  // a video narrated to the point the model ran out of budget, mid-arc,
  // with nothing downstream able to tell it apart from a finished one.
  // llmQueue maps Anthropic stop_reason "max_tokens" to the MAX_TOKENS finish
  // reason these log lines have always used.
  if (res.truncated) {
    logRejection(articleId, "truncated_max_tokens", res.textLength ?? 0, finishReason, usage, res.model);
    return null;
  }

  // A truncated or fenced response is a content failure with a diagnosable
  // shape, not a transport error — keep finishReason, the one field that says
  // whether the budget was the cause.
  const parsed = res.value;
  if (!parsed || typeof parsed !== "object" || "_rawText" in parsed) {
    logRejection(articleId, "unparseable_json", res.textLength ?? 0, finishReason, usage, res.model);
    return null;
  }

  // Priced from llmPricing.js; 0 (not a guess) when the model is not in the table.
  const cost = res.estCostUsd ?? 0;

  return { parsed, usage, cost, finishReason, model: res.model, provider: res.provider };
}

// ─── Output validation ──────────────────────────────────────────────────────

// TTS-hostile characters that slip through despite the prompt rule.
function sanitizeNarration(text) {
  return String(text || "")
    .replace(/[*_#`>|]/g, "")            // markdown
    .replace(/[""'']/g, "")              // smart quotes — TTS reads them oddly
    .replace(/[()[\]{}]/g, "")           // brackets
    .replace(/\s*[–—]\s*/g, ", ")        // dashes → comma pause
    .replace(/https?:\/\/\S+/g, "scoopfeeds dot com")
    .replace(/\bscoopfeeds\.com\b/gi, "scoopfeeds dot com")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Truncate at a sentence boundary rather than mid-clause, so an overshooting
// model degrades into a shorter script rather than a script that stops dead.
function trimToWordBudget(text, budget) {
  const words = text.split(/\s+/);
  const ceiling = Math.round(budget * 1.15);
  if (words.length <= ceiling) return text;

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let out = "";
  for (const s of sentences) {
    const next = out + s;
    if (next.split(/\s+/).length > ceiling) break;
    out = next;
  }
  return (out.trim() || words.slice(0, ceiling).join(" ")).trim();
}

/**
 * Cheap grounding screen. Not a substitute for the review gate — it catches
 * the loud failure mode (a script about a different story entirely), not
 * subtle invention.
 *
 * Rationale for the specific check: proper nouns and numbers are what get
 * hallucinated in practice, and they are also what a viewer will fact-check
 * first. If the script asserts a number or a capitalised name that appears
 * nowhere in the source, that is a red flag worth failing on.
 */
function verifyGrounding(narration, article) {
  const source = `${article.title || ""} ${article.description || ""} ${article.content || ""}`.toLowerCase();
  if (source.trim().length < 80) return { ok: true, note: "source too thin to screen" };

  const suspects = [];

  // Numbers with 2+ digits (years, counts, amounts). Single digits are too
  // noisy to check and rarely the load-bearing claim.
  const numbers = narration.match(/\b\d[\d,.]{1,}\b/g) || [];
  for (const n of new Set(numbers)) {
    const bare = n.replace(/[,.]/g, "");
    if (bare.length < 2) continue;
    if (!source.replace(/[,.]/g, "").includes(bare)) suspects.push(n);
  }

  // Multi-word capitalised sequences (names, organisations, places).
  const propers = narration.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) || [];
  for (const p of new Set(propers)) {
    if (p.toLowerCase().includes("scoop")) continue;
    if (!source.includes(p.toLowerCase())) suspects.push(p);
  }

  if (suspects.length > 0) {
    return { ok: false, note: `ungrounded tokens: ${suspects.slice(0, 5).join(", ")}` };
  }
  return { ok: true, note: null };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Write a video script for an article.
 *
 * @returns {Promise<object|null>} script object, or null — caller MUST fall
 *          back to buildVideoScript() on null. Never throws.
 */
export async function writeScript(article, { format = "short", targetSeconds = 40 } = {}) {
  if (!isScriptWriterEnabled()) return null;
  if (!article?.title) return null;

  const started = Date.now();
  const wordBudget = Math.round((targetSeconds / 60) * WPM);

  try {
    const result = await callModel(buildPrompt({ article, format, targetSeconds }), article.id);
    // callModel already logged its own failure paths; this one is its own
    // reason — a well-formed response that simply has no narration field.
    if (!result) return null;
    if (!result?.parsed?.narration) {
      logRejection(article.id, "no_narration_field", 0, result.finishReason, result.usage, result.model);
      return null;
    }

    const { parsed, usage, cost, finishReason } = result;

    let narration = sanitizeNarration(parsed.narration);
    narration = trimToWordBudget(narration, wordBudget);

    const words = narration.split(/\s+/).length;
    if (words < Math.max(20, wordBudget * 0.4)) {
      logRejection(article.id, `too_short (${words}w/${wordBudget}w)`, narration.length, finishReason, usage, result.model);
      return null;
    }

    const grounding = verifyGrounding(narration, article);
    if (!grounding.ok) {
      // Fail closed. A templated-but-true script beats a fluent-but-invented
      // one every time for a credibility product.
      logRejection(article.id, `ungrounded — ${grounding.note}`, narration.length, finishReason, usage, result.model);
      return null;
    }

    if (parsed.confidence === "low") {
      logRejection(article.id, "low_confidence", narration.length, finishReason, usage, result.model);
      return null;
    }

    const script = {
      narration,
      slides: Array.isArray(parsed.slides) ? parsed.slides.slice(0, 8) : [],
      titles: parsed.titles || {},
      description: String(parsed.description || "").slice(0, 900),
      hashtags: Array.isArray(parsed.hashtags)
        ? parsed.hashtags.slice(0, 8).map(h => String(h).replace(/^#/, "").toLowerCase())
        : [],
      // Narration is synthesised, so the platform disclosure field gets set.
      // Spec §7.4.
      disclosure: true,
      meta: {
        model: result.model || MODEL,
        format,
        words: narration.split(/\s+/).length,
        wordBudget,
        costUsd: Number(cost.toFixed(5)),
        tokensIn: usage.promptTokenCount || 0,
        tokensOut: usage.candidatesTokenCount || 0,
        // Carried on SUCCESS too, not only on the rejection lines. The
        // 2026-08-02 verification reconciled cost exactly at $0.30/M in +
        // $2.50/M out with zero residual — i.e. thoughtsTokenCount was 0 —
        // and that reconciliation is only repeatable if the number rides
        // along with the script. A nonzero thoughtsTokenCount on a later run
        // means thinkingBudget:0 stopped taking effect, which is the 2026-07-15
        // cost incident starting over; finishReason is how a near-miss on the
        // token cap becomes visible before it becomes a truncation.
        finishReason: finishReason ?? null,
        thoughtsTokenCount: usage.thoughtsTokenCount ?? 0,
        ms: Date.now() - started,
      },
    };

    logger.info(
      `🎬 scriptWriter [${article.id}] ${script.meta.words}w/${wordBudget}w ` +
      `$${script.meta.costUsd} ${script.meta.ms}ms`
    );
    return script;
  } catch (err) {
    // Belt and braces — writeScript must never throw into the render loop.
    logger.warn(`🎬 scriptWriter [${article?.id}]: unexpected error — falling back`, { error: err.message });
    return null;
  }
}

export const _internals = { sanitizeNarration, trimToWordBudget, verifyGrounding, buildPrompt };
