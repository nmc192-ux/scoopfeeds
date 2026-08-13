/**
 * videoAutopost.js — the loop. Candidate → spec → render → voice → upload.
 *
 * Runs in the WORKER, under QUEUE_NAMES.videoRender. The scheduler only
 * enqueues: rendering is minutes of ffmpeg and satori, and QUEUE_NAMES.video
 * is YouTube INGESTION, which is why this needed a queue of its own rather
 * than a second job on that one.
 *
 * TWO INDEPENDENT RATE GATES (DrJ, 2026-08-02: 4/day, spread not batched):
 *   COUNT   — under VIDEO_MAX_PER_DAY in a ROLLING 24h. Rolling, not calendar:
 *             a calendar day resets at midnight and a quiet Tuesday would let
 *             four videos burst out in the small hours of Wednesday.
 *   SPACING — VIDEO_MIN_INTERVAL_MS since the last successful publish,
 *             derived as 24h / max × 0.8 ≈ 4.8h at 4/day.
 * The 0.8 slack is load-bearing. At exactly 24h/4 = 6h a single missed slot
 * pushes every later one back and the day quietly delivers three. With five
 * opportunities for four videos the CAP enforces the count and the SPACING
 * enforces the spread, so a failure costs time rather than a video. The cron
 * runs hourly and both gates are cheap queries, so a slot missed at 14:00 is
 * simply retried at 15:00.
 *
 * WRITE BEFORE UPLOAD. claimVideoPost() inserts a pending row BEFORE the
 * upload. If the row were written on success, a crash between upload and
 * insert would leave a published video with no row and the next cycle would
 * re-upload the same article — and UNIQUE(article_id) cannot help with a row
 * that was never written. The stale-pending rule in findFreshUnvideoedArticles
 * is what stops that claim from permanently retiring an article whose upload
 * merely failed.
 *
 * §6.2's posture is PREFER PUBLISHING NOTHING. Every failure below skips the
 * article and moves on; nothing is salvaged, degraded, or published partially.
 */

import { existsSync, statSync } from "fs";
import path from "path";
import { logger } from "./logger.js";
import {
  findFreshUnvideoedArticles, claimVideoPost, markVideoPublished, markVideoFailed,
  countVideosPublishedSince, lastVideoPublishedAt, recordHeartbeat, getHeartbeatRow,
  markVideoFacebook, countFacebookPostsSince,
  markVideoInstagram, countInstagramPostsSince,
  markVideoThreads, countThreadsPostsSince,
} from "../models/database.js";
import { filterAtSelection, assertPublishAllowed } from "./videoPakistanBlock.js";
import { selectionGate, diversifyByPublisher, MAX_PER_PUBLISHER } from "./videoSelection.js";
import { resolveAttribution, buildDescriptionCredit } from "./videoAttribution.js";
import { writeVideoSpec, writePackaging, isVideoSpecEnabled } from "./videoSpecWriter.js";
import { statesForCard, renderState, fitStatesToDuration, videoDesignKey } from "./videoSlideRenderer.js";
import { DEFAULT_ORIENTATION } from "./videoGeometry.js";
import { assembleSlide, concatSlides, holdForAudio } from "./videoAssembler.js";
import { acquireFrameDir, releaseFrameDir, VIDEOS_DIR } from "./videoArtifacts.js";
import { voiceSpec, isVoiceConfigured } from "./videoVoice.js";
import { uploadToYouTube, isYouTubeConfigured } from "./youtubeClient.js";
import { postVideoToFacebook, postReelToFacebook, isFacebookConfigured } from "./facebookClient.js";
import { postReelToInstagram, isInstagramConfigured } from "./instagramClient.js";
import { postVideoToThreads, isThreadsConfigured } from "./threadsClient.js";
import { HEARTBEAT_PING_URLS, pingStart, pingSuccess, pingFail, uniformFailure } from "./heartbeatPing.js";

export const VIDEO_CYCLE_HEARTBEAT = "video_cycle";
const VIDEO_PING = HEARTBEAT_PING_URLS.video;

/**
 * Staleness threshold for the video cycle — 3 missed hourly runs.
 *
 * This did not exist. getVideoCycleHealth detected a HUNG cycle (started and
 * never completed) and nothing else, so a loop that simply stopped being
 * dispatched was invisible: no start to go stale, no error, no failed row. That
 * is the gap that let a dead YouTube token run for 17h.
 *
 * Mirrors the social cycle's rule — 3 missed runs — against this cron's hourly
 * cadence rather than the social cycle's half-hourly one. Deliberately NOT derived from
 * VIDEO_MIN_INTERVAL_MS: the gates decide whether a cycle PUBLISHES, and a
 * cycle that runs and correctly declines is healthy. What is being measured
 * here is whether the runner fires at all.
 */
export const VIDEO_CYCLE_STALE_MS = () =>
  Number.parseInt(process.env.VIDEO_CYCLE_STALE_MS || "", 10) || 3 * 60 * 60 * 1000;

/**
 * Stages excluded from the uniform-failure check. EMPTY BY DEFAULT — every
 * stage counts, per the rule this was built to: if all N attempts died at the
 * same stage, that is a dependency, not a quiet news day.
 *
 * The lever exists because one stage is genuinely ambiguous. `spec` rejects an
 * article for being too thin, and on 2026-08-03 a real run rejected 8 of 8 that
 * way — a candidate-ORDERING defect, not an outage. Fixing the ordering is what
 * the length-first `ORDER BY` was for, so a recurrence would be a regression
 * worth paging on; but a genuinely thin news hour reads identically from here.
 * If this turns out to page on quiet nights, `VIDEO_FAIL_PING_IGNORE_STAGES=spec`
 * is the whole fix and needs no deploy.
 *
 * Editorial gate names for reference (videoSelection.js): sport, live-blog,
 * stock-commentary, publisher-24h, event-48h, title-similarity.
 */
const failPingIgnoredStages = () =>
  new Set(
    String(process.env.VIDEO_FAIL_PING_IGNORE_STAGES || "")
      .split(",").map((s) => s.trim()).filter(Boolean)
  );

const VIDEO_MIN_ATTEMPTS = () =>
  Number.parseInt(process.env.VIDEO_FAIL_PING_MIN_ATTEMPTS || "", 10) || 3;

/**
 * Did this cycle fail uniformly? Exported for verification — the classification
 * is where incident and bad-news-day are told apart, and getting it wrong either
 * pages on a quiet night or misses the next 17-hour 401.
 *
 * `ok`/`ok-dry` anywhere means a video was produced, which is not a failure
 * however many candidates were rejected on the way.
 */
export function videoCycleFailure(attempts, { minAttempts = VIDEO_MIN_ATTEMPTS() } = {}) {
  if (!Array.isArray(attempts)) return { uniform: false };
  if (attempts.some((a) => a?.stage === "ok" || a?.stage === "ok-dry")) return { uniform: false };
  const ignored = failPingIgnoredStages();
  const counted = attempts.filter((a) => a?.stage && !ignored.has(a.stage));
  return uniformFailure(counted, { minAttempts });
}

