/**
 * #190: reader's country first on GET /api/events. Ordering only: membership and the
 * prominence order within each group never change; no ?country= means no change.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";

// getDb() resolves its data directory at MODULE LOAD, so set it before importing.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-country-affinity-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = dir;

const { getDb } = await import("../../models/database.js");
const { makeTestDb } = await import("../../testing/testDb.js");
const { outletCountry, hasCountrySources, parseCountry, reorderByCountry, _test } =
  await import("./countryAffinity.js");
const { _internals: radio } = await import("../../radio/sourceRegions.js");
const eventsRouter = (await import("../../routes/events.js")).default;

const NOW = Date.now();
let artN = 0;

function seed(db) {
  const addEvent = (id, ageMin, nArticles) => {
    db.prepare(`
      INSERT INTO events (id, slug, title, category, status, severity, started_at, last_activity_at, created_at, updated_at)
      VALUES (?, ?, ?, 'world', 'active', 0.5, ?, ?, ?, ?)
    `).run(id, `slug-${id}`, `Title ${id}`, NOW - ageMin * 60_000, NOW - ageMin * 60_000, NOW, NOW);
    return { id, nArticles };
  };
  const addArticle = (eventId, source, region) => {
    const aid = `a${++artN}`;
    db.prepare(`
      INSERT INTO articles (id, title, url, source_name, category, region, published_at, fetched_at)
      VALUES (?, ?, ?, ?, 'world', ?, ?, ?)
    `).run(aid, `Art ${aid}`, `https://x.test/${aid}`, source, region, NOW, NOW);
    db.prepare("INSERT INTO event_articles (event_id, article_id, added_at) VALUES (?, ?, ?)").run(eventId, aid, NOW);
  };
  // Recency order (newest first): us1, glob, uk1, us2, pk1, uk2.
  addEvent("us1", 1); addArticle("us1", "US Wire", "us"); addArticle("us1", "Other US", "us-west");
  addEvent("glob", 2); addArticle("glob", "WHO", "global");
  addEvent("uk1", 3); addArticle("uk1", "BBC News", "global"); addArticle("uk1", "BBC News", "global");
  addEvent("us2", 4); addArticle("us2", "Ars Technica", "global");
  addEvent("pk1", 5); addArticle("pk1", "Dawn", "pk");
  addEvent("uk2", 6); addArticle("uk2", "The Guardian", "global"); addArticle("uk2", "Sky News", "global");
}

const t = makeTestDb({ prefix: "scoop-affinity-" });
seed(t.db);
const recency = () => t.db.prepare("SELECT * FROM events ORDER BY last_activity_at DESC").all();
const ids = (rows) => rows.map((r) => r.id);

test("outletCountry: tag first, then the source config, then Radio's name overrides", () => {
  assert.equal(outletCountry("Anything", "us-west"), "US");
  assert.equal(outletCountry("Anything", "uk"), "GB");
  assert.equal(outletCountry("Anything", "pk"), "PK");
  assert.equal(outletCountry("BBC News", "global"), "GB");
  assert.equal(outletCountry("DW English", "global"), "DE");
  assert.equal(outletCountry("France 24", "global"), "FR");
  assert.equal(outletCountry("Bloomberg Markets", "global"), "US");
  assert.equal(outletCountry("Al Jazeera", "global"), "QA");
  assert.equal(outletCountry("The Hindu", "global"), "IN");
  assert.equal(outletCountry("WHO", "global"), null);
  assert.equal(outletCountry("", "global"), null);
});

test("every name in EUROPE_NOT_UK really is a Radio 'europe' override (the two lists cannot drift)", () => {
  for (const name of Object.keys(_test.EUROPE_NOT_UK)) assert.equal(radio.OVERRIDES[name], "europe", name);
});

test("covered countries: US, GB, PK, IN have outlets; ZZ and CA do not", () => {
  for (const cc of ["US", "GB", "PK", "IN"]) assert.equal(hasCountrySources(cc), true, cc);
  assert.equal(hasCountrySources("ZZ"), false);
  assert.equal(hasCountrySources("CA"), false);
});

test("parseCountry accepts only two letters", () => {
  assert.equal(parseCountry("gb"), "GB");
  assert.equal(parseCountry("GBR"), null);
  assert.equal(parseCountry("'; DROP"), null);
  assert.equal(parseCountry(undefined), null);
});

test("GB: UK-covered events first, original order kept in both groups, same membership", () => {
  const before = recency();
  const { rows, affinity } = reorderByCountry(t.db, before, "GB");
  assert.deepEqual(ids(rows), ["uk1", "uk2", "us1", "glob", "us2", "pk1"]);
  assert.deepEqual([...ids(rows)].sort(), [...ids(before)].sort());
  assert.equal(affinity.get("uk1"), 1, "BBC News twice is one outlet");
  assert.equal(affinity.get("uk2"), 2);
  assert.equal(affinity.get("us1"), 0);
});

test("PK puts the Pakistan-covered event first", () => {
  assert.deepEqual(ids(reorderByCountry(t.db, recency(), "PK").rows), ["pk1", "us1", "glob", "uk1", "us2", "uk2"]);
});

test("a country with no outlets (ZZ) gets US, then GB, then Europe", () => {
  const { rows, tiers, affinity } = reorderByCountry(t.db, recency(), "ZZ");
  assert.deepEqual(tiers, ["US", "GB", "EUROPE"]);
  assert.deepEqual(ids(rows), ["us1", "us2", "uk1", "uk2", "glob", "pk1"]);
  assert.equal(affinity.get("us1"), 0, "fallback reports no affinity to the reader's own country");
});

test("no or malformed country leaves the rows untouched", () => {
  const before = recency();
  assert.equal(reorderByCountry(t.db, before, null).rows, before);
  assert.equal(reorderByCountry(t.db, before, "nope").rows, before);
});

test("route: ?country=GB re-orders the prominence list; no country is byte-identical", async () => {
  // These fixture events carry one or two outlets on purpose (the affinity counts), which the
  // #243 reader-eligibility rules would hide. This test is about ordering, so the rules are off
  // here; readerEligibility.test.js covers them on the same route.
  const prevElig = process.env.EVENT_READER_ELIGIBILITY;
  process.env.EVENT_READER_ELIGIBILITY = "false";
  seed(getDb());
  const app = express();
  app.use("/api/events", eventsRouter);
  const server = app.listen(0);
  const port = server.address().port;
  const get = async (p) => (await fetch(`http://127.0.0.1:${port}/api/events${p}`)).text();
  try {
    const plain1 = await get("?sort=prominence&limit=50");
    const plain2 = await get("?sort=prominence&limit=50&country=");
    const bad = await get("?sort=prominence&limit=50&country=XYZ");
    const gb = JSON.parse(await get("?sort=prominence&limit=50&country=gb"));
    const base = JSON.parse(plain1);
    assert.equal(plain2, plain1, "empty country param: byte-identical");
    assert.equal(bad, plain1, "malformed country param: byte-identical");
    assert.equal(base.country, undefined);
    assert.equal(base.events[0].country_affinity, undefined);
    assert.equal(gb.country, "GB");
    const ukFirst = base.events.filter((e) => ["uk1", "uk2"].includes(e.id)).map((e) => e.id);
    const others = base.events.filter((e) => !["uk1", "uk2"].includes(e.id)).map((e) => e.id);
    assert.deepEqual(gb.events.map((e) => e.id), [...ukFirst, ...others]);
    assert.equal(gb.events.find((e) => e.id === "uk2").country_affinity, 2);
    assert.equal(gb.events.find((e) => e.id === "us1").country_affinity, 0);
  } finally {
    server.close();
    if (prevElig === undefined) delete process.env.EVENT_READER_ELIGIBILITY; else process.env.EVENT_READER_ELIGIBILITY = prevElig;
  }
});

test.after(() => t.cleanup());
