/**
 * 035 — where the file is, and where the treated copy is.
 *
 * TWO PATHS, NEVER ONE. `local_path` is the file as it reached us; `treated_path`
 * is the graded copy the renderer draws. The source is never overwritten, for
 * the same reason the stock library never overwrites its downloads: a treatment
 * is a decision that can be revisited, and a treatment applied in place is one
 * that cannot. It also means the file we can produce if a use is challenged is
 * the file the poster actually sent, not our version of it.
 *
 * BOTH ARE RELATIVE to the quarantine root, not absolute. An absolute path
 * written on the Mac is wrong on the VPS and vice versa, and the root is
 * SCOOP_PERSISTENT_DATA_DIR-derived precisely so it can differ between them.
 * Storing absolute paths is how a database becomes machine-specific.
 *
 * WHY QUARANTINE. These files are foreign media, parsed by ffmpeg, arriving from
 * outside. They are also, at the moment they arrive, quite possibly destined to
 * be killed — a candidate can fail verification after we hold its file. So they
 * live in their own directory with their own sweeper (incidentFiles.sweep),
 * following this repo's rule that no artifact class ships without one:
 * cardSweep.js's header records what skipping that costs (36,000 files, 34GB,
 * about a month).
 */

export const id = "035_media_candidate_files";

const COLUMNS = [
  ["local_path", "TEXT"],      // as received, relative to the quarantine root
  ["treated_path", "TEXT"],    // graded copy, relative to the same root
  ["file_bytes", "INTEGER"],
  ["file_sha256", "TEXT"],     // what we hold, provably
];

export function up(db) {
  const existing = new Set(db.prepare("PRAGMA table_info(media_candidates)").all().map((c) => c.name));
  for (const [name, type] of COLUMNS) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE media_candidates ADD COLUMN ${name} ${type};`);
    }
  }

  // The sweeper's question: which rows still reference a file, and what state
  // are they in? It sweeps by ledger state rather than by mtime alone — a card
  // is a cache, a quarantined candidate is evidence.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_media_candidates_files
           ON media_candidates(status, local_path);`);
}
