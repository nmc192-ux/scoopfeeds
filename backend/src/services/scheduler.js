import cron from "node-cron";
import v8 from "v8";
import { fetchAllSources } from "./rssFetcher.js";
import { fetchAllYouTube } from "./videoFetcher.js";
import { enrichBatch } from "./contentEnricher.js";
import { pruneOldArticles, findArticlesForVideoQueue, enqueueVideoJob,
         setVideoJobRendering, setVideoJobReady, setVideoJobFailed,
         getArticleById, rejectStalePending } from "../models/database.js";
import { logger } from "./logger.js";
import { RSS_SOURCES, YOUTUBE_SOURCES } from "../config/sources.js";
import { sendDailyDigest } from "./digest.js";
import { sendXPostDigest } from "./xPostDigest.js";
import { runWelcomeSequenceCycle } from "./welcomeSequence.js";
import { refreshAllEvents } from "./liveEvents.js";
import { refreshAnalysis } from "./analysisService.js";
import { startBreakingNewsPushDetached } from "./breakingNewsPusher.js";
import { runSocialCycleWithTimeout, listEnabledPlatforms } from "./socialPublisher.js";
import { HEARTBEAT_PING_URLS, pingStart, pingSuccess, pingFail } from "./heartbeatPing.js";

const INGESTION_PING = HEARTBEAT_PING_URLS.ingestion;
import { runXQueueGenerationCycle } from "./xPostGenerator.js";
import { isVideoConfigured, generateVideo, generateRecapVideo, generateLiveEventVideo, previewSlide } from "./videoGenerator.js";
import { runVideoPublishAndApproveCycle } from "./videoPublisher.js";
import { filterVideoEligible } from "./videoEditorialPolicy.js";
import { isYouTubeConfigured, getVideoStats } from "./youtubeClient.js";
import { isInstagramConfigured } from "./instagramClient.js";
import { isFacebookConfigured } from "./facebookClient.js";
import { isTikTokConfigured } from "./tiktokClient.js";
import { getDb, listLiveEvents, getLiveEvent } from "../models/database.js";
import { syncPolymarketMarkets } from "../realityIndex/ingest/predictionMarkets/polymarketFetcher.js";
import { snapshotActiveMarkets } from "../realityIndex/ingest/predictionMarkets/polymarketSnapshotter.js";
import { runMarketMatcherCycle } from "../realityIndex/intelligence/marketMatcher.js";
import { runSnapshotDownsampler } from "../realityIndex/jobs/snapshotDownsampler.js";
import { runEventPromoter } from "../realityIndex/intelligence/eventPromoter.js";
import { sweepCards, formatSweep } from "./cardSweep.js";
import { CARDS_DIR } from "./cardRenderer.js";
import { runEventBreakerSweep } from "../realityIndex/intelligence/eventBreaker.js";
import { runTrackerDetector } from "../realityIndex/intelligence/trackerDetector.js";
import { runScoringJob } from "../skills/scoring/runtime/scoringRun.js";
import { runEventTimelineBuilder } from "../realityIndex/intelligence/eventTimelineBuilder.js";
import { runEventActorExtractor } from "../realityIndex/intelligence/eventActorExtractor.js";
import { runEntityExtractionBatch } from "../realityIndex/intelligence/entityExtractor.js";
import { runEntityIdfRecompute } from "../realityIndex/intelligence/entityIdf.js";
import { runMediaSentimentForActiveEvents } from "../realityIndex/intelligence/mediaSentimentScorer.js";
import { runSentimentCycle } from "../realityIndex/intelligence/sentimentScorer.js";
import { runRealityIndexCycle } from "../realityIndex/intelligence/realityIndex.js";
import { runAnomalyDetector } from "../realityIndex/intelligence/anomalyDetector.js";
import { runWatchlistPushDispatcher } from "../realityIndex/jobs/watchlistPushDispatcher.js";
import { pickTopReelCandidates } from "../realityIndex/generation/reelTopicSelector.js";
import { syncGdeltCycle } from "../realityIndex/ingest/newsAggregators/gdeltFetcher.js";
import { runAnalystBriefCycle } from "../realityIndex/generation/analystBriefGenerator.js";
import { syncUsgsCycle } from "../realityIndex/ingest/geo/usgsEarthquakeFetcher.js";
import { syncNoaaCycle } from "../realityIndex/ingest/geo/noaaAlertsFetcher.js";
import { syncAcledCycle } from "../realityIndex/ingest/geo/acledFetcher.js";
import { syncFredCycle } from "../realityIndex/ingest/economic/fredFetcher.js";
import { syncWorldBankCycle } from "../realityIndex/ingest/economic/worldBankFetcher.js";
import { syncSportsdbCycle } from "../realityIndex/ingest/sports/sportsdbFetcher.js";
import { syncTmdbCycle } from "../realityIndex/ingest/entertainment/tmdbFetcher.js";
import { runQuestionExtractor } from "../realityIndex/syntheticMarkets/questionExtractor.js";
import { runAiAgentsCycle } from "../realityIndex/syntheticMarkets/aiAgents.js";
import { runOutcomeResolverCycle } from "../realityIndex/syntheticMarkets/outcomeResolver.js";
import { runBayesianUpdater } from "../realityIndex/intelligence/bayesianUpdater.js";
import { enqueueSingletonJob, JOB_NAMES, QUEUE_NAMES } from "../jobs/queues.js";
import { assertRedisAvailable, shouldUseBullMQ } from "../jobs/redis.js";
import { runDatabaseMaintenance } from "../db/maintenance.js";

let isRunning    = false;
let isVideoRun   = false;   // YouTube ingestion
let isGenRun     = false;   // short-form video generation
let isRecapRun   = false;   // daily recap video
let isLiveVidRun = false;   // 6h live-event video
let isEnrichRun  = false;
let isEventsRun   = false;
let isAnalysisRun = false;
let isPolymarketRun   = false;  // Reality Index Phase 1
let isMatcherRun      = false;  // Reality Index Phase 1
let isEventPromoterRun  = false;  // Reality Index Phase 2
let isTrackerDetectorRun = false; // Sprint 1.3.4 — Tracker Auto-Detection Engine
let isActorRun        = false;  // Reality Index Phase 2
let lastRun       = null;
let lastVideoRun = null;
let lastGenRun   = null;
let lastRecapRun = null;
let lastLiveVidRun = null;
let lastEnrichRun = null;
let lastEventsRun   = null;
let lastEventPromoterRun  = null; // Sprint 1.5.1 — close the health-observability gap
let lastTrackerDetectorRun = null; // Sprint 1.5.1 — close the health-observability gap
let lastAnalysisRun = null;
let lastPolymarketRun = null;
let lastMatcherRun    = null;
let nextRun         = null;
let schedulerStarted = false;
const schedulerTasks = [];
const schedulerTimers = [];

function bullmqEnabledForScheduler() {
  if (!shouldUseBullMQ()) return false;
  return assertRedisAvailable({ role: "scheduler" });
}

/**
 * ONE SHAPE FOR EVERY DISPATCH.
 *
 * Four cycles enqueued from here, and they used to come in two shapes: three
 * helpers that consulted bullmqEnabledForScheduler() and fell back to running
 * in-process, and the video-autopost cron which called enqueueSingletonJob
 * directly with no check at all. Nothing marked the difference as deliberate,
 * and an asymmetry nobody wrote down is how one subsystem dies quietly while
 * its neighbour keeps working — and how a post-mortem ends up reading the
 * difference as the cause.
 *
 * The difference that IS legitimate is whether an in-process fallback exists,
 * so that is now the single explicit parameter. `inProcess: null` means the
 * work genuinely cannot run here — videoRender spawns ffmpeg and satori, which
 * belong in the worker; running them in the scheduler container is not a
 * degraded mode, it is a different bug. With BullMQ off, that case now says so
 * instead of silently doing nothing.
 */
async function dispatchCycle({ queue, job, data = {}, inProcess = null, label }) {
  if (!bullmqEnabledForScheduler()) {
    if (inProcess) return inProcess();
    logger.warn(
      `⚠️ ${label} SKIPPED — BullMQ is off (USE_BULLMQ / REDIS_URL) and this cycle has no ` +
      `in-process fallback by design. It runs in the worker or not at all.`
    );
    return null;
  }
  return enqueueSingletonJob(queue, job, data);
}

const dispatchIngestionCycle = () => dispatchCycle({
  queue: QUEUE_NAMES.ingestion, job: JOB_NAMES.newsIngestAll,
  inProcess: runIngestionCycle, label: "news ingestion",
});

const dispatchVideoCycle = () => dispatchCycle({
  queue: QUEUE_NAMES.video, job: JOB_NAMES.videosIngestAll,
  inProcess: runVideoCycle, label: "video ingestion",
});

const dispatchEnrichCycle = (options = { batchSize: 40, concurrency: 4 }) => dispatchCycle({
  queue: QUEUE_NAMES.enrichment, job: JOB_NAMES.articlesEnrichBatch, data: options,
  inProcess: () => runEnrichCycle(options), label: "article enrichment",
});

// ffmpeg + satori: worker-only, so no in-process fallback on purpose.
const dispatchVideoRenderCycle = () => dispatchCycle({
  queue: QUEUE_NAMES.videoRender, job: JOB_NAMES.videoRenderCycle,
  inProcess: null, label: "video autopost",
});

// The long-form film loop. Worker-only for the same reason as videoRender —
// ffmpeg and satori need a process that can spawn — and on its OWN queue so a
// ~10-minute film render cannot occupy the shorts loop's single slot.
//
// Enqueued FREQUENTLY and refused CHEAPLY: at 3 films a week most cycles do
// nothing but read a rolling count and return. The gates live in the cycle,
// not in the cron expression, so pausing is one env var rather than a deploy.
const dispatchLongformCycle = () => dispatchCycle({
  queue: QUEUE_NAMES.longform, job: JOB_NAMES.longformCycle,
  inProcess: null, label: "longform film",
});

// Social posting: network I/O only, so it COULD run here — but it is queued
// like the rest so the worker owns every outbound cycle and the singleton jobId
// gives it the same dedup and diagnostics as its neighbours.
const dispatchSocialCycle = () => dispatchCycle({
  queue: QUEUE_NAMES.social, job: JOB_NAMES.socialPostAll,
  inProcess: () => runSocialCycleWithTimeout(), label: "social posting",
});

// X text posts. Queued like everything else so the worker owns the outbound
// call and the singleton jobId gives it the same dedup as its neighbours.
// `inProcess: null` deliberately: there is no degraded mode where the scheduler
// posts to X itself, because that is the process whose blocked event loop
// caused the 2026-08 cron outage.
const dispatchXTextCycle = () => dispatchCycle({
  queue: QUEUE_NAMES.social, job: JOB_NAMES.xTextPost,
  inProcess: null, label: "x text posts",
});

