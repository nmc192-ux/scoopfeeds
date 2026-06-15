import cron from "node-cron";
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
import { runBreakingNewsPush } from "./breakingNewsPusher.js";
import { runAllPlatformsCycle, listEnabledPlatforms } from "./socialPublisher.js";
import { runXQueueGenerationCycle } from "./xPostGenerator.js";
import { isVideoConfigured, generateVideo, generateRecapVideo, generateLiveEventVideo, previewSlide } from "./videoGenerator.js";
import { runVideoPublishAndApproveCycle } from "./videoPublisher.js";
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
import { runTrackerDetector } from "../realityIndex/intelligence/trackerDetector.js";
import { runScoringJob } from "../skills/scoring/runtime/scoringRun.js";
import { runEventTimelineBuilder } from "../realityIndex/intelligence/eventTimelineBuilder.js";
import { runEventActorExtractor } from "../realityIndex/intelligence/eventActorExtractor.js";
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

async function dispatchIngestionCycle() {
  if (!bullmqEnabledForScheduler()) {
    return runIngestionCycle();
  }
  return enqueueSingletonJob(QUEUE_NAMES.ingestion, JOB_NAMES.newsIngestAll);
}

async function dispatchVideoCycle() {
  if (!bullmqEnabledForScheduler()) {
    return runVideoCycle();
  }
  return enqueueSingletonJob(QUEUE_NAMES.video, JOB_NAMES.videosIngestAll);
}

async function dispatchEnrichCycle(options = { batchSize: 40, concurrency: 4 }) {
  if (!bullmqEnabledForScheduler()) {
    return runEnrichCycle(options);
  }
  return enqueueSingletonJob(QUEUE_NAMES.enrichment, JOB_NAMES.articlesEnrichBatch, options);
}

function runDispatch(task, label) {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      logger.error(`❌ ${label} dispatch failed`, { error: error.message });
    });
}

function scheduleCron(expression, task) {
  const scheduledTask = cron.schedule(expression, task);
  schedulerTasks.push(scheduledTask);
  return scheduledTask;
}

function scheduleTimer(task, delayMs) {
  const timer = setTimeout(task, delayMs);
  schedulerTimers.push(timer);
  return timer;
}

export function startScheduler() {
  if (schedulerStarted) {
    logger.warn("⏰ Scheduler already started in this process");
    return false;
  }

  schedulerStarted = true;
  logger.info("⏰ Scheduler initialized — 30 min news, 60 min video, 15 min enrich, 60 min events, 2 AM video gen");
  runDispatch(() => dispatchIngestionCycle(), "news ingestion");
  runDispatch(() => dispatchVideoCycle(), "video ingestion");
  scheduleTimer(() => runDispatch(() => dispatchEnrichCycle({ batchSize: 40, concurrency: 4 }), "article enrichment"), 60_000);
  // Delay first events pass — it needs some ingested articles to work with.
  scheduleTimer(runEventsCycle, 90_000);
  // Delay first analysis pass — 5 min after startup, needs ingested articles.
  scheduleTimer(runAnalysisCycle, 5 * 60 * 1000);
  scheduleCron("*/30 * * * *", () => runDispatch(() => dispatchIngestionCycle(), "news ingestion"));
  scheduleCron("0 * * * *",    () => runDispatch(() => dispatchVideoCycle(), "video ingestion"));
  scheduleCron("*/15 * * * *", () => runDispatch(() => dispatchEnrichCycle({ batchSize: 40, concurrency: 4 }), "article enrichment"));
  scheduleCron("0 * * * *",    () => runEventsCycle());
  scheduleCron("*/30 * * * *",  () => runAnalysisCycle()); // every 30 min (latest-news cadence; was 2h)
  // ─── Video generation crons (in-process) ───────────────────────────────
  // Disabled in production because Hostinger Cloud Hosting blocks subprocess
  // execution at the kernel level (RLIMIT_NPROC). Rendering is delegated to
  // the GitHub Actions workflow at .github/workflows/render-videos.yml,
  // which calls /scoop-ops/videos-gen/next-batch + /upload over HTTP.
  //
  // Set ENABLE_INPROCESS_VIDEO_CRON=true to re-enable these on a host that
  // allows spawn() (any VPS, Docker, local dev, etc.).
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
    scheduleCron("*/15 * * * *", () => runPolymarketCycle());
    scheduleCron("7,37 * * * *", () => runMarketMatcherCronCycle());       // every 30 min, offset
    scheduleCron("0 4 * * *",    () => runSnapshotDownsamplerCycle());     // daily 4 AM
    // Phase 2 — Event Tracker
    scheduleCron("13,43 * * * *", () => runEventPromoterCronCycle());       // every 30 min, offset
    // Sprint 1.3.4 — Tracker Auto-Detection Engine. Runs 3 min after the
    // eventPromoter cron so promoted events are fresh when the detector
    // evaluates per-template triggers. Independent of timeline+actors below.
    scheduleCron("16,46 * * * *", () => runTrackerDetectorCronCycle());     // every 30 min, +3 offset from eventPromoter
    scheduleCron("19 * * * *",    () => runEventTimelineBuilderCycle());   // every 1 hr
    scheduleCron("49 * * * *",    () => runActorExtractorCycle());         // every 1 hr, offset
    // Phase 3 — Sentiment + Composite + Anomalies
    scheduleCron("21,51 * * * *", () => runRealityIndexComposeCycle());    // every 30 min, offset
    scheduleCron("27 * * * *",    () => runSentimentScoreCycle());         // every 1 hr
    scheduleCron("3,18,33,48 * * * *", () => runAnomalyScanCycle());       // every 15 min
    // Phase 4c — Watchlist push fan-out (runs 2 min after each anomaly scan
    // so newly-detected alerts are dispatched promptly to watching users).
    scheduleCron("5,20,35,50 * * * *", () => runWatchlistPushCycle());     // every 15 min, +2m offset
    // Phase 5 — GDELT global news multiplier. New articles inserted here flow
    // through the same cluster→event→matcher pipeline as RSS-ingested ones.
    scheduleCron("8,38 * * * *",       () => runGdeltCycle());             // every 30 min, between RSS ticks
    // Phase 5 — USGS significant-earthquakes feed → events with geo_lat/lng
    scheduleCron("*/10 * * * *",       () => runUsgsCycle());               // every 10 min
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
    scheduleTimer(() => runPolymarketCycle(), 30_000);
    scheduleTimer(() => runMarketMatcherCronCycle(), 5 * 60 * 1000);
    scheduleTimer(() => runEventPromoterCronCycle(), 8 * 60 * 1000);
    // Sprint 1.3.4 — Tracker Detector first run ~11 min after boot, between
    // eventPromoter's 8-min boot pulse and the next on-the-hour :16 cron tick.
    scheduleTimer(() => runTrackerDetectorCronCycle(), 11 * 60 * 1000);
    scheduleTimer(() => runRealityIndexComposeCycle(), 9 * 60 * 1000);
    scheduleTimer(() => runGdeltCycle(), 2 * 60 * 1000);                       // first GDELT pull 2 min after boot
    logger.info("🧠 Reality Index crons scheduled (polymarket 15m, matcher 30m, eventPromoter 30m, trackerDetector 30m, timeline+actors hourly, downsample daily, sentiment hourly, RI compose 30m, anomaly 15m, watchlist-push 15m, GDELT 30m)");
  } else {
    logger.info("🧠 Reality Index crons disabled via ENABLE_REALITY_INDEX=false");
  }

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

  schedulerStarted = false;
  nextRun = null;
  logger.info("⏹️ Scheduler stopped");
  return true;
}

