/**
 * /api/videos-gen — video generation job queue admin API.
 *
 * All routes are WAF-protected via the /scoop-ops/* prefix configured in
 * server.js. No external auth beyond the shared OPS_SECRET header.
 *
 * GET  /api/videos-gen/status       — pipeline + queue stats
 * GET  /api/videos-gen/queue        — list jobs (filterable by status)
 * POST /api/videos-gen/enqueue      — manually queue an article
 * POST /api/videos-gen/approve/:id  — approve a 'ready' job for auto-publish
 * POST /api/videos-gen/reject/:id   — reject a 'ready' job
 * POST /api/videos-gen/run          — run one batch cycle (renders up to N jobs)
 * GET  /api/videos-gen/preview/:id  — return base64 thumbnail PNG for a job
 */

import { Router } from "express";
import express from "express";
import { writeFileSync, existsSync, mkdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  listVideoJobs,
  getVideoJobById,
  approveVideoJob,
  rejectVideoJob,
  enqueueVideoJob,
  setVideoJobRendering,
  setVideoJobReady,
  setVideoJobFailed,
  findArticlesForVideoQueue,
  getArticleById,
  getDb,
  listLiveEvents,
  getLiveEvent,
} from "../models/database.js";
import { isVideoConfigured, generateVideo, generateRecapVideo, generateLiveEventVideo, previewSlide } from "../services/videoGenerator.js";
import { isTtsConfigured, ttsProvider } from "../services/ttsService.js";
import { logger } from "../services/logger.js";

const router = Router();

// ─── Admin guard (shared with social.js + newsletter-ops) ──────────────────
// Same pattern as the rest of /scoop-ops: opt-in gating via ADMIN_KEY env.
// When ADMIN_KEY is unset (dev / first boot) the routes are open. When set,
// every request must include ?key=<value>. The 404 response (vs 401) keeps
// the URL undiscoverable on the public web.
const ADMIN_KEY = process.env.ADMIN_KEY || "";
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return next();
  if (req.query.key === ADMIN_KEY) return next();
  res.status(404).type("html").send(
    `<!doctype html><html><head><title>Not found</title></head><body><h1>404</h1></body></html>`
  );
}

// ─── Filesystem paths (mirrored from videoGenerator.js) ─────────────────────
const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
// Use SCOOP_PERSISTENT_DATA_DIR when available so rendered MP4s survive
// Hostinger redeploys that wipe the deploy directory. Wrap in try/catch so
// a filesystem permission error cannot crash the whole server at import time.
const _persistentBase = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
  : null;
const VIDEOS_DIR = _persistentBase
  ? path.join(_persistentBase, "videos")
  : path.join(BACKEND_ROOT, "data", "videos");
try {
  if (!existsSync(VIDEOS_DIR)) mkdirSync(VIDEOS_DIR, { recursive: true });
} catch (e) {
  console.error("[videos-gen] Could not create VIDEOS_DIR:", VIDEOS_DIR, e.message);
}

// Raw MP4 body parser — used by /upload. Express's default body parsers
// (express.json) ignore video/mp4, so we need a per-route raw parser.
const mp4Parser = express.raw({
  type:  ["video/mp4", "application/octet-stream"],
  limit: "50mb",
});

// ─── Status ──────────────────────────────────────────────────────────────────
router.get("/status", (_req, res) => {
  const jobs = listVideoJobs({ limit: 1000 });
  const byStatus = {};
  for (const j of jobs) {
    byStatus[j.status] = (byStatus[j.status] || 0) + 1;
  }
  res.json({
    configured: isVideoConfigured(),
    ttsConfigured: isTtsConfigured(),
    ttsProvider: ttsProvider(),
    jobsByStatus: byStatus,
    totalJobs: jobs.length,
  });
});

// ─── Queue listing ───────────────────────────────────────────────────────────
router.get("/queue", (req, res) => {
  const { status = null, limit = 50, offset = 0 } = req.query;
  const jobs = listVideoJobs({ status: status || null, limit: parseInt(limit), offset: parseInt(offset) });
  res.json({ jobs, count: jobs.length });
});

