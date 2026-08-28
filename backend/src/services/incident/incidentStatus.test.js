/**
 * The machine is asserted EXHAUSTIVELY, not sampled.
 *
 * A hand-written list of "these transitions should fail" tests only the ones
 * somebody thought of, which is precisely the guard that widens quietly later.
 * So the first test below walks the entire STATES × STATES matrix — all 64
 * ordered pairs — and requires each one to be legal exactly when TRANSITIONS
 * says so. Adding an edge anywhere makes it fail until the declaration and the
 * count both agree.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  STATES, TERMINAL_STATES, TRANSITIONS, LEGAL_TRANSITION_COUNT,
  KILL_REASONS, CLEARANCE_BASES, INITIAL_STATE,
  canTransition, assertTransition, isTerminal, IllegalTransitionError,
} from "./incidentStatus.js";

/**
 * node:assert's throws() returns undefined, so it cannot be used to inspect the
 * error it caught. These tests care about the MESSAGES — a refusal the operator
 * cannot act on is only half a guard — so the error is captured here instead.
 */
function caught(fn, Type) {
  try { fn(); } catch (err) {
    if (Type) assert.ok(err instanceof Type, `expected ${Type.name}, got ${err?.name}: ${err?.message}`);
    return err;
  }
  assert.fail("expected a throw, got none");
}

test("every ordered pair of states is legal exactly when TRANSITIONS says so", () => {
  let legal = 0;
  for (const from of STATES) {
    for (const to of STATES) {
      const declared = TRANSITIONS[from].includes(to);
      assert.equal(
        canTransition(from, to), declared,
        `${from} → ${to}: canTransition disagrees with the declared machine`
      );
      if (declared) legal++;
    }
  }
  assert.equal(
    legal, LEGAL_TRANSITION_COUNT,
    `the machine has ${legal} edges but LEGAL_TRANSITION_COUNT says ${LEGAL_TRANSITION_COUNT}. ` +
    "If you widened the machine on purpose, update the constant and say why in the PR."
  );
});

test("the matrix walk is not vacuous — it really did cover 64 pairs", () => {
  // If STATES were ever emptied or shadowed, the loop above would pass having
  // asserted nothing. This pins the size of the thing being walked.
  assert.equal(STATES.length, 8);
  assert.equal(STATES.length * STATES.length, 64);
  assert.equal(new Set(STATES).size, STATES.length, "STATES contains a duplicate");
});

test("the two shortcuts that would break the engine's whole premise are absent", () => {
  // These are the edges someone under deadline pressure would add. Named
  // explicitly so the diff that adds one has to delete a test that says why.
  assert.equal(
    canTransition("verified", "constructed"), false,
    "verified → constructed would render an uncleared frame"
  );
  assert.equal(
    canTransition("candidate", "cleared"), false,
    "candidate → cleared would clear an unverified candidate"
  );
  assert.equal(
    canTransition("verifying", "clearing"), false,
    "verifying → clearing would start clearance before verification finished"
  );
  assert.equal(canTransition("candidate", "constructed"), false);
});

test("kills and uncleared are terminal — nothing leaves them", () => {
  for (const s of ["killed", "uncleared"]) {
    assert.ok(isTerminal(s));
    assert.deepEqual(TRANSITIONS[s], [], `${s} must have no outgoing edges`);
    for (const to of STATES) {
      assert.equal(canTransition(s, to), false, `${s} → ${to} must be refused`);
    }
  }
});

test("constructed is terminal too — an asset is used once, then its row is history", () => {
  assert.ok(TERMINAL_STATES.includes("constructed"));
  assert.deepEqual(TRANSITIONS.constructed, []);
});

test("the terminal refusal explains what to do instead", () => {
  const err = caught(() => assertTransition("killed", "verifying", {}), IllegalTransitionError);
  assert.match(err.message, /terminal/i);
  assert.match(err.message, /re-intake/i, "the message should tell the operator the way forward");
});

test("a non-terminal refusal names what the state does allow", () => {
  const err = caught(() => assertTransition("verified", "constructed", {}), IllegalTransitionError);
  assert.match(err.message, /verified allows: clearing/);
});

