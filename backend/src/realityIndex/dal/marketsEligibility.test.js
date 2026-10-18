/**
 * Issue #171: a resolved, expired or inactive prediction market is never bound to
 * an event and never returned to a reader. One definition (marketsDao.isMarketEligible
 * / eligibleMarketSql), used by every binding and read path.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";

// getDb() resolves its data directory at MODULE LOAD, so set it before importing.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-markets-elig-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = dir;

const { getDb } = await import("../../models/database.js");
const dao = await import("./marketsDao.js");
const { listClusterMarkets } = await import("./linksDao.js");
const { syncPolymarketResolutions } = await import("../ingest/predictionMarkets/polymarketFetcher.js");
const eventsRouter = (await import("../../routes/events.js")).default;

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const db = getDb();

function addMarket(id, over = {}) {
  db.prepare(`
    INSERT INTO prediction_markets
      (id, source, source_market_id, question, end_date, resolved, active, yes_price, created_at, updated_at)
    VALUES (@id, 'polymarket', @sid, @q, @end_date, @resolved, @active, 0.5, @ts, @updated_at)
  `).run({
    id, sid: `cond-${id}`, q: `Question ${id}?`,
    end_date: NOW + 30 * DAY, resolved: 0, active: 1, ts: NOW, updated_at: NOW, ...over,
  });
}

const MARKETS = {
  open:     {},
  resolved: { resolved: 1 },
  expired:  { end_date: NOW - DAY },
  inactive: { active: 0 },
  nodate:   { end_date: null },
};
for (const [id, over] of Object.entries(MARKETS)) addMarket(id, over);

db.prepare(`INSERT INTO events (id, slug, title, category, started_at, last_activity_at, created_at, updated_at)
            VALUES ('ev1', 'ev-one', 'Event one', 'world', ?, ?, ?, ?)`).run(NOW, NOW, NOW, NOW);
let rank = 1;
for (const id of Object.keys(MARKETS)) {
  db.prepare(`INSERT INTO event_market_links (event_id, market_id, weight, rank, matched_at) VALUES ('ev1', ?, 1, ?, ?)`)
    .run(id, rank++, NOW);
}

test("isMarketEligible: only active + unresolved + future end_date", () => {
  const byId = id => dao.getMarketById(id);
  assert.equal(dao.isMarketEligible(byId("open")), true);
  for (const id of ["resolved", "expired", "inactive", "nodate"]) {
    assert.equal(dao.isMarketEligible(byId(id)), false, id);
  }
  assert.equal(dao.isMarketEligible(null), false);
});

test("eligibleMarketSql agrees with isMarketEligible on every row", () => {
  const sqlIds = db.prepare(`SELECT id FROM prediction_markets pm WHERE ${dao.eligibleMarketSql("pm")}`).all().map(r => r.id);
  assert.deepEqual(sqlIds, ["open"]);
});

test("listMarkets(activeOnly) returns only the open market", () => {
  assert.deepEqual(dao.listMarkets({ limit: 50 }).map(m => m.id), ["open"]);
});

test("GET /api/events/:slug/markets returns only the eligible bound market", async () => {
  const app = express();
  app.use("/api/events", eventsRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/events/ev-one/markets`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.markets.length, 1);
    assert.equal(body.markets[0].id, "open");

    const ev = await (await fetch(`http://127.0.0.1:${port}/api/events/ev-one`)).json();
    const payload = ev.event ?? ev;
    if (payload.market_count !== undefined) assert.equal(payload.market_count, 1);
  } finally {
    server.close();
  }
});

test("cluster bindings to dead markets are not returned or carried forward", () => {
  db.prepare(`INSERT INTO story_clusters (id, title, category, keywords, article_count, created_at, updated_at, expires_at)
              VALUES ('c1', 'Cluster', 'world', '[]', 6, ?, ?, ?)`).run(NOW, NOW, NOW + DAY);
  let r = 1;
  for (const id of Object.keys(MARKETS)) {
    db.prepare(`INSERT INTO cluster_market_links (cluster_id, market_id, weight, rank, matcher, matched_at) VALUES ('c1', ?, 1, ?, 't', ?)`)
      .run(id, r++, NOW);
  }
  assert.deepEqual(listClusterMarkets("c1").map(m => m.id), ["open"]);
});

test("syncPolymarketResolutions resolves closed markets and retires the expired", async () => {
  addMarket("closing", { end_date: NOW + 10 * DAY, updated_at: NOW - 3 * 60 * 60 * 1000 }); // not refreshed by the open sync
  addMarket("vanished", { end_date: NOW + 10 * DAY, updated_at: NOW - 3 * 60 * 60 * 1000 });
  addMarket("late", { end_date: NOW - 2 * DAY });                                          // past end_date, still flagged active

  const asked = [];
  const fetchByIds = async ids => {
    asked.push(...ids);
    return [{ conditionId: "cond-closing", closed: true }, { conditionId: "cond-late", closed: false }];
  };
  const out = await syncPolymarketResolutions({ syncStartedAt: NOW - 60 * 60 * 1000, fetchByIds });

  assert.ok(asked.includes("cond-closing") && asked.includes("cond-vanished") && asked.includes("cond-late"));
  const row = id => dao.getMarketById(id);
  assert.equal(row("closing").resolved, 1);
  assert.equal(row("closing").active, 0);
  assert.equal(row("vanished").active, 0, "absent upstream → inactive");
  assert.equal(row("late").active, 0, "past end_date → deactivated");
  assert.equal(row("open").active, 1, "a healthy open market is untouched");
  assert.ok(out.resolved >= 1 && out.expired >= 1);
});

test("an empty upstream answer is treated as a fault, not as markets vanishing", async () => {
  addMarket("unverified", { end_date: NOW + 10 * DAY, updated_at: NOW - 3 * 60 * 60 * 1000 });
  const out = await syncPolymarketResolutions({ syncStartedAt: NOW - 60 * 60 * 1000, fetchByIds: async () => [] });
  assert.equal(dao.getMarketById("unverified").active, 1);
  assert.ok(out.unanswered >= 1);
  // Marked as asked, so an API that keeps answering empty cannot pin it to the head of the queue.
  assert.ok(dao.getMarketById("unverified").updated_at > NOW - 60 * 60 * 1000);
});

test("still-open stale markets are marked checked, so the next run asks about different ids", async () => {
  const STALE = NOW - 3 * 60 * 60 * 1000;
  for (let i = 0; i < 5; i++) addMarket(`stale${i}`, { end_date: NOW + 20 * DAY, updated_at: STALE - i });
  const asked = [];
  const fetchByIds = async ids => { asked.push(...ids); return ids.map(id => ({ conditionId: id, closed: false })); };
  const opts = { syncStartedAt: NOW - 60 * 60 * 1000, fetchByIds, limit: 2 };
  await syncPolymarketResolutions(opts);
  const first = asked.splice(0);
  await syncPolymarketResolutions(opts);
  const second = asked.splice(0);
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.ok(first.every(id => !second.includes(id)), "second run must not re-ask the first run's ids");
});

test("binding rows are never deleted or rewritten by retirement", () => {
  const n = db.prepare(`SELECT COUNT(*) AS n FROM event_market_links WHERE event_id = 'ev1'`).get().n;
  assert.equal(n, Object.keys(MARKETS).length);
});
