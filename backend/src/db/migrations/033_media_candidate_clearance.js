/**
 * 033 — the clearance columns: how a candidate became usable, and whose name
 * goes on it.
 *
 * 032 gave media_candidates a `clearance_basis` (grant | fair_use | owner)
 * because the status machine needs it. That records WHICH lane; it does not
 * record the thing that would actually be produced if a use were challenged.
 * These three columns do.
 *
 * credit_text IS STRUCTURAL, NOT DECORATIVE. The renderer refuses a third-party
 * asset that has none (brief §2 Phase 3), so this is a column rather than
 * something derived at render time: derivation happens where a bug can silently
 * produce an empty string, and an uncredited frame is a rights failure rather
 * than a cosmetic one. It is computed once, at clearance, from fields already in
 * the row, and written down.
 *
 * source_type EXISTS FOR THE FAIR-USE BLOCKLIST. Lane 3 may never cover music,
 * broadcaster/network footage or sports — those are the asset classes channels
 * get struck over, and the same reasoning that keeps rights-managed licences
 * structurally absent from longformMediaGate applies here. Recording the type on
 * the row means the refusal is a property of the candidate rather than something
 * the operator has to remember at the moment of clearing.
 *
 * clearance_detail is JSON, deliberately unstructured: an owner declaration is a
 * sentence, a grant is a reference to a message, and a fair-use clearance is a
 * set of limits. Forcing all three into columns would produce a table where two
 * thirds of every row is null and the meaning of each field depends on the lane.
 */

export const id = "033_media_candidate_clearance";

/** Columns to add, with the reason each exists kept beside it. */
const COLUMNS = [
  ["credit_text", "TEXT"],        // whose name goes on the picture
  ["clearance_detail", "TEXT"],   // JSON; shape depends on the lane
  ["source_type", "TEXT"],        // eyewitness | official | broadcaster | sports | music | unknown
];

export function up(db) {
  // ALTER TABLE ADD COLUMN has no IF NOT EXISTS in SQLite, and this migration
  // must be idempotent like every other one — the table_info check is how the
  // repo's other column-adding paths do it (models/database.js's "Migrated
  // <table>: +<column>" lines).
  const existing = new Set(db.prepare("PRAGMA table_info(media_candidates)").all().map((c) => c.name));
  for (const [name, type] of COLUMNS) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE media_candidates ADD COLUMN ${name} ${type};`);
    }
  }

  // The queue's clearance view: "what is cleared and how", and the Lane 3
  // audit question "everything we are holding under fair use".
  db.exec(`CREATE INDEX IF NOT EXISTS idx_media_candidates_clearance
           ON media_candidates(clearance_basis, status);`);
}
