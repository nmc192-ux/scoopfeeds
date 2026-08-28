/**
 * incidentClearanceLedger.js — clearance, written down.
 *
 * The seam between incidentClearance (which decides) and incidentLedger (which
 * records), mirroring incidentVerifyRunner's relationship to the checks. The
 * status machine remains the only thing that changes a status.
 *
 * THE GRANT LANE IS TWO RECORDED EVENTS, NOT ONE. Drafting a request and
 * receiving a reply are separate facts, days apart, and collapsing them would
 * lose the one that matters most: that a specific request, with specific terms,
 * was put to a specific person before they agreed. `recordGrantRequest` writes
 * the terms that were offered; `recordGrantReply` writes what came back. If the
 * template later changes, old rows still say what the person in front of them
 * was actually asked.
 */

import { transition, getCandidate, candidateTrail } from "./incidentLedger.js";
import { assertClearance, ClearanceRefusedError } from "./incidentClearance.js";
import { draftGrantRequest } from "./incidentGrantDraft.js";
import { logger } from "../logger.js";

/** Replies we recognise. Anything else is the operator's own words, recorded. */
export const GRANT_OUTCOMES = Object.freeze(["granted", "refused", "no_reply"]);

export class ClearanceLedgerError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "ClearanceLedgerError";
    this.code = code;
  }
}

/**
 * Move a verified candidate into `clearing`.
 *
 * Separate from clearing it, because `clearing` is a real state a candidate sits
 * in for days while a poster decides — it is not a formality on the way to
 * `cleared`.
 */
export function beginClearing(db, candidateId, { actor = "operator", note = null } = {}) {
  return transition(db, candidateId, "clearing", {
    checkName: "clearance:begin", actor, evidence: note ? { note } : null,
  });
}

/**
 * Draft the Lane 2 request and record that it was drafted.
 *
 * DOES NOT SEND. Returns the draft for the operator to send by hand. The audit
 * row records the terms offered, so what was promised is in the ledger before
 * any reply arrives rather than reconstructed after.
 */
export function recordGrantRequest(db, candidateId, { operatorName, storyTitle = null, outlet = "ScoopFeeds", actor = "operator" } = {}) {
  const candidate = getCandidate(db, candidateId);
  if (!candidate) throw new ClearanceLedgerError(`no candidate ${candidateId}`, { code: "no-such-candidate" });

  const draft = draftGrantRequest({ candidate, operatorName, storyTitle, outlet });

  db.prepare(`
    INSERT INTO media_candidate_events (candidate_id, ts, from_status, to_status, check_name, actor, evidence)
    VALUES (?, ?, ?, ?, 'clearance:grant-requested', ?, ?)
  `).run(
    candidateId, Date.now(), candidate.status, candidate.status, actor,
    JSON.stringify({
      termsOffered: draft.termsOffered,
      creditText: draft.creditText,
      // The message itself, so "what exactly did you send them" has an answer.
      bodySent: draft.body,
      platform: candidate.platform,
      posterHandle: candidate.poster_handle,
    })
  );

  logger.info(`🎥 incident: grant request drafted for candidate ${candidateId} (${candidate.platform} ${candidate.poster_handle || "?"})`);
  return { draft, candidate };
}

/**
 * Record the poster's reply, and clear on a grant.
 *
 * A refusal or a silence is recorded and the candidate goes to `uncleared` —
 * which is terminal for rendering but NOT for the site: an uncleared candidate
 * can still be embed_only, because embedding is the platform serving its own
 * post rather than us republishing pixels.
 */
export function recordGrantReply(db, candidateId, outcome, {
  grantReference = null, replyText = null, fileSuppliedByPoster = false, actor = "operator",
} = {}) {
  if (!GRANT_OUTCOMES.includes(outcome)) {
    throw new ClearanceLedgerError(
      `grant outcome must be one of: ${GRANT_OUTCOMES.join(", ")} (got ${JSON.stringify(outcome)})`,
      { code: "bad-outcome" }
    );
  }
  const candidate = getCandidate(db, candidateId);
  if (!candidate) throw new ClearanceLedgerError(`no candidate ${candidateId}`, { code: "no-such-candidate" });

  if (outcome !== "granted") {
    return transition(db, candidateId, "uncleared", {
      checkName: `clearance:grant-${outcome}`, actor,
      evidence: { outcome, replyText: replyText ? String(replyText).slice(0, 2000) : null },
    });
  }

  // The terms that were offered, recovered from the request row, so the cleared
  // record says what the poster actually agreed to.
  const requested = candidateTrail(db, candidateId)
    .filter((r) => r.check_name === "clearance:grant-requested").at(-1);

  return applyClearance(db, candidateId, "grant", {
    grantReference: grantReference || replyText,
    termsOffered: requested?.evidence?.termsOffered || null,
    fileSuppliedByPoster,
  }, { actor, checkName: "clearance:grant-received" });
}

