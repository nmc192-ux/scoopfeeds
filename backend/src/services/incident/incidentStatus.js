/**
 * incidentStatus.js — the candidate status machine. Pure, no database.
 *
 * THE WHOLE POINT IS WHAT IT REFUSES. A ledger that accepts any transition is a
 * log, not a machine, and the brief's ordering — verification precedes clearance
 * precedes construction — exists only if something enforces it. So the legal set
 * below is exhaustive and closed: anything not named is refused, and the refusal
 * says which rule it broke.
 *
 * IT IS DECLARED AS DATA, deliberately, so a test can walk the entire
 * STATES × STATES matrix and assert the machine's shape rather than spot-check
 * the handful of transitions someone thought to write a case for. A guard whose
 * test only exercises the paths it was built for is the guard that quietly
 * widens later. `LEGAL_TRANSITION_COUNT` is asserted too, so widening the
 * machine cannot happen without someone deliberately changing a number.
 *
 * THE ORDER THIS ENCODES, from brief §0:
 *
 *   candidate → verifying → verified | killed
 *   verified  → clearing  → cleared | uncleared
 *   cleared   → constructed | revoked
 *   constructed → revoked                 (the post-publish takedown path)
 *
 * There is NO edge from `candidate` or `verifying` to `clearing`, and none from
 * `verified` straight to `constructed`. Both omissions are load-bearing: they
 * are what make "no unverified frame renders" and "no uncleared frame renders"
 * properties of the type rather than of somebody's discipline.
 *
 * KILLS ARE TERMINAL. `killed`, `uncleared` and `revoked` have no outgoing edges.
 * Over-killing is correct (brief §2 Phase 2), and the cost of a wrong kill is
 * one re-intake under a new candidate id, which leaves both decisions in the
 * trail. Making a kill reversible would make the trail a draft.
 */

/** Every state a candidate can be in. */
export const STATES = Object.freeze([
  "candidate",
  "verifying",
  "verified",
  "killed",
  "clearing",
  "cleared",
  "uncleared",
  "constructed",
  "revoked",
]);

/**
 * States with no outgoing edges. Reaching one ends the candidate's life.
 *
 * `constructed` LEFT THIS LIST when revocation landed, and that is the point of
 * revocation: a grant can be withdrawn after the video is published, and a
 * machine in which `constructed` is terminal cannot express that. The permission
 * request promises "if you say yes and then change your mind before we publish,
 * tell me and we won't use it" — and a person who changes their mind afterwards
 * is owed an answer too. Without this edge the promise is one the system cannot
 * keep.
 */
export const TERMINAL_STATES = Object.freeze(["killed", "uncleared", "revoked"]);

/**
 * Why a clearance stopped holding.
 *
 * Distinct from KILL_REASONS because a kill is a finding about the MEDIA — it
 * is not what it claims to be — and a revocation is a change in the RIGHTS. The
 * media may be entirely genuine and still not ours to use any more. Collapsing
 * the two would make the ledger say the wrong thing about a poster who simply
 * changed their mind.
 */
export const REVOCATION_REASONS = Object.freeze([
  "grantor_withdrew",   // the poster changed their mind
  "takedown_request",   // a formal request, from the poster or a third party
  "rights_dispute",     // someone else claims the footage
  "operator",           // our own decision to stop using it
]);

/**
 * The complete legal edge set, `from` → allowed `to`.
 *
 * Note `verifying → verifying` and friends are absent: a re-run of a check that
 * lands on the same state writes no transition, because nothing transitioned.
 * The audit row for "we checked again and it still holds" belongs to the check,
 * not to the machine.
 */
export const TRANSITIONS = Object.freeze({
  candidate:   Object.freeze(["verifying"]),
  verifying:   Object.freeze(["verified", "killed"]),
  verified:    Object.freeze(["clearing"]),
  clearing:    Object.freeze(["cleared", "uncleared"]),
  // Revocable BEFORE publication (the request's own promise) …
  cleared:     Object.freeze(["constructed", "revoked"]),
  // … and after it, which is the takedown path. The rights can stop holding
  // at any point; only the remedy differs.
  constructed: Object.freeze(["revoked"]),
  killed:      Object.freeze([]),
  uncleared:   Object.freeze([]),
  revoked:     Object.freeze([]),
});

/**
 * How many edges the machine has. Asserted by the test suite.
 *
 * This constant exists so that widening the machine is a deliberate two-place
 * edit with a number to justify, rather than one extra string in an array that
 * a reviewer skims past. Adding "verified → constructed" — the shortcut that
 * would skip clearance entirely — is exactly the change this is here to catch.
 */
export const LEGAL_TRANSITION_COUNT = 9;

