/**
 * incidentVerifyRunner.js — the seam between the checks and the ledger.
 *
 * incidentVerification decides; incidentLedger records; this moves a candidate
 * according to a decision. Kept apart from both so the decision logic stays
 * testable without a database and the machine stays the only thing that changes
 * a status.
 *
 * WHY A HUMAN VERDICT EXISTS AT ALL. Grounding Q1 established that the
 * prior-appearance check cannot pass by machine on the reverse-search route we
 * can afford — it gathers evidence and abstains. Without a way for a person to
 * settle an abstention, no candidate could ever leave `verifying` and the engine
 * would be a very thorough dead end. So a human ruling is a first-class,
 * recorded input.
 *
 * THE ONE RULE THAT MAKES THAT SAFE: A HUMAN VERDICT MAY ONLY SETTLE AN
 * ABSTENTION. It can turn NEEDS_HUMAN into PASS or KILL. It can NEVER turn a
 * machine KILL into a PASS. If it could, every automated gate in this engine
 * would be advisory — one tired tap away from nothing — and the sensitivity
 * kill, the context contradiction and the corroboration floor would all be
 * suggestions. `applyHumanVerdicts` refuses that override loudly, and there is
 * no option, flag or force parameter that permits it.
 *
 * A human ruling on prior appearance is therefore the ONLY route to `verified`
 * today, and it is recorded with the operator's note attached, so the trail says
 * a person looked at these pages and decided — which is exactly what it should
 * say, rather than implying a machine confirmed something it cannot.
 */

import { VERDICTS, CHECK_NAMES } from "./incidentChecks.js";
import { verifyCandidate, summariseForQueue, VerificationError } from "./incidentVerification.js";
import { transition, getCandidate, candidateTrail } from "./incidentLedger.js";
import { logger } from "../logger.js";

/** Verdicts a person is allowed to hand down. */
export const HUMAN_VERDICTS = Object.freeze([VERDICTS.PASS, VERDICTS.KILL]);

export class HumanVerdictError extends Error {
  constructor(message, { code, check } = {}) {
    super(message);
    this.name = "HumanVerdictError";
    this.code = code;
    this.check = check;
  }
}

/**
 * Fold recorded human rulings into a machine decision's results.
 *
 * Pure — takes results, returns new results. Refuses any ruling that would
 * override a machine verdict rather than settle an abstention.
 */
export function applyHumanVerdicts(results, humanVerdicts = {}) {
  const out = { ...results };
  for (const [check, ruling] of Object.entries(humanVerdicts)) {
    if (!CHECK_NAMES.includes(check)) {
      throw new HumanVerdictError(`"${check}" is not a check (${CHECK_NAMES.join(", ")})`, { code: "unknown-check", check });
    }
    const current = results[check];
    if (!current) {
      throw new HumanVerdictError(`no machine result for "${check}" to rule on`, { code: "no-machine-result", check });
    }
    const verdict = ruling?.verdict;
    if (!HUMAN_VERDICTS.includes(verdict)) {
      throw new HumanVerdictError(
        `a human verdict must be ${HUMAN_VERDICTS.join(" or ")} (got ${JSON.stringify(verdict)})`,
        { code: "bad-verdict", check }
      );
    }
    // A HUMAN MAY ALWAYS BE STRICTER, NEVER LOOSER. That is the whole rule, and
    // it is worth stating as an ordering rather than as a list of cases:
    //
    //   human KILL  → always allowed. A person may refuse anything, for reasons
    //                 no check models (a face they recognise, a detail that
    //                 smells wrong). Refusing is never the dangerous direction.
    //   human PASS  → allowed ONLY where the machine abstained. Passing a check
    //                 the machine killed would make every gate in this engine
    //                 advisory, one tired tap away from nothing.
    //
    // The first draft refused every ruling on a machine-decided check, which was
    // both too strict (a person could not kill something the machine had passed)
    // and set a trap: recording a stray pass on a passed check succeeded, and
    // then every later verification threw, leaving the candidate permanently
    // unverifiable. Found by driving the real HTTP path, not by a unit test.
    if (verdict === VERDICTS.PASS && current.verdict === VERDICTS.KILL) {
      throw new HumanVerdictError(
        `"${check}" was KILLED by machine (${current.reason}) and a human verdict cannot reverse that. ` +
        "A human verdict settles a question the machine could not answer; it does not overturn one it did. " +
        "If the machine is wrong, fix the check — that fix then applies to every candidate, not just this one.",
        { code: "override-refused", check }
      );
    }
    if (verdict === VERDICTS.PASS && current.verdict === VERDICTS.PASS) {
      // A no-op, not an error. Keep the machine's own result and reason so the
      // trail does not start claiming a person decided something they merely
      // agreed with.
      continue;
    }
    out[check] = {
      verdict,
      reason: `human:${verdict}`,
      evidence: {
        ...(current.evidence || {}),
        humanNote: typeof ruling.note === "string" ? ruling.note.slice(0, 1000) : null,
        humanActor: ruling.actor || "operator",
        machineReason: current.reason,
      },
    };
  }
  return out;
}