// ─── The four cycles that used to run IN THIS PROCESS ───────────────────────
//
// THIS IS THE FIX FOR THE OUTAGE, NOT A TIDY-UP. Each of these did real work —
// network fetches, embedding passes, bulk DB writes — synchronously inside the
// scheduler, blocking the event loop that node-cron's timers live on. node-cron
// 3.0.3 re-arms with a fixed setTimeout(…, 1000) AFTER the work and matches on
// an exact one-second window, so a blocked loop pushes every OTHER cron's tick
// out of its window. Measured: at a ~3s effective tick period every pattern
// fires ZERO times, not fewer times.
//
// Production confirmed it to the tick: 18h of logs, "video autopost" fired 18/18
// and every other dispatch fired 0. Video autopost was the only cron whose
// minute carried no heavy in-process work.
//
// `inProcess: null` on all four, deliberately. There is no degraded mode where
// running these in the scheduler is acceptable — that IS the bug. With BullMQ
// off they log and skip.
const dispatchAnalysisCycle = () => dispatchCycle({
  queue: QUEUE_NAMES.analysis, job: JOB_NAMES.analysisRefresh,
  inProcess: null, label: "analysis refresh",
});

const dispatchEventsCycle = () => dispatchCycle({
  queue: QUEUE_NAMES.realityIndex, job: JOB_NAMES.eventsRefresh,
  inProcess: null, label: "events refresh",
});

const dispatchPolymarketCycle = () => dispatchCycle({
  queue: QUEUE_NAMES.realityIndex, job: JOB_NAMES.marketsPolymarket,
  inProcess: null, label: "polymarket sync",
});

const dispatchUsgsCycle = () => dispatchCycle({
  queue: QUEUE_NAMES.realityIndex, job: JOB_NAMES.geoUsgs,
  inProcess: null, label: "usgs sync",
});

// The fifth, and the one caught red-handed: MEASURED holding the scheduler's
// event loop synchronously for 10,245ms. At a one-second match window that
// swallows ten cron ticks, every time it runs, twice an hour.
const dispatchEventPromoterCycle = () => dispatchCycle({
  queue: QUEUE_NAMES.realityIndex, job: JOB_NAMES.eventsPromote,
  inProcess: null, label: "event promoter",
});

// The sixth, and the first caught by the TIMER instrumentation rather than the
// cron path: MEASURED at 5,481ms synchronous hold, 4 cron ticks missed, 41% of
// the gap on CPU — ours, not the host's. It was the +540s boot pulse that fired,
// so two commits ago this was invisible: cronInFlight only tracked crons.
const dispatchRealityIndexComposeCycle = () => dispatchCycle({
  queue: QUEUE_NAMES.realityIndex, job: JOB_NAMES.realityIndexCompose,
  inProcess: null, label: "reality index compose",
});

// How long a dispatch may stay pending before we say so. Longer than the
// per-await deadline inside enqueueSingletonJob, so a hang THERE surfaces as a
// rejection naming the step, and this only fires for a hang somewhere else.
const DISPATCH_STUCK_MS = () =>
  Number.parseInt(process.env.DISPATCH_STUCK_MS || "", 10) || 60_000;

/**
 * Fire-and-forget dispatch, instrumented at both ends.
 *
 * THIS IS THE DIAGNOSTIC, and it is the point of the whole change. Ingestion
 * stopped dispatching twice in one day and left NOTHING in the log — not an
 * error, not a skip, not an "Enqueued". The only ingestion log line lived
 * inside enqueueSingletonJob AFTER four un-bounded awaits, so "the cron never
 * fired" and "the cron fired and hung on Redis" were indistinguishable, and two
 * successive hypotheses were argued from an absence of evidence.
 *
 * The START line goes out BEFORE the first await — before `task` is even
 * invoked — so the three cases now separate themselves without correlation:
 *
 *   no START at all           → the cron is not firing. Look at node-cron.
 *   START, no OK and no FAIL  → hung inside the dispatch. The STUCK line names
 *                               how long, and enqueueSingletonJob's deadline
 *                               names which await.
 *   START then FAIL           → it threw, and now the reason is attached.
 *
 * There is deliberately no in-flight guard here. A previous reading of this
 * function assumed one had wedged; there is no state to wedge, and adding a
 * flag would CREATE the failure it was meant to prevent — the bare-boolean
 * wedge this codebase has already hit twice elsewhere.
 */
function runDispatch(task, label) {
  const startedAt = Date.now();
  let settled = false;
  logger.info(`⏱️ ${label} dispatch START`);

  const stuckTimer = setTimeout(() => {
    if (settled) return;
    logger.error(
      `🫀 ${label} dispatch STUCK — ${Math.round(DISPATCH_STUCK_MS() / 1000)}s with no result. ` +
      `The cron fired and the task never settled; this is a hang, not a missed tick.`
    );
  }, DISPATCH_STUCK_MS());
  stuckTimer.unref?.();   // telemetry must never hold the process open

  Promise.resolve()
    .then(task)
    .then(() => {
      settled = true;
      clearTimeout(stuckTimer);
      logger.info(`⏱️ ${label} dispatch OK in ${Date.now() - startedAt}ms`);
    })
    .catch((error) => {
      settled = true;
      clearTimeout(stuckTimer);
      logger.error(
        `❌ ${label} dispatch failed after ${Date.now() - startedAt}ms`,
        { error: error.message }
      );
    });
}

// ─── Cron instrumentation ───────────────────────────────────────────────────
//
// The collision map catalogued which MINUTE each cron starts on. It said nothing
// about how LONG each in-process cycle RUNS, so "minute :21 is occupied" was
// modelled as a point when it is really an interval — and a cycle that blocks
// the loop for four minutes swallows every cron tick in that span, not just its
// own minute. Placing a dispatch on a "free" minute inside someone else's
// interval is exactly as fatal as sharing their start minute.
//
// Durations were never measured because nothing measured them. These three
// instruments close that, and they are the ONLY way the interval model gets
// built from data rather than guessed at:
//
//   ⏳ per-cron duration       — how long each cycle actually takes
//   🐌 synchronous-block warn  — the part that starves node-cron's timers
//   🚨 loop-lag monitor        — names the cron in flight when the loop stalls
//
// The lag monitor is the decisive one: node-cron's tick must land inside a
// one-second window, so a stall NAMED and TIMED tells us which cycle ate which
// minute without inferring it from which dispatch went missing.
// 500ms, not 5s. On a 2-core host a 500ms synchronous hold is already HALF a
// node-cron match window, so the interesting holds were all below the old
// threshold — only one cycle in the fleet ever crossed 5s. Raise it if the log
// turns noisy; the number that matters is the fraction of a one-second window.
const CRON_SLOW_MS = () => Number.parseInt(process.env.CRON_SLOW_MS || "", 10) || 500;
const LOOP_STALL_MS = () => Number.parseInt(process.env.LOOP_STALL_MS || "", 10) || 1_500;
// Reporting window for the lag distribution. Env-tunable so tests can drive it
// in milliseconds instead of waiting a minute.
const LOOP_LAG_WINDOW_MS = () => Number.parseInt(process.env.LOOP_LAG_WINDOW_MS || "", 10) || 60_000;

let cronInFlight = null;   // { name, startedAt } — the SYNCHRONOUS holder
const asyncInFlight = new Set();  // entries alive for the whole async lifetime
// Ring of recently-settled cycles. A cycle that blocks the loop finishes in a
// MICROTASK before the monitor's next macrotask tick, so by sample time it is
// already gone — "nothing in flight" is then true and useless. What the
// investigation needs is who ran DURING the gap, not who is running after it.
const recentlyRan = [];
function rememberRan(entry, finishedAt) {
  recentlyRan.push({ ...entry, finishedAt });
  if (recentlyRan.length > 30) recentlyRan.shift();
}