export const VIDEO_MAX_PER_DAY = () =>
  Number.parseInt(process.env.VIDEO_MAX_PER_DAY || "", 10) || 4;

/** 24h / max × 0.8 — five opportunities for four videos. See the header. */
export const videoMinIntervalMs = () =>
  Number.parseInt(process.env.VIDEO_MIN_INTERVAL_MS || "", 10) ||
  Math.round((24 * 60 * 60 * 1000 / VIDEO_MAX_PER_DAY()) * 0.8);

export const autopostEnabled = () => process.env.VIDEO_AUTOPOST_ENABLED === "1";

/** The Facebook cross-post's kill switch. Ships dark; flip to "1" to enable. */
export const facebookCrossPostEnabled = () => process.env.VIDEO_FACEBOOK_ENABLED === "1";

/**
 * The Facebook REELS kill switch — separate from the feed cross-post above,
 * and default OFF (DrJ, 2026-08-13: "turn this on deliberately after seeing the
 * first one, not discover it live").
 *
 * SEPARATE FROM VIDEO_FACEBOOK_ENABLED on purpose. They are different surfaces
 * with different failure modes: the feed post is a native video on the page,
 * the Reel enters the short-form feed. One flag would mean enabling the
 * unproven surface as a side effect of the proven one, and turning the proven
 * one off to disable the unproven one.
 *
 * REQUIRES A VERTICAL RENDER. A 1920x1080 MP4 posted to /video_reels is the
 * wrong shape for the surface — which is exactly why this was written and never
 * wired up until the 9:16 path existed.
 */
export const facebookReelsEnabled = () => process.env.VIDEO_FACEBOOK_REELS_ENABLED === "1";

/** Instagram Reels. Its own switch, dark by default, same reasoning as above. */
export const instagramReelsEnabled = () => process.env.VIDEO_INSTAGRAM_REELS_ENABLED === "1";

/**
 * Instagram's own rolling-24h cap, mirroring VIDEO_FACEBOOK_MAX_PER_DAY exactly:
 * unset tracks VIDEO_MAX_PER_DAY (12 in prod, read live 2026-08-13 — NOT the
 * code default of 4), set throttles independently, and 0 is honoured as ZERO
 * rather than treated as unset. Someone throttling during an incident types 0
 * before they type 1.
 */
export const VIDEO_INSTAGRAM_MAX_PER_DAY = () => {
  const raw = process.env.VIDEO_INSTAGRAM_MAX_PER_DAY;
  if (raw === undefined || raw === "") return VIDEO_MAX_PER_DAY();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : VIDEO_MAX_PER_DAY();
};

/**
 * Instagram's Reels duration ceiling, in seconds. Default 90.
 *
 * AN EDGE, NOT A MARGIN (DrJ, 2026-08-13). §5 says the format runs 60-100s and
 * observed output is 60-100s, so our own renders REACH and can exceed this. It
 * is therefore checked explicitly against the measured file rather than assumed
 * from the format's intent — a video one second over is rejected by Meta at
 * PUBLISH time, after the container has been created and the URL fetched, which
 * is the most expensive place to discover it.
 */
export const INSTAGRAM_REEL_MAX_SECS = () =>
  Number.parseFloat(process.env.VIDEO_INSTAGRAM_MAX_SECS || "") || 90;

/**
 * The public URL Meta fetches. Our own server, the one adminAuth-exempt prefix.
 *
 * Deliberately built from the ARTICLE ID rather than the filename: the route
 * resolves the design-key suffix itself, so a re-render between publish attempts
 * does not invalidate a URL already handed to Meta.
 */
/** Threads video. Its own switch, dark by default. */
export const threadsVideoEnabled = () => process.env.VIDEO_THREADS_ENABLED === "1";

/** Threads' rolling-24h cap. Same shape as the other two; 0 means zero. */
export const VIDEO_THREADS_MAX_PER_DAY = () => {
  const raw = process.env.VIDEO_THREADS_MAX_PER_DAY;
  if (raw === undefined || raw === "") return VIDEO_MAX_PER_DAY();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : VIDEO_MAX_PER_DAY();
};

export const publicVideoUrl = (articleId) =>
  `${SITE_ORIGIN}/scoop-ops/videos-gen/file/${encodeURIComponent(articleId)}`;

/**
 * Facebook's own rolling-24h cap. Unset it and Facebook tracks YouTube, so
 * raising VIDEO_MAX_PER_DAY does not silently leave Facebook behind; set it and
 * Facebook throttles independently, which is the one env line this needs to be
 * if Meta reacts badly to the volume.
 *
 * 0 is honoured as ZERO, not treated as unset. Someone throttling during an
 * incident types 0 before they type 1, and `|| VIDEO_MAX_PER_DAY()` would have
 * quietly turned that into twelve.
 */
export const VIDEO_FACEBOOK_MAX_PER_DAY = () => {
  const raw = process.env.VIDEO_FACEBOOK_MAX_PER_DAY;
  if (raw === undefined || raw === "") return VIDEO_MAX_PER_DAY();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : VIDEO_MAX_PER_DAY();
};

const SITE_ORIGIN = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");

const MAX_ATTEMPTS = Number.parseInt(process.env.VIDEO_MAX_ATTEMPTS_PER_CYCLE || "", 10) || 8;
const CYCLE_HANG_MS = Number.parseInt(process.env.VIDEO_CYCLE_HANG_MS || "", 10) || 60 * 60 * 1000;
const FONT_FILE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../assets/fonts/Inter-SemiBold.otf");

// ─── The stale-override guard ───────────────────────────────────────────────
//
// { startedAt } | null, never a bare boolean. A plain isRunning flag that is
// never cleared — because the cycle threw somewhere without a finally, or the
// process was killed mid-render — wedges the loop into permanent silence with
// no signal. Skip only while the in-flight cycle is YOUNGER than
// CYCLE_HANG_MS; past that, log HUNG and let the fresh cycle proceed, because
// the wedged one is unrecoverable anyway.
let cycleInFlight = null;

/** YouTube's 403 quotaExceeded, which arrives as an ordinary upload failure. */
export function isQuotaExceeded(err) {
  const s = `${err?.message || ""}`;
  return /\b403\b/.test(s) && /quota|quotaExceeded|dailyLimitExceeded/i.test(s);
}

// ─── Rate gates ─────────────────────────────────────────────────────────────

export function rateGate({ now = Date.now() } = {}) {
  const max = VIDEO_MAX_PER_DAY();
  const published24h = countVideosPublishedSince(now - 24 * 60 * 60 * 1000);
  if (published24h >= max) {
    return { ok: false, gate: "daily-cap", reason: `${published24h}/${max} published in the last 24h` };
  }
  const last = lastVideoPublishedAt();
  const interval = videoMinIntervalMs();
  if (last && now - last < interval) {
    const waitM = Math.ceil((interval - (now - last)) / 60000);
    return { ok: false, gate: "spacing", reason: `last publish ${Math.round((now - last) / 60000)}m ago, ${waitM}m to go` };
  }
  return { ok: true, published24h, max };
}

