// Generates a punchy 2–3 sentence Instagram caption body for an article using
// the LLM (llmQueue task "ig-summary"). The generated summary is persisted in articles.ig_summary so it's
// only generated once per article (lazy, on first IG post attempt).
//
// Falls back gracefully when:
//   - no provider configured          → returns null (caller uses description)
//   - LLM call fails / times out      → returns null
//   - Article already has ig_summary  → returns cached value instantly
//
// Usage in socialPublisher.js:
//   await ensureIgSummary(article);   // mutates article.ig_summary in-place
//   composeAllPlatforms(article);     // composeInstagramFeed reads article.ig_summary

import { getDb } from "../models/database.js";
import { logger } from "./logger.js";
import { callJson, isLlmAvailable } from "../realityIndex/llmQueue.js";

// Model pin, thinking-budget degrade (thinkingBudget:0, retry once without it
// on a rejection), dead-model handling and usage logging live in llmQueue.

// Build a 2-3 sentence punchy Instagram summary via the LLM.
// Returns the summary string on success, null on any failure.
async function generateSummary(article) {
  if (!isLlmAvailable()) return null;

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

  // maxOutputTokens is 512, NOT the original 120: a 30-350 char summary needs
  // ~90 tokens, but llmQueue's thinking-rejection degrade retries WITHOUT
  // thinkingConfig, which puts us back on a reasoning model — and 120 tokens was
  // exactly the ceiling reasoning tokens exhausted, returning empty text (the
  // original 2026-05 silent failure). 512 leaves headroom for that fallback.
  // retryDelaysMs [] = no transient retry: ig_summary is best-effort and the
  // old direct call never retried a 503 either.
  const res = await callJson(prompt, {
    task: "ig-summary",
    text: true,
    temperature: 0.65,
    maxOutputTokens: 512,
    timeoutMs: 18000,
    retryDelaysMs: [],
    withMeta: true,
  });
  if (!res) return null;
  logger.info(`igSummary: ${res.provider || "llm"} model=${res.model} for article ${article.id}`);

  const text = res.ok ? String(res.value || "").trim() : "";
  if (res.ok && text.length >= 30 && text.length <= 350) return text;
  // Never return null here silently — this exact gate is why the failure
  // was invisible from 2026-05 to the Jul snapshot. Record WHY it was
  // rejected and the actual length, plus the response shape that signals a
  // thinking/truncation blowout (empty text + thoughtsTokenCount).
  if (!res.ok && !String(res.errClass).startsWith("empty")) {
    logger.warn(`igSummary: LLM call failed (${res.errClass}) for article ${article.id}`);
    return null;
  }
  const reason = text.length === 0 ? "empty" : text.length < 30 ? "too_short" : "too_long";
  logger.warn(
    `igSummary: rejected article ${article.id} — ${reason} (len=${text.length}, ` +
    `finishReason=${res.finishReason ?? "?"}, ` +
    `thoughtsTokenCount=${res.rawUsage?.thoughtsTokenCount ?? "?"})`
  );
  return null;
}

// Public. Mutates article.ig_summary in-place, persists to DB, returns the value.
// Safe to call even when no LLM is configured (returns null, no DB write).
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
