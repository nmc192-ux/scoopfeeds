import test from "node:test";
import assert from "node:assert/strict";
import { limitAction } from "./limits.mjs";

test("allowed and a missing status never stop the run", () => {
  assert.equal(limitAction({ status: "allowed" }).action, "ok");
  assert.equal(limitAction({}).action, "ok");
  assert.equal(limitAction(undefined).action, "ok");
});

test("allowed_warning is logged, not a stop (the 2 Oct false stop)", () => {
  const a = limitAction({ status: "allowed_warning", rateLimitType: "five_hour", resetsAt: 1790953200 });
  assert.equal(a.action, "warn");
  assert.match(a.why, /allowed_warning.*five_hour/);
});

test("rejected stops the run", () => {
  const a = limitAction({ status: "rejected", rateLimitType: "seven_day", resetsAt: 1 });
  assert.equal(a.action, "stop");
  assert.match(a.why, /rejected.*seven_day/);
});

test("drawing paid overage stops the run whatever the status says", () => {
  for (const status of ["allowed", "allowed_warning", "rejected", undefined]) {
    const a = limitAction({ status, isUsingOverage: true });
    assert.equal(a.action, "stop", String(status));
    assert.match(a.why, /overage/);
  }
});

test("an unknown status is a warning, not a silent pass and not a stop", () => {
  assert.equal(limitAction({ status: "something_new" }).action, "warn");
});
