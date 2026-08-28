/**
 * incidentClearance.js — may we use this, and on what basis?
 *
 * A SEPARATE GATE FROM longformMediaGate, DELIBERATELY. That file's
 * `ALLOWED_LICENCES` is `pexels | public-domain | cc-by | cc-by-sa | handout`,
 * and its job is to make a film's AI-provenance disclosure TRUSTWORTHY:
 *
 *     acquisition gate → LICENSES.md → derived disclosure → QC gate
 *
 * A per-poster grant is not in that list, and a fair-use excerpt is
 * definitionally not a licence at all. Adding `grant` or `fair_use` to
 * ALLOWED_LICENCES would let an excerpt flow into a long-form film through a
 * gate built to guarantee something else, upstream of longformQcGate — the
 * highest-consequence file in the repo. So there are TWO gates and ONE render
 * path: an asset is renderable if it satisfies longformMediaGate (open-licence
 * stock, unchanged) OR this one (incident media). Not one widened gate.
 *
 * TREATMENT IS NEVER A BASIS. Grading, cropping, Ken Burns and the house palette
 * are STYLE. They do not create, extend or launder a right, and no function here
 * accepts a treatment as an input. If you find yourself adding one, the
 * reasoning has already gone wrong.
 *
 * CREDIT IS STRUCTURAL. Every third-party clearance produces a `creditText`, and
 * a clearance that cannot produce one is refused rather than cleared without.
 * The renderer's own refusal (Phase 5) is the backstop; this is the gate that
 * makes the backstop unreachable in normal operation.
 */

import { CUTAWAY_MAX_SECS, MAX_CUTAWAYS } from "../videoStockLibrary.js";
import { CLEARANCE_BASES } from "./incidentStatus.js";

/** The lanes, matching incidentStatus.CLEARANCE_BASES exactly. */
export const LANES = CLEARANCE_BASES;

/**
 * How long a Lane 3 excerpt may run, and how much of one video it may occupy.
 *
 * INHERITED, NOT INVENTED (grounding Q2). An incident asset renders through
 * #121's cutaway mechanism, which is already capped at CUTAWAY_MAX_SECS per
 * cutaway and MAX_CUTAWAYS per video, and clamped against the slide it sits in.
 * Declaring a separate INCIDENT_EXCERPT_MAX_SECS would create a second number
 * that can drift from the mechanism that actually enforces it — and the drifting
 * copy is always the one nobody updates. So the cap IS the cutaway cap, and if
 * the cutaway band moves this moves with it.
 *
 * The resulting posture: at most 3 seconds per excerpt, at most 6 seconds across
 * a whole video, always underneath the commentary and typography layer. That is
 * far inside what comparable commentary formats sustain.
 */
export const EXCERPT_MAX_SECS = CUTAWAY_MAX_SECS;
export const EXCERPT_MAX_TOTAL_SECS = CUTAWAY_MAX_SECS * MAX_CUTAWAYS;

/**
 * Source types Lane 3 may NEVER cover.
 *
 * These are the asset classes channels get struck over, and no amount of
 * commentary changes that: rights-holders in these categories enforce
 * automatically, at scale, by fingerprint. A fair-use posture is a defence you
 * mount after a claim; against Content ID there is no argument to mount.
 * Lane 2 (ask the poster) and Lane 0 (own it) remain open for all of them —
 * this blocklist is about the excerpt lane only.
 */
export const FAIR_USE_BLOCKED_SOURCE_TYPES = Object.freeze(["broadcaster", "sports", "music"]);

/** Everything a candidate's source may be. `unknown` is not usable for Lane 3. */
export const SOURCE_TYPES = Object.freeze([
  "eyewitness", "official", "broadcaster", "sports", "music", "unknown",
]);

export class ClearanceRefusedError extends Error {
  constructor(message, { code, lane } = {}) {
    super(message);
    this.name = "ClearanceRefusedError";
    this.code = code;
    this.lane = lane;
  }
}

/**
 * The credit that will be burned onto the picture.
 *
 * Poster first, platform second — the same order `videoStockLibrary.cutawayCredit`
 * uses for stock, and for the same reason: the licence (or here, the grant) asks
 * for the creator, and the platform alone credits the wrong party.
 *
 * Returns null when there is nothing truthful to say. A null here is what makes
 * the refusal below fire, and inventing a placeholder ("Source: social media")
 * would defeat it — an anonymous credit is not a credit, it is a way of
 * appearing to have one.
 */
export function creditTextFor({ poster_handle, poster_display, platform } = {}) {
  const who = String(poster_display || poster_handle || "").trim();
  if (!who) return null;
  const where = String(platform || "").trim().toUpperCase();
  return where ? `${who} / ${where}` : who;
}

