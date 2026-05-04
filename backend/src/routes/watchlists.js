/**
 * /api/watchlists — Reality Index Phase 4: per-user follow lists.
 *
 * Routes (all require auth via the existing `scoop_session` cookie):
 *   GET    /api/watchlists           list watched items, hydrated
 *   POST   /api/watchlists           add an item
 *   DELETE /api/watchlists/:type/:id remove an item
 *   GET    /api/watchlists/activity  recent anomalies for the user's watched events
 *
 * Anonymous users get 401. Sign-in is via the existing magic-link flow.
 */

import express from "express";
import { z } from "zod";
import { getUserBySession } from "../models/database.js";
import { logger } from "../services/logger.js";
import { validate } from "../middleware/validate.js";
import {
  addToWatchlist,
  removeFromWatchlist,
  isWatching,
  listForUser,
  activityForUser,
} from "../realityIndex/dal/watchlistsDao.js";
import { sendInternalError, sendUnauthorized, sendValidationError } from "../utils/apiResponse.js";

const router = express.Router();

const COOKIE_NAME = "scoop_session";
const ALLOWED_TYPES = new Set(["event", "market", "topic", "ticker"]);
const watchlistSchema = z.object({
  item_type: z.enum(["event", "market", "topic", "ticker"]),
  item_id: z.string().trim().min(1).max(128),
  alert_threshold: z.number().finite().min(0).max(1).nullable().optional(),
  alert_types: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  notify_push: z.boolean().optional(),
  notify_email: z.boolean().optional(),
});

function getSession(req) {
  const raw = req.headers.cookie || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return m ? m[1] : null;
}

function requireAuth(req, res, next) {
  const sid = getSession(req);
  if (!sid) return sendUnauthorized(res, req, "Not authenticated");
  const user = getUserBySession(sid);
  if (!user) return sendUnauthorized(res, req, "Session expired");
  req.user = user;
  next();
}

// ─── GET /api/watchlists ───────────────────────────────────────────────────
router.get("/", requireAuth, (req, res) => {
  try {
    res.json({ items: listForUser(req.user.id) });
  } catch (err) {
    logger.error(`GET /api/watchlists: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/watchlists ──────────────────────────────────────────────────
// Body: { item_type, item_id, alert_threshold?, alert_types?, notify_push?, notify_email? }
router.post("/", requireAuth, (req, res) => {
  try {
    const parsed = watchlistSchema.safeParse(req.body || {});
    if (!parsed.success) return sendValidationError(res, req, parsed.error);
    const { item_type, item_id, alert_threshold, alert_types, notify_push, notify_email } = parsed.data;

    addToWatchlist({
      user_id: req.user.id,
      item_type,
      item_id,
      alert_threshold: Number.isFinite(alert_threshold) ? alert_threshold : null,
      alert_types:     Array.isArray(alert_types) ? alert_types : [],
      notify_push:     notify_push  === undefined ? 1 : (notify_push  ? 1 : 0),
      notify_email:    notify_email ? 1 : 0,
    });

    res.json({ ok: true, watching: true });
  } catch (err) {
    logger.error(`POST /api/watchlists: ${err.message}`);
    sendInternalError(res, req, "Internal server error", err);
  }
});

// ─── DELETE /api/watchlists/:type/:id ─────────────────────────────────────
router.delete("/:type/:id", requireAuth, (req, res) => {
  try {
    const { type, id } = req.params;
    if (!ALLOWED_TYPES.has(type)) return res.status(400).json({ error: "Invalid item_type" });
    const r = removeFromWatchlist(req.user.id, type, id);
    res.json({ ok: true, watching: false, removed: r.changes });
  } catch (err) {
    logger.error(`DELETE /api/watchlists: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── HEAD /api/watchlists/:type/:id — quick "am I watching this?" check ───
router.get("/:type/:id/status", requireAuth, (req, res) => {
  const { type, id } = req.params;
  if (!ALLOWED_TYPES.has(type)) return res.status(400).json({ error: "Invalid item_type" });
  res.json({ watching: isWatching(req.user.id, type, id) });
});

// ─── GET /api/watchlists/activity ─────────────────────────────────────────
router.get("/activity", requireAuth, (req, res) => {
  try {
    const sinceMs = parseInt(req.query.sinceMs ?? String(Date.now() - 7 * 24 * 60 * 60 * 1000), 10);
    const limit   = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
    res.json(activityForUser(req.user.id, { sinceMs, limit }));
  } catch (err) {
    logger.error(`GET /api/watchlists/activity: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
