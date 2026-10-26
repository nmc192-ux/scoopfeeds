/**
 * #262 Coverage Gaps — measured by region, never by leaning.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";

// getDb() resolves its data directory at module load, so set it before importing.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-gaps-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = dir;

const { makeTestDb } = await import("../../testing/testDb.js");
const { getDb } = await import("../../models/database.js");
const gaps = await import("./coverageGaps.js");
const { outletCountry } = await import("../dal/countryAffinity.js");
const { isExplicitHarmHeadline } = await import("../../services/editorialSensitivity.js");
const gapsRouter = (await import("../../routes/gaps.js")).default;
const { _resetGapsCache } = await import("../../routes/gaps.js");

const NOW = Date.parse("2026-10-26T12:00:00Z");
const H = 3_600_000;
let n = 0;

function fixture(db) {
  const event = (id, title, meta = null, ageH = 1) => db.prepare(`
    INSERT INTO events (id, slug, title, category, status, severity, started_at, last_activity_at, meta, created_at, updated_at)
    VALUES (?, ?, ?, 'world', 'active', 0.5, ?, ?, ?, ?, ?)
  `).run(id, `slug-${id}`, title, NOW - 3 * H, NOW - ageH * H, meta, NOW, NOW);
  const article = (source, region, eventId = null, ageH = 2) => {
    const id = `a${++n}`;
    db.prepare(`INSERT INTO articles (id, title, url, source_name, category, region, published_at, fetched_at)
                VALUES (?, ?, ?, ?, 'world', ?, ?, ?)`)
      .run(id, `Art ${id}`, `https://x.test/${id}`, source, region, NOW - ageH * H, NOW);
    if (eventId) db.prepare("INSERT INTO event_articles (event_id, article_id, added_at) VALUES (?, ?, ?)").run(eventId, id, NOW);
    return id;
  };
  return { event, article };
}

/** US-heavy story with `ukBase` UK outlets publishing other things in the window. */
function seedBasic(db, { ukBase }) {
  const { event, article } = fixture(db);
  event("us-story", "Senate passes the farm bill");
  for (let i = 0; i < 5; i++) article(`US Outlet ${i}`, "us", "us-story");
  // more US outlets active in the window, not on the story → US base 8
  for (let i = 5; i < 8; i++) article(`US Outlet ${i}`, "us");
  for (let i = 0; i < ukBase; i++) article(`UK Outlet ${i}`, "uk");
  return { event, article };
}

test("5 US outlets, 0 UK, UK base 5 → a gap (US present, UK absent), measured by region", () => {
  const { db } = makeTestDb({ prefix: "scoop-gaps-basic-" });
  seedBasic(db, { ukBase: 5 });
  const r = gaps.computeGaps(db, { now: NOW });
  assert.equal(r.measured_by, "region");
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.items[0], {
    slug: "slug-us-story", title: "Senate passes the farm bill",
    present: { bucket: "US", outlets: 5 }, absent: { bucket: "UK", activeBase: 5 }, score: 0.625,
  });
  assert.equal(r.method.minPresent, 4);
  assert.equal(r.method.minBase, 5);
  assert.equal(r.method.bases.US, 8);
  assert.equal(r.method.bases.UK, 5);
  assert.equal(r.method.unknownShare, 0);
  assert.equal(r.method.capped, false);
  assert.ok(Array.isArray(r.method.buckets) && r.method.buckets.some((b) => b.id === "SOUTH_ASIA"));
});

test("same story with UK base 3 → no gap (small-base)", () => {
  const { db } = makeTestDb({ prefix: "scoop-gaps-small-" });
  seedBasic(db, { ukBase: 3 });
  const r = gaps.computeGaps(db, { now: NOW });
  assert.equal(r.items.length, 0);
  assert.equal(r.skips["small-base"], 1);
});

test("an event whose outlets are mostly of unknown region is skipped, not counted as a gap", () => {
  const { db } = makeTestDb({ prefix: "scoop-gaps-unknown-" });
  const { event, article } = seedBasic(db, { ukBase: 5 });
  event("murky", "Central bank holds rates");
  for (let i = 0; i < 4; i++) article(`US Outlet ${i}`, "us", "murky");
  for (let i = 0; i < 5; i++) article(`Mystery Wire ${i}`, "global", "murky");
  const r = gaps.computeGaps(db, { now: NOW });
  assert.deepEqual(r.items.map((x) => x.slug), ["slug-us-story"]);
  assert.equal(r.skips["unknown-majority"], 1);
  assert.ok(r.method.unknownShare > 0);
});

test("machine events never appear", () => {
  const { db } = makeTestDb({ prefix: "scoop-gaps-machine-" });
  const { event, article } = fixture(db);
  for (let i = 0; i < 5; i++) article(`UK Outlet ${i}`, "uk");
  event("quake", "M6.1 earthquake off the coast", JSON.stringify({ source: "usgs" }));
  for (let i = 0; i < 6; i++) article(`US Outlet ${i}`, "us", "quake");
  const r = gaps.computeGaps(db, { now: NOW });
  assert.equal(r.items.length, 0);
});

test("explicit-harm headlines are skipped", () => {
  const { db } = makeTestDb({ prefix: "scoop-gaps-harm-" });
  const { event, article } = fixture(db);
  const title = "Ten killed in market blast";
  assert.equal(isExplicitHarmHeadline(title), true);
  for (let i = 0; i < 5; i++) article(`UK Outlet ${i}`, "uk");
  event("harm", title);
  for (let i = 0; i < 6; i++) article(`US Outlet ${i}`, "us", "harm");
  const r = gaps.computeGaps(db, { now: NOW });
  assert.equal(r.items.length, 0);
  assert.equal(r.skips.harm, 1);
});