// ─── Manually enqueue ────────────────────────────────────────────────────────
router.post("/enqueue", requireAdmin, (req, res) => {
  const { articleId } = req.body || {};
  if (!articleId) return res.status(400).json({ error: "articleId required" });
  const article = getArticleById(articleId);
  if (!article) return res.status(404).json({ error: "article not found" });
  const jobId = enqueueVideoJob(articleId);
  res.json({ jobId, article: { id: article.id, title: article.title } });
});

// ─── Approve / reject ─────────────────────────────────────────────────────────
router.post("/approve/:id", requireAdmin, (req, res) => {
  const job = getVideoJobById(parseInt(req.params.id));
  if (!job) return res.status(404).json({ error: "job not found" });
  if (!["ready", "review_approved"].includes(job.status)) {
    return res.status(400).json({ error: `job status is '${job.status}', cannot approve` });
  }
  approveVideoJob(job.id);
  res.json({ ok: true, jobId: job.id, status: "review_approved" });
});

router.post("/reject/:id", requireAdmin, (req, res) => {
  const job = getVideoJobById(parseInt(req.params.id));
  if (!job) return res.status(404).json({ error: "job not found" });
  rejectVideoJob(job.id);
  res.json({ ok: true, jobId: job.id, status: "review_rejected" });
});

// ─── Preview thumbnail ───────────────────────────────────────────────────────
router.get("/preview/:id", async (req, res) => {
  const job = getVideoJobById(parseInt(req.params.id));
  if (!job) return res.status(404).json({ error: "job not found" });

  if (job.thumbnail_b64) {
    return res.json({ thumbnailB64: job.thumbnail_b64 });
  }

  // Render on demand
  const article = getArticleById(job.article_id);
  if (!article) return res.status(404).json({ error: "article not found" });

  const b64 = await previewSlide(article).catch(() => null);
  res.json({ thumbnailB64: b64 });
});

// ─── Run batch ───────────────────────────────────────────────────────────────
// Picks up to `batchSize` queued jobs, renders them, marks ready for review.
// This is safe to call from a cron (idempotent, serial within request).
router.post("/run", requireAdmin, async (req, res) => {
  if (!isVideoConfigured()) {
    return res.json({ ok: false, reason: "ffmpeg not configured", processed: 0 });
  }

  const batchSize = Math.min(parseInt(req.body?.batchSize || 3), 10);
  const results = [];

  // 1. Find queued jobs
  const queued = listVideoJobs({ status: "queued", limit: batchSize });

  // 2. If fewer than batchSize queued jobs, auto-enqueue fresh articles
  if (queued.length < batchSize) {
    const toQueue = findArticlesForVideoQueue({
      minCredibility: 7,
      withinMs: 24 * 60 * 60 * 1000,
      limit: batchSize - queued.length,
    });
    for (const a of toQueue) {
      const jid = enqueueVideoJob(a.id);
      queued.push({ id: jid, article_id: a.id });
    }
  }

  // 3. Render each job
  for (const job of queued.slice(0, batchSize)) {
    const jobId = job.id;
    const articleId = job.article_id;
    setVideoJobRendering(jobId);

    try {
      const article = getArticleById(articleId);
      if (!article) throw new Error("article not found");

      const result = await generateVideo(article);

      if (!result) {
        setVideoJobFailed(jobId, "generateVideo returned null (ffmpeg/fonts unavailable)");
        results.push({ jobId, articleId, ok: false, reason: "ffmpeg unavailable" });
        continue;
      }

      // Optionally render a thumbnail for the admin UI
      const thumbB64 = await previewSlide(article).catch(() => null);

      setVideoJobReady(jobId, {
        outputPath:   result.outputPath,
        hasAudio:     result.hasAudio,
        durationSecs: result.durationSecs,
        thumbnailB64: thumbB64,
      });

      results.push({
        jobId, articleId, ok: true,
        outputPath: result.outputPath,
        hasAudio: result.hasAudio,
        durationSecs: result.durationSecs,
      });

      logger.info(`video batch: job ${jobId} → ready (${result.outputPath})`);
    } catch (err) {
      setVideoJobFailed(jobId, err.message);
      results.push({ jobId, articleId, ok: false, reason: err.message });
      logger.error(`video batch: job ${jobId} failed: ${err.message}`);
    }
  }

  res.json({ ok: true, processed: results.length, results });
});