/** Owner media is ours; there is nobody else to credit. */
const OWNER_CREDIT = "ScoopFeeds";

/**
 * Validate a clearance and return what to persist.
 *
 * THROWS on refusal, like assertTransition, and for the same reason: a returned
 * `{ ok: false }` can be ignored by forgetting to check it, and this is the gate
 * standing between somebody's footage and a channel.
 *
 * @returns {{ clearanceBasis, creditText, detail }}
 */
export function assertClearance(candidate = {}, lane, detail = {}) {
  if (!LANES.includes(lane)) {
    throw new ClearanceRefusedError(
      `clearance lane must be one of: ${LANES.join(", ")} (got ${JSON.stringify(lane)})`,
      { code: "bad-lane", lane }
    );
  }

  // Verification precedes clearance. The status machine already refuses the
  // transition, but saying it here too means the error names the actual problem
  // rather than surfacing as an illegal edge.
  if (candidate.status && candidate.status !== "clearing") {
    throw new ClearanceRefusedError(
      `a candidate is cleared from "clearing", not from "${candidate.status}". ` +
      "Verification precedes clearance precedes construction.",
      { code: "wrong-status", lane }
    );
  }

  if (lane === "owner") return clearOwner(candidate, detail);
  if (lane === "grant") return clearGrant(candidate, detail);
  return clearFairUse(candidate, detail);
}

/**
 * Lane 0 — the operator's own or authorised material.
 *
 * A declaration is REQUIRED and is free text on purpose: "shot by me at the
 * barrage on the 14th" and "district press release, authorised for public use"
 * are different claims and both are legitimate. What matters is that a specific
 * person wrote a specific sentence that can be produced later, not that it
 * matched an enum.
 *
 * NOTE WHAT THIS DOES NOT DO: skip verification. Owning a clip does not make its
 * claimed date or location correct, and the status machine has no edge from
 * `verified` that avoids `clearing`. Provenance is about rights; verification is
 * about truth.
 */
function clearOwner(candidate, detail) {
  const declaration = String(detail.declaration || "").trim();
  if (declaration.length < 10) {
    throw new ClearanceRefusedError(
      "owner clearance needs a declaration of the basis — a sentence like \"shot by me\" or " +
      "\"official release, authorised\". This is the line that gets produced if the use is ever questioned, " +
      "so an empty or one-word declaration is not one.",
      { code: "no-declaration", lane: "owner" }
    );
  }
  return {
    clearanceBasis: "owner",
    // Our own material carries our own name, not a null credit.
    creditText: OWNER_CREDIT,
    detail: { lane: "owner", declaration, declaredAt: Date.now() },
  };
}

/**
 * Lane 2 — the poster granted permission.
 *
 * Requires a REFERENCE to the actual reply, not a boolean. A stored `true` is
 * indistinguishable from a mis-click; a pointer to the message the poster sent
 * is the thing an editorial defence is made of. The reference is deliberately
 * loose — a screenshot path, a message URL, a pasted quote — because the
 * platforms differ and this ledger should record what exists rather than force
 * a shape that does not.
 */
function clearGrant(candidate, detail) {
  const reference = String(detail.grantReference || "").trim();
  if (reference.length < 8) {
    throw new ClearanceRefusedError(
      "grant clearance needs a reference to the poster's actual reply — a message link, a screenshot path, " +
      "or the reply text itself. A recorded \"yes\" with nothing behind it is not evidence of permission.",
      { code: "no-grant-reference", lane: "grant" }
    );
  }
  const creditText = String(detail.creditText || "").trim() || creditTextFor(candidate);
  if (!creditText) {
    throw new ClearanceRefusedError(
      "grant clearance produces no credit: this candidate has neither a poster handle nor a display name, " +
      "and the grant was made on the condition of on-screen credit. Record who the poster is first — " +
      "an anonymous credit is not a credit.",
      { code: "no-credit", lane: "grant" }
    );
  }
  return {
    clearanceBasis: "grant",
    creditText,
    detail: {
      lane: "grant",
      grantReference: reference,
      grantedBy: candidate.poster_handle || null,
      // What the poster actually agreed to, kept beside the reference so the two
      // cannot drift. If the request template changes, old rows still say what
      // the person in front of them was asked.
      termsOffered: detail.termsOffered || null,
      fileSuppliedByPoster: Boolean(detail.fileSuppliedByPoster),
      recordedAt: Date.now(),
    },
  };
}

