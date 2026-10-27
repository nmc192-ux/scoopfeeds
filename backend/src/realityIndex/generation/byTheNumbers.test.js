/**
 * #272 — "By the numbers": the mechanical daily picker, its API, the IG-format
 * card and the admin route. makeTestDb() fixtures with real reader-eligibility
 * (4 outlets sharing entity keys → coherent and eligible), as in whatWeKnow.test.js.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-btn-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = DATA_DIR;

const { makeTestDb } = await import("../../testing/testDb.js");
const { getDb } = await import("../../models/database.js");
const { logger } = await import("../../services/logger.js");
const btn = await import("./byTheNumbers.js");
const dao = await import("../dal/originalsDao.js");

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 27, 5, 58);
const ON = { BY_THE_NUMBERS_ENABLED: "1" };

function seedEvent(db, eventId, { title = `Port strike story ${eventId}`, outlets = 4, desc = "About 1,200 staff joined the strike on Monday, the union said.", articles = true } = {}) {
  const insArt = db.prepare(`INSERT INTO articles (id, title, description, url, source_name, category, published_at, fetched_at) VALUES (?,?,?,?,?,?,?,?)`);
  const insEnt = db.prepare(`INSERT OR IGNORE INTO article_entities (article_id, surface, surface_norm, qid, entity_type, label, created_at) VALUES (?,?,?,?,?,?,?)`);
  db.prepare(`INSERT INTO events (id, slug, cluster_id, title, category, status, started_at, last_activity_at, meta, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(eventId, `${eventId}-slug`, null, title, "world", "active", NOW - 5 * HOUR, NOW - HOUR, "{}", NOW - 5 * HOUR, NOW - HOUR);
  const link = db.prepare(`INSERT INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?,?,1.0,?)`);
  const ids = [];
  for (let o = 0; o < outlets; o++) {
    const id = `${eventId}-a${o}`;
    insArt.run(id, `Strike at the port, ${eventId}`, desc, `https://o${o}.test/${id}`, `Outlet ${o}`, "world", NOW - (o + 1) * HOUR, NOW);
    for (const q of [`${eventId}-K1`, `${eventId}-K2`, `${eventId}-K3`]) insEnt.run(id, q, q.toLowerCase(), q, "unknown", q, NOW);
    if (articles) link.run(eventId, id, NOW - (o + 1) * HOUR);
    ids.push(id);
  }
  return ids;
}

function seedWwk(db, eventId, facts, { status = "ok", generatedAt = NOW - 2 * HOUR } = {}) {
  db.prepare(`INSERT INTO event_what_we_know (event_id, body_json, model, generated_at, status) VALUES (?,?,?,?,?)`)
    .run(eventId, JSON.stringify({ facts, unknown: [] }), "m", generatedAt, status);
}
const src = (eventId, ...outletIdx) => outletIdx.map((o) => ({ article_id: `${eventId}-a${o}`, source_name: `Outlet ${o}`, url: `https://o${o}.test/${eventId}-a${o}` }));

async function captured(fn) {
  const lines = [];
  const orig = logger.info;
  logger.info = (m, ...rest) => { if (typeof m === "string" && m.startsWith("🧭")) lines.push(m); return orig.call(logger, m, ...rest); };
  try { return { result: await fn(), lines }; } finally { logger.info = orig; }
}
const rows = (db) => db.prepare("SELECT * FROM daily_numbers ORDER BY day").all();

test("number kinds: years, dates, times, ordinals and small percentages are not figures", () => {
  assert.deepEqual(btn.pickNumber("In 2025 the plan was set."), { problem: "year" });
  assert.deepEqual(btn.pickNumber("The vote is on 12 November."), { problem: "date" });
  assert.deepEqual(btn.pickNumber("The vote is on Nov. 12."), { problem: "date" });
  assert.deepEqual(btn.pickNumber("Talks resume on 10/27."), { problem: "date" });
  assert.deepEqual(btn.pickNumber("Talks resume at 3:30."), { problem: "time" });
  assert.deepEqual(btn.pickNumber("Talks resume at 9 am."), { problem: "time" });
  assert.deepEqual(btn.pickNumber("It is the 3rd strike."), { problem: "ordinal" });
  assert.deepEqual(btn.pickNumber("Prices rose 0.4% in a month."), { problem: "small percentage" });
  assert.deepEqual(btn.pickNumber("No figures here."), { problem: "no number" });
  assert.deepEqual(btn.pickNumber("In 2025, 1,200 staff joined."), { num: "1,200", display: "1,200" });
  assert.deepEqual(btn.pickNumber("Prices rose 3.5% last year."), { num: "3.5", display: "3.5%" });
  assert.deepEqual(btn.pickNumber("The deal is worth $4 billion."), { num: "4", display: "$4 billion" });
});

test("flag unset → nothing written, nothing read", () => {
  const { db } = makeTestDb();
  seedEvent(db, "ev1"); seedWwk(db, "ev1", [{ text: "About 1,200 staff joined the strike.", sources: src("ev1", 0, 1) }]);
  assert.deepEqual(btn.runByTheNumbers({ db, now: NOW, env: {} }), { enabled: false });
  assert.equal(rows(db).length, 0);
});

test("no ok rows → no row and a btn-none line", async () => {
  const { db } = makeTestDb();
  const { result, lines } = await captured(() => btn.runByTheNumbers({ db, now: NOW, env: ON }));
  assert.equal(result.status, "none");
  assert.equal(rows(db).length, 0);
  assert.ok(lines.some((l) => l.startsWith("🧭 btn-none")), lines.join("\n"));
});

test("skips: year, date, casualty, sensitive title, one outlet left, no articles, refused WWK row", async () => {
  const { db } = makeTestDb();
  seedEvent(db, "ev-year", { desc: "The plan dates from 2025." });
  seedWwk(db, "ev-year", [{ text: "The plan dates from 2025.", sources: src("ev-year", 0, 1) }]);
  seedEvent(db, "ev-date", { desc: "The vote is on 12 November." });
  seedWwk(db, "ev-date", [{ text: "The vote is on 12 November.", sources: src("ev-date", 0, 1) }]);
  seedEvent(db, "ev-cas", { desc: "At least 40 people were killed." });
  seedWwk(db, "ev-cas", [{ text: "At least 40 people were killed.", sources: src("ev-cas", 0, 1) }]);
  seedEvent(db, "ev-sens", { title: "Mass shooting at a school" });
  seedWwk(db, "ev-sens", [{ text: "About 1,200 staff joined the strike.", sources: src("ev-sens", 0, 1) }]);
  // the number is in only one outlet's CURRENT report: outlet 1's article was edited since
  seedEvent(db, "ev-one");
  db.prepare("UPDATE articles SET description = 'Staff joined the strike on Monday.' WHERE id = 'ev-one-a1'").run();
  seedWwk(db, "ev-one", [{ text: "About 1,200 staff joined the strike.", sources: src("ev-one", 0, 1) }]);
  seedEvent(db, "ev-noart", { articles: false });
  seedWwk(db, "ev-noart", [{ text: "About 1,200 staff joined the strike.", sources: src("ev-noart", 0, 1) }]);
  seedEvent(db, "ev-ref");
  seedWwk(db, "ev-ref", [{ text: "About 1,200 staff joined the strike.", sources: src("ev-ref", 0, 1) }], { status: "refused" });

  const { candidates, skipped } = btn.findCandidates(db, { now: NOW });
  assert.deepEqual(candidates, [], JSON.stringify(candidates));
  assert.equal(skipped.year, 1);
  assert.equal(skipped.date, 1);
  assert.equal(skipped["sensitive or casualty fact"], 1);
  assert.equal(skipped["sensitive event"], 1);
  assert.equal(skipped["number not verbatim in two outlets"], 1);
  assert.equal(skipped["event has no articles"], 1);
  const { result } = await captured(() => btn.runByTheNumbers({ db, now: NOW, env: ON }));
  assert.equal(result.status, "none");
  assert.equal(rows(db).length, 0);
});

test("a good candidate → one row today; second run writes nothing; the last two days' event is not repeated", async () => {
  const { db } = makeTestDb();
  seedEvent(db, "ev-big", { outlets: 5 });
  seedWwk(db, "ev-big", [
    { text: "The strike began in 2025.", sources: src("ev-big", 0, 1) },
    { text: "About 1,200 staff joined the strike, the union said.", sources: src("ev-big", 0, 1, 2) },
  ]);
  seedEvent(db, "ev-small", { outlets: 4, desc: "Prices rose 3.5% last year, officials said." });
  seedWwk(db, "ev-small", [{ text: "Prices rose 3.5% last year.", sources: src("ev-small", 2, 3) }]);

  const { result, lines } = await captured(() => btn.runByTheNumbers({ db, now: NOW, env: ON }));
  assert.equal(result.status, "picked");
  assert.equal(result.event_id, "ev-big");   // more outlets in the last 24 h
  const [r] = rows(db);
  assert.equal(r.day, "2026-10-27");
  assert.equal(r.number_text, "1,200");
  assert.equal(r.fact_text, "About 1,200 staff joined the strike, the union said.");
  assert.deepEqual(JSON.parse(r.sources_json).map((s) => s.source_name), ["Outlet 0", "Outlet 1", "Outlet 2"]);
  assert.ok(lines.some((l) => l.startsWith("🧭 btn-pick")));

  const again = btn.runByTheNumbers({ db, now: NOW + HOUR, env: ON });
  assert.equal(again.status, "skip");
  assert.equal(rows(db).length, 1);

  // next day: ev-big was picked yesterday → ev-small
  const next = btn.runByTheNumbers({ db, now: NOW + DAY, env: ON });
  assert.equal(next.event_id, "ev-small");
  assert.equal(rows(db).at(-1).number_text, "3.5%");
  // the day after: both picked within the last two days → nothing
  const third = btn.runByTheNumbers({ db, now: NOW + 2 * DAY, env: ON });
  assert.equal(third.status, "none");
  assert.equal(rows(db).length, 2);
});

test("WWK rows older than 36 h are not candidates", () => {
  const { db } = makeTestDb();
  seedEvent(db, "ev-old");
  seedWwk(db, "ev-old", [{ text: "About 1,200 staff joined the strike.", sources: src("ev-old", 0, 1) }], { generatedAt: NOW - 40 * HOUR });
  assert.equal(btn.findCandidates(db, { now: NOW }).candidates.length, 0);
});

test("listDailyNumbers: ≤ 7 rows newest first with slugs; a row whose event is gone is dropped; dailyNumberFor", () => {
  const { db } = makeTestDb();
  seedEvent(db, "ev-a");
  const ins = db.prepare("INSERT INTO daily_numbers (day, picked_at, event_id, number_text, fact_text, sources_json) VALUES (?,?,?,?,?,?)");
  for (let i = 0; i < 9; i++) ins.run(`2026-10-${String(10 + i).padStart(2, "0")}`, NOW, "ev-a", `${i}`, "F", JSON.stringify([{ source_name: "Outlet 0", url: "u", article_id: "secret" }]));
  ins.run("2026-10-19", NOW, "ev-gone", "9", "F", "[]");
  const list = dao.listDailyNumbers({ db });
  assert.equal(list.length, 7);
  assert.deepEqual(list.map((r) => r.day), ["2026-10-18", "2026-10-17", "2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12"]);
  assert.deepEqual(list[0].event, { slug: "ev-a-slug", title: "Port strike story ev-a" });
  assert.deepEqual(list[0].sources, [{ source_name: "Outlet 0", url: "u" }]);
  assert.ok(list.every((r) => !("event_id" in r) && !("id" in r.event)), "event ids stay internal");
  assert.ok(!JSON.stringify(list).includes("secret"), "article ids stay internal");
  assert.equal(dao.dailyNumberFor("2026-10-19", { db }), null);
  assert.equal(dao.dailyNumberFor("2026-10-18", { db }).number_text, "8");
  assert.deepEqual(dao.listOriginals({ db, now: NOW }).numbers.length, 7);
});

test("GET /api/originals/numbers/today → 404 with no row, 200 with today's row", async () => {
  const express = (await import("express")).default;
  const router = (await import("../../routes/originals.js")).default;
  const app = express();
  app.use("/api/originals", router);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/api/originals/numbers/today`;
  try {
    assert.equal((await fetch(url)).status, 404);
    const db = getDb();
    seedEvent(db, "ev-today");
    db.prepare("INSERT INTO daily_numbers (day, picked_at, event_id, number_text, fact_text, sources_json) VALUES (?,?,?,?,?,?)")
      .run(new Date().toISOString().slice(0, 10), Date.now(), "ev-today", "1,200", "About 1,200 staff joined.", JSON.stringify([{ source_name: "Outlet 0", url: "u" }]));
    const res = await fetch(url);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.number_text, "1,200");
    assert.equal(body.event.slug, "ev-today-slug");
  } finally { server.close(); }
});

test("renderNumberCard → a 1080×1350 PNG (skipped with a reason when card fonts are missing)", async (t) => {
  const { renderNumberCard } = await import("../../services/numberCard.js");
  const { fontsReady } = await import("../../services/renderCore.js");
  if (!fontsReady({ requireAnton: true })) { t.skip("card fonts (Inter + Anton) are not installed here: NOT a pass"); return; }
  const png = await renderNumberCard({ day: "2026-10-27", number_text: "1,200", fact_text: "About 1,200 staff joined the strike, the union said.", sources: [{ source_name: "Outlet 0" }, { source_name: "Outlet 1" }] });
  assert.ok(Buffer.isBuffer(png) || png instanceof Uint8Array);
  const b = Buffer.from(png);
  assert.equal(b.toString("ascii", 12, 16), "IHDR");
  assert.equal(b.readUInt32BE(16), 1080);
  assert.equal(b.readUInt32BE(20), 1350);
});

test("/scoop-ops/originals is mounted under the admin boundary: an unauthenticated request is refused", async () => {
  const serverSrc = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "../../../server.js"), "utf8");
  const boundary = serverSrc.indexOf('app.use("/scoop-ops",      adminRouteLimiter, adminAuth, adminAuditLogger)');
  const mount = serverSrc.indexOf('app.use("/scoop-ops/originals", originalsOpsRouter)');
  assert.ok(boundary > 0 && mount > boundary, "the originals ops router must be mounted after the single /scoop-ops auth boundary");

  // the same chain over real HTTP: boundary middleware, then the router
  const express = (await import("express")).default;
  const { adminAuth } = await import("../../middleware/adminAuth.js");
  const opsRouter = (await import("../../routes/originals-ops.js")).default;
  const prev = process.env.ADMIN_BEARER_TOKEN;
  process.env.ADMIN_BEARER_TOKEN = "test-token";
  const app = express();
  app.use("/scoop-ops", adminAuth);
  app.use("/scoop-ops/originals", opsRouter);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/scoop-ops/originals/numbers`;
  try {
    assert.equal((await fetch(`${base}/2026-10-27.png`)).status, 401);
    assert.equal((await fetch(`${base}/2026-10-27.png`, { headers: { Authorization: "Bearer wrong" } })).status, 401);
    // authorised: no row for that day → 404 (the route itself answers)
    assert.equal((await fetch(`${base}/1999-01-01.png`, { headers: { Authorization: "Bearer test-token" } })).status, 404);
    assert.equal((await fetch(`${base}/not-a-day.png`, { headers: { Authorization: "Bearer test-token" } })).status, 400);
  } finally {
    server.close();
    if (prev === undefined) delete process.env.ADMIN_BEARER_TOKEN; else process.env.ADMIN_BEARER_TOKEN = prev;
  }
});
