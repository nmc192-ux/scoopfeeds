/**
 * migrate.test.js — the registry is hand-maintained, so it is checked at boot.
 *
 * EARNED 2026-08-13, in production. Migration 024 was written, reviewed, merged
 * and deployed — and never ran, because the edit that should have appended it to
 * the MIGRATIONS array silently did not apply. Nothing failed at any point:
 * `node --check` passed (the file was syntactically fine), the full suite passed
 * (nothing asserted the registry), the PR read correctly, and the deploy was
 * clean. schema_migrations simply had 23 rows instead of 24 and the columns did
 * not exist.
 *
 * CLAUDE.md had already written the warning down — "a new file must be imported
 * and appended there, or it never runs" — which is exactly why a comment was not
 * enough. These tests are the mechanical version of that sentence.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, "migrations");
const SRC = fs.readFileSync(path.join(HERE, "migrate.js"), "utf8");

/** Every migration file on disk, by its module stem (which is also its id). */
const filesOnDisk = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
  .sort();

test("EVERY migration file on disk is imported and in the MIGRATIONS array", () => {
  // The check that would have caught 024. A file can exist, export a correct
  // `up()`, be committed and deployed, and never run.
  const arrayLine = SRC.slice(SRC.indexOf("const MIGRATIONS = ["), SRC.indexOf("];", SRC.indexOf("const MIGRATIONS = [")));
  const missing = [];
  for (const f of filesOnDisk) {
    const stem = f.replace(/\.js$/, "");
    const num = stem.slice(0, 3);
    const importedAs = `migration${num}`;
    if (!SRC.includes(`from "./migrations/${f}"`)) missing.push(`${f} (not imported)`);
    else if (!new RegExp(`\\b${importedAs}\\b`).test(arrayLine)) missing.push(`${f} (imported, NOT in the array)`);
  }
  assert.deepEqual(missing, [], `these would never run:\n  ${missing.join("\n  ")}`);
});

test("migration ids are unique — a duplicate is silently skipped", () => {
  const ids = new Map();
  for (const f of filesOnDisk) {
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    const m = src.match(/export const id\s*=\s*["']([^"']+)["']/);
    assert.ok(m, `${f} exports no \`id\``);
    const id = m[1];
    assert.ok(!ids.has(id), `duplicate id "${id}" in ${ids.get(id)} and ${f} — the second never runs`);
    ids.set(id, f);
  }
});

test("each migration's exported id matches its filename stem", () => {
  // The registry guard resolves files to ids by stem. A file whose internal id
  // disagrees would be reported as an orphan forever, or worse, silently pass.
  for (const f of filesOnDisk) {
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    const id = src.match(/export const id\s*=\s*["']([^"']+)["']/)[1];
    assert.equal(id, f.replace(/\.js$/, ""), `${f} exports id "${id}"`);
  }
});

test("ids ascend — array order IS execution order", () => {
  const stems = filesOnDisk.map((f) => f.replace(/\.js$/, ""));
  for (let i = 1; i < stems.length; i++) {
    assert.ok(stems[i] > stems[i - 1], `${stems[i - 1]} is followed by ${stems[i]}`);
  }
});

test("the boot guard is WIRED — runMigrations calls it before anything else", () => {
  // A guard that exists and is never invoked is the same as no guard, and this
  // whole file exists because "the code is written" was not the same as "the
  // code runs".
  const fn = SRC.slice(SRC.indexOf("export function runMigrations(db)"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /assertRegistryIntact\(\)/);
  assert.ok(
    body.indexOf("assertRegistryIntact()") < body.indexOf("assertBaseSchema(db)"),
    "the registry check must run before the schema check — it needs no database",
  );
});

test("a fresh bootstrap applies every migration on disk", async () => {
  // End to end, against a real database: the count in schema_migrations must
  // equal the number of files. This is the assertion that fails loudly if
  // someone adds a file and forgets the array, even if the guard were removed.
  const { makeTestDb } = await import("../testing/testDb.js");
  const { db } = makeTestDb();
  const applied = db.prepare("SELECT id FROM schema_migrations").all().map((r) => r.id);
  assert.equal(
    applied.length, filesOnDisk.length,
    `${filesOnDisk.length} migration files on disk but ${applied.length} applied — ` +
    `missing: ${filesOnDisk.map((f) => f.replace(/\.js$/, "")).filter((s) => !applied.includes(s)).join(", ")}`,
  );
});

test("024's columns actually exist after bootstrap — the regression itself", async () => {
  const { makeTestDb } = await import("../testing/testDb.js");
  const { db } = makeTestDb();
  const cols = new Set(db.prepare("PRAGMA table_info(video_posts)").all().map((c) => c.name));
  for (const c of [
    "instagram_post_id", "instagram_status", "instagram_error",
    "threads_post_id", "threads_status", "threads_error",
  ]) {
    assert.ok(cols.has(c), `video_posts.${c} is missing — migration 024 did not run`);
  }
});
