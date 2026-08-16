/**
 * cardSweep — the first thing that has ever deleted a card.
 *
 * 36k files / 34GB accumulated in about a month because every CARD_DESIGN_VER
 * bump orphans the previous generation and nothing removed it. A sweep is also
 * the most dangerous kind of code to get wrong, so these tests pin the SAFETY
 * properties as hard as the behaviour.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { sweepCards, formatSweep } from "./cardSweep.js";
import { cachePath } from "./cardRenderer.js";
import { makeTestDb } from "../testing/testDb.js";
import { getDb } from "../models/database.js";

const DAY = 24 * 60 * 60 * 1000;
const old = (p) => { const t = (Date.now() - 30 * DAY) / 1000; utimesSync(p, t, t); };

function fixture({ liveIds = [], files = [], imgFiles = [] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "cardsweep-"));
  mkdirSync(path.join(dir, "img-cache"), { recursive: true });
  for (const [name, stale] of files) {
    const p = path.join(dir, name);
    writeFileSync(p, "x".repeat(1024));
    if (stale) old(p);
  }
  for (const [name, stale] of imgFiles) {
    const p = path.join(dir, "img-cache", name);
    writeFileSync(p, "y".repeat(2048));
    if (stale) old(p);
  }
  // NO `DELETE FROM articles` — that fires the FTS5 sync triggers and the test
  // DB's virtual table reports SQLITE_CORRUPT_VTAB. Ids are unique per test
  // instead, so nothing needs clearing between them.
  const db = getDb();
  const ins = db.prepare(
    "INSERT OR IGNORE INTO articles (id,title,url,source_name,category,published_at,fetched_at) VALUES (?,?,?,?,?,?,?)"
  );
  for (const id of liveIds) ins.run(id, "t", `https://e.test/${id}`, "S", "world", Date.now(), Date.now());
  return dir;
}


/**
 * Seed an event and PROVE it landed.
 *
 * The first version used `INSERT OR IGNORE` with a partial column list, which
 * silently swallowed a NOT NULL violation (`category`, `started_at`) and
 * inserted nothing — so the "live event" test failed for a reason that had
 * nothing to do with the code under test. A fixture that cannot fail loudly is
 * the same defect as a test that builds its own inputs.
 */
