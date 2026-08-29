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
import { isExplicitHarmHeadline, isSensitiveHeadline } from "./editorialSensitivity.js";
import {
  findFreshUnvideoedArticles, claimVideoPost, markVideoPublished, markVideoFailed,
  countVideosPublishedSince, lastVideoPublishedAt, recordHeartbeat, getHeartbeatRow,
  markVideoFacebook, countFacebookPostsSince,
  markVideoInstagram, countInstagramPostsSince,
  markVideoThreads, countThreadsPostsSince,
  markVideoBluesky, countBlueskyPostsSince,
  markVideoTikTok, countTikTokPostsSince,
  markVideoX, countXPostsSince, getArticleEntitiesForTagging,
  getDb,
} from "../models/database.js";
import { filterAtSelection, assertPublishAllowed } from "./videoPakistanBlock.js";
import {
  selectionGate, diversifyByPublisher, MAX_PER_PUBLISHER,
  publisherCooldownFilter, buildRecentTitleCorpus,
} from "./videoSelection.js";
import { resolveAttribution, buildDescriptionCredit } from "./videoAttribution.js";
import { writeVideoSpec, writePackaging, isVideoSpecEnabled } from "./videoSpecWriter.js";
import { statesForCard, renderState, fitStatesToDuration, videoDesignKey } from "./videoSlideRenderer.js";
import { getFFmpegPath } from "./videoGenerator.js";
import { DEFAULT_ORIENTATION } from "./videoGeometry.js";
import { assembleSlide, concatSlides, holdForAudio, slideTotalSecs, captionForCard,
} from "./videoAssembler.js";
import { deriveShortArc, buildBed, scoreShort } from "./videoMusicBed.js";
import { acquireFrameDir, releaseFrameDir, VIDEOS_DIR } from "./videoArtifacts.js";
import { voiceSpec, isVoiceConfigured } from "./videoVoice.js";
import { uploadToYouTube, isYouTubeConfigured } from "./youtubeClient.js";
import { postVideoToFacebook, postReelToFacebook, isFacebookConfigured } from "./facebookClient.js";
import { postReelToInstagram, isInstagramConfigured } from "./instagramClient.js";
import { postVideoToThreads, isThreadsConfigured } from "./threadsClient.js";
import { postVideoToBluesky, isBlueskyConfigured } from "./blueskyClient.js";
import { buildMount, buildMapPng, MOUNT_NAMES } from "./videoSubjectVisual.js";
import { findFootageStill, footageEnabled, footageCreditLines, footageDateLabel } from "./videoFootage.js";
import { withDeadline } from "./httpRetry.js";
import { isTikTokConfigured, uploadToTikTok, tiktokPrivacyLevel } from "./tiktokClient.js";
import { isXConfigured, postToX, fitPost, xSafePublisher } from "./xClient.js";
import {
  CUTAWAY_SECS, cutawayCredit, cutawaysAllowedFor, loadLibrary, readUsage, recordUsage, selectCutaways,
} from "./videoStockLibrary.js";
import { hashtagsFor, withHashtags } from "./xHashtags.js";
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

/**
 * The Bluesky kill switch. Ships dark, like every channel before it.
 *
 * Its own flag rather than a shared "social video" one, for the reason the
 * Facebook pair established: two surfaces with different failure modes must be
 * switchable independently, or turning off the broken one means turning off the
 * working one too. Bluesky is the least like its siblings — a different protocol,
 * a different host, and an account with a documented history of createSession
 * rate-limiting — so it is the last channel that should share a switch.
 */
export const blueskyVideoEnabled = () => process.env.VIDEO_BLUESKY_ENABLED === "1";

/** Sized against VIDEO_MAX_PER_DAY (12 in prod), like the other three. */
export const VIDEO_BLUESKY_MAX_PER_DAY = () => {
  const raw = process.env.VIDEO_BLUESKY_MAX_PER_DAY;
  if (raw === undefined || raw === "") return VIDEO_MAX_PER_DAY();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : VIDEO_MAX_PER_DAY();
};

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

/**
 * ONE MOUNT PER VIDEO, chosen deterministically from the article id.
 *
 * Deterministic so a re-render is identical (the render cache means a video
 * rebuilt tomorrow must not arrive in a different frame), and varied across
 * articles so the channel does not look like one template. The ground never
 * changes, so varying the mount is where variety comes from without
 * inconsistency — DrJ's decision, 2026-08-14.
 */
export function mountFor(articleId, ordinal = 0) {
  const h = [...String(articleId || "x")].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  // ORDINAL, because one video can hold more than one photo card and they were
  // all landing on the same mount. Stable per article as before at ordinal 0,
  // so nothing that does not ask for variety sees any change.
  return MOUNT_NAMES[(h + ordinal) % MOUNT_NAMES.length];
}

const SITE_ORIGIN = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");

/**
 * THREE BUDGETS, THREE NUMBERS (DrJ, 2026-08-13).
 *
 * These were one constant — `MAX_ATTEMPTS`, default 8 — doing three jobs at
 * three different altitudes, which is what produced `tried 8, produced 0 · spec
 * spend $0.00000`: the cycle exhausted a budget that exists to cap Gemini spend
 * without making a single Gemini call.
 *
 *   MAX_SPEC_CALLS   THE MONEY. Incremented immediately before _writeVideoSpec
 *                    and nowhere else, so what it counts is what it is named
 *                    for. A gate that refuses an article before the model is
 *                    called costs nothing and now consumes nothing.
 *
 *   MAX_SCAN         THE WORK. A backstop, not a policy. Uncounted skips need
 *                    their own bound or a pathological pool becomes an unbounded
 *                    loop; after the publisher cooldown and the title corpus
 *                    were hoisted out of the loop, one scan step is a couple of
 *                    indexed reads, so this can sit far above the realistic
 *                    eligible count (measured: 55 eligible from a 200-article
 *                    pool at 2/publisher) and still bite if diversity is ever
 *                    loosened. It is logged loudly when hit — no silent caps.
 *
 *   CANDIDATE_POOL   THE SAMPLE. Was `MAX_ATTEMPTS * 6` = 48, which made the
 *                    attempt cap silently size the editorial pool: raising the
 *                    budget would have widened what the query returns and
 *                    changed WHICH stories are eligible. Now independent.
 *
 * On the pool default of 200: `findFreshUnvideoedArticles` orders by
 * LENGTH(content) DESC, so the LIMIT does not sample the window — it takes the
 * longest-bodied articles in it, and body length correlates with masthead.
 * Measured on a prod snapshot, one 12h window at credibility >= 7:
 *
 *   pool, unlimited   449 articles   45 publishers
 *   LIMIT 48          48 articles    11 publishers   top publisher 25%
 *   LIMIT 200         200 articles   31 publishers   top publisher 12%
 *
 * The reported "Yahoo Finance x25 of 48 fresh" was this, not thin ingestion:
 * 48 IS the limit, and 25 of the 48 longest bodies in the window came from the
 * publisher that writes longest. The ordering is deliberately kept — a 5,000-char
 * body caps the beat count, and that rationale is unchanged. What was wrong was
 * sampling 48 from it.
 *
 * READ AT CALL TIME, NOT AT IMPORT. All three were `const X = parseInt(env)`
 * evaluated once when the module loaded, which is the minority idiom in this
 * file — VIDEO_MAX_PER_DAY, videoMinIntervalMs and VIDEO_FACEBOOK_MAX_PER_DAY
 * are all lazy — and it made them untestable without a fresh module registry.
 * A budget nobody can write a test for is how the old one drifted from its own
 * name for this long.
 */