// ─── Produce one video ──────────────────────────────────────────────────────

async function produceVideo(article, spec, attribution = resolveAttribution(article)) {
  // ORIENTATION. Vertical by default — Shorts and Reels are the only surfaces
  // that push video to people who have not heard of the channel, and a vertical
  // MP4 under the length limit uploaded through the existing YouTube API IS a
  // Short. No new upload path is needed; this is layout, not distribution.
  // VIDEO_ORIENTATION=horizontal is the one-line revert.
  const orientation = DEFAULT_ORIENTATION;
  // The spec arrives ALREADY DECORATED. writeVideoSpec injects the title's
  // badge, date and verbal credit BEFORE it validates, because §3b/3 checks the
  // title caption for that credit — decorating here instead is what dropped
  // stat@1 and bars@4 from a live video for "first use of Yahoo Finance carries
  // no verbal credit". One owner, and it is the one that runs first.
  const slides = spec.slides;

  const audio = await voiceSpec(slides, { articleId: article.id });

  const work = acquireFrameDir(`autopost-${article.id}`);
  try {
    const segments = [];
    for (let i = 0; i < slides.length; i++) {
      const card = slides[i];
      const audioSecs = audio[i].durationSecs;
      let states = statesForCard(card, { outlet: attribution.publisher, slideIndex: i, slideCount: slides.length, orientation });
      states = fitStatesToDuration(states, audioSecs, { cardType: card.t, slideIndex: i });
      const hold = holdForAudio(audioSecs, states.length);

      const paths = [];
      for (const st of states) {
        const p = path.join(work, `s${String(i).padStart(2, "0")}-${st.key}.png`);
        const { writeFileSync } = await import("fs");
        writeFileSync(p, await renderState(st, { orientation }));
        paths.push(p);
      }
      const seg = path.join(work, `slide${String(i).padStart(2, "0")}.mp4`);
      await assembleSlide({
        statePaths: paths, hold, outputPath: seg, driftDir: i, orientation,
        audioPath: audio[i].path, captionText: card.caption, workDir: work, fontFile: FONT_FILE,
      });
      segments.push(seg);
    }
    const out = path.join(VIDEOS_DIR, `${article.id}-${videoDesignKey()}.mp4`);
    await concatSlides({ segmentPaths: segments, outputPath: out, workDir: work });
    if (!existsSync(out) || statSync(out).size < 10_000) {
      throw new Error(`assembled video is missing or implausibly small: ${out}`);
    }
    return { path: out, slides };
  } finally {
    releaseFrameDir(work);
  }
}

// ─── Facebook cross-post ────────────────────────────────────────────────────
//
// Runs AFTER the YouTube upload has already succeeded and been recorded, on the
// same MP4, in the same cycle — well inside the 48h retention window, so the
// file is always still on disk.
//
// THIS FUNCTION NEVER THROWS AND NEVER RETURNS A REASON TO RETRY. A published
// YouTube video is irreversible; a Facebook failure must not be able to reach
// any of the three things that would undo or repeat it:
//
//   markVideoFailed  — would flip a row whose YouTube video is live back to
//                      'failed', and the stale-pending retire rule would make
//                      the article selectable again. UNIQUE(article_id) does
//                      not help: the row exists, it just is not 'published'.
//                      markVideoFacebook writes a disjoint set of columns and
//                      cannot touch `status`.
//   isQuotaExceeded  — matches /403/ AND /quota/i on a bare message string.
//                      Meta says both in ordinary throttling errors, and a
//                      match there aborts the whole cycle for a YouTube quota
//                      that is fine.
//   the job          — a throw escaping runVideoRenderCycle re-runs the BullMQ
//                      job, and the in-flight guard is time-based, not
//                      idempotent.
//
// So every path below is caught here and reported as a value.
export async function crossPostToFacebook(article, {
  filePath, title, attribution, spec = null, slides = null, now = Date.now(),
} = {}) {
  // Flag off: write NOTHING. NULL in facebook_status means "never attempted",
  // and that is exactly true of a dark period — recording 'skipped' for every
  // video shipped while the flag is off would make the column lie about a
  // decision that was never taken. Migration 023's header owns this.
  if (!facebookCrossPostEnabled()) return { status: "off" };

  try {
    // RULE 0, FOR THIS SURFACE. Added 2026-08-13. It was NOT here: the cycle's
    // single assertPublishAllowed sits ahead of the YouTube upload, and this
    // function runs after it, so Pakistan content could not reach Meta — but
    // only because of ORDERING. Rule 0 is three independent layers precisely so
    // that no publish path is safe merely by accident of sequence; a reorder or
    // an early return would have opened this one silently. Not a live escape,
    // and now not reliant on one.
    try {
      assertPublishAllowed(article, [spec, slides].filter(Boolean));
    } catch (blockErr) {
      logger.error(
        `🛑 RULE 0 REFUSED the Facebook cross-post for ${article.id} — ${blockErr.message}. ` +
        `Nothing was sent to Meta.`
      );
      try { markVideoFacebook(article.id, { status: "skipped", error: `rule0: ${blockErr.message}` }); }
      catch { /* bookkeeping is best-effort */ }
      return { status: "refused", reason: "rule0" };
    }

    if (!isFacebookConfigured()) {
      // A missing credential with the flag ON is a config problem, not an
      // editorial one — the same distinction the spec/voice gates draw above.
      // Recorded so a day of twelve videos and zero posts is attributable.
      logger.error(
        "🚨 VIDEO_FACEBOOK_ENABLED=1 but Facebook is not configured (FACEBOOK_PAGE_ID / " +
        "FACEBOOK_PAGE_TOKEN). The video is published to YouTube; the cross-post is skipped."
      );
      markVideoFacebook(article.id, { status: "skipped", error: "facebook not configured" });
      return { status: "skipped", reason: "not-configured" };
    }

    const max = VIDEO_FACEBOOK_MAX_PER_DAY();
    const posted24h = countFacebookPostsSince(now - 24 * 60 * 60 * 1000);
    if (posted24h >= max) {
      logger.info(`📘 facebook cross-post SKIPPED — cap ${posted24h}/${max} in the last 24h`);
      markVideoFacebook(article.id, { status: "skipped", error: `daily cap ${posted24h}/${max}` });
      return { status: "skipped", reason: "daily-cap" };
    }

    // §3b/4's rule, unchanged: the original is credited and linked FIRST.
    const description = [
      title,
      buildDescriptionCredit(article, attribution),
      `Full story → ${SITE_ORIGIN}/article/${encodeURIComponent(article.id)}` +
        `?utm_source=social_facebook_video&utm_medium=social&utm_campaign=scoop_video`,
    ].filter(Boolean).join("\n\n");

    const fb = await postVideoToFacebook({ filePath, title, description });
    markVideoFacebook(article.id, { status: "posted", postId: fb.id });
    logger.info(`📘 FACEBOOK CROSS-POSTED ${fb.id} (${posted24h + 1}/${max} today) — ${fb.url}`);
    return { status: "posted", id: fb.id, url: fb.url };

  } catch (err) {
    // LOUD. Best-effort does not mean quiet: this is the only signal that the
    // page has stopped accepting video, and the YouTube upload succeeding means
    // nothing else in the cycle will look wrong.
    logger.error(
      `🚨 FACEBOOK CROSS-POST FAILED for ${article.id} — the YouTube video IS published and stays ` +
      `published; only the Facebook post is lost. ${err.message}`
    );
    try {
      markVideoFacebook(article.id, { status: "failed", error: err.message });
    } catch (dbErr) {
      // Even the bookkeeping is best-effort. Nothing here may reach the caller.
      logger.error(`🚨 facebook cross-post: could not record the failure either: ${dbErr.message}`);
    }
    return { status: "failed", error: err.message };
  }
}

