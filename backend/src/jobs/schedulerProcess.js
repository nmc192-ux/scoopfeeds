import "../config/env.js";
import { getDbStatus } from "../models/database.js";
import { startScheduler, getSchedulerStatus } from "../services/scheduler.js";
import { logger } from "../services/logger.js";
import { assertRedisStartup } from "./redis.js";

const PROCESS_ROLE = "scheduler";

function shutdown(signal) {
  logger.info(`[${PROCESS_ROLE}] received ${signal}, shutting down...`);
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
  logger.error(`[${PROCESS_ROLE}] failed to start`, { error: error.message });
  process.exit(1);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  logger.error(`[${PROCESS_ROLE}] uncaught exception`, { error: error.message });
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  logger.error(`[${PROCESS_ROLE}] unhandled rejection`, { error: error?.message || String(error) });
  process.exit(1);
});
