import { Router } from "express";
import { getQueueDiagnostics } from "../jobs/queues.js";
import { shouldUseBullMQ } from "../jobs/redis.js";

const router = Router();

router.get("/status", async (_req, res) => {
  try {
    const diagnostics = await getQueueDiagnostics();
    res.json({
      ok: true,
      bullmqEnabled: shouldUseBullMQ(),
      ...diagnostics,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      bullmqEnabled: shouldUseBullMQ(),
    });
  }
});

export default router;
