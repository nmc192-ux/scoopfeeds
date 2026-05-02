// videoPublisher.js — publish review-approved video jobs to short-form platforms.
//
// Encapsulates the per-platform publishing flow (YouTube Shorts, IG Reels,
// FB Reels, TikTok) so both the cron scheduler and the /scoop-ops/videos-gen
// admin endpoint share one code path. Marks each job as 'published' in the
// `video_jobs` table once at least one platform succeeds.
//
// Companion auto-approve helper that promotes 'ready' jobs to
// 'review_approved' when they meet quality thresholds (high credibility,
// no tragedy keywords, recent enough). Off by default — opt in via
// VIDEO_AUTO_APPROVE=1 in env.
//
// Why a separate service:
//   - Scheduler can run a publish cycle without going through HTTP / WAF.
//   - The /publish admin endpoint stays thin (just calls into here).
//   - Easier to unit-test the criteria in isolation from Express.
//
// Required env (any of):
//   YOUTUBE_*               — YouTube Data API v3 (Shorts upload)
//   FACEBOOK_PAGE_ID + FACEBOOK_PAGE_TOKEN — FB Reels
//   INSTAGRAM_USER_ID + FACEBOOK_PAGE_TOKEN — IG Reels
//   TIKTOK_*                — TikTok Content Posting API
//
// Optional:
//   VIDEO_AUTO_APPROVE=1                           — enable auto-approval cron
//   VIDEO_AUTO_APPROVE_MIN_CREDIBILITY=8           — min credibility (default 8)
//   VIDEO_AUTO_APPROVE_MAX_AGE_HOURS=24            — skip stale jobs (default 24h)

import { existsSync } from "fs";
import {
  getDb,
  getArticleById,
  getVideoJobsReadyToPublish,
  approveVideoJob,
  markVideoJobPublished,
} from "../models/database.js";
import {
  isYouTubeConfigured,
  uploadToYouTube,
} from "./youtubeClient.js";
import {
  isTikTokConfigured,
  uploadToTikTok,
} from "./tiktokClient.js";
import {
  isInstagramConfigured,
  postReelToInstagram,
} from "./instagramClient.js";
import {
  isFacebookConfigured,
  postReelToFacebook,
} from "./facebookClient.js";
import { logger } from "./logger.js";

const SITE_ORIGIN = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");

// Tragedy / sensitive-violence keyword filter — videos about deaths, attacks,
// disasters etc. shouldn't auto-publish without human eyes on the script and
// thumbnail. Stays in human-review queue.
const TRAGEDY_KEYWORDS = /\b(dies?|killed|death|murdered|fatal|tragedy|massacre|crash|attack|shooting|terror|disaster|funeral|mourns?|stabbed|drowned|murders?|homicide|assassinat|gunman)\b/i;

