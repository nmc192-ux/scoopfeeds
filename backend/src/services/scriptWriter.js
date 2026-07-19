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
 *   GEMINI_API_KEY              — reuses the key analysisService already uses
 *
 * Optional env:
 *   SCRIPT_LLM_MODEL            — model pin (default gemini-2.5-flash)
 *   SCRIPT_LLM_MAX_OUTPUT_TOKENS — output cap (default 1024)
 *   SCRIPT_LLM_WPM              — words-per-minute for duration budget (default 150)
 */

import axios from "axios";
import { logger } from "./logger.js";

// PINNED, following the 2026-07-15 cost incident documented in
// analysisService.js: an unpinned "-latest" alias silently became a thinking
// model whose reasoning tokens billed as output. Never use a floating alias
// here, and never ship without maxOutputTokens.
const MODEL = process.env.SCRIPT_LLM_MODEL || "gemini-2.5-flash";
const ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

const MAX_OUTPUT_TOKENS = Number.parseInt(process.env.SCRIPT_LLM_MAX_OUTPUT_TOKENS || "1024", 10);
const WPM = Number.parseInt(process.env.SCRIPT_LLM_WPM || "150", 10);
const TIMEOUT_MS = 25000;

// Rough Gemini 2.5 Flash rates, matching the figures pinned in analysisService.
const RATE_IN_PER_M = 0.30;
const RATE_OUT_PER_M = 2.50;

export function isScriptWriterEnabled() {
  return process.env.SCRIPT_LLM_ENABLED === "1" && !!process.env.GEMINI_API_KEY;
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callModel(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const RETRY_DELAYS_MS = [4000, 9000];
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { data } = await axios.post(
        ENDPOINT(key),
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            // Low but not zero: scripts need some variation in phrasing or
            // every video opens the same way, which reads as automated.
            temperature: 0.4,
            responseMimeType: "application/json",
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
        },
        { timeout: TIMEOUT_MS }
      );

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        logger.warn(`🎬 scriptWriter: empty response (finishReason=${data?.candidates?.[0]?.finishReason ?? "?"})`);
        return null;
      }

      const usage = data?.usageMetadata || {};
      const cost =
        ((usage.promptTokenCount || 0) / 1e6) * RATE_IN_PER_M +
        ((usage.candidatesTokenCount || 0) / 1e6) * RATE_OUT_PER_M;

      return { parsed: JSON.parse(text), usage, cost };
    } catch (err) {
      const status = err.response?.status;
      const transient = status === 503 || status === 429 ||
                        err.code === "ECONNRESET" || err.code === "ETIMEDOUT";
      if (transient && attempt < RETRY_DELAYS_MS.length) {
        logger.warn(`🎬 scriptWriter: ${status || err.code} — retry in ${RETRY_DELAYS_MS[attempt]}ms`);
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      logger.warn("🎬 scriptWriter: call failed", { status, error: err.message });
      return null;
    }
  }
  return null;
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
    const result = await callModel(buildPrompt({ article, format, targetSeconds }));
    if (!result?.parsed?.narration) return null;

    const { parsed, usage, cost } = result;

    let narration = sanitizeNarration(parsed.narration);
    narration = trimToWordBudget(narration, wordBudget);

    if (narration.split(/\s+/).length < Math.max(20, wordBudget * 0.4)) {
      logger.warn(`🎬 scriptWriter [${article.id}]: script too short after cleanup — falling back`);
      return null;
    }

    const grounding = verifyGrounding(narration, article);
    if (!grounding.ok) {
      // Fail closed. A templated-but-true script beats a fluent-but-invented
      // one every time for a credibility product.
      logger.warn(`🎬 scriptWriter [${article.id}]: grounding check failed (${grounding.note}) — falling back`);
      return null;
    }

    if (parsed.confidence === "low") {
      logger.warn(`🎬 scriptWriter [${article.id}]: model reported low confidence — falling back`);
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
        model: MODEL,
        format,
        words: narration.split(/\s+/).length,
        wordBudget,
        costUsd: Number(cost.toFixed(5)),
        tokensIn: usage.promptTokenCount || 0,
        tokensOut: usage.candidatesTokenCount || 0,
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