test("unknown states are refused on both sides", () => {
  assert.throws(() => assertTransition("banana", "verifying", {}), IllegalTransitionError);
  assert.throws(() => assertTransition("candidate", "banana", {}), IllegalTransitionError);
  assert.equal(canTransition("banana", "verifying"), false);
  assert.equal(canTransition("candidate", undefined), false);
});

// ─── Payload rules: an unfinished decision is not a record ───────────────────

test("a kill without a reason is refused, and free text is not a reason", () => {
  assert.throws(() => assertTransition("verifying", "killed", {}), IllegalTransitionError);
  assert.throws(
    () => assertTransition("verifying", "killed", { killReason: "looked dodgy" }),
    IllegalTransitionError
  );
  for (const reason of KILL_REASONS) {
    const out = assertTransition("verifying", "killed", { killReason: reason });
    assert.equal(out.killReason, reason);
    assert.equal(out.clearanceBasis, null);
  }
});

test("a clearance without a basis is refused, and treatment is never a basis", () => {
  assert.throws(() => assertTransition("clearing", "cleared", {}), IllegalTransitionError);
  // The banned reasoning, asserted as a banned value: grading something does not
  // make it usable, and no basis by that name may ever be accepted.
  for (const notABasis of ["graded", "treated", "cropped", "ken_burns"]) {
    assert.throws(
      () => assertTransition("clearing", "cleared", { clearanceBasis: notABasis }),
      IllegalTransitionError,
      `"${notABasis}" must never be a clearance basis`
    );
  }
  for (const basis of CLEARANCE_BASES) {
    assert.equal(assertTransition("clearing", "cleared", { clearanceBasis: basis }).clearanceBasis, basis);
  }
});

test("the clearance refusal states the treatment rule out loud", () => {
  const err = caught(() => assertTransition("clearing", "cleared", { clearanceBasis: "graded" }), IllegalTransitionError);
  assert.match(err.message, /Treatment is not a basis/i);
});

test("constructed needs the video id, and whitespace is not an id", () => {
  assert.throws(() => assertTransition("cleared", "constructed", {}), IllegalTransitionError);
  assert.throws(
    () => assertTransition("cleared", "constructed", { constructedVideoId: "   " }),
    IllegalTransitionError
  );
  const out = assertTransition("cleared", "constructed", { constructedVideoId: " vid-9 " });
  assert.equal(out.constructedVideoId, "vid-9", "the id is trimmed, not stored with its padding");
});

test("states that need no payload reject none and return nulls", () => {
  for (const [from, to] of [["candidate", "verifying"], ["verifying", "verified"], ["verified", "clearing"], ["clearing", "uncleared"]]) {
    const out = assertTransition(from, to, {});
    assert.deepEqual(out, { killReason: null, clearanceBasis: null, constructedVideoId: null });
  }
});

test("a payload for the wrong target state is ignored rather than persisted", () => {
  // Passing a kill reason on the way to `verified` must not smuggle it into the
  // row — the detail belongs to the state, not to the call.
  const out = assertTransition("verifying", "verified", { killReason: "stale", clearanceBasis: "grant" });
  assert.equal(out.killReason, null);
  assert.equal(out.clearanceBasis, null);
});

test("every candidate starts at the one state with no way back into it", () => {
  assert.equal(INITIAL_STATE, "candidate");
  for (const from of STATES) {
    assert.equal(canTransition(from, "candidate"), false, `${from} → candidate must not exist`);
  }
});

test("the declared machine is frozen — it cannot be widened at runtime", () => {
  assert.throws(() => { TRANSITIONS.verified.push("constructed"); }, TypeError);
  assert.throws(() => { STATES.push("whatever"); }, TypeError);
  assert.equal(canTransition("verified", "constructed"), false);
});

test("every state is reachable from the start, so none is dead code", () => {
  // A state nobody can reach is a state whose rules are never exercised.
  const seen = new Set([INITIAL_STATE]);
  const queue = [INITIAL_STATE];
  while (queue.length) {
    for (const next of TRANSITIONS[queue.pop()]) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  assert.deepEqual(
    STATES.filter((s) => !seen.has(s)), [],
    "these states cannot be reached from `candidate`"
  );
});
