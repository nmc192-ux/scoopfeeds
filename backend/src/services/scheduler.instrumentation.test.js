/**
 * scheduler.instrumentation.test.js — the measurement, not the fix.
 *
 * The collision map catalogued which MINUTE each cron starts on and nothing
 * about how LONG it runs, so ":21 is occupied" was modelled as a point when it
 * is an interval. A cycle blocking the loop for four minutes swallows every
 * cron tick in that span, and a dispatch placed on a "free" minute inside it
 * dies exactly as surely as one sharing a start minute.
 *
 * Nothing measured durations, which is why the interval model could not be
 * built. These tests pin that the instruments report, so the next hour of
 * production produces data instead of another inference.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SCOOP_PERSISTENT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "sched-instr-"));
process.env.CRON_SLOW_MS = "50";
process.env.LOOP_STALL_MS = "80";

const { logger } = await import("./logger.js");
const { __testing } = await import("./scheduler.js");
const { scheduleCron, cronName } = __testing;

async function captureLogs(fn) {
  const lines = [];
  const real = { info: logger.info, warn: logger.warn, error: logger.error };
  logger.info = (m) => lines.push({ level: "info", m: String(m) });
  logger.warn = (m) => lines.push({ level: "warn", m: String(m) });
  logger.error = (m) => lines.push({ level: "error", m: String(m) });
  try { await fn(lines); } finally { Object.assign(logger, real); }
  return lines;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const block = (ms) => { const u = Date.now() + ms; while (Date.now() < u) { /* hold the loop */ } };

// ─── Naming: minutes are ambiguous, names are not ───────────────────────────

test("a cron's name is derived from its callback, not its minute", () => {
  // Five minutes carry two dispatch crons each, so ":22 fired" is not an
  // answer. Every log line must name WHICH cron.
  assert.match(cronName(() => runDispatch(() => x(), "news ingestion"), "2,32 * * * *"), /^news ingestion@/);
  assert.match(cronName(() => runEventPromoterCronCycle(), "13,43 * * * *"), /^runEventPromoterCronCycle@/);
  assert.match(cronName(() => runDispatch(() => y(), "usgs sync"), "1,12 * * * *"), /^usgs sync@/);
});

test("the name carries the expression, so two crons of the same cycle are distinguishable", () => {
  assert.equal(cronName(() => runNoaaCycle(), "4,14 * * * *"), "runNoaaCycle@4,14 * * * *");
});

// ─── Duration: the number the map was missing ───────────────────────────────

test("a cron that BLOCKS the loop synchronously is reported, with how long", async () => {
  // This is the measurement the interval model needs. A synchronous block is
  // what starves node-cron's timers — an async cycle that yields does not.
  const lines = await captureLogs(async () => {
    const t = scheduleCron("0 0 1 1 *", () => block(120));
    t.now();
    await settle(20);
    t.stop();
  });
  const slow = lines.find((l) => l.level === "warn" && l.m.includes("held the event loop SYNCHRONOUSLY"));
  assert.ok(slow, "a blocking cron must say so");
  assert.match(slow.m, /for \d+ms/);
  assert.match(slow.m, /did not fire/, "the message must say what the consequence was");
});

test("a slow ASYNC cron reports total duration without claiming it blocked", async () => {
  // An awaiting cycle holds a minute of wall clock but not the loop. Conflating
  // the two is what produced a point model in the first place.
  const lines = await captureLogs(async () => {
    const t = scheduleCron("0 0 1 1 *", async () => { await settle(90); });
    t.now();
    await settle(160);
    t.stop();
  });
  assert.ok(lines.some((l) => l.m.includes("finished after")), "total duration must be reported");
  assert.equal(lines.some((l) => l.m.includes("SYNCHRONOUSLY")), false,
    "an awaiting cycle must NOT be reported as blocking the loop");
});

