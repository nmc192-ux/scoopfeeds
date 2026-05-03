import cron from "node-cron";
import { fetchAllSources } from "./rssFetcher.js";
import { fetchAllYouTube } from "./videoFetcher.js";
import { enrichBatch } from "./contentEnricher.js";
import { pruneOldArticles, findArticlesForVideoQueue, enqueueVideoJob,
         setVideoJobRendering, setVideoJobReady, setVideoJobFailed,
         getArticleById } from "../models/database.js";
import { logger } from "./logger.js";
import { RSS_SOURCES, YOUTUBE_SOURCES } from "../config/sources.js";
import { sendDailyDigest } from "./digest.js";
import { runWelcomeSequenceCycle } from "./welcomeSequence.js";
import { refreshAllEvents } from "./liveEvents.js";
import { refreshAnalysis } from "./analysisService.js";
import { runBreakingNewsPush } from "./breakingNewsPusher.js";
import { runAllPlatformsCycle, listEnabledPlatforms } from "./socialPublisher.js";
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
import { runEventTracker } from "../realityIndex/intelligence/eventTracker.js";
import { runEventTimelineBuilder } from "../realityIndex/intelligence/eventTimelineBuilder.js";
import { runEventActorExtractor } from "../realityIndex/intelligence/eventActorExtractor.js";
import { runMediaSentimentForActiveEvents } from "../realityIndex/intelligence/mediaSentimentScorer.js";
import { runSentimentCycle } from "../realityIndex/intelligence/sentimentScorer.js";
import { runRealityIndexCycle } from "../realityIndex/intelligence/realityIndex.js";
import { runAnomalyDetector } from "../realityIndex/intelligence/anomalyDetector.js";

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
let isEventTrackerRun = false;  // Reality Index Phase 2
let isActorRun        = false;  // Reality Index Phase 2
let lastRun       = null;
let lastVideoRun = null;
let lastGenRun   = null;
let lastRecapRun = null;
let lastLiveVidRun = null;
let lastEnrichRun = null;
let lastEventsRun   = null;
let lastAnalysisRun = null;
let lastPolymarketRun = null;
let lastMatcherRun    = null;
let nextRun         = null;

