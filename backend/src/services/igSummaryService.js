// Generates a punchy 2–3 sentence Instagram caption body for an article using
// Gemini. The generated summary is persisted in articles.ig_summary so it's
// only generated once per article (lazy, on first IG post attempt).
//
// Falls back gracefully when:
//   - GEMINI_API_KEY is not set       → returns null (caller uses description)
//   - Gemini call fails / times out   → returns null
//   - Article already has ig_summary  → returns cached value instantly
//
// Usage in socialPublisher.js:
//   await ensureIgSummary(article);   // mutates article.ig_summary in-place
//   composeAllPlatforms(article);     // composeInstagramFeed reads article.ig_summary

import axios from "axios";
import { getDb } from "../models/database.js";
import { logger } from "./logger.js";
import {
  buildGeminiGenerationConfig,
  isGeminiThinkingRejection,
  markGeminiThinkingRejected,
  isGeminiModelGone,
  markGeminiModelGone,
} from "../realityIndex/llmQueue.js";

// PINNED model, never a "-latest" floating alias. On 2026-07-15 a floating
// alias elsewhere silently resolved to a THINKING model whose reasoning
// tokens bill as output — $23.33 of output SKU in a day with zero rows
// persisted. This service bypasses llmQueue, so it must carry the same two
// protections itself: an explicit pin + thinkingBudget:0 with graceful
// degrade (see generateSummary below).
//
// Default is gemini-3.1-flash-lite, NOT the siblings' gemini-2.5-flash — the
// 2026-07-16 pre-test found 2.5-flash returns 404 ("no longer available to
// new users"). Reads GEMINI_GENERATION_MODEL so prod's pin flows in.
const GEMINI_MODEL    = process.env.GEMINI_GENERATION_MODEL || "gemini-3.1-flash-lite";
const GEMINI_ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

// Build a 2-3 sentence punchy Instagram summary via Gemini.
// Returns the summary string on success, null on any failure.
async function generateSummary(article) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  // Combine headline + description + up to 800 chars of content for context.
  const rawContext = [
    article.title,
    article.description,
    typeof article.content === "string" ? article.content.replace(/<[^>]+>/g, " ") : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 1800)
    .trim();

  if (!rawContext) return null;

  const prompt = `You are a social media editor at Scoop, a news curation app. ` +
    `Write 2-3 clear, punchy sentences summarising this news story for an Instagram caption body. ` +
    `Be direct and factual. Lead with the most important fact. ` +
    `Keep it under 240 characters total. ` +
    `No hashtags. No emojis. No phrases like "In a significant development" or "It is worth noting". ` +
    `Just the news, plainly stated.\n\nArticle:\n${rawContext}`;

  // Log the resolved model on every call so a silent repoint (via env) or a
  // dead pin is visible in the logs rather than invisible drift.
  logger.info(`igSummary: Gemini model=${GEMINI_MODEL} for article ${article.id}`);

  // Up to 2 attempts. thinkingBudget:0 disables reasoning (this is a short
  // caption task; thinking tokens bill as output and can eat maxOutputTokens
  // so the visible text comes back empty). Models with a mandatory minimum
  // budget reject thinkingBudget:0 with a 400 — we flip the shared llmQueue
  // degrade flag and retry once WITHOUT thinkingConfig instead of failing.
  // Mirrors the pattern in llmQueue.js.
  //
  // maxOutputTokens is 512, NOT the original 120: a 30-350 char summary needs
  // ~90 tokens, but the degrade path retries WITHOUT thinkingConfig, so a
  // thinking-rejection puts us back on a reasoning model — and 120 tokens was
  // exactly the ceiling reasoning tokens exhausted, returning empty text (the
  // original 2026-05 silent failure). 512 leaves headroom for that fallback.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await axios.post(
        GEMINI_ENDPOINT(key),
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: buildGeminiGenerationConfig({ temperature: 0.65, maxOutputTokens: 512 }),
        },
        { timeout: 18000 }
      );

      const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      if (text.length >= 30 && text.length <= 350) return text;
      // Never return null here silently — this exact gate is why the failure
      // was invisible from 2026-05 to the Jul snapshot. Record WHY it was
      // rejected and the actual length, plus the Gemini response shape that
      // signals a thinking/truncation blowout (empty text + thoughtsTokenCount).
      const reason = text.length === 0 ? "empty" : text.length < 30 ? "too_short" : "too_long";
      logger.warn(
        `igSummary: rejected article ${article.id} — ${reason} (len=${text.length}, ` +
        `finishReason=${data?.candidates?.[0]?.finishReason ?? "?"}, ` +
        `thoughtsTokenCount=${data?.usageMetadata?.thoughtsTokenCount ?? "?"})`
      );
      return null;
    } catch (err) {
      if (isGeminiThinkingRejection(err)) {
        markGeminiThinkingRejected(logger);
        continue; // retry once, now without thinkingConfig
      }
      if (isGeminiModelGone(err)) {
        markGeminiModelGone(GEMINI_MODEL, logger);
        return null; // pin is dead for this key — no retry can help
      }
      const status = err.response?.status;
      // Log but don't throw — ig_summary is best-effort.
      logger.warn(`igSummary: Gemini ${status || err.code || err.message} for article ${article.id}`);
      return null;
    }
  }
  return null;
}

// Public. Mutates article.ig_summary in-place, persists to DB, returns the value.
// Safe to call even when Gemini is not configured (returns null, no DB write).
export async function ensureIgSummary(article) {
  // Fast path: already on the object (e.g. freshly selected with ig_summary col)
  if (article.ig_summary) return article.ig_summary;

  // DB cache check (in case the object came from a lean query)
  try {
    const row = getDb().prepare("SELECT ig_summary FROM articles WHERE id = ?").get(article.id);
    if (row?.ig_summary) {
      article.ig_summary = row.ig_summary;
      return row.ig_summary;
    }
  } catch (e) {
    logger.warn(`igSummary: DB read failed for ${article.id}: ${e.message}`);
  }

  // Generate
  const summary = await generateSummary(article);
  if (!summary) return null;

  // Persist
  try {
    getDb().prepare("UPDATE articles SET ig_summary = ? WHERE id = ?").run(summary, article.id);
  } catch (e) {
    logger.warn(`igSummary: DB write failed for ${article.id}: ${e.message}`);
  }

  article.ig_summary = summary;
  return summary;
}
