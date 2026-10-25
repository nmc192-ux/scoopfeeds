/**
 * Issue #177: USGS/NOAA machine events never consume selection windows meant for news.
 * One definition (machineEvents.notMachineEventSql), applied to the reader list and the
 * selection queries; the world map (a quake/weather surface) still sees them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";

// getDb() resolves its data directory at MODULE LOAD, so set it before importing.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-machine-events-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = dir;

const { getDb } = await import("../../models/database.js");
const { notMachineEventSql, isMachineEvent } = await import("./machineEvents.js");
const { listQualifyingEvents } = await import("./eventsDao.js");
const eventsRouter = (await import("../../routes/events.js")).default;

const NOW = Date.now();
const db = getDb();

function addEvent(id, slug, category, meta, summary = "A summary") {
  db.prepare(`
    INSERT INTO events
      (id, slug, title, summary, category, status, severity, geo_lat, geo_lng,
       started_at, last_activity_at, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', 0.9, 1.0, 2.0, ?, ?, ?, ?, ?)
  `).run(id, slug, `Title ${id}`, summary, category, NOW, NOW, meta, NOW, NOW);
}

// #243: a news event needs real coverage (>= 3 outlets) to reach a reader list.
let artN = 0;
function cover(eventId) {
  for (const outlet of ["Outlet A", "Outlet B", "Outlet C"]) {
    const aid = `me-a${++artN}`;
    db.prepare("INSERT INTO articles (id, title, url, source_name, category, published_at, fetched_at) VALUES (?,?,?,?,?,?,?)")
      .run(aid, `Art ${aid}`, `https://x.test/${aid}`, outlet, "world", NOW, NOW);
    db.prepare("INSERT INTO event_articles (event_id, article_id, added_at) VALUES (?,?,?)").run(eventId, aid, NOW);
  }
}

addEvent("news", "news-story", "world", null);
// A news event may legitimately be slugged like a feed; it must NOT be treated as machine.
addEvent("news-noaa-slug", "noaa-budget-cuts", "us", JSON.stringify({ note: "ordinary" }));
addEvent("badmeta", "bad-meta", "world", "{not json");
addEvent("quake", "usgs-abc", "geo", JSON.stringify({ source: "usgs", mag: 6.1 }));
addEvent("alert", "noaa-xyz", "weather", JSON.stringify({ source: "noaa" }));
for (const id of ["news", "news-noaa-slug", "badmeta"]) cover(id);

test("notMachineEventSql keeps news events and drops usgs/noaa, even with bad meta", () => {
  const ids = db.prepare(`SELECT e.id FROM events e WHERE ${notMachineEventSql("e")} ORDER BY e.id`)
    .all().map((r) => r.id);
  assert.deepEqual(ids, ["badmeta", "news", "news-noaa-slug"]);
});

test("isMachineEvent is the JS twin", () => {
  assert.equal(isMachineEvent({ meta: JSON.stringify({ source: "usgs" }) }), true);
  assert.equal(isMachineEvent({ meta: { source: "noaa" } }), true);
  assert.equal(isMachineEvent({ meta: "{not json" }), false);
  assert.equal(isMachineEvent({ meta: null }), false);
  assert.equal(isMachineEvent(null), false);
});

test("listQualifyingEvents never returns a machine event", () => {
  const slugs = listQualifyingEvents({ limit: 100 }).map((r) => r.slug);
  assert.ok(!slugs.includes("usgs-abc"));
  assert.ok(!slugs.includes("noaa-xyz"));
});

test("reader list excludes machine events; include_machine=1 and the world map still see them", async () => {
  const app = express();
  app.use("/api/events", eventsRouter);
  const server = app.listen(0);
  const { port } = server.address();
  const get = async (p) => (await fetch(`http://127.0.0.1:${port}/api/events${p}`)).json();
  try {
    const list = (await get("/?limit=50")).events.map((e) => e.slug);
    assert.ok(list.includes("news-story"));
    assert.ok(list.includes("noaa-budget-cuts"), "a news event with a noaa- slug is not machine");
    assert.ok(!list.includes("usgs-abc") && !list.includes("noaa-xyz"));

    const withMachine = (await get("/?limit=50&include_machine=1")).events.map((e) => e.slug);
    assert.ok(withMachine.includes("usgs-abc") && withMachine.includes("noaa-xyz"));

    const map = (await get("/world-map")).events.map((e) => e.slug);
    assert.ok(map.includes("usgs-abc") && map.includes("noaa-xyz"));
  } finally {
    server.close();
  }
});
