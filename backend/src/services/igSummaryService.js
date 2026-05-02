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

const GEMINI_MODEL    = "gemini-flash-latest";
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

  try {
    const { data } = await axios.post(
      GEMINI_ENDPOINT(key),
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.65, maxOutputTokens: 120 },
      },
      { timeout: 18000 }
    );

    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    if (text.length >= 30 && text.length <= 350) return text;
    return null;
  } catch (err) {
    const status = err.response?.status;
    // Log but don't throw — ig_summary is best-effort.
    logger.warn(`igSummary: Gemini ${status || err.code || err.message} for article ${article.id}`);
    return null;
  }
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