/**
 * Publish the SAME rendered MP4 as a Facebook REEL.
 *
 * A SECOND SURFACE, not a second attempt at the first. The feed cross-post above
 * puts a native video on the page; this enters the short-form Reels feed, which
 * is one of the few surfaces that shows video to people who have never heard of
 * the channel. Both can run; neither depends on the other.
 *
 * RULE 0 IS ASSERTED HERE, INDEPENDENTLY. The cycle already calls
 * assertPublishAllowed before the YouTube upload, and because that call sits
 * ahead of every publish it currently protects this one too — TRANSITIVELY, by
 * ordering. That is not how Rule 0 is designed: it is three INDEPENDENT layers
 * precisely so that no surface is protected only because something else
 * happened to run first. A reorder, an early return, or someone moving the
 * cross-post ahead of the gate would silently open a publish path to Meta. So
 * this surface asserts for itself, and the assertion is the first thing it does.
 *
 * IT STILL NEVER THROWS, for the same three reasons crossPostToFacebook does
 * not (see its header): markVideoFailed would flip a row whose YouTube video is
 * live, isQuotaExceeded would match Meta's 403s, and a throw escaping the cycle
 * re-runs the BullMQ job. A Rule 0 refusal is therefore caught and returned as
 * a value — REFUSED, loudly, but never as an exception.
 */
export async function reelToFacebook(article, {
  filePath, title, attribution, spec = null, slides = null, now = Date.now(),
} = {}) {
  if (!facebookReelsEnabled()) return { status: "off" };

  try {
    // ── Rule 0, layer 3, for THIS surface ──
    // Checked against the article AND everything generated, exactly as the
    // pre-upload gate does. Throws; caught immediately below and converted.
    try {
      assertPublishAllowed(article, [spec, slides].filter(Boolean));
    } catch (blockErr) {
      logger.error(
        `🛑 RULE 0 REFUSED the Facebook Reel for ${article.id} — ${blockErr.message}. ` +
        `Nothing was sent to Meta.`
      );
      try { markVideoFacebook(article.id, { status: "skipped", error: `rule0: ${blockErr.message}` }); }
      catch { /* bookkeeping is best-effort */ }
      return { status: "refused", reason: "rule0" };
    }

    if (!isFacebookConfigured()) {
      logger.error(
        "🚨 VIDEO_FACEBOOK_REELS_ENABLED=1 but Facebook is not configured " +
        "(FACEBOOK_PAGE_ID / FACEBOOK_PAGE_TOKEN). The Reel is skipped."
      );
      return { status: "skipped", reason: "not-configured" };
    }

    // The Reels cap is the FEED cap's sibling, deliberately reusing the same
    // rolling-24h counter: both land on the same page, and Meta rate-limits the
    // page, not the surface.
    const max = VIDEO_FACEBOOK_MAX_PER_DAY();
    const posted24h = countFacebookPostsSince(now - 24 * 60 * 60 * 1000);
    if (posted24h >= max) {
      logger.info(`🎞️ facebook REEL skipped — cap ${posted24h}/${max} in the last 24h`);
      return { status: "skipped", reason: "daily-cap" };
    }

    // §3b/4 — the original is credited and linked, same as every other surface.
    const caption = [
      title,
      buildDescriptionCredit(article, attribution),
      `Full story → ${SITE_ORIGIN}/article/${encodeURIComponent(article.id)}` +
        `?utm_source=social_facebook_reel&utm_medium=social&utm_campaign=scoop_video`,
    ].filter(Boolean).join("\n\n").slice(0, 2200);

    const fb = await postReelToFacebook({ filePath, caption });
    logger.info(`🎞️ FACEBOOK REEL PUBLISHED ${fb.id} — ${fb.url}`);
    return { status: "posted", id: fb.id, url: fb.url };

  } catch (err) {
    // LOUD. postReelToFacebook no longer degrades to a link post, so an error
    // here means NOTHING was published — which is the outcome we asked for, and
    // is worth a line every time.
    logger.error(
      `🚨 FACEBOOK REEL FAILED for ${article.id} — nothing was posted to the Reels feed. ` +
      `The YouTube video IS published and unaffected. ${err.message}`
    );
    return { status: "failed", error: err.message };
  }
}

/**
 * Publish the SAME rendered MP4 as an INSTAGRAM REEL.
 *
 * A URL-FETCH SURFACE, which is what makes it different in kind from the two
 * Facebook ones. Meta does not receive bytes: it is handed a public URL to our
 * own server and fetches it asynchronously, after the container is created. Two
 * consequences the code has to carry rather than assume:
 *
 *   1. `instagram_status` is set to 'pending' BEFORE the container exists and
 *      only moved off it on a terminal outcome. sweepVideos reads that to hold
 *      the MP4 past retention — otherwise the 48h sweep, which runs at WORKER
 *      STARTUP rather than on a clock, can delete the file Meta is still
 *      fetching and the publish fails long after we logged success.
 *   2. The duration ceiling is checked against the MEASURED file, not against
 *      the format's intent. See INSTAGRAM_REEL_MAX_SECS.
 *
 * RULE 0 IS ASSERTED HERE, INDEPENDENTLY, for the same reason as the Facebook
 * surfaces: three independent layers, no publish path protected only by its
 * position in the cycle.
 *
 * NEVER THROWS, same contract as its siblings — markVideoFailed would flip a row
 * whose YouTube video is live, isQuotaExceeded matches Meta's 403s, and a throw
 * escaping the cycle re-runs the BullMQ job.
 */
