// Web push subscription endpoints. Public ones (key, subscribe, unsubscribe)
// are unauthenticated — the subscription's own endpoint URL is the secret.
// The admin send endpoints are protected by shared bearer-token auth because
// they fan out to every subscriber.

import { Router } from "express";
import { z } from "zod";
import { adminAuth, adminAuditLogger } from "../middleware/adminAuth.js";
import {
  upsertPushSubscription,
  deletePushSubscription,
  pushSubscriptionStats,
  getUserBySession,
} from "../models/database.js";
import {
  getPublicKey,
  broadcastPush,
  sendTestPush,
  ensurePushReady,
} from "../services/pushService.js";
import { runBreakingNewsPush } from "../services/breakingNewsPusher.js";
import { detectCountry } from "../services/geolocation.js";
import { logger } from "../services/logger.js";
import { validate } from "../middleware/validate.js";
import { sendError, sendInternalError, sendSuccess } from "../utils/apiResponse.js";

const router = Router();
const pushSubscribeSchema = z.object({
  endpoint: z.string().trim().url(),
  keys: z.object({
    p256dh: z.string().trim().min(1),
    auth: z.string().trim().min(1),
  }),
  topics: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
  language: z.string().trim().min(2).max(16).optional(),
});

// Initialize on module load so VAPID keys are generated/loaded eagerly. If
// this throws we fail loudly at boot rather than on first request.
try { ensurePushReady(); } catch (e) { logger.error(`pushService init failed: ${e.message}`); }

router.get("/public-key", (_req, res) => {
  const key = getPublicKey();
  if (!key) return sendError(res, _req, { status: 503, error: "vapid not configured", code: "vapid_unavailable" });
  sendSuccess(res, { ok: true, publicKey: key });
});

router.post("/subscribe", validate(pushSubscribeSchema), (req, res) => {
  const { endpoint, keys, topics, language } = req.validated.body;
  // Phase 4c: when the caller has an authed session, link the subscription
  // to the user so the watchlist dispatcher can fan out anomalies to them.
  // Anonymous subscribers continue to receive the global broadcast feed only.
  let userId = null;
  try {
    const cookieHeader = req.headers.cookie || "";
    const m = cookieHeader.match(/(?:^|;\s*)scoop_session=([^;]+)/);
    if (m) {
      const u = getUserBySession(m[1]);
      if (u?.id) userId = u.id;
    }
  } catch { /* anonymous fallthrough */ }

  try {
    upsertPushSubscription({
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      topics: Array.isArray(topics) ? topics : [],
      country: detectCountry(req),
      language: language || "en",
      userAgent: req.get("user-agent") || "",
      userId,
    });
    sendSuccess(res, { ok: true, linked: !!userId });
  } catch (err) {
    logger.error(`push subscribe failed: ${err.message}`);
    sendInternalError(res, req, "subscribe failed", err);
  }
});

router.post("/unsubscribe", (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ ok: false, error: "endpoint required" });
  const removed = deletePushSubscription(endpoint);
  res.json({ ok: true, removed });
});

router.use(["/stats", "/broadcast", "/breaking", "/test"], adminAuth, adminAuditLogger);

router.get("/stats", (_req, res) => {
  res.json({ ok: true, stats: pushSubscriptionStats() });
});

router.post("/broadcast", async (req, res) => {
  const { title, body, url, topic, icon } = req.body || {};
  if (!title || !body) return res.status(400).json({ ok: false, error: "title + body required" });
  const payload = {
    title: String(title).slice(0, 120),
    body: String(body).slice(0, 240),
    url: url || "/",
    icon: icon || "/news-icon.svg",
    badge: "/news-icon.svg",
    timestamp: Date.now(),
  };
  try {
    const result = await broadcastPush(payload, { topic });
    res.json({ ok: true, payload, result });
  } catch (err) {
    logger.error(`push broadcast failed: ${err.message}`);
    res.status(500).json({ ok: false, error: "broadcast failed" });
  }
});

// Trigger the breaking-news worker on demand. Pass ?dry=1 to preview the
// candidate without actually broadcasting — useful when verifying that the
// dedupe + safety filters are picking the right story.
router.post("/breaking", async (req, res) => {
  const dryRun = req.query.dry === "1" || req.body?.dry === true;
  const opts = {
    dryRun,
    minCredibility: req.body?.minCredibility,
    withinMs: req.body?.withinMs,
  };
  try {
    const out = await runBreakingNewsPush(opts);
    res.json({ ok: true, dryRun, ...out });
  } catch (err) {
    logger.error(`breaking-news trigger failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/test", async (req, res) => {
  const { endpoint, title, body, url } = req.body || {};
  if (!endpoint) return res.status(400).json({ ok: false, error: "endpoint required" });
  const payload = {
    title: title || "Scoop test",
    body: body || "If you see this, push is wired up.",
    url: url || "/",
    icon: "/news-icon.svg",
    badge: "/news-icon.svg",
    timestamp: Date.now(),
  };
  const result = await sendTestPush(endpoint, payload);
  res.json({ ok: result.ok, ...result });
});

export default router;
