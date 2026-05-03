import { getDb } from "../models/database.js";
import { logger } from "../services/logger.js";
import { timedQuery } from "./queryTiming.js";

function shouldVacuumNow(now = new Date()) {
  return now.getUTCDay() === 0 && now.getUTCHours() === 4;
}

export function runDatabaseMaintenance({ allowVacuum = false } = {}) {
  const db = getDb();
  const startedAt = Date.now();

  timedQuery("db:pragma_optimize", () => db.pragma("optimize"));
  timedQuery("db:analyze", () => db.exec("ANALYZE"));

  let vacuumed = false;
  const vacuumEnabled = allowVacuum || String(process.env.ENABLE_SQLITE_VACUUM || "").toLowerCase() === "true";
  if (vacuumEnabled && shouldVacuumNow()) {
    timedQuery("db:vacuum", () => db.exec("VACUUM"), { warnMs: 100 });
    vacuumed = true;
  }

  const result = {
    ok: true,
    vacuumed,
    duration_ms: Date.now() - startedAt,
  };

  logger.info("SQLite maintenance completed", result);
  return result;
}
