/**
 * incidentQueue.js — the operator's one-minute-a-day view, and the render tap.
 *
 * THE QUEUE IS BUILT AROUND WHAT IS BLOCKING, not around what exists. A list of
 * every candidate sorted by date is a database browser; this returns the things
 * that will not move without a person, in the order a person should look at
 * them, with the evidence needed to decide already attached. If the operator has
 * to click into a row to find out why it is there, the queue has failed.
 *
 * WHY UNRESOLVED EVIDENCE IS SHOWN AND CONCLUSIONS ARE NOT ENOUGH. A row that
 * says "verification incomplete" is useless. A row that says "the reverse search
 * returned 6 pages carrying this image and cannot date any of them; the claim is
 * 20 Aug" is a decision someone can actually make. So each waiting item carries
 * the check's own note, verbatim, including the note explaining why an
 * unmeasured check is not a clean one.
 *
 * THE RENDER TAP IS THE LAST GATE AND IT IS DELIBERATELY REDUNDANT. A candidate
 * arriving here is already verified and cleared. The tap is not a re-check of
 * either; it is the operator saying "put this on the channel", which is a
 * different question and the one their professional name is attached to.
 */

import { getCandidate, listCandidates } from "./incidentLedger.js";
import { CHECK_NAMES, VERDICTS } from "./incidentChecks.js";
import { readHumanVerdicts } from "./incidentVerifyRunner.js";
import { logger } from "../logger.js";

export class QueueError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "QueueError";
    this.code = code;
  }
}

/**
 * The buckets, in the order the operator should work them.
 *
 * Ordered by what unblocks the most: an untapped cleared asset is one action
 * from being usable, while a candidate waiting on a ruling needs a judgement.
 * Killed and constructed are not buckets — they are history, and a queue that
 * shows history is a queue people stop reading.
 */
export const BUCKETS = Object.freeze([
  "awaiting_render_tap",   // cleared, credited, one tap from usable
  "awaiting_ruling",       // a check abstained and needs a person
  "awaiting_clearance",    // verified, nobody has asked the poster yet
  "awaiting_grant_reply",  // asked, waiting on a human who is not us
  "new",                   // intake done, verification not run
]);

/** Which bucket does this row belong in? Exactly one, by construction. */
export function bucketFor(row) {
  if (row.status === "cleared") return row.render_approved ? null : "awaiting_render_tap";
  if (row.status === "verifying") return "awaiting_ruling";
  if (row.status === "verified") return "awaiting_clearance";
  if (row.status === "clearing") return "awaiting_grant_reply";
  if (row.status === "candidate") return "new";
  return null;   // killed, uncleared, constructed — history, not work
}

/**
 * The unresolved checks for one candidate, with the evidence needed to rule.
 *
 * Read from the STORED last assessment rather than by re-running verification:
 * re-running would spend a paid reverse search every time the operator opened
 * the queue, and would show them a different answer from the one that put the
 * row here. A test asserts that building the queue calls the reverse search
 * zero additional times.
 */
export function pendingRulings(db, candidateId) {
  const row = getCandidate(db, candidateId);
  if (!row) return [];
  const ruled = readHumanVerdicts(db, candidateId);

  // media_candidates.last_verification, not the trail. The waiting case writes
  // no trail row by design (a re-check that resolves nothing is not an event),
  // so reading the trail here returned "not run" for exactly the candidates this
  // function exists to explain. See migration 034's note.
  const lastSummary = safeParse(row.last_verification);

  if (!lastSummary?.checks?.length) {
    return CHECK_NAMES
      .filter((name) => !ruled[name])
      .map((name) => ({ check: name, verdict: null, reason: "not_run", note: "verification has not been run yet" }));
  }

  return lastSummary.checks
    .filter((c) => c.verdict === VERDICTS.NEEDS_HUMAN && !ruled[c.check])
    .map((c) => ({ check: c.check, verdict: c.verdict, reason: c.reason, note: c.note }));
}

/**
 * Build the queue.
 *
 * Bounded per bucket rather than overall: a hundred new candidates must not
 * push the one cleared asset waiting for a tap off the end of the list.
 */
