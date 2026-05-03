import "../src/config/env.js";
import fs from "fs";
import path from "path";
import { getDb, getDbPath } from "../src/models/database.js";
import { logger } from "../src/services/logger.js";

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

const db = getDb();
const sourcePath = getDbPath();
const backupDir = path.join(path.dirname(sourcePath), "backups");
fs.mkdirSync(backupDir, { recursive: true });

const destinationPath = path.join(backupDir, `news-${timestampForFilename()}.db`);

try {
  db.pragma("wal_checkpoint(PASSIVE)");
  await db.backup(destinationPath);
  logger.info("Database backup created", {
    source: sourcePath,
    destination: destinationPath,
  });
} catch (error) {
  logger.error("Database backup failed", { error: error.message });
  process.exit(1);
}
