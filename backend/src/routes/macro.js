/**
 * /api/macro — read endpoints for the macro-indicator layer (Phase 5).
 * Currently FRED-only; World Bank / IMF will join the same table later.
 */
import { Router } from "express";
import { getDb } from "../models/database.js";
import { logger } from "../services/logger.js";

const router = Router();

router.get("/indicators", (req, res) => {
  try {
    const provider = req.query.provider ?? null;
    let sql = "SELECT * FROM macro_indicators";
    const params = [];
    if (provider) { sql += " WHERE provider = ?"; params.push(provider); }
    sql += " ORDER BY label ASC";
    const rows = getDb().prepare(sql).all(...params);
    res.json({
      indicators: rows,
      count: rows.length,
      disclaimer: "Macro data sourced from public APIs (FRED). Not investment advice.",
    });
  } catch (err) {
    logger.error(`GET /api/macro/indicators: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
