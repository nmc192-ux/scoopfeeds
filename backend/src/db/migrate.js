import "../config/env.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../services/logger.js";
import { timedQuery } from "./queryTiming.js";
import * as migration001 from "./migrations/001_operational_tables.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = [migration001];

function ensureSchemaMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  INTEGER NOT NULL
    )
  `);
}

export function getRegisteredMigrations() {
  return MIGRATIONS.map((migration) => migration.id);
}

export function runMigrations(db) {
  ensureSchemaMigrationsTable(db);

  const appliedIds = new Set(
    db.prepare("SELECT id FROM schema_migrations ORDER BY applied_at ASC").all().map((row) => row.id)
  );

  let appliedCount = 0;
  const insertApplied = db.prepare(`
    INSERT INTO schema_migrations (id, applied_at)
    VALUES (?, ?)
  `);

  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) continue;

    timedQuery(`migration:${migration.id}`, () => {
      const apply = db.transaction(() => {
        migration.up(db);
        insertApplied.run(migration.id, Date.now());
      });
      apply();
    }, { warnMs: 10 });

    appliedCount += 1;
    logger.info("Applied database migration", { migration: migration.id });
  }

  return {
    appliedCount,
    registered: MIGRATIONS.length,
  };
}

function resolveDirectDbPath() {
  const dataDir = process.env.SCOOP_PERSISTENT_DATA_DIR
    ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
    : path.resolve(__dirname, "../../data");

  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "news.db");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const Database = (await import("better-sqlite3")).default;
  const dbPath = resolveDirectDbPath();
  const db = new Database(dbPath);

  try {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    const result = runMigrations(db);
    logger.info("Database migrations finished", {
      path: dbPath,
      ...result,
    });
  } finally {
    db.close();
  }
}
