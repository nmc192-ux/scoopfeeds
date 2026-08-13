function parseIntEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const BULLMQ_PREFIX = String(process.env.BULLMQ_PREFIX || "scoop").trim() || "scoop";

export const QUEUE_NAMES = {
  ingestion: "ingestion",
  video: "video",              // YouTube INGESTION (fetchAllYouTube) — not rendering
  videoRender: "video_render", // the autopost loop: spec → render → upload
  social: "social",            // outbound posting to bluesky/threads/fb/ig/li/pinterest
  enrichment: "enrichment",
  analysis: "analysis",
  realityIndex: "reality-index",
  notification: "notification",
  newsletter: "newsletter",
  brief: "brief",
  maintenance: "maintenance",
};

export const JOB_NAMES = {
  newsIngestAll: "news.ingest.all",
  videosIngestAll: "videos.ingest.all",
  articlesEnrichBatch: "articles.enrich.batch",
  videoRenderCycle: "video.render.cycle",
  socialPostAll: "social.post.all",
  // Heavy in-process cycles moved OFF the scheduler — see the collision note
  // in scheduler.js. Each blocked the event loop the cron timers live on.
  analysisRefresh: "analysis.refresh",
  eventsRefresh: "events.refresh",
  marketsPolymarket: "markets.polymarket.sync",
  geoUsgs: "geo.usgs.sync",
  eventsPromote: "events.promote",
  realityIndexCompose: "reality-index.compose",
};

export const JOB_IDS = {
  [JOB_NAMES.newsIngestAll]: "news-ingest-all-singleton",
  [JOB_NAMES.videosIngestAll]: "videos-ingest-all-singleton",
  [JOB_NAMES.articlesEnrichBatch]: "articles-enrich-batch-singleton",
  [JOB_NAMES.videoRenderCycle]: "video-render-cycle-singleton",
  [JOB_NAMES.socialPostAll]: "social-post-all-singleton",
  [JOB_NAMES.analysisRefresh]: "analysis-refresh-singleton",
  [JOB_NAMES.eventsRefresh]: "events-refresh-singleton",
  [JOB_NAMES.marketsPolymarket]: "markets-polymarket-singleton",
  [JOB_NAMES.geoUsgs]: "geo-usgs-singleton",
  [JOB_NAMES.eventsPromote]: "events-promote-singleton",
  [JOB_NAMES.realityIndexCompose]: "reality-index-compose-singleton",
};

export const defaultJobOptions = {
  attempts: 1,
  removeOnComplete: {
    count: 100,
  },
  removeOnFail: {
    count: 200,
  },
};

/**
 * PER-QUEUE LOCK DURATION. Unset until 2026-08-13, which meant BullMQ's 30s
 * default and a renewal every 15s — for a video render that takes one to three
 * MINUTES. Prod logged "could not renew lock" then "Missing lock … moveToFinished"
 * on every cycle.
 *
 * THE CAUSE WAS NOT THE RENDER. ffmpeg runs via spawn (async, never blocks the
 * loop) and satori/resvg render in ~81ms chunks. It was CROSS-JOB STARVATION.
 *
 * THE DISTINCTION THAT MATTERS, because it is easy to state loosely and get
 * backwards: scheduler crons come in TWO kinds. An IN-PROCESS cron
 * (runNoaaCycle, runWelcomeSequenceCycle, runAnomalyScanCycle …) executes on the
 * SCHEDULER container and never touches the worker's loop. A DISPATCH cron only
 * ENQUEUES; the work is consumed by the WORKER. Only the second kind can starve
 * a lock renewal here.
 *
 * runEventPromoterCronCycle is the second kind, and emphatically so — its
 * dispatch is declared `inProcess: null`, meaning it CANNOT run anywhere but
 * the worker. Its measured 10,245ms synchronous hold was recorded while it
 * still ran on the scheduler; moving it (2026-08-09) relocated that block onto
 * the worker's loop, which the moving commit acknowledged as "CONCENTRATED load
 * there". runRealityIndexComposeCycle (5,481ms) is the same shape.
 *
 * So: the render dispatched at :12, sharing the minute with dispatchUsgsCycle;
 * both landed in the worker. At :13 eventsPromote landed in the SAME worker and
 * blocked the SAME loop the renewal timer lives on for 10.2s. Renewal is every
 * 15s, so one block plus usgs consumes a window; two misses cross 30s and the
 * lock is gone.
 *
 * WHAT IT COST, which is worth knowing because it is not what it looks like:
 * duplicate renders were already prevented by videoAutopost's process-local
 * cycleInFlight guard, so the retry no-ops — UNLESS the worker restarted, which
 * removes the guard and gives a genuine duplicate render and duplicate Gemini +
 * ElevenLabs spend. The routine damage was bookkeeping: the original job DID
 * publish, then failed moveToFinished, so BullMQ recorded a failure for a cycle
 * that succeeded, poisoning the heartbeat and the yield log. And a job stuck
 * `active` with a dead lock makes the next dispatch log "already active — dedup
 * held" and not run, which is the shape of the outage that froze three queues.
 *
 * Sized to the WORK, not to a round number. videoRender is 10 minutes because a
 * render is minutes and three channels with polls and a mandatory 30s Threads
 * wait will extend it. Everything else is 2 minutes, comfortably above its own
 * runtime. maxStalledCount stays at BullMQ's default 1 — one retry, not a loop.
 *
 * At 10 minutes the renewal window is 5 minutes, and a 10.2s block cannot
 * consume it. The cron move (videoRender :12 → :39) removes the collision; this
 * makes the job survive one that has not been thought of yet.
 */
