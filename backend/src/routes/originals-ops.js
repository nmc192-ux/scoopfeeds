/**
 * /scoop-ops/originals — admin-only Originals tools (#272).
 *
 * GET /numbers/:day.png — the 1080×1350 "By the numbers" image for that day, for
 * DrJ to download and post by hand. No automatic posting anywhere.
 *
 * Mounted under the single /scoop-ops boundary in server.js, which applies
 * adminAuth + adminAuditLogger. This router has no auth code of its own, by rule.
 */
import { Router } from "express";
import { dailyNumberFor } from "../realityIndex/dal/originalsDao.js";
import { ensureNumberCard } from "../services/numberCard.js";
import { logger } from "../services/logger.js";

const router = Router();

router.get("/numbers/:day.png", async (req, res) => {
  const day = String(req.params.day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: "day must be YYYY-MM-DD" });
  try {
    const row = dailyNumberFor(day);
    if (!row) return res.status(404).json({ error: "No number for that day" });
    const file = await ensureNumberCard(row);
    if (!file) return res.status(503).json({ error: "Card fonts are not installed on this server" });
    res.type("png").sendFile(file);
  } catch (err) {
    logger.error(`GET /scoop-ops/originals/numbers/${day}.png: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
