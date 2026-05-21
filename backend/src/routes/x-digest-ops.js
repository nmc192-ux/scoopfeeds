/**
 * /scoop-ops/x-digest — operator endpoints for the X-posting digest.
 *
 * GET  /status     — SMTP configured? recipient set? pending count? last
 *                    digest send timestamp? cron schedule.
 * GET  /analytics  — queue volume diagnostics: status breakdown, post_type
 *                    split of pending, distinct-article count, age buckets,
 *                    credibility distribution, per-day enqueue rate. Pure
 *                    read-only aggregations; informs curation design.
 * GET  /preview    — render the current digest HTML body without sending.
 *                    Returns an empty-state HTML stub when the queue has
 *                    nothing pending.
 * POST /send-now   — fire sendXPostDigest() immediately. Returns the
 *                    {sent, reason, count, marked} result for confirmation.
 *
 * All routes admin-token-gated via the /scoop-ops parent mount in
 * backend/server.js (adminAuth + adminAuditLogger). No per-router gating
 * needed here.
 */
import { Router } from "express";
import { getDb, listPostsForDigest } from "../models/database.js";
import { getTransport } from "../services/mailer.js";
import { renderDigest, sendXPostDigest } from "../services/xPostDigest.js";
import { logger } from "../services/logger.js";

const router = Router();

router.get("/status", (_req, res) => {
  const db = getDb();
  const t = getTransport();
  const pendingCount = db.prepare(
    `SELECT COUNT(*) AS n FROM x_post_queue WHERE status = 'pending' AND sent_in_digest_at IS NULL`
  ).get().n;
  const lastSent = db.prepare(
    `SELECT MAX(sent_in_digest_at) AS ts FROM x_post_queue WHERE sent_in_digest_at IS NOT NULL`
  ).get().ts;
  res.json({
    ok: true,
    smtp: {
      configured: Boolean(t),
      from: process.env.NEWSLETTER_FROM || "Scoop <no-reply@scoopfeeds.com>",
      host: process.env.SMTP_HOST || null,
      port: Number(process.env.SMTP_PORT || 587),
    },
    recipient: process.env.DIGEST_RECIPIENT_EMAIL || null,
    pendingCount,
    lastSentAt: lastSent ? new Date(lastSent).toISOString() : null,
    cron: "0 9 * * * (UTC)",
  });
});

router.get("/analytics", (_req, res) => {
  const db = getDb();
  const now = Date.now();
  const cutoff12h = now - 12 * 60 * 60 * 1000;
  const cutoff24h = now - 24 * 60 * 60 * 1000;
  const cutoff48h = now - 48 * 60 * 60 * 1000;
  const cutoff7d  = now -  7 * 24 * 60 * 60 * 1000;

  // Q1 — status breakdown across the full table (sanity).
  const statusBreakdown = db.prepare(`
    SELECT status, COUNT(*) AS n
    FROM x_post_queue
    GROUP BY status
    ORDER BY n DESC
  `).all();

  // Q2 — post_type split of pending rows.
  const byPostType = db.prepare(`
    SELECT post_type, COUNT(*) AS n
    FROM x_post_queue
    WHERE status = 'pending'
    GROUP BY post_type
    ORDER BY n DESC
  `).all();

  // Q3 — distinct articles + avg rows/article among pending.
  const pendingAgg = db.prepare(`
    SELECT
      COUNT(DISTINCT article_id) AS distinct_articles,
      COUNT(*)                   AS total_rows
    FROM x_post_queue
    WHERE status = 'pending'
  `).get();
  const avgRowsPerArticle = pendingAgg.distinct_articles > 0
    ? +(pendingAgg.total_rows / pendingAgg.distinct_articles).toFixed(2)
    : 0;

  // Q4 — age distribution of pending rows.
  const ageAgg = db.prepare(`
    SELECT
      MIN(generated_at) AS oldest_ms,
      MAX(generated_at) AS newest_ms,
      SUM(CASE WHEN generated_at < ? THEN 1 ELSE 0 END) AS over_12h,
      SUM(CASE WHEN generated_at < ? THEN 1 ELSE 0 END) AS over_24h,
      SUM(CASE WHEN generated_at < ? THEN 1 ELSE 0 END) AS over_48h,
      SUM(CASE WHEN generated_at < ? THEN 1 ELSE 0 END) AS over_7d
    FROM x_post_queue
    WHERE status = 'pending'
  `).get(cutoff12h, cutoff24h, cutoff48h, cutoff7d);

  // Q5 — credibility distribution of articles backing pending queue rows.
  // Joined to articles to surface the actual credibility values.
  const byCredibility = db.prepare(`
    SELECT
      a.credibility,
      COUNT(*)                AS row_count,
      COUNT(DISTINCT a.id)    AS article_count
    FROM x_post_queue q
    JOIN articles a ON a.id = q.article_id
    WHERE q.status = 'pending'
    GROUP BY a.credibility
    ORDER BY a.credibility DESC
  `).all();

  // Q6 — per-day enqueue rate over the last 14 days (all statuses).
  const enqueueByDay = db.prepare(`
    SELECT
      date(generated_at/1000, 'unixepoch') AS day,
      COUNT(*)                              AS rows_added,
      COUNT(DISTINCT article_id)            AS articles_added
    FROM x_post_queue
    GROUP BY day
    ORDER BY day DESC
    LIMIT 14
  `).all();

  res.json({
    ok: true,
    asOf: new Date(now).toISOString(),
    statusBreakdown,
    pending: {
      total: pendingAgg.total_rows,
      distinctArticles: pendingAgg.distinct_articles,
      avgRowsPerArticle,
      byPostType,
      age: {
        oldestAt: ageAgg.oldest_ms ? new Date(ageAgg.oldest_ms).toISOString() : null,
        newestAt: ageAgg.newest_ms ? new Date(ageAgg.newest_ms).toISOString() : null,
        over12h: ageAgg.over_12h || 0,
        over24h: ageAgg.over_24h || 0,
        over48h: ageAgg.over_48h || 0,
        over7d:  ageAgg.over_7d  || 0,
      },
      byCredibility,
    },
    enqueueRate: {
      perDayLast14: enqueueByDay,
    },
  });
});

router.get("/preview", (_req, res) => {
  const rows = listPostsForDigest({ limit: 200 });
  if (rows.length === 0) {
    return res.send(`<!doctype html><meta charset="utf-8"><title>X-digest preview (empty)</title>
      <body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:80px auto;padding:24px;color:#666;text-align:center">
        <h3 style="color:#111">X-digest preview</h3>
        <p>Queue is empty. Nothing pending digest delivery — the cron would skip-send.</p>
      </body>`);
  }
  const { subject, html } = renderDigest(rows);
  res.send(`<!doctype html><meta charset="utf-8"><title>${subject}</title>${html}`);
});

router.post("/send-now", async (_req, res) => {
  try {
    const result = await sendXPostDigest();
    res.json({ ok: true, result });
  } catch (err) {
    logger.error(`x-digest/send-now failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
