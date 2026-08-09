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
 *
 * TEARDOWN IS DEFERRED TO PROCESS EXIT, DELIBERATELY. cleanup() used to close the
 * handle and rm the dir synchronously, the moment an awaited call returned. Any
 * work that call left in flight — a fetch continuation, a queued budget write, a
 * limiter draining — then landed on a closed handle and threw
 * "The database connection is not open" *after the test had ended*. node:test
 * catches that in its harness, sets exitCode 1 and reports the FILE as
 * `'test failed'` with no stack, while every subtest stays green. Land it during
 * a later test instead and the runner aborts the remainder of the file, which is
 * why the suite's total test count moved between runs (610 / 524 / 484).
 *
 * It is a race inside a single process, so it is invisible on a fast machine and
 * reproducible on a slower one — it surfaced only when the suite first ran on a
 * second machine. Serial execution and a raised ulimit do not touch it.
 *
 * So cleanup() now only *registers* the temp dir, which is removed at exit.
 * The handle is never explicitly closed: process exit reclaims it, and calling
 * a native addon from an exit hook aborts the process outright. Tests that need
 * true mid-file isolation should make a fresh makeTestDb() rather than reusing
 * one across cases — which they already do.
 */

import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { bootstrapSchema } from "../models/database.js";

/** Everything awaiting teardown. Drained once, at exit. */
const pending = new Set();
let exitHookInstalled = false;

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // 'exit' only permits synchronous work, which is all we need: better-sqlite3
  // close() and fs.rmSync() are both sync. Errors are swallowed — a failed temp
  // cleanup must never be the reason a green test file reports failure.
  process.on("exit", () => {
    // NOTHING NATIVE IN HERE. better-sqlite3's close() is an addon call, and an
    // addon invoked during environment teardown aborts the process with
    //   Assertion failed: (env) != nullptr
    // which surfaces as SIGABRT and a whole-file `'test failed'` with no stack —
    // the same symptom this helper exists to avoid. The handle needs no explicit
    // close: process exit reclaims the descriptor. Only the temp dir is removed,
    // and fs.rmSync is not an addon.
    for (const entry of pending) {
      try { fs.rmSync(entry.dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    pending.clear();
  });
}

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

  const entry = { db, dir };

  return {
    db,
    dir,
    path: dbPath,
    /**
     * Mark this DB for teardown. Idempotent and safe to call mid-file: it does
     * NOT close the handle, so late-arriving async work still finds an open
     * connection instead of throwing after the test has ended. See the header.
     */
    cleanup() {
      installExitHook();
      pending.add(entry);
    },
  };
}
