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
import {
  runEnrichCycle, runIngestionCycle, runVideoCycle,
  runAnalysisCycle, runEventsCycle, runPolymarketCycle, runUsgsCycle,
  runEventPromoterCronCycle, runRealityIndexComposeCycle,
} from "../services/scheduler.js";
import { sweepAtStartup } from "../services/videoArtifacts.js";
import { assertFFmpegCapable } from "../services/ffmpegCapability.js";
import { runVideoRenderCycle } from "../services/videoAutopost.js";
import { longformCycleJob } from "../services/longform/runLongformCycle.js";
import { runSocialCycleWithTimeout } from "../services/socialPublisher.js";
import { runXTextCycle } from "../services/xTextPoster.js";
import { withJobRunLogging } from "./jobLogger.js";
import { queueConcurrency, queueLockDuration, DEFAULT_LOCK_MS, JOB_NAMES, QUEUE_NAMES, BULLMQ_PREFIX } from "./jobOptions.js";
import { resolveWorkerQueues } from "./workerQueues.js";
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
      // See queueLockDuration. Without this BullMQ uses 30s, renews at 15s, and
      // a multi-minute render loses its lock to any neighbouring cycle that
      // blocks the shared event loop for longer than the renewal window.
      lockDuration: queueLockDuration[queueName] ?? DEFAULT_LOCK_MS,
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
  // CAN THIS BINARY ACTUALLY RENDER? Asked before the workers register, and
  // NOT swallowed like the sweep below.
  //
  // getFFmpegPath() falls back to the bundled @ffmpeg-installer binary, which on
  // linux-x64 is a 2018 build with no `xfade` — a filter every multi-state slide
  // needs. Without this check the process boots clean, health is green, and the
  // failure surfaces at 3am inside a render as "No such filter: 'xfade'". That
  // is the token-cache and disk-cache-precedence shape: a silent fallback to
  // something that cannot do the work.
  //
  // A worker that cannot render is not degraded, it is a worker that will take
  // video jobs and fail every one of them. So this throws to the outer catch,
  // which exits — visible immediately, to the person deploying.
  assertFFmpegCapable();

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
    // WHICH QUEUES THIS CONTAINER OWNS. Unset means all of them, so a
    // single-worker deployment is byte-identical to before the split. Throws on
    // an unknown name — see workerQueues.js for why a silent subset is worse
    // than a refused boot.
    const mine = new Set(resolveWorkerQueues());
    const registerIfMine = (queue, ...rest) => {
      if (!mine.has(queue)) return;
      registerWorker(queue, ...rest);
    };

    registerIfMine(
      QUEUE_NAMES.ingestion,
      JOB_NAMES.newsIngestAll,
      queueConcurrency.ingestion,
      async () => runIngestionCycle()
    );
    registerIfMine(
      QUEUE_NAMES.video,
      JOB_NAMES.videosIngestAll,
      queueConcurrency.video,
      async () => runVideoCycle()
    );
    // The autopost loop renders HERE, in the worker — ffmpeg and satori both
    // need a process that can spawn, and the scheduler only enqueues.
    registerIfMine(
      QUEUE_NAMES.videoRender,
      JOB_NAMES.videoRenderCycle,
      queueConcurrency.videoRender,
      async (job) => runVideoRenderCycle(job.data || {})
    );
    // The long-form film loop (#75-#80). Its OWN queue, so a film render —
    // ~10 minutes measured on this host — cannot occupy the shorts loop's
    // single videoRender slot. The job itself never throws: a BullMQ retry
    // would re-render and possibly re-publish a film, and a second subscriber
    // notification cannot be recalled.
    registerIfMine(
      QUEUE_NAMES.longform,
      JOB_NAMES.longformCycle,
      queueConcurrency.longform,
      async (job) => longformCycleJob(job.data || {})
    );
    registerIfMine(
      QUEUE_NAMES.enrichment,
      JOB_NAMES.articlesEnrichBatch,
      queueConcurrency.enrichment,
      async (job) => runEnrichCycle(job.data || {})
    );
    // Social posting on its OWN queue. It used to be a tail step inside
    // runIngestionCycle, which meant any ingestion fault — a wedged flag, a
    // dispatch that never landed — took all six platforms down with it, and
    // "social is dark" was never a social problem to diagnose. It already owns
    // everything it needs to stand alone: a stale-overridable single-flight
    // guard, its own heartbeat, per-platform interval gating and its own
    // dead-man switch.
    registerIfMine(
      QUEUE_NAMES.social,
      JOB_NAMES.socialPostAll,
      queueConcurrency.social,
      async () => runSocialCycleWithTimeout()
    );
    // X TEXT POSTS. On the social queue rather than a new one: it is outbound
    // social I/O with the same shape, and a queue of its own would need its own
    // lock duration, concurrency and diagnostics for no gain.
    //
    // It is a SEPARATE JOB, not folded into runSocialCycleWithTimeout, because
    // the two have different caps, different failure modes and different spend.
    // Folding them would mean one channel's stall taking the other's turn —
    // which is exactly the fault that cost four channels a render on
    // 2026-08-25.
    registerIfMine(
      QUEUE_NAMES.social,
      JOB_NAMES.xTextPost,
      queueConcurrency.social,
      async () => runXTextCycle()
    );
    // ─── The four cycles that used to block the scheduler's event loop ──────
    //
    // They ran in-process on the scheduler, doing network fetches and bulk DB
    // writes synchronously — which pushed every cron sharing their minute out of
    // node-cron's one-second match window and kept it out. Ingestion was dead 43
    // hours behind that; prod logs showed video autopost firing 18/18 and every
    // other dispatch 0, because :07 was the only minute with no heavy neighbour.
    //
    // Here they block a worker that has nothing to keep punctual, which is the
    // point: the scheduler's only job is to be on time.
    registerIfMine(
      QUEUE_NAMES.analysis,
      JOB_NAMES.analysisRefresh,
      queueConcurrency.analysis,
      async () => runAnalysisCycle()
    );
    // Three jobs share the realityIndex queue and a concurrency of 1, so they
    // serialise against each other — they contend for the same tables, and
    // running them in parallel would trade a scheduler stall for lock contention.
    registerIfMine(
      QUEUE_NAMES.realityIndex,
      JOB_NAMES.eventsRefresh,
      queueConcurrency.realityIndex,
      async (job) => {
        switch (job.name) {
          case JOB_NAMES.eventsRefresh:     return runEventsCycle();
          case JOB_NAMES.marketsPolymarket: return runPolymarketCycle();
          case JOB_NAMES.geoUsgs:           return runUsgsCycle();
          case JOB_NAMES.eventsPromote:     return runEventPromoterCronCycle();
          case JOB_NAMES.realityIndexCompose: return runRealityIndexComposeCycle();
          default:
            // Loud rather than silent: an unrecognised job name means the queue
            // and the consumer have drifted apart, and a silently-ignored job
            // looks exactly like the outage this whole change exists to fix.
            logger.error(`[${PROCESS_ROLE}] unhandled job on ${QUEUE_NAMES.realityIndex}: ${job.name}`);
            return null;
        }
      }
    );

    // REPORT WHAT WAS REGISTERED, not a hand-maintained list of what might have
    // been. The previous literal had already drifted — it omitted `longform`,
    // whose worker is registered a few lines above — so the one line an operator
    // greps to answer "is this container consuming my queue?" was wrong.
    logger.info(`[${PROCESS_ROLE}] ready`, {
      queues: [...mine],
      partitioned: Boolean(String(process.env.WORKER_QUEUES ?? "").trim()),
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