/** Re-derive the outcome from a (possibly human-amended) result set. */
export function outcomeFor(results) {
  const missing = CHECK_NAMES.filter((n) => !results[n]?.verdict);
  if (missing.length) {
    throw new VerificationError(
      `cannot decide without a verdict for: ${missing.join(", ")}`, { code: "incomplete-run" }
    );
  }
  const killed = CHECK_NAMES.find((n) => results[n].verdict === VERDICTS.KILL);
  if (killed) return { outcome: "killed", killedBy: killed, blockers: [killed] };
  const blockers = CHECK_NAMES.filter((n) => results[n].verdict !== VERDICTS.PASS);
  return blockers.length
    ? { outcome: "needs_human", killedBy: null, blockers }
    : { outcome: "verified", killedBy: null, blockers: [] };
}

const KILL_REASON_FOR = Object.freeze({
  sensitive_story: "sensitive_story",
  uncorroborated: "uncorroborated",
  context_mismatch: "context_mismatch",
  cannot_confirm: "cannot_confirm",
  prior_appearance_pages_found: "stale",
});

/** What kill_reason does this result set imply? */
function killReasonFrom(results, killedBy) {
  const r = results[killedBy];
  if (r?.reason?.startsWith("human:")) {
    // A human kill on prior appearance is a stale finding; elsewhere it is the
    // operator's own call. Both are real reasons in the ledger's enum.
    return killedBy === "prior_appearance" ? "stale" : "operator";
  }
  return KILL_REASON_FOR[r?.reason] || "operator";
}

/**
 * Run verification for one candidate and move it accordingly.
 *
 * `candidate → verifying` happens first and is itself recorded, so the trail
 * shows the attempt even when the checks then kill it. A candidate already past
 * `candidate` is re-run in place without a spurious edge.
 *
 * @returns {{ outcome, candidate, summary, results }}
 */