// KEYED BY THE QUEUE NAME STRING, not by the QUEUE_NAMES key. They differ for
// exactly the two queues that matter most here — videoRender is "video_render"
// and realityIndex is "reality-index" — and registerWorker receives the VALUE.
// Keying this by the object key would have looked correct, silently missed the
// render queue, and given it the 2-minute fallback instead of 10. The test
// below asserts every QUEUE_NAMES value resolves, so the next queue added
// cannot quietly inherit a default either.
export const queueLockDuration = {
  [QUEUE_NAMES.ingestion]:    parseIntEnv("QUEUE_LOCK_MS_INGESTION", 2 * 60_000),
  [QUEUE_NAMES.video]:        parseIntEnv("QUEUE_LOCK_MS_VIDEO", 2 * 60_000),
  [QUEUE_NAMES.enrichment]:   parseIntEnv("QUEUE_LOCK_MS_ENRICHMENT", 2 * 60_000),
  [QUEUE_NAMES.videoRender]:  parseIntEnv("QUEUE_LOCK_MS_VIDEO_RENDER", 10 * 60_000),
  [QUEUE_NAMES.social]:       parseIntEnv("QUEUE_LOCK_MS_SOCIAL", 2 * 60_000),
  [QUEUE_NAMES.analysis]:     parseIntEnv("QUEUE_LOCK_MS_ANALYSIS", 2 * 60_000),
  [QUEUE_NAMES.realityIndex]: parseIntEnv("QUEUE_LOCK_MS_REALITY_INDEX", 2 * 60_000),
};

/** Fallback for a queue not named above — never BullMQ's 30s. */
export const DEFAULT_LOCK_MS = 2 * 60_000;

export const queueConcurrency = {
  ingestion: parseIntEnv("QUEUE_CONCURRENCY_INGESTION", 1),
  video: parseIntEnv("QUEUE_CONCURRENCY_VIDEO", 1),
  enrichment: parseIntEnv("QUEUE_CONCURRENCY_ENRICHMENT", 2),
  // STRICTLY 1. A render is minutes of ffmpeg and the daily cap is a global
  // count — two concurrent cycles would both read "under cap" and both publish.
  videoRender: parseIntEnv("QUEUE_CONCURRENCY_VIDEO_RENDER", 1),
  // STRICTLY 1. socialPublisher's single-flight guard is PROCESS-LOCAL, so a
  // second concurrent consumer would not see it and both would post.
  social: parseIntEnv("QUEUE_CONCURRENCY_SOCIAL", 1),
  // 1 each: every one of these guards itself with a process-local isRunning
  // flag, which a second concurrent consumer would not see.
  analysis: parseIntEnv("QUEUE_CONCURRENCY_ANALYSIS", 1),
  realityIndex: parseIntEnv("QUEUE_CONCURRENCY_REALITY_INDEX", 1),
};
