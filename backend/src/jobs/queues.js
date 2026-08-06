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

/** Test seam. Not part of the module's contract. */
export const __testing = { withStepDeadline };

export async function enqueueSingletonJob(queueName, jobName, data = {}, options = {}) {
  if (!assertRedisAvailable({ role: `queue:${queueName}` })) return null;

  const queue = getQueueByName(queueName);
  if (!queue) throw new Error(`Queue '${queueName}' is not initialized`);

  const jobId = options.jobId || JOB_IDS[jobName];
  const ctx = { queueName, jobName, jobId };

  // Singleton-jobId dedup trap: BullMQ refuses to re-add a jobId that still
  // exists in ANY state — including completed/failed. removeOnComplete{count}
  // never prunes a queue whose only job is this singleton, so after the first
  // completion every subsequent add() silently returned the stale finished job
  // and the cycle never ran again (prod: ingestion/video/enrichment all executed
  // exactly once post-cutover, then logged "Enqueued" for days while dead).
  // Self-heal: if the existing job is finished, remove it so the add is real.
  // A job that is genuinely waiting/active/delayed is left alone — dedup there
  // is the singleton's whole point (no overlapping cycles).
  const existing = await withStepDeadline(queue.getJob(jobId), { ...ctx, step: "getJob" });
  if (existing) {
    const state = await withStepDeadline(existing.getState(), { ...ctx, step: "getState" });
    if (state === "completed" || state === "failed") {
      await withStepDeadline(existing.remove(), { ...ctx, step: "remove" });
    } else {
      // Not an error — the singleton is genuinely in flight and dedup is the
      // whole point. Logged because "add returned the existing job" and "add
      // created a new one" were previously the same log line, which is how a
      // queue that had silently stopped advancing still read as healthy.
      logger.info(`⏸️ ${jobName} already ${state} — dedup held`, { queue: queueName, jobId });
    }
  }

  const job = await withStepDeadline(
    queue.add(jobName, data, { ...options, jobId }),
    { ...ctx, step: "add" }
  );

  logger.info(`📥 Enqueued ${jobName}`, { queue: queueName, jobId: job.id });
  return job;
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
