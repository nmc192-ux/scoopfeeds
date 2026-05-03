// Web push subscription endpoints. Public ones (key, subscribe, unsubscribe)
// are unauthenticated — the subscription's own endpoint URL is the secret.
// The admin send endpoints sit behind ADMIN_KEY since they fan out to every
// subscriber.

import { Router } from "express";
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

const router = Router();
const ADMIN_KEY = process.env.ADMIN_KEY || "";

// Initialize on module load so VAPID keys are generated/loaded eagerly. If
// this throws we fail loudly at boot rather than on first request.
try { ensurePushReady(); } catch (e) { logger.error(`pushService init failed: ${e.message}`); }

router.get("/public-key", (_req, res) => {
  const key = getPublicKey();
  if (!key) return res.status(503).json({ ok: false, error: "vapid not configured" });
  res.json({ ok: true, publicKey: key });
});

router.post("/subscribe", (req, res) => {
  const { endpoint, keys, topics, language } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ ok: false, error: "invalid subscription payload" });
  }
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
    res.json({ ok: true, linked: !!userId });
  } catch (err) {
    logger.error(`push subscribe failed: ${err.message}`);
    res.status(500).json({ ok: false, error: "subscribe failed" });
  }
});

router.post("/unsubscribe", (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ ok: false, error: "endpoint required" });
  const removed = deletePushSubscription(endpoint);
  res.json({ ok: true, removed });
});

// ── Admin send (gated by ADMIN_KEY in production) ─────────────────────────

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return next(); // dev mode: open
  if (req.query.key === ADMIN_KEY || req.body?.key === ADMIN_KEY) return next();
  return res.status(404).json({ ok: false, error: "not found" });
}

router.get("/stats", requireAdmin, (_req, res) => {
  res.json({ ok: true, stats: pushSubscriptionStats() });
});

router.post("/broadcast", requireAdmin, async (req, res) => {
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
router.post("/breaking", requireAdmin, async (req, res) => {
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

router.post("/test", requireAdmin, async (req, res) => {
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
