/**
 * /api/newsletter — subscribe / unsubscribe / preview digest.
 *
 * Storage: `subscribers` table (see database.js).
 * Delivery: nodemailer via SMTP (optional — if no SMTP env, subscribes are
 * accepted and stored but email sending is skipped with a warning).
 *
 * Required env (when you want real sending):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   NEWSLETTER_FROM  (e.g. "Scoop <digest@scoopfeeds.com>")
 *   PRIMARY_SITE_URL (defaults to https://scoopfeeds.com)
 */
import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { getDb } from "../models/database.js";
import { getReferralCount } from "../models/database.js";
import { logger } from "../services/logger.js";
import { validate } from "../middleware/validate.js";
import { getTransport, sendMail } from "../services/mailer.js";
import { sendError, sendInternalError, sendSuccess } from "../utils/apiResponse.js";

const router = Router();

const SITE_URL = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");

function randomToken() {
  return crypto.randomBytes(24).toString("hex");
}
const emailSchema = z.string().trim().email();
const hexToken48Schema = z.string().trim().regex(/^[0-9a-f]{48}$/i, "Invalid token");
const subscribeBodySchema = z.object({
  email: emailSchema,
  countryCode: z.string().trim().min(2).max(8).optional().nullable(),
  language: z.string().trim().min(2).max(16).optional().nullable(),
  topics: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  referredBy: hexToken48Schema.optional().nullable(),
});
const tokenQuerySchema = z.object({
  token: hexToken48Schema,
});

// ─── Subscribe ──────────────────────────────────────────────────────────────
router.post("/subscribe", validate(subscribeBodySchema), async (req, res) => {
  const { email, countryCode, language, topics, referredBy } = req.validated.body;
  const db = getDb();
  const now = Date.now();
  const token = randomToken();
  const topicsJson = JSON.stringify(Array.isArray(topics) ? topics.slice(0, 20) : []);
  const refToken = referredBy || null;

  try {
    db.prepare(`
      INSERT INTO subscribers (email, country_code, language, topics, token, referred_by_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        country_code = excluded.country_code,
        language     = excluded.language,
        topics       = excluded.topics,
        referred_by_token = COALESCE(referred_by_token, excluded.referred_by_token),
        unsubscribed_at = NULL
    `).run(
      email.toLowerCase(),
      countryCode || null,
      language   || "en",
      topicsJson,
      token,
      refToken,
      now
    );

    // Best-effort welcome email
    if (getTransport()) {
      const confirmUrl = `${SITE_URL}/api/newsletter/confirm?token=${token}`;
      const unsubUrl   = `${SITE_URL}/api/newsletter/unsubscribe?token=${token}`;
      sendMail({
        to: email,
        subject: "Welcome to Scoop — confirm your subscription",
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:540px;margin:auto;padding:24px;color:#111">
            <h2 style="margin:0 0 12px">Welcome to Scoop 📰</h2>
            <p>Thanks for subscribing to the Scoop daily digest. Tap below to confirm your email:</p>
            <p><a href="${confirmUrl}" style="display:inline-block;background:#007AFF;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Confirm subscription</a></p>
            <p style="font-size:12px;color:#666;margin-top:24px">
              Didn't sign up? <a href="${unsubUrl}">Unsubscribe</a> — we'll stop immediately.
            </p>
          </div>
        `,
      }).catch(err => logger.warn(`welcome email failed: ${err.message}`));
    } else {
      logger.info(`newsletter: no SMTP configured, storing subscriber ${email} without sending welcome`);
    }

    sendSuccess(res, { success: true, token });
  } catch (err) {
    logger.error(`subscribe failed: ${err.message}`);
    sendInternalError(res, req, "Internal error", err);
  }
});

// ─── Confirm (token) ────────────────────────────────────────────────────────
router.get("/confirm", (req, res) => {
  const parsed = tokenQuerySchema.safeParse(req.query || {});
  if (!parsed.success) return sendError(res, req, { status: 400, error: "Missing or invalid token", code: "invalid_token" });
  const { token } = parsed.data;
  const db = getDb();
  const result = db.prepare(`UPDATE subscribers SET verified_at = ? WHERE token = ?`)
    .run(Date.now(), token);
  if (result.changes === 0) return res.status(404).send("Invalid token");
  res.redirect(302, `${SITE_URL}/?newsletter=confirmed`);
});

// ─── Unsubscribe (token) ────────────────────────────────────────────────────
router.get("/unsubscribe", (req, res) => {
  const parsed = tokenQuerySchema.safeParse(req.query || {});
  if (!parsed.success) return sendError(res, req, { status: 400, error: "Missing or invalid token", code: "invalid_token" });
  const { token } = parsed.data;
  const db = getDb();
  const result = db.prepare(`UPDATE subscribers SET unsubscribed_at = ? WHERE token = ?`)
    .run(Date.now(), token);
  if (result.changes === 0) return res.status(404).send("Invalid token");
  res.send(`
    <!doctype html><meta charset="utf-8">
    <title>Unsubscribed — Scoop</title>
    <body style="font-family:system-ui,sans-serif;max-width:420px;margin:80px auto;padding:24px;text-align:center">
      <h2>You're unsubscribed</h2>
      <p>We won't send you any more digests. You can resubscribe anytime at
         <a href="${SITE_URL}">${new URL(SITE_URL).hostname}</a>.</p>
    </body>
  `);
});

// ─── Referral stats (per subscriber token) ──────────────────────────────────
// Used by the frontend "invite friends" card to show live referral count.
router.get("/referral-stats", (req, res) => {
  const parsed = tokenQuerySchema.safeParse(req.query || {});
  if (!parsed.success) return sendError(res, req, { status: 400, error: "Invalid token", code: "invalid_token" });
  const { token } = parsed.data;
  const referrals = getReferralCount(token);
  const referralUrl = `${SITE_URL}/?ref=${token}`;
  sendSuccess(res, { success: true, referrals, referralUrl });
});

// ─── Preview (admin) ────────────────────────────────────────────────────────
router.get("/preview", (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, email, country_code, language, topics, verified_at, unsubscribed_at, created_at
    FROM subscribers ORDER BY created_at DESC LIMIT 50
  `).all();
  res.json({ success: true, count: rows.length, subscribers: rows });
});

export default router;