export async function reelToInstagram(article, {
  filePath, title, attribution, spec = null, slides = null, now = Date.now(),
} = {}) {
  if (!instagramReelsEnabled()) return { status: "off" };

  try {
    try {
      assertPublishAllowed(article, [spec, slides].filter(Boolean));
    } catch (blockErr) {
      logger.error(
        `🛑 RULE 0 REFUSED the Instagram Reel for ${article.id} — ${blockErr.message}. ` +
        `Nothing was sent to Meta and no URL was published.`
      );
      try { markVideoInstagram(article.id, { status: "skipped", error: `rule0: ${blockErr.message}` }); }
      catch { /* bookkeeping is best-effort */ }
      return { status: "refused", reason: "rule0" };
    }

    if (!isInstagramConfigured()) {
      logger.error(
        "🚨 VIDEO_INSTAGRAM_REELS_ENABLED=1 but Instagram is not configured — the Reel is skipped."
      );
      try { markVideoInstagram(article.id, { status: "skipped", error: "instagram not configured" }); } catch {}
      return { status: "skipped", reason: "not-configured" };
    }

    const max = VIDEO_INSTAGRAM_MAX_PER_DAY();
    const posted24h = countInstagramPostsSince(now - 24 * 60 * 60 * 1000);
    if (posted24h >= max) {
      logger.info(`📸 instagram REEL skipped — cap ${posted24h}/${max} in the last 24h`);
      try { markVideoInstagram(article.id, { status: "skipped", error: `daily cap ${posted24h}/${max}` }); } catch {}
      return { status: "skipped", reason: "daily-cap" };
    }

    // ── The duration ceiling, measured ──
    const limit = INSTAGRAM_REEL_MAX_SECS();
    let secs = null;
    try {
      const { probeDurationSecs } = await import("./videoVoice.js");
      secs = probeDurationSecs(filePath);
    } catch (err) {
      // Cannot measure => cannot promise it is under the cap. Refuse rather than
      // hand Meta a URL and find out at publish time.
      logger.error(`🚨 instagram REEL skipped — could not measure ${filePath}: ${err.message}`);
      try { markVideoInstagram(article.id, { status: "skipped", error: `unmeasurable: ${err.message}` }); } catch {}
      return { status: "skipped", reason: "unmeasurable" };
    }
    if (secs > limit) {
      logger.error(
        `🚨 instagram REEL skipped — ${secs.toFixed(1)}s exceeds the ${limit}s ceiling. The format ` +
        `runs 60-100s (§5), so this is an EDGE the pipeline reaches, not a margin. Nothing was sent.`
      );
      try { markVideoInstagram(article.id, { status: "skipped", error: `${secs.toFixed(1)}s > ${limit}s` }); } catch {}
      return { status: "skipped", reason: "too-long", seconds: secs };
    }

    const caption = [
      title,
      buildDescriptionCredit(article, attribution),
      `Full story → ${SITE_ORIGIN}/article/${encodeURIComponent(article.id)}` +
        `?utm_source=social_instagram_reel&utm_medium=social&utm_campaign=scoop_video`,
    ].filter(Boolean).join("\n\n").slice(0, 2200);

    // PENDING BEFORE THE CONTAINER. The window that needs protecting opens the
    // moment Meta is told about the URL, so the marker must precede the call.
    markVideoInstagram(article.id, { status: "pending" });

    const ig = await postReelToInstagram({ videoUrl: publicVideoUrl(article.id), caption });
    markVideoInstagram(article.id, { status: "posted", postId: ig.id });
    logger.info(`📸 INSTAGRAM REEL PUBLISHED ${ig.id} (${posted24h + 1}/${max} today) — ${ig.url}`);
    return { status: "posted", id: ig.id, url: ig.url, seconds: secs };

  } catch (err) {
    logger.error(
      `🚨 INSTAGRAM REEL FAILED for ${article.id} — nothing was published. The YouTube video IS ` +
      `published and unaffected. ${err.message}`
    );
    // OFF 'pending' ON EVERY TERMINAL PATH. A row left pending would hold its
    // MP4 for the full 24h hold and then warn — which is correct behaviour for
    // a genuine in-flight publish and pure noise for a failed one.
    try { markVideoInstagram(article.id, { status: "failed", error: err.message }); }
    catch (dbErr) { logger.error(`🚨 instagram: could not record the failure either: ${dbErr.message}`); }
    return { status: "failed", error: err.message };
  }
}

/**
 * Publish the SAME rendered MP4 to THREADS.
 *
 * The second URL-fetch surface, and the slowest: on top of the container poll,
 * Threads wants an unconditional ~30s wait before publish (see
 * THREADS_VIDEO_WAIT_MS). That half-minute of deliberate sleep inside the render
 * job is exactly why the BullMQ lock had to be fixed before this channel could
 * exist — it was losing a 30s lock before anything slept in it at all.
 *
 * Rule 0 asserted independently; 'pending' set before the container so the sweep
 * cannot delete the file mid-fetch; never throws. Same contract as its siblings.
 */
export async function videoToThreads(article, {
  filePath, title, attribution, spec = null, slides = null, now = Date.now(),
} = {}) {
  if (!threadsVideoEnabled()) return { status: "off" };

  try {
    try {
      assertPublishAllowed(article, [spec, slides].filter(Boolean));
    } catch (blockErr) {
      logger.error(
        `🛑 RULE 0 REFUSED the Threads video for ${article.id} — ${blockErr.message}. ` +
        `Nothing was sent to Meta and no URL was published.`
      );
      try { markVideoThreads(article.id, { status: "skipped", error: `rule0: ${blockErr.message}` }); } catch {}
      return { status: "refused", reason: "rule0" };
    }

    if (!isThreadsConfigured()) {
      logger.error("🚨 VIDEO_THREADS_ENABLED=1 but Threads is not configured — the video is skipped.");
      try { markVideoThreads(article.id, { status: "skipped", error: "threads not configured" }); } catch {}
      return { status: "skipped", reason: "not-configured" };
    }

    const max = VIDEO_THREADS_MAX_PER_DAY();
    const posted24h = countThreadsPostsSince(now - 24 * 60 * 60 * 1000);
    if (posted24h >= max) {
      logger.info(`🧵 threads video skipped — cap ${posted24h}/${max} in the last 24h`);
      try { markVideoThreads(article.id, { status: "skipped", error: `daily cap ${posted24h}/${max}` }); } catch {}
      return { status: "skipped", reason: "daily-cap" };
    }

    // Threads' documented ceiling is 5 minutes, far above the 60-100s format, so
    // there is no duration edge here as there is on Instagram. Not checked
    // rather than checked-and-always-passing: a guard that cannot fire reads as
    // protection and provides none.
    const text = [
      title,
      buildDescriptionCredit(article, attribution),
      `Full story → ${SITE_ORIGIN}/article/${encodeURIComponent(article.id)}` +
        `?utm_source=social_threads_video&utm_medium=social&utm_campaign=scoop_video`,
    ].filter(Boolean).join("\n\n").slice(0, 500);

    markVideoThreads(article.id, { status: "pending" });

    const th = await postVideoToThreads({ text, videoUrl: publicVideoUrl(article.id) });
    markVideoThreads(article.id, { status: "posted", postId: th.id });
    logger.info(`🧵 THREADS VIDEO PUBLISHED ${th.id} (${posted24h + 1}/${max} today) — ${th.url}`);
    return { status: "posted", id: th.id, url: th.url };

  } catch (err) {
    logger.error(
      `🚨 THREADS VIDEO FAILED for ${article.id} — nothing was published. The YouTube video IS ` +
      `published and unaffected. ${err.message}`
    );
    try { markVideoThreads(article.id, { status: "failed", error: err.message }); }
    catch (dbErr) { logger.error(`🚨 threads: could not record the failure either: ${dbErr.message}`); }
    return { status: "failed", error: err.message };
  }
}

