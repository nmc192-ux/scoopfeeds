/**
 * #243 — reader eligibility and the promoter's single-source guard.
 *
 * Fixtures for the three shapes DrJ's audit found on the live site, plus two real
 * multi-source stories that must stay visible:
 *   - BLOB   "China offshore yuan bonds": 20 outlets, but every article is about a
 *            different thing (disjoint entity keys) → incoherent → hidden.
 *   - HN     "SpeedCrunch 1.1": 4 outlets but one supplies 90% → hidden;
 *            "SpeedCrunch 1.1 (2)": one outlet only → hidden.
 *   - EARN   "First Western Q3 slides": 12 articles, ONE outlet → hidden.
 *   - ISRAEL "Netanyahu / Israel election": 5 outlets, shared core → visible.
 *   - IPHONE "iPhone Duo": 4 outlets, shared core → visible.
 * entity_idf is left empty, so the shared measure runs unweighted (the documented
 * degrade) — the same set-up as eventCoherence.test.js.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-reader-elig-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = dir;

const { getDb } = await import("../../models/database.js");
const elig = await import("./readerEligibility.js");
const { runEventPromoter } = await import("../intelligence/eventPromoter.js");
const { logger } = await import("../../services/logger.js");
const eventsRouter = (await import("../../routes/events.js")).default;

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const db = getDb();

const insArt = db.prepare(`INSERT INTO articles (id, title, url, source_name, category, published_at, fetched_at) VALUES (?,?,?,?,?,?,?)`);
const insEnt = db.prepare(`INSERT OR IGNORE INTO article_entities (article_id, surface, surface_norm, qid, entity_type, label, created_at) VALUES (?,?,?,?,?,?,?)`);
const insEv = db.prepare(`INSERT INTO events (id, slug, title, category, status, severity, started_at, last_activity_at, meta, created_at, updated_at)
                          VALUES (?,?,?,?,'active',0.5,?,?,?,?,?)`);
const link = db.prepare(`INSERT INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?,?,1.0,?)`);

let artN = 0;
function article(source, keys, when = NOW) {
  const id = `art-${++artN}`;
  insArt.run(id, `Headline ${id}`, `https://x.test/${id}`, source, "world", when, when);
  for (const q of keys) insEnt.run(id, q, q.toLowerCase(), q, "unknown", q, when);
  return id;
}
function event(id, title, members, ageMs = 0) {
  insEv.run(id, id, title, "world", NOW - DAY, NOW - ageMs, "{}", NOW - DAY, NOW - ageMs);
  for (const a of members) link.run(id, a, NOW);
}

// BLOB: 20 outlets, ~10 articles each, each article on its own topic.
const blob = [];
for (let i = 0; i < 200; i++) blob.push(article(`Outlet ${i % 20}`, [`BLOB-${i}-a`, `BLOB-${i}-b`]));
event("china-offshore-yuan-bonds", "China Offshore Yuan Bonds Priced at Record Lows Amid Rally", blob, 1000);

// HN dominated: 4 outlets, Hacker News supplies 18 of 20.
const hn = [];
for (let i = 0; i < 18; i++) hn.push(article("Hacker News", ["SPEEDCRUNCH", `HN-${i}`]));
hn.push(article("Lobsters", ["SPEEDCRUNCH"]), article("Slashdot", ["SPEEDCRUNCH"]));
hn.push(article("The Register", ["SPEEDCRUNCH"]));
event("speedcrunch-1-1", "SpeedCrunch 1.1", hn, 2000);

// HN single outlet.
const hn2 = Array.from({ length: 10 }, (_, i) => article("Hacker News", ["SPEEDCRUNCH", `HN2-${i}`]));
event("speedcrunch-1-1-2", "SpeedCrunch 1.1", hn2, 3000);

// Earnings transcripts: one outlet.
const earn = Array.from({ length: 12 }, (_, i) => article("Investing.com", ["EARNINGS CALL", `COMPANY-${i}`]));
event("first-western-q3-2026-slides", "First Western Q3 2026 slides", earn, 4000);

// Real stories.
const israel = ["Reuters", "AP", "BBC News", "Al Jazeera", "Haaretz"].flatMap((s) =>
  [article(s, ["NETANYAHU", "ISRAEL", "KNESSET ELECTION"]), article(s, ["NETANYAHU", "ISRAEL", "LIKUD"])]);
event("netanyahu-israel-election", "Netanyahu faces Israel election", israel, 5000);
const iphone = ["The Verge", "9to5Mac", "Bloomberg", "CNBC"].flatMap((s) =>
  [article(s, ["APPLE", "IPHONE DUO"]), article(s, ["APPLE", "IPHONE DUO", "FOLDABLE"])]);
event("iphone-duo", "Apple unveils iPhone Duo", iphone, 6000);

const HIDDEN = ["china-offshore-yuan-bonds", "speedcrunch-1-1", "speedcrunch-1-1-2", "first-western-q3-2026-slides"];
const VISIBLE = ["netanyahu-israel-election", "iphone-duo"];

function withFlag(value, fn) {
  const prev = process.env.EVENT_READER_ELIGIBILITY;
  if (value === undefined) delete process.env.EVENT_READER_ELIGIBILITY; else process.env.EVENT_READER_ELIGIBILITY = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.EVENT_READER_ELIGIBILITY; else process.env.EVENT_READER_ELIGIBILITY = prev;
  }
}
const snapshot = () => JSON.stringify([
  db.prepare("SELECT * FROM events ORDER BY id").all(),
  db.prepare("SELECT * FROM event_articles ORDER BY event_id, article_id").all(),
]);

// ── per-event rules ─────────────────────────────────────────────────────────
test("each audited shape is ineligible, for the right reason", () => {
  elig._clearEligibilityCache(db);
  const r = (id) => elig.eventReaderEligibility(db, id, { useCache: false });
  assert.deepEqual(r("china-offshore-yuan-bonds").reasons, ["incoherent"]);
  assert.equal(r("china-offshore-yuan-bonds").sources, 20);
  assert.deepEqual(r("speedcrunch-1-1").reasons, ["one_source_dominates"]);
  assert.equal(r("speedcrunch-1-1").topSource, "Hacker News");
  assert.deepEqual(r("speedcrunch-1-1-2").reasons, ["too_few_sources", "one_source_dominates"]);
  assert.deepEqual(r("first-western-q3-2026-slides").reasons, ["too_few_sources", "one_source_dominates"]);
});

test("real multi-source stories stay eligible", () => {
  for (const id of VISIBLE) {
    const e = elig.eventReaderEligibility(db, id, { useCache: false });
    assert.equal(e.eligible, true, `${id}: ${JSON.stringify(e)}`);
    assert.ok(e.coherence >= e.floor);
  }
});

test("SQL source rules agree with the JS rules", () => {
  const rows = db.prepare(`SELECT e.id FROM events e WHERE ${elig.sourceEligibleSql("e")} ORDER BY e.id`).all().map((r) => r.id);
  // The blob passes the SOURCE rules (20 outlets, none dominant); coherence is the JS rule.
  assert.deepEqual(rows, ["china-offshore-yuan-bonds", "iphone-duo", "netanyahu-israel-election"]);
});

test("unmeasured coherence does not hide an event that passes the source rules", () => {
  const ids = ["Wire A", "Wire B", "Wire C"].map((s) => article(s, []));
  event("no-entities-yet", "Fresh story, entities not extracted yet", ids, 7000);
  const e = elig.eventReaderEligibility(db, "no-entities-yet", { useCache: false });
  assert.equal(e.coherence, null);
  assert.equal(e.eligible, true);
  db.prepare("DELETE FROM event_articles WHERE event_id = 'no-entities-yet'").run();
  db.prepare("DELETE FROM events WHERE id = 'no-entities-yet'").run();
});

test("machine events are exempt (they carry no articles by design)", () => {
  insEv.run("quake-1", "usgs-quake-1", "M6 quake", "geo", NOW - DAY, NOW, JSON.stringify({ source: "usgs" }), NOW - DAY, NOW);
  assert.equal(elig.isReaderEligible(db, "quake-1", { useCache: false }), true);
  const n = db.prepare(`SELECT COUNT(*) n FROM events e WHERE e.id = 'quake-1' AND ${elig.sourceEligibleSql("e")}`).get().n;
  assert.equal(n, 1);
  db.prepare("DELETE FROM events WHERE id = 'quake-1'").run();
});

test("flag off: everything eligible, SQL predicate is a no-op", () => {
  withFlag("false", () => {
    assert.equal(elig.readerEligibilityOn(), false);
    assert.equal(elig.sourceEligibleSql("e"), "1=1");
    for (const id of HIDDEN) assert.equal(elig.isReaderEligible(db, id), true);
  });
  withFlag(undefined, () => assert.equal(elig.readerEligibilityOn(), true, "default is ON"));
});

// ── the reader list ─────────────────────────────────────────────────────────
async function withServer(fn) {
  const app = express();
  app.use("/api/ri/events", eventsRouter);
  const server = app.listen(0);
  const { port } = server.address();
  try { return await fn(async (p) => (await fetch(`http://127.0.0.1:${port}/api/ri/events${p}`)).json()); }
  finally { server.close(); }
}

test("/api/ri/events (recency, prominence, world map) shows none of the audited events; no row changes", async () => {
  elig._clearEligibilityCache(db);
  const before = snapshot();
  await withServer(async (get) => {
    for (const q of ["?limit=50", "?sort=prominence&limit=50", "?sort=prominence&limit=1"]) {
      const slugs = (await get(q)).events.map((e) => e.slug);
      for (const h of HIDDEN) assert.ok(!slugs.includes(h), `${q} leaked ${h}`);
      if (q.endsWith("limit=50")) for (const v of VISIBLE) assert.ok(slugs.includes(v), `${q} lost ${v}`);
    }
    // limit=1 still returns a full page: over-fetch skips the hidden blob instead of returning nothing.
    assert.equal((await get("?limit=1")).events.length, 1);
  });
  assert.equal(snapshot(), before, "no stored event or link was modified");
});

test("/api/ri/events with the flag off is today's list (hidden events come back)", async () => {
  await withServer(async (get) => {
    const prev = process.env.EVENT_READER_ELIGIBILITY;
    process.env.EVENT_READER_ELIGIBILITY = "false";
    try {
      const slugs = (await get("?limit=50")).events.map((e) => e.slug);
      for (const h of HIDDEN) assert.ok(slugs.includes(h));
    } finally {
      if (prev === undefined) delete process.env.EVENT_READER_ELIGIBILITY; else process.env.EVENT_READER_ELIGIBILITY = prev;
    }
  });
});

// ── promoter: single-source guard ───────────────────────────────────────────
function cluster(id, articleIds) {
  db.prepare(`INSERT INTO story_clusters (id, title, summary, category, keywords, article_ids, article_count, created_at, updated_at, expires_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, `Cluster ${id}`, null, "world", "[]", JSON.stringify(articleIds), articleIds.length, NOW, NOW, NOW + 3600e3);
}
async function runCaptured(guard) {
  const prev = process.env.PROMOTER_SINGLE_SOURCE_GUARD;
  if (guard === undefined) delete process.env.PROMOTER_SINGLE_SOURCE_GUARD; else process.env.PROMOTER_SINGLE_SOURCE_GUARD = guard;
  const lines = [];
  const orig = logger.info;
  logger.info = (msg, ...rest) => { if (typeof msg === "string" && msg.startsWith("🧭")) lines.push(msg); return orig.call(logger, msg, ...rest); };
  db.exec("SAVEPOINT ss");
  try {
    const stats = await runEventPromoter({ now: NOW, _yielder: async () => true });
    const slugs = db.prepare("SELECT slug FROM events WHERE cluster_id IS NOT NULL").all().map((r) => r.slug);
    const hnLinks = db.prepare("SELECT COUNT(*) n FROM event_articles WHERE event_id = 'speedcrunch-1-1-2'").get().n;
    return { stats, lines, slugs, hnLinks };
  } finally {
    db.exec("ROLLBACK TO ss"); db.exec("RELEASE ss");
    logger.info = orig;
    if (prev === undefined) delete process.env.PROMOTER_SINGLE_SOURCE_GUARD; else process.env.PROMOTER_SINGLE_SOURCE_GUARD = prev;
  }
}

// A one-outlet cluster with no existing event to join (create path)...
const solo = Array.from({ length: 6 }, (_, i) => article("Investing.com", ["SOLO-CO", "TRANSCRIPT", `S-${i}`]));
cluster("cl-solo", solo);
// ...a one-outlet cluster that shares an article with the one-outlet HN event (grow path)...
const hnMore = Array.from({ length: 5 }, (_, i) => article("Hacker News", ["SPEEDCRUNCH", `HN2-${i}`]));
cluster("cl-hn-more", [hn2[0], ...hnMore]);
// ...and a real multi-outlet cluster, which must still be created.
const multi = ["Reuters", "AP", "AFP", "BBC News", "DW", "NPR"].map((s) => article(s, ["MULTI-STORY", "SUMMIT"]));
cluster("cl-multi", multi);

test("promoter refuses to create or grow a single-source event, with a 🧭 line; multi-source still creates", async () => {
  const r = await runCaptured(undefined);
  const refusals = r.lines.filter((l) => l.startsWith("🧭 promoter-refuse-single-source "));
  const paths = refusals.map((l) => JSON.parse(l.slice("🧭 promoter-refuse-single-source ".length)));
  assert.ok(paths.some((p) => p.path === "create" && p.cluster === "cl-solo" && p.outlet === "Investing.com"), JSON.stringify(paths));
  assert.ok(paths.some((p) => ["match", "absorb", "adopt"].includes(p.path) && p.cluster === "cl-hn-more"), JSON.stringify(paths));
  assert.equal(r.stats.refusedSingleSource, refusals.length);
  assert.ok(!r.slugs.some((s) => s.startsWith("cluster-cl-solo")), "no event minted from one outlet");
  assert.equal(r.hnLinks, hn2.length, "the one-outlet event did not grow");
  assert.ok(r.lines.some((l) => l.startsWith("🧭 promoter-create ") && l.includes('"cluster":"cl-multi"')), "multi-outlet cluster still creates");
});

test("guard off: the single-source cluster is created as before, no refuse lines, no stats key", async () => {
  const r = await runCaptured("false");
  assert.equal(r.lines.filter((l) => l.includes("promoter-refuse-single-source")).length, 0);
  assert.equal(r.stats.refusedSingleSource, undefined);
  assert.ok(r.lines.some((l) => l.startsWith("🧭 promoter-create ") && l.includes('"cluster":"cl-solo"')));
});

test("existing 🧭 decision lines are unchanged by the guard apart from the refusals", async () => {
  const on = await runCaptured(undefined);
  const off = await runCaptured("false");
  const keep = (lines, refusedClusters) => lines.filter((l) => !l.includes("promoter-refuse-single-source")
    && !refusedClusters.some((c) => l.includes(`"cluster":"${c}"`)));
  const refused = on.lines.filter((l) => l.includes("promoter-refuse-single-source")).map((l) => JSON.parse(l.slice(l.indexOf("{"))).cluster);
  assert.deepEqual(keep(on.lines, refused), keep(off.lines, refused));
});
