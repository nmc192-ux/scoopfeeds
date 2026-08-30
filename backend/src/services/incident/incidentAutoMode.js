/**
 * incidentAutoMode.js — the incident engine, unattended.
 *
 * DrJ's Ruling 1, 2026-08-30, overriding the human-approval design: the engine
 * publishes without pre-publication human verification. Review happens AFTER
 * upload, from a daily digest, and mistakes are corrected then.
 *
 * ─── What is removed, and what is emphatically not ─────────────────────────
 *
 * REMOVED: the human TAPS. A NEEDS_HUMAN outcome no longer parks a candidate
 * waiting for a person who, at twelve renders a day, was never going to arrive
 * in time. It proceeds.
 *
 * NOT REMOVED — and this is the whole safety argument — THE MACHINE'S OWN
 * JUDGMENT. Every hard kill stands exactly as built:
 *
 *   - the Pakistan / politically-live KILL
 *   - the sensitivity tiers
 *   - repost-collapse
 *   - the source-type blocklist
 *
 * A KILL still kills. DrJ: "I'm removing my taps, not the machine's judgment."
 * So this module can turn NEEDS_HUMAN into a pass; it can NEVER touch a KILL,
 * and a candidate that was killed stays killed. That asymmetry is the reason
 * unattended operation is defensible at all, and it is asserted rather than
 * described — see the tests.
 *
 * ─── The trail must not start lying ────────────────────────────────────────
 *
 * An auto-resolved check is recorded as auto-resolved, with the machine's own
 * evidence attached, and the actor is "auto". The ledger never claims a human
 * ruled. That distinction is what makes the daily digest worth reading: DrJ
 * needs to see WHAT WAS NOT MEASURED, not a wall of things that look decided.
 */

import { VERDICTS } from "./incidentChecks.js";
import { logger } from "../logger.js";

/** The actor recorded for anything this module decides. Never "operator". */
export const AUTO_ACTOR = "auto";

export const autoModeEnabled = () => process.env.INCIDENT_AUTO_MODE === "1";

/**
 * Turn every unresolved check into an auto-resolved pass, preserving evidence.
 *
 * KILLS ARE UNTOUCHED. The guard is explicit and first, because the entire
 * safety case rests on it: if this function could clear a KILL, unattended
 * publication would be unsafe and no amount of post-hoc review would fix it.
 */
export function autoResolve(results, { now = Date.now() } = {}) {
  const out = {};
  const resolved = [];
  for (const [check, r] of Object.entries(results || {})) {
    if (!r) { out[check] = r; continue; }
    if (r.verdict === VERDICTS.KILL) { out[check] = r; continue; }   // never
    if (r.verdict === VERDICTS.PASS) { out[check] = r; continue; }

    resolved.push(check);
    out[check] = {
      ...r,
      verdict: VERDICTS.PASS,
      reason: `auto:${r.reason || "unresolved"}`,
      evidence: {
        // The machine's own evidence is carried through UNCHANGED. The digest
        // reads this to show what the check actually found before it was
        // waved on, which is the only thing that makes post-hoc review real.
        ...(r.evidence || {}),
        autoResolved: true,
        autoResolvedAt: new Date(now).toISOString(),
        autoActor: AUTO_ACTOR,
        machineVerdict: r.verdict,
        machineReason: r.reason || null,
      },
    };
  }
  return { results: out, autoResolved: resolved };
}

/**
 * The render tap, auto-approved.
 *
 * Recorded with actor "auto" so the ledger cannot later be read as a person
 * having looked at this frame. A tap that records itself as human approval is
 * worse than no tap at all: it launders an unreviewed decision.
 */
export function autoApproveRender({ candidateId, note = null } = {}) {
  logger.info(`🎥 incident auto: render tap auto-approved for ${candidateId} (actor=${AUTO_ACTOR})`);
  return {
    approved: true,
    actor: AUTO_ACTOR,
    at: new Date().toISOString(),
    note: note || "auto mode: no pre-publication human review (DrJ ruling 2026-08-30)",
  };
}

/**
 * Should this candidate proceed, and on what basis?
 *
 * Returns the outcome the caller should act on, plus the list of checks that
 * were auto-resolved so they can be surfaced in the digest. A killed candidate
 * comes back killed, always.
 */
export function decideAuto({ outcome, results, blockers = [] }, { now = Date.now() } = {}) {
  if (outcome === "killed") {
    return { outcome: "killed", results, autoResolved: [], proceeded: false };
  }
  if (outcome === "verified") {
    return { outcome: "verified", results, autoResolved: [], proceeded: true };
  }
  const { results: next, autoResolved } = autoResolve(results, { now });
  logger.warn(
    `🎥 incident auto: proceeding on ${autoResolved.length} unresolved check(s) — ${autoResolved.join(", ") || "none"}. ` +
    `Recorded as auto-resolved with evidence; this candidate has had NO human review.`
  );
  return { outcome: "verified", results: next, autoResolved, proceeded: true, wasNeedsHuman: true, blockers };
}