// ─── The cycle ──────────────────────────────────────────────────────────────

/**
 * One pass: gates → candidates → first article that survives everything gets
 * a video and an upload. Returns a structured result for the job log.
 */
/**
 * @param {object}  [opts]
 * @param {boolean} [opts.dryRun] — render and stop; never claims, never uploads.
 * @param {number}  [opts.now]
 * @param {object}  [opts.deps] — TEST SEAM ONLY. Overrides for the collaborators
 *        this cycle calls out to. Production passes nothing and gets the real
 *        imports below. It exists because the failure that took the cycle down
 *        (a rejected first candidate aborting the run) is only observable by
 *        driving runVideoRenderCycle itself, and node:test cannot stub ES module
 *        imports without --experimental-test-module-mocks, which the suite does
 *        not run with. Everything NOT listed here — the gates, the rate limits,
 *        the DB — stays real in tests, so this is a seam, not a mock harness.
 */
export async function runVideoRenderCycle({ dryRun = false, now = Date.now(), deps = {} } = {}) {
  const {
    writeVideoSpec: _writeVideoSpec = writeVideoSpec,
    writePackaging: _writePackaging = writePackaging,
    produceVideo: _produceVideo = produceVideo,
    uploadToYouTube: _uploadToYouTube = uploadToYouTube,
    isVoiceConfigured: _isVoiceConfigured = isVoiceConfigured,
    isYouTubeConfigured: _isYouTubeConfigured = isYouTubeConfigured,
    isVideoSpecEnabled: _isVideoSpecEnabled = isVideoSpecEnabled,
    // Stubbable so the isolation is testable: a test can make this throw and
    // assert the YouTube publish is untouched. That property is the whole
    // design constraint, and it is not observable any other way.
    crossPostToFacebook: _crossPostToFacebook = crossPostToFacebook,
    reelToFacebook: _reelToFacebook = reelToFacebook,
    reelToInstagram: _reelToInstagram = reelToInstagram,
    videoToThreads: _videoToThreads = videoToThreads,
  } = deps;

  if (!autopostEnabled()) {
    logger.info("🎬 video autopost DISABLED (VIDEO_AUTOPOST_ENABLED != 1)");
    return { skipped: "disabled" };
  }

  // Stale-override guard.
  if (cycleInFlight) {
    const age = now - cycleInFlight.startedAt;
    if (age < CYCLE_HANG_MS) {
      logger.warn(`⏸️ video cycle already running (${Math.round(age / 60000)}m) — skipping`);
      return { skipped: "in-flight" };
    }
    logger.error(
      `🫀 video cycle HUNG — started ${Math.round(age / 60000)}m ago and never completed ` +
      `(threshold ${Math.round(CYCLE_HANG_MS / 60000)}m). Proceeding with a fresh cycle; the wedged one is unrecoverable.`
    );
  }

  const startedAt = now;
  cycleInFlight = { startedAt };
  // Evaluate staleness against the PREVIOUS heartbeat before stamping this one,
  // so a cycle returning after a gap logs the gap it recovered from — the same
  // ordering the social cycle uses, and the reason that one reported 933m.
  try { getVideoCycleHealth({ now }); } catch { /* telemetry never blocks */ }
  try { recordHeartbeat(VIDEO_CYCLE_HEARTBEAT, { phase: "start", startedAt }); } catch { /* telemetry never blocks */ }
  if (!dryRun) pingStart(VIDEO_PING);

  const attempts = [];
  let produced = null, spendUsd = 0;
  let current = null;   // the attempt in flight, so a throw is attributable

  try {
    const rate = rateGate({ now });
    if (!rate.ok) {
      logger.info(`🎬 video cycle: ${rate.gate} — ${rate.reason}`);
      return finish({ skipped: rate.gate, reason: rate.reason });
    }
    // CONFIG IS CHECKED ONCE, HERE, AND ABORTS LOUDLY.
    //
    // A missing flag is not an editorial outcome, and treating it as one is how
    // the first dry run read: VIDEO_SPEC_ENABLED was unset, so writeVideoSpec
    // rejected every candidate with "VIDEO_SPEC_ENABLED not set", and the cycle
    // reported eight ordinary-looking spec skips. Eight identical refusals for a
    // reason no article could ever satisfy is a misconfiguration wearing a
    // yield report's clothes. One error line, one exit.
    if (!_isVideoSpecEnabled()) {
      logger.error(
        "🚨 video cycle ABORTED — VIDEO_SPEC_ENABLED is not 1, or GEMINI_API_KEY is unset. " +
        "No candidate can produce a spec in this configuration; skipping every article one at a " +
        "time would report this as a yield problem instead of a config problem."
      );
      return finish({ skipped: "no-spec", reason: "VIDEO_SPEC_ENABLED or GEMINI_API_KEY unset" });
    }
    if (!_isVoiceConfigured()) {
      logger.error("🚨 video cycle ABORTED — ELEVENLABS_API_KEY unset; §5 makes voice a hard requirement.");
      return finish({ skipped: "no-voice", reason: "ELEVENLABS_API_KEY unset" });
    }
    if (!_isYouTubeConfigured() && !dryRun) {
      logger.error("🚨 video cycle ABORTED — YouTube is not configured and this is not a dry run.");
      return finish({ skipped: "no-youtube", reason: "YouTube not configured" });
    }

    // Rule 0 FIRST, ahead of every editorial gate. It is absolute and must not
    // be reachable only after something cheaper happened to pass.
    const raw = findFreshUnvideoedArticles({ limit: MAX_ATTEMPTS * 6, now });
    const afterRule0 = filterAtSelection(raw);

    // PUBLISHER DIVERSITY AT SELECTION. Length-first ordering handed the window
    // to whoever writes longest — Yahoo Finance took 5 of 7 candidates, then 2
    // of 2. The publish-time cooldown cannot fix that: it refuses the second
    // VIDEO, long after the cycle has spent all eight attempts inside one
    // masthead. Capping the attempt list is the only place this is reachable.
    const { kept: eligible, dropped: crowded } = diversifyByPublisher(afterRule0);
    logger.info(
      `🎬 video cycle: ${raw.length} fresh → ${afterRule0.length} after Rule 0 → ` +
      `${eligible.length} after publisher diversity (max ${MAX_PER_PUBLISHER}/publisher` +
      `${crowded.length ? `, dropped ${crowded.length}` : ""}) · ${rate.published24h}/${rate.max} today`
    );
    if (crowded.length) {
      const by = {};
      for (const a of crowded) by[a.source_name || "(none)"] = (by[a.source_name || "(none)"] || 0) + 1;
      // NO SILENT CAPS. What was set aside, and whose, is stated.
      logger.info(`🎬 diversity set aside: ${Object.entries(by).map(([k, n]) => `${k} x${n}`).join(", ")}`);
    }

    for (const article of eligible) {
      if (attempts.length >= MAX_ATTEMPTS) {
        logger.warn(`🎬 video cycle: hit the ${MAX_ATTEMPTS}-attempt cap without producing a video`);
        break;
      }
      const n = attempts.length + 1;

      // RECORDED AT ATTEMPT TIME, NOT ON COMPLETION. Every stage below used to
      // push its own record when it finished, so anything that threw — the null
      // deref on the spec result being the one that actually happened — left no
      // trace at all, and the cycle reported "tried 0" having tried one. The
      // record goes in first and is annotated as the article advances, so a
      // throw leaves behind the stage it died in. `current` lets the outer catch
      // attach the error to the right attempt.
      const rec = { n, id: article.id, stage: "selected", reason: null };
      attempts.push(rec);
      current = rec;

      const gate = selectionGate(article, { now });
      if (!gate.ok) {
        rec.stage = gate.gate; rec.reason = gate.reason;
        logger.info(`🎬 ${n} SKIP ${gate.gate}: ${gate.reason} — ${String(article.title).slice(0, 60)}`);
        continue;
      }

      // Resolved ONCE, before anything names a publisher. §3b/3's verbal-credit
      // matching keys off this too — if the spec must credit someone aloud, it
      // has to be the same someone the card and the SOURCE: line show.
      const attribution = resolveAttribution(article);
      rec.publisher = attribution.publisher;
      rec.attributionBasis = attribution.basis;
      if (attribution.basis === "url_domain") {
        // Not a failure — the general rule working. Logged because a run that
        // suddenly credits bare domains is either meeting a lot of aggregators
        // or has a broken suffix table, and those need telling apart.
        logger.info(
          `🎬 ${n} attribution: source_name "${attribution.sourceName}" does not match ` +
          `${attribution.domain} — crediting the domain`
        );
      }

      rec.stage = "spec";
      const r = await _writeVideoSpec(article, {
        allowedSources: [attribution.publisher].filter(Boolean),
        attribution,
      });
      // ASSERT THE SHAPE, DON'T TRUST IT. writeVideoSpec's contract is
      // `{ ok, spec, costUsd, reason, attempts }` on every path, but reading
      // `.costUsd` off a bare null is what took the 2026-08-03 cycle down —
      // one stale exit in the callee cost every remaining candidate. A broken
      // contract is now one loud skipped article, not a dead run.
      if (!r || typeof r !== "object" || typeof r.ok !== "boolean") {
        rec.reason = `writeVideoSpec broke its contract — returned ${r === null ? "null" : typeof r}`;
        logger.error(
          `🚨 ${n} SKIP spec: ${rec.reason}. Expected { ok, spec, costUsd, reason, attempts }. ` +
          `This is a code defect, not an editorial outcome — the article is skipped, the cycle continues.`
        );
        continue;
      }
      spendUsd += r.costUsd || 0;
      rec.costUsd = r.costUsd;
      if (!r.ok) {
        rec.reason = r.reason;
        logger.info(`🎬 ${n} SKIP spec: ${r.reason}`);
        continue;
      }

      // §6.2 — a degrade path anywhere in generation disqualifies the article.
      if (r.spec.meta.finishReason && r.spec.meta.finishReason !== "STOP") {
        rec.stage = "degraded"; rec.reason = `finishReason=${r.spec.meta.finishReason}`;
        continue;
      }

      let video;
      rec.stage = "produce";
      try {
        video = await _produceVideo(article, r.spec, attribution);
      } catch (err) {
        rec.reason = err.message;
        logger.warn(`🎬 ${n} SKIP produce: ${err.message}`);
        continue;
      }

      // Rule 0 LAYER 3 — throws. Re-checked against the article AND everything
      // generated, immediately before upload, assuming layers 1 and 2 did not run.
      rec.stage = "rule0-publish";
      assertPublishAllowed(article, [r.spec, video.slides]);

      const packaging = await _writePackaging(r.spec, article);
      const title = packaging?.titles?.[0] || article.title;

      if (dryRun) {
        produced = { articleId: article.id, path: video.path, title, dryRun: true };
        rec.stage = "ok-dry";
        break;
      }

      // WRITE BEFORE UPLOAD.
      claimVideoPost({
        articleId: article.id, eventId: gate.eventId || null,
        sourceName: article.source_name, title: article.title,
      });

      rec.stage = "upload";
      try {
        const up = await _uploadToYouTube({
          filePath: video.path, title,
          // §3b/4 — the original, linked ABOVE THE FOLD. YouTube shows roughly
          // two lines before "more", so the credit goes FIRST and the hook
          // follows it. This was previously the hook alone, with no credit and
          // no link at all.
          description: [
            buildDescriptionCredit(article, attribution),
            packaging?.description_hook || "",
          ].filter(Boolean).join("\n\n"),
          tags: packaging?.tags || [], isShort: false,
        });
        markVideoPublished(article.id, {
          youtubeId: up.videoId || up.id || String(up),
          privacyStatus: process.env.YOUTUBE_PRIVACY || "public",
          titleVariants: packaging?.titles || null,
        });
        produced = { articleId: article.id, youtubeId: up.videoId || up.id, title };
        rec.stage = "ok";
        logger.info(`🎬 PUBLISHED ${produced.youtubeId} — "${title}"`);

        // ─── Facebook cross-post ───────────────────────────────────────────
        //
        // NESTED INSIDE THE UPLOAD TRY, which is unavoidable here: the YouTube
        // publish is only recorded a few lines up and the `break` is below, so
        // there is no point in this scope that is outside it. That makes the
        // inner catch LOAD-BEARING, not defensive decoration — it is the only
        // thing standing between a Facebook throw and the outer `catch (err)`,
        // which would:
        //   - call markVideoFailed on an article whose YouTube video is LIVE,
        //     flipping status to 'failed' so the stale-pending rule re-selects
        //     it and uploads the same video again, and
        //   - run isQuotaExceeded over the Meta message, where a 403 mentioning
        //     a request limit would abort the cycle for a YouTube quota that is
        //     perfectly healthy.
        // crossPostToFacebook is itself written never to throw. Both guards
        // exist because either one alone is one refactor away from failing
        // silently, and the failure is a duplicate published video.
        //
        // DO NOT remove this try/catch, and do not move the cross-post above
        // markVideoPublished.
        try {
          const fb = await _crossPostToFacebook(article, {
            filePath: video.path, title, attribution, spec: r.spec, slides: video.slides, now,
          });
          if (fb && fb.status !== "off") produced.facebook = fb;

          // ─── Facebook REEL ───────────────────────────────────────────────
          // A second, independent surface on the same MP4. Same guarded scope
          // and the same never-throws contract as the feed cross-post above,
          // for the same three reasons. Default OFF.
          const reel = await _reelToFacebook(article, {
            filePath: video.path, title, attribution,
            spec: r.spec, slides: video.slides, now,
          });
          if (reel && reel.status !== "off") produced.facebookReel = reel;

          // ─── Instagram Reel ──────────────────────────────────────────────
          // URL-fetch surface: Meta pulls the MP4 from our own server. Same
          // guarded scope and never-throws contract as the two above.
          const igReel = await _reelToInstagram(article, {
            filePath: video.path, title, attribution,
            spec: r.spec, slides: video.slides, now,
          });
          if (igReel && igReel.status !== "off") produced.instagramReel = igReel;

          // ─── Threads ─────────────────────────────────────────────────────
          // LAST, deliberately: its mandatory ~30s wait makes it the longest of
          // the four, and everything ahead of it should already be published
          // before this job spends half a minute asleep.
          const th = await _videoToThreads(article, {
            filePath: video.path, title, attribution,
            spec: r.spec, slides: video.slides, now,
          });
          if (th && th.status !== "off") produced.threads = th;
        } catch (fbErr) {
          logger.error(
            `🚨 facebook cross-post threw past its own guard for ${article.id} — this is a code ` +
            `defect. The YouTube video is published and unaffected. ${fbErr.message}`
          );
        }
        break;
      } catch (err) {
        markVideoFailed(article.id, err.message);
        if (isQuotaExceeded(err)) {
          // LOUD, and it ENDS THE CYCLE. An upload is 1,600 units against a
          // 10,000/day budget SHARED with fetchAllYouTube's search calls, so
          // exhaustion is the likely first production failure — and every
          // subsequent attempt this cycle would burn a full spec + render +
          // TTS spend on an upload that cannot succeed.
          logger.error(
            `🚨 YOUTUBE QUOTA EXCEEDED — upload rejected 403. The 10,000 unit/day budget is shared ` +
            `with YouTube INGESTION (fetchAllYouTube search calls), and an upload costs 1,600. ` +
            `No further uploads will succeed today. Cycle aborted after ${attempts.length} attempt(s). ` +
            `Reduce VIDEO_MAX_PER_DAY, or cut ingestion search volume. Raw: ${err.message}`
          );
          rec.stage = "quota"; rec.reason = err.message;
          return finish({ skipped: "quota-exceeded", reason: err.message });
        }
        rec.reason = err.message;
        logger.warn(`🎬 ${n} SKIP upload: ${err.message}`);
      }
    }

    return finish({ produced });
  } catch (err) {
    // Attribute the throw to the attempt that was in flight. Without this the
    // cycle log said only "video cycle failed: <message>" with tried 0, and the
    // article and stage that caused it had to be inferred from the preceding
    // log lines — which is the wrong time to be inferring anything.
    if (current) { current.error = err.message; }
    logger.error(
      `❌ video cycle failed${current ? ` during attempt ${current.n} (${current.stage}) on ${current.id}` : ""}: ${err.message}`
    );
    return finish({ error: err.message });
  } finally {
    cycleInFlight = null;
  }

  function finish(extra) {
    const finishedAt = Date.now();
    const tried = attempts.length;
    logger.info(
      `🎬 video cycle done: tried ${tried}, produced ${produced ? 1 : 0}` +
      (tried ? ` (yield 1 in ${tried})` : "") + ` · spec spend $${spendUsd.toFixed(5)}`
    );
    try {
      recordHeartbeat(VIDEO_CYCLE_HEARTBEAT, {
        phase: produced ? "complete" : (extra?.skipped ? "skipped" : "complete"),
        startedAt, finishedAt, durationMs: finishedAt - startedAt,
        tried, produced: produced ? 1 : 0, spendUsd: Number(spendUsd.toFixed(5)),
      });
    } catch { /* telemetry never blocks */ }

    // ─── The external switch ──────────────────────────────────────────────
    //
    // /fail rather than merely withholding success wherever the cycle KNOWS it
    // is broken, so the monitor reports now instead of after its grace period
    // expires. Three shapes qualify, and none of them is "produced nothing":
    //
    //   - the cycle threw
    //   - it aborted on configuration (no spec, no voice, no YouTube) or on
    //     YouTube quota — a missing flag is never an editorial outcome
    //   - every attempt died at the same stage, which is the 17-hour-401 shape:
    //     the cycle ran on schedule and would otherwise have pinged success
    //
    // A cycle that runs, tries, and correctly declines to publish is HEALTHY and
    // pings success. That distinction is the whole reason this is not just
    // "produced === 0".
    if (!dryRun) {
      const configAborts = new Set(["no-spec", "no-voice", "no-youtube", "quota-exceeded"]);
      const failure = videoCycleFailure(attempts);
      let detail = null;
      if (extra?.error) {
        detail = `video cycle threw: ${String(extra.error).slice(0, 500)}`;
      } else if (extra?.skipped && configAborts.has(extra.skipped)) {
        detail = `video cycle aborted: ${extra.skipped} — ${extra.reason || "no reason recorded"}`;
      } else if (failure.uniform) {
        detail =
          `video cycle: ${failure.count}/${tried} attempts failed at "${failure.stage}" — ` +
          `${failure.reason || "no reason recorded"}`;
        logger.error(`🫀 ${detail}. Every attempt failed the same way — this is a dependency, not a quiet news day.`);
      }
      if (detail) pingFail(VIDEO_PING, detail);
      else pingSuccess(VIDEO_PING);
    }
    return { ...extra, tried, attempts, spendUsd, produced };
  }
}