function seedEvent(id) {
  const now = Date.now();
  // OR REPLACE, not OR IGNORE: idempotent across runs (the test DB persists),
  // but still ABORTS on a NOT NULL violation with no default — so a wrong column
  // list fails loudly instead of inserting nothing and blaming the sweep.
  getDb().prepare(
    `INSERT OR REPLACE INTO events (id, slug, title, category, status, started_at, last_activity_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, `slug-${id}`, "T", "world", "active", now, now, now, now);
  const n = getDb().prepare("SELECT COUNT(*) c FROM events WHERE id = ?").get(id).c;
  assert.equal(n, 1, `seedEvent did not insert ${id} — the fixture is lying`);
  return id;
}

let seq = 0;
const uniq = (base) => `${base}-${process.pid}-${seq++}`;

const HASH = "a1b2c3d4e5";

/**
 * FIXTURE NAMES COME FROM cachePath ITSELF, and from the hash shape the REAL
 * call sites pass it — not from a helper that mirrors what I assumed.
 *
 * The first version of this file built names as `${id}-${preset}-${hash}.png`,
 * which is cachePath's SIGNATURE and not what production writes: every live
 * caller appends a `-p0`/`-p1` photo suffix to the hash first. The suite passed
 * and the real dry run skipped 85% of the directory as unrecognised. A test that
 * constructs its own inputs can only ever prove self-consistency.
 */
const card = (id, preset = "og", hash = HASH, suffix = "p1") =>
  path.basename(cachePath(id, preset, suffix ? `${hash}-${suffix}` : hash));
// Real UUID SHAPE — the hyphens are the point: a naive split on "-" would take
// the article id apart, so the parser has to anchor on the last two segments.
//
// SYNTHETIC values, not ids copied from real data: makeTestDb() seeds thousands
// of real articles and the first pair I chose turned out to BE two of them, so
// the "orphan" was live and the test failed for the right reason.
const LIVE = "aaaaaaaa-0000-4000-8000-000000000001";
const DEAD = "bbbbbbbb-0000-4000-8000-000000000002";

test.before(() => { makeTestDb(); });

test("a card whose article is gone is deleted", () => {
  const dir = fixture({ liveIds: [LIVE], files: [[card(LIVE), false], [card(DEAD), false]] });
  const s = sweepCards(dir, { daysToKeep: 7 });
  assert.equal(s.orphaned, 1);
  assert.equal(s.kept, 1);
  assert.deepEqual(readdirSync(dir).filter(f => f.endsWith(".png")), [card(LIVE)]);
});

test("a stale-generation card for a LIVE article is deleted", () => {
  // A CARD_DESIGN_VER bump changes the hash, so the old file is unreachable even
  // though its article is alive. Safe because cards are a cache: the cost is one
  // cold render.
  const dir = fixture({ liveIds: [LIVE], files: [[card(LIVE, "og", "0000000000"), true], [card(LIVE), false]] });
  const s = sweepCards(dir, { daysToKeep: 7 });
  assert.equal(s.stale, 1);
  assert.equal(s.kept, 1);
});

test("bytes reclaimed are reported, not just a count", () => {
  const dir = fixture({ liveIds: [], files: [[card(DEAD), false], [card("dead2-x", "story"), false]] });
  const s = sweepCards(dir, { daysToKeep: 7 });
  assert.ok(s.bytes >= 1024, `expected real bytes, got ${s.bytes}`);
  assert.match(formatSweep(s), /MB reclaimed/);
});

// ── Safety ─────────────────────────────────────────────────────────────────
test("an unrecognised filename is SKIPPED, never guessed at", () => {
  // A file this module does not understand belongs to something else. Guessing
  // is how a sweep deletes what mattered.
  const dir = fixture({
    liveIds: [],
    files: [["README.md", true], ["not-a-card.png", true], ["4081af96-og-SHORT.png", true], [card(DEAD), true]],
  });
  const s = sweepCards(dir, { daysToKeep: 7 });
  assert.equal(s.unparseable, 3);
  assert.equal(s.deleted, 1, "only the well-formed orphan may go");
  const left = readdirSync(dir);
  for (const f of ["README.md", "not-a-card.png", "4081af96-og-SHORT.png"]) assert.ok(left.includes(f), `deleted ${f}`);
});

test("the cap stops a bug emptying the directory in one pass", () => {
  const files = Array.from({ length: 20 }, (_, i) => [card(`dead-${i}`, "og"), false]);
  const dir = fixture({ liveIds: [], files });
  const s = sweepCards(dir, { daysToKeep: 7, maxDeletes: 5 });
  assert.equal(s.deleted, 5);
  assert.equal(s.cappedAt, 5);
  assert.equal(readdirSync(dir).filter(f => f.endsWith(".png")).length, 15);
  assert.match(formatSweep(s), /CAPPED at 5/, "a truncated sweep must say so — a silent cap reads as 'done'");
});

test("dry run measures and deletes nothing", () => {
  const dir = fixture({ liveIds: [], files: [[card(DEAD), false]] });
  const s = sweepCards(dir, { daysToKeep: 7, dryRun: true });
  assert.equal(s.deleted, 1);
  assert.ok(s.bytes > 0);
  assert.equal(readdirSync(dir).filter(f => f.endsWith(".png")).length, 1, "dry run must not unlink");
});

test("a missing cards directory is not an error", () => {
  const s = sweepCards(path.join(tmpdir(), `nope-${Date.now()}`), { daysToKeep: 7 });
  assert.equal(s.skipped, "no cards directory");
  assert.match(formatSweep(s), /no cards directory/);
});

// ── img-cache ──────────────────────────────────────────────────────────────
test("img-cache is swept on mtime — its names carry no article id", () => {
  // `<sha1-20>.jpg`, so orphan detection is impossible there by construction.
  const dir = fixture({
    liveIds: [LIVE],
    imgFiles: [["0123456789abcdef0123.jpg", true], ["fedcba98765432100fed.png", false]],
  });
  const s = sweepCards(dir, { daysToKeep: 7 });
  assert.equal(s.stale, 1);
  assert.equal(readdirSync(path.join(dir, "img-cache")).length, 1);
});

test("a non-conforming img-cache file is left alone", () => {
  const dir = fixture({ liveIds: [], imgFiles: [["keep-me.txt", true]] });
  const s = sweepCards(dir, { daysToKeep: 7 });
  assert.equal(s.unparseable, 1);
  assert.equal(s.deleted, 0);
});

// ── Article ids contain hyphens; the parser must still split correctly ──────
test("a UUID article id parses despite its own hyphens", () => {
  // Anchoring on the LAST two segments (known preset + 10 hex) is what makes
  // this work — a naive split on '-' would take the article id apart.
  const dir = fixture({ liveIds: [LIVE], files: [[card(LIVE, "carousel3"), false]] });
  const s = sweepCards(dir, { daysToKeep: 7 });
  assert.equal(s.kept, 1, "the live UUID must be recognised, not treated as an orphan");
  assert.equal(s.deleted, 0);
});

// ── The regression that the first version of this file could not catch ──────
//
// These build names the way the FOUR LIVE CALL SITES do, not the way cachePath's
// signature reads. That distinction is the entire bug: 12,029 of 14,156 real
// files were unrecognised while this suite was green.
test("every shape the real call sites produce is recognised", () => {
  const shapes = [
    // cardRenderer.js:2001 — intendedPath, photo render
    cachePath(LIVE, "og", `${HASH}-p1`),
    // :2002 — fallbackPath, typographic
    cachePath(LIVE, "og", `${HASH}-p0`),
    // :2019 — finalPath, after a satori fallback
    cachePath(LIVE, "story", `${HASH}-p0`),
    // :2084 — the event carousel, keyed evt-{eventId}
    cachePath(`evt-${LIVE}`, "carousel1", `${HASH}-p0`),
    // and the bare shape cachePath alone produces (pre-suffix files on disk)
    cachePath(LIVE, "square", HASH),
  ];
  const dir = fixture({ liveIds: [], files: shapes.map((p) => [path.basename(p), true]) });
  const s = sweepCards(dir, { daysToKeep: 7, dryRun: true });
  assert.equal(s.unparseable, 0,
    `every live shape must parse; got ${s.unparseable} unrecognised of ${s.scanned}`);
  assert.equal(s.scanned, shapes.length);
});

// ── evt- policy ────────────────────────────────────────────────────────────
test("an evt- card is judged against EVENTS, not articles", () => {
  // The whole point of the ruling: these ids can never be in `articles`, so
  // judging them there would orphan every event carousel on every run.
  const evId = seedEvent("cccccccc-0000-4000-8000-000000000003");
  const dir = fixture({ liveIds: [], files: [[path.basename(cachePath(`evt-${evId}`, "carousel1", `${HASH}-p0`)), false]] });
  const s = sweepCards(dir, { daysToKeep: 7 });
  assert.equal(s.orphaned, 0, "a live event's carousel must NOT be orphaned");
  assert.equal(s.kept, 1);
  assert.equal(s.evtChecked, 1, "and it must have been checked against events");
});

test("an evt- card whose event is gone IS orphaned", () => {
  const dir = fixture({
    liveIds: [],
    files: [[path.basename(cachePath("evt-dddddddd-0000-4000-8000-000000000004", "carousel1", `${HASH}-p0`)), false]],
  });
  const s = sweepCards(dir, { daysToKeep: 7 });
  assert.equal(s.orphaned, 1);
});

test("an evt- card is still swept on mtime while its event lives", () => {
  // Events are not pruned on a 7-day rule, so mtime is what actually reclaims
  // these — the orphan check only catches an event that genuinely went away.
  const evId = seedEvent("eeeeeeee-0000-4000-8000-000000000005");
  const dir = fixture({ liveIds: [], files: [[path.basename(cachePath(`evt-${evId}`, "carousel2", `${HASH}-p0`)), true]] });
  const s = sweepCards(dir, { daysToKeep: 7 });
  assert.equal(s.stale, 1);
  assert.equal(s.orphaned, 0);
});
