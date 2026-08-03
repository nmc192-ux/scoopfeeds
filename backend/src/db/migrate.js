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
import * as migration016 from "./migrations/016_llm_cost_rails.js";
import * as migration017 from "./migrations/017_timeline_unique.js";
import * as migration018 from "./migrations/018_event_facets.js";
import * as migration019 from "./migrations/019_facet_dual_source.js";
import * as migration020 from "./migrations/020_event_carousel.js";
import * as migration021 from "./migrations/021_event_post_retries.js";
import * as migration022 from "./migrations/022_video_posts.js";
import * as migration023 from "./migrations/023_video_posts_facebook.js";
import * as migration024 from "./migrations/024_event_carousel_seo_line.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009, migration010, migration011, migration012, migration013, migration014, migration015, migration016, migration017, migration018, migration019, migration020, migration021, migration022, migration023, migration024];

// MIGRATIONS is a hand-maintained array, which makes it the one place two
// people — or two agents — can collide without anything failing. This is not
// hypothetical: 023_video_posts_facebook and 024_event_carousel_seo_line were
// appended minutes apart by two sessions sharing one working directory, and
// only luck put them in different slots.
//
// A DUPLICATE id is the dangerous case, and it is SILENT. runMigrations skips
// any id already in schema_migrations, so the second migration with the same
// id never runs, never errors, and never appears missing — the table simply
// lacks its columns, and the divergence surfaces later as an inexplicable
// "no such column" from application code. A gap or an out-of-order entry is
// milder but still means the file numbering has stopped describing the apply
// order, which is the only thing the number is for.
//
// Asserted at MODULE LOAD so it is a startup crash on every entry point that
// touches the database — getDb(), the db:migrate CLI, makeTestDb() — rather
// than a check some code paths skip. A malformed array should stop the process,
// not run half of itself.
export function assertMigrationOrder(migrations = MIGRATIONS) {
  const seen = new Map();
  let prev = -Infinity;

  migrations.forEach((migration, index) => {
    const id = migration?.id;
    if (typeof id !== "string" || !id.trim()) {
      throw new Error(`migrate: MIGRATIONS[${index}] has no string \`id\` — every migration module must export one.`);
    }
    if (seen.has(id)) {
      throw new Error(
        `migrate: duplicate migration id "${id}" at positions ${seen.get(id)} and ${index}. ` +
        `The second one would be SILENTLY SKIPPED — schema_migrations is keyed on id, so its ` +
        `statements never run and the schema diverges with no error. Renumber it.`
      );
    }
    seen.set(id, index);

    const n = Number.parseInt(id.slice(0, 3), 10);
    if (!Number.isInteger(n)) {
      throw new Error(`migrate: migration id "${id}" does not start with a 3-digit number.`);
    }
    if (n <= prev) {
      throw new Error(
        `migrate: migration ids are not strictly ascending — "${id}" (${n}) follows ${prev} at position ${index}. ` +
        `The file number must describe the apply order; reorder the MIGRATIONS array or renumber the file.`
      );
    }
    prev = n;
  });

  return { count: migrations.length, highest: prev };
}

assertMigrationOrder();

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

// Tables the migrations operate on but never create. `articles`, `social_posts`
// come from initializeSchema(); `events`, `event_articles`, `event_timeline` come
// from initRealityIndex(). Migrations 011/012/017/020 assume all of them exist.
const REQUIRED_BASE_TABLES = [
  "articles",
  "social_posts",
  "events",
  "event_articles",
  "event_timeline",
];

// Turn the opaque failure into a named one. Without this, running migrations on
// an unseeded database dies at 011 with a bare `SQLITE_ERROR: no such table:
// event_articles` — which reads as a broken migration rather than what it is: a
// missing precondition. One sqlite_master scan per boot.
function assertBaseSchema(db) {
  const present = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  );
  const missing = REQUIRED_BASE_TABLES.filter((table) => !present.has(table));
  if (missing.length === 0) return;

  throw new Error(
    `runMigrations: base schema missing (${missing.join(", ")}). ` +
    `Migrations layer on top of initializeSchema() + initRealityIndex(); they do not create these tables. ` +
    `Call bootstrapSchema(db) from src/models/database.js instead of runMigrations(db) directly.`
  );
}

export function runMigrations(db) {
  assertBaseSchema(db);
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
  // Deliberately an async IIFE rather than top-level await.
  //
  // models/database.js STATICALLY imports runMigrations from this module. Awaiting
  // that import at this module's top level is a cycle the ESM loader cannot settle:
  // database.js waits for migrate.js to finish evaluating, migrate.js waits for
  // database.js, and node exits with "Detected unsettled top-level await".
  // Inside an IIFE, this module finishes evaluating first, so by the time the
  // dynamic import runs there is nothing left to wait for.
  void (async () => {
    const Database = (await import("better-sqlite3")).default;
    const { bootstrapSchema } = await import("../models/database.js");
    const dbPath = resolveDirectDbPath();
    const db = new Database(dbPath);

    try {
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 5000");
      // bootstrapSchema, not runMigrations: this CLI opens its own raw connection and
      // never goes through getDb(), so against a fresh data directory it used to die
      // at migration 011 on a table no migration creates.
      const result = bootstrapSchema(db);
      logger.info("Database migrations finished", {
        path: dbPath,
        ...result,
      });
    } finally {
      db.close();
    }
  })();
}