export const MAX_SPEC_CALLS = () =>
  Number.parseInt(process.env.VIDEO_MAX_SPEC_CALLS_PER_CYCLE || "", 10) ||
  // The name this budget used to have. Honoured so a prod .env that pins the
  // old one keeps pinning the money, which is the half it was really steering.
  Number.parseInt(process.env.VIDEO_MAX_ATTEMPTS_PER_CYCLE || "", 10) || 8;
export const MAX_SCAN = () => Number.parseInt(process.env.VIDEO_MAX_SCAN_PER_CYCLE || "", 10) || 200;
export const CANDIDATE_POOL = () => Number.parseInt(process.env.VIDEO_CANDIDATE_POOL || "", 10) || 200;
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

/**
 * WHICH PICTURE THIS PHOTO CARD GETS, AND THEREFORE WHOSE NAME IS ON IT.
 *
 * Extracted from the slide loop because it is the one piece of this pipeline
 * that makes a RIGHTS decision, and it was unreachable by any test — buried
 * inside a function that needs a database, a spec model and a voice API before
 * it will run a line. "Credit the right owner" is not something to verify by
 * watching the channel.
 *
 * The order encodes three separate judgements, and they are not interchangeable:
 *
 *   1. The article's own photograph, ONCE. An editor chose it for this story
 *      and no keyword search beats that. But it is one picture, and showing it
 *      again on the next photo card does not make it two.
 *   2. Footage, for the gaps: a first card with no article photo, and every
 *      later card, whose alternative is the same photograph twice.
 *   3. The article photo again on a LATER card, on a different mount. A
 *      relevant picture repeated still beats a black slide, and the changed
 *      mount is what stops it reading as a stuck frame.
 *
 * `imageCredit` is null unless a picture was actually built. A credit for a
 * picture that is not there is worse than no credit at all.
 *
 * Injectable collaborators, because the real ones fetch over the network.
 */