test("articles outside the window count neither for the story nor for the base", () => {
  const { db } = makeTestDb({ prefix: "scoop-gaps-window-" });
  const { event, article } = fixture(db);
  for (let i = 0; i < 5; i++) article(`UK Outlet ${i}`, "uk", null, 30); // published 30 h ago
  event("us-story", "Senate passes the farm bill");
  for (let i = 0; i < 5; i++) article(`US Outlet ${i}`, "us", "us-story");
  const r = gaps.computeGaps(db, { now: NOW });
  assert.equal(r.method.bases.UK, 0);
  assert.equal(r.items.length, 0);
});

test("weekly report: run twice for the same week → one row, unchanged", () => {
  const { db } = makeTestDb({ prefix: "scoop-gaps-weekly-" });
  seedBasic(db, { ukBase: 5 });
  const monday = Date.parse("2026-11-02T05:17:00Z"); // the Monday after NOW's week
  const first = gaps.runWeeklyGapReport(db, { now: monday });
  assert.equal(first.weekStart, "2026-10-26");
  assert.equal(first.inserted, true);
  const row1 = db.prepare("SELECT * FROM coverage_gap_reports").all();
  assert.equal(row1.length, 1);

  // new data arrives; a second run for the same week must not touch the stored row
  const { event, article } = fixture(db);
  event("late", "Another story");
  for (let i = 0; i < 6; i++) article(`US Outlet ${i}`, "us", "late");
  const second = gaps.runWeeklyGapReport(db, { now: monday + 3 * H });
  assert.equal(second.inserted, false);
  const row2 = db.prepare("SELECT * FROM coverage_gap_reports").all();
  assert.deepEqual(row2, row1);

  const rep = gaps.readWeeklyGapReport(db);
  assert.equal(rep.week_start, "2026-10-26");
  assert.equal(rep.measured_by, "region");
  assert.equal(rep.items[0].slug, "slug-us-story");
  assert.equal(rep.method.windowH, 168);
});

test("mondayOf / lastFullWeek are UTC Mondays", () => {
  assert.equal(gaps.mondayOf(Date.parse("2026-10-26T00:00:00Z")), "2026-10-26");
  assert.equal(gaps.mondayOf(Date.parse("2026-11-01T23:59:00Z")), "2026-10-26");
  assert.equal(gaps.lastFullWeek(Date.parse("2026-11-02T05:17:00Z")).weekStart, "2026-10-26");
});

test("buckets: fixed fold of outletCountry; new single-country tags resolve, latam/global do not", () => {
  assert.equal(gaps.bucketOf("US"), "US");
  assert.equal(gaps.bucketOf("GB"), "UK");
  assert.equal(gaps.bucketOf("FR"), "EUROPE");
  assert.equal(gaps.bucketOf("EU"), "EUROPE");
  assert.equal(gaps.bucketOf("QA"), "MIDDLE_EAST");
  assert.equal(gaps.bucketOf("IL"), "MIDDLE_EAST");
  assert.equal(gaps.bucketOf("PK"), "SOUTH_ASIA");
  assert.equal(gaps.bucketOf("JP"), "OTHER");
  assert.equal(gaps.bucketOf(null), "UNKNOWN");
  for (const [tag, cc] of [["za", "ZA"], ["ke", "KE"], ["kr", "KR"], ["jp", "JP"], ["br", "BR"], ["us-midwest", "US"]]) {
    assert.equal(outletCountry("Anything", tag), cc, tag);
  }
  assert.equal(outletCountry("Anything", "latam"), null);
  assert.equal(outletCountry("Some Wire", "global"), null);
});

test("cron gate: off unless COVERAGE_GAPS_ENABLED is literally 1; thresholds read from env", () => {
  assert.equal(gaps.coverageGapsEnabled({}), false);
  assert.equal(gaps.coverageGapsEnabled({ COVERAGE_GAPS_ENABLED: "true" }), false);
  assert.equal(gaps.coverageGapsEnabled({ COVERAGE_GAPS_ENABLED: "1" }), true);
  assert.deepEqual(gaps.gapConfig({ GAP_MIN_PRESENT: "6", GAP_MIN_BASE: "x", GAP_DAILY_MAX: "3" }),
    { minPresent: 6, minBase: 5, dailyMax: 3 });
});

test("GET /api/ri/gaps/daily and /weekly carry measured_by and method", async () => {
  seedBasic(getDb(), { ukBase: 5 });
  _resetGapsCache();
  const app = express();
  app.use("/api/ri/gaps", gapsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api/ri/gaps`;
  try {
    const d = await (await fetch(`${base}/daily`)).json();
    assert.equal(d.measured_by, "region");
    for (const k of ["buckets", "minPresent", "minBase", "unknownShare"]) assert.ok(k in d.method, k);
    assert.ok(Array.isArray(d.items));

    assert.equal((await fetch(`${base}/weekly`)).status, 404);
    assert.equal((await fetch(`${base}/weekly/not-a-date`)).status, 400);
    gaps.runWeeklyGapReport(getDb(), { now: Date.now() });
    const w = await (await fetch(`${base}/weekly`)).json();
    assert.equal(w.measured_by, "region");
    assert.ok("unknownShare" in w.method);
    assert.equal((await fetch(`${base}/weekly/${w.week_start}`)).status, 200);
  } finally {
    server.close();
  }
});
