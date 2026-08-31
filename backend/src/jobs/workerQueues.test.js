/**
 * workerQueues.test.js — the worker split's deployment contract.
 *
 * WHY THIS READS THE REAL COMPOSE FILE. The partition is not a preference, it
 * is a correctness property, and it lives half in code and half in YAML. Every
 * cycle these containers run guards itself with a PROCESS-LOCAL `isRunning`
 * boolean — jobOptions.js says so in three places — so the two failure modes are:
 *
 *   a queue in BOTH lists    → two guards that cannot see each other → the cycle
 *                              runs twice. Two social posts. Two published films,
 *                              and a second subscriber notification cannot be
 *                              recalled.
 *   a queue in NEITHER       → nothing consumes it and it goes silently dark,
 *                              which in this codebase has repeatedly looked
 *                              exactly like a quiet day.
 *
 * A unit test over hand-written fixtures would pass while the deployed YAML said
 * something else, so this parses the file that actually ships.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveWorkerQueues, ALL_WORKER_QUEUES } from "./workerQueues.js";

const COMPOSE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "../../../docker-compose.production.yml"
);

/**
 * Pull every `WORKER_QUEUES: "..."` out of the compose file.
 *
 * Deliberately a regex rather than a YAML dependency: the assertion is about a
 * handful of literal strings, and adding a parser to the production test path to
 * read six words would be the larger risk.
 */
function composeQueueLists() {
  const yaml = fs.readFileSync(COMPOSE, "utf8");
  return [...yaml.matchAll(/^\s*WORKER_QUEUES:\s*"([^"]*)"/gm)]
    .map((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean));
}

test("the compose file declares a WORKER_QUEUES list for every worker container", () => {
  const yaml = fs.readFileSync(COMPOSE, "utf8");
  const workerServices = [...yaml.matchAll(/^ {2}(worker[a-z-]*):$/gm)].map((m) => m[1]);
  const lists = composeQueueLists();
  assert.ok(workerServices.length >= 2, `expected at least two worker services, found ${workerServices.join(", ")}`);
  assert.equal(lists.length, workerServices.length,
    `${workerServices.length} worker service(s) but ${lists.length} WORKER_QUEUES list(s) — ` +
    `a worker without one silently consumes EVERY queue and duplicates its neighbour`);
});

test("THE CONTRACT: the lists partition the queue set — nothing twice, nothing dropped", () => {
  const lists = composeQueueLists();
  const seen = new Map();
  for (const list of lists) for (const q of list) seen.set(q, (seen.get(q) || 0) + 1);

  const twice = [...seen].filter(([, n]) => n > 1).map(([q]) => q);
  assert.deepEqual(twice, [],
    `consumed by more than one container: ${twice.join(", ")} — each cycle's isRunning guard is ` +
    `process-local, so this runs the cycle twice, not slowly`);

  const dropped = ALL_WORKER_QUEUES.filter((q) => !seen.has(q));
  assert.deepEqual(dropped, [],
    `consumed by NO container: ${dropped.join(", ")} — this queue goes dark and looks like a quiet day`);
});

test("every name in the compose lists is a queue that exists", () => {
  // resolveWorkerQueues throws on an unknown name; running the real compose
  // values through it is what turns a YAML typo into a failed test rather than
  // a container that boots clean and consumes nothing.
  for (const list of composeQueueLists()) {
    assert.doesNotThrow(() => resolveWorkerQueues(list.join(",")), `compose names an unknown queue: ${list.join(",")}`);
  }
});

test("the graph half carries the two jobs that were monopolising the thread", () => {
  // Measured over 12 days: events.promote 59.8% of wall-clock, analysis.refresh
  // 46.9%. If a future edit moves either back in with the latency work, the
  // split has stopped doing the thing it was built for.
  const lists = composeQueueLists();
  const graph = lists.find((l) => l.includes("reality-index"));
  assert.ok(graph, "no container claims reality-index, which is where events.promote runs");
  assert.ok(graph.includes("analysis"), "analysis.refresh belongs with the graph work, not with the clock work");
  assert.ok(!graph.includes("ingestion"), "ingestion must not share a thread with the graph jobs — that is the whole split");
});

test("video_render sits with the LATENCY half, on the measurement that put it there", () => {
  // 0 of 55 event-loop-starvation windows were covered by a render alone, across
  // 360 renders including 78 over ten minutes: renders are spawned ffmpeg and do
  // not hold the loop. That measurement is why this is two containers and not
  // three, so it is pinned rather than left to memory.
  const lists = composeQueueLists();
  const latency = lists.find((l) => l.includes("ingestion"));
  assert.ok(latency, "no container claims ingestion");
  assert.ok(latency.includes("video_render"), "video_render belongs with ingestion — see the header");
});

// ─── The resolver itself ────────────────────────────────────────────────────

test("unset means every queue, so a single-worker deployment is unchanged", () => {
  assert.deepEqual(resolveWorkerQueues(undefined), [...ALL_WORKER_QUEUES]);
  assert.deepEqual(resolveWorkerQueues(""), [...ALL_WORKER_QUEUES]);
  assert.deepEqual(resolveWorkerQueues("   "), [...ALL_WORKER_QUEUES]);
});

test("an unknown queue name REFUSES THE BOOT rather than consuming a subset", () => {
  assert.throws(() => resolveWorkerQueues("ingestion,reality_index"), /do not exist: reality_index/,
    "a typo must not produce a container that starts clean and consumes nothing");
});

test("names are returned in canonical order and deduplicated", () => {
  assert.deepEqual(resolveWorkerQueues("social,ingestion,social"), ["ingestion", "social"]);
});

test("whitespace around names is tolerated — compose lists get hand-edited", () => {
  assert.deepEqual(resolveWorkerQueues(" ingestion , social "), ["ingestion", "social"]);
});
