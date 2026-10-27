/**
 * /api/originals — public, read-only feed for the /originals page (#260).
 * Returns { analysis, explained, stories, quiz }; each list may be empty and the
 * page earn-renders (an empty shelf is not shown).
 */

import { Router } from "express";
import { listOriginals, latestWeeklyQuiz } from "../realityIndex/dal/originalsDao.js";
import { logger } from "../services/logger.js";

const router = Router();

router.get("/", (_req, res) => {
  try {
    res.set("Cache-Control", "public, max-age=120");
    res.json(listOriginals());
  } catch (err) {
    logger.error(`GET /api/originals: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// #271 — the latest published weekly quiz; 404 when there is none (refused rows are never served).
router.get("/quiz", (_req, res) => {
  try {
    const quiz = latestWeeklyQuiz();
    if (!quiz) return res.status(404).json({ error: "No quiz this week" });
    res.set("Cache-Control", "public, max-age=300");
    res.json(quiz);
  } catch (err) {
    logger.error(`GET /api/originals/quiz: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
