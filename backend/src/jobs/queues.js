import "../config/env.js";
import { Queue } from "bullmq";
import { logger } from "../services/logger.js";
import { createRedisConnection, assertRedisAvailable, isRedisConfigured } from "./redis.js";
import { BULLMQ_PREFIX, defaultJobOptions, JOB_IDS, JOB_NAMES, QUEUE_NAMES } from "./jobOptions.js";

const queueDefinitions = {
  ingestionQueue: QUEUE_NAMES.ingestion,
  videoQueue: QUEUE_NAMES.video,
  videoRenderQueue: QUEUE_NAMES.videoRender,
  socialQueue: QUEUE_NAMES.social,
  enrichmentQueue: QUEUE_NAMES.enrichment,
  analysisQueue: QUEUE_NAMES.analysis,
  realityIndexQueue: QUEUE_NAMES.realityIndex,
  notificationQueue: QUEUE_NAMES.notification,
  newsletterQueue: QUEUE_NAMES.newsletter,
  briefQueue: QUEUE_NAMES.brief,
  maintenanceQueue: QUEUE_NAMES.maintenance,
};

let queues = null;

function ensureQueues() {
  if (queues) return queues;
  if (!isRedisConfigured()) return null;

  // PRODUCER connection — offline buffering OFF. With ioredis's default (true),
  // an add() issued while the socket is down is queued and never settles: not
  // resolved, not rejected, just gone, taking the dispatch promise with it. A
  // producer wants to be TOLD it cannot reach Redis; the caller can skip a cycle,
  // it cannot un-wait. Worker connections keep the default — they hold blocking
  // reads across reconnects and would throw on ordinary blips.
  const connection = createRedisConnection("bullmq-queues", { enableOfflineQueue: false });
  queues = Object.fromEntries(
    Object.entries(queueDefinitions).map(([key, name]) => [
      key,
      new Queue(name, {
        prefix: BULLMQ_PREFIX,
        connection,
        defaultJobOptions,
      }),
    ])
  );
  return queues;
}

export function getQueues() {
  return ensureQueues();
}

export function getQueueByName(name) {
  const currentQueues = ensureQueues();
  if (!currentQueues) return null;
  return Object.values(currentQueues).find((queue) => queue.name === name) || null;
}

// Per-await deadline. Every Redis round trip below was previously unbounded, so
// a command that never settled took the dispatch with it silently — no log, no
// error, nothing to distinguish it from a cron that never fired.
const ENQUEUE_STEP_TIMEOUT_MS = () =>
  Number.parseInt(process.env.QUEUE_ENQUEUE_TIMEOUT_MS || "", 10) || 10_000;

/**
 * Race one Redis round trip against a deadline, rejecting with WHICH step timed
 * out and on what.
 *
 * REJECTS, NEVER RETRIES AND NEVER RESOLVES A DEFAULT. A hang converted into a
 * silent retry is the same failure wearing a hat: the caller would carry on as
 * though the enqueue had happened, and the cycle would go quiet exactly as
 * before, only with more machinery in between. The rejection propagates to
 * runDispatch, which logs it against the cycle label.
 *
 * The underlying command is not cancellable — ioredis has no abort — so it is
 * left running. Promise.race attaches a handler to it, so a late rejection is
 * handled and cannot surface as an unhandled rejection.
 */
function withStepDeadline(promise, { step, queueName, jobName, jobId }) {
  const timeoutMs = ENQUEUE_STEP_TIMEOUT_MS();
  let timer = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(
        `enqueueSingletonJob TIMED OUT after ${timeoutMs}ms at step "${step}" — ` +
        `queue=${queueName} job=${jobName} jobId=${jobId}. ` +
        `The Redis command never settled. Nothing was enqueued; this cycle is SKIPPED, not retried.`
      ));
    }, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, deadline]).finally(() => { if (timer) clearTimeout(timer); });
}


/**
 * ACTIVE is the ONLY state in which an existing singleton legitimately blocks a
 * new one. A job someone is working on right now is what the singleton exists to
 * protect: removing it would let two cycles run concurrently, which for the
 * video loop means two publishes against one daily cap.
 *
 * EVERY OTHER STATE MUST BE CLEARED. The old rule cleared only `completed` and
 * `failed`, on the reasoning that waiting/delayed jobs are "genuinely queued" —
 * true, but it left `unknown` uncovered, and `unknown` is exactly what a job
 * whose hash key outlived its state set reports. That key then blocks every
 * future add for ever: `queue.add` with a duplicate jobId does not throw, it
 * returns the stale job, so the caller logs a cheerful "Enqueued" for a cycle
 * that will never run again. Ingestion was dead 43 hours behind that.
 *
 * A `waiting` or `delayed` job that keeps being cleared and re-added is the
 * correct trade: for a singleton cycle job the re-add is idempotent, and the
 * alternative is a queue entry nothing will ever drain silently outranking
 * every subsequent tick.
 */