export async function choosePhotoUnderlay({
  card, article, attribution, ordinal, work, slideIndex = 0,
  mount = mountFor(article?.id, ordinal),
  _buildMount = buildMount, _findFootageStill = findFootageStill, _footageEnabled = footageEnabled,
  _log = logger,
} = {}) {
  const none = { underlayPath: null, imageCredit: null, imageDate: null, footage: null,
                 imageUrl: null, pickedBy: "none" };

  // ── The sensitivity gates, per tier (DrJ, 2026-08-30) ────────────────────
  //
  // This path had NO gate at all, which is the asymmetry that prompted the
  // change: the same headline got a typographic social card and a full-bleed
  // publisher photograph in the Short. editorialSensitivity's own header named
  // "a stock-or-publisher photo beside a massacre" as the thing it exists to
  // prevent — the publisher half was written down and never wired up here.
  //
  // Two bars, because the picture's provenance changes the cost of being wrong.
  // The article's photo was chosen for THIS story by a picture editor, so it
  // gets the narrow bar; footage was vetted against nothing, so it keeps the
  // broad one. Both fall through to `none` — type on the ground, a path that
  // already exists and is already tested.
  const harmHeadline = isExplicitHarmHeadline(article?.title);
  const sensitiveHeadline = isSensitiveHeadline(article?.title);
  const publisherPhotoAllowed = !harmHeadline;
  const thirdPartyImageryAllowed = !sensitiveHeadline;

  if (ordinal === 0 && article?.image_url && publisherPhotoAllowed) {
    const p = await _buildMount({ imageUrl: article.image_url, mount, work, seed: article.id });
    if (p) return { underlayPath: p, imageCredit: attribution?.publisher || null, imageDate: null,
                    footage: null, imageUrl: article.image_url, pickedBy: "article-photo" };
  }

  // ARCHIVE MATERIAL ON A MASSACRE STORY IS THE SAME PROBLEM as stock — a
  // rights-clean picture is not a suitable one. Broad bar, matching the stock
  // cutaway gate rather than the publisher one.
  if (_footageEnabled() && thirdPartyImageryAllowed) {
    const found = await _findFootageStill({ subject: card?.subject, title: article?.title });
    if (found) {
      const p = await _buildMount({
        imageUrl: found.imageUrl, mount,
        work: path.join(work, "footage"), seed: `${article?.id}-${ordinal}`,
      });
      if (p) {
        // ARCHIVE MATERIAL IS DATED ON SCREEN. Recency ranking prefers newer
        // pictures; it cannot conjure one. When the best rights-clean image for
        // a story is years old, the viewer is told.
        const imageDate = footageDateLabel(found.date);
        _log.info(
          `🎬 slide ${slideIndex} footage: ${found.source} · ${found.licence} · ` +
          `${imageDate ? `DATED ${imageDate} · ` : ""}${found.sourceUrl || found.imageUrl}`
        );
        // The badge gets the short form; the description gets the whole one.
        return { underlayPath: p, imageCredit: found.screenCredit || found.credit, imageDate,
                 footage: found, imageUrl: found.imageUrl, pickedBy: `footage:${found.source}` };
      }
    }
  }

  if (ordinal > 0 && article?.image_url && publisherPhotoAllowed) {
    const p = await _buildMount({ imageUrl: article.image_url, mount, work, seed: `${article.id}-${ordinal}` });
    if (p) {
      _log.info(`🎬 slide ${slideIndex} photo: no footage for photo card #${ordinal + 1} — reusing the article photo on mount "${mount}"`);
      return { underlayPath: p, imageCredit: attribution?.publisher || null, imageDate: null,
               footage: null, imageUrl: article.image_url, pickedBy: "article-photo-reused" };
    }
  }

  // NO SILENT SUPPRESSION. "Why is this beat type-on-black?" must be answerable
  // from the logs alone — a missing picture and a withheld one look identical
  // on screen.
  if (article?.image_url && !publisherPhotoAllowed) {
    _log.info(
      `🎬 slide ${slideIndex} photo: WITHHELD — explicit-harm headline, ` +
      `no photograph on "${String(article.title || "").slice(0, 70)}"`
    );
  } else if (harmHeadline || sensitiveHeadline) {
    _log.info(
      `🎬 slide ${slideIndex} photo: no imagery — ` +
      `${sensitiveHeadline ? "sensitive" : "explicit-harm"} headline`
    );
  }
  return none;
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
    // HOW MANY PHOTO CARDS THIS VIDEO HAS ALREADY SPENT.
    //
    // The schema permits two "photo" cards in a row (MAX_CONSECUTIVE_SAME_TYPE)
    // and any number apart, and every one of them was rendering the SAME
    // `article.image_url` on the SAME mount. A viewer sees one photograph
    // presented twice as if it were two — the repetition complaint from the
    // long-form film, sitting in the automated loop.
    //
    // An article carries one picture, so the honest fix is to spend it once.
    let photosUsed = 0;
    // EVERY BORROWED PICTURE, so the description can say where it came from.
    // Public domain is not the same as unattributed, and DVIDS attaches an
    // actual condition — see footageCreditLines.
    const footageUsed = [];
    // ── Stock cutaways (dark: VIDEO_STOCK_CUTAWAYS_ENABLED=1) ───────────────
    //
    // A lookup against the curated library, never a search. The picks are made
    // ONCE for the whole video, before any slide is assembled, because two of
    // the rules — one contributor per video, and never on consecutive beats —
    // are properties of the video rather than of a slide, and cannot be decided
    // from inside a per-slide loop.
    //
    // SENSITIVITY IS WHOLE-VIDEO. The guard judges a HEADLINE and nothing else;
    // there is no per-beat signal in the spec and inventing one would be a
    // classifier, not a guard. So a flagged headline suppresses every cutaway in
    // the video — the same over-broad, cheap-false-positive posture the card
    // renderer already takes when it drops to a typographic card.
    const cutawayBySlide = new Map();
    const cutawayGate = cutawaysAllowedFor(article);
    if (!cutawayGate.allowed) {
      if (cutawayGate.reason === "sensitive-headline") {
        logger.info(
          `🎞 stock cutaway: sensitive headline — no cutaways for ${article.id} ` +
          `("${String(article.title).slice(0, 60)}")`
        );
      }
    } else {
      const { assets } = loadLibrary();
      const db = getDb();
      const { picks } = selectCutaways(slides, { assets, lastUsed: readUsage(db) });
      for (const p of picks) cutawayBySlide.set(p.slideIndex, p.asset);
      if (picks.length) {
        recordUsage(db, picks.map((p) => p.asset.id));
        logger.info(
          `🎞 stock cutaway: ${picks.length} selected for ${article.id} — ` +
          picks.map((p) => `slide ${p.slideIndex}:${p.asset.id}`).join(", ")
        );
      }
    }

    for (let i = 0; i < slides.length; i++) {
      const card = slides[i];
      const audioSecs = audio[i].durationSecs;
      // SUBJECT VISUAL, RESOLVED BEFORE ANYTHING IS RENDERED.
      //
      // This used to run AFTER the states were built, which was harmless while
      // the states carried no claim about the picture. They now carry a CREDIT,
      // and a credit written before you know what you fetched is a guess. Two
      // ways it was wrong: a failed mount rendered a publisher's name over bare
      // black, and open-licence footage would have been credited to the article's
      // publisher instead of its actual owner.
      //
      // So the order is now: ask what the card wants → get it → build the states
      // that say where it came from. The first call is a pure tree build costing
      // microseconds and `underlay` does not depend on the credit, so asking
      // twice is cheaper than threading the answer through.
      const ctxBase = { outlet: attribution.publisher, slideIndex: i, slideCount: slides.length, orientation };
      const wants = statesForCard(card, ctxBase).find(st => st.underlay)?.underlay;

      // A failure leaves both null and the card renders over the bare ground
      // rather than losing the video: the type still says what it says, and the
      // log says why the picture is missing. Never a throw — a photo that would
      // not fetch is not a reason to lose a story.
      let underlayPath = null;
      let imageCredit = null;
      let imageDate = null;
      if (wants) {
        try {
          const svWork = path.join(work, `sv${String(i).padStart(2, "0")}`);
          if (wants === "photo") {
            const chosen = await choosePhotoUnderlay({
              card, article, attribution, ordinal: photosUsed++, work: svWork, slideIndex: i,
            });
            underlayPath = chosen.underlayPath;
            imageCredit = chosen.imageCredit;
            imageDate = chosen.imageDate;
            if (chosen.footage) footageUsed.push(chosen.footage);
            // WHAT PICTURE THIS SLIDE GOT, AND WHY.
            //
            // Extracting choosePhotoUnderlay for testability (#63) deleted the
            // one line that recorded this, and the loss was invisible until a
            // published short carried an obviously wrong image and there was
            // nothing in the log to say where it came from. Nothing downstream
            // can see a photograph; this pairing — the spec's DECLARED subject
            // beside the URL actually used — is the only place a mismatch is
            // visible at all.
            logger.info(
              `🎬 slide ${i} photo [${chosen.pickedBy}]: subject "${card.subject ?? "(none declared)"}" ` +
              `→ ${chosen.imageCredit || "uncredited"} · ${String(chosen.imageUrl || "NO IMAGE").slice(0, 110)}`
            );
          } else if (wants === "map") {
            underlayPath = buildMapPng({
              codes: card.codes, exception: card.exception ?? null,
              out: path.join(svWork, "map.png"), work: svWork,
            });
            if (underlayPath) imageCredit = "NATURAL EARTH";
            logger.info(
              `🎬 slide ${i} map: codes ${JSON.stringify(card.codes ?? [])}` +
              `${card.exception ? ` except ${card.exception}` : ""} → ${underlayPath ? "drawn" : "NOT DRAWN"}`
            );
          }
          if (!underlayPath) {
            logger.warn(`🎬 slide ${i} (${card.t}): no ${wants} could be built — rendering the type alone`);
          } else if (wants === "photo") {
            // THE DECLARED SUBJECT, BESIDE THE IMAGE IT GOT. Nothing downstream
            // can see a photograph, so this pairing is the only place a mismatch
            // is visible at all — the model's statement of what the picture
            // should show, next to what it was actually given.
            logger.info(
              `🎬 slide ${i} photo: subject "${card.subject ?? "(none declared)"}" → ` +
              `${String(imageCredit || "uncredited")} · ${String(article.image_url).slice(0, 90)}`
            );
          }
        } catch (err) {
          logger.warn(`🎬 slide ${i} (${card.t}): ${wants} failed — ${err.message.slice(0, 120)}`);
        }
      }

      // Now the real states, credited to whoever actually owns what was fetched.
      let states = statesForCard(card, { ...ctxBase, imageCredit, imageDate });
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
      // The cutaway sits INSIDE this slide's segment and is clamped against its
      // length, so the finished video is exactly as long with cutaways on as
      // off. Nothing new is concatenated, and the music bed — which derives its
      // timeline independently from slideTotalSecs — stays in sync by not
      // having anything to be out of sync with.
      const cutAsset = cutawayBySlide.get(i) || null;
      await assembleSlide({
        statePaths: paths, hold, outputPath: seg, driftDir: i, orientation,
        audioPath: audio[i].path, captionText: captionForCard(card), workDir: work, fontFile: FONT_FILE,
        underlayPath,
        cutawayPath: cutAsset?.absPath || null,
        cutawaySecs: cutAsset ? CUTAWAY_SECS() : 0,
        cutawayCredit: cutAsset ? cutawayCredit(cutAsset) : null,
      });
      segments.push(seg);
    }
    const out = path.join(VIDEOS_DIR, `${article.id}-${videoDesignKey()}.mp4`);
    await concatSlides({ segmentPaths: segments, outputPath: out, workDir: work });
    if (!existsSync(out) || statSync(out).size < 10_000) {
      throw new Error(`assembled video is missing or implausibly small: ${out}`);
    }

    // ── Score bed (dark: VIDEO_MUSIC_BED_ENABLED=1) ─────────────────────────
    // Slide starts are DERIVED from the same audio durations the assembler
    // used — slideTotalSecs per slide, accumulated. Nothing here re-models the
    // timeline (the long-form bed drifted ~50s the one time something did).
    // A bed failure never costs the video: the unscored file ships instead.
    if (process.env.VIDEO_MUSIC_BED_ENABLED === "1") {
      try {
        const starts = []; let t = 0;
        for (let i = 0; i < slides.length; i++) { starts.push(t); t += slideTotalSecs(audio[i].durationSecs); }
        const { arc, sections, phases } = deriveShortArc(slides, starts, t);
        const bed = path.join(work, "bed.wav");
        const scored = path.join(VIDEOS_DIR, `${article.id}-${videoDesignKey()}-scored.mp4`);
        const ff = getFFmpegPath();
        await buildBed(t, bed, { arc, sections, phases, ffmpegPath: ff });
        await scoreShort(out, bed, scored, { ffmpegPath: ff });
        if (existsSync(scored) && statSync(scored).size > 10_000) {
          logger.info(`🎬 music bed: scored ${t.toFixed(1)}s, turn=${phases.turn?.toFixed(1) ?? "none"}, sections=${sections.length}`);
          return { path: scored, slides, footage: footageUsed };
        }
        logger.warn("🎬 music bed: scored file missing/small — shipping unscored");
      } catch (err) {
        logger.warn(`🎬 music bed failed (shipping unscored): ${err.message.slice(0, 160)}`);
      }
    }
    return { path: out, slides, footage: footageUsed };
  } finally {
    releaseFrameDir(work);
  }
}

