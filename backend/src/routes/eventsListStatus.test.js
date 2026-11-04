/**
 * #327: GET /api/events accepts `status` only from active | dormant.
 *
 * The route reads getDb(), whose path is fixed when models/database.js loads, so the temp
 * directory makeTestDb() creates is handed over through SCOOP_PERSISTENT_DATA_DIR before the
 * router is imported; getDb() then bootstraps the same real schema there.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeTestDb } from "../testing/testDb.js";

const tmp = makeTestDb({ prefix: "scoop-events-status-" });
tmp.cleanup();
process.env.SCOOP_PERSISTENT_DATA_DIR = tmp.dir;
process.env.EVENT_READER_ELIGIBILITY = "true";

const { default: express } = await import("express");
const { getDb } = await import("../models/database.js");
const { default: eventsRouter } = await import("./events.js");

let server;
let base;

function seedEvent(db, { id, status, outlets }) {
  const now = Date.now();
  db.prepare(`INSERT INTO events (id, slug, title, category, status, started_at, last_activity_at, created_at, updated_at)
              VALUES (?, ?, ?, 'politics', ?, ?, ?, ?, ?)`)
    .run(id, `slug-${id}`, `Event ${id}`, status, now - 86_400_000, now, now, now);
  outlets.forEach((outlet, i) => {
    const aid = `${id}-a${i}`;
    db.prepare(`INSERT INTO articles (id, title, url, source_name, category, published_at, fetched_at)
                VALUES (?, ?, ?, ?, 'politics', ?, ?)`)
      .run(aid, `Article ${aid}`, `https://x.test/${aid}`, outlet, now, now);
    db.prepare("INSERT INTO event_articles (event_id, article_id, added_at) VALUES (?, ?, ?)").run(id, aid, now);
  });
}

before(async () => {
  const db = getDb();
  const three = ["Reuters", "BBC", "AP"];
  seedEvent(db, { id: "ev-active", status: "active", outlets: three });
  seedEvent(db, { id: "ev-dormant", status: "dormant", outlets: three });
  // Dormant but one outlet only: not reader-eligible (#243), must not be listed.
  seedEvent(db, { id: "ev-dormant-thin", status: "dormant", outlets: ["Reuters"] });
  seedEvent(db, { id: "ev-merged", status: "merged", outlets: three });
  seedEvent(db, { id: "ev-closed", status: "closed", outlets: three });

  const app = express();
  app.use("/api/events", eventsRouter);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/api/events`;
});

after(() => { server?.close(); });

async function get(qs = "") {
  const res = await fetch(`${base}${qs}`);
  return { status: res.status, body: await res.json() };
}

test("status=merged and status=closed are refused with a 400", async () => {
  for (const s of ["merged", "closed", "resolved", "", "active,dormant"]) {
    const r = await get(`?status=${encodeURIComponent(s)}`);
    assert.equal(r.status, 400, `status=${s}`);
    assert.match(r.body.error, /active, dormant/);
    assert.equal(r.body.events, undefined);
  }
});

test("status=dormant returns only dormant, reader-eligible events", async () => {
  const r = await get("?status=dormant");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.events.map((e) => e.id), ["ev-dormant"]);
  assert.ok(r.body.events.every((e) => e.status === "dormant"));
});

test("the default is still active", async () => {
  const r = await get("");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.events.map((e) => e.id), ["ev-active"]);
});
