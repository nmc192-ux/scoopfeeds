/**
 * vectorStore — abstract interface over the vector backend.
 *
 * Today: thin re-export of embeddingsDao (sqlite-vec). When we cut over to
 * Postgres + pgvector (Phase 8 per plan), only this file's body changes —
 * every consumer (marketMatcher, etc.) imports from here, not embeddingsDao
 * directly. The existing embeddingsDao is kept as the SQLite implementation.
 *
 * Contract every backend must satisfy:
 *   isAvailable()                              → boolean
 *   upsert({ scope, scope_id, model, vector }) → rowid|null
 *   searchNearest({ vector, k, scope })        → [{ scope, scope_id, distance }]
 *   getMeta(scope, scope_id)                   → { ... } | null
 *   count(scope?)                              → number
 *   delete(scope, scope_id)                    → number
 *
 * Backend selection: VECTOR_STORE env var. Currently only "sqlite-vec".
 * "pgvector" reserved for Phase 8.
 */

import {
  upsertEmbedding,
  searchNearest as _searchNearest,
  getEmbeddingMeta,
  countEmbeddings,
  deleteEmbedding,
} from "../dal/embeddingsDao.js";
import { isVecAvailable } from "../schema.js";
import { logger } from "../../services/logger.js";

const BACKEND = (process.env.VECTOR_STORE || "sqlite-vec").toLowerCase();

if (BACKEND !== "sqlite-vec") {
  // pgvector adapter would go here; keep loud so we don't ship a typo silently.
  logger.warn(`vectorStore: unknown backend "${BACKEND}", falling back to sqlite-vec`);
}

export const vectorStore = {
  backend: "sqlite-vec",
  isAvailable: () => isVecAvailable(),
  upsert: upsertEmbedding,
  searchNearest: _searchNearest,
  getMeta: getEmbeddingMeta,
  count: countEmbeddings,
  delete: deleteEmbedding,
};

// Convenience exports so callers can either named-import or use the object.
export const {
  isAvailable, upsert, searchNearest, getMeta, count, delete: deleteVector,
} = vectorStore;