/** Derive a readable name once, at registration, from the callback source. */
function cronName(task, expression) {
  const src = String(task);
  const m = src.match(/=>\s*runDispatch\([^,]*,\s*"([^"]+)"/)   // runDispatch(fn, "label")
    || src.match(/=>\s*(?:runDispatch\(\s*\(\)\s*=>\s*)?([A-Za-z_][\w]*)/);
  return `${m ? m[1] : "anonymous"}@${expression}`;
}

/** Run `task` with in-flight attribution and duration measurement. */
function instrumented(name, task) {
    const startedAt = Date.now();
    const prev = cronInFlight;
    cronInFlight = { name, startedAt };
    // ALSO tracked for the whole ASYNC lifetime, not just the synchronous part.
    //
    // cronInFlight alone cleared the moment `task()` returned, so a cycle still
    // burning CPU inside .then() continuations reported as "nothing in flight" —
    // which is exactly what the 18.6-minute event said, and it pointed the
    // investigation at the host. With the scheduler measured at 103% CPU while
    // the worker idles, "nothing in flight" has to be able to name an async
    // cycle or it is worse than no attribution at all.
    const entry = { name, startedAt };
    asyncInFlight.add(entry);
    let out;
    try {
      out = task();
    } finally {
      // Everything up to the first await. This is the number that matters for
      // the timers: an async function that never yields blocks just as hard as
      // a sync one, and this measures what actually held the loop.
      const syncMs = Date.now() - startedAt;
      if (syncMs >= CRON_SLOW_MS()) {
        logger.warn(
          `🐌 cron ${name} held the event loop SYNCHRONOUSLY for ${syncMs}ms — ` +
          `any cron whose minute fell inside that window did not fire.`
        );
      }
      cronInFlight = prev;
    }
    if (out && typeof out.then === "function") {
      const settle = (verb) => {
        asyncInFlight.delete(entry);
        rememberRan(entry, Date.now());
        const totalMs = Date.now() - startedAt;
        if (totalMs >= CRON_SLOW_MS()) {
          logger.info(`⏳ cron ${name} ${verb} after ${totalMs}ms`);
        }
      };
      out.then(() => settle("finished"), (err) => {
        settle("FAILED");
        logger.error(`❌ cron ${name} rejected: ${err?.message || err}`);
      });
    } else {
      asyncInFlight.delete(entry);
      rememberRan(entry, Date.now());
    }
    return out;
}

/**
 * Who to blame for a gap spanning [gapStart, now].
 *
 * In-flight first, then anything that OVERLAPPED the gap and has since settled.
 * Only if both are empty is "nothing in flight" a real answer — and then it
 * means the process genuinely was not executing our code.
 */
function describeInFlight(now, gapStart = now) {
  if (cronInFlight) return `${cronInFlight.name} (synchronous, ${now - cronInFlight.startedAt}ms)`;
  const open = [...asyncInFlight].sort((a, b) => a.startedAt - b.startedAt);
  if (open.length) return open.map((e) => `${e.name} (async, ${now - e.startedAt}ms)`).join(", ");
  const overlapped = recentlyRan.filter((e) => e.finishedAt >= gapStart && e.startedAt <= now);
  if (overlapped.length) {
    return overlapped
      .map((e) => `${e.name} (ran during the gap, ${e.finishedAt - e.startedAt}ms)`)
      .join(", ");
  }
  return "nothing in flight and nothing ran during the gap";
}

function scheduleCron(expression, task) {
  const name = cronName(task, expression);
  const scheduledTask = cron.schedule(expression, () => instrumented(name, task));
  schedulerTasks.push(scheduledTask);
  registeredCrons.push({ name, expression });
  return scheduledTask;
}

/** Every cron registered in this process, for the boot summary and ops. */
const registeredCrons = [];
export function listRegisteredCrons() {
  return registeredCrons.map((c) => ({ ...c }));
}

/**
 * Event-loop lag monitor.
 *
 * A 1s interval that measures how late it actually ran. node-cron needs the
 * loop punctual to within a second; anything past LOOP_STALL_MS means some cron
 * window was missed, and `cronInFlight` names the culprit rather than leaving it
 * to be inferred from which dispatch went quiet.
 */
let lagMonitor = null;

/**
 * DISTRIBUTION, NOT JUST EXCURSIONS. The first version of this logged only
 * lag ≥ LOOP_STALL_MS (1500ms) and reported exactly one stall in 90 minutes
 * while nearly every cron was missing most of its ticks — because the fatal
 * zone sits FAR BELOW that threshold and a steady lag never trips it.
 *
 * Measured against node-cron 3.0.3 directly:
 *   ~15ms steady lag  → every pattern fires
 *   ~65ms steady lag  → a pattern already down to 83%
 *   ~2000ms steady    → ZERO firings, every pattern
 *
 * So a constant 1.2s lag is invisible to a 1.5s excursion alarm and lethal to a
 * one-second match window. p50 is the number that decides whether crons fire;
 * the max only says whether anything dramatic happened.
 *
 * PHASE DRIFT is the derived number that actually answers the question. Each
 * tick is re-armed at a fixed 1000ms AFTER the work, so every millisecond of
 * lag advances the phase permanently. Summed over a minute it gives the seconds
 * of wall clock the tick sequence skipped — and any cron whose one-second window
 * falls in a skipped second does not fire. Drift ≥1s/min means ticks are being
 * lost continuously, whatever the max says.
 */
const heapLimitBytes = v8.getHeapStatistics().heap_size_limit;

function startLoopLagMonitor() {
  if (lagMonitor) return;
  let expected = Date.now() + 1000;
  let samples = [];
  let windowStart = Date.now();
  let lastCpu = process.cpuUsage();

  const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;

  lagMonitor = setInterval(() => {
    const now = Date.now();
    const lateBy = Math.max(0, now - expected);
    expected = now + 1000;
    samples.push(lateBy);

    if (lateBy >= LOOP_STALL_MS()) {
      // ─── FREEZE vs LAG: measured, not guessed ─────────────────────────────
      //
      // These are different events and were being reported as one. A 1,114,844ms
      // "stall" with 15 samples in 1130s is not a late timer — the process was
      // not running at all. Calling that "event loop stalled" points the
      // investigation inward, at code, when nothing in the process was executing.
      //
      // CPU TIME IS THE DISCRIMINATOR. process.cpuUsage() counts only time this
      // process was actually ON a core:
      //   Δcpu ≈ Δwall  → the process BURNED the time. Ours. Look at the code.
      //   Δcpu ≈ 0      → the process was NOT SCHEDULED. Not ours. Look at the
      //                   host: CPU contention from a sibling container, swap,
      //                   cgroup throttling, or a hypervisor steal.
      const cpu = process.cpuUsage();
      const cpuDeltaMs = ((cpu.user - lastCpu.user) + (cpu.system - lastCpu.system)) / 1000;
      // Against TOTAL elapsed wall time, not the excess. `lateBy` is only the
      // overshoot past the 1000ms interval, so dividing by it reported 225% for
      // a plainly CPU-bound block and would have mis-set the freeze threshold.
      const elapsedMs = lateBy + 1000;
      const onCpuPct = Math.round((cpuDeltaMs / elapsedMs) * 100);
      const missedTicks = Math.max(0, Math.round(lateBy / 1000) - 1);
      const culprit = describeInFlight(now, now - lateBy);

      if (onCpuPct < 10) {
        logger.error(
          `🧊 PROCESS FROZEN for ${(lateBy / 1000).toFixed(1)}s — ${missedTicks} one-second ticks never ran. ` +
          `This process used only ${cpuDeltaMs.toFixed(0)}ms of CPU across ${(elapsedMs / 1000).toFixed(1)}s (${onCpuPct}%), so it was ` +
          `NOT SCHEDULED rather than busy: nothing in this process caused it. Look at host CPU contention ` +
          `(a sibling container mid-render), swap, or cgroup throttling. In flight: ${culprit}.`
        );
      } else {
        logger.error(
          `🚨 EVENT LOOP STALLED ${lateBy}ms (${onCpuPct}% of it on CPU — this process burned it) — ` +
          `${missedTicks} cron tick(s) missed. In flight: ${culprit}.`
        );
      }
    }
    lastCpu = process.cpuUsage();

    if (now - windowStart >= LOOP_LAG_WINDOW_MS()) {
      const sorted = [...samples].sort((a, b) => a - b);
      const windowMs = now - windowStart;
      const driftMs = samples.reduce((a, b) => a + b, 0);
      // NORMALISED so the threshold means the same thing whatever the window
      // length — an absolute drift budget silently changes meaning when the
      // window does, which is its own class of measurement bug.
      const driftPerMin = driftMs / (windowMs / 60_000);
      // A 1s sampler should produce ~1 sample per second. Far fewer means the
      // process was NOT RUNNING for the difference — a freeze, not lag. The
      // shortfall is stated rather than left to be noticed in the ratio.
      const expectedSamples = Math.round(windowMs / 1000);
      const missed = Math.max(0, expectedSamples - samples.length);
      const mem = process.memoryUsage();
      const heapPct = Math.round((mem.heapUsed / heapLimitBytes) * 100);
      const line =
        `📊 loop lag ${samples.length}/${expectedSamples} samples in ${Math.round(windowMs / 1000)}s: ` +
        `p50=${pct(sorted, 0.5)}ms p95=${pct(sorted, 0.95)}ms max=${sorted.at(-1)}ms · ` +
        `phase drift ${(driftPerMin / 1000).toFixed(1)}s/min` +
        ` · rss ${Math.round(mem.rss / 1048576)}MB heap ${Math.round(mem.heapUsed / 1048576)}/` +
        `${Math.round(heapLimitBytes / 1048576)}MB (${heapPct}%)` +
        (missed > expectedSamples * 0.1
          ? ` · ⚠️ ${missed} SAMPLES MISSING — the process was frozen, not merely late`
          : "") +
        // A heap near its limit means continuous major GCs: high CPU, long
        // pauses, and the process is fully ON-CPU throughout — so the cpuUsage
        // discriminator would say "we burned it" and still not say why.
        (heapPct >= 85 ? ` · 🔥 HEAP AT ${heapPct}% OF LIMIT — GC thrash burns a core and freezes the loop` : "");
      // ≥1s of drift per minute means the tick sequence is skipping whole
      // seconds continuously, so one-second cron windows are being lost.
      if (driftPerMin >= 1000) {
        logger.warn(
          `${line} — AT THIS DRIFT CRON WINDOWS ARE BEING LOST. node-cron re-arms at a fixed ` +
          `1000ms and matches an exact second; ~${Math.round(driftMs / 1000)} second(s) of wall ` +
          `clock went unobserved this minute.`
        );
      } else {
        logger.info(line);
      }
      samples = [];
      windowStart = now;
    }
  }, 1000);
  lagMonitor.unref?.();
}

function stopLoopLagMonitor() {
  if (lagMonitor) { clearInterval(lagMonitor); lagMonitor = null; }
}

// Instrumented for the same reason scheduleCron is: a boot pulse that blocks
// the loop reported as "nothing in flight", because only cron callbacks set
// cronInFlight. An uninstrumented timer is an unattributable stall.
function scheduleTimer(task, delayMs) {
  const name = cronName(task, `+${Math.round(delayMs / 1000)}s`);
  const timer = setTimeout(() => instrumented(name, task), delayMs);
  schedulerTimers.push(timer);
  return timer;
}

export function startScheduler() {
  if (schedulerStarted) {
    logger.warn("⏰ Scheduler already started in this process");
    return false;
  }

  schedulerStarted = true;
  // Armed BEFORE any cron registers, so a stall during startup is caught too.
  startLoopLagMonitor();
  logger.info("⏰ Scheduler initialized — 30 min news, 60 min video, 15 min enrich, 60 min events, 2 AM video gen");
  runDispatch(() => dispatchIngestionCycle(), "news ingestion");
  runDispatch(() => dispatchVideoCycle(), "video ingestion");
  scheduleTimer(() => runDispatch(() => dispatchEnrichCycle({ batchSize: 40, concurrency: 4 }), "article enrichment"), 60_000);
  // Delay first events pass — it needs some ingested articles to work with.
  scheduleTimer(() => runDispatch(() => dispatchEventsCycle(), "events refresh (boot)"), 90_000);
  // Delay first analysis pass — 5 min after startup, needs ingested articles.
  scheduleTimer(() => runDispatch(() => dispatchAnalysisCycle(), "analysis refresh (boot)"), 5 * 60 * 1000);
  // ─── MINUTE OFFSETS ARE LOAD-BEARING — read this before changing one ──────
  //
  // Every dispatch cron below sits on a minute that carries NO in-process work.
  // That is not aesthetic. node-cron 3.0.3 re-arms each task with a fixed
  // setTimeout(…, 1000) AFTER the callback returns and matches on an exact
  // one-second window, so a cron sharing its minute with a cycle that blocks
  // the event loop has its own tick pushed out of that window — permanently,
  // because the drift accumulates and never self-corrects. Measured: at a ~3s
  // effective tick period EVERY pattern fires zero times.
  //
  // The collision that caused the 43h ingestion outage (verified in prod: 18h of
  // logs, video autopost 18/18, everything else 0):
  //
  //   :00  ingestion + video-ingestion + enrichment dispatches, AND
  //        runEventsCycle + runAnalysisCycle + runPolymarketCycle + runUsgsCycle
  //   :30  ingestion + enrichment dispatches, AND analysis + polymarket + usgs
  //   :15  social + enrichment dispatches, AND polymarket
  //   :45  social + enrichment dispatches, AND polymarket
  //   :07  video autopost — the ONLY dispatch with no heavy neighbour. Survived.
  //
  // Those four heavy cycles now run in the WORKER, so the collision is gone at
  // the root. These offsets are the second layer: they keep dispatches off every
  // minute occupied by the ~19 in-process crons that remain in this process.
  //
  // Minutes with NO hourly in-process cron, computed from this file:
  //   1,2,6,9,11,12,17,22,25,26,28,31,32,36,39,42,47,52,53,55,56,57,58,59
  // If you move a cron here, recompute that set — scheduler.cronCollision.test.js
  // asserts the invariant and will fail you rather than let it drift.
  scheduleCron("2,32 * * * *",  () => runDispatch(() => dispatchIngestionCycle(), "news ingestion"));
  // Social posting, INDEPENDENT of ingestion. Offset to 15/45 rather than 0/30
  // so it runs a quarter-hour after ingestion normally lands — fresh articles
  // are available when it selects — while remaining completely unaffected if
  // that ingestion tick failed, hung, or never dispatched at all. The adapters'
  // own minIntervalMs still decides whether any platform actually posts.
  if (String(process.env.ENABLE_AUTO_SOCIAL ?? "true").toLowerCase() !== "false") {
    // 15,45 is clear ONLY because runPolymarketCycle moved to the worker — it
    // used to sit here and is what took social down. Not 17,47: minute 17
    // carries runWelcomeSequenceCycle, which the first pass of this map missed.
    scheduleCron("15,45 * * * *", () => runDispatch(() => dispatchSocialCycle(), "social posting"));
    logger.info(`📣 Social posting cron registered (15,45 — independent of ingestion) — platforms=${listEnabledPlatforms().length}`);
  } else {
    logger.info("📣 Social posting cron NOT registered (ENABLE_AUTO_SOCIAL=false)");
  }
  // ─── X text posts ───────────────────────────────────────────────────────
  //
  // OUTSIDE the ENABLE_AUTO_SOCIAL block, and that placement is the whole
  // point of this line existing separately. It was first written just below the
  // social cron, inside that conditional — and ENABLE_AUTO_SOCIAL=false in
  // production, so it silently never registered. The boot log said "38 crons
  // registered" and this was not among them.
  //
  // ENABLE_AUTO_SOCIAL governs the article-card social publisher, which is a
  // different system with different credentials and its own reasons for being
  // off. X text posting has its own switch, X_TEXT_POST_ENABLED, checked inside
  // the cycle. One feature, one gate.
  //
  // :10 and :40 — two of the seven free minutes in the hour, chosen by
  // enumerating every registered cron. The first attempt was :05/:35, which the
  // collision guard rejected for sharing with runWatchlistPushCycle: a dispatch
  // cron sharing a minute with in-process work is how ingestion died for 43
  // hours.
  scheduleCron("10,40 * * * *", () => runDispatch(() => dispatchXTextCycle(), "x text posts"));
  scheduleCron("9 * * * *",     () => runDispatch(() => dispatchVideoCycle(), "video ingestion"));
  scheduleCron("6,22,36,52 * * * *", () => runDispatch(() => dispatchEnrichCycle({ batchSize: 40, concurrency: 4 }), "article enrichment"));
  scheduleCron("28 * * * *",   () => runDispatch(() => dispatchEventsCycle(), "events refresh"));
  scheduleCron("25,55 * * * *", () => runDispatch(() => dispatchAnalysisCycle(), "analysis refresh")); // 30-min cadence preserved
  // ─── Video generation crons (in-process) ───────────────────────────────
  // Disabled in production because Hostinger Cloud Hosting blocks subprocess
  // execution at the kernel level (RLIMIT_NPROC). Rendering is delegated to
  // the GitHub Actions workflow at .github/workflows/render-videos.yml,
  // which calls /scoop-ops/videos-gen/next-batch + /upload over HTTP.
  //
  // Set ENABLE_INPROCESS_VIDEO_CRON=true to re-enable these on a host that
  // allows spawn() (any VPS, Docker, local dev, etc.).
  // ─── Video autopost (§6.1) — the scheduler ENQUEUES, the worker renders ──
  // Hourly, not four fixed slots. The two gates inside the cycle (rolling-24h
  // cap, 4.8h spacing) decide whether this tick actually publishes, so a slot
  // missed at 14:00 is simply retried at 15:00 rather than lost for the day.
  // QUEUE_NAMES.videoRender, never QUEUE_NAMES.video — that one is YouTube
  // ingestion and a job on it would run fetchAllYouTube instead.
  // :39 — MOVED FROM :12 (2026-08-13). :12 carried dispatchUsgsCycle in the same
// minute, and :13 fires dispatchEventPromoterCycle, whose cycle blocks the
// worker's event loop for a MEASURED 10,245ms. A render starting at :12 was
// therefore mid-flight, holding a 30s lock renewed every 15s, when a 10.2s
// block landed — which is what produced "could not renew lock" every cycle.
//
// :39 chosen from the full 60-minute occupancy map, not by eye:
//   - nothing at all is registered on :39, so it also satisfies the
//     no-dispatch-shares-a-minute-with-an-in-process-cron invariant
//   - :37-:41 is the longest run carrying NO worker-bound dispatch, so a
//     one-to-three-minute render has the worker's loop largely to itself
//   - 4 minutes clear of the :43 promoter block, and its tail lands on
//     polymarket/usgs rather than on ingestion, which is the heaviest worker job
// Candidates rejected: :10 and :40 (1-2 free minutes), :31 (:32 is ingestion),
// :58 (3 free minutes and further from the promoter, but its tail runs into
// ingestion at :02 and :00 carries ten daily crons).
scheduleCron("39 * * * *", () => runDispatch(() => dispatchVideoRenderCycle(), "video autopost"));
  logger.info(`🎬 Video autopost cron registered (hourly; gates decide) — enabled=${process.env.VIDEO_AUTOPOST_ENABLED === "1"}`);

  // LONG-FORM: every six hours at :53, not hourly.
  //
  // The cap is 3 films a WEEK, so 24 firings a day would be 165 cheap refusals
  // for every film — the gates would work correctly and the log would be
  // noise. Four a day is already far more opportunity than the cap can use,
  // and it still catches a freed slot within six hours.
  //
  // :53 is one of only five minutes not already claimed (31, 53, 56, 58, 59);
  // :31 and :58 are rejected above for their own reasons, and :53 keeps the
  // ~10-minute render clear of the :00 daily-cron block. The contention guard
  // inside the cycle is what actually protects the shorts loop — this choice
  // just avoids starting in a crowd.
  scheduleCron("53 */6 * * *", () => runDispatch(() => dispatchLongformCycle(), "longform film"));
  logger.info(`🎬 Long-form cron registered (every 6h; gates decide) — enabled=${process.env.LONGFORM_AUTOPOST_ENABLED === "1"}`);

  const inProcessVideoEnabled = String(process.env.ENABLE_INPROCESS_VIDEO_CRON || "").toLowerCase() === "true";
  if (inProcessVideoEnabled) {
    scheduleCron("0 2 * * *",   () => runVideoGenCycle({ batchSize: 3 }));
    scheduleCron("0 6 * * *",   () => runDailyRecapCycle());
    scheduleCron("0 */6 * * *", () => runLiveEventVideoCycle());
    logger.info("🎬 In-process video crons enabled (host supports spawn)");
  } else {
    logger.info("🎬 In-process video crons disabled — using GitHub Actions render worker via /scoop-ops/videos-gen/next-batch");
  }
  // Newsletter welcome sequence — runs hourly. Picks subscribers who are
  // due for d1/d3 follow-up emails. No-op when SMTP isn't configured.
  scheduleCron("17 * * * *", () => runWelcomeSequenceCycle({ maxPerStage: 50 }).catch(err =>
    logger.warn(`welcomeSequence cron failed: ${err.message}`)
  ));
  // ─── Source scoring cron (B.6.4a) ───────────────────────────────────────────
  // Weekly full-corpus re-score (methodology §6.2). REGISTERED BUT DISABLED by
  // default — set SCORING_CRON_ENABLED=true to activate, and only after the scoring
  // migrations 006/007 are applied in the target env (#112). Never auto-fires.
  if (String(process.env.SCORING_CRON_ENABLED || "").toLowerCase() === "true") {
    scheduleCron("0 3 * * 0", () => runScoringJob().catch(err =>
      logger.warn(`scoring cron failed: ${err.message}`)
    ));
    logger.info("🧮 Source scoring cron ENABLED (weekly, Sun 03:00)");
  } else {
    logger.info("🧮 Source scoring cron registered but DISABLED (set SCORING_CRON_ENABLED=true to activate)");
  }
  // ─── Entity IDF recompute (step 2b) ─────────────────────────────────────────
  // Daily rolling-window rarity weights for entity matching. DISABLED by default
  // (set ENTITY_IDF_ENABLED=true) — prod-neutral until the matcher (step 3) reads it.
  if (String(process.env.ENTITY_IDF_ENABLED || "").toLowerCase() === "true") {
    scheduleCron("30 3 * * *", () => runEntityIdfRecompute().catch(err =>
      logger.warn(`entity IDF recompute failed: ${err.message}`)
    ));
    logger.info("📐 Entity IDF recompute cron ENABLED (daily, 03:30)");
  }
  // Daily digest at 07:00 server time — no-op if SMTP is not configured.
  scheduleCron("0 7 * * *", async () => {
    try {
      await sendDailyDigest();
    } catch (err) {
      logger.error("❌ Digest failed", { error: err.message });
    }
  });
  // X-posting queue digest at 09:00 UTC (Phase B Sprint 2.x.2). Emails the
  // X-ready posts queued by Sprint 2.x.1 to DIGEST_RECIPIENT_EMAIL. No-op
  // when SMTP / DIGEST_RECIPIENT_EMAIL unset or the queue is empty.
  scheduleCron("0 9 * * *", async () => {
    try {
      await sendXPostDigest();
    } catch (err) {
      logger.error("❌ X-digest failed", { error: err.message });
    }
  });
  // X-Posting Queue stale sweep at 02:00 UTC (Phase B Sprint 2.x.2b).
  // Marks pending rows older than 24h as 'rejected' so the queue stays
  // bounded and the 09:00 X-digest only sees fresh candidates. Runs BEFORE
  // the 03:00 article prune (article cascade-deletes wouldn't otherwise
  // affect sweep correctness, but earlier placement keeps the day's
  // queue-related work contiguous) and BEFORE the 09:00 X-digest.
  scheduleCron("0 2 * * *", async () => {
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const n = rejectStalePending(cutoff);
      if (n > 0) logger.info(`🧹 X-queue stale sweep: rejected ${n} pending older than 24h`);
    } catch (err) {
      logger.error("❌ X-queue stale sweep failed", { error: err.message });
    }
  });
  scheduleCron("0 3 * * *", async () => {
    logger.info("🧹 Pruning...");
    const n = pruneOldArticles(7);
    logger.info(`🧹 Pruned ${n} records`);
    // IMMEDIATELY AFTER, and the ordering is the point: the articles are gone as
    // of this line, so "card whose article no longer exists" is exactly the
    // 7-day rule rather than an approximation needing its own cutoff.
    //
    // Nothing had ever deleted a card — 36k files and 34GB in about a month,
    // because every CARD_DESIGN_VER bump orphans the previous generation. Its
    // own failure must not take the article prune's result down with it.
    try {
      logger.info(formatSweep(sweepCards(CARDS_DIR, { daysToKeep: 7 })));
    } catch (err) {
      logger.error("🧹 card sweep failed", { error: err.message });
    }
  });
  scheduleCron("35 4 * * *", async () => {
    try {
      runDatabaseMaintenance();
    } catch (err) {
      logger.warn(`database maintenance failed: ${err.message}`);
    }
  });

  // YouTube video metrics sync — runs at 14:00 daily (8h after typical upload
  // at 06:00 UTC, when views should show at least a few dozen data points).
  // Updates video_metrics + bubbles engagement signal into article ranking.
  scheduleCron("0 14 * * *", async () => {
    if (!isYouTubeConfigured()) return;
    try { await syncVideoMetrics(); } catch (err) {
      logger.warn(`video metrics sync failed: ${err.message}`);
    }
  });

  // ─── Short-form video publish cycle ─────────────────────────────────────
  // Auto-approves rendered video jobs that meet quality criteria
  // (cred ≥ 8, fresh, non-tragedy) and publishes the resulting
  // 'review_approved' jobs to YouTube Shorts / IG Reels / FB Reels / TikTok.
  // Auto-approval is opt-in via VIDEO_AUTO_APPROVE=1; without it, only
  // human-approved jobs are picked up. Publishing only requires outbound
  // HTTPS (works on Hostinger even when in-process rendering is blocked).
  // Runs every 90 minutes — frequent enough to surface fresh stories,
  // sparse enough to stay well within IG/FB rate limits and avoid spam
  // flags (Meta has flagged accounts pushing 8+ videos/day).
  scheduleCron("23 */1 * * *", () => runVideoPublishCycle().catch(err =>
    logger.warn(`videoPublish cron failed: ${err.message}`)
  ));

  // ─── Reality Index — Phase 1 crons ──────────────────────────────────────
  // Polymarket fetch-and-snapshot every 15 min. Disable with
  // ENABLE_REALITY_INDEX=false (e.g. on a cold deploy you don't want chatty).
  if (String(process.env.ENABLE_REALITY_INDEX ?? "true").toLowerCase() !== "false") {
    scheduleCron("11,26,42,57 * * * *", () => runDispatch(() => dispatchPolymarketCycle(), "polymarket sync"));
    scheduleCron("7,37 * * * *", () => runMarketMatcherCronCycle());       // every 30 min, offset
    scheduleCron("0 4 * * *",    () => runSnapshotDownsamplerCycle());     // daily 4 AM
    // Phase 2 — Event Tracker
    scheduleCron("13,43 * * * *", () => runDispatch(() => dispatchEventPromoterCycle(), "event promoter")); // 30 min, offset
    // Sprint 1.3.4 — Tracker Auto-Detection Engine. Runs 3 min after the
    // eventPromoter cron so promoted events are fresh when the detector
    // evaluates per-template triggers. Independent of timeline+actors below.
    scheduleCron("16,46 * * * *", () => runTrackerDetectorCronCycle());     // every 30 min, +3 offset from eventPromoter
    scheduleCron("19 * * * *",    () => runEventTimelineBuilderCycle());   // every 1 hr
    scheduleCron("49 * * * *",    () => runActorExtractorCycle());         // every 1 hr, offset
    // Phase 3 — Sentiment + Composite + Anomalies
    scheduleCron("21,51 * * * *", () => runDispatch(() => dispatchRealityIndexComposeCycle(), "reality index compose")); // 30 min, offset
    scheduleCron("27 * * * *",    () => runSentimentScoreCycle());         // every 1 hr
    scheduleCron("3,18,33,48 * * * *", () => runAnomalyScanCycle());       // every 15 min
    // Phase 4c — Watchlist push fan-out (runs 2 min after each anomaly scan
    // so newly-detected alerts are dispatched promptly to watching users).
    scheduleCron("5,20,35,50 * * * *", () => runWatchlistPushCycle());     // every 15 min, +2m offset
    // Phase 5 — GDELT global news multiplier. New articles inserted here flow
    // through the same cluster→event→matcher pipeline as RSS-ingested ones.
    scheduleCron("8,38 * * * *",       () => runGdeltCycle());             // every 30 min, between RSS ticks
    // Phase 5 — USGS significant-earthquakes feed → events with geo_lat/lng
    scheduleCron("1,12,22,32,42,52 * * * *", () => runDispatch(() => dispatchUsgsCycle(), "usgs sync")); // 10-min cadence preserved
    // Phase 5 — NOAA active weather alerts (Severe + Extreme) → events
    scheduleCron("4,14,24,34,44,54 * * * *", () => runNoaaCycle());          // every 10 min, +4 offset
    // Phase 5 — ACLED conflict events (last 24h, ≥1 fatality) → events.
    scheduleCron("33 */6 * * *",       () => runAcledCycle());               // every 6h
    // Phase 5 — FRED macro series (rates, CPI, unemployment, oil, VIX, etc.)
    scheduleCron("17 */6 * * *",       () => runFredCycle());                // every 6h
    // World Bank — annual indicators per country, daily refresh (slow source).
    scheduleCron("9 5 * * *",          () => runWorldBankCycle());           // daily at 05:09
    // Phase 5 — TheSportsDB soccer fixtures (today + tomorrow, free tier).
    scheduleCron("13 */3 * * *",       () => runSportsdbCycle());            // every 3 hours
    // Phase 5 — TMDB trending movies + TV (requires TMDB_API_KEY).
    scheduleCron("27 */6 * * *",       () => runTmdbCycle());                // every 6 hours
    // Phase 6 — synthetic market question extractor (LLM, drafts only).
    scheduleCron("47 */6 * * *",       () => runSyntheticExtractCycle());    // every 6h, +30m offset from FRED
    // Phase 6 — AI trader agents (skeptic/optimist/contrarian) keep markets lively.
    scheduleCron("23 * * * *",         () => runAiAgentsCronCycle());        // every 1h
    // Phase 6.5 — LLM outcome resolver (drafts only; admin confirms via UI).
    scheduleCron("41 * * * *",         () => runOutcomeResolverCronCycle()); // every 1h, +18 offset
    // Phase 3 leftover — bayesianUpdater attributes market moves to the article
    // most likely to have caused them. Runs hourly, +29m offset.
    scheduleCron("29 * * * *",         () => runBayesianUpdaterCycle());     // every 1h



    // Phase 4 leftover — Analyst briefs (drafts only). Every 4h on the 23rd
    // minute. Generator emits status='draft'; editor approves manually in
    // /scoop-ops/briefs (plan §5J — no auto-promotion in v1).
    scheduleCron("23 */4 * * *",       () => runAnalystBriefCycleWrapped());
    // First run shortly after boot — Polymarket cold start.
    scheduleTimer(() => runDispatch(() => dispatchPolymarketCycle(), "polymarket sync (boot)"), 30_000);
    scheduleTimer(() => runMarketMatcherCronCycle(), 5 * 60 * 1000);
    scheduleTimer(() => runDispatch(() => dispatchEventPromoterCycle(), "event promoter (boot)"), 8 * 60 * 1000);
    // Sprint 1.3.4 — Tracker Detector first run ~11 min after boot, between
    // eventPromoter's 8-min boot pulse and the next on-the-hour :16 cron tick.
    scheduleTimer(() => runTrackerDetectorCronCycle(), 11 * 60 * 1000);
    scheduleTimer(() => runDispatch(() => dispatchRealityIndexComposeCycle(), "reality index compose (boot)"), 9 * 60 * 1000);
    scheduleTimer(() => runGdeltCycle(), 2 * 60 * 1000);                       // first GDELT pull 2 min after boot
    logger.info("🧠 Reality Index crons scheduled (polymarket 15m, matcher 30m, eventPromoter 30m, trackerDetector 30m, timeline+actors hourly, downsample daily, sentiment hourly, RI compose 30m, anomaly 15m, watchlist-push 15m, GDELT 30m)");
  } else {
    logger.info("🧠 Reality Index crons disabled via ENABLE_REALITY_INDEX=false");
  }

  // AUTHORITATIVE REGISTRATION MANIFEST. Reading which crons fired by MINUTE is
  // ambiguous — five minutes carry two dispatch crons each, so ":22 fired" can
  // mean enrichment, usgs, or one of the two. This prints name@expression for
  // every registration, so the boot log answers "was it registered?" and the
  // per-tick lines answer "did it fire?" without either being inferred.
  logger.info(`⏰ ${registeredCrons.length} crons registered: ${registeredCrons.map((c) => `${c.name}`).join(" | ")}`);

  updateNextRun();
  return true;
}