/**
 * Health for the ops route. TWO DISTINCT SIGNALS, matching the social cycle:
 *
 *   STALE — the runner is not firing at all. This did not exist. Only `hung`
 *     was checked, so a loop that simply stopped being dispatched produced no
 *     signal whatsoever: no start to go stale, no error, no failed row. A dead
 *     YouTube token ran for 17h behind exactly that gap.
 *   HUNG  — it started and never came back, which a bare timestamp cannot tell
 *     from a healthy in-flight run.
 *
 * Never-fired ≠ stale, as in socialPublisher: a fresh deploy that has not
 * reached its first tick has nothing to be late for.
 */
export function getVideoCycleHealth({ now = Date.now() } = {}) {
  const { lastAt, meta } = getHeartbeatRow(VIDEO_CYCLE_HEARTBEAT);
  const phase = meta && typeof meta === "object" ? meta.phase : null;
  const startedAt = meta && typeof meta === "object" ? meta.startedAt || null : null;
  const startAge = startedAt ? now - startedAt : null;

  const ageMs = lastAt ? now - lastAt : null;
  const staleThresholdMs = VIDEO_CYCLE_STALE_MS();
  const stale = lastAt ? ageMs > staleThresholdMs : false;
  if (stale) {
    logger.error(
      `🫀 video cycle STALE — last execution ${Math.round(ageMs / 60000)}m ago ` +
      `(threshold ${Math.round(staleThresholdMs / 60000)}m). The render loop is not firing.`
    );
  }

  const hung = phase === "start" && startAge != null && startAge > CYCLE_HANG_MS;
  if (hung) {
    logger.error(`🫀 video cycle HUNG — started ${Math.round(startAge / 60000)}m ago and never completed.`);
  }
  return {
    lastAt, ageMs, phase, startedAt,
    stale, staleThresholdMs,
    hung, hangThresholdMs: CYCLE_HANG_MS,
  };
}
