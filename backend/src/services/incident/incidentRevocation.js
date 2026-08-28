/**
 * incidentRevocation.js — when a grant stops holding, before or after publication.
 *
 * THE PROMISE THIS KEEPS. The Phase 3 permission request says: *"If you say yes
 * and then change your mind before we publish, tell me and we won't use it."*
 * That sentence is why this module exists and why it landed before the first
 * real grant was sent — a message promising something the system cannot do is a
 * message that should not go out. It also goes further than the promise, because
 * a person who changes their mind AFTER publication is owed an answer too, and
 * "you were a day late" is not one.
 *
 * REVOCATION IS NOT A KILL. A kill is a finding about the media: it is not what
 * it claimed to be. A revocation is a change in the rights: the media is exactly
 * what it claimed to be and is no longer ours to use. They are separate states,
 * separate reason vocabularies and separate columns, because recording a
 * withdrawn grant as a kill would put a finding about someone's honesty in a row
 * whose truth is that they simply changed their mind.
 *
 * THE TAKEDOWN IS NOT AUTOMATED, DELIBERATELY. Revoking flags the video; pulling
 * it is an external, irreversible action against a live channel, and this repo's
 * rule is that DrJ performs those. What this module guarantees is that a
 * revocation with an outstanding takedown CANNOT be quietly forgotten: it sits
 * in its own bucket until someone records that the video was actually pulled,
 * and `takedown_actioned_at` is the only thing that clears it.
 */

import { transition, getCandidate } from "./incidentLedger.js";
import { REVOCATION_REASONS } from "./incidentStatus.js";
import { logger } from "../logger.js";

export class RevocationError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "RevocationError";
    this.code = code;
  }
}

/**
 * Revoke a clearance.
 *
 * Works from `cleared` (nothing published yet — stop using it) and from
 * `constructed` (already in a video — pull it). The machine decides which are
 * legal; this decides what happens next.
 *
 * A NOTE IS REQUIRED, not optional. A revocation is the one ledger event most
 * likely to be read by someone outside this project — a poster's lawyer, a
 * platform, the poster themselves — and "grantor_withdrew" with nothing beside
 * it does not say when they said so, or how, or to whom.
 */
export function revokeClearance(db, candidateId, reason, { note = null, actor = "operator" } = {}) {
  const before = getCandidate(db, candidateId);
  if (!before) throw new RevocationError(`no candidate ${candidateId}`, { code: "no-such-candidate" });

  if (!REVOCATION_REASONS.includes(reason)) {
    throw new RevocationError(
      `a revocation needs a reason from: ${REVOCATION_REASONS.join(", ")} (got ${JSON.stringify(reason)})`,
      { code: "bad-reason" }
    );
  }
  const text = String(note || "").trim();
  if (text.length < 10) {
    throw new RevocationError(
      "a revocation needs a note saying when and how the rights stopped holding — a bare reason code does not " +
      "say who told us, when, or in what words. This is the row most likely to be read by someone outside this project.",
      { code: "no-note" }
    );
  }

  const wasPublished = before.status === "constructed";
  const row = transition(db, candidateId, "revoked", {
    checkName: wasPublished ? "revocation:post-publish" : "revocation:pre-publish",
    revocationReason: reason,
    actor,
    evidence: {
      note: text,
      revokedFrom: before.status,
      clearanceBasis: before.clearance_basis,
      constructedVideoId: before.constructed_video_id || null,
      takedownRequired: wasPublished,
    },
  });

  if (wasPublished) {
    logger.error(
      `🚨 incident: candidate ${candidateId} REVOKED after publication (${reason}) — ` +
      `video ${before.constructed_video_id} needs pulling. This does not clear itself.`
    );
  } else {
    logger.warn(`🎥 incident: candidate ${candidateId} revoked before publication (${reason}) — nothing to pull`);
  }
  return { candidate: row, requiresTakedown: wasPublished, videoId: before.constructed_video_id || null };
}

/**
 * Everything revoked that is still on a channel.
 *
 * The one query that must never be slow or forgotten. Ordered oldest-first,
 * because the longest-outstanding takedown is the one doing the most damage.
 */