/**
 * Apply a clearance in any lane.
 *
 * The single write path into `cleared`: it validates through assertClearance,
 * then transitions and persists the credit and detail IN ONE TRANSACTION, so a
 * cleared row can never exist without the credit that made it clearable.
 */
export function applyClearance(db, candidateId, lane, detail = {}, { actor = "operator", checkName = null } = {}) {
  const candidate = getCandidate(db, candidateId);
  if (!candidate) throw new ClearanceLedgerError(`no candidate ${candidateId}`, { code: "no-such-candidate" });

  // Throws ClearanceRefusedError with a message written for the operator.
  const { clearanceBasis, creditText, detail: stored } = assertClearance(candidate, lane, detail);

  const run = db.transaction(() => {
    transition(db, candidateId, "cleared", {
      checkName: checkName || `clearance:${lane}`,
      clearanceBasis, actor,
      evidence: { lane, creditText, detail: stored },
    });
    db.prepare(`
      UPDATE media_candidates
         SET credit_text = ?, clearance_detail = ?, source_type = COALESCE(?, source_type), updated_at = ?
       WHERE id = ?
    `).run(creditText, JSON.stringify(stored), stored.sourceType || null, Date.now(), candidateId);
  });
  run();

  logger.info(`🎥 incident: candidate ${candidateId} cleared (${clearanceBasis}) — credit "${creditText}"`);
  return getCandidate(db, candidateId);
}

/** Record that nothing cleared. Terminal for rendering; embed_only survives it. */
export function markUncleared(db, candidateId, { reason = null, actor = "operator" } = {}) {
  return transition(db, candidateId, "uncleared", {
    checkName: "clearance:none", actor,
    evidence: reason ? { reason } : null,
  });
}

/**
 * The renderer's precondition, asked of the ledger rather than of a caller.
 *
 * Phase 5 enforces this again at the filter graph — this is the earlier, cheaper
 * refusal that means the filter-graph check should never fire in normal
 * operation. Both exist because the expensive one is the one that is true even
 * when someone bypasses this module.
 */
export function assertRenderable(candidate) {
  if (!candidate) throw new ClearanceRefusedError("no candidate", { code: "no-candidate" });
  // Named separately from the general not-cleared refusal, because the two mean
  // very different things and the operator needs to be told which. "Not cleared
  // yet" is work in progress; "revoked" is a right that has been withdrawn, and
  // rendering it anyway would be the single worst thing this engine could do.
  if (candidate.status === "revoked") {
    throw new ClearanceRefusedError(
      `candidate ${candidate.id} was REVOKED (${candidate.revocation_reason}) and may never render again. ` +
      "The rights were withdrawn; the media being genuine does not make it usable.",
      { code: "revoked" }
    );
  }
  if (candidate.status !== "cleared") {
    throw new ClearanceRefusedError(
      `candidate ${candidate.id} is "${candidate.status}", not "cleared" — no pixel from an uncleared candidate renders`,
      { code: "not-cleared" }
    );
  }
  if (!String(candidate.credit_text || "").trim()) {
    throw new ClearanceRefusedError(
      `candidate ${candidate.id} is cleared but carries no credit text. A third-party asset renders with a ` +
      "credit chip or it does not render — clearance and credit are one decision, not two.",
      { code: "no-credit" }
    );
  }
  // THE HUMAN RENDER TAP (Phase 4). Verified and cleared are findings about the
  // media; this is the decision to put it on the channel, and v1 requires a
  // person to make it per asset. Checking it HERE rather than only in the queue
  // is what stops the tap being decorative: a render path that never went
  // through the queue still cannot draw an untapped asset, because this is the
  // function it has to call. Automating the tap later means changing this line
  // deliberately, which is the point.
  if (!candidate.render_approved) {
    throw new ClearanceRefusedError(
      `candidate ${candidate.id} is cleared but has not been approved for render. Every asset needs one ` +
      "operator tap before it can be drawn, even when every check passed — \"the checks passed\" and " +
      "\"put this on the channel\" are different decisions.",
      { code: "not-approved" }
    );
  }
  return true;
}