const DEDUP_HOLDING_STATES = new Set(["active"]);

/**
 * Core, with the queue injected so it is testable without Redis. The dedup trap
 * has now cost two multi-day outages; it needs tests that do not require a live
 * broker to run.
 */
async function enqueueWithQueue(queue, queueName, jobName, data = {}, options = {}) {
  const jobId = options.jobId || JOB_IDS[jobName];
  const ctx = { queueName, jobName, jobId };
  const enqueuedAt = Date.now();

  const existing = await withStepDeadline(queue.getJob(jobId), { ...ctx, step: "getJob" });
  if (existing) {
    const state = await withStepDeadline(existing.getState(), { ...ctx, step: "getState" });

    if (DEDUP_HOLDING_STATES.has(state)) {
      // Working as designed. Returns WITHOUT calling add: add would hand back
      // this same job, and the freshness check below would then flag a genuine
      // dedup as a fault.
      logger.info(`⏸️ ${jobName} already ${state} — dedup held, no overlapping cycle`, { queue: queueName, jobId });
      return existing;
    }

    // Every other state, terminal or not, is cleared before the add.
    logger.info(`🧹 ${jobName} found in state "${state}" — clearing the stale singleton`, { queue: queueName, jobId });
    try {
      await withStepDeadline(existing.remove(), { ...ctx, step: "remove" });
    } catch (err) {
      // Do NOT swallow and continue quietly: the add below will hand back the
      // stale job and this cycle will not run. Say so; the freshness check
      // turns it into a hard failure a moment later.
      logger.error(
        `🚨 could not remove the stale ${jobName} singleton (state=${state}): ${err.message}. ` +
        `The next add will return the stale job and this cycle will NOT run.`,
        { queue: queueName, jobId }
      );
    }
  }

  const job = await withStepDeadline(
    queue.add(jobName, data, { ...options, jobId }),
    { ...ctx, step: "add" }
  );

  // THE ADD MUST HAVE PRODUCED A NEW JOB. BullMQ returns the pre-existing job
  // for a duplicate jobId instead of throwing, so a no-op add is otherwise
  // indistinguishable from a real one — the failure mode that logged "Enqueued"
  // for days over a dead cycle. A job created before this call started cannot
  // be one this call created.
  if (typeof job?.timestamp === "number" && job.timestamp < enqueuedAt) {
    throw new Error(
      `enqueueSingletonJob NO-OP — queue=${queueName} job=${jobName} jobId=${jobId}. ` +
      `add() returned a job created ${enqueuedAt - job.timestamp}ms before this call, so the stale ` +
      `singleton was never cleared and NOTHING WAS ENQUEUED. Delete the key ` +
      `(${BULLMQ_PREFIX}:${queueName}:${jobId}) to unblock the cycle.`
    );
  }

  logger.info(`📥 Enqueued ${jobName}`, { queue: queueName, jobId: job.id });
  return job;
}

export async function enqueueSingletonJob(queueName, jobName, data = {}, options = {}) {
  if (!assertRedisAvailable({ role: `queue:${queueName}` })) return null;

  const queue = getQueueByName(queueName);
  if (!queue) throw new Error(`Queue '${queueName}' is not initialized`);

  return enqueueWithQueue(queue, queueName, jobName, data, options);
}

export async function getQueueDiagnostics() {
  if (!assertRedisAvailable({ role: "queue-diagnostics" })) {
    return {
      enabled: false,
      reason: "REDIS_URL not configured",
      queues: [],
    };
  }

  const currentQueues = getQueues();
  const diagnostics = await Promise.all(
    Object.values(currentQueues).map(async (queue) => {
      const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
      const [failedJobs, activeJobs, delayedJobs] = await Promise.all([
        queue.getJobs(["failed"], 0, 4, false),
        queue.getJobs(["active"], 0, 4, false),
        queue.getJobs(["delayed"], 0, 4, false),
      ]);

      const summarize = (job) => ({
        id: job.id,
        name: job.name,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason || null,
        timestamp: job.timestamp,
        processedOn: job.processedOn || null,
        finishedOn: job.finishedOn || null,
      });

      return {
        queue: queue.name,
        counts,
        failedJobs: failedJobs.map(summarize),
        activeJobs: activeJobs.map(summarize),
        delayedJobs: delayedJobs.map(summarize),
      };
    })
  );

  return {
    enabled: true,
    prefix: BULLMQ_PREFIX,
    queues: diagnostics,
  };
}

export { JOB_NAMES, QUEUE_NAMES };

/**
 * Test seam. Declared at the bottom because `DEDUP_HOLDING_STATES` and
 * `enqueueWithQueue` are `const`s further up — an export placed above them sits
 * in the temporal dead zone and throws at import.
 * Not part of the module's contract.
 */
export const __testing = { withStepDeadline, enqueueWithQueue, DEDUP_HOLDING_STATES };