export function pendingTakedowns(db, { limit = 100 } = {}) {
  return db.prepare(`
    SELECT id, constructed_video_id, revocation_reason, revoked_at, poster_handle, poster_display, credit_text, post_url
      FROM media_candidates
     WHERE takedown_required = 1 AND takedown_actioned_at IS NULL
     ORDER BY revoked_at ASC
     LIMIT ?
  `).all(Math.min(Math.max(Number(limit) || 100, 1), 500));
}

/**
 * Record that the published video was actually pulled.
 *
 * SEPARATE FROM REVOKING, because they are separate facts happening at separate
 * times, and collapsing them would let "we decided to pull it" stand in for "it
 * is gone". Only this clears the pending bucket.
 */
export function recordTakedownActioned(db, candidateId, { note = null, actor = "operator" } = {}) {
  const row = getCandidate(db, candidateId);
  if (!row) throw new RevocationError(`no candidate ${candidateId}`, { code: "no-such-candidate" });
  if (!row.takedown_required) {
    throw new RevocationError(
      `candidate ${candidateId} has no outstanding takedown — it was revoked before publication, so there is ` +
      "nothing on a channel to pull.",
      { code: "no-takedown-required" }
    );
  }
  if (row.takedown_actioned_at) {
    throw new RevocationError(
      `candidate ${candidateId}'s takedown was already recorded at ${new Date(row.takedown_actioned_at).toISOString()}`,
      { code: "already-actioned" }
    );
  }

  const ts = Date.now();
  db.transaction(() => {
    db.prepare("UPDATE media_candidates SET takedown_actioned_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, candidateId);
    db.prepare(`
      INSERT INTO media_candidate_events (candidate_id, ts, from_status, to_status, check_name, actor, evidence)
      VALUES (?, ?, ?, ?, 'takedown:actioned', ?, ?)
    `).run(candidateId, ts, row.status, row.status, actor,
      JSON.stringify({ videoId: row.constructed_video_id, note, secondsOutstanding: Math.round((ts - (row.revoked_at || ts)) / 1000) }));
  })();

  logger.info(`🎥 incident: takedown recorded for candidate ${candidateId} (video ${row.constructed_video_id})`);
  return getCandidate(db, candidateId);
}

/**
 * Which surfaces a published short reaches, and whether we can retract from each.
 *
 * GROUNDED, NOT ASSUMED (Gate D, item d). Every client under services/*Client.js
 * was read for an exported delete / remove / privacy / retract function. Exactly
 * one has one: `youtubeClient.setYouTubePrivacy`. The other six are upload-only,
 * so a withdrawal on those surfaces is a hand action in the platform's own app.
 *
 * This lives beside the revocation because the operator needs it at the moment
 * they are acting, not in a document they have to remember exists. The full
 * reasoning and the step-by-step are in
 * docs/ops/runbooks/incident_takedown.md.
 *
 * IF A CLIENT EVER GAINS A RETRACTION FUNCTION, change it here — a stale "manual"
 * costs a few minutes; a stale "automatic" means somebody believes a video came
 * down when it did not.
 */
export const TAKEDOWN_SURFACES = Object.freeze([
  { surface: "youtube",   programmatic: true,  how: "POST /scoop-ops/video/unlist-recent (see runbook — it targets the LAST N, not one video)" },
  { surface: "facebook",  programmatic: false, how: "delete the Reel in Meta Business Suite → Content" },
  { surface: "instagram", programmatic: false, how: "delete the Reel in the app or Business Suite (archiving is not deletion)" },
  { surface: "threads",   programmatic: false, how: "delete the post in the app" },
  { surface: "bluesky",   programmatic: false, how: "delete the post in the app" },
  { surface: "tiktok",    programmatic: false, how: "delete the video in the app (upload privacy cannot be changed by us afterwards)" },
  { surface: "x",         programmatic: false, how: "delete the post in the app" },
]);

/** The blunt fact the runbook opens with, in one line, for an API response. */
export const takedownReality = () => ({
  programmatic: TAKEDOWN_SURFACES.filter((s) => s.programmatic).map((s) => s.surface),
  manual: TAKEDOWN_SURFACES.filter((s) => !s.programmatic).map((s) => s.surface),
  note: "Only YouTube can be retracted programmatically, and that route targets the last N published " +
        "videos rather than a specific one. Every other surface is a hand action. See " +
        "docs/ops/runbooks/incident_takedown.md.",
});
