/**
 * approval.js - the human tap every public submission needs before it can air (#219, first version).
 *
 * "Every submission waits for an approval tap from DrJ (or an editor he names) before it can air.
 *  DrJ decides later whether to automate that."
 *
 * Approvers come from RADIO_FOOTAGE_APPROVERS (comma-separated names); unset means DrJ only.
 * Approval is refused unless the submission passed verification, and its air copy still holds a valid
 * content-safety clearance and burned-in credit. There is no automatic approval path.
 */
import { hasValidClearance } from "../safety/contentSafety.js";
import { hasBurnedCredit } from "./credit.js";

export function approverList(env = process.env) {
  const raw = (env.RADIO_FOOTAGE_APPROVERS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return raw.length ? raw : ["DrJ"];
}

export function isApprover(name, approvers = approverList()) {
  const n = String(name || "").trim().toLowerCase();
  return !!n && approvers.some((a) => a.toLowerCase() === n);
}

/** Approve: returns the updated record, or throws with every reason it may not be approved. */
export function approveSubmission(store, id, { by, note = null, approvers = approverList(), now = () => new Date() } = {}) {
  const rec = store.get(id);
  if (!rec) throw new Error(`no such submission ${id}`);
  const reasons = [];
  if (!isApprover(by, approvers)) reasons.push(`"${by}" is not a named approver (${approvers.join(", ")})`);
  if (rec.status !== "verified") reasons.push(`submission is ${rec.status}; only a verified submission can be approved`);
  if (!rec.checks?.ok) reasons.push("verification did not pass");
  const air = store.airPath(rec);
  const c = hasValidClearance(air);
  if (!c.ok) reasons.push(`content safety: ${c.why}`);
  const b = hasBurnedCredit(air);
  if (!b.ok) reasons.push(`credit: ${b.why}`);
  if (reasons.length) throw Object.assign(new Error(`cannot approve ${id}: ${reasons.join("; ")}`), { reasons });
  return store.setApproval(id, { decision: "approved", by: String(by).trim(), at: now().toISOString(), note, forCheckedAt: rec.checks.checkedAt });
}

export function rejectSubmission(store, id, { by, note = null, approvers = approverList(), now = () => new Date() } = {}) {
  if (!isApprover(by, approvers)) throw new Error(`"${by}" is not a named approver`);
  const rec = store.get(id);
  if (!rec) throw new Error(`no such submission ${id}`);
  if (rec.status === "queued") throw new Error("already queued; withdraw it from the insert queue instead");
  return store.setApproval(id, { decision: "rejected", by: String(by).trim(), at: now().toISOString(), note });
}
