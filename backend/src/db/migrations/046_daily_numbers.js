/**
 * 046 — daily_numbers (#272, "By the numbers" on Originals).
 *
 * One row per UTC day (day = YYYY-MM-DD). The daily picker writes a row once and
 * never rewrites it. sources_json holds [{source_name, url}] — the outlets whose
 * current reports carry the number verbatim (at least two).
 *
 * Additive: a new table and an index. Nothing existing is read or changed.
 * Idempotent.
 */

export const id = "046_daily_numbers";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_numbers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      day           TEXT NOT NULL UNIQUE,
      picked_at     INTEGER NOT NULL,
      event_id      TEXT NOT NULL,
      number_text   TEXT NOT NULL,
      fact_text     TEXT NOT NULL,
      sources_json  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_daily_numbers_event ON daily_numbers(event_id);
  `);
}
