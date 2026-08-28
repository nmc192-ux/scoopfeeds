/**
 * 036 — revocation, and the takedown it can trigger.
 *
 * WHY THIS EXISTS AT ALL. The permission request drafted in Phase 3 says, in the
 * poster's own reading of it: *"If you say yes and then change your mind before
 * we publish, tell me and we won't use it."* Until this migration the system
 * could not keep that promise — `cleared` led only to `constructed`, and
 * `constructed` was terminal. A message that promises something the machine
 * cannot do is not a message that should be sent, which is why this landed
 * before the first real grant went out.
 *
 * REVOCATION IS NOT A KILL, and the columns are separate for that reason. A kill
 * says the media is not what it claimed to be. A revocation says the media is
 * exactly what it claimed to be and is no longer ours to use. Recording a
 * withdrawn grant in `kill_reason` would put a finding about a person's honesty
 * in a row where the truth is that they simply changed their mind.
 *
 * takedown_required IS DERIVED AT REVOCATION TIME, NOT QUERIED LATER. Whether a
 * revocation needs a takedown depends on the state the candidate was in when it
 * was revoked — `constructed` means it is already in a published video — and
 * that state is gone the moment the transition completes. Computing it
 * afterwards would mean reconstructing history from the trail every time the
 * queue asks. It is set once, by the transition that knows.
 */

export const id = "036_media_candidate_revocation";

const COLUMNS = [
  ["revocation_reason", "TEXT"],
  ["revoked_at", "INTEGER"],
  // 1 when the candidate was already in a published video when revoked.
  ["takedown_required", "INTEGER NOT NULL DEFAULT 0"],
  // Set when the operator confirms the video was actually pulled. NULL while
  // outstanding — which is what the queue's takedown bucket keys on.
  ["takedown_actioned_at", "INTEGER"],
];

export function up(db) {
  const existing = new Set(db.prepare("PRAGMA table_info(media_candidates)").all().map((c) => c.name));
  for (const [name, decl] of COLUMNS) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE media_candidates ADD COLUMN ${name} ${decl};`);
    }
  }

  // The only query that must never be slow or forgotten: what have we published
  // that we no longer have the right to publish? Partial, so it indexes the
  // handful of rows that matter rather than the whole table.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_media_candidates_takedown
           ON media_candidates(takedown_required, takedown_actioned_at)
           WHERE takedown_required = 1;`);
}
