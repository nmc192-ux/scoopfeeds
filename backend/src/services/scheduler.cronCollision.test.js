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
 * The four cycles that did the blocking (analysis, events, polymarket, usgs) now
 * run in the worker. These tests stop them — or anything like them — coming back.
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

test("the five cycles that caused the outage are DISPATCHED, not run in process", () => {
  // The real fix. Offsets only dodge the collision; this removes it.
  for (const label of ["dispatchAnalysisCycle", "dispatchEventsCycle", "dispatchPolymarketCycle", "dispatchUsgsCycle", "dispatchEventPromoterCycle"]) {
    const c = CRONS.find((x) => x.label === label);
    assert.ok(c, `${label} must be registered — these must never run in the scheduler again`);
    assert.equal(c.isDispatch, true, `${label} must go through runDispatch`);
  }
  // runEventPromoterCronCycle joined them after being MEASURED holding the loop
  // synchronously for 10,245ms — ten cron ticks, twice an hour.
  for (const gone of ["runAnalysisCycle", "runEventsCycle", "runPolymarketCycle", "runUsgsCycle", "runEventPromoterCronCycle"]) {
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
    inProcess.length, 14,
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