// ONE CHANNEL MAY NOT CONSUME ANOTHER'S TURN.
//
// The cross-posts run in sequence inside a single guard. On 2026-08-25 a video
// published, Facebook posted, Instagram went `pending` on a fetch with no
// timeout, and Threads / Bluesky / TikTok / X were NEVER ATTEMPTED. The worker
// was not deadlocked — it moved on to other cron work and left that chain
// parked forever, the row stuck `pending` and the MP4 pinned by the sweep guard.
//
// Per-call timeouts (added alongside this) are necessary and not sufficient: a
// client making fifteen individually-bounded calls in a poll loop still runs for
// minutes. This bounds the WHOLE attempt per channel. Exceeding it rejects, the
// channel's own never-throws guard records a failure, and the chain moves on —
// which is the behaviour that was missing.
const CHANNEL_BUDGET_MS = () =>
  Math.max(30_000, Number.parseInt(process.env.VIDEO_CHANNEL_BUDGET_MS || "300000", 10));

/**
 * THE CHANNEL BUDGET MUST FIT INSIDE WHAT IS LEFT OF THE JOB'S LOCK.
 *
 * #74 gave each channel five minutes and it never fired once. The reason is
 * that the two clocks were never reconciled:
 *
 *   - the channel budget starts when THE CHANNEL starts
 *   - the BullMQ lock (QUEUE_LOCK_MS_VIDEO_RENDER, 10 min) starts when THE JOB
 *     starts, and the render burns four to five minutes of it before a single
 *     cross-post begins
 *
 * So on 2026-08-25: published at 16:40 after ~4 minutes, Facebook and Instagram
 * posted, Threads began around 16:44 with a budget due to expire at 16:49 — and
 * the lock expired first. BullMQ abandons the promise on a lost lock: no
 * rejection, no catch, no log. Threads stayed `pending` and Bluesky, TikTok and
 * X were never attempted, which is precisely what the budget existed to prevent.
 *
 * A fixed budget cannot solve this, because the right number depends on how long
 * the render took. So the remaining time is DIVIDED among the channels that have
 * not run yet, and a safety margin is held back so the job can still record its
 * outcome and release the lock cleanly.
 */
const LOCK_MS = () => Math.max(60_000, Number.parseInt(process.env.QUEUE_LOCK_MS_VIDEO_RENDER || "600000", 10));
const LOCK_SAFETY_MS = 45_000;

export function channelBudget({ jobStartedAt, channelsRemaining, now = Date.now(), lockMs = LOCK_MS() }) {
  const left = jobStartedAt + lockMs - LOCK_SAFETY_MS - now;
  const share = Math.floor(left / Math.max(1, channelsRemaining));
  // Never negative, never longer than the configured per-channel ceiling. A
  // floor of zero is meaningful: it means there is no time left and the channel
  // should fail immediately rather than start work it cannot finish.
  return Math.max(0, Math.min(CHANNEL_BUDGET_MS(), share));
}

/**
 * ONE CHANNEL'S TIMEOUT MUST NOT BE EVERY CHANNEL'S TIMEOUT.
 *
 * #85 gave each cross-post a budget derived from the remaining lock, so a stall
 * could not starve the ones behind it. It fired, and made things worse:
 * `withDeadline` REJECTS, the six calls share one try/catch, and the rejection
 * landed in that shared catch — skipping every channel after it. Exactly the
 * failure the budget existed to prevent, now triggered by the budget.
 *
 * Observed on the 18:51Z render: Facebook and its Reel posted, the budget fired
 * fifteen minutes later, "facebook cross-post threw past its own guard" was
 * logged, and Threads, Bluesky, TikTok and X were never attempted.
 *
 * So the catch belongs around EACH channel, not around the group. This wrapper
 * never throws: a timeout or a stray error becomes a recorded failure for that
 * channel and the chain continues. The shared catch stays, but now only a
 * genuine code defect can reach it.
 */