export function stopScheduler() {
  if (!schedulerStarted) return false;

  for (const task of schedulerTasks.splice(0)) {
    try { task.stop(); } catch {}
    try { task.destroy?.(); } catch {}
  }
  for (const timer of schedulerTimers.splice(0)) {
    clearTimeout(timer);
  }

  if (lagMonitor) { clearInterval(lagMonitor); lagMonitor = null; }
  registeredCrons.length = 0;
  schedulerStarted = false;
  nextRun = null;
  logger.info("⏹️ Scheduler stopped");
  return true;
}

// ─── Reality Index cycles ──────────────────────────────────────────────────

export async function runPolymarketCycle() {
  if (isPolymarketRun) { logger.warn("⏸️ Polymarket cycle already running"); return null; }
  isPolymarketRun = true;
  lastPolymarketRun = new Date().toISOString();
  try {
    const out = await syncPolymarketMarkets({ activeOnly: true });
    return out;
  } catch (err) {
    logger.error("❌ Polymarket cycle failed", { error: err.message });
    return null;
  } finally {
    isPolymarketRun = false;
  }
}

async function runMarketMatcherCronCycle() {
  if (isMatcherRun) { logger.warn("⏸️ Market matcher already running"); return null; }
  isMatcherRun = true;
  lastMatcherRun = new Date().toISOString();
  try {
    return await runMarketMatcherCycle();
  } catch (err) {
    logger.error("❌ Market matcher failed", { error: err.message });
    return null;
  } finally {
    isMatcherRun = false;
  }
}

