/**
 * incidentLedger.js — the only way a candidate row is written.
 *
 * ONE RULE ABOVE ALL: A STATE CHANGE AND ITS AUDIT ROW ARE ONE WRITE. Both
 * statements run inside a single better-sqlite3 transaction, so there is no
 * interleaving in which the status moved and the trail did not. This is not
 * defensive habit — the trail is the editorial defence, and a status whose
 * transition is unexplained is worse than no status, because it reads as
 * evidence while being none.
 *
 * The database handle is INJECTED rather than imported, following
 * videoStockLibrary's rotation state and videoArtifacts' pending-publish
 * predicate. It keeps this module testable without a server and stops it
 * deciding which database it is talking to.
 *
 * WHAT IS NOT HERE. No fetching, no verification, no clearance judgement, no
 * files. Phase 1 records what was claimed and what was decided; the deciding
 * belongs to later phases, and each of them calls `transition()` rather than
 * writing `status` itself. There is deliberately no exported function that sets
 * a status without going through the machine.
 */

import crypto from "crypto";
import { logger } from "../logger.js";
import {
  INITIAL_STATE, INTAKE_SOURCES, ACQUISITION_STATES,
  assertTransition, isState,
} from "./incidentStatus.js";
import { parsePostUrl, MEDIA_TYPES } from "./incidentIntake.js";

/** Where story_id points, by story_kind. Checked at intake — see 032's header. */
const STORY_TABLES = Object.freeze({
  article: "articles",
  event: "events",
  commission: "incident_commissions",
});

export class LedgerError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

const now = () => Date.now();

/**
 * Does the story this candidate claims to belong to actually exist?
 *
 * A dangling story_id is not a harmless orphan here: the queue groups by story,
 * and a candidate attached to nothing is invisible in the surface that is meant
 * to be the operator's single view. Checked in JS rather than by a foreign key
 * because story_id is polymorphic (032's header), and checked at intake so the
 * error names the problem.
 */
function assertStoryExists(db, storyKind, storyId) {
  const table = STORY_TABLES[storyKind];
  if (!table) {
    throw new LedgerError(
      `story_kind must be one of: ${Object.keys(STORY_TABLES).join(", ")} (got ${JSON.stringify(storyKind)})`,
      { code: "bad-story-kind" }
    );
  }
  const row = db.prepare(`SELECT 1 AS ok FROM ${table} WHERE id = ?`).get(storyId);
  if (!row) {
    throw new LedgerError(
      `no ${storyKind} with id "${storyId}" — a candidate attached to nothing never appears in the queue`,
      { code: "no-such-story" }
    );
  }
}

/**
 * Write the audit row. Private on purpose: the only way to append to the trail
 * is to have actually transitioned something.
 */
