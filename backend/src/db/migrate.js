import "../config/env.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../services/logger.js";
import { timedQuery } from "./queryTiming.js";
import * as migration001 from "./migrations/001_operational_tables.js";
import * as migration002 from "./migrations/002_sources_table.js";
import * as migration003 from "./migrations/003_drop_raw_signals.js";
import * as migration004 from "./migrations/004_x_post_queue.js";
import * as migration005 from "./migrations/005_tracker_instances.js";
import * as migration006 from "./migrations/006_scoring_audit_log.js";
import * as migration007 from "./migrations/007_scoring_evidence_cache.js";
import * as migration008 from "./migrations/008_article_entities.js";
import * as migration009 from "./migrations/009_entity_idf.js";
import * as migration010 from "./migrations/010_entity_idf_catspan.js";
import * as migration011 from "./migrations/011_prune_orphan_event_articles.js";
import * as migration012 from "./migrations/012_release_merged_cluster_ids.js";
import * as migration013 from "./migrations/013_event_article_archive.js";
import * as migration014 from "./migrations/014_event_entity_signature.js";
import * as migration015 from "./migrations/015_storylines.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009, migration010, migration011, migration012, migration013, migration014, migration015];

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