async function runSnapshotDownsamplerCycle() {
  try { return await runSnapshotDownsampler(); }
  catch (err) { logger.error("❌ Snapshot downsampler failed", { error: err.message }); return null; }
}

export async function runEventPromoterCronCycle() {
  if (isEventPromoterRun) { logger.warn("⏸️ Event promoter already running"); return null; }
  isEventPromoterRun = true;
  try {
    const out = await runEventPromoter();
    // Curative breaker sweep (Phase 2) — post-promotion janitor that dissolves over-merged events to
    // convergence. Behind EVENT_BREAKER_ENABLED (default OFF) → when off this is a no-op and the cycle
    // is byte-identical to before. keep-core preserves dossier ids/slugs across the dissolution.
    if (String(process.env.EVENT_BREAKER_ENABLED ?? "false").toLowerCase() === "true") {
      try { runEventBreakerSweep({}); }
      catch (e) { logger.error("❌ Event breaker sweep failed", { error: e.message }); }
    }
    lastEventPromoterRun = Date.now();
    return out;
  } catch (err) {
    logger.error("❌ Event promoter failed", { error: err.message });
    return null;
  } finally {
    isEventPromoterRun = false;
  }
}

// Sprint 1.3.4 — production cron wrapper for the Tracker Auto-Detection
// Engine. Fires every 30 minutes at :16 and :46 (after eventPromoter at
// :13/:43 so events are fresh) plus a boot pulse ~11 min after server start.
// runTrackerDetector itself is synchronous; the async wrapper preserves the
// scheduler's await pattern and the is-already-running guard. Per the
// engine's design (Sprint 1.3.2-3b), the detector iterates over recent
// events, applies per-template triggers, dedups via (event_id, template_type)
// at the composer, and creates tracker_instances via the Sprint 1.2 DAO.
async function runTrackerDetectorCronCycle() {
  if (isTrackerDetectorRun) { logger.warn("⏸️ Tracker detector already running"); return null; }
  isTrackerDetectorRun = true;
  try {
    const out = runTrackerDetector();
    lastTrackerDetectorRun = Date.now();
    return out;
  } catch (err) {
    logger.error("❌ Tracker detector failed", { error: err.message });
    return null;
  } finally {
    isTrackerDetectorRun = false;
  }
}