test("a fast cron stays quiet — the log must not become noise", async () => {
  const lines = await captureLogs(async () => {
    const t = scheduleCron("0 0 1 1 *", () => {});
    t.now();
    await settle(20);
    t.stop();
  });
  assert.equal(lines.some((l) => l.m.includes("SYNCHRONOUSLY") || l.m.includes("finished after")), false);
});

test("a rejecting cron is reported rather than swallowed", async () => {
  const lines = await captureLogs(async () => {
    const t = scheduleCron("0 0 1 1 *", async () => { throw new Error("boom"); });
    t.now();
    await settle(40);
    t.stop();
  });
  assert.ok(lines.some((l) => l.level === "error" && l.m.includes("rejected: boom")));
});

// ─── Lag distribution ───────────────────────────────────────────────────────
//
// The first monitor logged ONLY excursions past 1500ms. It reported one stall
// in 90 minutes of production while nearly every cron was missing most of its
// ticks — because the fatal zone is far below that threshold and a steady lag
// never trips an excursion alarm. Measured against node-cron 3.0.3: ~65ms
// steady lag already costs ticks, ~2000ms kills every pattern.

test("the distribution is reported even when NOTHING exceeds the stall threshold", async () => {
  // The exact blind spot. A steady sub-threshold lag must still be visible,
  // because that is the condition that silently kills crons.
  process.env.LOOP_LAG_WINDOW_MS = "400";
  process.env.LOOP_STALL_MS = "100000";   // no excursion can possibly fire
  const { startLoopLagMonitor, stopLoopLagMonitor } = __testing;
  try {
    const lines = await captureLogs(async () => {
      startLoopLagMonitor();
      await settle(1600);
      stopLoopLagMonitor();
    });
    const dist = lines.find((l) => l.m.includes("📊 loop lag"));
    assert.ok(dist, "a distribution line must be emitted with no excursion at all");
    assert.match(dist.m, /p50=\d+ms/);
    assert.match(dist.m, /p95=\d+ms/);
    assert.match(dist.m, /max=\d+ms/);
    assert.match(dist.m, /phase drift [\d.]+s\/min/);
    assert.equal(lines.some((l) => l.m.includes("EVENT LOOP STALLED")), false);
  } finally {
    process.env.LOOP_STALL_MS = "80";
    delete process.env.LOOP_LAG_WINDOW_MS;
    __testing.stopLoopLagMonitor();
  }
});

test("sustained lag is escalated to a warning naming the consequence", async () => {
  // Drift ≥1s/min means whole seconds of wall clock went unobserved, so
  // one-second cron windows are being lost — regardless of the max.
  process.env.LOOP_LAG_WINDOW_MS = "400";
  process.env.LOOP_STALL_MS = "100000";
  const { startLoopLagMonitor, stopLoopLagMonitor } = __testing;
  try {
    const lines = await captureLogs(async () => {
      startLoopLagMonitor();
      // Yield between blocks so the monitor's interval can actually fire —
      // a tight loop starves the very sampler under test.
      for (let i = 0; i < 6; i++) { block(300); await settle(10); }
      stopLoopLagMonitor();
    });
    const warn = lines.find((l) => l.level === "warn" && l.m.includes("📊 loop lag"));
    assert.ok(warn, "sustained drift must escalate past info");
    assert.match(warn.m, /CRON WINDOWS ARE BEING LOST/);
    assert.match(warn.m, /went unobserved this minute/);
  } finally {
    process.env.LOOP_STALL_MS = "80";
    delete process.env.LOOP_LAG_WINDOW_MS;
    __testing.stopLoopLagMonitor();
  }
});

// ─── The registration manifest ──────────────────────────────────────────────

test("every registration is recorded with name AND expression", async () => {
  const { listRegisteredCrons } = await import("./scheduler.js");
  const before = listRegisteredCrons().length;
  const t = scheduleCron("5,35 * * * *", () => runSomethingCycle());
  const after = listRegisteredCrons();
  assert.equal(after.length, before + 1);
  const added = after.at(-1);
  assert.equal(added.expression, "5,35 * * * *");
  assert.match(added.name, /runSomethingCycle/);
  t.stop();
});