export function startScheduler() {
  logger.info("⏰ Scheduler initialized — 30 min news, 60 min video, 15 min enrich, 60 min events, 2 AM video gen");
  runIngestionCycle();
  runVideoCycle();
  setTimeout(runEnrichCycle, 60_000);
  // Delay first events pass — it needs some ingested articles to work with.
  setTimeout(runEventsCycle, 90_000);
  // Delay first analysis pass — 5 min after startup, needs ingested articles.
  setTimeout(runAnalysisCycle, 5 * 60 * 1000);
  cron.schedule("*/30 * * * *", () => runIngestionCycle());
  cron.schedule("0 * * * *",    () => runVideoCycle());
  cron.schedule("*/15 * * * *", () => runEnrichCycle());
  cron.schedule("0 * * * *",    () => runEventsCycle());
  cron.schedule("0 */2 * * *",  () => runAnalysisCycle()); // every 2 hours
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
    cron.schedule("0 2 * * *",   () => runVideoGenCycle({ batchSize: 3 }));
    cron.schedule("0 6 * * *",   () => runDailyRecapCycle());
    cron.schedule("0 */6 * * *", () => runLiveEventVideoCycle());
    logger.info("🎬 In-process video crons enabled (host supports spawn)");
  } else {
    logger.info("🎬 In-process video crons disabled — using GitHub Actions render worker via /scoop-ops/videos-gen/next-batch");
  }
  // Newsletter welcome sequence — runs hourly. Picks subscribers who are
  // due for d1/d3 follow-up emails. No-op when SMTP isn't configured.
  cron.schedule("17 * * * *", () => runWelcomeSequenceCycle({ maxPerStage: 50 }).catch(err =>
    logger.warn(`welcomeSequence cron failed: ${err.message}`)
  ));
  // Daily digest at 07:00 server time — no-op if SMTP is not configured.
  cron.schedule("0 7 * * *", async () => {
    try {
      await sendDailyDigest();
    } catch (err) {
      logger.error("❌ Digest failed", { error: err.message });
    }
  });
  cron.schedule("0 3 * * *", async () => {
    logger.info("🧹 Pruning...");
    const n = pruneOldArticles(7);
    logger.info(`🧹 Pruned ${n} records`);
  });

  // YouTube video metrics sync — runs at 14:00 daily (8h after typical upload
  // at 06:00 UTC, when views should show at least a few dozen data points).
  // Updates video_metrics + bubbles engagement signal into article ranking.
  cron.schedule("0 14 * * *", async () => {
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
  cron.schedule("23 */1 * * *", () => runVideoPublishCycle().catch(err =>
    logger.warn(`videoPublish cron failed: ${err.message}`)
  ));

  // ─── Reality Index — Phase 1 crons ──────────────────────────────────────
  // Polymarket fetch-and-snapshot every 15 min. Disable with
  // ENABLE_REALITY_INDEX=false (e.g. on a cold deploy you don't want chatty).
  if (String(process.env.ENABLE_REALITY_INDEX ?? "true").toLowerCase() !== "false") {
    cron.schedule("*/15 * * * *", () => runPolymarketCycle());
    cron.schedule("7,37 * * * *", () => runMarketMatcherCronCycle());       // every 30 min, offset
    cron.schedule("0 4 * * *",    () => runSnapshotDownsamplerCycle());     // daily 4 AM
    // Phase 2 — Event Tracker
    cron.schedule("13,43 * * * *", () => runEventTrackerCronCycle());       // every 30 min, offset
    cron.schedule("19 * * * *",    () => runEventTimelineBuilderCycle());   // every 1 hr
    cron.schedule("49 * * * *",    () => runActorExtractorCycle());         // every 1 hr, offset
    // Phase 3 — Sentiment + Composite + Anomalies
    cron.schedule("21,51 * * * *", () => runRealityIndexComposeCycle());    // every 30 min, offset
    cron.schedule("27 * * * *",    () => runSentimentScoreCycle());         // every 1 hr
    cron.schedule("3,18,33,48 * * * *", () => runAnomalyScanCycle());       // every 15 min
    // First run shortly after boot — Polymarket cold start.
    setTimeout(() => runPolymarketCycle(), 30_000);
    setTimeout(() => runMarketMatcherCronCycle(), 5 * 60 * 1000);
    setTimeout(() => runEventTrackerCronCycle(), 8 * 60 * 1000);
    setTimeout(() => runRealityIndexComposeCycle(), 9 * 60 * 1000);
    logger.info("🧠 Reality Index crons scheduled (polymarket 15m, matcher 30m, eventTracker 30m, timeline+actors hourly, downsample daily, sentiment hourly, RI compose 30m, anomaly 15m)");
  } else {
    logger.info("🧠 Reality Index crons disabled via ENABLE_REALITY_INDEX=false");
  }

  updateNextRun();
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

async function runEventTrackerCronCycle() {
  if (isEventTrackerRun) { logger.warn("⏸️ Event tracker already running"); return null; }
  isEventTrackerRun = true;
  try {
    const out = await runEventTracker();
    await runEventTimelineBuilder();
    return out;
  } catch (err) {
    logger.error("❌ Event tracker failed", { error: err.message });
    return null;
  } finally {
    isEventTrackerRun = false;
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

// Suppress unused-warning while exposing for ad-hoc /scoop-ops triggers later.
export { runPolymarketCycle, runMarketMatcherCronCycle, runSnapshotDownsamplerCycle, snapshotActiveMarkets,
         runEventTrackerCronCycle, runActorExtractorCycle,
         runSentimentScoreCycle, runRealityIndexComposeCycle, runAnomalyScanCycle };

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

async function runEnrichCycle() {
  if (isEnrichRun) return;
  isEnrichRun = true;
  lastEnrichRun = new Date().toISOString();
  try {
    await enrichBatch({ batchSize: 40, concurrency: 4 });
  } catch (err) {
    logger.error("❌ Enrich failed", { error: err.message });
  } finally {
    isEnrichRun = false;
  }
}

async function runIngestionCycle() {
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
  } catch (err) {
    logger.error("❌ News failed", { error: err.message });
  } finally {
    isRunning = false;
    updateNextRun();
  }
}

async function runVideoCycle() {
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
    const toRender = findArticlesForVideoQueue({ minCredibility: 7, limit: batchSize });
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
    isRunning, isVideoRun, isGenRun, isRecapRun, isLiveVidRun, isEnrichRun, isEventsRun, isAnalysisRun,
    isPublishRun, isPolymarketRun, isMatcherRun,
    isSentimentRun, isRealityComposeRun, isAnomalyRun,
    lastRun, lastVideoRun, lastGenRun, lastRecapRun, lastLiveVidRun, lastEnrichRun, lastEventsRun, lastAnalysisRun,
    lastPublishRun,
    lastPublishResult,
    lastPolymarketRun,
    lastMatcherRun,
    lastSentimentRun,
    lastRealityComposeRun,
    lastAnomalyRun,
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
