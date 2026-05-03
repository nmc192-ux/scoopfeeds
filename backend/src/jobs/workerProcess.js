import "../config/env.js";
import { Worker } from "bullmq";
import { getDbStatus } from "../models/database.js";
import { logger } from "../services/logger.js";
import { runEnrichCycle, runIngestionCycle, runVideoCycle } from "../services/scheduler.js";
import { withJobRunLogging } from "./jobLogger.js";
import { queueConcurrency, JOB_NAMES, QUEUE_NAMES, BULLMQ_PREFIX } from "./jobOptions.js";
import { assertRedisAvailable, assertRedisStartup, closeRedisConnections, createRedisConnection } from "./redis.js";

const PROCESS_ROLE = "worker";
const idleHeartbeat = setInterval(() => {}, 60_000);
const workers = [];

async function shutdown(signal) {
  logger.info(`[${PROCESS_ROLE}] received ${signal}, shutting down...`);
  clearInterval(idleHeartbeat);
  await Promise.allSettled(workers.map((worker) => worker.close()));
  await closeRedisConnections();
  process.exit(0);
}

function registerWorker(queueName, name, concurrency, processor) {
  const worker = new Worker(
    queueName,
    (job) => withJobRunLogging(queueName, job, () => processor(job)),
    {
      prefix: BULLMQ_PREFIX,
      concurrency,
      connection: createRedisConnection(`worker:${queueName}`),
    }
  );

  worker.on("completed", (job) => {
    logger.info(`[${PROCESS_ROLE}] completed ${job.name}`, { queue: queueName, jobId: job.id });
  });
  worker.on("failed", (job, error) => {
    logger.error(`[${PROCESS_ROLE}] failed ${job?.name || name}`, {
      queue: queueName,
      jobId: job?.id || null,
      error: error.message,
    });
  });

  workers.push(worker);
  return worker;
}

try {
  assertRedisStartup({ role: PROCESS_ROLE });
  const db = getDbStatus();
  logger.info(`[${PROCESS_ROLE}] boot`, {
    pid: process.pid,
    db,
  });

  if (!assertRedisAvailable({ role: PROCESS_ROLE })) {
    logger.warn(`[${PROCESS_ROLE}] Redis not configured; queue workers will not start`);
  } else {
    registerWorker(
      QUEUE_NAMES.ingestion,
      JOB_NAMES.newsIngestAll,
      queueConcurrency.ingestion,
      async () => runIngestionCycle()
    );
    registerWorker(
      QUEUE_NAMES.video,
      JOB_NAMES.videosIngestAll,
      queueConcurrency.video,
      async () => runVideoCycle()
    );
    registerWorker(
      QUEUE_NAMES.enrichment,
      JOB_NAMES.articlesEnrichBatch,
      queueConcurrency.enrichment,
      async (job) => runEnrichCycle(job.data || {})
    );

    logger.info(`[${PROCESS_ROLE}] ready`, {
      queues: [QUEUE_NAMES.ingestion, QUEUE_NAMES.video, QUEUE_NAMES.enrichment],
      concurrency: queueConcurrency,
    });
  }
} catch (error) {
  logger.error(`[${PROCESS_ROLE}] failed to initialize`, { error: error.message });
  process.exit(1);
}

process.on("SIGTERM", () => { shutdown("SIGTERM"); });
process.on("SIGINT", () => { shutdown("SIGINT"); });
process.on("uncaughtException", (error) => {
  logger.error(`[${PROCESS_ROLE}] uncaught exception`, { error: error.message });
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  logger.error(`[${PROCESS_ROLE}] unhandled rejection`, { error: error?.message || String(error) });
  process.exit(1);
});
