/**
 * embeddingsDao — sqlite-vec wrapper + sidecar metadata.
 *
 * sqlite-vec's vec0 virtual table stores only (rowid, embedding). We layer
 * a sidecar `embedding_meta` table to keep (scope, scope_id, model, dims)
 * keyed by rowid. This is the cleanest split given vec0's storage constraints.
 *
 * Cosine-similarity search via vec0's MATCH operator. ANN sub-ms on millions
 * of vectors.
 *
 * If sqlite-vec failed to load at startup (see schema.js), all functions
 * here degrade to no-ops / empty results — callers must check isVecAvailable()
 * if they need to know.
 */

import { getDb } from "../../models/database.js";
import { isVecAvailable } from "../schema.js";
import { logger } from "../../services/logger.js";

const EMBED_DIMS = 768;

function now() { return Date.now(); }

/**
 * Pack a JS number[] into the Float32Array buffer that vec0 expects.
 */
function toF32(vec) {
  if (vec instanceof Float32Array) return vec;
  if (vec.length !== EMBED_DIMS) {
    throw new Error(`embedding dim mismatch: expected ${EMBED_DIMS}, got ${vec.length}`);
  }
  return new Float32Array(vec);
}

/**
 * Upsert an embedding for (scope, scope_id). If one already exists for that
 * key, we delete + insert so vec0 sees the new vector. rowid is auto-assigned.
 */
export function upsertEmbedding({ scope, scope_id, model, vector }) {
  if (!isVecAvailable()) return null;
  const db = getDb();
  const buf = Buffer.from(toF32(vector).buffer);

  const tx = db.transaction(() => {
    const existing = db.prepare(
      `SELECT rowid FROM embedding_meta WHERE scope = ? AND scope_id = ?`
    ).get(scope, scope_id);

    if (existing) {
      db.prepare(`UPDATE embeddings SET embedding = ? WHERE rowid = ?`)
        .run(buf, existing.rowid);
      db.prepare(`UPDATE embedding_meta SET model = ?, dims = ?, created_at = ? WHERE rowid = ?`)
        .run(model, EMBED_DIMS, now(), existing.rowid);
      return existing.rowid;
    }

    // New row. Let SQLite assign the rowid via a single INSERT into vec0,
    // then write the same rowid into the sidecar metadata row.
    const out = db.prepare(`INSERT INTO embeddings (embedding) VALUES (?)`).run(buf);
    const rowid = out.lastInsertRowid;
    db.prepare(`
      INSERT INTO embedding_meta (rowid, scope, scope_id, model, dims, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(rowid, scope, scope_id, model, EMBED_DIMS, now());
    return rowid;
  });
  return tx();
}

/**
 * Top-K nearest neighbours within an optional scope filter.
 * Returns [{ scope, scope_id, distance }] sorted by distance asc (closer = better).
 */
export function searchNearest({ vector, k = 20, scope = null } = {}) {
  if (!isVecAvailable()) return [];
  try {
    const db = getDb();
    const buf = Buffer.from(toF32(vector).buffer);
    // vec0 KNN: rank by distance, take top-K, then join sidecar for metadata.
    // We over-fetch and post-filter by scope to keep the query simple.
    const rawK = scope ? Math.max(k * 4, k + 32) : k;
    const rows = db.prepare(`
      SELECT e.rowid, e.distance
      FROM embeddings e
      WHERE e.embedding MATCH ?
      ORDER BY e.distance
      LIMIT ?
    `).all(buf, rawK);

    if (!rows.length) return [];

    const ids = rows.map(r => r.rowid);
    const placeholders = ids.map(() => "?").join(",");
    const meta = db.prepare(`
      SELECT rowid, scope, scope_id FROM embedding_meta WHERE rowid IN (${placeholders})
    `).all(...ids);
    const byRowid = Object.fromEntries(meta.map(m => [m.rowid, m]));

    const out = rows
      .map(r => {
        const m = byRowid[r.rowid];
        if (!m) return null;
        if (scope && m.scope !== scope) return null;
        return { scope: m.scope, scope_id: m.scope_id, distance: r.distance };
      })
      .filter(Boolean)
      .slice(0, k);
    return out;
  } catch (err) {
    logger.warn(`vec search failed: ${err.message}`);
    return [];
  }
}

export function getEmbeddingMeta(scope, scope_id) {
  if (!isVecAvailable()) return null;
  return getDb().prepare(
    `SELECT * FROM embedding_meta WHERE scope = ? AND scope_id = ?`
  ).get(scope, scope_id) ?? null;
}

export function countEmbeddings(scope = null) {
  if (!isVecAvailable()) return 0;
  const db = getDb();
  if (scope) {
    return db.prepare(`SELECT COUNT(*) AS n FROM embedding_meta WHERE scope = ?`).get(scope).n;
  }
  return db.prepare(`SELECT COUNT(*) AS n FROM embedding_meta`).get().n;
}

/** Delete embeddings for a given scope_id (e.g., when a market is removed). */
export function deleteEmbedding(scope, scope_id) {
  if (!isVecAvailable()) return 0;
  const db = getDb();
  const meta = db.prepare(
    `SELECT rowid FROM embedding_meta WHERE scope = ? AND scope_id = ?`
  ).get(scope, scope_id);
  if (!meta) return 0;
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM embeddings WHERE rowid = ?`).run(meta.rowid);
    db.prepare(`DELETE FROM embedding_meta WHERE rowid = ?`).run(meta.rowid);
  });
  tx();
  return 1;
}