// Programming-block / show-promo headlines — recurring TV/radio segments
// that some sources syndicate as "articles" (Bloomberg's daily shows, BBC
// programs, etc.). Generated as videos they read as noise, never news.
// Mirrors the filter in socialPublisher.js so video and text channels
// agree on what counts as auto-postable news.
const PROGRAMMING_BLOCK_PATTERNS = [
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
  /\b\d{1,2}-\d{1,2}-\d{2,4}\b/,
  /^the [\w\s'.&-]{2,40} show\s*$/i,
  /^the [\w\s'.&-]{2,40} show\b.*\d/i,
  /^bloomberg\s+(daybreak|surveillance|the\s+open|the\s+close|markets|technology|wall\s+street(\s+week)?|asia|europe|americas|business\s*week)\b/i,
  /^(squawk\s+box|squawk\s+on\s+the\s+street|fast\s+money|mad\s+money|closing\s+bell|opening\s+bell|power\s+lunch)\b/i,
  /^(watch|listen)\s+live:?\s*$/i,
  /^live\s*:\s*[\w\s.,'-]{0,30}$/i,
];
function looksLikeProgrammingBlock(title) {
  if (!title || typeof title !== "string") return true;
  return PROGRAMMING_BLOCK_PATTERNS.some(re => re.test(title));
}

// Categories where auto-publishing breaking-style video clips would feel
// crass even with a clean headline. Skip these — humans review.
const AUTO_PUBLISH_SKIP_CATEGORIES = new Set([
  // currently empty; populate if a category turns out to be problematic
]);

function recordSocialPost(articleId, platform, postUrl, platformPostId) {
  try {
    getDb().prepare(`
      INSERT OR IGNORE INTO social_posts
        (article_id, platform, status, post_url, platform_post_id, posted_at)
      VALUES (?, ?, 'posted', ?, ?, ?)
    `).run(articleId, platform, postUrl, platformPostId, Date.now());
  } catch (err) {
    logger.warn(`videoPublisher: social_posts insert failed for ${articleId}/${platform}: ${err.message}`);
  }
}

// Build the public video URL Meta/Pinterest/etc. fetch via HTTP. Same shape
// as videos-gen.js so external platforms find the file at one stable path.
function publicVideoUrlFor(articleId) {
  const safe = String(articleId).replace(/[^a-z0-9_-]/gi, "_");
  return `${SITE_ORIGIN}/scoop-ops/videos-gen/file/${encodeURIComponent(safe)}`;
}

// Build the per-platform caption / title / tags from an article.
function buildPostCopy(article, jobArticleId) {
  const title  = (article?.title || "News").slice(0, 99);
  const source = article?.source_name || "Scoop";
  const cat    = String(article?.category || "news").replace(/-/g, " ");
  const desc = [
    (article?.description || "").slice(0, 300),
    `\nSource: ${source}`,
    `\nFull story → ${SITE_ORIGIN}/article/${jobArticleId}`,
    `\nCategory: ${cat}`,
    `\n\n#Scoop #${cat.replace(/\s+/g, "")} #News #Shorts #BreakingNews`,
  ].join("").slice(0, 5000);
  const tags = [
    "scoop", "news", "shorts", cat.replace(/\s+/g, ""),
    ...(article?.category ? [article.category] : []),
  ].filter(Boolean).slice(0, 15);
  // Reels caption is shorter and emphasizes the click-through.
  const reelCaption = `${title}\n\n#Scoop #News #Reels #Shorts\n\nFull story → ${SITE_ORIGIN}/article/${jobArticleId}`.slice(0, 2200);
  return { title, desc, tags, reelCaption };
}

// Publish a single video job to all configured platforms. Returns a per-job
// result object with one entry per attempted platform. Marks the job as
// 'published' in video_jobs once at least one platform succeeds.
async function publishOneJob(job, { dryRun = false } = {}) {
  const result = {
    jobId: job.id,
    articleId: job.article_id,
    title: null,
    platforms: [],
    youtube: null,
    tiktok: null,
    instagram: null,
    facebook: null,
    ok: false,
  };

  if (!job.output_path || !existsSync(job.output_path)) {
    result.error = "output file missing";
    return result;
  }

  const article = getArticleById(job.article_id);
  const { title, desc, tags, reelCaption } = buildPostCopy(article, job.article_id);
  result.title = title;
  const publicUrl = publicVideoUrlFor(job.article_id);

  if (dryRun) {
    result.dryRun = true;
    result.publicVideoUrl = publicUrl;
    return result;
  }

  // ── YouTube Shorts ────────────────────────────────────────────────────────
  if (isYouTubeConfigured()) {
    try {
      const { videoId, videoUrl } = await uploadToYouTube({
        filePath:    job.output_path,
        title,
        description: desc,
        tags,
        category:    25,  // News & Politics
        isShort:     true,
      });
      result.youtube = { videoId, videoUrl };
      result.platforms.push("youtube");
      recordSocialPost(job.article_id, "youtube", videoUrl, videoId);
      logger.info(`📺 YouTube Shorts published: ${videoId} — "${title}"`);
    } catch (err) {
      result.youtube = { error: err.message };
      logger.error(`📺 YouTube publish failed for job ${job.id}: ${err.message}`);
    }
  }

  // ── TikTok ────────────────────────────────────────────────────────────────
  if (isTikTokConfigured()) {
    try {
      const { publishId, videoId: tikTokVideoId, videoUrl: tikTokUrl } = await uploadToTikTok({
        filePath:    job.output_path,
        title,
        description: desc,
        tags,
      });
      result.tiktok = { publishId, videoId: tikTokVideoId, videoUrl: tikTokUrl };
      result.platforms.push("tiktok");
      recordSocialPost(job.article_id, "tiktok", tikTokUrl, tikTokVideoId || publishId);
      logger.info(`📱 TikTok published: ${publishId} — "${title}"`);
    } catch (err) {
      result.tiktok = { error: err.message };
      logger.error(`📱 TikTok publish failed for job ${job.id}: ${err.message}`);
    }
  }

  // ── Instagram Reels ───────────────────────────────────────────────────────
  if (isInstagramConfigured()) {
    try {
      const { id: igId, url: igUrl } = await postReelToInstagram({
        videoUrl: publicUrl,
        caption:  reelCaption,
      });
      result.instagram = { id: igId, url: igUrl };
      result.platforms.push("instagram_reels");
      recordSocialPost(job.article_id, "instagram_reels", igUrl, igId);
      logger.info(`📸 Instagram Reel published: ${igId} — "${title}"`);
    } catch (err) {
      result.instagram = { error: err.message };
      logger.error(`📸 Instagram Reel failed for job ${job.id}: ${err.message}`);
    }
  }

  // ── Facebook Reels ────────────────────────────────────────────────────────
  if (isFacebookConfigured()) {
    try {
      const { id: fbId, url: fbUrl } = await postReelToFacebook({
        filePath: job.output_path,
        videoUrl: publicUrl,
        caption:  reelCaption,
      });
      result.facebook = { id: fbId, url: fbUrl };
      result.platforms.push("facebook_reels");
      recordSocialPost(job.article_id, "facebook_reels", fbUrl, fbId);
      logger.info(`📘 Facebook Reel published: ${fbId} — "${title}"`);
    } catch (err) {
      result.facebook = { error: err.message };
      logger.error(`📘 Facebook Reel failed for job ${job.id}: ${err.message}`);
    }
  }

  if (result.platforms.length > 0) {
    markVideoJobPublished(job.id, result.platforms);
    result.ok = true;
  }
  return result;
}

// Public: publish all approved video jobs (or a specific subset). Used by
// both the scheduler and the /scoop-ops/videos-gen/publish endpoint.
//   opts.jobs     — optional array of job rows to publish (overrides query)
//   opts.dryRun   — if true, don't actually post; just return what would happen
//   opts.maxBatch — cap the number of jobs published this cycle (default 5)
export async function publishApprovedVideos({ jobs = null, dryRun = false, maxBatch = 5 } = {}) {
  // Skip the network round-trip entirely when no platform is set up.
  const anyConfigured = isYouTubeConfigured() || isTikTokConfigured() || isInstagramConfigured() || isFacebookConfigured();
  if (!anyConfigured) {
    return {
      ok: false,
      reason: "no_platform_configured",
      configured: { youtube: false, tiktok: false, instagram: false, facebook: false },
      results: [],
    };
  }

  const targetJobs = (jobs || getVideoJobsReadyToPublish()).slice(0, maxBatch);
  if (targetJobs.length === 0) {
    return { ok: true, published: 0, failed: 0, message: "no_approved_jobs", results: [] };
  }

  const results = [];
  for (const job of targetJobs) {
    try {
      results.push(await publishOneJob(job, { dryRun }));
    } catch (err) {
      logger.error(`videoPublisher: unexpected throw for job ${job.id}: ${err.message}`);
      results.push({ jobId: job.id, ok: false, error: err.message });
    }
  }

  const okCount   = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;
  return { ok: okCount > 0 || dryRun, published: okCount, failed: failCount, dryRun, results };
}

// Public: scan 'ready' video jobs and auto-promote those that meet quality
// criteria to 'review_approved' (which then become eligible for publish).
//
// Criteria:
//   - Article credibility ≥ minCredibility (default 8)
//   - Article published within maxAgeHours (default 24)
//   - Headline is NOT a tragedy/violence story
//   - Job has a valid output_path on disk
//   - Article category is not in AUTO_PUBLISH_SKIP_CATEGORIES
//
// Designed to be safe under the existing manual-review workflow: jobs that
// fail any check stay in `ready` for human triage. The full audit trail
// (approved_at timestamp) is preserved.
export function autoApproveReadyJobs({
  minCredibility = parseInt(process.env.VIDEO_AUTO_APPROVE_MIN_CREDIBILITY || "8", 10),
  maxAgeHours   = parseInt(process.env.VIDEO_AUTO_APPROVE_MAX_AGE_HOURS   || "24", 10),
  limit         = 10,
} = {}) {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const candidates = getDb().prepare(`
    SELECT j.id, j.article_id, j.output_path, j.created_at,
           a.title, a.category, a.credibility, a.published_at
    FROM video_jobs j
    LEFT JOIN articles a ON a.id = j.article_id
    WHERE j.status = 'ready'
      AND j.output_path IS NOT NULL
    ORDER BY j.created_at ASC
    LIMIT ?
  `).all(limit * 3); // fetch a bit more so we can filter and still hit limit

  const approved = [];
  const skipped  = [];

  for (const c of candidates) {
    if (approved.length >= limit) break;
    // Recap / live-event videos use synthetic article_ids (e.g. recap-daily-all-...).
    // They have no article-table row → no title, no credibility. Approve them
    // based on freshness of the JOB itself instead of the absent article.
    const isRecapJob = !c.title && /^(recap|live-event)/i.test(String(c.article_id || ""));

    const reason = (() => {
      if (!existsSync(c.output_path)) return "output_missing";
      if (isRecapJob) {
        // Stale recap (>48h since render) doesn't justify auto-publishing.
        if ((c.created_at || 0) < Date.now() - 48 * 60 * 60 * 1000) return "stale_recap";
        return null;
      }
      if (!c.title) return "no_title";
      if ((c.credibility || 0) < minCredibility) return `low_credibility(${c.credibility})`;
      if ((c.published_at || 0) < cutoff) return "stale_article";
      if (TRAGEDY_KEYWORDS.test(c.title)) return "tragedy_keyword";
      if (looksLikeProgrammingBlock(c.title)) return "programming_block";
      if (AUTO_PUBLISH_SKIP_CATEGORIES.has(c.category)) return `skip_category(${c.category})`;
      return null;
    })();
    if (reason) {
      skipped.push({ jobId: c.id, title: c.title?.slice(0, 60), reason });
      continue;
    }
    approveVideoJob(c.id);
    approved.push({ jobId: c.id, title: c.title.slice(0, 60), category: c.category });
  }

  return { approved, skipped, totalScanned: candidates.length };
}

// Combined cycle: auto-approve fresh high-quality jobs, then publish any
// jobs in 'review_approved' state. Used by the scheduler.
export async function runVideoPublishAndApproveCycle({ approveLimit = 5, publishLimit = 3 } = {}) {
  const out = { autoApprove: null, publish: null };
  if (process.env.VIDEO_AUTO_APPROVE === "1") {
    out.autoApprove = autoApproveReadyJobs({ limit: approveLimit });
  }
  out.publish = await publishApprovedVideos({ maxBatch: publishLimit });
  return out;
}
