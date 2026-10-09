/**
 * /api/live-events — powers the "Live" tab.
 *
 * GET /              → list of active event cards (for the tab's index view)
 * GET /:id           → full dossier (timestamped brief + live metrics)
 * POST /:id/refresh  → force a re-synthesis of one event (admin-ish, no auth
 *                      yet; rate-limited by the global limiter)
 *
 * We deliberately keep the path separate from the SSE `/api/events` endpoint
 * in server.js, which is unrelated (heartbeat stream).
 */

import express from "express";
import { listLiveEvents, getLiveEvent } from "../models/database.js";
import { LIVE_EVENTS, getEventConfig } from "../config/liveEvents.js";
import { refreshEvent } from "../services/liveEvents.js";
import { discoverCandidates } from "../services/eventDiscovery.js";
import { isRsshubEnabled } from "../services/socialSignals.js";
import { logger } from "../services/logger.js";
import { isLlmAvailable } from "../realityIndex/llmQueue.js";

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const cached = listLiveEvents();
    // Until the first scheduler pass runs we still want the tab to show
    // something useful, so fall back to config stubs.
    const byId = new Map(cached.map((e) => [e.id, e]));
    const merged = LIVE_EVENTS.map((cfg) => {
      const live = byId.get(cfg.id);
      if (live) return live;
      return {
        id: cfg.id,
        title: cfg.title,
        subtitle: cfg.subtitle,
        emoji: cfg.emoji,
        status: cfg.status,
        region: cfg.region,
        summary: "Synthesizing first brief — check back shortly",
        updated_at: null,
        ceasefire_at: cfg.ceasefire ? new Date(cfg.ceasefire).getTime() : null,
      };
    });
    res.json({ success: true, data: merged });
  } catch (err) {
    logger.error("Error listing live events", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to list live events" });
  }
});

router.get("/:id", (req, res) => {
  try {
    const live = getLiveEvent(req.params.id);
    const cfg = getEventConfig(req.params.id);
    if (!cfg) {
      return res.status(404).json({ success: false, error: "Event not found" });
    }
    if (!live) {
      // No synthesized record yet — return a skeleton so the UI can render.
      return res.json({
        success: true,
        data: {
          id: cfg.id,
          title: cfg.title,
          subtitle: cfg.subtitle,
          emoji: cfg.emoji,
          status: cfg.status,
          region: cfg.region,
          brief: [],
          metrics: cfg.baseline || {},
          summary: "Synthesizing first brief — check back shortly",
          updated_at: null,
          ceasefire_at: cfg.ceasefire ? new Date(cfg.ceasefire).getTime() : null,
        },
      });
    }
    res.json({ success: true, data: live });
  } catch (err) {
    logger.error("Error fetching live event", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to fetch live event" });
  }
});

// GET /api/live-events/_/candidates
// Returns entities in the article stream that are spiking but aren't yet
// tracked as seed events. Phase D will promote these automatically; for
// now it's a read-only signal for editors / the UI "emerging" strip.
router.get("/_/candidates", (req, res) => {
  try {
    const windowHours = Math.min(parseInt(req.query.windowHours || "24", 10), 72);
    const candidates = discoverCandidates({ windowHours, minArticles: 5, limit: 10 });
    res.json({
      success: true,
      data: candidates,
      meta: {
        windowHours,
        rsshubEnabled: isRsshubEnabled(),
        llmEnabled: isLlmAvailable(),
      },
    });
  } catch (err) {
    logger.error("Error computing event candidates", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to compute candidates" });
  }
});

router.post("/:id/refresh", async (req, res) => {
  try {
    const cfg = getEventConfig(req.params.id);
    if (!cfg) return res.status(404).json({ success: false, error: "Event not found" });
    // Don't await — fire & forget so the UI can poll.
    refreshEvent(cfg).catch((err) => logger.error("Manual event refresh failed", { error: err.message }));
    res.json({ success: true, message: "Refresh triggered" });
  } catch (err) {
    logger.error("Error triggering event refresh", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to trigger refresh" });
  }
});

export default router;
