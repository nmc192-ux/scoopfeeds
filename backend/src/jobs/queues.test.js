/**
 * queues.test.js — the per-await deadline on enqueueSingletonJob.
 *
 * Every Redis round trip here used to be unbounded. A command that never
 * settled took the dispatch promise with it and logged NOTHING, so ingestion
 * going quiet was indistinguishable from a cron that never fired — which is
 * exactly how two successive diagnoses were argued from an absence of evidence.
 *
 * The property under test is that a hang becomes a REJECTION NAMING THE STEP.
 * Not a retry, not a resolved default: a hang converted into a silent retry is
 * the same failure wearing a hat, because the caller carries on as though the
 * enqueue happened and the cycle goes quiet exactly as before.
 */

import test from "node:test";
import assert from "node:assert/strict";

process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
process.env.QUEUE_ENQUEUE_TIMEOUT_MS = "150";

const { __testing } = await import("./queues.js");

const never = () => new Promise(() => {});           // never settles
const ctx = { queueName: "ingestion", jobName: "news.ingest.all", jobId: "news-ingest-all-singleton" };

test("a step that never settles rejects at the deadline", async () => {
  await assert.rejects(
    () => __testing.withStepDeadline(never(), { ...ctx, step: "getJob" }),
    /TIMED OUT after 150ms at step "getJob"/,
  );
});

test("the rejection names the queue, the job and the jobId", async () => {
  // Without these a timeout says only "something timed out", and the whole
  // point is that the next occurrence diagnoses itself.
  const err = await __testing.withStepDeadline(never(), { ...ctx, step: "add" }).catch((e) => e);
  assert.match(err.message, /queue=ingestion/);
  assert.match(err.message, /job=news\.ingest\.all/);
  assert.match(err.message, /jobId=news-ingest-all-singleton/);
  assert.match(err.message, /step "add"/);
});

test("it says the cycle is SKIPPED, not retried", async () => {
  const err = await __testing.withStepDeadline(never(), { ...ctx, step: "getState" }).catch((e) => e);
  assert.match(err.message, /SKIPPED, not retried/);
});

test("each of the four steps is distinguishable", async () => {
  for (const step of ["getJob", "getState", "remove", "add"]) {
    const err = await __testing.withStepDeadline(never(), { ...ctx, step }).catch((e) => e);
    assert.match(err.message, new RegExp(`step "${step}"`));
  }
});

test("a step that settles in time passes its value straight through", async () => {
  const value = await __testing.withStepDeadline(Promise.resolve({ id: "job-1" }), { ...ctx, step: "add" });
  assert.deepEqual(value, { id: "job-1" });
});

test("a genuine Redis error is NOT masked by the deadline", async () => {
  // The deadline must add a failure mode, not replace one. A real error has to
  // reach the caller as itself.
  await assert.rejects(
    () => __testing.withStepDeadline(Promise.reject(new Error("READONLY replica")), { ...ctx, step: "add" }),
    /READONLY replica/,
  );
});

test("a late rejection after the deadline cannot become an unhandled rejection", async () => {
  // The underlying command is not cancellable, so it keeps running and may
  // reject after we have given up on it. Telemetry must never crash the process.
  let unhandled = null;
  const onUnhandled = (err) => { unhandled = err; };
  process.on("unhandledRejection", onUnhandled);
  try {
    const slow = new Promise((_, reject) => setTimeout(() => reject(new Error("late boom")), 250).unref?.());
    await assert.rejects(() => __testing.withStepDeadline(slow, { ...ctx, step: "getJob" }), /TIMED OUT/);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(unhandled, null, "the abandoned command's rejection must stay handled");
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
  }
});

test("the timeout is tunable without a deploy", async () => {
  const saved = process.env.QUEUE_ENQUEUE_TIMEOUT_MS;
  process.env.QUEUE_ENQUEUE_TIMEOUT_MS = "60";
  try {
    const startedAt = Date.now();
    await __testing.withStepDeadline(never(), { ...ctx, step: "getJob" }).catch(() => {});
    assert.ok(Date.now() - startedAt < 140, "must honour the shorter deadline");
  } finally { process.env.QUEUE_ENQUEUE_TIMEOUT_MS = saved; }
});