async function runEventTimelineBuilderCycle() {
  try { return await runEventTimelineBuilder(); }
  catch (err) { logger.error("❌ Event timeline builder failed", { error: err.message }); return null; }
}

async function runActorExtractorCycle() {
  if (isActorRun) { logger.warn("⏸️ Actor extractor already running"); return null; }
  isActorRun = true;
  try { return await runEventActorExtractor(); }
  catch (err) { logger.error("❌ Actor extractor failed", { error: err.message }); return null; }
  finally { isActorRun = false; }
}

// ─── Phase 3 cycles ────────────────────────────────────────────────────────
// All cheap (no LLM in hot path); guarded by run-locks to prevent overlap.
let isSentimentRun = false;
let isRealityComposeRun = false;
let isAnomalyRun = false;
let lastSentimentRun = null;
let lastRealityComposeRun = null;
let lastAnomalyRun = null;

async function runSentimentScoreCycle() {
  if (isSentimentRun) { logger.warn("⏸️ Sentiment cycle already running"); return null; }
  isSentimentRun = true;
  lastSentimentRun = new Date().toISOString();
  try { return await runSentimentCycle(); }
  catch (err) { logger.error("❌ Sentiment cycle failed", { error: err.message }); return null; }
  finally { isSentimentRun = false; }
}

export async function runRealityIndexComposeCycle() {
  if (isRealityComposeRun) { logger.warn("⏸️ RI compose already running"); return null; }
  isRealityComposeRun = true;
  lastRealityComposeRun = new Date().toISOString();
  try {
    runMediaSentimentForActiveEvents();      // synchronous, no LLM, no network
    return runRealityIndexCycle();
  } catch (err) {
    logger.error("❌ RI compose failed", { error: err.message });
    return null;
  } finally { isRealityComposeRun = false; }
}

async function runAnomalyScanCycle() {
  if (isAnomalyRun) { logger.warn("⏸️ Anomaly scan already running"); return null; }
  isAnomalyRun = true;
  lastAnomalyRun = new Date().toISOString();
  try { return runAnomalyDetector(); }
  catch (err) { logger.error("❌ Anomaly scan failed", { error: err.message }); return null; }
  finally { isAnomalyRun = false; }
}

let isWatchlistPushRun = false;
let lastWatchlistPushRun = null;
let isGdeltRun = false;
let lastGdeltRun = null;
let lastGdeltResult = null;
async function runWatchlistPushCycle() {
  if (isWatchlistPushRun) { logger.warn("⏸️ Watchlist push already running"); return null; }
  isWatchlistPushRun = true;
  lastWatchlistPushRun = new Date().toISOString();
  try { return await runWatchlistPushDispatcher(); }
  catch (err) { logger.error("❌ Watchlist push failed", { error: err.message }); return null; }
  finally { isWatchlistPushRun = false; }
}

async function runGdeltCycle() {
  if (isGdeltRun) { logger.warn("⏸️ GDELT cycle already running"); return null; }
  isGdeltRun = true;
  lastGdeltRun = new Date().toISOString();
  try {
    const out = await syncGdeltCycle();
    lastGdeltResult = out;
    return out;
  } catch (err) {
    logger.error("❌ GDELT cycle failed", { error: err.message });
    return null;
  } finally { isGdeltRun = false; }
}

let isBriefRun = false;
let lastBriefRun = null;
let lastBriefResult = null;
let isUsgsRun = false;
let lastUsgsRun = null;
let lastUsgsResult = null;
export async function runUsgsCycle() {
  if (isUsgsRun) { logger.warn("⏸️ USGS cycle already running"); return null; }
  isUsgsRun = true;
  lastUsgsRun = new Date().toISOString();
  try {
    const out = await syncUsgsCycle();
    lastUsgsResult = out;
    return out;
  } catch (err) {
    logger.error("❌ USGS cycle failed", { error: err.message });
    return null;
  } finally { isUsgsRun = false; }
}

let isNoaaRun = false;
let lastNoaaRun = null;
let lastNoaaResult = null;
async function runNoaaCycle() {
  if (isNoaaRun) { logger.warn("⏸️ NOAA cycle already running"); return null; }
  isNoaaRun = true;
  lastNoaaRun = new Date().toISOString();
  try {
    const out = await syncNoaaCycle();
    lastNoaaResult = out;
    return out;
  } catch (err) {
    logger.error("❌ NOAA cycle failed", { error: err.message });
    return null;
  } finally { isNoaaRun = false; }
}

let isAcledRun = false;
let lastAcledRun = null;
let lastAcledResult = null;
async function runAcledCycle() {
  if (isAcledRun) { logger.warn("⏸️ ACLED cycle already running"); return null; }
  isAcledRun = true;
  lastAcledRun = new Date().toISOString();
  try {
    const out = await syncAcledCycle();
    lastAcledResult = out;
    return out;
  } catch (err) {
    logger.error("❌ ACLED cycle failed", { error: err.message });
    return null;
  } finally { isAcledRun = false; }
}

let isFredRun = false;
let lastFredRun = null;
let lastFredResult = null;
async function runFredCycle() {
  if (isFredRun) { logger.warn("⏸️ FRED cycle already running"); return null; }
  isFredRun = true;
  lastFredRun = new Date().toISOString();
  try {
    const out = await syncFredCycle();
    lastFredResult = out;
    return out;
  } catch (err) {
    logger.error("❌ FRED cycle failed", { error: err.message });
    return null;
  } finally { isFredRun = false; }
}

let isWorldBankRun = false;
let lastWorldBankRun = null;
let lastWorldBankResult = null;
async function runWorldBankCycle() {
  if (isWorldBankRun) { logger.warn("⏸️ WB cycle already running"); return null; }
  isWorldBankRun = true;
  lastWorldBankRun = new Date().toISOString();
  try {
    const out = await syncWorldBankCycle();
    lastWorldBankResult = out;
    return out;
  } catch (err) {
    logger.error("❌ WB cycle failed", { error: err.message });
    return null;
  } finally { isWorldBankRun = false; }
}

let isSportsdbRun = false;
let lastSportsdbRun = null;
let lastSportsdbResult = null;
async function runSportsdbCycle() {
  if (isSportsdbRun) { logger.warn("⏸️ SportsDB cycle already running"); return null; }
  isSportsdbRun = true;
  lastSportsdbRun = new Date().toISOString();
  try {
    const out = await syncSportsdbCycle();
    lastSportsdbResult = out;
    return out;
  } catch (err) {
    logger.error("❌ SportsDB cycle failed", { error: err.message });
    return null;
  } finally { isSportsdbRun = false; }
}

let isTmdbRun = false;
let lastTmdbRun = null;
let lastTmdbResult = null;
async function runTmdbCycle() {
  if (isTmdbRun) { logger.warn("⏸️ TMDB cycle already running"); return null; }
  isTmdbRun = true;
  lastTmdbRun = new Date().toISOString();
  try {
    const out = await syncTmdbCycle();
    lastTmdbResult = out;
    return out;
  } catch (err) {
    logger.error("❌ TMDB cycle failed", { error: err.message });
    return null;
  } finally { isTmdbRun = false; }
}

let isAiAgentsRun = false;
let lastAiAgentsRun = null;
let lastAiAgentsResult = null;
let isOutcomeResolverRun = false;
let lastOutcomeResolverRun = null;
let lastOutcomeResolverResult = null;
async function runOutcomeResolverCronCycle() {
  if (isOutcomeResolverRun) { logger.warn("⏸️ Outcome resolver already running"); return null; }
  isOutcomeResolverRun = true;
  lastOutcomeResolverRun = new Date().toISOString();
  try {
    const out = await runOutcomeResolverCycle();
    lastOutcomeResolverResult = out;
    return out;
  } catch (err) {
    logger.error("❌ Outcome resolver failed", { error: err.message });
    return null;
  } finally { isOutcomeResolverRun = false; }
}

let isBayesianRun = false;
let lastBayesianRun = null;
let lastBayesianResult = null;
async function runBayesianUpdaterCycle() {
  if (isBayesianRun) { logger.warn("⏸️ Bayesian updater already running"); return null; }
  isBayesianRun = true;
  lastBayesianRun = new Date().toISOString();
  try {
    const out = runBayesianUpdater();
    lastBayesianResult = out;
    return out;
  } catch (err) {
    logger.error("❌ Bayesian updater failed", { error: err.message });
    return null;
  } finally { isBayesianRun = false; }
}

