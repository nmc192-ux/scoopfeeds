/**
 * Shared test database helper.
 *
 * Tests want a fast temp DB, not an app boot — but "fast" previously meant
 * calling runMigrations() alone, which is not a valid starting state: migrations
 * 011/012/017/020 operate on tables that no migration creates. That produced 64
 * bare SQLITE_ERROR failures across 10 files, all of them setup defects rather
 * than test defects.
 *
 * This helper seeds the same base schema the real app does, in the same order,
 * via the single bootstrapSchema() contract in models/database.js — so the test
 * DB cannot drift from the production one. It is still a temp DB with no server,
 * no scheduler and no network.
 *
 * Note it deliberately does NOT hand-roll an `articles` stub. Several tests used
 * to, with a looser column set than the real table; a `CREATE TABLE IF NOT EXISTS`
 * against the real schema would silently keep the stub and mask exactly the kind
 * of drift these tests exist to catch.
 */

import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { bootstrapSchema } from "../models/database.js";

/**
 * Create a fully-seeded temp database.
 *
 * @param {object} [options]
 * @param {string} [options.prefix] mkdtemp prefix, to keep temp dirs identifiable.
 * @returns {{ db: import("better-sqlite3").Database, dir: string, path: string, cleanup: () => void }}
 */
export function makeTestDb({ prefix = "scoop-test-" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(dir, "t.db");
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  bootstrapSchema(db);

  return {
    db,
    dir,
    path: dbPath,
    cleanup() {
      try { db.close(); } catch { /* already closed */ }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}
