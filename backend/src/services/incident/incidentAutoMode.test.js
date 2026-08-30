/**
 * incidentAutoMode.test.js — unattended operation, and the line it must not cross.
 *
 * The safety case for publishing without pre-publication review is ONE property:
 * this module can wave on a check the machine could not settle, and can never
 * touch a check the machine KILLED. Everything else here is trail-keeping.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { autoResolve, autoApproveRender, decideAuto, AUTO_ACTOR, autoModeEnabled } from "./incidentAutoMode.js";
import { VERDICTS } from "./incidentChecks.js";

const R = (verdict, reason, evidence = null) => ({ verdict, reason, evidence });

test("A KILL IS NEVER CLEARED — the whole safety case", () => {
  // The Pakistan/politically-live kill, the sensitivity tiers, repost-collapse
  // and the source-type blocklist all arrive here as KILL. DrJ removed the
  // human taps, not the machine's judgment.
  const results = {
    sensitivity: R(VERDICTS.KILL, "sensitive_story", { note: "politically live" }),
    provenance: R(VERDICTS.NEEDS_HUMAN, "cannot_confirm"),
  };
  const { results: out } = autoResolve(results);
  assert.equal(out.sensitivity.verdict, VERDICTS.KILL, "a killed check must survive auto mode untouched");
  assert.equal(out.sensitivity.reason, "sensitive_story", "and its reason must not be rewritten");
  assert.equal(out.provenance.verdict, VERDICTS.PASS, "an unsettled check is waved on");
});

test("a killed CANDIDATE stays killed and does not proceed", () => {
  const d = decideAuto({ outcome: "killed", results: { a: R(VERDICTS.KILL, "sensitive_story") }, blockers: ["a"] });
  assert.equal(d.outcome, "killed");
  assert.equal(d.proceeded, false);
  assert.deepEqual(d.autoResolved, []);
});

test("NEEDS_HUMAN proceeds, and says which checks were waved on", () => {
  const d = decideAuto({
    outcome: "needs_human",
    results: { corroboration: R(VERDICTS.NEEDS_HUMAN, "uncorroborated"), rights: R(VERDICTS.PASS, "ok") },
    blockers: ["corroboration"],
  });
  assert.equal(d.outcome, "verified");
  assert.equal(d.proceeded, true);
  assert.deepEqual(d.autoResolved, ["corroboration"]);
  assert.equal(d.wasNeedsHuman, true, "the digest needs to know this was not a clean pass");
});

test("the machine's evidence is CARRIED THROUGH, not discarded", () => {
  // This is what makes post-hoc review real: DrJ has to see what the check
  // actually found before it was waved on.
  const { results: out } = autoResolve({
    provenance: R(VERDICTS.NEEDS_HUMAN, "cannot_confirm", { note: "no reverse-image match", searched: 12 }),
  }, { now: Date.parse("2026-08-30T12:00:00.000Z") });
  const e = out.provenance.evidence;
  assert.equal(e.note, "no reverse-image match", "the original evidence survives");
  assert.equal(e.searched, 12);
  assert.equal(e.autoResolved, true);
  assert.equal(e.machineVerdict, VERDICTS.NEEDS_HUMAN);
  assert.equal(e.machineReason, "cannot_confirm");
  assert.equal(e.autoActor, AUTO_ACTOR);
  assert.equal(e.autoResolvedAt, "2026-08-30T12:00:00.000Z", "the stamp is the injected clock, not the wall clock");
});

test("the reason records that a machine waved it on, not that it passed", () => {
  const { results: out } = autoResolve({ x: R(VERDICTS.NEEDS_HUMAN, "cannot_confirm") });
  assert.equal(out.x.reason, "auto:cannot_confirm",
    "a bare 'pass' would make an unmeasured check indistinguishable from a measured one");
});

test("a check that already PASSED is left completely alone", () => {
  const { results: out, autoResolved } = autoResolve({ x: R(VERDICTS.PASS, "verified by fingerprint") });
  assert.equal(out.x.reason, "verified by fingerprint");
  assert.equal(out.x.evidence, null, "no auto markers on a check nobody waved on");
  assert.deepEqual(autoResolved, []);
});

test("the render tap records ACTOR=auto — the ledger never claims a human ruled", () => {
  // A tap that records itself as human approval launders an unreviewed
  // decision, which is worse than having no tap.
  const t = autoApproveRender({ candidateId: "c1" });
  assert.equal(t.approved, true);
  assert.equal(t.actor, "auto");
  assert.notEqual(t.actor, "operator");
  assert.match(t.note, /no pre-publication human review/);
});

test("auto mode is OFF unless the flag is literally \"1\"", () => {
  const prev = process.env.INCIDENT_AUTO_MODE;
  try {
    for (const v of [undefined, "", "0", "true", "yes"]) {
      if (v === undefined) delete process.env.INCIDENT_AUTO_MODE; else process.env.INCIDENT_AUTO_MODE = v;
      assert.equal(autoModeEnabled(), false, `"${v}" must not enable unattended publication`);
    }
    process.env.INCIDENT_AUTO_MODE = "1";
    assert.equal(autoModeEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.INCIDENT_AUTO_MODE; else process.env.INCIDENT_AUTO_MODE = prev;
  }
});

test("a verified candidate is untouched — auto mode adds nothing to a clean pass", () => {
  const results = { a: R(VERDICTS.PASS, "ok"), b: R(VERDICTS.PASS, "ok") };
  const d = decideAuto({ outcome: "verified", results, blockers: [] });
  assert.equal(d.outcome, "verified");
  assert.deepEqual(d.autoResolved, []);
  assert.equal(d.wasNeedsHuman, undefined);
});
