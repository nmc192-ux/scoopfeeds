/**
 * embeddingService — turn text into vectors and store them via embeddingsDao.
 *
 * Two surfaces:
 *   • embedDocument(scope, scope_id, text) — stores a vector for retrieval.
 *     Use for markets, clusters, articles, events. Idempotent: re-calling
 *     with the same (scope, scope_id) overwrites the prior vector.
 *
 *   • embedQuery(text) — returns an in-memory vector for searching, NOT stored.
 *     Use this on the matcher's "lookup" side.
 *
 * Both call out to llmQueue.embed() which talks to the Gemini Embedding API
 * (gemini-embedding-001 by default; configurable via env). Defaults to 768
 * dims to keep storage tight; bump via GEMINI_EMBED_DIMS if matcher quality
 * needs it (must also update vec0 schema in schema.js — they have to match).
 */

import { embed as llmEmbed, getQueueStatus } from "../llmQueue.js";
import { upsertEmbedding } from "../dal/embeddingsDao.js";
import { isVecAvailable } from "../schema.js";
import { logger } from "../../services/logger.js";

const DIMS = Number.parseInt(process.env.LLM_EMBED_DIMS || process.env.GEMINI_EMBED_DIMS || "768", 10);

export function embeddingsConfig() {
  const { embedModel, embedProvider } = getQueueStatus();
  return { model: embedModel, provider: embedProvider, dims: DIMS, available: isVecAvailable() };
}

/**
 * Embed a passage and persist it for retrieval.
 * Returns the rowid on success, null on failure or when vec is unavailable.
 */
export async function embedDocument({ scope, scope_id, text }) {
  if (!isVecAvailable()) return null;
  if (!text || !text.trim()) return null;

  const vec = await llmEmbed(text.slice(0, 8000), {
    taskType: "RETRIEVAL_DOCUMENT",
    outputDimensionality: DIMS,
  });
  if (!vec) return null;

  const { embedModel } = getQueueStatus();
  try {
    return upsertEmbedding({ scope, scope_id, model: embedModel, vector: vec });
  } catch (err) {
    logger.warn(`embedDocument upsert failed (${scope}/${scope_id}): ${err.message}`);
    return null;
  }
}

/**
 * Embed a query for search. Not stored; caller passes the vector to
 * embeddingsDao.searchNearest().
 */
export async function embedQuery(text) {
  if (!text || !text.trim()) return null;
  return llmEmbed(text.slice(0, 8000), { taskType: "RETRIEVAL_QUERY", outputDimensionality: DIMS });
}