/** The reasons a candidate may be killed. Free text is not a reason. */
export const KILL_REASONS = Object.freeze([
  "stale",              // an appearance predating the claimed incident
  "uncorroborated",     // no independent second post, no established original
  "context_mismatch",   // visible cues contradict the claimed place/date
  "cannot_confirm",     // unresolvable, on a story where that is a kill
  "sensitive_story",    // the sensitivity gate refuses third-party media here
  "operator",           // a human looked at it and said no
  "withdrawn",          // the post was deleted or made private
]);

/** The bases on which a candidate may be cleared. There is no fourth. */
export const CLEARANCE_BASES = Object.freeze(["grant", "fair_use", "owner"]);

/** Where a candidate came from. */
export const INTAKE_SOURCES = Object.freeze(["manual", "auto", "commissioned"]);

/** Whether we hold a file, and how we came to. Never a rights statement. */
export const ACQUISITION_STATES = Object.freeze(["none", "requested", "supplied", "held"]);

/** The state every candidate starts in. */
export const INITIAL_STATE = "candidate";

export class IllegalTransitionError extends Error {
  constructor(message, { from, to } = {}) {
    super(message);
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
  }
}

export const isState = (s) => STATES.includes(s);
export const isTerminal = (s) => TERMINAL_STATES.includes(s);

/** Is this edge in the machine? Pure predicate, no throwing. */
export function canTransition(from, to) {
  if (!isState(from) || !isState(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/**
 * Validate one transition and the payload the target state requires.
 *
 * Returns the normalised detail fields to persist. THROWS on anything illegal —
 * a returned "ok: false" would let a caller carry on by forgetting to check it,
 * and this is the gate that keeps unverified pixels off the channel.
 *
 * The per-state payload rules are here rather than in the DAO because they are
 * part of what the transition MEANS: a kill without a reason and a clearance
 * without a basis are both unfinished decisions, and an unfinished decision is
 * not a defensible record.
 */
export function assertTransition(from, to, detail = {}) {
  if (!isState(from)) {
    throw new IllegalTransitionError(`"${from}" is not a candidate status`, { from, to });
  }
  if (!isState(to)) {
    throw new IllegalTransitionError(`"${to}" is not a candidate status`, { from, to });
  }
  if (!canTransition(from, to)) {
    const allowed = TRANSITIONS[from];
    throw new IllegalTransitionError(
      isTerminal(from)
        ? `${from} is terminal — a candidate cannot leave it. ` +
          "Re-intake the post as a new candidate if this decision was wrong; both decisions then stay in the trail."
        : `${from} → ${to} is not a legal transition (${from} allows: ${allowed.join(", ") || "nothing"}). ` +
          "Verification precedes clearance precedes construction; the missing edge is the rule.",
      { from, to }
    );
  }

  const out = { killReason: null, clearanceBasis: null, constructedVideoId: null, revocationReason: null };

  if (to === "killed") {
    if (!KILL_REASONS.includes(detail.killReason)) {
      throw new IllegalTransitionError(
        `a kill needs a reason from: ${KILL_REASONS.join(", ")} (got ${JSON.stringify(detail.killReason)}). ` +
        "An unreasoned kill cannot be reviewed, and this trail is the editorial defence.",
        { from, to }
      );
    }
    out.killReason = detail.killReason;
  }

  if (to === "cleared") {
    if (!CLEARANCE_BASES.includes(detail.clearanceBasis)) {
      throw new IllegalTransitionError(
        `a clearance needs a basis from: ${CLEARANCE_BASES.join(", ")} (got ${JSON.stringify(detail.clearanceBasis)}). ` +
        "Treatment is not a basis — grading or cropping does not affect rights.",
        { from, to }
      );
    }
    out.clearanceBasis = detail.clearanceBasis;
  }

  if (to === "revoked") {
    if (!REVOCATION_REASONS.includes(detail.revocationReason)) {
      throw new IllegalTransitionError(
        `a revocation needs a reason from: ${REVOCATION_REASONS.join(", ")} (got ${JSON.stringify(detail.revocationReason)}). ` +
        "A revocation is a change in the RIGHTS, not a finding about the media — the ledger has to say which.",
        { from, to }
      );
    }
    out.revocationReason = detail.revocationReason;
  }

  if (to === "constructed") {
    const vid = typeof detail.constructedVideoId === "string" ? detail.constructedVideoId.trim() : "";
    if (!vid) {
      throw new IllegalTransitionError(
        "constructed needs the id of the video the asset went into — without it the trail cannot answer " +
        "\"where was this used\", which is the first question anyone challenging a use will ask.",
        { from, to }
      );
    }
    out.constructedVideoId = vid;
  }

  return out;
}
