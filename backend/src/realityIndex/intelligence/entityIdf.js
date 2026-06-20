/**
 * entityIdf — windowed entity rarity weights (step 2b). Computes inverse-document-frequency per
 * canonical entity key (qid where resolved, else surface_norm) over a ROLLING publication window:
 *
 *     idf(key) = ln( N_window / df_window(key) )
 *
 * where N_window = # extracted articles published in the window and df_window = # of those articles
 * containing the key. Windowed (not all-time) so rarity reflects the CURRENT corpus — a
 * crisis-spiked entity gets a low idf while it's ubiquitous ("rare = discriminative now").
 *
 * Persisted to entity_idf (current snapshot; recompute replaces it atomically) for cheap matcher
 * reads in step 3. Recompute runs on a daily cadence behind ENTITY_IDF_ENABLED (default OFF →
 * prod-neutral). Does NOT touch the matcher.
 */
import { getDb } from "../../models/database.js";
import { logger } from "../../services/logger.js";

const DEFAULT_WINDOW_MS = parseInt(process.env.ENTITY_IDF_WINDOW_MS || String(30 * 24 * 60 * 60 * 1000), 10); // ~30d, tuned in step 3

/** computeWindowedIdf(db, {windowMs, now}) → { keys, n_window, window_end }. Replaces entity_idf. */
export function computeWindowedIdf(db, { windowMs = DEFAULT_WINDOW_MS, now = Date.now() } = {}) {
  const lo = now - windowMs, hi = now;
  const N = db.prepare(
    `SELECT COUNT(DISTINCT ae.article_id) n FROM article_entities ae
       JOIN articles a ON a.id = ae.article_id WHERE a.published_at >= ? AND a.published_at < ?`
  ).get(lo, hi).n;
  if (!N) { logger.warn?.("entityIdf: no extracted articles in window — skipping recompute"); return { keys: 0, n_window: 0, window_end: hi }; }
  const rows = db.prepare(
    `SELECT COALESCE(ae.qid, ae.surface_norm) key, COUNT(DISTINCT ae.article_id) df, COUNT(DISTINCT a.category) cat_span
       FROM article_entities ae JOIN articles a ON a.id = ae.article_id
      WHERE a.published_at >= ? AND a.published_at < ? GROUP BY key`
  ).all(lo, hi);
  const ins = db.prepare("INSERT OR REPLACE INTO entity_idf (key, idf, df, n_window, window_start, window_end, computed_at, cat_span) VALUES (?,?,?,?,?,?,?,?)");
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM entity_idf").run();
    for (const r of rows) ins.run(r.key, Math.log(N / r.df), r.df, N, lo, hi, now, r.cat_span);
  });
  tx();
  return { keys: rows.length, n_window: N, window_end: hi };
}

/** read helper for the matcher (step 3). Unseen keys → max idf (ln N) = treat as maximally rare. */
export function idfOf(db, key, fallbackN = null) {
  const row = db.prepare("SELECT idf, n_window FROM entity_idf WHERE key = ?").get(key);
  if (row) return row.idf;
  const n = fallbackN ?? db.prepare("SELECT n_window FROM entity_idf LIMIT 1").get()?.n_window;
  return n ? Math.log(n) : 0;
}

export async function runEntityIdfRecompute({ now = Date.now() } = {}) {
  const stats = computeWindowedIdf(getDb(), { now });
  logger.info(`📐 entity IDF recompute — ${JSON.stringify(stats)}`);
  return stats;
}
