/**
 * 034 — the render tap. One operator approval per asset, even when everything
 * else already passed.
 *
 * WHY THIS IS NOT A STATUS. The machine is
 * `cleared → constructed(video id)`, and the brief specifies it that way. This
 * is not another step along that path — it is a separate condition that must
 * ALSO hold, in the same way `embed_only` is orthogonal to status. Modelling it
 * as a state would mean a candidate could be "approved" and then found to have
 * lost its clearance, with the machine unable to express that; as a flag beside
 * the status, both conditions are checked independently at render time and
 * neither can stand in for the other.
 *
 * WHY IT EXISTS AT ALL, given verification and clearance both already passed.
 * Because "the checks passed" and "put this on the channel" are different
 * decisions, and only one of them is the operator's professional judgement. The
 * brief is explicit that v1's render gate is human: nothing reaches the renderer
 * without one tap per asset, and full automation of that tap is a LATER decision
 * made on the queue's track record rather than a default. A default of 0 is what
 * makes that true — a candidate that nobody looked at cannot render, and the
 * absence of a tap is indistinguishable from a refusal, which is the safe
 * direction.
 *
 * WHY THE TAP CAN BE WITHDRAWN. render_approved is settable back to 0. A kill is
 * terminal because it is a finding about the media; an approval is a decision
 * about publishing it, and decisions about publishing are reversible right up
 * until publication. The audit trail keeps both.
 */

export const id = "034_media_candidate_render_approval";

const COLUMNS = [
  ["render_approved", "INTEGER NOT NULL DEFAULT 0"],
  ["render_approved_at", "INTEGER"],
  ["render_approved_by", "TEXT"],
  // The most recent machine assessment, as JSON. See the note below.
  ["last_verification", "TEXT"],
];

/**
 * WHY last_verification IS A COLUMN AND NOT A TRAIL ROW.
 *
 * The trail records EVENTS, and a verification run that resolves nothing is not
 * an event — it is a candidate still waiting, and writing a row each time one is
 * re-checked would fill the audit record with heartbeats. But the queue's whole
 * job is to show WHY something is waiting, in the check's own words, and for the
 * waiting case there was no recorded summary to read: only kills and
 * verifications wrote one. So the queue fell back to "verification has not been
 * run yet" for every row it existed to explain.
 *
 * Found by writing the queue's own test rather than by using it. The fix is a
 * mutable working field beside the status — the last thing the machine thought —
 * which is legitimately different from the append-only trail: it is a cache of
 * an assessment that can be recomputed, not a record of a decision that cannot.
 */

export function up(db) {
  const existing = new Set(db.prepare("PRAGMA table_info(media_candidates)").all().map((c) => c.name));
  for (const [name, decl] of COLUMNS) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE media_candidates ADD COLUMN ${name} ${decl};`);
    }
  }

  // The queue's primary question: what is cleared and waiting for my tap?
  db.exec(`CREATE INDEX IF NOT EXISTS idx_media_candidates_render_queue
           ON media_candidates(status, render_approved, updated_at DESC);`);
}
