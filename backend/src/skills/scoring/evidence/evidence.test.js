/**
 * evidence.test.js — B.6.2a tests (node --test).
 *
 * Builds a temp SQLite DB, runs the real migrations, seeds sources + articles
 * with KNOWN byline/coverage patterns, and exercises:
 *   - the two own-DB evidence modules (2.1.c, 2.3.c) against reasoned expectations
 *   - the evidence-cache DAO (upsert/get round-trip + staleness)
 *   - the runner (gathers + upserts; TTL reuse; force re-gather)
 *   - the EVIDENCE-ONLY invariant (sources.quality_score stays NULL)
 *
 * All DB access is injected (temp db) — modules/DAO/runner never touch the
 * shared getDb() singleton.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runMigrations } from "../../../db/migrate.js";
import bylines from "./modules/bylines_2_1_c.js";
import sustained from "./modules/sustainedCoverage_2_3_c.js";
import { getEvidence, upsertEvidence, isStale } from "./evidenceCache.js";
import { gatherForSource } from "./runner.js";
import { EVIDENCE_STATUS } from "./contract.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

// ── Temp DB + fixtures ──────────────────────────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-ev-"));
const db = new Database(path.join(dir, "t.db"));
runMigrations(db); // creates sources (002) + scoring_evidence_cache (007)
// `articles` is created by the base initializeSchema() (not a migration, and
// not exported), so the temp DB recreates the column subset the own-DB
// evidence modules query. Mirrors backend/src/models/database.js.
db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    url          TEXT UNIQUE NOT NULL,
    source_name  TEXT NOT NULL,
    category     TEXT NOT NULL,
    author       TEXT,
    published_at INTEGER NOT NULL,
    fetched_at   INTEGER NOT NULL,
    is_duplicate INTEGER DEFAULT 0
  );
`);

function addSource(name) {
  return db.prepare(
    `INSERT INTO sources (name, url, source_type, category, region, created_at, updated_at)
     VALUES (?, ?, 'rss', 'tech', 'global', ?, ?)`,
  ).run(name, `https://${name}.example/rss`, NOW, NOW).lastInsertRowid;
}

const insArticle = db.prepare(
  `INSERT INTO articles (id, title, url, source_name, category, author, published_at, fetched_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

// Alpha: 20 articles, ALL bylined, category 'tech', spread over ~380 days.
const ALPHA = addSource("Alpha");
for (let i = 0; i < 20; i++) {
  insArticle.run(`alpha-${i}`, `A${i}`, `https://alpha.example/${i}`, "Alpha", "tech", `Reporter ${i}`, NOW - i * 20 * DAY, NOW);
}
// Beta: 20 articles, only 1 bylined, all within a 10-day window.
const BETA = addSource("Beta");
for (let i = 0; i < 20; i++) {
  insArticle.run(`beta-${i}`, `B${i}`, `https://beta.example/${i}`, "Beta", "tech", i === 0 ? "Solo Writer" : null, NOW - i * (DAY / 2), NOW);
}
// Gamma: 20 articles, 13 bylined → ratio 0.65 ("usually").
const GAMMA = addSource("Gamma");
for (let i = 0; i < 20; i++) {
  insArticle.run(`gamma-${i}`, `G${i}`, `https://gamma.example/${i}`, "Gamma", "tech", i < 13 ? `Writer ${i}` : null, NOW - i * DAY, NOW);
}
// Delta: NO articles.
const DELTA = addSource("Delta");

const ctx = { db, now: NOW, sampleSize: 20, methodologyVersion: "v1.1" };

// ── 2.1.c byline ratio ───────────────────────────────────────────────────────
test("2.1.c — fully-bylined source → ratio 1.0, bucket 'always', confidence 1", () => {
  const ev = bylines.gather({ id: ALPHA, name: "Alpha" }, ctx);
  console.log("  2.1.c Alpha:", JSON.stringify(ev.value), "conf", ev.confidence);
  assert.equal(ev.status, EVIDENCE_STATUS.EVIDENCED);
  assert.equal(ev.value.ratio, 1);
  assert.equal(ev.value.bucket, "always");
  assert.equal(ev.value.sampled, 20);
  assert.equal(ev.confidence, 1);
});

test("2.1.c — low/absent RSS byline → status 'pending' (NOT confident 'never'), rss-metadata-gap flag, confidence 0", () => {
  // RSS-gap honesty: a low ratio is UNKNOWN, not negative. The feed may simply
  // omit the author field (BBC/AJ/ARY in the real-DB sanity check). Must not
  // assert "never" — downgrade to pending awaiting a B.6.2b page cross-check.
  const ev = bylines.gather({ id: BETA, name: "Beta" }, ctx);
  console.log("  2.1.c Beta:", JSON.stringify(ev.value));
  assert.equal(ev.status, EVIDENCE_STATUS.PENDING);
  assert.equal(ev.value.bylined, 1);
  assert.equal(ev.value.ratio, 0.05);
  assert.equal(ev.value.bucket, "inconclusive");
  assert.equal(ev.value.signal, "rss-metadata-gap");
  assert.equal(ev.confidence, 0);
  assert.notEqual(ev.value.bucket, "never"); // explicit: never asserts unbylined
});

test("2.1.c — ~two-thirds bylined → 'evidenced' (bylines are the norm = reliable positive)", () => {
  const ev = bylines.gather({ id: GAMMA, name: "Gamma" }, ctx);
  console.log("  2.1.c Gamma:", JSON.stringify(ev.value));
  assert.equal(ev.status, EVIDENCE_STATUS.EVIDENCED);
  assert.equal(ev.value.ratio, 0.65);
  assert.equal(ev.value.bucket, "usually");
});

test("2.1.c — no articles → status 'unavailable', confidence 0", () => {
  const ev = bylines.gather({ id: DELTA, name: "Delta" }, ctx);
  assert.equal(ev.status, EVIDENCE_STATUS.UNAVAILABLE);
  assert.equal(ev.confidence, 0);
});

// ── 2.3.c sustained coverage ──────────────────────────────────────────────────
test("2.3.c — long window (~380d) → ≥12 months, not window-limited, decent confidence", () => {
  const ev = sustained.gather({ id: ALPHA, name: "Alpha" }, ctx);
  console.log("  2.3.c Alpha:", JSON.stringify(ev.value), "conf", ev.confidence);
  assert.equal(ev.status, EVIDENCE_STATUS.EVIDENCED);
  assert.equal(ev.value.primaryCategory, "tech");
  assert.ok(ev.value.observationWindowDays >= 360, `window ${ev.value.observationWindowDays}`);
  assert.equal(ev.value.observationWindowLimited, false);
  assert.ok(ev.value.monthsCovered >= 12, `monthsCovered ${ev.value.monthsCovered}`);
  assert.equal(ev.value.meets12moInWindow, true);
  assert.ok(ev.confidence >= 0.9);
});

test("2.3.c — short window (~10d) → window-limited, confidence near 0 (honest caveat)", () => {
  const ev = sustained.gather({ id: BETA, name: "Beta" }, ctx);
  console.log("  2.3.c Beta:", JSON.stringify(ev.value), "conf", ev.confidence);
  assert.equal(ev.value.observationWindowLimited, true);
  assert.ok(ev.value.observationWindowDays <= 12, `window ${ev.value.observationWindowDays}`);
  assert.ok(ev.confidence < 0.1, `confidence ${ev.confidence} should be capped by the short window`);
});

test("2.3.c — no articles → status 'unavailable'", () => {
  const ev = sustained.gather({ id: DELTA, name: "Delta" }, ctx);
  assert.equal(ev.status, EVIDENCE_STATUS.UNAVAILABLE);
});

// ── Evidence-cache DAO ────────────────────────────────────────────────────────
test("evidenceCache — upsert + get round-trips JSON value", () => {
  const ev = { status: "evidenced", value: { ratio: 0.5, sampled: 20 }, confidence: 0.8, evidenceUrl: null, gatheredAt: NOW };
  upsertEvidence(ALPHA, "test.x", ev, "v1.1", db);
  const got = getEvidence(ALPHA, "test.x", db);
  assert.equal(got.status, "evidenced");
  assert.deepEqual(got.value, { ratio: 0.5, sampled: 20 });
  assert.equal(got.confidence, 0.8);
  // Upsert again (conflict path) → one row, updated value.
  upsertEvidence(ALPHA, "test.x", { ...ev, value: { ratio: 0.9, sampled: 20 } }, "v1.1", db);
  assert.equal(getEvidence(ALPHA, "test.x", db).value.ratio, 0.9);
  const rows = db.prepare("SELECT COUNT(*) n FROM scoring_evidence_cache WHERE source_id=? AND sub_criterion='test.x'").get(ALPHA).n;
  assert.equal(rows, 1, "upsert must keep exactly one row per (source, sub_criterion)");
});

test("evidenceCache — isStale: missing → stale; fresh → not; aged past TTL → stale", () => {
  assert.equal(isStale(null, 30, NOW), true);
  assert.equal(isStale({ gathered_at: NOW }, 30, NOW), false);
  assert.equal(isStale({ gathered_at: NOW - 40 * DAY }, 30, NOW), true);
});

// ── Runner ────────────────────────────────────────────────────────────────────
test("runner — gathers both modules, upserts, then reuses fresh cache (TTL)", async () => {
  const first = await gatherForSource({ id: GAMMA, name: "Gamma" }, { db, now: NOW, modules: [bylines, sustained] });
  assert.equal(first.length, 2);
  assert.ok(first.every((r) => r.fromCache === false), "first run gathers (not cached)");
  assert.ok(getEvidence(GAMMA, "2.1.c", db));
  assert.ok(getEvidence(GAMMA, "2.3.c", db));

  const second = await gatherForSource({ id: GAMMA, name: "Gamma" }, { db, now: NOW, modules: [bylines, sustained] });
  assert.ok(second.every((r) => r.fromCache === true), "second run reuses fresh cache");

  const aged = await gatherForSource({ id: GAMMA, name: "Gamma" }, { db, now: NOW + 40 * DAY, modules: [bylines, sustained] });
  assert.ok(aged.every((r) => r.fromCache === false), "past TTL → re-gathered");

  const forced = await gatherForSource({ id: GAMMA, name: "Gamma" }, { db, now: NOW, force: true, modules: [bylines, sustained] });
  assert.ok(forced.every((r) => r.fromCache === false), "force → re-gathered even if fresh");
});

test("EVIDENCE-ONLY invariant — sources.quality_score stays NULL after gathering", async () => {
  await gatherForSource({ id: ALPHA, name: "Alpha" }, { db, now: NOW, force: true, modules: [bylines, sustained] });
  const q = db.prepare("SELECT quality_score FROM sources WHERE id=?").get(ALPHA).quality_score;
  assert.equal(q, null, "B.6.2 must not write any quality_score");
});

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
