/**
 * /api/ri/gaps — Coverage Gaps (#262). Read-only. Measured by region, never by leaning.
 *
 *   GET /daily                    the last 24 h, computed on request and cached 15 min
 *   GET /weekly/:weekStart?       a stored weekly Gap Report (latest when omitted)
 *
 * Every response carries `measured_by: "region"` and `method`
 * ({ buckets, minPresent, minBase, unknownShare, … }).
 *
 * THE DAILY CACHE IS PER PROCESS. It lives in this module's memory, so each web
 * process (and a restart) computes its own copy; nothing is shared through Redis or
 * the DB. That is fine for a 15-minute read cache and is stated so nobody relies on
 * it being global.
 */
import { Router } from "express";
import { getDb } from "../models/database.js";
import { computeGaps, readWeeklyGapReport } from "../realityIndex/intelligence/coverageGaps.js";
import { logger } from "../services/logger.js";

const router = Router();
const DAILY_TTL_MS = 15 * 60 * 1000;
let dailyCache = null; // { at, body } — per process, see above

export function _resetGapsCache() { dailyCache = null; }

router.get("/daily", (_req, res) => {
  try {
    const now = Date.now();
    if (!dailyCache || now - dailyCache.at > DAILY_TTL_MS) {
      const r = computeGaps(getDb(), { now, windowH: 24 });
      dailyCache = { at: now, body: { measured_by: r.measured_by, generated_at: now, method: r.method, items: r.items } };
    }
    res.set("Cache-Control", "public, max-age=300");
    res.json(dailyCache.body);
  } catch (err) {
    logger.error(`GET /api/ri/gaps/daily: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/weekly/:weekStart?", (req, res) => {
  const ws = req.params.weekStart ?? null;
  if (ws !== null && !/^\d{4}-\d{2}-\d{2}$/.test(ws)) return res.status(400).json({ error: "weekStart must be YYYY-MM-DD" });
  try {
    const r = readWeeklyGapReport(getDb(), ws);
    if (!r) return res.status(404).json({ error: "no report" });
    res.set("Cache-Control", "public, max-age=600");
    res.json(r);
  } catch (err) {
    logger.error(`GET /api/ri/gaps/weekly: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
