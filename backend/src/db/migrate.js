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
import * as migration024 from "./migrations/024_video_posts_social_channels.js";
import * as migration025 from "./migrations/025_prune_stale_source_health.js";
import * as migration026 from "./migrations/026_video_posts_bluesky.js";
import * as migration027 from "./migrations/027_drop_redundant_snapshot_indexes.js";
import * as migration028 from "./migrations/028_video_posts_tiktok.js";
import * as migration029 from "./migrations/029_video_posts_x.js";
import * as migration030 from "./migrations/030_longform_posts.js";
import * as migration031 from "./migrations/031_stock_asset_usage.js";
import * as migration032 from "./migrations/032_media_candidates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

const MIGRATIONS = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009, migration010, migration011, migration012, migration013, migration014, migration015, migration016, migration017, migration018, migration019, migration020, migration021, migration022, migration023, migration024, migration025, migration026, migration027, migration028, migration029, migration030, migration031, migration032];

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

/**
 * THE REGISTRY IS HAND-MAINTAINED, SO CHECK IT AT BOOT.
 *
 * MIGRATIONS is an array someone has to remember to append to. On 2026-08-13
 * migration 024 shipped, was merged, deployed — and never ran, because the edit
 * that was supposed to add it to that array silently did not apply. Nothing
 * failed: schema_migrations simply had 23 rows instead of 24, the columns did
 * not exist, and the first thing to notice was a query erroring in production.
 *
 * Three ways the registry can be wrong, all of them silent without this:
 *
 *   MISSING FILE   — a migration file exists on disk but is not in the array,
 *                    so it never runs. That is what happened.
 *   DUPLICATE ID   — two entries share an id. The second is skipped by the
 *                    appliedIds check and its `up()` never executes, which
 *                    CLAUDE.md records as having cost real time before.
 *   OUT OF ORDER   — ids that do not ascend mean the array's order and the
 *                    numbering disagree, so what actually ran is not what the
 *                    filenames imply.
 *
 * THROWS rather than warns. A migration that did not run is a schema that does
 * not match the code, and every consequence of that is worse and later than a
 * refusal to boot. It is one readdir and two loops, once per process.
 */
function assertRegistryIntact() {
  const ids = MIGRATIONS.map((m) => m?.id);

  const nameless = ids.filter((id) => typeof id !== "string" || !id.trim());
  if (nameless.length) {
    throw new Error(`runMigrations: ${nameless.length} entr(ies) in MIGRATIONS export no \`id\``);
  }

  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(
        `runMigrations: DUPLICATE migration id "${id}" in MIGRATIONS. ` +
        `The second is silently skipped — its up() would never run.`
      );
    }
    seen.add(id);
  }

  for (let i = 1; i < ids.length; i++) {
    if (!(ids[i] > ids[i - 1])) {
      throw new Error(
        `runMigrations: MIGRATIONS is not in ascending id order — "${ids[i - 1]}" is followed by "${ids[i]}". ` +
        `Array order is execution order, so this means what runs is not what the numbering implies.`
      );
    }
  }

  // Every migration FILE on disk must be registered. This is the check that
  // would have caught 024: the file existed and the array did not know.
  let files;
  try {
    files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
      .sort();
  } catch {
    return;   // packaged builds may not ship the directory; the checks above still ran
  }
  const registered = new Set(ids);
  const orphans = files.filter((f) => {
    const stem = f.replace(/\.js$/, "");
    return !registered.has(stem);
  });
  if (orphans.length) {
    throw new Error(
      `runMigrations: ${orphans.length} migration file(s) on disk are NOT in the MIGRATIONS array ` +
      `and would never run: ${orphans.join(", ")}. ` +
      `Import each and append it in src/db/migrate.js — the array is hand-maintained.`
    );
  }
}

export function runMigrations(db) {
  assertRegistryIntact();
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

// ─── Single ownership ──────────────────────────────────────────────────────
//
// WHY ONE PROCESS MUST APPLY. runMigrations reads the applied set ONCE, at the
// top, outside any transaction. Two processes both see 019 as unapplied, both
// run it, and the loser dies on `duplicate column name: source` — reproduced
// 2026-08-16 with four concurrent bootstraps. The per-migration transaction
// makes each ATTEMPT atomic; it does nothing about check-then-act ACROSS
// processes, and no busy_timeout can fix a race that never contends for a lock.
//
// The worker owns it: it is the only role with a naturally single instance.
// `web` scaling to two replicas would otherwise reintroduce the race silently.
// Unknown/unset role also applies — the db:migrate CLI, tests, and local dev all
// run without a role and must still work.
const WAITER_ROLES = new Set(["web", "scheduler"]);

export function migrationsOwner() {
  const role = String(process.env.SCOOP_PROCESS_ROLE || "").trim().toLowerCase();
  return !WAITER_ROLES.has(role);
}

/** Sync sleep — bootstrapSchema is synchronous and runs before the event loop. */
const sleepSync = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { /* SharedArrayBuffer unavailable — degrade to a spin-free no-op */ }
};

export const MIGRATION_WAIT_MS = (() => {
  const raw = process.env.MIGRATION_WAIT_MS;
  if (raw === undefined || raw === "") return 120_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
})();

/**
 * Block until the owner has applied every registered migration.
 *
 * BOUNDED AND LOUD, deliberately. A web container that waits forever for a
 * migration nobody will ever apply is a silent outage, which is strictly worse
 * than the crash this replaces: a crash-looping container is visible in
 * `docker ps` and in the restart count, a hung one looks healthy. So this throws
 * with the id it was waiting for rather than hanging.
 *
 * It NAMES WHAT IT IS WAITING FOR on every change, so a three-in-the-morning log
 * reads "waiting for migration 027_… (1 of 27 pending)" instead of silence.
 */
export function waitForMigrations(db, { timeoutMs = MIGRATION_WAIT_MS, pollMs = 250 } = {}) {
  assertRegistryIntact();
  ensureSchemaMigrationsTable(db);
  const expected = MIGRATIONS.map((m) => m.id);
  const started = Date.now();
  const deadline = started + timeoutMs;
  const applied = () => new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((r) => r.id)
  );

  let announced = null;
  let missing = expected.filter((id) => !applied().has(id));
  while (missing.length && Date.now() < deadline) {
    if (missing[0] !== announced) {
      announced = missing[0];
      logger.info(
        `⏳ waiting for migration ${announced} — ${missing.length} of ${expected.length} pending ` +
        `(this process does not apply migrations; the worker does)`
      );
    }
    sleepSync(pollMs);
    missing = expected.filter((id) => !applied().has(id));
  }

  const waitedMs = Date.now() - started;
  if (missing.length) {
    throw new Error(
      `waitForMigrations: timed out after ${waitedMs}ms waiting for migration "${missing[0]}" ` +
      `(${missing.length} of ${expected.length} still pending). The worker applies migrations — ` +
      `check that it started and did not fail. Raise MIGRATION_WAIT_MS if this schema change is ` +
      `genuinely slow, but a hang here means the owner is not running.`
    );
  }
  if (waitedMs > pollMs) logger.info(`✅ schema ready after ${waitedMs}ms — ${expected.length} migrations applied`);
  return { waitedMs, appliedCount: 0, registered: expected.length, waited: true };
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
    const { bootstrapSchema, applyConnectionPragmas } = await import("../models/database.js");
    const dbPath = resolveDirectDbPath();
    const db = new Database(dbPath);

    try {
      // Same pragma path as getDb() — journal_mode ignores busy_timeout, so the
      // shared helper is the only place that ordering is correct.
      applyConnectionPragmas(db);
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
