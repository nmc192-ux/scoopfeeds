/**
 * #263 — prominence has ONE definition (eventsDao.prominenceSql), shared by
 * GET /api/ri/events?sort=prominence and the Morning Scoop v2 edition.
 * The route's ordering and the DAO's must agree on the same DB.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";

process.env.SCOOP_PERSISTENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-prominence-"));

const { getDb } = await import("../../models/database.js");
const { topEventsByProminence, prominenceSql, PROMINENCE_HALFLIFE_MS } = await import("./eventsDao.js");
const eventsRouter = (await import("../../routes/events.js")).default;

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const db = getDb();

let n = 0;
function seedEvent(title, outlets, { perOutlet = 1, activeAgo = HOUR, machine = false, category = "world" } = {}) {
  const id = `p-${++n}`;
  db.prepare(`INSERT INTO events (id, slug, title, category, status, severity, started_at, last_activity_at, meta, created_at, updated_at)
              VALUES (?,?,?,?,'active',0.5,?,?,?,?,?)`)
    .run(id, id, title, category, NOW - 48 * HOUR, NOW - activeAgo, machine ? JSON.stringify({ source: "usgs" }) : "{}", NOW - 48 * HOUR, NOW - activeAgo);
  let k = 0;
  for (const o of outlets) for (let i = 0; i < perOutlet; i++) {
    const aid = `${id}-${++k}`;
    db.prepare(`INSERT INTO articles (id, title, url, source_name, category, published_at, fetched_at) VALUES (?,?,?,?,?,?,?)`)
      .run(aid, `${title} ${k}`, `https://x.test/${aid}`, o, category, NOW - activeAgo, NOW);
    db.prepare(`INSERT INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?,?,1.0,?)`).run(id, aid, NOW);
  }
  return id;
}

const O = ["Reuters", "AP", "BBC News", "CNN", "Guardian", "Al Jazeera"];
seedEvent("Six outlets, old", O, { activeAgo: 40 * HOUR });
seedEvent("Four outlets, fresh", O.slice(0, 4));
seedEvent("Three outlets x3", O.slice(0, 3), { perOutlet: 3, activeAgo: 5 * HOUR });
seedEvent("Five outlets", O.slice(0, 5), { activeAgo: 10 * HOUR, category: "tech" });
seedEvent("Quake", O, { machine: true });
seedEvent("Single outlet", ["Investing.com"], { perOutlet: 10 });

test("route ?sort=prominence and topEventsByProminence return the same events in the same order", async () => {
  const srv = express().use("/e", eventsRouter).listen(0);
  try {
    const port = srv.address().port;
    const body = await (await fetch(`http://127.0.0.1:${port}/e?sort=prominence&limit=20`)).json();
    const want = topEventsByProminence(db, { limit: 20 }).map((e) => e.id);
    assert.deepEqual(body.events.map((e) => e.id), want);
    assert.equal(want.length, 4); // machine + single-source excluded by both
    const cat = await (await fetch(`http://127.0.0.1:${port}/e?sort=prominence&category=tech`)).json();
    assert.deepEqual(cat.events.map((e) => e.id), topEventsByProminence(db, { categories: ["tech"] }).map((e) => e.id));
  } finally { srv.close(); }
});

test("prominenceSql is the documented formula", () => {
  const r = db.prepare(`SELECT e.id, ${prominenceSql("e")} AS p,
      (SELECT COUNT(DISTINCT a.source_name) FROM event_articles ea JOIN articles a ON a.id = ea.article_id WHERE ea.event_id = e.id) AS s,
      (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id = e.id) AS c, e.last_activity_at AS t
    FROM events e`).all(NOW, PROMINENCE_HALFLIFE_MS);
  for (const x of r) assert.ok(Math.abs(x.p - (2 * x.s + x.c) / (1 + (NOW - x.t) / PROMINENCE_HALFLIFE_MS)) < 1e-9, x.id);
});

test("activeWithinMs, excludeIds and limit filter as documented", () => {
  const all = topEventsByProminence(db, { limit: 20, now: NOW });
  const recent = topEventsByProminence(db, { limit: 20, activeWithinMs: 24 * HOUR, now: NOW });
  assert.ok(!recent.some((e) => e.title === "Six outlets, old"));
  assert.ok(all.some((e) => e.title === "Six outlets, old"));
  const ex = topEventsByProminence(db, { limit: 20, excludeIds: [all[0].id], now: NOW });
  assert.ok(!ex.some((e) => e.id === all[0].id));
  assert.equal(topEventsByProminence(db, { limit: 2, now: NOW }).length, 2);
});
