/**
 * bootstrapOrder.test.js — the schema-bootstrap ordering contract.
 *
 * Regression cover for the bug where migrations 011/012/017/020 operated on
 * tables no migration creates (`articles`, `social_posts` from initializeSchema;
 * `events`, `event_articles`, `event_timeline` from initRealityIndex). getDb()
 * ran initializeSchema → runMigrations and left initRealityIndex to server.js,
 * so migration 011 hit `event_articles` before it existed: 64 red tests, and a
 * genuinely fresh database could not boot at all.
 *
 * These three tests pin the contract from both ends — that a properly seeded DB
 * migrates cleanly and idempotently, that a fresh getDb() boots, and that an
 * unseeded DB fails with a NAMED precondition error rather than a raw SQLITE_ERROR.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeTestDb } from "../testing/testDb.js";
import { runMigrations, getRegisteredMigrations } from "./migrate.js";

// ── 1. seeded DB → every registered migration applies, and re-running is a no-op ──
test("bootstrap — a seeded DB applies every registered migration, idempotently", () => {
  const { db, cleanup } = makeTestDb({ prefix: "bootstrap-mig-" });

  try {
    // Deliberately NOT a hardcoded count. The literal "20" in the original spec was
    // already stale (021_event_post_retries had landed), and a literal here would rot
    // again on the next migration.
    const registered = getRegisteredMigrations();
    assert.ok(registered.length > 0, "there is at least one registered migration");

    const applied = db
      .prepare("SELECT id FROM schema_migrations ORDER BY applied_at ASC")
      .all()
      .map((row) => row.id);

    assert.deepEqual(
      [...applied].sort(),
      [...registered].sort(),
      "makeTestDb's bootstrapSchema applied every registered migration",
    );

    // Re-run against the same DB: nothing left to apply.
    const rerun = runMigrations(db);
    assert.equal(rerun.appliedCount, 0, "re-running migrations applies nothing");
    assert.equal(rerun.registered, registered.length, "registered count is stable");
  } finally {
    cleanup();
  }
});

// ── 2. fresh data dir → getDb() boots ────────────────────────────────────────────
// THIS TEST FAILS ON main: getDb() against an empty SCOOP_PERSISTENT_DATA_DIR dies
// with `no such table: event_articles` at migration 011. Run in a child process
// because models/database.js resolves its data dir once, at import time.
test("bootstrap — getDb() boots against a completely empty data directory", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-fresh-"));

  try {
    const script = `
      import { getDb } from ${JSON.stringify(new URL("../models/database.js", import.meta.url).href)};
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
      process.stdout.write("TABLES:" + JSON.stringify(tables));
    `;

    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, SCOOP_PERSISTENT_DATA_DIR: dir },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const tables = JSON.parse(out.slice(out.indexOf("TABLES:") + "TABLES:".length));

    // The five tables the migrations depend on but never create.
    for (const table of ["articles", "social_posts", "events", "event_articles", "event_timeline"]) {
      assert.ok(tables.includes(table), `fresh boot created ${table}`);
    }
    assert.ok(fs.existsSync(path.join(dir, "news.db")), "news.db was created in the fresh data dir");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 3. unseeded DB → named precondition error, not a bare SQLITE_ERROR ───────────
test("bootstrap — runMigrations on a bare DB throws a NAMED precondition error", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-bare-"));
  const db = new Database(path.join(dir, "t.db"));

  try {
    assert.throws(
      () => runMigrations(db),
      (err) => {
        // The whole point: not an opaque SQLITE_ERROR from deep inside migration 011.
        assert.notEqual(err.code, "SQLITE_ERROR", "must not surface as a raw SQLITE_ERROR");
        assert.match(err.message, /base schema missing/i, "names the failure");
        assert.match(err.message, /event_articles/, "names a missing table");
        assert.match(err.message, /bootstrapSchema/, "points at the fix");
        return true;
      },
    );

    // And it must fail BEFORE applying anything — no partial migration through 001-010.
    const hasMigrationsTable = db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get().n;
    assert.equal(hasMigrationsTable, 0, "bailed before creating schema_migrations");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
