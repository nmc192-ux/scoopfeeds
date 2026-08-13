/**
 * scheduler.cronCollision.test.js — the invariant that cost 43 hours of ingestion.
 *
 * THE RULE: no dispatch cron may share a minute-of-hour with an in-process cron.
 *
 * Why it is a rule and not a preference. node-cron 3.0.3 re-arms every task with
 * a fixed `setTimeout(matchTime, 1000)` AFTER the callback returns, and matches
 * on an exact one-second window (`time-matcher.js` compares getSeconds(); a
 * 5-field expression expands with seconds = "0"). The look-back loop that would
 * recover a missed tick is gated on `recoverMissedExecutions`, which defaults to
 * false and is not passed. So the tick must LAND inside its second, the period is
 * always ≥1000ms, and the drift never self-corrects.
 *
 * Measured against node-cron 3.0.3 directly:
 *   ~1015ms effective period (idle)      → every pattern fires
 *   ~1065ms (moderate event-loop lag)    → 83% for one pattern
 *   ~3023ms (heavy lag)                  → ZERO firings, every pattern
 *
 * Production confirmed the consequence exactly: 18h of scheduler logs, "video
 * autopost dispatch START" 18 times and every other dispatch 0. :07 was the only
 * dispatch minute carrying no heavy in-process work.
 *
 * Six cycles have been moved to the worker, each after being MEASURED holding
 * the loop — never on suspicion. These tests stop them coming back.
 *
 * A theory that did NOT survive measurement, recorded so it is not revived:
 * "runNoaaCycle blocks the social cron". NOAA sits at 4,14,24,34,44,54 and never
 * appeared in the slow list. Proximity in the minute map is not evidence.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = readFileSync(path.join(HERE, "scheduler.js"), "utf8");

/**
 * Parse every scheduleCron registration.
 *
 * Deliberately NOT a bounded regex over the callback. The first version of this
 * analysis used `[\s\S]{0,120}?` and silently missed
 * `scheduleCron("17 * * * *", () => runWelcomeSequenceCycle(…)` because its body
 * spans lines — which reported minute 17 as free and nearly put the social cron
 * straight back into a collision. Slice to the NEXT registration instead.
 */
function parseCrons(src) {
  const starts = [];
  const re = /scheduleCron\(\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) starts.push({ expr: m[1], at: m.index });

  return starts.map((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : Math.min(src.length, s.at + 600);
    const body = src.slice(s.at, end);
    return {
      expr: s.expr,
      label: (body.match(/=>\s*(?:runDispatch\(\s*\(\)\s*=>\s*)?([A-Za-z_][\w]*)/) || [, "?"])[1],
      isDispatch: /runDispatch/.test(body),
      hourly: s.expr.trim().split(/\s+/)[1] === "*",
      minutes: minutesOf(s.expr),
    };
  });
}

function minutesOf(expr) {
  const m = expr.trim().split(/\s+/)[0];
  const out = new Set();
  if (m === "*") { for (let i = 0; i < 60; i++) out.add(i); return out; }
  for (const part of m.split(",")) {
    const step = part.match(/^\*\/(\d+)$/);
    if (step) { for (let i = 0; i < 60; i += Number(step[1])) out.add(i); continue; }
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) { for (let i = Number(range[1]); i <= Number(range[2]); i++) out.add(i); continue; }
    if (/^\d+$/.test(part)) out.add(Number(part));
  }
  return out;
}

const CRONS = parseCrons(SRC);
const HOURLY = CRONS.filter((c) => c.hourly);
const IN_PROCESS_MINUTES = new Set(HOURLY.filter((c) => !c.isDispatch).flatMap((c) => [...c.minutes]));

test("the parser sees every registration, including multi-line ones", () => {
  // A parser that under-counts reports minutes as free when they are not, which
  // is the exact way this invariant gets silently broken.
  assert.ok(CRONS.length >= 40, `expected 40+ crons, parsed ${CRONS.length}`);
  assert.ok(CRONS.some((c) => c.label === "runWelcomeSequenceCycle"),
    "the multi-line welcomeSequence registration must be parsed — it was the one missed");
  assert.ok(CRONS.some((c) => c.isDispatch), "dispatch crons must be recognised as such");
});

