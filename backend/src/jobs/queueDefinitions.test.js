/**
 * queueDefinitions.test.js — every queue the scheduler dispatches to must have a
 * producer in queues.js.
 *
 * The scheduler is the only process that enqueues. enqueueSingletonJob looks the
 * queue up in queueDefinitions; a queue that is missing there fails every dispatch
 * in ~1 ms with "Queue '<name>' is not initialized", and the worker — which reads
 * QUEUE_NAMES directly and so registers its consumer happily — never receives a
 * job. Nothing errors on the worker side, so the cycle simply never runs.
 *
 * That is exactly how ScoopFeeds Radio shipped (Oct 2026): the worker consumer,
 * cron, lock and concurrency were all added, the producer entry was not, and the
 * radio's own tests called runRadioStateCycle directly so they could not see it.
 *
 * This test reads scheduler.js as text and checks every `queue: QUEUE_NAMES.<x>`
 * it dispatches to against queueDefinitions, so the next new queue fails here
 * instead of silently in production.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEDULER = path.join(HERE, "../services/scheduler.js");

const { __testing, QUEUE_NAMES } = await import("./queues.js");

test("every queue the scheduler dispatches to has a producer in queueDefinitions", () => {
  const src = fs.readFileSync(SCHEDULER, "utf8");
  const keys = new Set([...src.matchAll(/queue:\s*QUEUE_NAMES\.(\w+)/g)].map((m) => m[1]));
  assert.ok(keys.size > 0, "found no `queue: QUEUE_NAMES.<x>` dispatches in scheduler.js — has the pattern changed?");

  const produced = new Set(Object.values(__testing.queueDefinitions));
  const unknown = [...keys].filter((k) => !(k in QUEUE_NAMES));
  assert.deepEqual(unknown, [], `scheduler.js names QUEUE_NAMES keys that do not exist: ${unknown.join(", ")}`);

  const missing = [...keys].map((k) => QUEUE_NAMES[k]).filter((name) => !produced.has(name));
  assert.deepEqual(
    missing, [],
    `scheduler dispatches to queue(s) with no producer in queueDefinitions: ${missing.join(", ")}`
  );
});

test("the radio queue specifically has a producer", () => {
  assert.ok(Object.values(__testing.queueDefinitions).includes(QUEUE_NAMES.radio));
});
