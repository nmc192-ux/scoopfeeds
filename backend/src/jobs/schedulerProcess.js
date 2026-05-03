import "../config/env.js";
import { captureException, flushObservability, initObservability } from "../config/observability.js";
import { getDbStatus } from "../models/database.js";
import { startScheduler, getSchedulerStatus } from "../services/scheduler.js";
import { logger } from "../services/logger.js";
import { assertRedisStartup } from "./redis.js";

const PROCESS_ROLE = "scheduler";
initObservability({ role: PROCESS_ROLE });

async function shutdown(signal) {
  logger.info(`[${PROCESS_ROLE}] received ${signal}, shutting down...`);
  await flushObservability();
  process.exit(0);
}

try {
  assertRedisStartup({ role: PROCESS_ROLE });
  const db = getDbStatus();
  logger.info(`[${PROCESS_ROLE}] boot`, { pid: process.pid, db });
  const started = startScheduler();
  logger.info(`[${PROCESS_ROLE}] ${started ? "started" : "already running"}`, {
    scheduler: getSchedulerStatus(),
  });
} catch (error) {
  captureException(error, {
    role: PROCESS_ROLE,
    message: `[${PROCESS_ROLE}] failed to start`,
  });
  process.exit(1);
}

process.on("SIGTERM", () => { shutdown("SIGTERM"); });
process.on("SIGINT", () => { shutdown("SIGINT"); });
process.on("uncaughtException", async (error) => {
  captureException(error, {
    role: PROCESS_ROLE,
    message: `[${PROCESS_ROLE}] uncaught exception`,
  });
  await flushObservability();
  process.exit(1);
});
process.on("unhandledRejection", async (error) => {
  const rejectionError = error instanceof Error ? error : new Error(String(error));
  captureException(rejectionError, {
    role: PROCESS_ROLE,
    message: `[${PROCESS_ROLE}] unhandled rejection`,
  });
  await flushObservability();
  process.exit(1);
});