test("NO DISPATCH CRON SHARES A MINUTE WITH AN IN-PROCESS CRON", () => {
  const clashes = [];
  for (const c of HOURLY.filter((x) => x.isDispatch)) {
    const shared = [...c.minutes].filter((m) => IN_PROCESS_MINUTES.has(m));
    if (!shared.length) continue;
    const neighbours = [...new Set(
      HOURLY.filter((x) => !x.isDispatch && [...x.minutes].some((m) => shared.includes(m))).map((x) => x.label)
    )];
    clashes.push(`${c.label} ("${c.expr}") shares minute(s) [${shared}] with ${neighbours.join(", ")}`);
  }
  assert.deepEqual(clashes, [],
    "A dispatch cron sharing a minute with in-process work is how ingestion died for 43 hours: " +
    "the in-process cycle blocks the event loop, node-cron's next tick lands outside its " +
    "one-second window, and the drift never recovers. Move the cron to a free minute, or " +
    "better, move the heavy cycle to the worker.\n  " + clashes.join("\n  ")
  );
});

test("the six cycles that caused the outage are DISPATCHED, not run in process", () => {
  // The real fix. Offsets only dodge the collision; this removes it.
  for (const label of ["dispatchAnalysisCycle", "dispatchEventsCycle", "dispatchPolymarketCycle", "dispatchUsgsCycle", "dispatchEventPromoterCycle", "dispatchRealityIndexComposeCycle"]) {
    const c = CRONS.find((x) => x.label === label);
    assert.ok(c, `${label} must be registered — these must never run in the scheduler again`);
    assert.equal(c.isDispatch, true, `${label} must go through runDispatch`);
  }
  // Each joined this list only after being MEASURED, never on suspicion:
  //   runEventPromoterCronCycle    10,245ms synchronous hold
  //   runRealityIndexComposeCycle   5,481ms, 4 cron ticks missed, 41% on CPU
  // The second was caught by the TIMER instrumentation, not the cron path — it
  // fired as the +540s boot pulse and was invisible before that existed.
  for (const gone of ["runAnalysisCycle", "runEventsCycle", "runPolymarketCycle", "runUsgsCycle", "runEventPromoterCronCycle", "runRealityIndexComposeCycle"]) {
    assert.equal(
      CRONS.some((c) => c.label === gone && !c.isDispatch), false,
      `${gone} is registered as an in-process cron again. It does network I/O and bulk DB ` +
      `writes synchronously; in the scheduler it blocks the event loop node-cron's timers ` +
      `depend on. Enqueue it to the worker instead.`
    );
  }
});

test("no NEW in-process cron has appeared without being counted", () => {
  // A snapshot, not a ban: ~19 in-process crons remain and moving them all is a
  // separate piece of work. But adding one must be a decision someone makes on
  // purpose, with this test in front of them — not a line that slips in and
  // takes a neighbouring dispatch cron down three weeks later.
  const inProcess = HOURLY.filter((c) => !c.isDispatch).map((c) => c.label).sort();
  assert.equal(
    inProcess.length, 13,
    `The number of hourly in-process crons changed (now ${inProcess.length}): ${inProcess.join(", ")}.\n` +
    "If you ADDED one: it will block the scheduler's event loop for as long as it runs, and " +
    "every cron sharing its minute will stop firing — permanently, not intermittently. " +
    "Prefer a queue + worker consumer. If you are certain, put it on a minute no dispatch " +
    "cron uses and update this count."
  );
});

test("the scheduler's own dispatch crons all use distinct-enough offsets to be attributable", () => {
  // Dispatches may share a minute with EACH OTHER — they only enqueue, so none
  // blocks the loop. This pins that they are all genuinely dispatches, which is
  // what makes that safe.
  const dispatchMinutes = new Map();
  for (const c of HOURLY.filter((x) => x.isDispatch)) {
    for (const m of c.minutes) {
      if (!dispatchMinutes.has(m)) dispatchMinutes.set(m, []);
      dispatchMinutes.get(m).push(c.label);
    }
  }
  for (const [minute, labels] of dispatchMinutes) {
    assert.ok(labels.length <= 4, `minute :${minute} carries ${labels.length} dispatches: ${labels.join(", ")}`);
  }
});