export function buildQueue(db, { perBucket = 25 } = {}) {
  const limit = Math.min(Math.max(Number(perBucket) || 25, 1), 200);
  const out = Object.fromEntries(BUCKETS.map((b) => [b, []]));

  // One pass over the working statuses. `killed`, `uncleared` and `constructed`
  // are never fetched — they are not work.
  for (const status of ["cleared", "verifying", "verified", "clearing", "candidate"]) {
    for (const row of listCandidates(db, { status, limit: 500 })) {
      const bucket = bucketFor(row);
      if (!bucket || out[bucket].length >= limit) continue;
      out[bucket].push(decorateForQueue(db, row, bucket));
    }
  }

  const counts = Object.fromEntries(BUCKETS.map((b) => [b, out[b].length]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { buckets: out, counts, total };
}

/** One row, with everything needed to act on it without a second request. */
function decorateForQueue(db, row, bucket) {
  const base = {
    id: row.id,
    bucket,
    status: row.status,
    platform: row.platform,
    postUrl: row.post_url,
    poster: row.poster_display || row.poster_handle || null,
    claimedLocation: row.claimed_location,
    claimedAt: row.claimed_at,
    mediaType: row.media_type,
    embedOnly: Boolean(row.embed_only),
    creditText: row.credit_text || null,
    clearanceBasis: row.clearance_basis || null,
    renderApproved: Boolean(row.render_approved),
    updatedAt: row.updated_at,
  };

  // Only the bucket that needs rulings pays for reading them.
  if (bucket === "awaiting_ruling") base.pending = pendingRulings(db, row.id);
  if (bucket === "awaiting_render_tap") {
    base.clearanceDetail = row.clearance_detail ? safeParse(row.clearance_detail) : null;
  }
  return base;
}

const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// ─── The render tap ─────────────────────────────────────────────────────────

/**
 * Approve one asset for rendering.
 *
 * REFUSES ANYTHING NOT CLEARED AND CREDITED. The tap is the last gate, not a way
 * around the earlier ones — approving an uncleared candidate would make the
 * approval the thing that authorised the render, which is exactly backwards.
 *
 * Writes an audit row like everything else: who tapped, and when. If a use is
 * ever challenged, "a person approved this on the 28th" is part of the answer.
 */
export function approveForRender(db, candidateId, { actor = "operator", note = null } = {}) {
  const row = getCandidate(db, candidateId);
  if (!row) throw new QueueError(`no candidate ${candidateId}`, { code: "no-such-candidate" });

  if (row.status !== "cleared") {
    throw new QueueError(
      `candidate ${candidateId} is "${row.status}", not "cleared" — the render tap is the last gate, not a bypass ` +
      "for the earlier ones. Verification precedes clearance precedes construction.",
      { code: "not-cleared" }
    );
  }
  if (!String(row.credit_text || "").trim()) {
    throw new QueueError(
      `candidate ${candidateId} is cleared but carries no credit text, so there is nothing to burn onto the picture. ` +
      "Clearance and credit are one decision; this row is missing half of it.",
      { code: "no-credit" }
    );
  }

  const ts = Date.now();
  db.transaction(() => {
    db.prepare(`
      UPDATE media_candidates
         SET render_approved = 1, render_approved_at = ?, render_approved_by = ?, updated_at = ?
       WHERE id = ?
    `).run(ts, actor, ts, candidateId);
    db.prepare(`
      INSERT INTO media_candidate_events (candidate_id, ts, from_status, to_status, check_name, actor, evidence)
      VALUES (?, ?, ?, ?, 'render:approved', ?, ?)
    `).run(candidateId, ts, row.status, row.status, actor,
      JSON.stringify({ creditText: row.credit_text, clearanceBasis: row.clearance_basis, note }));
  })();

  logger.info(`🎥 incident: candidate ${candidateId} APPROVED for render by ${actor} — credit "${row.credit_text}"`);
  return getCandidate(db, candidateId);
}

/**
 * Withdraw an approval.
 *
 * Not a kill: the media is still verified and still cleared, and the finding
 * about it has not changed. What has changed is the decision to publish it, and
 * that stays reversible until it is published. A killed candidate is a different
 * thing and uses the machine.
 */
export function withdrawRenderApproval(db, candidateId, { actor = "operator", reason = null } = {}) {
  const row = getCandidate(db, candidateId);
  if (!row) throw new QueueError(`no candidate ${candidateId}`, { code: "no-such-candidate" });
  if (row.status === "constructed") {
    throw new QueueError(
      `candidate ${candidateId} is already in a video (${row.constructed_video_id}) — withdrawing the approval ` +
      "now would not remove it from anything. Unlist the video instead.",
      { code: "already-constructed" }
    );
  }

  const ts = Date.now();
  db.transaction(() => {
    db.prepare(`
      UPDATE media_candidates SET render_approved = 0, updated_at = ? WHERE id = ?
    `).run(ts, candidateId);
    db.prepare(`
      INSERT INTO media_candidate_events (candidate_id, ts, from_status, to_status, check_name, actor, evidence)
      VALUES (?, ?, ?, ?, 'render:withdrawn', ?, ?)
    `).run(candidateId, ts, row.status, row.status, actor, JSON.stringify({ reason }));
  })();

  logger.info(`🎥 incident: render approval WITHDRAWN for candidate ${candidateId} by ${actor}`);
  return getCandidate(db, candidateId);
}

/**
 * Everything the renderer may draw from, right now.
 *
 * The one query the render path should ask. It encodes all three conditions
 * together — cleared, credited, tapped — so a caller cannot accidentally ask a
 * looser question and get a longer list.
 */
export function renderableCandidates(db, { storyKind = null, storyId = null, limit = 25 } = {}) {
  const where = ["status = 'cleared'", "render_approved = 1", "credit_text IS NOT NULL", "TRIM(credit_text) != ''"];
  const args = [];
  if (storyKind) { where.push("story_kind = ?"); args.push(storyKind); }
  if (storyId) { where.push("story_id = ?"); args.push(storyId); }
  return db.prepare(
    `SELECT * FROM media_candidates WHERE ${where.join(" AND ")} ORDER BY render_approved_at ASC LIMIT ?`
  ).all(...args, Math.min(Math.max(Number(limit) || 25, 1), 200));
}
