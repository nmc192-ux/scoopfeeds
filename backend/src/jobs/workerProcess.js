import "../config/env.js";
import { Worker } from "bullmq";
import {
  captureException,
  captureWorkerFailure,
  flushObservability,
  initObservability,
} from "../config/observability.js";
import { getDbStatus } from "../models/database.js";
import { logger } from "../services/logger.js";
import { runEnrichCycle, runIngestionCycle, runVideoCycle } from "../services/scheduler.js";
import { sweepAtStartup } from "../services/videoArtifacts.js";
import { runVideoRenderCycle } from "../services/videoAutopost.js";
import { withJobRunLogging } from "./jobLogger.js";
import { queueConcurrency, JOB_NAMES, QUEUE_NAMES, BULLMQ_PREFIX } from "./jobOptions.js";
import { assertRedisAvailable, assertRedisStartup, closeRedisConnections, createRedisConnection } from "./redis.js";

const PROCESS_ROLE = "worker";
const idleHeartbeat = setInterval(() => {}, 60_000);
const workers = [];
initObservability({ role: PROCESS_ROLE });

async function shutdown(signal) {
  logger.info(`[${PROCESS_ROLE}] received ${signal}, shutting down...`);
  clearInterval(idleHeartbeat);
  await Promise.allSettled(workers.map((worker) => worker.close()));
  await closeRedisConnections();
  await flushObservability();
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
    captureWorkerFailure(error, {
      role: PROCESS_ROLE,
      queue: queueName,
      jobName: job?.name || name,
      jobId: job?.id || null,
      attempts: job?.attemptsMade || 0,
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

  // ─── Disk reclamation ─────────────────────────────────────────────────────
  //
  // The worker is the ONLY process that creates video artifacts — ffmpeg frame
  // scratch, MP4s and TTS clips all come out of runVideoRenderCycle, which runs
  // here and nowhere else. So this is the process that sweeps them. Web and
  // scheduler would sweep their own empty tmpdir and the same shared volume, to
  // no additional effect.
  //
  // Startup rather than a cron, per videoArtifacts.js's header: a cron that
  // stops firing is invisible, and a redeploy is exactly when leaked scratch
  // has accumulated.
  //
  // AWAITED BEFORE THE WORKERS REGISTER. sweepFrames() deletes every directory
  // under FRAMES_ROOT on the assumption that no render is in flight — true only
  // until this process starts consuming videoRender jobs. Register first and the
  // sweep can delete the scratch of a job it raced.
  //
  // Its failure is logged and swallowed: disk cleanup is maintenance, not a
  // precondition for consuming jobs, and the outer catch here exits the process.
  try {
    const swept = await sweepAtStartup();
    logger.info(`[${PROCESS_ROLE}] startup sweep`, {
      frameDirs: swept.frames.removed,
      mp4s: swept.videos.removed,
      mp4sKept: swept.videos.kept,
      ttsClips: swept.tts?.removed ?? 0,
      mbReclaimed: Number(
        ((swept.frames.bytes + swept.videos.bytes + (swept.tts?.bytes || 0)) / 1048576).toFixed(1)
      ),
    });
  } catch (error) {
    logger.error(`[${PROCESS_ROLE}] startup sweep FAILED (continuing): ${error.message}`);
  }

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
    // The autopost loop renders HERE, in the worker — ffmpeg and satori both
    // need a process that can spawn, and the scheduler only enqueues.
    registerWorker(
      QUEUE_NAMES.videoRender,
      JOB_NAMES.videoRenderCycle,
      queueConcurrency.videoRender,
      async (job) => runVideoRenderCycle(job.data || {})
    );
    registerWorker(
      QUEUE_NAMES.enrichment,
      JOB_NAMES.articlesEnrichBatch,
      queueConcurrency.enrichment,
      async (job) => runEnrichCycle(job.data || {})
    );

    logger.info(`[${PROCESS_ROLE}] ready`, {
      queues: [QUEUE_NAMES.ingestion, QUEUE_NAMES.video, QUEUE_NAMES.videoRender, QUEUE_NAMES.enrichment],
      concurrency: queueConcurrency,
    });
  }
} catch (error) {
  captureException(error, {
    role: PROCESS_ROLE,
    message: `[${PROCESS_ROLE}] failed to initialize`,
  });
  process.exit(1);
}

process.on("SIGTERM", () => { shutdown("SIGTERM"); });
process.on("SIGINT", () => { shutdown("SIGINT"); });
process.on("uncaughtException", async (error) => {
  captureException(error, {
    role: PROCESS_ROLE,
    message: `[${PROCESS_ROLE}] uncaught exception`,
  });
  await flushObservability();
  process.exit(1);
});
process.on("unhandledRejection", async (error) => {
  const rejectionError = error instanceof Error ? error : new Error(String(error));
  captureException(rejectionError, {
    role: PROCESS_ROLE,
    message: `[${PROCESS_ROLE}] unhandled rejection`,
  });
  await flushObservability();
  process.exit(1);
});