export async function runVerification(db, candidateId, {
  story = null, posts = [], reverseSearch = null, vision = null,
  originalityEvidence = null, politicallyLive = false, imageRef = null,
  humanVerdicts = null, actor = "system",
} = {}) {
  const candidate = getCandidate(db, candidateId);
  if (!candidate) throw new VerificationError(`no candidate ${candidateId}`, { code: "no-such-candidate" });

  // A candidate that has already left `verifying` is not re-run.
  //
  // Found by the live exercise rather than by a test: an operator double-tapping
  // verify on a killed candidate would drive the machine at `killed → killed`,
  // which the machine correctly refuses — surfacing an IllegalTransitionError
  // for what is a harmless repeat. Kills are terminal and verified candidates
  // move on to clearance, so re-deriving either from scratch could only ever
  // restate or contradict a decision already in the trail. Restating it writes
  // noise; contradicting it would be worse.
  if (candidate.status !== "candidate" && candidate.status !== "verifying") {
    logger.info(`🎥 incident: candidate ${candidateId} is already ${candidate.status} — verification not re-run`);
    return {
      outcome: candidate.status === "verified" ? "verified" : candidate.status,
      candidate,
      summary: { outcome: candidate.status, blockers: [], checks: [], settled: true },
      results: {},
    };
  }

  if (candidate.status === "candidate") {
    transition(db, candidateId, "verifying", { checkName: "verification:start", actor });
  }

  const decision = await verifyCandidate({
    candidate, story: story || {}, posts,
    reverseSearch, vision, originalityEvidence, politicallyLive, imageRef,
  });

  // Rulings recorded earlier are replayed on top of this run, so a fresh machine
  // pass does not discard a decision a person already made about an abstention.
  const recorded = humanVerdicts ?? readHumanVerdicts(db, candidateId);
  const results = Object.keys(recorded).length
    ? applyHumanVerdicts(decision.results, recorded)
    : decision.results;

  const { outcome, killedBy, blockers } = outcomeFor(results);
  const summary = summariseForQueue({ outcome, results, blockers });

  // The last machine assessment, kept on the row so the queue can say WHY a
  // candidate is waiting without re-running paid checks. Written on EVERY run,
  // including the ones that resolve nothing — which is precisely the case the
  // queue exists to explain, and the case the trail deliberately does not
  // record (see migration 034's note).
  db.prepare("UPDATE media_candidates SET last_verification = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify({ ...summary, ranAt: Date.now() }), Date.now(), candidateId);

  if (outcome === "killed") {
    transition(db, candidateId, "killed", {
      checkName: `verification:${killedBy}`,
      killReason: killReasonFrom(results, killedBy),
      actor: results[killedBy]?.reason?.startsWith("human:") ? "operator" : actor,
      evidence: summary,
    });
  } else if (outcome === "verified") {
    transition(db, candidateId, "verified", { checkName: "verification:all-checks", actor, evidence: summary });
  } else {
    // Deliberately no transition: `verifying` IS the waiting state, and adding a
    // self-edge would fill the trail with rows that record nothing happening.
    logger.info(`🎥 incident: candidate ${candidateId} stays in verifying — ${blockers.join(", ")}`);
  }

  return { outcome, candidate: getCandidate(db, candidateId), summary, results };
}

/**
 * Record one human ruling on one abstaining check.
 *
 * Written to the audit trail as `human:<check>`, which is where
 * `readHumanVerdicts` finds it again. Storing rulings in the trail rather than a
 * column means a ruling can never be silently replaced — the trail is
 * append-only — and the sequence of rulings is itself part of the record.
 */
export function recordHumanVerdict(db, candidateId, check, verdict, { note = null, actor = "operator" } = {}) {
  if (!CHECK_NAMES.includes(check)) {
    throw new HumanVerdictError(`"${check}" is not a check (${CHECK_NAMES.join(", ")})`, { code: "unknown-check", check });
  }
  if (!HUMAN_VERDICTS.includes(verdict)) {
    throw new HumanVerdictError(
      `a human verdict must be ${HUMAN_VERDICTS.join(" or ")} (got ${JSON.stringify(verdict)})`,
      { code: "bad-verdict", check }
    );
  }
  const row = getCandidate(db, candidateId);
  if (!row) throw new HumanVerdictError(`no candidate ${candidateId}`, { code: "no-such-candidate" });

  // Refuse at RECORD time, not just at apply time. A candidate that is already
  // killed cannot be passed back to life, and accepting the ruling here and
  // refusing it on the next run would leave the operator with a 200 followed by
  // a permanent 409 — a trap rather than a rule.
  if (verdict === VERDICTS.PASS && row.status === "killed") {
    throw new HumanVerdictError(
      `candidate ${candidateId} is already killed (${row.kill_reason}) — a pass cannot revive it. ` +
      "Kills are terminal; re-intake the post as a new candidate if the kill was wrong, so both decisions stay in the trail.",
      { code: "override-refused", check }
    );
  }

  db.prepare(`
    INSERT INTO media_candidate_events (candidate_id, ts, from_status, to_status, check_name, actor, evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(candidateId, Date.now(), row.status, row.status, `human:${check}`, actor, JSON.stringify({ verdict, note }));

  logger.info(`🎥 incident: operator ruled ${verdict} on ${check} for candidate ${candidateId}`);
  return candidateTrail(db, candidateId);
}

/**
 * The rulings recorded for a candidate, latest per check.
 *
 * Later rulings win, and the earlier ones stay in the trail — a person changing
 * their mind is a legitimate thing that the record should show, not hide.
 */
export function readHumanVerdicts(db, candidateId) {
  const out = {};
  for (const row of candidateTrail(db, candidateId)) {
    if (!row.check_name?.startsWith("human:")) continue;
    const check = row.check_name.slice("human:".length);
    if (!CHECK_NAMES.includes(check)) continue;
    out[check] = { verdict: row.evidence?.verdict, note: row.evidence?.note, actor: row.actor };
  }
  return out;
}
