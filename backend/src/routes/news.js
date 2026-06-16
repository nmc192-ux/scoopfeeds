import express from "express";
import crypto from "crypto";
import {
  getArticles,
  getFeaturedArticles,
  getArticleById,
  incrementViewCount,
  getTopicCounts,
  getArticleCount,
  getAnalyticsSummary,
  trackEvent,
  getUserBySession,
  getUserCategoryWeights,
} from "../models/database.js";
import { getSchedulerStatus, triggerManualRefresh } from "../services/scheduler.js";
import { TOPICS, TAB_CATEGORIES, COUNTRY_REGIONS } from "../config/sources.js";
import { logger } from "../services/logger.js";

const router = express.Router();

function hashIp(ip) {
  return crypto.createHash("sha256").update(ip + "salt_news_2024").digest("hex").slice(0, 16);
}

// GET /api/news - paginated news with optional filters
//
// Query model (new):
//   tab=<topId>          one of the 9 user-facing tab ids (see TOPICS).
//                        Resolves through TAB_CATEGORIES to a set of article
//                        categories. "local" resolves to `regions` using
//                        `country` + COUNTRY_REGIONS. "live" is handled by a
//                        separate /api/events route and returns an empty set
//                        here.
//   country=<ISO2>       caller's country code (e.g. "US", "PK"). Only used
//                        when tab === "local". Frontend reads this from
//                        /api/geo or the user's saved override.
//
// Back-compat:
//   category=<id>        old single-category filter still works; if supplied
//                        alongside `tab`, `tab` wins.
router.get("/", (req, res) => {
  try {
    const {
      tab = null,
      country = null,
      category = null,
      limit = 50,
      offset = 0,
      search = null,
      minCredibility = 0,
      source = null,
    } = req.query;

    // Resolve tab → categories / regions.
    let resolvedCategories = null;
    let resolvedRegions = null;

    if (tab) {
      // "live" tab has no underlying news articles — the Events dossiers are
      // served separately. Return an empty list rather than surprising users.
      if (tab === "live") {
        return res.json({
          success: true,
          data: [],
          meta: { count: 0, limit: parseInt(limit), offset: parseInt(offset), tab },
        });
      }

      if (tab === "local") {
        const cc = (country || "").toUpperCase();
        resolvedRegions = COUNTRY_REGIONS[cc] || [];
        // If we don't know this country yet, don't collapse to "all articles"
        // — the user explicitly asked for local, so empty is the honest answer.
        if (resolvedRegions.length === 0) {
          return res.json({
            success: true,
            data: [],
            meta: {
              count: 0, limit: parseInt(limit), offset: parseInt(offset),
              tab, country: cc || null,
              notice: cc
                ? `No local sources wired up for ${cc} yet`
                : "No country detected; enable location or pick one",
            },
          });
        }
      } else if (TAB_CATEGORIES[tab]) {
        const cats = TAB_CATEGORIES[tab];
        if (cats.length > 0) resolvedCategories = cats;
        // else: "top" → leave null → mixed editorial feed
      }
    }

    let articles = getArticles({
      category: !tab ? (category || null) : null, // legacy path only
      categories: resolvedCategories,
      regions: resolvedRegions,
      limit: Math.min(parseInt(limit), 100),
      offset: parseInt(offset),
      search: search || null,
      minCredibility: parseInt(minCredibility),
      source: source || null,
    });

    // ── Personalized re-ranking (authenticated users only) ────────────
    // When the user is signed in and has at least 3 articles of history,
    // we re-rank the tail of the list (skipping the top 4 "breaking" pins)
    // by applying a per-category boost derived from their reading signals.
    // The boost is bounded to [1.0, 1.6] so it nudges rather than swamps
    // the editorial recency ordering.
    try {
      const raw          = req.headers.cookie || "";
      const cookieMatch  = raw.match(/(?:^|;\s*)scoop_session=([^;]+)/);
      const sessionToken = cookieMatch ? cookieMatch[1] : null;
      if (sessionToken && articles.length > 4) {
        const user = getUserBySession(sessionToken);
        if (user) {
          const weights = getUserCategoryWeights(user.id);
          if (Object.keys(weights).length >= 1) {
            const maxW = Math.max(...Object.values(weights));
            if (maxW > 0) {
              const pinned = articles.slice(0, 4);
              const tail   = articles.slice(4).map(a => ({
                ...a,
                _boost: 1.0 + 0.6 * ((weights[a.category] || 0) / maxW),
              }));
              // Stable sort: preserve relative order within the same boost tier.
              tail.sort((a, b) => b._boost - a._boost);
              articles = [...pinned, ...tail.map(({ _boost, ...rest }) => rest)];
            }
          }
        }
      }
    } catch (_e) { /* personalization is best-effort; never block the response */ }

    // Track analytics (privacy-safe, no PII)
    trackEvent("page_view", {
      category: tab || category,
      ipHash: hashIp(req.ip),
      metadata: { limit, offset, tab, country },
    });

    res.json({
      success: true,
      data: articles,
      meta: {
        count: articles.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
        tab: tab || null,
        category: category || null,
      },
    });
  } catch (err) {
    logger.error("Error fetching articles", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to fetch articles" });
  }
});

// GET /api/news/featured - featured/hero articles
router.get("/featured", (req, res) => {
  try {
    const { limit = 7 } = req.query;
    const articles = getFeaturedArticles(Math.min(parseInt(limit), 20));
    res.json({ success: true, data: articles });
  } catch (err) {
    logger.error("Error fetching featured articles", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to fetch featured articles" });
  }
});

// GET /api/news/topics - topic list with counts.
// Counts are summed across the underlying categories that each tab aggregates
// (e.g. the "Tech & AI" tab reports tech + ai + agentic-ai + computer-science).
// Virtual tabs ("top", "live", "local") get a 0 count — "top" shows everything
// anyway, "live" has its own dossier count, and "local" depends on the user's
// country so we can't compute it without geo context here.
router.get("/topics", (req, res) => {
  try {
    const counts = getTopicCounts();
    const countMap = {};
    counts.forEach(({ category, count }) => { countMap[category] = count; });

    const topics = TOPICS.map(t => {
      const cats = TAB_CATEGORIES[t.id] || [];
      const count = cats.reduce((sum, c) => sum + (countMap[c] || 0), 0);
      return { ...t, count };
    });

    res.json({ success: true, data: topics });
  } catch (err) {
    logger.error("Error fetching topics", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to fetch topics" });
  }
});

// GET /api/news/stats - system stats
router.get("/stats", (req, res) => {
  try {
    const summary = getAnalyticsSummary();
    const scheduler = getSchedulerStatus();
    res.json({
      success: true,
      data: {
        ...summary,
        scheduler,
      },
    });
  } catch (err) {
    logger.error("Error fetching stats", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to fetch stats" });
  }
});

// GET /api/news/:id - single article
router.get("/:id", (req, res) => {
  try {
    const article = getArticleById(req.params.id);
    if (!article) {
      return res.status(404).json({ success: false, error: "Article not found" });
    }

    incrementViewCount(req.params.id);
    trackEvent("article_view", {
      articleId: req.params.id,
      category: article.category,
      ipHash: hashIp(req.ip),
    });

    res.json({ success: true, data: article });
  } catch (err) {
    logger.error("Error fetching article", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to fetch article" });
  }
});

// POST /api/news/refresh - manual refresh trigger
router.post("/refresh", async (req, res) => {
  try {
    const status = getSchedulerStatus();
    if (status.isRunning) {
      return res.json({ success: false, message: "Ingestion already in progress" });
    }

    // Don't await — let it run in background
    triggerManualRefresh().catch(err => logger.error("Manual refresh error", { error: err.message }));

    res.json({ success: true, message: "Refresh triggered in background" });
  } catch (err) {
    logger.error("Error triggering refresh", { error: err.message });
    res.status(500).json({ success: false, error: "Failed to trigger refresh" });
  }
});

export default router;