// ─── The docs cannot drift from the crons ───────────────────────────────────
//
// EARNED 2026-08-11. The 2026-08-09 restagger moved ingestion (*/30 → 2,32),
// video autopost (:07 → :12) and video ingestion (:00 → :09), and
// env_reference.md was not updated with it. Nothing broke — but a later
// investigation into a monitor believed to be red spent hours treating the
// stale rows as fact, hunting a code fault in a path that had none.
//
// A doc that is only nearly true about timing is worse than one that says
// nothing, because it is trusted. The table it parses is delimited by
// <!-- cron-map:start --> / <!-- cron-map:end --> and keyed on dispatch
// FUNCTION NAMES rather than prose, so this asserts on identifiers instead of
// sentences and does not rot the moment someone rewrites a Purpose column.

const DOC = readFileSync(path.join(HERE, "../../../docs/reference/env_reference.md"), "utf8");

function parseCronMap(md) {
  const block = md.match(/<!--\s*cron-map:start[\s\S]*?-->([\s\S]*?)<!--\s*cron-map:end\s*-->/);
  assert.ok(block, "the cron-map block is missing from docs/reference/env_reference.md");
  const rows = [];
  for (const line of block[1].split("\n")) {
    // | `dispatchX` | `expr` | where |
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*$/);
    if (m) rows.push({ dispatch: m[1], expr: m[2], registeredBy: m[3] });
  }
  return rows;
}

test("every documented schedule matches the cron actually registered in scheduler.js", () => {
  const rows = parseCronMap(DOC);
  assert.ok(rows.length >= 4, `the cron-map parsed ${rows.length} rows; expected at least 4`);

  for (const row of rows.filter((r) => /scheduler\.js/.test(r.registeredBy))) {
    const found = CRONS.filter((c) => c.label === row.dispatch);
    assert.equal(
      found.length, 1,
      `env_reference.md documents \`${row.dispatch}\` but scheduler.js registers it ` +
      `${found.length} time(s). The doc names a dispatch that no longer exists, or exists twice.`
    );
    assert.equal(
      found[0].expr, row.expr,
      `SCHEDULE DRIFT: scheduler.js runs \`${row.dispatch}\` on "${found[0].expr}", ` +
      `env_reference.md says "${row.expr}".\n` +
      "Moving a cron without updating the doc is what sent the 2026-08-11 investigation " +
      "after a fault that did not exist. Update the cron-map table, and re-check the " +
      "external monitor's expected period while you are there."
    );
  }
});

test("a cycle driven from outside scheduler.js is marked as such, not silently wrong", () => {
  // Social is the live example: scheduler.js really does carry a `15,45`
  // registration, ENABLE_AUTO_SOCIAL=false skips it, and the host crontab runs
  // it */30. A reader who finds 15,45 in the source and stops gets the wrong
  // answer, so the row must say where it actually comes from.
  const rows = parseCronMap(DOC);
  const external = rows.filter((r) => !/scheduler\.js/.test(r.registeredBy));
  for (const row of external) {
    assert.match(
      row.registeredBy, /crontab|host|external/i,
      `\`${row.dispatch}\` is not registered by scheduler.js, so its row must say what does ` +
      `drive it. Got: "${row.registeredBy}"`
    );
    // The in-source registration must still EXIST — if it were deleted, the row
    // would be describing a cycle nothing can dispatch and the note would be
    // documenting a ghost.
    assert.ok(
      CRONS.some((c) => c.label === row.dispatch),
      `\`${row.dispatch}\` is documented as externally driven, but scheduler.js has no ` +
      "registration for it at all — the fallback path it describes is gone."
    );
  }
});

test("all four monitored cycles are in the cron-map", () => {
  // The set that an external check watches. Ingestion, both video cycles and
  // social are the ones whose documented timing someone will act on at 2am.
  const documented = new Set(parseCronMap(DOC).map((r) => r.dispatch));
  for (const required of [
    "dispatchIngestionCycle", "dispatchVideoCycle", "dispatchVideoRenderCycle", "dispatchSocialCycle",
  ]) {
    assert.ok(documented.has(required), `${required} is monitored but absent from the cron-map table`);
  }
});

// ─── Lock duration is set for every consumed queue ──────────────────────────
//
// EARNED 2026-08-13. lockDuration was never passed, so every worker took
// BullMQ's 30s default and renewed at 15s — for a render that takes minutes.
// Prod logged "could not renew lock" then "Missing lock … moveToFinished" on
// every cycle, and a job stuck `active` with a dead lock makes the next
// dispatch log "already active — dedup held" and not run.

