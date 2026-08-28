/**
 * /scoop-ops/video — the recovery surface for the autopost loop.
 *
 * Mounted under the /scoop-ops prefix, which applies adminAuth +
 * adminAuditLogger centrally in server.js. This router must NOT re-implement
 * auth: adding a router under that prefix inherits it, and a second
 * implementation is how the two drift apart.
 *
 * §6.3's "the loop went wrong at 3am" button. Deleting six videos by hand
 * through the YouTube UI is not a recovery plan, and the guardrails are what
 * make "delete it later" a survivable policy at all — so they ship with the
 * loop rather than after it.
 */

import { Router } from "express";
import express from "express";
import { logger } from "../services/logger.js";
import { recentPublishedVideos, videoPostByYouTubeId, markVideoPrivacy } from "../models/database.js";
import { setYouTubePrivacy, isYouTubeConfigured } from "../services/youtubeClient.js";
import { getVideoCycleHealth, rateGate, VIDEO_MAX_PER_DAY, videoMinIntervalMs, autopostEnabled } from "../services/videoAutopost.js";

const router = Router();

/**
 * POST /scoop-ops/video/unlist-recent?n=5
 *
 * Flips the last N published videos to private, in one call, updating
 * video_posts.privacy_status as it goes.
 *
 * PARTIAL SUCCESS IS REPORTED, NOT SWALLOWED. If the third of five fails, the
 * first two are already private and saying "error" would be a lie that sends
 * someone to the UI to redo work already done. Each row reports its own
 * outcome and the response is a per-video ledger.
 *
 * The DB write happens only after the API call succeeds — a row marked
 * private while the video is still public is worse than no row change, because
 * it makes the next operator believe the problem is handled.
 */
router.post("/unlist-recent", express.json({ limit: "8kb" }), async (req, res) => {
  const n = Math.min(Math.max(Number.parseInt(req.query.n ?? req.body?.n ?? "5", 10) || 5, 1), 25);
  const privacy = String(req.query.privacy || req.body?.privacy || "private");
  if (!["private", "unlisted"].includes(privacy)) {
    return res.status(400).json({ error: `privacy must be private|unlisted, got ${privacy}` });
  }
  if (!isYouTubeConfigured()) return res.status(503).json({ error: "YouTube not configured" });

  const rows = recentPublishedVideos(n);
  logger.warn(`🚨 unlist-recent: flipping ${rows.length} video(s) to ${privacy} — requested n=${n}`);

  const results = [];
  for (const row of rows) {
    try {
      await setYouTubePrivacy(row.youtube_id, privacy);
      markVideoPrivacy(row.article_id, privacy);
      results.push({ youtubeId: row.youtube_id, articleId: row.article_id, title: row.title, ok: true });
      logger.warn(`🚨 unlisted ${row.youtube_id} — "${String(row.title || "").slice(0, 60)}"`);
    } catch (err) {
      results.push({ youtubeId: row.youtube_id, articleId: row.article_id, ok: false, error: err.message });
      logger.error(`🚨 unlist FAILED for ${row.youtube_id}: ${err.message}`);
    }
  }

  const flipped = results.filter(r => r.ok).length;
  res.json({
    requested: n, found: rows.length, flipped, failed: results.length - flipped,
    privacy, results,
  });
});

/**
 * POST /scoop-ops/video/unlist/:youtubeId?privacy=private
 *
 * THE TARGETED WITHDRAWAL. One named video, and only that video.
 *
 * WHY THIS EXISTS SEPARATELY FROM unlist-recent (DrJ, Gate E). `unlist-recent`
 * flips the last N published, which is the right shape for "the loop went wrong
 * at 3am" and the wrong shape for "the person in that clip has asked us to take
 * it down". Using the recency route for a targeted withdrawal either requires
 * the video to happen to be the most recent, or takes down N-1 videos nobody
 * asked about. Both routes stay: they answer different questions, and deleting
 * the recovery button to get a takedown button would be trading one gap for
 * another.
 *
 * IT DOES NOT REQUIRE US TO HOLD A ROW. A takedown is about a video on a
 * platform, not about our bookkeeping. If `video_posts` has no row for the id —
 * a hand-uploaded video, a row pruned, an article deleted — the privacy flip
 * still happens and the response says `known: false`. Refusing because our own
 * table is thin would be the worst possible moment to be pedantic. YouTube's
 * own 404 (no such video) and 403 (not ours) are what make a wrong id safe.
 *
 * The DB write happens only after the API call succeeds, for the same reason as
 * in unlist-recent: a row marked private while the video is still public makes
 * the next operator believe the problem is handled.
 */
router.post("/unlist/:youtubeId", express.json({ limit: "8kb" }), async (req, res) => {
  const youtubeId = String(req.params.youtubeId || "").trim();
  const privacy = String(req.query.privacy || req.body?.privacy || "private");

  if (!youtubeId) return res.status(400).json({ error: "youtubeId required" });
  if (!["private", "unlisted"].includes(privacy)) {
    return res.status(400).json({ error: `privacy must be private|unlisted, got ${privacy}` });
  }
  if (!isYouTubeConfigured()) return res.status(503).json({ error: "YouTube not configured" });

  const row = videoPostByYouTubeId(youtubeId);
  logger.warn(
    `🚨 unlist ${youtubeId} → ${privacy}` +
    (row ? ` — "${String(row.title || "").slice(0, 60)}" (article ${row.article_id})` : " — no video_posts row; flipping anyway")
  );

  try {
    await setYouTubePrivacy(youtubeId, privacy);
  } catch (err) {
    logger.error(`🚨 unlist FAILED for ${youtubeId}: ${err.message}`);
    return res.status(502).json({ youtubeId, privacy, ok: false, known: Boolean(row), error: err.message });
  }

  // Only now. The video has actually moved.
  if (row) markVideoPrivacy(row.article_id, privacy);

  res.json({
    youtubeId, privacy, ok: true,
    known: Boolean(row),
    articleId: row?.article_id ?? null,
    title: row?.title ?? null,
    dbRowUpdated: Boolean(row),
    // Said in the response because the runbook's next step depends on it: six of
    // seven surfaces have no retraction API and are hand actions.
    note: "YouTube only. Facebook, Instagram, Threads, Bluesky, TikTok and X must be removed by hand — see docs/ops/runbooks/incident_takedown.md",
  });
});

/** GET /scoop-ops/video/status — gates, health, and whether the loop is even armed. */
router.get("/status", (_req, res) => {
  const gate = rateGate();
  res.json({
    autopostEnabled: autopostEnabled(),
    maxPerDay: VIDEO_MAX_PER_DAY(),
    minIntervalMs: videoMinIntervalMs(),
    minIntervalHours: Number((videoMinIntervalMs() / 3600000).toFixed(2)),
    gate,
    cycle: getVideoCycleHealth(),
    recent: recentPublishedVideos(10).map(r => ({
      articleId: r.article_id, youtubeId: r.youtube_id, title: r.title,
      privacy: r.privacy_status, publishedAt: r.published_at, source: r.source_name,
    })),
  });
});

export default router;
