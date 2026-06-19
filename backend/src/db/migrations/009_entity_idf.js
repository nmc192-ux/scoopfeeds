/**
 * Migration 009: entity_idf — windowed rarity weights for entity matching (step 2b).
 *
 * One current row per canonical entity key (qid where resolved, else surface_norm) holding its
 * inverse-document-frequency over a ROLLING publication window: idf = ln(N_window / df_window).
 * The matcher (step 3) reads this to weight shared-entity overlap by rarity — windowed, not
 * all-time, so "rare = discriminative NOW" (a crisis-spiked entity gets a low idf while it's
 * ubiquitous). Recomputed on a daily cadence behind ENTITY_IDF_ENABLED (default OFF); the recompute
 * replaces the table contents atomically, so this is just the current-snapshot store. Schema only —
 * nothing reads it until step 3.
 */

export const id = "009_entity_idf";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_idf (
      key          TEXT PRIMARY KEY,   -- canonical key: qid where resolved, else surface_norm
      idf          REAL NOT NULL,      -- ln(n_window / df)
      df           INTEGER NOT NULL,   -- # window articles containing the key
      n_window     INTEGER NOT NULL,   -- # extracted articles in the window (the IDF document count)
      window_start INTEGER,
      window_end   INTEGER NOT NULL,
      computed_at  INTEGER NOT NULL
    );
  `);
}
