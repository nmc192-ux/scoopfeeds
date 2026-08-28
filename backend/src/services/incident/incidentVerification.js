/**
 * incidentVerification.js — running the four checks, and refusing to verify.
 *
 * THE COMBINATION RULE, and why it is written the way it is:
 *
 *   any KILL         → killed (first kill wins; kills are terminal)
 *   ALL four PASS    → verified
 *   anything else    → stays in `verifying`, routed to the human queue
 *
 * The default is NOT verified. `verified` is reachable only by a conjunction
 * over a check list this module does not choose — it walks CHECK_NAMES from
 * incidentChecks.js and asserts afterwards that it holds a verdict for every
 * name. A check silently not running therefore cannot look like a check that
 * passed; it is a missing verdict, and a missing verdict is a hard error rather
 * than an absence that the `all pass` test would quietly satisfy.
 *
 * That last property is the one worth defending in review. `[].every(fn)` is
 * TRUE, so an orchestrator that iterated a check list which happened to be empty
 * would verify everything, forever, and every unit test asserting "all passing
 * checks verify" would still be green. The registry cross-check is what makes
 * the conjunction mean something.
 *
 * WHAT IT DOES NOT DO: write to the database. It returns a decision; the caller
 * applies it through incidentLedger.transition(), so the machine stays the only
 * thing that moves a status.
 */

import {
  VERDICTS, CHECK_NAMES,
  checkSensitivity, checkPriorAppearance, checkCorroboration, checkContext,
} from "./incidentChecks.js";
import { logger } from "../logger.js";

/** Verdict → the ledger kill_reason it maps to. */
const KILL_REASON_FOR = Object.freeze({
  sensitive_story: "sensitive_story",
  uncorroborated: "uncorroborated",
  context_mismatch: "context_mismatch",
  cannot_confirm: "cannot_confirm",
});

export class VerificationError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "VerificationError";
    this.code = code;
  }
}

/**
 * Run every check and produce a decision.
 *
 * @returns {{ outcome, killReason, results, blockers }}
 *   outcome ∈ "verified" | "killed" | "needs_human"
 */
export async function verifyCandidate({
  candidate = {}, story = {}, posts = [],
  reverseSearch = null, vision = null,
  originalityEvidence = null, politicallyLive = false, imageRef = null,
} = {}) {
  const results = {};

  // Sensitivity first: it is free, and when it kills there is no reason to spend
  // a reverse search or a vision call on a candidate that cannot be used.
  results.sensitivity = checkSensitivity({ storyTitle: story?.title });

  if (results.sensitivity.verdict === VERDICTS.KILL) {
    // The remaining checks are recorded as not run — explicitly, with a reason.
    // A blank is indistinguishable from a pass when someone reads this later.
    for (const name of CHECK_NAMES) {
      if (name === "sensitivity") continue;
      results[name] = {
        verdict: VERDICTS.NEEDS_HUMAN,
        reason: "not_run_short_circuited",
        evidence: { note: "the sensitivity gate killed this candidate before this check was reached" },
      };
    }
    return decide(candidate, results);
  }

  results.prior_appearance = await checkPriorAppearance({
    imageRef: imageRef ?? candidate?.post_url ?? null,
    claimedAt: candidate?.claimed_at ?? null,
    reverseSearch,
  });

  results.corroboration = checkCorroboration({ posts, originalityEvidence });

  results.context = await checkContext({
    candidate, story,
    claimedLocation: candidate?.claimed_location ?? null,
    claimedAt: candidate?.claimed_at ?? null,
    vision, politicallyLive,
  });

  return decide(candidate, results);
}

/**
 * Combine verdicts.
 *
 * The registry cross-check runs BEFORE the conjunction, so an incomplete run
 * throws rather than producing a verdict from a subset.
 */
function decide(candidate, results) {
  const missing = CHECK_NAMES.filter((name) => !results[name]?.verdict);
  if (missing.length) {
    throw new VerificationError(
      `verification ran without a verdict for: ${missing.join(", ")}. ` +
      "A check that did not run must not be able to look like a check that passed, so this is an error " +
      "rather than a missing entry the conjunction would skip over.",
      { code: "incomplete-run" }
    );
  }
  // Guards the degenerate case directly: [].every() is true, and an empty
  // registry would otherwise verify everything.
  if (CHECK_NAMES.length === 0) {
    throw new VerificationError("the check registry is empty — nothing would be verified against", { code: "empty-registry" });
  }

  const entries = CHECK_NAMES.map((name) => [name, results[name]]);

  const killed = entries.find(([, r]) => r.verdict === VERDICTS.KILL);
  if (killed) {
    const [name, result] = killed;
    const killReason = KILL_REASON_FOR[result.reason] || "operator";
    logger.warn(
      `🎥 incident: candidate ${candidate?.id} KILLED by ${name} — ${result.reason} ` +
      `(${JSON.stringify(result.evidence?.note ?? "").slice(0, 120)})`
    );
    return { outcome: "killed", killReason, results, blockers: [name] };
  }

  const blockers = entries.filter(([, r]) => r.verdict !== VERDICTS.PASS).map(([name]) => name);
  if (blockers.length) {
    logger.info(
      `🎥 incident: candidate ${candidate?.id} needs a human — unresolved: ${blockers.join(", ")}`
    );
    return { outcome: "needs_human", killReason: null, results, blockers };
  }

  logger.info(`🎥 incident: candidate ${candidate?.id} VERIFIED — all ${CHECK_NAMES.length} checks passed`);
  return { outcome: "verified", killReason: null, results, blockers: [] };
}

/**
 * A compact summary for the review queue.
 *
 * Written so the operator can see, in one line per check, what was actually
 * measured — because "verification evidence" that only shows conclusions is how
 * an unmeasured check gets read as a clean one.
 */
export function summariseForQueue({ outcome, results, blockers }) {
  return {
    outcome,
    blockers,
    checks: CHECK_NAMES.map((name) => ({
      check: name,
      verdict: results[name]?.verdict ?? null,
      reason: results[name]?.reason ?? null,
      note: results[name]?.evidence?.note ?? null,
    })),
  };
}
