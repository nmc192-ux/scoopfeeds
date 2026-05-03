/**
 * /scoop-ops/newsletter — operator endpoints for the newsletter pipeline.
 *
 * GET  /status              — SMTP configured? subscriber counts, welcome
 *                             d1/d3 backlog, last digest send.
 * POST /welcome/run         — manually run one welcome-sequence cycle.
 *                             Useful for verifying SMTP after setting env vars.
 *                             Body: { maxPerStage?: number }   (default 50)
 * POST /welcome/test        — send the d1 + d3 templates to a single email
 *                             address without touching the subscribers table.
 *                             Body: { email: string }
 *
 * All routes mounted under /scoop-ops in server.js.
 */

import { Router } from "express";
import { getDb } from "../models/database.js";
import { getTransport, sendMail } from "../services/mailer.js";
import { runWelcomeSequenceCycle } from "../services/welcomeSequence.js";
import { logger } from "../services/logger.js";

const router = Router();

router.get("/status", (_req, res) => {
  const db = getDb();
  const t  = getTransport();

  const counts = db.prepare(`
    SELECT
      COUNT(*)                                                 AS total,
      SUM(CASE WHEN verified_at     IS NOT NULL THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) AS unsubscribed,
      SUM(CASE WHEN welcome_d1_sent_at IS NOT NULL THEN 1 ELSE 0 END) AS d1_sent,
      SUM(CASE WHEN welcome_d3_sent_at IS NOT NULL THEN 1 ELSE 0 END) AS d3_sent
    FROM subscribers
  `).get();

  const HOUR = 60 * 60 * 1000;
  const DAY  = 24 * HOUR;

  // d1: verified ≥ 18h ago, ≤ 7d ago, no d1 yet
  const d1Pending = db.prepare(`
    SELECT COUNT(*) AS n FROM subscribers
    WHERE verified_at IS NOT NULL AND unsubscribed_at IS NULL
      AND verified_at <= ? AND verified_at >= ?
      AND welcome_d1_sent_at IS NULL
  `).get(Date.now() - 18 * HOUR, Date.now() - 7 * DAY).n;

  // d3: verified ≥ 60h ago, ≤ 14d ago, no d3 yet
  const d3Pending = db.prepare(`
    SELECT COUNT(*) AS n FROM subscribers
    WHERE verified_at IS NOT NULL AND unsubscribed_at IS NULL
      AND verified_at <= ? AND verified_at >= ?
      AND welcome_d3_sent_at IS NULL
  `).get(Date.now() - 60 * HOUR, Date.now() - 14 * DAY).n;

  // Most recent digest send (max last_sent_at across all subscribers)
  const lastDigest = db.prepare(`SELECT MAX(last_sent_at) AS ts FROM subscribers`).get().ts;

  res.json({
    smtp: {
      configured: Boolean(t),
      from: process.env.NEWSLETTER_FROM || "Scoop <no-reply@scoopfeeds.com>",
      host: process.env.SMTP_HOST || null,
      port: Number(process.env.SMTP_PORT || 587),
    },
    subscribers: {
      total:       counts.total       || 0,
      verified:    counts.verified    || 0,
      unsubscribed: counts.unsubscribed || 0,
    },
    welcomeSequence: {
      d1Sent:    counts.d1_sent || 0,
      d3Sent:    counts.d3_sent || 0,
      d1Pending,
      d3Pending,
    },
    lastDigestAt: lastDigest ? new Date(lastDigest).toISOString() : null,
  });
});

// Manually run the welcome cycle once.
router.post("/welcome/run", async (req, res) => {
  const maxPerStage = Math.min(Number(req.body?.maxPerStage) || 50, 500);
  try {
    const counts = await runWelcomeSequenceCycle({ maxPerStage });
    res.json({ ok: true, ...counts });
  } catch (err) {
    logger.error(`welcome/run failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Send a test welcome email to an arbitrary address (does NOT subscribe them).
// Useful as the first sanity-check after wiring up SMTP env vars.
router.post("/welcome/test", async (req, res) => {
  const email = String(req.body?.email || "").trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "Provide a valid `email` in the body." });
  }
  if (!getTransport()) {
    return res.status(503).json({ ok: false, error: "SMTP not configured (set SMTP_HOST/PORT/USER/PASS in Hostinger env)." });
  }

  try {
    await sendMail({
      to: email,
      subject: "[Scoop test] Welcome sequence preview",
      html:
        `<div style="font-family:system-ui;max-width:560px;margin:auto;padding:24px;color:#111;line-height:1.6">
          <p style="font-size:12px;color:#888;margin:0 0 16px;text-transform:uppercase;letter-spacing:1.5px">Test send</p>
          <h2 style="margin:0 0 14px">Welcome sequence is wired up ✓</h2>
          <p>This message confirms that SMTP is configured correctly on scoopfeeds.com. New subscribers will now receive:</p>
          <ul>
            <li><strong>Day 0:</strong> double-opt-in confirm link.</li>
            <li><strong>Day 1 (≥18h after verify):</strong> "what to expect" email.</li>
            <li><strong>Day 3 (≥60h after verify):</strong> "pick your topics" nudge.</li>
          </ul>
          <p>Server: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}</p>
        </div>`,
      text: "Welcome sequence is wired up. Test send confirms SMTP is operational on scoopfeeds.com.",
    });
    res.json({ ok: true, sent: email });
  } catch (err) {
    logger.error(`welcome/test failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
