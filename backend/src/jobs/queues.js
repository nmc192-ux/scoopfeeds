import "../config/env.js";
import { Queue } from "bullmq";
import { logger } from "../services/logger.js";
import { createRedisConnection, assertRedisAvailable, isRedisConfigured } from "./redis.js";
import { BULLMQ_PREFIX, defaultJobOptions, JOB_IDS, JOB_NAMES, QUEUE_NAMES } from "./jobOptions.js";

const queueDefinitions = {
  ingestionQueue: QUEUE_NAMES.ingestion,
  videoQueue: QUEUE_NAMES.video,
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

  const connection = createRedisConnection("bullmq-queues");
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

export async function enqueueSingletonJob(queueName, jobName, data = {}, options = {}) {
  if (!assertRedisAvailable({ role: `queue:${queueName}` })) return null;

  const queue = getQueueByName(queueName);
  if (!queue) throw new Error(`Queue '${queueName}' is not initialized`);

  const jobId = options.jobId || JOB_IDS[jobName];

  // Singleton-jobId dedup trap: BullMQ refuses to re-add a jobId that still
  // exists in ANY state — including completed/failed. removeOnComplete{count}
  // never prunes a queue whose only job is this singleton, so after the first
  // completion every subsequent add() silently returned the stale finished job
  // and the cycle never ran again (prod: ingestion/video/enrichment all executed
  // exactly once post-cutover, then logged "Enqueued" for days while dead).
  // Self-heal: if the existing job is finished, remove it so the add is real.
  // A job that is genuinely waiting/active/delayed is left alone — dedup there
  // is the singleton's whole point (no overlapping cycles).
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      await existing.remove();
    }
  }

  const job = await queue.add(jobName, data, {
    ...options,
    jobId,
  });

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