async function runAiAgentsCronCycle() {
  if (isAiAgentsRun) { logger.warn("⏸️ AI agents already running"); return null; }
  isAiAgentsRun = true;
  lastAiAgentsRun = new Date().toISOString();
  try {
    const out = runAiAgentsCycle();
    lastAiAgentsResult = out;
    return out;
  } catch (err) {
    logger.error("❌ AI agents failed", { error: err.message });
    return null;
  } finally { isAiAgentsRun = false; }
}

let isSyntheticExtractRun = false;
let lastSyntheticExtractRun = null;
let lastSyntheticExtractResult = null;
async function runSyntheticExtractCycle() {
  if (isSyntheticExtractRun) { logger.warn("⏸️ Synth extract already running"); return null; }
  isSyntheticExtractRun = true;
  lastSyntheticExtractRun = new Date().toISOString();
  try {
    const out = await runQuestionExtractor();
    lastSyntheticExtractResult = out;
    return out;
  } catch (err) {
    logger.error("❌ Synth extract failed", { error: err.message });
    return null;
  } finally { isSyntheticExtractRun = false; }
}
async function runAnalystBriefCycleWrapped() {
  if (isBriefRun) { logger.warn("⏸️ Brief cycle already running"); return null; }
  isBriefRun = true;
  lastBriefRun = new Date().toISOString();
  try {
    const out = await runAnalystBriefCycle();
    lastBriefResult = out;
    return out;
  } catch (err) {
    logger.error("❌ Brief cycle failed", { error: err.message });
    return null;
  } finally { isBriefRun = false; }
}

// Suppress unused-warning while exposing for ad-hoc /scoop-ops triggers later.
// runPolymarketCycle is exported at its declaration now (the worker imports it).
export { runMarketMatcherCronCycle, runSnapshotDownsamplerCycle, snapshotActiveMarkets,
         runTrackerDetectorCronCycle, runActorExtractorCycle,
         runSentimentScoreCycle, runAnomalyScanCycle,
         runWatchlistPushCycle, runGdeltCycle };

// Runs the auto-approve + publish pass. Safe to call as a cron tick — the
// underlying service already guards against missing platform config and
// returns a no-op when there are no jobs ready.
let isPublishRun = false;
let lastPublishRun = null;
let lastPublishResult = null; // stores the last cycle's approve+publish summary
export async function runVideoPublishCycle() {
  if (isPublishRun) { logger.warn("⏸️ Video publish cycle already running"); return null; }
  isPublishRun = true;
  lastPublishRun = new Date().toISOString();
  try {
    const out = await runVideoPublishAndApproveCycle({ approveLimit: 5, publishLimit: 3 });
    // Persist the last cycle result for health endpoint diagnostics.
    lastPublishResult = {
      at: lastPublishRun,
      approved:  out.autoApprove?.approved?.length  ?? null,
      skipped:   out.autoApprove?.skipped           ?? null,
      published: out.publish?.published             ?? 0,
      failed:    out.publish?.failed                ?? 0,
      reason:    out.publish?.reason                ?? null,
    };
    if (out.autoApprove?.approved?.length) {
      logger.info(`✅ Auto-approved ${out.autoApprove.approved.length} video jobs (${out.autoApprove.skipped.length} skipped)`);
    }
    if (out.autoApprove?.skipped?.length && !out.autoApprove.approved?.length) {
      // Every job was skipped — log why so it's visible in server logs.
      const reasons = out.autoApprove.skipped.map(s => `${s.jobId}:${s.reason}`).join(", ");
      logger.warn(`⏭️ Auto-approve skipped all ${out.autoApprove.skipped.length} ready jobs: ${reasons}`);
    }
    if (out.publish?.published) {
      logger.info(`📺 Published ${out.publish.published} videos to platforms (${out.publish.failed} failed)`);
    } else if (out.publish?.message === "no_approved_jobs") {
      // Quiet — most cycles will be no-ops and we don't need a log line each time.
    } else if (out.publish?.reason === "no_platform_configured") {
      // One-time warning so the user notices when set up is missing.
      logger.warn("📺 Video publish: no platform configured (set YouTube / Instagram / Facebook env vars)");
    }
    return out;
  } catch (err) {
    logger.error("❌ Video publish cycle failed", { error: err.message });
    return null;
  } finally {
    isPublishRun = false;
  }
}

export async function runEventsCycle() {
  if (isEventsRun) return;
  isEventsRun = true;
  lastEventsRun = new Date().toISOString();
  try {
    await refreshAllEvents();
  } catch (err) {
    logger.error("❌ Events refresh failed", { error: err.message });
  } finally {
    isEventsRun = false;
  }
}

export async function runAnalysisCycle() {
  if (isAnalysisRun) return;
  isAnalysisRun = true;
  lastAnalysisRun = new Date().toISOString();
  try {
    await refreshAnalysis();
  } catch (err) {
    logger.error("❌ Analysis refresh failed", { error: err.message });
  } finally {
    isAnalysisRun = false;
  }
}

export async function runEnrichCycle({ batchSize = 40, concurrency = 4 } = {}) {
  if (isEnrichRun) return;
  isEnrichRun = true;
  lastEnrichRun = new Date().toISOString();
  try {
    await enrichBatch({ batchSize, concurrency });
    // Entity-matching build STEP 1: extract article-body entities → article_entities.
    // Behind a flag, default OFF → production behavior unchanged. Tail step; never breaks enrich.
    if (String(process.env.ENTITY_EXTRACTION_ENABLED ?? "false").toLowerCase() === "true") {
      try {
        const stats = await runEntityExtractionBatch({ limit: parseInt(process.env.ENTITY_EXTRACTION_BATCH || "100", 10) });
        logger.info(`🔖 entity extraction — ${JSON.stringify(stats)}`);
      } catch (err) { logger.error("❌ Entity extraction failed", { error: err.message }); }
    }
  } catch (err) {
    logger.error("❌ Enrich failed", { error: err.message });
  } finally {
    isEnrichRun = false;
  }
}

export async function runIngestionCycle() {
  // The skip returns BEFORE any ping. A /start from an invocation that declined
  // to run would refresh the monitor while the wedged original is still stuck —
  // the same false-green the start/success pair exists to prevent.
  if (isRunning) { logger.warn("⏸️ News already running"); return; }
  isRunning = true;
  lastRun   = new Date().toISOString();
  logger.info(`🔄 News ingestion [${RSS_SOURCES.length} sources]`);
  pingStart(INGESTION_PING);
  try {
    const r = await fetchAllSources(RSS_SOURCES);
    logger.info(`📰 Done: +${r.totalNew} in ${r.duration}ms`);
    // Tail step: if a fresh high-credibility article landed, fan it out as a
    // push. Skipped silently if no candidate, in quiet hours, or push is
    // disabled. Errors here must not break the ingest cycle.
    //
    // DETACHED — deliberately NOT awaited. A broadcast to a handful of
    // subscribers must never be able to stall ingestion: this tail runs inside
    // THIS function's isRunning guard, and an unbounded webpush call held that
    // flag true until restart, killing RSS ingestion + social posting silently
    // for days. The push bounds itself (BREAKING_PUSH_TIMEOUT_MS) and records
    // its own outcome to the breaking_push heartbeat; nothing here waits on it.
    if (String(process.env.ENABLE_BREAKING_PUSH ?? "true").toLowerCase() !== "false") {
      startBreakingNewsPushDetached();
    }
    // SOCIAL IS NO LONGER A TAIL STEP HERE. It ran inside this function's
    // isRunning guard, which coupled the two in both directions: a wedged social
    // cycle held the flag and blocked all RSS ingestion (fixed once with
    // SOCIAL_TAIL_TIMEOUT_MS), and — the failure that actually kept recurring —
    // ANY ingestion fault took all six platforms down with it. Ingestion stopped
    // dispatching twice in one day and social went dark alongside it, so "social
    // is dark" was never a social problem to diagnose.
    //
    // It now has its own queue, its own cron and its own worker consumer. An
    // ingestion fault costs fresh articles; it no longer costs the posting
    // schedule. See dispatchSocialCycle and the "15,45" cron in startScheduler.

    // X-Posting Queue (Phase B Sprint 2.x.1). Generates X-ready posts from
    // fresh unposted articles and queues them for daily email digest delivery
    // (Sprint 2.x.2). Synchronous, fast, no external API calls. Graceful-
    // failure pattern: queue errors don't block ingestion.
    try { runXQueueGenerationCycle(); }
    catch (err) { logger.error("❌ X queue generation failed", { error: err.message }); }

    // Success only on a clean pass. Ingestion is the ROOT cycle — the social
    // tail and the breaking push both hang off it — so when this stops firing,
    // several downstream signals go quiet together and every one of them looks
    // like its own separate outage.
    pingSuccess(INGESTION_PING);
  } catch (err) {
    logger.error("❌ News failed", { error: err.message });
    // /fail rather than silence: the monitor reports now instead of waiting out
    // the grace period a missing success ping would have to expire first.
    pingFail(INGESTION_PING, `ingestion cycle threw: ${String(err?.message || err).slice(0, 500)}`);
  } finally {
    isRunning = false;
    updateNextRun();
  }
}

export async function runVideoCycle() {
  if (isVideoRun) { logger.warn("⏸️ Videos already running"); return; }
  isVideoRun   = true;
  lastVideoRun = new Date().toISOString();
  logger.info(`📺 YouTube ingestion [${YOUTUBE_SOURCES.length} channels]`);
  try {
    const r = await fetchAllYouTube();
    logger.info(`📺 Done: +${r.totalNew} videos`);
  } catch (err) {
    logger.error("❌ YouTube failed", { error: err.message });
  } finally {
    isVideoRun = false;
  }
}

