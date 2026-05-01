/**
 * /api/meter — metered article paywall.
 *
 * POST /api/meter/open  { articleId }
 *   → Check whether this device/user may open the article (and record the open).
 *   → Returns { allowed, count, limit, isPremium }
 *
 * GET  /api/meter/status
 *   → Returns current open count + limit for this device (no side effects).
 *
 * The device key is SHA-256(IP + UA + salt). Anonymous visitors are capped at
 * METER_FREE_LIMIT distinct articles per 30-day window. **Any signed-in user
 * gets unlimited reading** (the sign-in CTA on the soft wall promises this).
 * Premium users (tier='premium') additionally have ads hidden via isPremium.
 *
 * Meter is disabled entirely when METER_ENABLED env var is "false".
 */

import { Router } from "express";
import crypto from "crypto";
import { checkMeter, getMeterCount, getUserBySession } from "../models/database.js";
import { logger } from "../services/logger.js";

const router = Router();

const METER_ENABLED = String(process.env.METER_ENABLED ?? "true").toLowerCase() !== "false";
const SALT          = process.env.METER_SALT || "scoop_meter_salt_2026";

function deviceKey(req) {
  const ip  = req.ip || "";
  const ua  = req.get("user-agent") || "";
  return crypto.createHash("sha256").update(ip + ua + SALT).digest("hex").slice(0, 32);
}

function getUserFromSession(req) {
  try {
    const raw   = req.headers.cookie || "";
    const match = raw.match(/(?:^|;\s*)scoop_session=([^;]+)/);
    const token = match ? match[1] : null;
    return token ? getUserBySession(token) : null;
  } catch { return null; }
}

// POST /api/meter/open — record the open + return gate decision
router.post("/open", (req, res) => {
  if (!METER_ENABLED) {
    return res.json({ allowed: true, count: 0, limit: 10, isPremium: false, disabled: true });
  }

  const articleId = String(req.body?.articleId || "").slice(0, 64).trim();
  if (!articleId) return res.status(400).json({ error: "articleId required" });

  try {
    const user   = getUserFromSession(req);
    const key    = user ? user.id : deviceKey(req);
    const result = checkMeter(key, articleId, { record: true, userId: user?.id || null });
    res.json(result);
  } catch (err) {
    logger.warn(`meter/open: ${err.message}`);
    // On any error, allow the read — never block a user due to a meter bug.
    res.json({ allowed: true, count: 0, limit: 10, isPremium: false, error: "meter_unavailable" });
  }
});

// GET /api/meter/status — read current state without recording
router.get("/status", (req, res) => {
  if (!METER_ENABLED) {
    return res.json({ count: 0, limit: 10, isPremium: false, disabled: true });
  }

  try {
    const user   = getUserFromSession(req);
    const key    = user ? user.id : deviceKey(req);
    const limit  = parseInt(process.env.METER_FREE_LIMIT || "10", 10);
    const count  = getMeterCount(key);
    const isPremium = user?.tier === "premium";
    res.json({ count, limit, isPremium, remaining: Math.max(0, limit - count) });
  } catch (err) {
    logger.warn(`meter/status: ${err.message}`);
    res.json({ count: 0, limit: 10, isPremium: false, error: "meter_unavailable" });
  }
});

export default router;