// ─── Recap generator ─────────────────────────────────────────────────────────
// POST /scoop-ops/videos-gen/recap
//   Body: { kind?: "daily"|"weekly", category?: string, label?: string }
//
// Renders a single ~60s vertical MP4 covering the top 5 articles in the
// requested window — daily Top 5 by default, optionally filtered to a category
// for "This week in AI / Cars / Pakistan" weekly recaps. Output lands in
// data/videos/ and the path is returned for manual review.
router.post("/recap", requireAdmin, async (req, res) => {
  if (!isVideoConfigured()) {
    return res.json({ ok: false, reason: "ffmpeg/fonts not configured" });
  }

  const kind     = req.body?.kind === "weekly" ? "weekly" : "daily";
  const category = req.body?.category ? String(req.body.category) : null;
  const windowMs = kind === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

  // Auto-build a label if none was provided.
  const dateStamp = new Date().toISOString().slice(0, 10);
  const defaultLabel = category
    ? (kind === "weekly" ? `This week in ${category}` : `Top in ${category}`)
    : (kind === "weekly" ? "This week's top stories"  : "Top 5 today");
  const label = req.body?.label?.trim() || defaultLabel;
  const slug  = `${kind}-${category || "all"}-${dateStamp}`;

  // Pick the top 5 articles in the window — credibility-gated and category-filtered.
  const cutoff = Date.now() - windowMs;
  const params = [cutoff];
  let where = `WHERE published_at > ? AND credibility >= 7`;
  if (category) { where += ` AND category = ?`; params.push(category); }
  const articles = getDb().prepare(`
    SELECT id, title, description, content, category, source_name, published_at, credibility
    FROM articles
    ${where}
    ORDER BY credibility DESC, published_at DESC
    LIMIT 5
  `).all(...params);

  if (articles.length < 3) {
    return res.json({
      ok: false,
      reason: `not enough articles in window (got ${articles.length}, need 3+)`,
    });
  }

  try {
    const result = await generateRecapVideo({ articles, label, slug });
    if (!result) {
      return res.json({ ok: false, reason: "generateRecapVideo returned null" });
    }
    res.json({
      ok:           true,
      kind, category, label, slug,
      outputPath:   result.outputPath,
      durationSecs: result.durationSecs,
      hasAudio:     result.hasAudio,
      slideCount:   result.slideCount,
      cached:       Boolean(result.cached),
      articles:     articles.map(a => ({ id: a.id, title: a.title, category: a.category })),
    });
  } catch (err) {
    logger.error(`recap generator failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Live-event recap generator ──────────────────────────────────────────────
// POST /scoop-ops/videos-gen/live-event
//   Body: { eventId?: string }   — omit to use the most recently updated event
//
// Renders a 60s vertical MP4 from a synthesized live-event dossier (4 points
// from `brief` + a metrics tile). Output lands in data/videos/live-{eventId}-
// {date}.mp4 and is suitable for direct upload to Shorts/TikTok/Reels.
router.post("/live-event", requireAdmin, async (req, res) => {
  if (!isVideoConfigured()) {
    return res.json({ ok: false, reason: "ffmpeg/fonts not configured" });
  }

  let eventId = req.body?.eventId ? String(req.body.eventId) : null;
  if (!eventId) {
    // Default to the most-recently-updated active event.
    const list = listLiveEvents().filter(e => e.status === "active" || e.status == null);
    if (!list.length) return res.json({ ok: false, reason: "no active live events" });
    eventId = list[0].id;
  }

  const event = getLiveEvent(eventId);
  if (!event) return res.status(404).json({ ok: false, error: `live event '${eventId}' not found` });
  if (!Array.isArray(event.brief) || event.brief.length < 2) {
    return res.json({
      ok: false,
      reason: `event '${eventId}' has only ${event.brief?.length || 0} brief points; need 2+`,
    });
  }

  try {
    const result = await generateLiveEventVideo(event);
    if (!result) return res.json({ ok: false, reason: "generateLiveEventVideo returned null" });
    res.json({
      ok: true,
      eventId, eventTitle: event.title,
      outputPath:   result.outputPath,
      durationSecs: result.durationSecs,
      hasAudio:     result.hasAudio,
      slideCount:   result.slideCount,
      cached:       Boolean(result.cached),
    });
  } catch (err) {
    logger.error(`live-event video failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Next-batch endpoint (used by GitHub Actions render worker) ────────────
// One-shot endpoint that the worker calls to atomically:
//   1. Seed queued jobs from fresh articles (if the queue is below batchSize)
//   2. Return the queued jobs with their article payload baked in
//
// This collapses what would otherwise be 3 roundtrips (seed, list, fetch) into
// one, saving ~600ms on the worker's cold start.
//
// POST /scoop-ops/videos-gen/next-batch?size=5
//   → { ok: true, jobs: [ { jobId, articleId, article: {...} }, ... ] }
router.post("/next-batch", requireAdmin, express.json({ limit: "8kb" }), (req, res) => {
  const batchSize = Math.min(parseInt(req.query.size || req.body?.size || "3", 10), 10);

  // 1. Look at currently queued jobs.
  let queued = listVideoJobs({ status: "queued", limit: batchSize });

  // 2. If the queue is below batchSize, auto-seed from fresh articles.
  if (queued.length < batchSize) {
    const need = batchSize - queued.length;
    const candidates = findArticlesForVideoQueue({
      minCredibility: 7,
      withinMs:       24 * 60 * 60 * 1000,
      limit:          need,
    });
    for (const a of candidates) {
      const jid = enqueueVideoJob(a.id);
      queued.push({ id: jid, article_id: a.id, status: "queued" });
    }
  }

  // 3. Hydrate each job with the full article payload — saves the worker
  //    a per-job /api/news/:id round trip.
  const jobs = queued.slice(0, batchSize).map((job) => {
    const article = getArticleById(job.article_id);
    if (!article) return null;
    // Mark each job as 'rendering' so a concurrent worker doesn't pick it up.
    setVideoJobRendering(job.id);
    return {
      jobId:     job.id,
      articleId: job.article_id,
      article:   {
        id:           article.id,
        title:        article.title,
        description:  article.description,
        content:      article.content,
        category:     article.category,
        source_name:  article.source_name,
        published_at: article.published_at,
        credibility:  article.credibility,
      },
    };
  }).filter(Boolean);

  res.json({ ok: true, count: jobs.length, jobs });
});

// ─── Upload endpoint (used by GitHub Actions render worker) ─────────────────
// On Hostinger Cloud Hosting `spawn()` is blocked at the kernel level, so we
// can't render videos in-process. The companion GitHub Actions workflow
// (.github/workflows/render-videos.yml) renders MP4s on free runners and
// uploads them here. This endpoint:
//   1. Validates the jobId belongs to a real, rendering-or-queued job
//   2. Writes the raw MP4 body to data/videos/{articleId}-shorts.mp4
//   3. Marks the job 'ready' so it shows up in the admin review queue
//
// POST /scoop-ops/videos-gen/upload?jobId=N&durationSecs=37&hasAudio=false
//   Content-Type: video/mp4   (or application/octet-stream)
//   Body: <raw MP4 bytes, max 50 MB>
router.post("/upload", requireAdmin, mp4Parser, (req, res) => {
  const jobId = parseInt(req.query.jobId, 10);
  if (!jobId) return res.status(400).json({ ok: false, error: "jobId query param required" });

  const job = getVideoJobById(jobId);
  if (!job) return res.status(404).json({ ok: false, error: `job ${jobId} not found` });
  if (!["queued", "rendering"].includes(job.status)) {
    return res.status(409).json({ ok: false, error: `job ${jobId} is in status '${job.status}', cannot upload` });
  }

  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) {
    return res.status(400).json({ ok: false, error: "missing or too-small MP4 body (need ≥1KB)" });
  }
  // Sanity ceiling — 50mb limit is enforced by the body parser, but keep an
  // explicit guard in case the limit changes.
  if (req.body.length > 60 * 1024 * 1024) {
    return res.status(413).json({ ok: false, error: "MP4 too large (>60 MB)" });
  }

  // Write to the same path generateVideo() would use locally — keeps the rest
  // of the pipeline (file-serve, social poster) unchanged.
  const articleId  = String(job.article_id);
  const safeId     = articleId.replace(/[^a-z0-9_-]/gi, "_");
  const outputPath = path.join(VIDEOS_DIR, `${safeId}-shorts.mp4`);

  try {
    writeFileSync(outputPath, req.body);
    const sizeBytes = statSync(outputPath).size;

    setVideoJobReady(jobId, {
      outputPath,
      hasAudio:     req.query.hasAudio === "true",
      durationSecs: parseInt(req.query.durationSecs, 10) || 37,
      thumbnailB64: null,
    });

    logger.info(`📥 Video uploaded for job ${jobId} (article ${articleId}, ${(sizeBytes / 1024).toFixed(0)} KB) → ${outputPath}`);
    res.json({ ok: true, jobId, articleId, outputPath, sizeBytes });
  } catch (err) {
    logger.error(`upload write failed for job ${jobId}: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Mark-failed endpoint (worker-driven) ──────────────────────────────────
// POST /scoop-ops/videos-gen/mark-failed?jobId=N
//   Body: { reason?: string }
// Used by the GH Actions worker when a render fails — moves the job out of
// the 'rendering' state so it doesn't block subsequent batch picks.
router.post("/mark-failed", requireAdmin, express.json({ limit: "8kb" }), (req, res) => {
  const jobId = parseInt(req.query.jobId || req.body?.jobId, 10);
  if (!jobId) return res.status(400).json({ ok: false, error: "jobId required" });
  const job = getVideoJobById(jobId);
  if (!job) return res.status(404).json({ ok: false, error: `job ${jobId} not found` });
  const reason = String(req.body?.reason || "worker reported failure").slice(0, 300);
  setVideoJobFailed(jobId, reason);
  logger.warn(`video job ${jobId} marked failed: ${reason}`);
  res.json({ ok: true, jobId, status: "failed", reason });
});

// ─── Reset failed jobs ───────────────────────────────────────────────────────
// POST /scoop-ops/videos-gen/reset-failed
//   Body: { all?: boolean }  — if all=true resets ALL failed jobs, otherwise
//                              only jobs where error contains "ffmpeg not configured"
//                              (the ones that failed because the host blocked spawn)
//
// Resets jobs from 'failed' → 'queued' so the GitHub Actions worker can pick
// them up on the next render run.  Safe to call repeatedly — only affects
// failed jobs, never touches ready/published/rendering jobs.
router.post("/reset-failed", requireAdmin, express.json({ limit: "8kb" }), (req, res) => {
  const resetAll = Boolean(req.body?.all);
  const db = getDb();

  let changed;
  if (resetAll) {
    changed = db.prepare(
      `UPDATE video_jobs SET status = 'queued', error = NULL WHERE status = 'failed'`
    ).run();
  } else {
    // Default: only reset jobs that failed because ffmpeg wasn't available on
    // the host — those are safe to retry anywhere (including GH Actions).
    changed = db.prepare(
      `UPDATE video_jobs SET status = 'queued', error = NULL
       WHERE status = 'failed'
         AND (error LIKE '%ffmpeg%' OR error LIKE '%canSpawn%' OR error LIKE '%not configured%' OR error IS NULL)`
    ).run();
  }

  const remaining = db.prepare(`SELECT COUNT(*) AS n FROM video_jobs WHERE status = 'failed'`).get();
  const nowQueued = db.prepare(`SELECT COUNT(*) AS n FROM video_jobs WHERE status = 'queued'`).get();

  logger.info(`video reset-failed: ${changed.changes} job(s) reset to queued (resetAll=${resetAll})`);
  res.json({
    ok:         true,
    reset:      changed.changes,
    resetAll,
    nowQueued:  nowQueued.n,
    stillFailed: remaining.n,
  });
});

// ─── Serve the rendered MP4 ─────────────────────────────────────────────────
// Public — needed so social platform embeds + the admin review UI can play
// the video. Falls back to 404 cleanly when a job hasn't been rendered yet.
router.get("/file/:articleId", (req, res) => {
  const articleId = String(req.params.articleId).replace(/[^a-z0-9_-]/gi, "_");
  const filePath  = path.join(VIDEOS_DIR, `${articleId}-shorts.mp4`);
  if (!existsSync(filePath)) return res.status(404).json({ ok: false, error: "not rendered yet" });
  res.type("video/mp4");
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.sendFile(filePath);
});

export default router;
