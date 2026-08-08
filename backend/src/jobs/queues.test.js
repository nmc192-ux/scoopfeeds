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

// ─── The dedup trap ─────────────────────────────────────────────────────────
//
// This has now caused two multi-day outages. The second one — ingestion dead
// 43 hours — got past the first fix because that fix cleared only `completed`
// and `failed`, and the stale key reported some other state. `queue.add` with a
// duplicate jobId does not throw: it hands back the existing job, so the caller
// logs a cheerful "Enqueued" over a cycle that will never run again.
//
// The queue is a stub on purpose. A trap that costs days in production needs a
// test that runs on every commit, not one gated on a live broker.

function fakeJob({ id, state, timestamp }) {
  return {
    id,
    timestamp,
    removed: false,
    async getState() { return state; },
    async remove() { this.removed = true; },
  };
}

/** Minimal Queue stub with BullMQ's actual duplicate-jobId semantics. */
function fakeQueue({ existing = null, removeThrows = false } = {}) {
  const q = {
    existing,
    added: [],
    async getJob() { return q.existing; },
    async add(name, data, opts) {
      // BullMQ: a duplicate jobId RETURNS THE EXISTING JOB rather than throwing.
      if (q.existing) return q.existing;
      const job = fakeJob({ id: opts.jobId, state: "waiting", timestamp: Date.now() });
      q.added.push(job);
      q.existing = job;
      return job;
    },
  };
  if (existing && removeThrows) existing.remove = async () => { throw new Error("locked"); };
  if (existing) {
    const realRemove = existing.remove.bind(existing);
    existing.remove = async () => { await realRemove(); q.existing = null; };
  }
  return q;
}

const enqueue = (queue) => __testing.enqueueWithQueue(queue, "ingestion", "news.ingest.all", {});

test("A COMPLETED SINGLETON IS CLEARED AND A NEW JOB IS CREATED", async () => {
  // The case that killed ingestion for 43h, stated directly.
  const stale = fakeJob({ id: "news-ingest-all-singleton", state: "completed", timestamp: Date.now() - 86_400_000 });
  const q = fakeQueue({ existing: stale });

  const job = await enqueue(q);

  assert.equal(stale.removed, true, "the stale singleton must be removed");
  assert.equal(q.added.length, 1, "a NEW job must be created, not the old one returned");
  assert.notEqual(job.timestamp, stale.timestamp);
  assert.ok(job.timestamp >= Date.now() - 5_000, "the returned job must be the fresh one");
});

test("every non-active state is cleared, including `unknown`", async () => {
  // `unknown` is what a job whose hash outlived its state set reports, and it
  // was NOT covered by the completed/failed rule. That gap is the whole bug.
  for (const state of ["completed", "failed", "unknown", "waiting", "delayed", "prioritized", "waiting-children"]) {
    const stale = fakeJob({ id: "news-ingest-all-singleton", state, timestamp: Date.now() - 3_600_000 });
    const q = fakeQueue({ existing: stale });
    await enqueue(q);
    assert.equal(stale.removed, true, `state "${state}" must be cleared`);
    assert.equal(q.added.length, 1, `state "${state}" must produce a new job`);
  }
});

test("ACTIVE still holds — the singleton's whole point is no overlapping cycles", async () => {
  // The one state that must NOT be cleared. Removing a job a worker is running
  // would let two cycles publish against one daily cap.
  const running = fakeJob({ id: "news-ingest-all-singleton", state: "active", timestamp: Date.now() - 60_000 });
  const q = fakeQueue({ existing: running });

  const job = await enqueue(q);

  assert.equal(running.removed, false, "an active job must be left alone");
  assert.equal(q.added.length, 0, "and no new job added");
  assert.equal(job, running, "the in-flight job is returned");
});

test("a NO-OP add is a hard failure, not a cheerful log line", async () => {
  // If removal fails, add() hands back the stale job. That must not look like a
  // successful enqueue — logging "Enqueued" over a dead cycle is the failure.
  const stale = fakeJob({ id: "news-ingest-all-singleton", state: "completed", timestamp: Date.now() - 86_400_000 });
  const q = fakeQueue({ existing: stale, removeThrows: true });

  await assert.rejects(() => enqueue(q), /NO-OP/);
  await assert.rejects(() => enqueue(q), /nothing was enqueued/i);
});

test("the no-op failure names the key to delete", async () => {
  // An outage message should carry its own remediation.
  const stale = fakeJob({ id: "news-ingest-all-singleton", state: "completed", timestamp: Date.now() - 86_400_000 });
  const q = fakeQueue({ existing: stale, removeThrows: true });
  const err = await enqueue(q).catch((e) => e);
  assert.match(err.message, /scoop:ingestion:news-ingest-all-singleton/);
});

test("an empty queue enqueues normally", async () => {
  const q = fakeQueue();
  const job = await enqueue(q);
  assert.equal(q.added.length, 1);
  assert.equal(job.id, "news-ingest-all-singleton");
});

test("only `active` holds — the holding set is exactly one state", () => {
  // Pinned so a future edit widening this set has to argue for it: every state
  // added here becomes a way for a cycle to stop for ever.
  assert.deepEqual([...__testing.DEDUP_HOLDING_STATES], ["active"]);
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