/**
 * Lane 3 — a fair-use-shaped excerpt.
 *
 * THIS IS A DEFENCE POSTURE, NOT A LICENCE. Nobody has given permission. What
 * this records is that the use was shaped to be defensible: short, transformed
 * by commentary, credited, and not drawn from the asset classes that get
 * enforced automatically. Claims are a cost of this lane, not a surprise — the
 * point of writing the limits down is that if one arrives, the answer is a
 * record rather than a reconstruction.
 *
 * Every limit is enforced HERE, in code, and re-enforced at the filter graph in
 * Phase 5. Not in a prompt, and not in a reviewer's memory.
 */
function clearFairUse(candidate, detail) {
  const sourceType = String(detail.sourceType || candidate.source_type || "unknown").trim();
  if (!SOURCE_TYPES.includes(sourceType)) {
    throw new ClearanceRefusedError(
      `source_type must be one of: ${SOURCE_TYPES.join(", ")} (got ${JSON.stringify(sourceType)})`,
      { code: "bad-source-type", lane: "fair_use" }
    );
  }
  if (FAIR_USE_BLOCKED_SOURCE_TYPES.includes(sourceType)) {
    throw new ClearanceRefusedError(
      `"${sourceType}" material can never be cleared under fair use here. These classes are enforced ` +
      "automatically by fingerprint, and a defence you have to mount after a strike is not a plan. " +
      "Lane 2 (ask the poster) and Lane 0 (own it) are still open.",
      { code: "blocked-source-type", lane: "fair_use" }
    );
  }
  if (sourceType === "unknown") {
    throw new ClearanceRefusedError(
      "fair use needs to know what kind of source this is — an unknown source cannot be shown not to be " +
      "broadcaster, sports or music material, which are the classes this lane may never cover.",
      { code: "unknown-source-type", lane: "fair_use" }
    );
  }

  const secs = Number(detail.excerptSecs);
  if (!Number.isFinite(secs) || secs <= 0) {
    throw new ClearanceRefusedError(
      `fair use needs an excerpt length (got ${JSON.stringify(detail.excerptSecs)}). ` +
      "An unmeasured excerpt is not a limited one.",
      { code: "no-excerpt-length", lane: "fair_use" }
    );
  }
  if (secs > EXCERPT_MAX_SECS) {
    throw new ClearanceRefusedError(
      `${secs}s exceeds the ${EXCERPT_MAX_SECS}s excerpt cap. That cap is inherited from the cutaway ` +
      "mechanism this renders through, so it is not a number that can be raised here — raising it means " +
      "changing what a cutaway is.",
      { code: "excerpt-too-long", lane: "fair_use" }
    );
  }

  // The commentary layer is what makes the use transformative rather than a
  // rebroadcast. It is asserted by the caller and checked again at the filter
  // graph in Phase 5; recording it here means the claim is dated and attributable.
  if (detail.commentaryLayer !== true) {
    throw new ClearanceRefusedError(
      "fair use requires the commentary/typography layer over or around the excerpt — never the footage " +
      "full-frame and alone for its whole duration. Pass commentaryLayer: true only if that is actually true; " +
      "the filter graph checks it again at render.",
      { code: "no-commentary-layer", lane: "fair_use" }
    );
  }

  const creditText = String(detail.creditText || "").trim() || creditTextFor(candidate);
  if (!creditText) {
    throw new ClearanceRefusedError(
      "fair use requires a credit chip naming the poster and platform, and this candidate has neither a " +
      "handle nor a display name. Unattributed use is the one thing this lane cannot survive.",
      { code: "no-credit", lane: "fair_use" }
    );
  }

  return {
    clearanceBasis: "fair_use",
    creditText,
    detail: {
      lane: "fair_use",
      sourceType,
      excerptSecs: secs,
      excerptMaxSecs: EXCERPT_MAX_SECS,
      excerptMaxTotalSecs: EXCERPT_MAX_TOTAL_SECS,
      commentaryLayer: true,
      // Written into the row in plain words, because whoever reads this later
      // should not have to infer what was being claimed.
      posture: "defence posture, not a licence: no permission was given, and the use was shaped to be defensible",
      recordedAt: Date.now(),
    },
  };
}

/**
 * Does a set of already-cleared fair-use excerpts leave room for another?
 *
 * The per-video total, checked across ALL excerpts rather than per excerpt — the
 * brief's rule for a segmented parent, applied generally because two 3-second
 * excerpts from two different posts have the same effect on a video as two from
 * one.
 */
export function fairUseBudgetRemaining(alreadyClearedSecs = 0) {
  return Math.max(0, EXCERPT_MAX_TOTAL_SECS - Number(alreadyClearedSecs || 0));
}