async function runChannel(label, budgetMs, mark, fn) {
  try {
    return await withDeadline(fn(), budgetMs, label);
  } catch (err) {
    logger.error(`🚨 ${label} cross-post abandoned — the YouTube video is published and unaffected, ` +
      `and the remaining channels still run. ${err.message.slice(0, 200)}`);
    try { mark?.(err); } catch (dbErr) {
      logger.error(`🚨 ${label}: could not record the failure either: ${dbErr.message}`);
    }
    return { status: "failed", error: err.message };
  }
}

// ─── TikTok ─────────────────────────────────────────────────────────────────

const VIDEO_TIKTOK_MAX_PER_DAY = () =>
  Math.max(0, Number.parseInt(process.env.VIDEO_TIKTOK_MAX_PER_DAY || "6", 10));

/**
 * Publish the SAME rendered MP4 to TIKTOK.
 *
 * The fifth surface on one render, and the last one blocked by something other
 * than our own code: an UNAUDITED client is refused any privacy level except
 * SELF_ONLY, which made an automated public post impossible rather than merely
 * unwise. The app has since been approved — creator_info now offers
 * PUBLIC_TO_EVERYONE — so the channel can exist. It still ships dark, and its
 * privacy level still defaults to SELF_ONLY: an approval that makes something
 * possible is not an instruction to do it.
 *
 * BYTES, NOT A URL. TikTok hands back an upload URL, we PUT the file to it and
 * poll a publish_id. So, like Facebook Reels and Bluesky and unlike Instagram
 * and Threads, nothing on our server needs to survive the call —
 * `hasPendingUrlFetchPublish` is deliberately not widened for this channel.
 *
 * NEVER THROWS, for the reasons written at length over the Facebook cross-post:
 * the YouTube video is already live and irreversible by the time this runs, and
 * a TikTok failure must not reach markVideoFailed (which would make the article
 * selectable again and publish a SECOND YouTube video) or isQuotaExceeded
 * (which would abort the whole cycle over someone else's throttling).
 */
export async function videoToTikTok(article, {
  filePath, title, attribution, spec = null, slides = null, now = Date.now(), footage = [],
} = {}) {
  try {
    if (process.env.VIDEO_TIKTOK_ENABLED !== "1") return { status: "off" };
    if (!isTikTokConfigured()) {
      logger.warn("\u{1F4F1} TikTok cross-post SKIPPED — VIDEO_TIKTOK_ENABLED=1 but the client is not configured " +
        "(TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET / TIKTOK_REFRESH_TOKEN). The video is published to " +
        "YouTube; the cross-post is skipped.");
      markVideoTikTok(article.id, { status: "skipped", error: "tiktok not configured" });
      return { status: "skipped", reason: "not-configured" };
    }

    const max = VIDEO_TIKTOK_MAX_PER_DAY();
    const posted24h = countTikTokPostsSince(now - 24 * 60 * 60 * 1000);
    if (posted24h >= max) {
      logger.info(`\u{1F4F1} TikTok cross-post SKIPPED — cap ${posted24h}/${max} in the last 24h`);
      markVideoTikTok(article.id, { status: "skipped", error: `daily cap ${posted24h}/${max}` });
      return { status: "skipped", reason: "daily-cap" };
    }

    const privacy = tiktokPrivacyLevel();
    const { publishId, videoUrl } = await uploadToTikTok({
      filePath, title,
      description: [
        buildDescriptionCredit(article, attribution),
        ...footageCreditLines(footage),
      ].filter(Boolean).join("\n\n"),
      tags: [],
      privacyLevel: privacy,
    });

    markVideoTikTok(article.id, { status: "posted", postId: publishId });
    // THE PRIVACY LEVEL IS LOGGED ON EVERY POST. It is the difference between a
    // private draft and publishing to everyone, it is set by an env var, and
    // nothing else in the log would reveal which one was in force.
    logger.info(`\u{1F4F1} TIKTOK CROSS-POSTED ${publishId} privacy=${privacy} ` +
      `(${posted24h + 1}/${max} today)${videoUrl ? ` — ${videoUrl}` : ""}`);
    return { status: "posted", id: publishId, url: videoUrl, privacy };

  } catch (err) {
    logger.error(
      `\u{1F6A8} TIKTOK CROSS-POST FAILED for ${article.id} — the YouTube video IS published and stays ` +
      `published; only the TikTok post is lost. ${err.message}`
    );
    try {
      markVideoTikTok(article.id, { status: "failed", error: err.message });
    } catch (dbErr) {
      logger.error(`\u{1F6A8} tiktok cross-post: could not record the failure either: ${dbErr.message}`);
    }
    return { status: "failed", error: err.message };
  }
}

// ─── X ──────────────────────────────────────────────────────────────────────

const VIDEO_X_MAX_PER_DAY = () =>
  Math.max(0, Number.parseInt(process.env.VIDEO_X_MAX_PER_DAY || "6", 10));

/**
 * Publish the SAME rendered MP4 to X.
 *
 * THE CAPTION CARRIES NO LINK, AND THAT IS THE ENTIRE ECONOMICS OF THIS
 * CHANNEL. X went pay-per-use in February 2026: $0.015 a post, or $0.20 if it
 * contains a link. At this cadence that is $4.70 a month against $63 — and X
 * downranks link posts anyway, so the expensive option also performs worse. The
 * site lives in the profile bio. `postToX` refuses a link outright rather than
 * trusting this function to remember, because a post with a link succeeds
 * exactly like one without and the difference appears only on a bill.
 *
 * So this is the ONE channel that does not get buildDescriptionCredit: that
 * helper's entire job is to put the original article's URL above the fold.
 * Attribution still happens — the publisher is NAMED in the caption, and the
 * video itself carries the on-screen source badge — but it is named, not
 * linked.
 *
 * BYTES, NOT A URL: INIT/APPEND/FINALIZE then a processing poll, so nothing on
 * our server needs to outlive the call. `hasPendingUrlFetchPublish` untouched.
 *
 * NEVER THROWS, for the reasons written over the Facebook cross-post: the
 * YouTube video is already live and irreversible, and a failure here must not
 * reach markVideoFailed or isQuotaExceeded.
 */
