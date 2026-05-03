/**
 * /api/briefs — public read of analyst briefs (published only).
 * Drafts and rejected briefs live behind /scoop-ops/briefs.
 */

import { Router } from "express";
import { listBriefs, getBriefBySlug } from "../realityIndex/dal/briefsDao.js";
import { logger } from "../services/logger.js";

const router = Router();

function publicBrief(b) {
  if (!b) return null;
  let evidence = [];
  try { evidence = JSON.parse(b.evidence_json || "[]"); } catch {}
  return {
    id:             b.id,
    slug:           b.slug,
    event_id:       b.event_id,
    title:          b.title,
    thesis:         b.thesis,
    body_md:        b.body_md,
    body_html:      b.body_html,
    evidence,
    confidence:     b.confidence,
    published_at:   b.published_at,
    created_at:     b.created_at,
    provider:       b.provider,    // disclosed: which LLM drafted it
  };
}

router.get("/", (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? "20", 10), 50);
    const items = listBriefs({ status: "published", limit }).map(publicBrief);
    res.json({ items });
  } catch (err) {
    logger.error(`GET /api/briefs: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:slug", (req, res) => {
  try {
    const b = getBriefBySlug(req.params.slug);
    if (!b || b.status !== "published") return res.status(404).json({ error: "Brief not found" });
    res.json(publicBrief(b));
  } catch (err) {
    logger.error(`GET /api/briefs/:slug: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