// ─── Short-form video generation ────────────────────────────────────────────
// Renders short-form MP4 clips for fresh articles and queues them for review.
// This is resource-intensive — run off-peak (2 AM) and keep batches small.
export async function runVideoGenCycle({ batchSize = 3 } = {}) {
  if (isGenRun) { logger.warn("⏸️ Video gen already running"); return; }
  if (!isVideoConfigured()) return; // silent no-op when ffmpeg not installed

  isGenRun   = true;
  lastGenRun = new Date().toISOString();
  logger.info(`🎬 Video gen batch (size=${batchSize})`);

  try {
    // Opt-in to the RI-aware ranker via REEL_USE_RI_SELECTOR=1.
    // Falls back to the base credibility selector when off or no RI signals.
    const useRi = String(process.env.REEL_USE_RI_SELECTOR ?? "").toLowerCase() === "1";
    const rawCandidates = useRi
      ? pickTopReelCandidates({ limit: batchSize, minCredibility: 7 })
      : findArticlesForVideoQueue({ minCredibility: 7, limit: batchSize });
    // Editorial boundary D1 — PK-domestic politics is out of scope for public
    // video. Applied here (post-selection) rather than in SQL so the rule
    // lives in one auditable place and both selectors inherit it.
    const toRender = filterVideoEligible(rawCandidates);
    if (!toRender.length) { logger.info("🎬 No candidates for video gen"); return; }

    for (const article of toRender) {
      const jobId = enqueueVideoJob(article.id);
      setVideoJobRendering(jobId);
      try {
        const result = await generateVideo(article);
        if (!result) { setVideoJobFailed(jobId, "generate returned null"); continue; }
        const thumbB64 = await previewSlide(article).catch(() => null);
        setVideoJobReady(jobId, {
          outputPath:   result.outputPath,
          hasAudio:     result.hasAudio,
          durationSecs: result.durationSecs,
          thumbnailB64: thumbB64,
        });
        logger.info(`🎬 Rendered job ${jobId} for "${article.title?.slice(0, 50)}"`);
      } catch (err) {
        setVideoJobFailed(jobId, err.message);
        logger.error(`🎬 Job ${jobId} failed: ${err.message}`);
      }
    }
  } catch (err) {
    logger.error("❌ Video gen cycle failed", { error: err.message });
  } finally {
    isGenRun = false;
  }
}

// ─── Daily recap video ──────────────────────────────────────────────────────
// Renders a single ~60s vertical MP4 covering the day's top 5 stories. Output
// lands in data/videos/daily-all-YYYY-MM-DD.mp4 for human review before being
// posted to YouTube Shorts / TikTok / Reels.
export async function runDailyRecapCycle() {
  if (isRecapRun)            { logger.warn("⏸️ Recap cycle already running"); return; }
  if (!isVideoConfigured())  return; // silent no-op without ffmpeg/fonts

  isRecapRun   = true;
  lastRecapRun = new Date().toISOString();
  logger.info("🎞️ Daily recap cycle starting");

  try {
    // Top 5 articles from the last 24h (credibility-gated).
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const articles = getDb().prepare(`
      SELECT id, title, description, content, category, source_name, published_at, credibility
      FROM articles
      WHERE published_at > ? AND credibility >= 7
      ORDER BY credibility DESC, published_at DESC
      LIMIT 5
    `).all(cutoff);

    if (articles.length < 3) {
      logger.info(`🎞️ Skipping recap — only ${articles.length} eligible articles`);
      return;
    }

    const dateStamp = new Date().toISOString().slice(0, 10);
    const result = await generateRecapVideo({
      articles,
      label: "Top 5 today",
      slug:  `daily-all-${dateStamp}`,
    });

    if (result?.outputPath) {
      logger.info(`🎞️ Daily recap rendered (${result.durationSecs}s${result.hasAudio ? " w/audio" : " silent"}) → ${result.outputPath}`);
    } else {
      logger.warn("🎞️ Daily recap returned no output");
    }
  } catch (err) {
    logger.error("❌ Daily recap cycle failed", { error: err.message });
  } finally {
    isRecapRun = false;
  }
}

// ─── Live-event video cycle (every 6h) ───────────────────────────────────────
// Picks the most recently updated active live event and renders a 60s vertical
// MP4 from its brief + metrics. Output goes to data/videos/live-{id}-{date}.mp4
// for human review before publishing. No-op if no event has enough brief points.
export async function runLiveEventVideoCycle() {
  if (isLiveVidRun)         { logger.warn("⏸️ Live-event video cycle already running"); return; }
  if (!isVideoConfigured()) return; // silent no-op without ffmpeg/fonts

  isLiveVidRun   = true;
  lastLiveVidRun = new Date().toISOString();
  logger.info("📺 Live-event video cycle starting");

  try {
    const list = listLiveEvents().filter(e => e.status === "active" || e.status == null);
    if (!list.length) { logger.info("📺 No active live events — skipping"); return; }

    // listLiveEvents returns ordered by updated_at DESC, so [0] is freshest.
    const eventId = list[0].id;
    const event   = getLiveEvent(eventId);
    if (!event || !Array.isArray(event.brief) || event.brief.length < 2) {
      logger.info(`📺 Event '${eventId}' has only ${event?.brief?.length || 0} brief points — skipping`);
      return;
    }

    const result = await generateLiveEventVideo(event);
    if (result?.outputPath) {
      logger.info(`📺 Live-event video rendered (${result.durationSecs}s${result.hasAudio ? " w/audio" : " silent"}) → ${result.outputPath}`);
    } else {
      logger.warn("📺 Live-event video returned no output");
    }
  } catch (err) {
    logger.error("❌ Live-event video cycle failed", { error: err.message });
  } finally {
    isLiveVidRun = false;
  }
}

function updateNextRun() {
  nextRun = new Date(Date.now() + 30 * 60 * 1000).toISOString();
}

export function getSchedulerStatus() {
  return {
    started: schedulerStarted,
    isRunning, isVideoRun, isGenRun, isRecapRun, isLiveVidRun, isEnrichRun, isEventsRun, isAnalysisRun,
    isPublishRun, isPolymarketRun, isMatcherRun, isEventPromoterRun, isTrackerDetectorRun,
    isSentimentRun, isRealityComposeRun, isAnomalyRun, isWatchlistPushRun, isGdeltRun, isBriefRun, isUsgsRun, isNoaaRun, isAcledRun, isFredRun, isWorldBankRun, isSportsdbRun, isTmdbRun, isSyntheticExtractRun, isAiAgentsRun, isOutcomeResolverRun, isBayesianRun,
    lastRun, lastVideoRun, lastGenRun, lastRecapRun, lastLiveVidRun, lastEnrichRun, lastEventsRun, lastAnalysisRun,
    lastEventPromoterRun, lastTrackerDetectorRun,
    lastPublishRun,
    lastPublishResult,
    lastPolymarketRun,
    lastMatcherRun,
    lastSentimentRun,
    lastRealityComposeRun,
    lastAnomalyRun,
    lastWatchlistPushRun,
    lastGdeltRun,
    lastGdeltResult,
    lastBriefRun,
    lastBriefResult,
    lastUsgsRun,
    lastUsgsResult,
    lastNoaaRun,
    lastNoaaResult,
    lastAcledRun,
    lastAcledResult,
    lastFredRun,
    lastFredResult,
    lastWorldBankRun,
    lastWorldBankResult,
    lastSportsdbRun,
    lastSportsdbResult,
    lastTmdbRun,
    lastTmdbResult,
    lastSyntheticExtractRun,
    lastSyntheticExtractResult,
    lastAiAgentsRun,
    lastAiAgentsResult,
    lastOutcomeResolverRun,
    lastOutcomeResolverResult,
    lastBayesianRun,
    lastBayesianResult,
    nextRun,
    sourceCount: RSS_SOURCES.length, videoChannels: YOUTUBE_SOURCES.length,
    videoGenConfigured: isVideoConfigured(),
    videoAutoApprove: process.env.VIDEO_AUTO_APPROVE === "1",
    publishConfigured: {
      youtube:   isYouTubeConfigured(),
      instagram: isInstagramConfigured(),
      facebook:  isFacebookConfigured(),
      tiktok:    isTikTokConfigured(),
      any: isYouTubeConfigured() || isInstagramConfigured() || isFacebookConfigured() || isTikTokConfigured(),
    },
    realityIndexEnabled: String(process.env.ENABLE_REALITY_INDEX ?? "true").toLowerCase() !== "false",
  };
}

export async function triggerManualRefresh() {
  logger.info("🔄 Manual refresh (news + videos)");
  return Promise.allSettled([
    runIngestionCycle(),
    runVideoCycle(),
  ]);
}

// ─── YouTube video metrics sync ──────────────────────────────────────────────
// Fetches view/like/comment counts for all YouTube-published jobs from the
// last 30 days and stores them in the video_metrics table. Also increments a
// per-category "engagement weight" used by getUserCategoryWeights() in the
// personalisation layer — so topics that produce viral Shorts float up in the
// editorial feed for everyone (not just the uploader's subscribers).
export async function syncVideoMetrics() {
  if (!isYouTubeConfigured()) return { synced: 0 };
  const db = getDb();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  // Collect YouTube video IDs from social_posts (inserted by /publish).
  const rows = db.prepare(`
    SELECT sp.platform_post_id AS video_id, sp.article_id, a.category
    FROM social_posts sp
    LEFT JOIN articles a ON a.id = sp.article_id
    WHERE sp.platform = 'youtube'
      AND sp.posted_at > ?
      AND sp.platform_post_id IS NOT NULL
    ORDER BY sp.posted_at DESC
    LIMIT 50
  `).all(thirtyDaysAgo);

  if (!rows.length) return { synced: 0 };

  const videoIds = rows.map(r => r.video_id);
  const stats    = await getVideoStats(videoIds);

  const byId = Object.fromEntries(stats.map(s => [s.videoId, s]));
  let synced = 0;

  for (const row of rows) {
    const s = byId[row.video_id];
    if (!s) continue;

    // Resolve job_id from article_id.
    const jobRow = db.prepare(`SELECT id FROM video_jobs WHERE article_id = ? LIMIT 1`).get(row.article_id);
    if (!jobRow) continue;

    // Upsert: update if already tracked, insert fresh row otherwise.
    const existing = db.prepare(
      `SELECT id FROM video_metrics WHERE platform = 'youtube' AND platform_id = ?`
    ).get(row.video_id);

    if (existing) {
      db.prepare(`
        UPDATE video_metrics SET views = ?, likes = ?, fetched_at = ? WHERE id = ?
      `).run(s.views, s.likes, Date.now(), existing.id);
    } else {
      db.prepare(`
        INSERT INTO video_metrics (job_id, platform, platform_id, views, likes, fetched_at)
        VALUES (?, 'youtube', ?, ?, ?, ?)
      `).run(jobRow.id, row.video_id, s.views, s.likes, Date.now());
    }

    synced++;
  }

  logger.info(`📊 YouTube metrics synced: ${synced} videos`);
  return { synced };
}

/**
 * Test seam. runDispatch has no in-flight guard BY DESIGN and that absence is
 * load-bearing — it is what stops a never-settling task from wedging the cron
 * forever — so it needs a test asserting the absence, not just the presence of
 * behaviour. Not part of the module's contract.
 */
export const __testing = { runDispatch, dispatchCycle, scheduleCron, cronName, startLoopLagMonitor, stopLoopLagMonitor };
