import { Router } from "express";
import { getProcessMemoryUsage, getProcessRole } from "../config/observability.js";
import { getQueueDiagnostics } from "../jobs/queues.js";
import { getRedisStatus } from "../jobs/redis.js";
import { getDbStatus } from "../models/database.js";
import { JobRunRepository } from "../repositories/JobRunRepository.js";

const router = Router();
const jobRunRepository = new JobRunRepository();

router.get("/", async (_req, res) => {
  try {
    const [redis, queues] = await Promise.all([
      getRedisStatus({ connectionName: "diagnostics" }),
      getQueueDiagnostics(),
    ]);

    const failedJobs = jobRunRepository.listRecentFailed(10).map((job) => ({
      queue: job.queue,
      job_name: job.job_name,
      job_id: job.job_id,
      status: job.status,
      attempts: job.attempts,
      started_at: job.started_at,
      finished_at: job.finished_at,
      duration_ms: job.duration_ms,
      error_message: job.error_message,
      created_at: job.created_at,
    }));

    res.json({
      ok: true,
      processRole: getProcessRole(),
      uptime: Math.floor(process.uptime()),
      db: {
        ok: getDbStatus().ok,
        type: "sqlite",
      },
      redis,
      queues,
      recentFailedJobs: failedJobs,
      memory: getProcessMemoryUsage(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      processRole: getProcessRole(),
      error: error.message,
    });
  }
});

export default router;
