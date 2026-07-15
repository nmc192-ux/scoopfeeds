/**
 * /api/auth — magic-link authentication (no passwords).
 *
 * Flow:
 *   1. POST /api/auth/request  { email }
 *      → generates a one-time 32-byte hex token, stores in auth_tokens (30 min TTL),
 *        sends a "sign in" email with the magic link.
 *   2. GET  /api/auth/verify?token=<hex>
 *      → consumes the token, upserts the user, creates a 30-day session,
 *        sets an httpOnly scoop_session cookie, redirects to /?auth=verified.
 *   3. GET  /api/auth/me
 *      → returns the current user from the session cookie.
 *   4. POST /api/auth/logout
 *      → deletes the session row, clears the cookie.
 *   5. PUT  /api/auth/prefs  { preferredTopics, language, preferredCountry }
 *      → updates user prefs (requires session cookie).
 *
 * Session cookie: scoop_session; httpOnly; SameSite=Lax; Secure (prod).
 * Session TTL: 30 days, refreshed on each /me call (last_seen updated).
 */
import { Router } from "express";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  createAuthToken,
  consumeAuthToken,
  upsertUser,
  createUserSession,
  getUserBySession,
  deleteUserSession,
  updateUserPrefs,
  getSavedArticlesForUser,
  saveArticleForUser,
  unsaveArticleForUser,
} from "../models/database.js";
import { authMagicLinkLimiter } from "../middleware/rateLimits.js";
import { validate } from "../middleware/validate.js";
import { sendMail, getTransport } from "../services/mailer.js";
import { logger } from "../services/logger.js";
import { sendError, sendSuccess, sendUnauthorized, sendValidationError } from "../utils/apiResponse.js";

const router = Router();

const SITE_URL    = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_TTL   = 30 * 60 * 1000;            // 30 minutes for magic links
const IS_PROD     = process.env.NODE_ENV === "production" || SITE_URL.startsWith("https://scoopfeeds");
const COOKIE_NAME = "scoop_session";

const authRequestSchema = z.object({
  email: z.string().trim().email(),
});
const authVerifyQuerySchema = z.object({
  token: z.string().trim().regex(/^[0-9a-f]{64}$/i, "Invalid token"),
});
const authPrefsSchema = z.object({
  preferredTopics: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
  language: z.string().trim().min(2).max(16).optional().nullable(),
  preferredCountry: z.string().trim().min(2).max(8).optional().nullable(),
});

function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function setSessionCookie(res, sessionId) {
  res.setHeader("Set-Cookie",
    `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${IS_PROD ? "; Secure" : ""}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${IS_PROD ? "; Secure" : ""}`
  );
}