test("every queue the worker consumes has an explicit lock duration", async () => {
  const { queueLockDuration, QUEUE_NAMES } = await import("../jobs/jobOptions.js");
  const { readFileSync } = await import("node:fs");
  const worker = readFileSync(new URL("../jobs/workerProcess.js", import.meta.url), "utf8");
  // The queues registerWorker is actually called for.
  const consumed = [...worker.matchAll(/registerWorker\(\s*QUEUE_NAMES\.(\w+)/g)].map(m => m[1]);
  assert.ok(consumed.length >= 5, `expected several registered queues, found ${consumed.length}`);
  for (const key of consumed) {
    const name = QUEUE_NAMES[key];
    assert.ok(
      queueLockDuration[name],
      `queue "${key}" ("${name}") is consumed but has no lock duration — it would take ` +
      `BullMQ's 30s default. NOTE the key/value mismatch: videoRender is "video_render".`
    );
  }
});

test("events-promote-singleton is on the reality-index queue, not an 'events' one", async () => {
  // The prod log line names the JOB, not the queue, and there is no "events"
  // queue at all — five jobs share "reality-index". Editing the wrong lock
  // constant here would fail SILENTLY: the promoter would keep its old lock and
  // nothing would say so. Same key-vs-value trap as videoRender/"video_render".
  const { QUEUE_NAMES, JOB_NAMES, JOB_IDS, queueLockDuration } = await import("../jobs/jobOptions.js");
  assert.equal(JOB_IDS[JOB_NAMES.eventsPromote], "events-promote-singleton");
  assert.ok(!Object.values(QUEUE_NAMES).includes("events"), "there is no 'events' queue");

  const src = readFileSync(new URL("./scheduler.js", import.meta.url), "utf8");
  const dispatch = src.slice(src.indexOf("const dispatchEventPromoterCycle"));
  assert.match(dispatch.slice(0, 220), /queue:\s*QUEUE_NAMES\.realityIndex/);

  const worker = readFileSync(new URL("../jobs/workerProcess.js", import.meta.url), "utf8");
  assert.match(worker, /case JOB_NAMES\.eventsPromote:\s*return runEventPromoterCronCycle\(\)/);

  // And that queue's lock must be the raised one, not the 2-minute default.
  assert.ok(
    queueLockDuration[QUEUE_NAMES.realityIndex] >= 10 * 60_000,
    "reality-index carries a fully synchronous promoter + breaker sweep; 2 minutes is not enough",
  );
});

test("the render lock is sized for a render, not for a round number", async () => {
  const { queueLockDuration, QUEUE_NAMES } = await import("../jobs/jobOptions.js");
  const render = queueLockDuration[QUEUE_NAMES.videoRender];
  // A render is 1-3 minutes today and three more channels with polls plus a
  // mandatory 30s Threads wait will extend it. The renewal window is half the
  // lock, so this must leave room for a multi-second block inside it.
  assert.ok(render >= 10 * 60_000, `render lock is ${render}ms — too short for a multi-minute job`);
  for (const key of ["ingestion", "social", "analysis"]) {
    assert.ok(queueLockDuration[QUEUE_NAMES[key]] >= 2 * 60_000, `${key} lock is under 2 min`);
  }
});

test("the render dispatch sits in a worker-quiet minute, away from the promoter", async () => {
  // :12 shared a minute with usgs and sat one minute from the :13 promoter,
  // whose cycle blocks the worker loop for a measured 10,245ms.
  const render = CRONS.find(c => c.label === "dispatchVideoRenderCycle");
  assert.ok(render, "no video render cron registered");
  const minute = [...render.minutes][0];
  assert.equal(render.minutes.size, 1, "the render should fire once an hour");

  // Nothing else may share its minute, in either process.
  const sharers = CRONS.filter(c => c !== render && c.minutes.has(minute)).map(c => c.label);
  assert.deepEqual(sharers, [], `minute :${minute} is shared with ${sharers.join(", ")}`);

  // And it must not be adjacent to the measured 10.2s promoter block.
  const promoter = CRONS.find(c => c.label === "dispatchEventPromoterCycle");
  for (const p of promoter.minutes) {
    const gap = Math.min((p - minute + 60) % 60, (minute - p + 60) % 60);
    assert.ok(gap >= 3, `render at :${minute} is only ${gap} min from the promoter at :${p}`);
  }
});
