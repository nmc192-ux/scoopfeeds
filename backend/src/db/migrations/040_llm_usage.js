/**
 * Migration 040: llm_usage — one row per provider attempt through llmQueue.
 *
 * Why per attempt, not per callJson: a call that falls back from one provider
 * to another is two rows (the failure and the retry), which is exactly what
 * ops needs to see to judge a provider's health and the real spend.
 *
 * est_cost_usd is NULL when tokens are unknown or the model has no entry in
 * llmPricing.js — never a guess. error_class is NULL on success.
 */

export const id = "040_llm_usage";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_usage (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ts            INTEGER NOT NULL,        -- epoch ms
      task          TEXT    NOT NULL,
      provider      TEXT    NOT NULL,
      model         TEXT,
      input_tokens  INTEGER,
      output_tokens INTEGER,
      est_cost_usd  REAL,
      ok            INTEGER NOT NULL,        -- 1 / 0
      error_class   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_llm_usage_ts ON llm_usage (ts);
  `);
}