function getSessionFromRequest(req) {
  const raw = req.headers.cookie || "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

function requireAuth(req, res, next) {
  const sid = getSessionFromRequest(req);
  if (!sid) return sendUnauthorized(res, req, "Not authenticated");
  const user = getUserBySession(sid);
  if (!user) return sendUnauthorized(res, req, "Session expired");
  req.user = user;
  next();
}

/**
 * Non-throwing session lookup for routes that change behavior by auth
 * state without requiring it (e.g. the deep-dive endpoint serves
 * cache-only to anonymous requests — 2026-07-15 cost incident, gate a).
 */
export function getUserFromRequest(req) {
  const sid = getSessionFromRequest(req);
  if (!sid) return null;
  return getUserBySession(sid) || null;
}

// ─── POST /api/auth/request ─────────────────────────────────────────────────
router.post("/request", authMagicLinkLimiter, validate(authRequestSchema), async (req, res) => {
  const { email } = req.validated.body;
  const token = randomHex(32);
  const expiresAt = Date.now() + TOKEN_TTL;
  createAuthToken(token, email, expiresAt);

  const magicLink = `${SITE_URL}/api/auth/verify?token=${token}`;

  if (getTransport()) {
    try {
      await sendMail({
        to: email,
        subject: "Sign in to Scoop",
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">
            <h2 style="margin:0 0 12px">Sign in to Scoop 🔐</h2>
            <p style="color:#444">Click the button below to sign in. This link expires in 30 minutes and can only be used once.</p>
            <p><a href="${magicLink}" style="display:inline-block;background:#007AFF;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Sign in to Scoop</a></p>
            <p style="font-size:12px;color:#999;margin-top:20px">
              If you didn't request this, you can safely ignore this email.
            </p>
          </div>
        `,
      });
    } catch (err) {
      logger.warn(`auth: magic link email failed: ${err.message}`);
      // Don't reveal the failure — attacker could enumerate emails.
    }
  } else {
    // Dev/no-SMTP mode: log the link so you can click it manually.
    logger.info(`auth: magic link (no SMTP): ${magicLink}`);
  }

  sendSuccess(res, { success: true });
});

// ─── GET /api/auth/verify?token= ────────────────────────────────────────────
router.get("/verify", (req, res) => {
  const parsed = authVerifyQuerySchema.safeParse(req.query || {});
  if (!parsed.success) {
    return sendValidationError(res, req, parsed.error);
  }
  const { token } = parsed.data;

  const authRow = consumeAuthToken(token);
  if (!authRow) {
    return res.status(400).send(`
      <!doctype html><meta charset="utf-8">
      <title>Link expired — Scoop</title>
      <body style="font-family:system-ui,sans-serif;max-width:420px;margin:80px auto;padding:24px;text-align:center">
        <h2>This link has expired</h2>
        <p>Magic links are valid for 30 minutes and can only be used once.</p>
        <p><a href="${SITE_URL}">Return to Scoop</a> and request a new link.</p>
      </body>
    `);
  }

  const userId = uuidv4();
  const user = upsertUser({ id: userId, email: authRow.email });
  const sessionId = randomHex(32);
  createUserSession(sessionId, user.id, Date.now() + SESSION_TTL);
  setSessionCookie(res, sessionId);

  logger.info(`auth: login ok for ${authRow.email}`);
  res.redirect(302, `${SITE_URL}/?auth=verified`);
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
router.get("/me", (req, res) => {
  const sid = getSessionFromRequest(req);
  if (!sid) return res.json({ success: true, user: null });
  const user = getUserBySession(sid);
  if (!user) return res.json({ success: true, user: null });

  let topics = [];
  try { topics = JSON.parse(user.preferred_topics || "[]"); } catch {}

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      language: user.language,
      preferredTopics: topics,
      preferredCountry: user.preferred_country,
      tier: user.tier || "free",
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
    },
  });
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────
router.post("/logout", (req, res) => {
  const sid = getSessionFromRequest(req);
  if (sid) deleteUserSession(sid);
  clearSessionCookie(res);
  res.json({ success: true });
});

// ─── PUT /api/auth/prefs ─────────────────────────────────────────────────────
router.put("/prefs", requireAuth, (req, res) => {
  const parsed = authPrefsSchema.safeParse(req.body || {});
  if (!parsed.success) return sendValidationError(res, req, parsed.error);
  const { preferredTopics, language, preferredCountry } = parsed.data;
  updateUserPrefs(req.user.id, { preferredTopics, language, preferredCountry });
  sendSuccess(res, { success: true });
});

// ─── Saved articles (cross-device sync) ─────────────────────────────────────
// GET  /api/auth/saves          → list user's saved articles (full article objects)
// POST /api/auth/saves/:id      → save an article
// DELETE /api/auth/saves/:id    → unsave an article
router.get("/saves", requireAuth, (req, res) => {
  const articles = getSavedArticlesForUser(req.user.id);
  res.json({ success: true, articles });
});

router.post("/saves/:id", requireAuth, (req, res) => {
  saveArticleForUser(req.user.id, req.params.id);
  res.json({ success: true });
});

router.delete("/saves/:id", requireAuth, (req, res) => {
  unsaveArticleForUser(req.user.id, req.params.id);
  res.json({ success: true });
});

export default router;
