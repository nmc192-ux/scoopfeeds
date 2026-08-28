/**
 * 037 — the other half of append-only.
 *
 * THE HOLE THIS CLOSES. 032 made `media_candidate_events` append-only with two
 * triggers and a header explaining why an audit trail the application merely
 * promises not to edit is a promise rather than a record. It protected the trail
 * and left the table the trail describes unprotected — measured, not assumed:
 *
 *     DELETE one trail row                      REFUSED (trigger)
 *     DELETE all trail rows for the candidate   REFUSED (trigger)
 *     UPDATE a trail row (redact the evidence)  REFUSED (trigger)
 *     DELETE the candidate row                  SUCCEEDED
 *     → orphan trail rows left behind: 8
 *
 * So erasing a candidate's history never required defeating the trigger. You
 * delete the candidate and leave eight rows describing a grant, a request body
 * and a construction, pointing at an id that no longer exists — and the result
 * is UNREPAIRABLE, because those orphans cannot be deleted either. The available
 * "cleanup" turns a coherent record into an unexplainable fragment, which is
 * strictly worse than the thing the triggers were protecting against.
 *
 * That matters beyond tidiness. The Gate B permission message tells a poster
 * their decision is recorded. What makes that true is that the record cannot be
 * quietly removed. A trail reachable only through a row that anyone can drop is
 * not that.
 *
 * SAME RULE APPLIED TWICE, NOT A NEW INTEGRITY MODEL (DrJ, Gate F). This adds
 * exactly one trigger of exactly the shape 032 already uses. It does NOT make
 * `media_candidates` append-only in the trail's sense: the row is mutable by
 * design — status, credit_text, render_approved and the file columns all change
 * as a candidate moves through the machine, and the trail is what records each
 * change. Only DELETE is refused.
 *
 * RETIRING A CANDIDATE IS A STATUS, NOT A DELETE, and the machine says so at
 * every stage:
 *
 *     candidate    → killed    with killReason "operator" — the row should never
 *                              have existed (a mis-pasted URL, a duplicate)
 *     verifying    → killed    with killReason "operator" — a human said no
 *     verified     → clearing → uncleared — nothing cleared
 *     cleared      → revoked   with revocationReason "operator"
 *     constructed  → revoked   — the takedown path
 *
 * The first of those was added WITH this migration and not before it (DrJ, Gate
 * F ruling). Making a row undeletable without a one-step way to retire a row
 * that should never have existed would have forced `candidate → verifying →
 * killed` — two audit rows for one decision, the first of them recording a
 * verification nobody ran. A trail that has to lie to let you tidy up is not the
 * trail this migration is protecting. LEGAL_TRANSITION_COUNT moved 9 → 10.
 *
 * NOTHING IN THE CODEBASE DELETES FROM THIS TABLE. Verified by grep across src/
 * and scripts/ before writing this: there is no caller to break, and the sweeper
 * in incidentFiles.js deletes BYTES, never rows — its whole retention model is
 * "the row survives, the file does not".
 */

export const id = "037_media_candidates_no_delete";

export function up(db) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS media_candidates_no_delete
      BEFORE DELETE ON media_candidates
      BEGIN
        SELECT RAISE(ABORT, 'media_candidates rows may not be deleted: deleting one would orphan its audit trail, which cannot itself be deleted. Retire the candidate with a status instead — killed (operator), uncleared, or revoked (operator).');
      END;
  `);
}