// ─── Reality Index cycles ──────────────────────────────────────────────────

async function runPolymarketCycle() {
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

async function runEventPromoterCronCycle() {
  if (isEventPromoterRun) { logger.warn("⏸️ Event promoter already running"); return null; }
  isEventPromoterRun = true;
  try {
    const out = await runEventPromoter();
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

async function runRealityIndexComposeCycle() {
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
async function runUsgsCycle() {
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
export { runPolymarketCycle, runMarketMatcherCronCycle, runSnapshotDownsamplerCycle, snapshotActiveMarkets,
         runEventPromoterCronCycle, runTrackerDetectorCronCycle, runActorExtractorCycle,
         runSentimentScoreCycle, runRealityIndexComposeCycle, runAnomalyScanCycle,
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

async function runEventsCycle() {
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

async function runAnalysisCycle() {
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
  } catch (err) {
    logger.error("❌ Enrich failed", { error: err.message });
  } finally {
    isEnrichRun = false;
  }
}

export async function runIngestionCycle() {
  if (isRunning) { logger.warn("⏸️ News already running"); return; }
  isRunning = true;
  lastRun   = new Date().toISOString();
  logger.info(`🔄 News ingestion [${RSS_SOURCES.length} sources]`);
  try {
    const r = await fetchAllSources(RSS_SOURCES);
    logger.info(`📰 Done: +${r.totalNew} in ${r.duration}ms`);
    // Tail step: if a fresh high-credibility article landed, fan it out as a
    // push. Skipped silently if no candidate, in quiet hours, or push is
    // disabled. Errors here must not break the ingest cycle.
    if (String(process.env.ENABLE_BREAKING_PUSH ?? "true").toLowerCase() !== "false") {
      try { await runBreakingNewsPush(); }
      catch (err) { logger.error("❌ Breaking push failed", { error: err.message }); }
    }
    // Tail step: auto-post to social. Each adapter's own minIntervalMs
    // throttles how often it actually fires; if no platform is configured
    // (env vars missing) this is a near-instant no-op.
    if (String(process.env.ENABLE_AUTO_SOCIAL ?? "true").toLowerCase() !== "false") {
      const enabled = listEnabledPlatforms();
      if (enabled.length) {
        try { await runAllPlatformsCycle(); }
        catch (err) { logger.error("❌ Auto-social failed", { error: err.message }); }
      }
    }

    // X-Posting Queue (Phase B Sprint 2.x.1). Generates X-ready posts from
    // fresh unposted articles and queues them for daily email digest delivery
    // (Sprint 2.x.2). Synchronous, fast, no external API calls. Graceful-
    // failure pattern: queue errors don't block ingestion.
    try { runXQueueGenerationCycle(); }
    catch (err) { logger.error("❌ X queue generation failed", { error: err.message }); }
  } catch (err) {
    logger.error("❌ News failed", { error: err.message });
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
    const toRender = useRi
      ? pickTopReelCandidates({ limit: batchSize, minCredibility: 7 })
      : findArticlesForVideoQueue({ minCredibility: 7, limit: batchSize });
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
