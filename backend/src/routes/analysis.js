/**
 * /api/analysis — news analysis endpoints.
 *
 * All read endpoints serve pre-computed data from SQLite (fast, sync).
 * The scheduler populates the tables every 2h via analysisService.refreshAnalysis().
 * The article deep-dive endpoint is the only async one (on-demand Gemini call,
 * cached 6h per article).
 *
 * Routes:
 *   GET  /api/analysis/stories                → top story clusters
 *   GET  /api/analysis/stories/:id            → single cluster with full brief
 *   GET  /api/analysis/trends                 → topic coverage counts (72h)
 *   GET  /api/analysis/article/:articleId     → on-demand article deep dive
 *   GET  /api/analysis/explained              → list of explained pieces
 *   GET  /api/analysis/explained/:slug        → single explained piece (full HTML)
 *   POST /api/analysis/explained/refresh      → admin: trigger full refresh
 */

import express from "express";
import { adminAuth, adminAuditLogger } from "../middleware/adminAuth.js";
import {
  listStoryClusters,
  getStoryCluster,
  listExplainedPieces,
  getExplainedBySlug,
} from "../models/database.js";
import {
  getOrCreateDeepDive,
  getTopicTrends,
  refreshAnalysis,
} from "../services/analysisService.js";
import { logger } from "../services/logger.js";
import { getUserFromRequest } from "./auth.js";

const router   = express.Router();

// GET /api/analysis/stories
router.get("/stories", (req, res) => {
  try {
    const clusters = listStoryClusters({ limit: 8 });
    res.json({ success: true, data: clusters });
  } catch (err) {
    logger.error("Error listing story clusters", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to load story clusters" });
  }
});

// GET /api/analysis/stories/:id
router.get("/stories/:id", (req, res) => {
  try {
    const cluster = getStoryCluster(req.params.id);
    if (!cluster) return res.status(404).json({ success: false, error: "Cluster not found" });
    res.json({ success: true, data: cluster });
  } catch (err) {
    logger.error("Error fetching story cluster", { id: req.params.id, error: err.message });
    res.status(500).json({ success: false, error: "Failed" });
  }
});

// GET /api/analysis/trends?windowHours=72
router.get("/trends", (req, res) => {
  try {
    const windowHours = Math.min(parseInt(req.query.windowHours || "72", 10), 72);
    const trends = getTopicTrends({ windowHours });
    res.json({ success: true, data: trends });
  } catch (err) {
    logger.error("Error computing topic trends", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to compute trends" });
  }
});

// GET /api/analysis/article/:articleId  — async, cached 6h.
// Anonymous/bot requests are cache-only: a fresh Gemini call is only
// triggered for authenticated users (2026-07-15 cost incident, gate a).
router.get("/article/:articleId", async (req, res) => {
  try {
    const result = await getOrCreateDeepDive(req.params.articleId, { allowGenerate: Boolean(getUserFromRequest(req)) });
    if (!result) return res.status(404).json({ success: false, error: "Article not found" });
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error("Error in article deep dive", { articleId: req.params.articleId, error: err.message });
    res.status(500).json({ success: false, error: "Analysis failed" });
  }
});

// GET /api/analysis/explained
router.get("/explained", (req, res) => {
  try {
    const pieces = listExplainedPieces({ limit: 10 });
    res.json({ success: true, data: pieces });
  } catch (err) {
    logger.error("Error listing explained pieces", { error: err.message });
    res.status(500).json({ success: false, error: "Failed" });
  }
});

// GET /api/analysis/explained/:slug
router.get("/explained/:slug", (req, res) => {
  try {
    const piece = getExplainedBySlug(req.params.slug);
    if (!piece) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: piece });
  } catch (err) {
    logger.error("Error fetching explained piece", { slug: req.params.slug, error: err.message });
    res.status(500).json({ success: false, error: "Failed" });
  }
});

// POST /api/analysis/explained/refresh  — admin-only, fire-and-forget
router.post("/explained/refresh", adminAuth, adminAuditLogger, (req, res) => {
  refreshAnalysis().catch(err =>
    logger.error("Manual analysis refresh failed", { error: err.message })
  );
  res.json({ success: true, message: "Analysis refresh triggered" });
});

export default router;
