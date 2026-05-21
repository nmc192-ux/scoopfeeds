/**
 * /scoop-ops/x-digest — operator endpoints for the X-posting digest.
 *
 * GET  /status     — SMTP configured? recipient set? pending count? last
 *                    digest send timestamp? cron schedule.
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
