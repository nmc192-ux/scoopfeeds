/**
 * scheduler.dispatch.test.js — runDispatch, and the guard it deliberately lacks.
 *
 * Ingestion stopped dispatching twice in one day. The working hypothesis was
 * that an in-flight guard had wedged; there is no guard, and adding one would
 * have CREATED that failure — a bare boolean set before a never-settling await
 * is exactly the wedge this codebase has already hit twice elsewhere.
 *
 * So the load-bearing property here is an ABSENCE, and an absence needs a test
 * or the next reader re-adds the guard. That is the first test below.
 *
 * The rest cover the instrumentation, which is the actual fix: the three cases
 * — cron never fired, task hung, task threw — must be separable from the log
 * alone, without correlating across files or inferring from silence.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SCOOP_PERSISTENT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "sched-dispatch-"));
process.env.DISPATCH_STUCK_MS = "120";

const { logger } = await import("./logger.js");
const { __testing } = await import("./scheduler.js");
const { runDispatch } = __testing;

/** Capture logger output for the duration of `fn`. */
async function captureLogs(fn) {
  const lines = [];
  const realInfo = logger.info.bind(logger);
  const realWarn = logger.warn.bind(logger);
  const realError = logger.error.bind(logger);
  logger.info = (msg, meta) => { lines.push({ level: "info", msg: String(msg), meta }); };
  logger.warn = (msg, meta) => { lines.push({ level: "warn", msg: String(msg), meta }); };
  logger.error = (msg, meta) => { lines.push({ level: "error", msg: String(msg), meta }); };
  try { await fn(lines); } finally {
    logger.info = realInfo; logger.warn = realWarn; logger.error = realError;
  }
  return lines;
}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const never = () => new Promise(() => {});

// ─── The absence ────────────────────────────────────────────────────────────

test("A DISPATCH LEFT IN-FLIGHT DOES NOT BLOCK THE NEXT TICK", async () => {
  // The whole point. Leave one task hanging forever, then fire the next tick
  // and assert it ran. If anyone adds an in-flight guard to runDispatch, this
  // fails — which is the intent, because that guard would turn one hung task
  // into permanent silence, and permanent silence is the outage.
  let secondRan = false;
  await captureLogs(async () => {
    runDispatch(() => never(), "hung cycle");
    await settle(20);
    runDispatch(async () => { secondRan = true; }, "next tick");
    await settle(40);
  });
  assert.equal(secondRan, true, "the next tick must proceed past a wedged predecessor");
});

test("many wedged dispatches still do not block a later one", async () => {
  // The real shape: a hang recurs every tick for hours. Tick N+20 must still fire.
  let lateRan = false;
  await captureLogs(async () => {
    for (let i = 0; i < 20; i++) runDispatch(() => never(), `hung ${i}`);
    await settle(20);
    runDispatch(async () => { lateRan = true; }, "late tick");
    await settle(40);
  });
  assert.equal(lateRan, true);
});

// ─── The instrumentation ────────────────────────────────────────────────────

test("START is logged BEFORE the task's first await", async () => {
  // This is what separates "the cron never fired" from "the cron fired and
  // hung". It has to be emitted before control is yielded, or a hang on the
  // very first await produces the same silence as a dead cron.
  const seenAtTaskEntry = [];
  await captureLogs(async (lines) => {
    runDispatch(async () => { seenAtTaskEntry.push(...lines.map((l) => l.msg)); }, "news ingestion");
    await settle(40);
  });
  assert.ok(
    seenAtTaskEntry.some((m) => m.includes("news ingestion dispatch START")),
    "the START line must already be out by the time the task body runs",
  );
});

test("a completed dispatch logs OK with elapsed time", async () => {
  const lines = await captureLogs(async () => {
    runDispatch(async () => { await settle(10); }, "news ingestion");
    await settle(60);
  });
  const ok = lines.find((l) => l.msg.includes("news ingestion dispatch OK"));
  assert.ok(ok, "a successful dispatch must say so");
  assert.match(ok.msg, /in \d+ms/);
});

test("a throwing dispatch logs FAIL with elapsed and the reason, and never rethrows", async () => {
  const lines = await captureLogs(async () => {
    runDispatch(async () => { throw new Error("redis exploded"); }, "news ingestion");
    await settle(60);
  });
  const fail = lines.find((l) => l.level === "error" && l.msg.includes("dispatch failed"));
  assert.ok(fail);
  assert.match(fail.msg, /after \d+ms/);
  assert.equal(fail.meta.error, "redis exploded");
});

test("a hung dispatch announces itself as STUCK rather than staying silent", async () => {
  // START with no OK and no FAIL was previously something you had to notice by
  // its absence. Now it says so.
  const lines = await captureLogs(async () => {
    runDispatch(() => never(), "news ingestion");
    await settle(250);
  });
  const stuck = lines.find((l) => l.level === "error" && l.msg.includes("dispatch STUCK"));
  assert.ok(stuck, "a task that never settles must be reported");
  assert.match(stuck.msg, /this is a hang, not a missed tick/);
});

test("a dispatch that finishes in time does NOT log STUCK", async () => {
  // The counter-test: an alert that fires on healthy behaviour gets muted, and
  // then it is not an alert.
  const lines = await captureLogs(async () => {
    runDispatch(async () => { await settle(10); }, "news ingestion");
    await settle(250);
  });
  assert.equal(lines.some((l) => l.msg.includes("STUCK")), false);
});

test("the three failure modes are distinguishable from the log alone", async () => {
  // cron never fired → no START. hung → START only. threw → START + failed.
  const hung = await captureLogs(async () => {
    runDispatch(() => never(), "A");
    await settle(60);   // under the STUCK threshold, so only START is out
  });
  const threw = await captureLogs(async () => {
    runDispatch(async () => { throw new Error("x"); }, "B");
    await settle(60);
  });

  const has = (lines, s) => lines.some((l) => l.msg.includes(s));
  assert.ok(has(hung, "A dispatch START") && !has(hung, "A dispatch OK") && !has(hung, "A dispatch failed"));
  assert.ok(has(threw, "B dispatch START") && has(threw, "B dispatch failed"));
});
