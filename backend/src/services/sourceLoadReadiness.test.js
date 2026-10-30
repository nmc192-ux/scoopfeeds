/**
 * #292 — the Source step 2 readiness verdict. Too little evidence must read
 * UNVERIFIED, never READY.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

import {
  readinessVerdict, summariseRuns, percentile,
  PROMOTER_P95_MAX_MS, PROMOTER_ELIGIBLE_CAP,
} from "./sourceLoadReadiness.js";

const rows = (n, { status = "completed", ms = 300_000 } = {}) =>
  Array.from({ length: n }, () => ({ status, duration_ms: ms }));

test("percentile is nearest-rank and null on empty", () => {
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([7], 95), 7);
});

test("summariseRuns counts statuses and takes durations from finished runs only", () => {
  const s = summariseRuns([...rows(3), ...rows(1, { status: "failed", ms: 900_000 }), { status: "running", duration_ms: null }], { expected: 10 });
  assert.equal(s.runs, 5); assert.equal(s.completed, 3); assert.equal(s.failed, 1); assert.equal(s.running, 1);
  assert.equal(s.failureRate, 0.25); assert.equal(s.maxMs, 900_000); assert.equal(s.expected, 10);
});

test("READY when every test passes", () => {
  const promoter = summariseRuns(rows(330), { expected: 336 });
  const v = readinessVerdict({ promoter, eligibleNow: 120 });
  assert.equal(v.verdict, "READY");
  assert.deepEqual(v.failed, []);
  assert.equal(v.thresholds.promoterP95MaxMs, PROMOTER_P95_MAX_MS);
});

test("NOT READY names each failed test", () => {
  const slow = summariseRuns(rows(330, { ms: PROMOTER_P95_MAX_MS + 1 }), { expected: 336 });
  assert.match(readinessVerdict({ promoter: slow, eligibleNow: 10 }).failed.join(), /p95/);

  const failing = summariseRuns([...rows(300), ...rows(30, { status: "failed" })], { expected: 336 });
  assert.match(readinessVerdict({ promoter: failing, eligibleNow: 10 }).failed.join(), /failure rate/);

  const missing = summariseRuns(rows(200), { expected: 336 });
  assert.match(readinessVerdict({ promoter: missing, eligibleNow: 10 }).failed.join(), /expected/);

  const v = readinessVerdict({ promoter: summariseRuns(rows(336), { expected: 336 }), eligibleNow: PROMOTER_ELIGIBLE_CAP });
  assert.equal(v.verdict, "NOT READY");
  assert.match(v.failed.join(), /cap/);
});

test("UNVERIFIED with fewer than 24 runs, a missing table, or no eligible count", () => {
  assert.equal(readinessVerdict({ promoter: summariseRuns(rows(23), { expected: 336 }), eligibleNow: 1 }).verdict, "UNVERIFIED");
  assert.equal(readinessVerdict({ promoter: null, eligibleNow: 1 }).verdict, "UNVERIFIED");
  assert.equal(readinessVerdict({ promoter: summariseRuns(rows(336), { expected: 336 }), eligibleNow: null }).verdict, "UNVERIFIED");
  // 23 fast, clean runs is still not evidence of READY.
  assert.notEqual(readinessVerdict({ promoter: summariseRuns(rows(23, { ms: 1 })), eligibleNow: 0 }).verdict, "READY");
});

test("the CLI opens a DB read-only and prints a verdict without writing", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = path.resolve(here, "../../scripts/sources/load-readiness.mjs");
  const { makeTestDb } = await import("../testing/testDb.js");
  const t = makeTestDb({ prefix: "scoop-readiness-" });
  try {
    const now = Date.now();
    const ins = t.db.prepare("INSERT INTO background_job_runs (queue, job_name, status, duration_ms, created_at) VALUES (?,?,?,?,?)");
    for (let i = 0; i < 30; i++) ins.run("reality-index", "events.promote", "completed", 60_000, now - i * 1_800_000);
    t.db.pragma("wal_checkpoint(TRUNCATE)");
    const before = fs.statSync(t.path).mtimeMs;
    const out = JSON.parse(execFileSync(process.execPath, [script, "--db", t.path, "--days", "1"], { encoding: "utf8" }));
    assert.equal(out["events.promote"].runs, 30);
    assert.equal(out["events.promote"].expected, 48);
    assert.equal(out.verdict, "NOT READY", "30 of 48 expected runs is under 90%");
    assert.equal(out.eligibleClustersNow, 0);
    assert.ok(Number.isInteger(out.activeRssSources));
    assert.equal(fs.statSync(t.path).mtimeMs, before, "the DB file was not written");
  } finally {
    t.cleanup();
  }
});