function appendEvent(db, { candidateId, ts, fromStatus, toStatus, checkName, actor, evidence }) {
  db.prepare(`
    INSERT INTO media_candidate_events
      (candidate_id, ts, from_status, to_status, check_name, actor, evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    candidateId, ts, fromStatus, toStatus, checkName, actor,
    evidence === undefined || evidence === null ? null : JSON.stringify(evidence)
  );
}

/**
 * Create a candidate from a pasted post URL.
 *
 * Refuses before it writes, in this order: the URL must name a lane, the story
 * must exist, the enums must be enums. An already-known post is NOT an error —
 * the same incident surfacing twice is the normal case, and the existing row is
 * returned with `created: false` so the caller can say "already had that one"
 * rather than showing the operator a failure for doing something reasonable.
 *
 * @returns {{ created: boolean, candidate: object }}
 */
export function createCandidate(db, {
  storyKind, storyId, postUrl,
  posterDisplay = null, claimedAt = null, claimedLocation = null,
  mediaType = null, intakeSource = "manual", embedOnly = false,
  actor = "operator", evidence = null,
} = {}) {
  if (!db) throw new LedgerError("no database handle", { code: "no-db" });

  // 1. The lane. Throws IntakeRefusedError with a message meant for a human.
  const parsed = parsePostUrl(postUrl);

  // 2. Enums, before anything is written.
  if (!INTAKE_SOURCES.includes(intakeSource)) {
    throw new LedgerError(
      `intake_source must be one of: ${INTAKE_SOURCES.join(", ")} (got ${JSON.stringify(intakeSource)})`,
      { code: "bad-intake-source" }
    );
  }
  // An explicit media type from the operator wins over the URL's guess, because
  // they have looked at the post and the parser has not. An unknown from both
  // stays unknown rather than becoming a default.
  const resolvedMediaType = mediaType ?? parsed.mediaType;
  if (!MEDIA_TYPES.includes(resolvedMediaType)) {
    throw new LedgerError(
      `media_type must be one of: ${MEDIA_TYPES.join(", ")} (got ${JSON.stringify(mediaType)})`,
      { code: "bad-media-type" }
    );
  }

  // 3. The story.
  assertStoryExists(db, storyKind, storyId);

  // 4. Already known? UNIQUE on post_url is the backstop; this is the friendly path.
  const existing = db.prepare("SELECT * FROM media_candidates WHERE post_url = ?").get(parsed.canonicalUrl);
  if (existing) return { created: false, candidate: existing };

  const id = crypto.randomUUID();
  const ts = now();

  // The insert and its opening audit row are one unit. A candidate whose
  // creation is not in the trail has no provenance for its own existence.
  db.transaction(() => {
    db.prepare(`
      INSERT INTO media_candidates (
        id, story_kind, story_id, platform, post_url, poster_handle, poster_display,
        claimed_at, claimed_location, media_type, intake_source, acquisition,
        status, kill_reason, clearance_basis, constructed_video_id, embed_only,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, NULL, NULL, NULL, ?, ?, ?)
    `).run(
      id, storyKind, storyId, parsed.platform, parsed.canonicalUrl,
      parsed.posterHandle, posterDisplay,
      Number.isFinite(claimedAt) ? claimedAt : null,
      claimedLocation ? String(claimedLocation) : null,
      resolvedMediaType, intakeSource,
      INITIAL_STATE, embedOnly ? 1 : 0, ts, ts
    );
    appendEvent(db, {
      candidateId: id, ts, fromStatus: null, toStatus: INITIAL_STATE,
      checkName: "intake", actor,
      // The URL AS PASTED is kept beside the canonical one. If the
      // canonicalisation is ever wrong, this row is how anyone finds out.
      evidence: { ...(evidence || {}), sourceUrl: parsed.sourceUrl, platform: parsed.platform },
    });
  })();

  logger.info(
    `🎥 incident: candidate ${id} intake ${parsed.platform} ${parsed.canonicalUrl} ` +
    `→ ${storyKind}:${storyId}${embedOnly ? " [embed_only]" : ""}`
  );
  return { created: true, candidate: getCandidate(db, id) };
}

export function getCandidate(db, id) {
  return db.prepare("SELECT * FROM media_candidates WHERE id = ?").get(id) || null;
}

/**
 * Move a candidate through the machine.
 *
 * Every rule about WHICH moves are legal lives in incidentStatus.js; this
 * function's job is to make the move and the record inseparable. It re-reads the
 * row inside the transaction so two concurrent callers cannot both read
 * `verifying` and both write a terminal state — the second one's `from` no
 * longer matches and its transition is refused by the machine.
 */
export function transition(db, id, toStatus, {
  checkName, actor = "system", evidence = null,
  killReason = null, clearanceBasis = null, constructedVideoId = null, revocationReason = null,
} = {}) {
  if (!db) throw new LedgerError("no database handle", { code: "no-db" });
  if (!checkName) {
    throw new LedgerError(
      "every transition names the check that decided it — an unattributed status change is not a record",
      { code: "no-check-name" }
    );
  }
  if (!isState(toStatus)) {
    throw new LedgerError(`"${toStatus}" is not a candidate status`, { code: "bad-status" });
  }

  const run = db.transaction(() => {
    const row = db.prepare("SELECT * FROM media_candidates WHERE id = ?").get(id);
    if (!row) throw new LedgerError(`no candidate ${id}`, { code: "no-such-candidate" });

    // Throws IllegalTransitionError on an illegal edge or a missing payload.
    const detail = assertTransition(row.status, toStatus, {
      killReason, clearanceBasis, constructedVideoId, revocationReason,
    });

    // THE DETAIL FIELDS ARE STICKY. assertTransition returns the detail the
    // TARGET state establishes, and nulls for the rest — so writing it straight
    // through would blank `clearance_basis` on the way to `constructed`, erasing
    // why an asset was usable at the exact moment it got used. Each field is
    // therefore set once, by the state that establishes it, and carried
    // afterwards. (Caught by the happy-path test, which walks the whole machine
    // and then reads the row back; a test that stopped at `cleared` would not
    // have seen it.)
    const ts = now();
    // takedown_required is derived HERE, by the transition that still knows what
    // state the candidate was in. Once the row says `revoked`, the fact that it
    // was `constructed` a moment ago is only recoverable from the trail — see
    // migration 036's header.
    const takedownRequired = toStatus === "revoked" && row.status === "constructed" ? 1 : row.takedown_required || 0;
    db.prepare(`
      UPDATE media_candidates
         SET status = ?, kill_reason = ?, clearance_basis = ?, constructed_video_id = ?,
             revocation_reason = ?, revoked_at = ?, takedown_required = ?, updated_at = ?
       WHERE id = ?
    `).run(
      toStatus,
      detail.killReason ?? row.kill_reason,
      detail.clearanceBasis ?? row.clearance_basis,
      detail.constructedVideoId ?? row.constructed_video_id,
      detail.revocationReason ?? row.revocation_reason,
      toStatus === "revoked" ? ts : row.revoked_at,
      takedownRequired,
      ts, id
    );

    appendEvent(db, {
      candidateId: id, ts, fromStatus: row.status, toStatus,
      checkName, actor, evidence,
    });
    return { from: row.status, to: toStatus };
  });

  const moved = run();
  const detail = killReason || clearanceBasis || constructedVideoId || revocationReason;
  logger.info(
    `🎥 incident: candidate ${id} ${moved.from} → ${moved.to}` +
    `${detail ? ` (${detail})` : ""} by ${checkName} [${actor}]`
  );
  return getCandidate(db, id);
}

/**
 * Set the embed-only lane (brief §2 Phase 1, Lane 1).
 *
 * ORTHOGONAL TO STATUS, so it is not a transition and writes no machine edge.
 * A candidate that is killed for render use may still be perfectly fine to embed
 * — embedding is the platform serving its own post, which is a different act
 * from us republishing the pixels. It still writes an audit row, because it is
 * a decision about how somebody's media gets used.
 */
export function setEmbedOnly(db, id, embedOnly, { actor = "operator", evidence = null } = {}) {
  const run = db.transaction(() => {
    const row = db.prepare("SELECT * FROM media_candidates WHERE id = ?").get(id);
    if (!row) throw new LedgerError(`no candidate ${id}`, { code: "no-such-candidate" });
    const ts = now();
    db.prepare("UPDATE media_candidates SET embed_only = ?, updated_at = ? WHERE id = ?")
      .run(embedOnly ? 1 : 0, ts, id);
    appendEvent(db, {
      candidateId: id, ts, fromStatus: row.status, toStatus: row.status,
      checkName: embedOnly ? "embed-only:on" : "embed-only:off", actor, evidence,
    });
  });
  run();
  return getCandidate(db, id);
}

/**
 * Record that we hold (or asked for) a file. Never a rights statement — see the
 * ACQUISITION_STATES comment in incidentStatus.js. Holding a file and being
 * allowed to publish it are different columns for a reason.
 */
export function setAcquisition(db, id, acquisition, { actor = "operator", evidence = null } = {}) {
  if (!ACQUISITION_STATES.includes(acquisition)) {
    throw new LedgerError(
      `acquisition must be one of: ${ACQUISITION_STATES.join(", ")} (got ${JSON.stringify(acquisition)})`,
      { code: "bad-acquisition" }
    );
  }
  const run = db.transaction(() => {
    const row = db.prepare("SELECT * FROM media_candidates WHERE id = ?").get(id);
    if (!row) throw new LedgerError(`no candidate ${id}`, { code: "no-such-candidate" });
    const ts = now();
    db.prepare("UPDATE media_candidates SET acquisition = ?, updated_at = ? WHERE id = ?")
      .run(acquisition, ts, id);
    appendEvent(db, {
      candidateId: id, ts, fromStatus: row.status, toStatus: row.status,
      checkName: `acquisition:${acquisition}`, actor, evidence,
    });
  });
  run();
  return getCandidate(db, id);
}

/** The trail for one candidate, oldest first. This is the defence, in order. */
export function candidateTrail(db, id) {
  return db.prepare(
    "SELECT * FROM media_candidate_events WHERE candidate_id = ? ORDER BY ts ASC, id ASC"
  ).all(id).map((r) => ({ ...r, evidence: r.evidence ? JSON.parse(r.evidence) : null }));
}

/**
 * List candidates for the queue. Filters are explicit rather than a free-form
 * where-clause: the surface this feeds is an operator's one-minute-a-day view,
 * and it should only be able to ask questions this module has thought about.
 */
export function listCandidates(db, { status = null, storyKind = null, storyId = null, limit = 100 } = {}) {
  if (status !== null && !isState(status)) {
    throw new LedgerError(`"${status}" is not a candidate status`, { code: "bad-status" });
  }
  const where = [];
  const args = [];
  if (status) { where.push("status = ?"); args.push(status); }
  if (storyKind) { where.push("story_kind = ?"); args.push(storyKind); }
  if (storyId) { where.push("story_id = ?"); args.push(storyId); }
  const sql =
    "SELECT * FROM media_candidates" +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    " ORDER BY created_at DESC LIMIT ?";
  return db.prepare(sql).all(...args, Math.min(Math.max(Number(limit) || 100, 1), 500));
}

/**
 * Create a commissioned topic — a story stub that is NOT an event.
 * See 032's header for why this does not go into the event graph.
 */
export function createCommission(db, { topic, outputKind = "short", notes = null } = {}) {
  const t = String(topic || "").trim();
  if (!t) throw new LedgerError("a commission needs a topic", { code: "no-topic" });
  if (!["short", "longform"].includes(outputKind)) {
    throw new LedgerError(`output_kind must be short|longform (got ${JSON.stringify(outputKind)})`, { code: "bad-output-kind" });
  }
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO incident_commissions (id, topic, output_kind, notes, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, t, outputKind, notes ? String(notes) : null, now());
  logger.info(`🎥 incident: commission ${id} "${t.slice(0, 60)}" (${outputKind})`);
  return db.prepare("SELECT * FROM incident_commissions WHERE id = ?").get(id);
}
