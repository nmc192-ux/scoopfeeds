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
} from "../models/database.js";
import { filterAtSelection, assertPublishAllowed } from "./videoPakistanBlock.js";
import { selectionGate } from "./videoSelection.js";
import { resolveAttribution, buildDescriptionCredit } from "./videoAttribution.js";
import { writeVideoSpec, writePackaging, isVideoSpecEnabled } from "./videoSpecWriter.js";
import { statesForCard, renderState, fitStatesToDuration, videoDesignKey } from "./videoSlideRenderer.js";
import { assembleSlide, concatSlides, holdForAudio } from "./videoAssembler.js";
import { acquireFrameDir, releaseFrameDir, VIDEOS_DIR } from "./videoArtifacts.js";
import { voiceSpec, isVoiceConfigured } from "./videoVoice.js";
import { uploadToYouTube, isYouTubeConfigured } from "./youtubeClient.js";

export const VIDEO_CYCLE_HEARTBEAT = "video_cycle";

export const VIDEO_MAX_PER_DAY = () =>
  Number.parseInt(process.env.VIDEO_MAX_PER_DAY || "", 10) || 4;

/** 24h / max × 0.8 — five opportunities for four videos. See the header. */
export const videoMinIntervalMs = () =>
  Number.parseInt(process.env.VIDEO_MIN_INTERVAL_MS || "", 10) ||
  Math.round((24 * 60 * 60 * 1000 / VIDEO_MAX_PER_DAY()) * 0.8);

export const autopostEnabled = () => process.env.VIDEO_AUTOPOST_ENABLED === "1";

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
      let states = statesForCard(card, { outlet: attribution.publisher, slideIndex: i, slideCount: slides.length });
      states = fitStatesToDuration(states, audioSecs, { cardType: card.t, slideIndex: i });
      const hold = holdForAudio(audioSecs, states.length);

      const paths = [];
      for (const st of states) {
        const p = path.join(work, `s${String(i).padStart(2, "0")}-${st.key}.png`);
        const { writeFileSync } = await import("fs");
        writeFileSync(p, await renderState(st));
        paths.push(p);
      }
      const seg = path.join(work, `slide${String(i).padStart(2, "0")}.mp4`);
      await assembleSlide({
        statePaths: paths, hold, outputPath: seg, driftDir: i,
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
  try { recordHeartbeat(VIDEO_CYCLE_HEARTBEAT, { phase: "start", startedAt }); } catch { /* telemetry never blocks */ }

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
    const eligible = filterAtSelection(raw);
    logger.info(`🎬 video cycle: ${raw.length} fresh → ${eligible.length} after Rule 0 · ${rate.published24h}/${rate.max} today`);

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
    return { ...extra, tried, attempts, spendUsd, produced };
  }
}

/** Health for the ops route: a start with no matching complete is a hang. */
export function getVideoCycleHealth({ now = Date.now() } = {}) {
  const { lastAt, meta } = getHeartbeatRow(VIDEO_CYCLE_HEARTBEAT);
  const phase = meta && typeof meta === "object" ? meta.phase : null;
  const startedAt = meta && typeof meta === "object" ? meta.startedAt || null : null;
  const startAge = startedAt ? now - startedAt : null;
  const hung = phase === "start" && startAge != null && startAge > CYCLE_HANG_MS;
  if (hung) {
    logger.error(`🫀 video cycle HUNG — started ${Math.round(startAge / 60000)}m ago and never completed.`);
  }
  return { lastAt, ageMs: lastAt ? now - lastAt : null, phase, startedAt, hung, hangThresholdMs: CYCLE_HANG_MS };
}