export async function videoToX(article, {
  filePath, title, attribution, spec = null, slides = null, now = Date.now(), footage = [],
} = {}) {
  try {
    if (process.env.VIDEO_X_ENABLED !== "1") return { status: "off" };
    if (!isXConfigured()) {
      logger.warn("\u{1D54F} X cross-post SKIPPED — VIDEO_X_ENABLED=1 but the client is not configured " +
        "(X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET). The video is published to " +
        "YouTube; the cross-post is skipped.");
      markVideoX(article.id, { status: "skipped", error: "x not configured" });
      return { status: "skipped", reason: "not-configured" };
    }

    const max = VIDEO_X_MAX_PER_DAY();
    const posted24h = countXPostsSince(now - 24 * 60 * 60 * 1000);
    if (posted24h >= max) {
      logger.info(`\u{1D54F} X cross-post SKIPPED — cap ${posted24h}/${max} in the last 24h`);
      markVideoX(article.id, { status: "skipped", error: `daily cap ${posted24h}/${max}` });
      return { status: "skipped", reason: "daily-cap" };
    }

    // Named, not linked. The publisher gets credit in words; the URL would cost
    // thirteen times as much and reach fewer people.
    // "Investing.com" is a real masthead here, and X bills any dotted name as a
    // link. Strip the TLD rather than lose the channel for that publisher.
    const who = xSafePublisher(attribution?.publisher);
    // ONE OR TWO TAGS, OR NONE. Measured: 1-2 earn ~21% more engagement than
    // none, 3+ costs ~17%, 5+ up to 40% of reach. Both must be specific — X
    // ranks on the text now, so a generic tag buys nothing and still pays the
    // penalty. See xHashtags for why they are filtered through the title.
    const tags = hashtagsFor({ title, entities: getArticleEntitiesForTagging(article.id) });
    const text = withHashtags(
      fitPost([title, who ? `Source: ${who}` : ""].filter(Boolean).join("\n\n"), 280 - 40),
      tags);

    const { id, url } = await postToX({ filePath, text });
    markVideoX(article.id, { status: "posted", postId: id });
    logger.info(`\u{1D54F} X CROSS-POSTED ${id} (${posted24h + 1}/${max} today)` +
      `${tags.length ? ` tags=${tags.join(" ")}` : " no tags"} — ${url}`);
    return { status: "posted", id, url };

  } catch (err) {
    logger.error(
      `\u{1F6A8} X CROSS-POST FAILED for ${article.id} — the YouTube video IS published and stays ` +
      `published; only the X post is lost. ${err.message}`
    );
    try {
      markVideoX(article.id, { status: "failed", error: err.message });
    } catch (dbErr) {
      logger.error(`\u{1F6A8} x cross-post: could not record the failure either: ${dbErr.message}`);
    }
    return { status: "failed", error: err.message };
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
  filePath, title, attribution, spec = null, slides = null, now = Date.now(), footage = [],
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
      ...footageCreditLines(footage),
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
  filePath, title, attribution, spec = null, slides = null, now = Date.now(), footage = [],
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
      ...footageCreditLines(footage),
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
  filePath, title, attribution, spec = null, slides = null, now = Date.now(), footage = [],
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
      ...footageCreditLines(footage),
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
  filePath, title, attribution, spec = null, slides = null, now = Date.now(), footage = [],
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
      ...footageCreditLines(footage),
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

/**
 * Truncate to N GRAPHEMES, cutting only on cluster boundaries.
 *
 * Bluesky's 300 limit is graphemes, not UTF-16 code units, and the two disagree
 * in both directions: an emoji or a flag is one grapheme and several code units,
 * so `.length` over-counts and truncates a legal post early; conversely a
 * `.slice(0, 300)` can cut a family emoji or a combining mark in half and produce
 * a replacement character in the middle of a published sentence.
 *
 * `socialComposer.composeBluesky` still slices by `.length` — noted, not changed
 * here: it feeds the article social path, and altering what that publishes is a
 * separate decision from adding a video channel.
 *
 * Exported for test.
 */
export function truncateGraphemes(text, max) {
  const s = String(text ?? "");
  // Intl.Segmenter is present on every Node the project supports (18+). The
  // fallback is code points rather than code units — still wrong for combining
  // marks, but wrong in the safe direction and never mid-surrogate.
  const units = typeof Intl?.Segmenter === "function"
    ? [...new Intl.Segmenter("en", { granularity: "grapheme" })
        .segment(s)].map((seg) => seg.segment)
    : Array.from(s);
  if (units.length <= max) return s;
  return units.slice(0, max).join("");
}

/**
 * Publish the SAME rendered MP4 to BLUESKY.
 *
 * THE ONE THAT IS NOT LIKE THE OTHERS. Facebook Reels uploads bytes to Meta;
 * Instagram and Threads hand Meta a URL to fetch. Bluesky uploads RAW BYTES to a
 * separate video service, waits for a transcode job, and only then writes the
 * post record. Consequences that matter here:
 *
 *   - No public URL is involved, so nothing needs protecting from the 48h sweep
 *     and migration 026 has no 'pending' state. Adding one would pin every MP4
 *     to guard a window that does not exist.
 *   - The transcode can stall. The poll inside postVideoToBluesky is bounded by
 *     wall clock and throws rather than hanging the render job, which is the
 *     whole reason the BullMQ lock was raised to 10 minutes first.
 *   - Size and duration are hard platform limits, asserted explicitly rather
 *     than assumed from "our videos are small".
 *
 * Rule 0 asserted independently, first thing, before a file is read or a request
 * is sent. Never throws — same contract and the same three reasons as its
 * siblings (markVideoFailed would flip a row whose YouTube video is live,
 * isQuotaExceeded matches foreign 403s, and a throw re-runs the BullMQ job).
 */
export async function videoToBluesky(article, {
  filePath, title, attribution, spec = null, slides = null, now = Date.now(), footage = [],
} = {}) {
  if (!blueskyVideoEnabled()) return { status: "off" };

  try {
    try {
      assertPublishAllowed(article, [spec, slides].filter(Boolean));
    } catch (blockErr) {
      logger.error(
        `🛑 RULE 0 REFUSED the Bluesky video for ${article.id} — ${blockErr.message}. ` +
        `No bytes were uploaded and no record was created.`
      );
      try { markVideoBluesky(article.id, { status: "skipped", error: `rule0: ${blockErr.message}` }); }
      catch { /* bookkeeping is best-effort */ }
      return { status: "refused", reason: "rule0" };
    }

    if (!isBlueskyConfigured()) {
      logger.error("🚨 VIDEO_BLUESKY_ENABLED=1 but Bluesky is not configured — the video is skipped.");
      try { markVideoBluesky(article.id, { status: "skipped", error: "bluesky not configured" }); } catch {}
      return { status: "skipped", reason: "not-configured" };
    }

    const max = VIDEO_BLUESKY_MAX_PER_DAY();
    const posted24h = countBlueskyPostsSince(now - 24 * 60 * 60 * 1000);
    if (posted24h >= max) {
      logger.info(`🦋 bluesky video skipped — cap ${posted24h}/${max} in the last 24h`);
      try { markVideoBluesky(article.id, { status: "skipped", error: `daily cap ${posted24h}/${max}` }); } catch {}
      return { status: "skipped", reason: "daily-cap" };
    }

    // Measured here rather than left to the client so an unmeasurable file is a
    // clean refusal with a reason, not a platform error mid-upload — the same
    // posture as the Instagram ceiling.
    let secs = null;
    try {
      const { probeDurationSecs } = await import("./videoVoice.js");
      secs = probeDurationSecs(filePath);
    } catch (err) {
      logger.error(`🚨 bluesky video skipped — could not measure ${filePath}: ${err.message}`);
      try { markVideoBluesky(article.id, { status: "skipped", error: `unmeasurable: ${err.message}` }); } catch {}
      return { status: "skipped", reason: "unmeasurable" };
    }

    // 300 GRAPHEMES, not characters. Bluesky counts graphemes, and the credit
    // line carries em-dashes and occasional non-Latin publisher names, so a
    // char-based slice can overshoot. Intl.Segmenter is the only correct count
    // available in-runtime; the slice is applied on segment boundaries so a
    // truncation can never split a grapheme cluster.
    const text = truncateGraphemes([
      title,
      buildDescriptionCredit(article, attribution),
      ...footageCreditLines(footage),
      `Full story → ${SITE_ORIGIN}/article/${encodeURIComponent(article.id)}` +
        `?utm_source=social_bluesky_video&utm_medium=social&utm_campaign=scoop_video`,
    ].filter(Boolean).join("\n\n"), 300);

    const bs = await postVideoToBluesky({
      text,
      filePath,
      // The vertical render is 1080x1920 (videoGeometry). Bluesky uses this to
      // reserve the right box before the video loads; omitting it makes the
      // post reflow on play.
      aspectRatio: { width: 1080, height: 1920 },
      durationSecs: secs,
    });

    markVideoBluesky(article.id, { status: "posted", postId: bs.uri });
    logger.info(
      `🦋 BLUESKY VIDEO PUBLISHED ${bs.uri} (${posted24h + 1}/${max} today, ` +
      `${(bs.bytes / 1048576).toFixed(1)}MB, ${secs?.toFixed?.(1) ?? "?"}s) — ${bs.url}`
    );
    return { status: "posted", id: bs.uri, url: bs.url, seconds: secs, bytes: bs.bytes };

  } catch (err) {
    logger.error(
      `🚨 BLUESKY VIDEO FAILED for ${article.id} — nothing was published. The YouTube video IS ` +
      `published and unaffected. ${err.message}`
    );
    try { markVideoBluesky(article.id, { status: "failed", error: err.message }); }
    catch (dbErr) { logger.error(`🚨 bluesky: could not record the failure either: ${dbErr.message}`); }
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
    videoToBluesky: _videoToBluesky = videoToBluesky,
    videoToTikTok: _videoToTikTok = videoToTikTok,
    videoToX: _videoToX = videoToX,
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
  // Counted separately from `attempts` on purpose — see the MAX_SPEC_CALLS
  // header. `attempts.length` is how many candidates were examined; this is how
  // many of them cost money.
  let specCalls = 0;
  // Snapshotted once per cycle. Read lazily (so tests and .env can move them),
  // but fixed for the duration of a run — a budget that changes underneath a
  // half-finished loop is not a budget.
  const maxSpecCalls = MAX_SPEC_CALLS(), maxScan = MAX_SCAN();
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
    const raw = findFreshUnvideoedArticles({ limit: CANDIDATE_POOL(), now });
    const afterRule0 = filterAtSelection(raw);

    // PUBLISHER COOLDOWN, ONCE PER PUBLISHER. It is a fact about a masthead, not
    // about an article, and asking it per-article is what spent 7 of 8 attempts
    // to learn 4 facts. Placed ahead of diversity as the coarser, cheaper filter
    // — not because the order changes the result; see publisherCooldownFilter.
    const { kept: afterCooldown, dropped: cooled, queries: cooldownQueries } =
      publisherCooldownFilter(afterRule0, { now });

    // PUBLISHER DIVERSITY AT SELECTION. Length-first ordering handed the window
    // to whoever writes longest — Yahoo Finance took 5 of 7 candidates, then 2
    // of 2. The publish-time cooldown cannot fix that: it refuses the second
    // VIDEO, long after the cycle has spent all eight attempts inside one
    // masthead. Capping the attempt list is the only place this is reachable.
    const { kept: eligible, dropped: crowded } = diversifyByPublisher(afterCooldown);
    logger.info(
      `🎬 video cycle: ${raw.length} fresh (pool ${CANDIDATE_POOL()}) → ${afterRule0.length} after Rule 0 → ` +
      `${afterCooldown.length} after publisher cooldown (${cooldownQueries} publisher(s) checked` +
      `${cooled.length ? `, dropped ${cooled.length}` : ""}) → ` +
      `${eligible.length} after publisher diversity (max ${MAX_PER_PUBLISHER}/publisher` +
      `${crowded.length ? `, dropped ${crowded.length}` : ""}) · ${rate.published24h}/${rate.max} today`
    );
    // NO SILENT CAPS. Every article set aside before the loop is attributed to
    // the filter that took it and to its publisher — these drops used to be
    // visible as individual SKIP lines, and moving them out of the loop must not
    // make them invisible.
    const tally = (list, name) => {
      if (!list.length) return;
      const by = {};
      for (const a of list) by[a.source_name || "(none)"] = (by[a.source_name || "(none)"] || 0) + 1;
      logger.info(`🎬 ${name}: ${Object.entries(by).map(([k, n]) => `${k} x${n}`).join(", ")}`);
    };
    tally(cooled.map((d) => d.article), "cooldown set aside (published inside 24h)");
    tally(crowded, "diversity set aside");

    // Built ONCE. cooldownGate ran this query per article, on the ~92% with no
    // event linkage, for a result that cannot change while the cycle scans.
    const titleCorpus = buildRecentTitleCorpus({ now });

    for (const article of eligible) {
      // THE MONEY. Checked here so the cycle stops before selecting an article
      // it cannot afford to write a spec for, rather than after.
      if (specCalls >= maxSpecCalls) {
        logger.warn(
          `🎬 video cycle: hit the ${maxSpecCalls}-spec-call cap without producing a video ` +
          `(${attempts.length} candidate(s) examined, $${spendUsd.toFixed(5)} spent)`
        );
        break;
      }
      // THE WORK. A backstop against a pool that is all cheap refusals; it is
      // not expected to fire, so it says so loudly when it does.
      if (attempts.length >= maxScan) {
        logger.warn(
          `🎬 video cycle: hit the ${maxScan}-candidate scan bound after only ${specCalls} spec call(s) — ` +
          `every candidate was refused before the model. This is a selection-yield problem, not a spend problem.`
        );
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

      const gate = selectionGate(article, { now, titleCorpus });
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
      // THE ONLY PLACE THIS IS INCREMENTED. Counted before the await, not after,
      // so a call that throws or hangs still spends its slot — the budget is
      // about what was ASKED of the model, and a request that died mid-flight
      // may well have been billed.
      specCalls += 1;
      rec.specCall = specCalls;
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

      // The job clock. `now` is bound once at cycle entry, which is what the
      // BullMQ lock is measured from — not from when a channel starts.
      const jobStartedAt = now;
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
            ...footageCreditLines(video.footage),
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
          const fb = await runChannel("facebook", channelBudget({ jobStartedAt, channelsRemaining: 7 }),
            (err) => markVideoFacebook(article.id, { status: "failed", error: err.message }),
            () => _crossPostToFacebook(article, {
            filePath: video.path, title, attribution, spec: r.spec, slides: video.slides, now, footage: video.footage,
          }));
          if (fb && fb.status !== "off") produced.facebook = fb;

          // ─── Facebook REEL ───────────────────────────────────────────────
          // A second, independent surface on the same MP4. Same guarded scope
          // and the same never-throws contract as the feed cross-post above,
          // for the same three reasons. Default OFF.
          const reel = await runChannel("facebook-reel", channelBudget({ jobStartedAt, channelsRemaining: 6 }),
            (err) => markVideoFacebook(article.id, { status: "failed", error: err.message }),
            () => _reelToFacebook(article, {
            filePath: video.path, title, attribution,
            spec: r.spec, slides: video.slides, now, footage: video.footage,
          }));
          if (reel && reel.status !== "off") produced.facebookReel = reel;

          // ─── Instagram Reel ──────────────────────────────────────────────
          // URL-fetch surface: Meta pulls the MP4 from our own server. Same
          // guarded scope and never-throws contract as the two above.
          const igReel = await runChannel("instagram-reel", channelBudget({ jobStartedAt, channelsRemaining: 5 }),
            (err) => markVideoInstagram(article.id, { status: "failed", error: err.message }),
            () => _reelToInstagram(article, {
            filePath: video.path, title, attribution,
            spec: r.spec, slides: video.slides, now, footage: video.footage,
          }));
          if (igReel && igReel.status !== "off") produced.instagramReel = igReel;


          // ─── Bluesky ─────────────────────────────────────────────────────
          // AFTER Threads, so the two slowest sit at the end: Threads sleeps
          // ~30s unconditionally and this one waits on a transcode job. Both
          // are bounded, and everything ahead of them is already published.
          //
          // Raw-bytes upload, so unlike Instagram and Threads this leaves no
          // URL for the sweep to race — see migration 026.
          const bs = await runChannel("bluesky", channelBudget({ jobStartedAt, channelsRemaining: 4 }),
            (err) => markVideoBluesky(article.id, { status: "failed", error: err.message }),
            () => _videoToBluesky(article, {
            filePath: video.path, title, attribution,
            spec: r.spec, slides: video.slides, now, footage: video.footage,
          }));
          if (bs && bs.status !== "off") produced.bluesky = bs;

          // ─── TikTok ──────────────────────────────────────────────────────
          // Also raw bytes, so also no sweep race — see migration 028. Last in
          // the chain and inside the same guard: every channel above it has
          // already recorded its own outcome, so a throw here (which its own
          // try/catch should make impossible) cannot undo any of them.
          const tt = await runChannel("tiktok", channelBudget({ jobStartedAt, channelsRemaining: 3 }),
            (err) => markVideoTikTok(article.id, { status: "failed", error: err.message }),
            () => _videoToTikTok(article, {
            filePath: video.path, title, attribution,
            spec: r.spec, slides: video.slides, now, footage: video.footage,
          }));
          if (tt && tt.status !== "off") produced.tiktok = tt;

          // ─── X ───────────────────────────────────────────────────────────
          // Raw bytes again, so no sweep race — see migration 029. The caption
          // carries NO link: $0.015 a post against $0.20 with one.
          const xp = await runChannel("x", channelBudget({ jobStartedAt, channelsRemaining: 2 }),
            (err) => markVideoX(article.id, { status: "failed", error: err.message }),
            () => _videoToX(article, {
            filePath: video.path, title, attribution,
            spec: r.spec, slides: video.slides, now, footage: video.footage,
          }));
          if (xp && xp.status !== "off") produced.x = xp;

          // ─── Threads ─────────────────────────────────────────────────────
          // GENUINELY LAST NOW. The comment here always said "LAST,
          // deliberately" because Threads sleeps ~30s unconditionally — but
          // Bluesky, TikTok and X were each added AFTER it, so the slowest and
          // least reliable channel had drifted into the middle of the queue.
          //
          // On 2026-08-25 that cost a whole render: Threads went `pending` and
          // never returned, and Bluesky / TikTok / X — two of which had been
          // proven working by direct posts minutes earlier — were never
          // attempted. Ordering is not cosmetic here: whatever stalls first
          // takes everything behind it, so the known-slow channel belongs at
          // the back where it can only cost itself.
          // LAST, deliberately: its mandatory ~30s wait makes it the longest of
          // the four, and everything ahead of it should already be published
          // before this job spends half a minute asleep.
          const th = await runChannel("threads", channelBudget({ jobStartedAt, channelsRemaining: 1 }),
            (err) => markVideoThreads(article.id, { status: "failed", error: err.message }),
            () => _videoToThreads(article, {
            filePath: video.path, title, attribution,
            spec: r.spec, slides: video.slides, now, footage: video.footage,
          }));
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
    // BOTH NUMBERS, ALWAYS. "tried 8, produced 0 · spec spend $0.00000" was a
    // true line that could not be read: it looked like eight failed generations
    // and was in fact eight free refusals. Stating the spec-call count next to
    // the candidate count makes the difference legible without opening the log.
    logger.info(
      `🎬 video cycle done: examined ${tried}, spec calls ${specCalls}/${maxSpecCalls}, ` +
      `produced ${produced ? 1 : 0}` +
      (specCalls ? ` (yield 1 in ${specCalls} spec call(s))` : "") +
      ` · spec spend $${spendUsd.toFixed(5)}`
    );
    try {
      recordHeartbeat(VIDEO_CYCLE_HEARTBEAT, {
        phase: produced ? "complete" : (extra?.skipped ? "skipped" : "complete"),
        startedAt, finishedAt, durationMs: finishedAt - startedAt,
        tried, specCalls, produced: produced ? 1 : 0, spendUsd: Number(spendUsd.toFixed(5)),
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
    return { ...extra, tried, specCalls, attempts, spendUsd, produced };
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
