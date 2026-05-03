import { logger } from "../services/logger.js";

const DEFAULT_WARN_MS = 50;

function getWarnThresholdMs() {
  const parsed = Number.parseInt(String(process.env.DB_SLOW_QUERY_THRESHOLD_MS || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WARN_MS;
}

export function timedQuery(label, fn, { warnMs = getWarnThresholdMs() } = {}) {
  const startedAt = process.hrtime.bigint();

  try {
    return fn();
  } finally {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    if (durationMs >= warnMs) {
      logger.warn("Slow database query", {
        label,
        duration_ms: Number(durationMs.toFixed(2)),
      });
    }
  }
}
