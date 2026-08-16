/**
 * Single-owner migrations, and the waiter that replaces the race.
 *
 * THE OUTAGE (2026-08-16). All four containers called bootstrapSchema on boot.
 * Two independent races, and neither fix substitutes for the other:
 *
 *   1. `busy_timeout` was the FIFTH pragma, so `journal_mode = WAL` — which
 *      needs a brief EXCLUSIVE lock — ran with the timeout still at 0 and failed
 *      instantly. Three of four containers died there, before any schema code.
 *   2. runMigrations reads the applied set ONCE, outside a transaction, so two
 *      processes both saw 019 as unapplied and the loser died on
 *      `duplicate column name: source`. No lock timeout can fix that: the two
 *      never contend for a lock, they contend for a decision.
 *
 * Reproduced with four concurrent bootstraps before writing either fix.
 */

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  migrationsOwner, waitForMigrations, getRegisteredMigrations, MIGRATION_WAIT_MS,
} from "./migrate.js";
import { BUSY_TIMEOUT_MS } from "../models/database.js";

const withRole = (role, fn) => {
  const prev = process.env.SCOOP_PROCESS_ROLE;
  if (role === undefined) delete process.env.SCOOP_PROCESS_ROLE;
  else process.env.SCOOP_PROCESS_ROLE = role;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.SCOOP_PROCESS_ROLE;
    else process.env.SCOOP_PROCESS_ROLE = prev;
  }
};

let n = 0;
const freshDb = () => {
  const db = new Database(path.join(tmpdir(), `own-${process.pid}-${n++}.db`));
  db.pragma("busy_timeout = 30000");
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  return db;
};

// ── Ownership ──────────────────────────────────────────────────────────────
test("the worker owns migrations; web and scheduler wait", () => {
  assert.equal(withRole("worker", migrationsOwner), true);
  assert.equal(withRole("web", migrationsOwner), false);
  assert.equal(withRole("scheduler", migrationsOwner), false);
});

test("an unset or unknown role still applies", () => {
  // The db:migrate CLI, the test harness and local dev all run with no role and
  // must keep working — defaulting them to "wait" would hang every one of them
  // forever on a database nobody is migrating.
  assert.equal(withRole(undefined, migrationsOwner), true);
  assert.equal(withRole("", migrationsOwner), true);
  assert.equal(withRole("some-future-role", migrationsOwner), true);
});

test("the role match is case- and whitespace-insensitive", () => {
  // A stray space in a compose file must not silently promote a waiter into a
  // second applier — that is the race coming back with no signal.
  assert.equal(withRole(" WEB ", migrationsOwner), false);
  assert.equal(withRole("Web", migrationsOwner), false);
});

// ── The waiter ─────────────────────────────────────────────────────────────
test("it returns immediately when every migration is already applied", () => {
  const db = freshDb();
  const ins = db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");
  for (const id of getRegisteredMigrations()) ins.run(id, Date.now());
  const r = waitForMigrations(db, { timeoutMs: 2000, pollMs: 10 });
  assert.equal(r.waited, true);
  assert.ok(r.waitedMs < 1000, "a satisfied wait must not sleep");
  assert.equal(r.registered, getRegisteredMigrations().length);
  db.close();
});

test("it is BOUNDED and throws — a silent hang is worse than the crash it replaces", () => {
  // A web container waiting forever for a migration nobody will apply looks
  // healthy in `docker ps` while serving nothing. The crash it replaces was at
  // least visible in the restart count.
  const db = freshDb();
  assert.throws(
    () => waitForMigrations(db, { timeoutMs: 120, pollMs: 20 }),
    /timed out after \d+ms waiting for migration/
  );
  db.close();
});

test("the error NAMES the migration it was waiting for", () => {
  // "waiting for migration 027_…" is diagnosable at three in the morning; a hang
  // is not, and neither is "database not ready".
  const db = freshDb();
  const first = getRegisteredMigrations()[0];
  assert.throws(
    () => waitForMigrations(db, { timeoutMs: 120, pollMs: 20 }),
    (err) => {
      assert.match(err.message, new RegExp(first), "the pending id must be in the message");
      assert.match(err.message, /worker applies migrations/, "and who is supposed to apply it");
      assert.match(err.message, /MIGRATION_WAIT_MS/, "and the knob that extends the wait");
      return true;
    }
  );
  db.close();
});

test("it waits for the LAST missing one, not merely a non-empty table", () => {
  // Counting rows would pass the moment the owner recorded anything; the waiter
  // has to check the actual set or a partially-migrated schema reads as ready.
  const db = freshDb();
  const ids = getRegisteredMigrations();
  const ins = db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");
  for (const id of ids.slice(0, -1)) ins.run(id, Date.now());
  assert.throws(
    () => waitForMigrations(db, { timeoutMs: 120, pollMs: 20 }),
    new RegExp(ids[ids.length - 1])
  );
  db.close();
});

// ── The pragma that caused the outage ──────────────────────────────────────
test("the busy timeout is generous, and shared so the three sites cannot drift", () => {
  assert.ok(BUSY_TIMEOUT_MS >= 30_000,
    "a WAL checkpoint on an 18GB file can hold the write lock for seconds; " +
    "5s was not enough for a four-container cold start");
  assert.ok(MIGRATION_WAIT_MS >= 30_000, "the waiter must outlast a slow migration");
});
