/**
 * The Morning Scoop (#172): edition assignment, one send per subscriber per day
 * across both crons, the once-only confirmation reminder, and no Reality Index
 * block while SITE_MARKET_ODDS is off. Real temp DB, fake mail transport.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeTestDb } from "../testing/testDb.js";
import { setTransportForTests } from "./mailer.js";
import { editionForCountry, sendDailyDigest, buildDigestPreview } from "./digest.js";
import { runConfirmReminderCycle } from "./confirmReminder.js";
import fs from "node:fs";
import { seedV1Articles } from "../testing/morningScoopFixture.js";

const HOUR = 60 * 60 * 1000;
let outbox;

beforeEach(() => {
  outbox = [];
  delete process.env.SITE_MARKET_ODDS;
  delete process.env.MORNING_SCOOP_V2;
  setTransportForTests({ sendMail: async (m) => { outbox.push(m); return {}; } });
});

function seed(db) {
  const now = Date.now();
  db.prepare(`INSERT INTO articles (id, title, url, source_name, category, published_at, fetched_at, credibility)
              VALUES ('a1', 'Lead story headline', 'https://example.test/a1', 'Test', 'world', ?, ?, 0.9)`)
    .run(now - HOUR, now);
}

function addSub(db, email, country, { verified = true, createdAgo = 0, lastSentAgo = null, unsub = false } = {}) {
  const now = Date.now();
  db.prepare(`INSERT INTO subscribers (email, country_code, token, verified_at, unsubscribed_at, created_at, last_sent_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(email, country, `tok-${email}`, verified ? now - createdAgo : null, unsub ? now : null,
      now - createdAgo, lastSentAgo == null ? null : now - lastSentAgo);
}

test("edition assignment: Americas vs everyone else, unknown goes to rest", () => {
  for (const c of ["US", "us", " CA ", "BR", "MX", "AR", "JM"]) assert.equal(editionForCountry(c), "americas", c);
  for (const c of ["GB", "DE", "IN", "PK", "AU", "ZA", "", null, undefined, "XX", "USA"]) assert.equal(editionForCountry(c), "rest", String(c));
});

test("each edition mails only its own subscribers", async () => {
  const { db } = makeTestDb();
  seed(db);
  addSub(db, "ny@x.test", "US");
  addSub(db, "lon@x.test", "GB");
  addSub(db, "nowhere@x.test", null);

  await sendDailyDigest({ edition: "americas", db });
  assert.deepEqual(outbox.map((m) => m.to), ["ny@x.test"]);

  outbox.length = 0;
  await sendDailyDigest({ edition: "rest", db });
  assert.deepEqual(outbox.map((m) => m.to).sort(), ["lon@x.test", "nowhere@x.test"]);
});

test("one send per subscriber per day across both crons and re-runs", async () => {
  const { db } = makeTestDb();
  seed(db);
  addSub(db, "ny@x.test", "US");
  addSub(db, "lon@x.test", "GB");

  await sendDailyDigest({ edition: "rest", db });
  await sendDailyDigest({ edition: "americas", db });
  // Re-runs of either cron, and an unscoped manual run, add nothing.
  await sendDailyDigest({ edition: "rest", db });
  await sendDailyDigest({ edition: "americas", db });
  await sendDailyDigest({ db });
  assert.deepEqual(outbox.map((m) => m.to).sort(), ["lon@x.test", "ny@x.test"]);

  // A subscriber mailed more than 20h ago (yesterday's edition) is due again.
  outbox.length = 0;
  db.prepare("UPDATE subscribers SET last_sent_at = ?").run(Date.now() - 24 * HOUR);
  await sendDailyDigest({ db });
  assert.equal(outbox.length, 2);
});

test("unverified and unsubscribed subscribers get nothing", async () => {
  const { db } = makeTestDb();
  seed(db);
  addSub(db, "unverified@x.test", "US", { verified: false });
  addSub(db, "gone@x.test", "US", { unsub: true });
  await sendDailyDigest({ db });
  assert.equal(outbox.length, 0);
});

test("subject is prefixed with the lead story", async () => {
  const { db } = makeTestDb();
  seed(db);
  addSub(db, "ny@x.test", "US");
  await sendDailyDigest({ edition: "americas", db });
  assert.equal(outbox[0].subject, "The Morning Scoop — Lead story headline");
  assert.match(outbox[0].html, /The Morning Scoop/);
});

test("no Reality Index block with SITE_MARKET_ODDS off; the block is not even built", async () => {
  const { db } = makeTestDb();
  seed(db);
  addSub(db, "ny@x.test", "US");
  await sendDailyDigest({ edition: "americas", db });
  assert.doesNotMatch(outbox[0].html, /Reality Index|Truth Gap/i);
  assert.doesNotMatch(outbox[0].text, /Reality Index|Truth Gap/i);
  const preview = buildDigestPreview({ db });
  assert.doesNotMatch(preview.html, /Reality Index|Truth Gap/i);
});

test("preview needs no subscribers and touches no subscriber row", () => {
  const { db } = makeTestDb();
  seed(db);
  addSub(db, "ny@x.test", "US");
  const before = db.prepare("SELECT * FROM subscribers").all();
  const preview = buildDigestPreview({ db });
  assert.match(preview.subject, /^The Morning Scoop — Lead story headline/);
  assert.deepEqual(db.prepare("SELECT * FROM subscribers").all(), before);
  assert.equal(outbox.length, 0);
});

test("preview is null when there is nothing to send", () => {
  const { db } = makeTestDb();
  assert.equal(buildDigestPreview({ db }), null);
});

test("confirmation reminder: sent once, 48h after sign-up, to unverified only", async () => {
  const { db } = makeTestDb();
  addSub(db, "fresh@x.test", "US", { verified: false, createdAgo: 10 * HOUR });
  addSub(db, "due@x.test", "US", { verified: false, createdAgo: 50 * HOUR });
  addSub(db, "stale@x.test", "US", { verified: false, createdAgo: 30 * 24 * HOUR });
  addSub(db, "confirmed@x.test", "US", { verified: true, createdAgo: 50 * HOUR });
  addSub(db, "gone@x.test", "US", { verified: false, createdAgo: 50 * HOUR, unsub: true });

  const first = await runConfirmReminderCycle({ db });
  assert.equal(first.sent, 1);
  assert.deepEqual(outbox.map((m) => m.to), ["due@x.test"]);
  assert.match(outbox[0].html, /\/api\/newsletter\/confirm\?token=tok-due@x\.test/);

  // Never twice — not on the next run, not a day later.
  await runConfirmReminderCycle({ db });
  await runConfirmReminderCycle({ db, now: Date.now() + 24 * HOUR });
  assert.equal(outbox.length, 1);
});

test("a failed reminder send is not marked sent, so the next cycle retries", async () => {
  const { db } = makeTestDb();
  addSub(db, "due@x.test", "US", { verified: false, createdAgo: 50 * HOUR });
  setTransportForTests({ sendMail: async () => { throw new Error("smtp down"); } });
  assert.equal((await runConfirmReminderCycle({ db })).sent, 0);
  setTransportForTests({ sendMail: async (m) => { outbox.push(m); return {}; } });
  assert.equal((await runConfirmReminderCycle({ db })).sent, 1);
});

// ── #263 Morning Scoop v2 ────────────────────────────────────────────────────

// Captured from the pre-#263 digest.js with the default site URL. A machine whose env sets
// PRIMARY_SITE_URL renders that host instead, so the golden is re-pointed to match.
const SITE = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");
const GOLDEN = JSON.parse(fs.readFileSync(new URL("./morningScoop.v1.golden.json", import.meta.url), "utf8")
  .replaceAll("https://scoopfeeds.com", SITE));

function v1Fixture() {
  const { db } = makeTestDb();
  const now = Date.now();
  seedV1Articles(db, now);
  db.prepare(`INSERT INTO subscribers (email, country_code, token, verified_at, created_at, topics) VALUES ('g@x.test','GB','tok-g',?,?,NULL)`).run(now, now);
  return db;
}

test("v2 flag off: preview and email are byte-identical to the pre-#263 output", async () => {
  for (const flag of [undefined, "0", "true", "yes"]) {
    if (flag === undefined) delete process.env.MORNING_SCOOP_V2; else process.env.MORNING_SCOOP_V2 = flag;
    outbox.length = 0;
    const db = v1Fixture();
    assert.deepEqual(buildDigestPreview({ db }), GOLDEN.preview, `preview, flag=${flag}`);
    await sendDailyDigest({ db, edition: "rest" });
    const m = outbox[0];
    assert.deepEqual({ subject: m.subject, html: m.html, text: m.text }, GOLDEN.email, `email, flag=${flag}`);
  }
});

let evN = 0;
function seedEvent(db, { title, category = "world", outlets = ["Reuters", "AP", "BBC News"], perOutlet = 1, machine = false, startedAgo = 3 * 24 * HOUR, activeAgo = HOUR, articleAgo = HOUR, headline = null } = {}) {
  const now = Date.now();
  const id = `ev-${++evN}`;
  db.prepare(`INSERT INTO events (id, slug, title, category, status, severity, started_at, last_activity_at, meta, created_at, updated_at)
              VALUES (?,?,?,?,'active',0.5,?,?,?,?,?)`)
    .run(id, `${id}-slug`, title, category, now - startedAgo, now - activeAgo, machine ? JSON.stringify({ source: "usgs" }) : "{}", now - startedAgo, now - activeAgo);
  let k = 0;
  for (const o of outlets) for (let i = 0; i < perOutlet; i++) {
    const aid = `${id}-a${++k}`;
    db.prepare(`INSERT INTO articles (id, title, url, source_name, category, published_at, fetched_at) VALUES (?,?,?,?,?,?,?)`)
      .run(aid, k === 1 && headline ? headline : `${title} report ${k}`, `https://x.test/${aid}`, o, category, now - articleAgo - k * 1000, now);
    db.prepare(`INSERT INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?,?,1.0,?)`).run(id, aid, now);
  }
  return id;
}

function v2Fixture() {
  const { db } = makeTestDb();
  const six = ["Reuters", "AP", "BBC News", "Al Jazeera", "CNN", "Guardian"];
  const ids = {
    big:    seedEvent(db, { title: "Big world story", outlets: six, perOutlet: 2, headline: "Newest big headline" }),
    tech:   seedEvent(db, { title: "Chip export rules", category: "tech", outlets: six.slice(0, 5) }),
    biz:    seedEvent(db, { title: "Central bank decision", category: "business", outlets: six.slice(0, 4), startedAgo: 2 * HOUR }),
    world2: seedEvent(db, { title: "Ceasefire talks", outlets: six.slice(0, 4) }),
    machine: seedEvent(db, { title: "M 6.1 earthquake", outlets: six, perOutlet: 3, machine: true }),
    single: seedEvent(db, { title: "One outlet earnings", outlets: ["Investing.com"], perOutlet: 12 }),
    sports: seedEvent(db, { title: "Cup final result", category: "sports", outlets: six.slice(0, 3), activeAgo: 3 * HOUR }),
  };
  // Lower than everything above, so it misses the top 6 only if those fill it; here it is #6.
  ids.health = seedEvent(db, { title: "Vaccine trial results", category: "health", outlets: ["Reuters", "AP", "BBC News"], activeAgo: 20 * HOUR });
  // Below the top 6: a seventh eligible tech story, only reachable through "Your topics".
  ids.tech2 = seedEvent(db, { title: "Small tech story", category: "tech", outlets: ["Reuters", "AP", "BBC News"], activeAgo: 23 * HOUR });
  return { db, ids };
}

function addTopicsSub(db, email, country, topics) {
  const now = Date.now();
  db.prepare(`INSERT INTO subscribers (email, country_code, token, verified_at, created_at, topics) VALUES (?,?,?,?,?,?)`)
    .run(email, country, `tok-${email}`, now, now, topics ? JSON.stringify(topics) : null);
}

test("v2 on: top stories are events; machine and single-source events never appear; links carry slug + UTM", async () => {
  process.env.MORNING_SCOOP_V2 = "1";
  const { db, ids } = v2Fixture();
  addTopicsSub(db, "ny@x.test", "US", null);
  await sendDailyDigest({ db, edition: "americas" });
  const m = outbox[0];
  assert.equal(m.subject, "The Morning Scoop — Big world story");
  assert.match(m.html, /Top stories/);
  assert.ok(m.html.includes(`/events/${ids.big}-slug?utm_source=morning-scoop&amp;utm_medium=email&amp;utm_campaign=americas`));
  assert.ok(m.text.includes(`/events/${ids.big}-slug?utm_source=morning-scoop&utm_medium=email&utm_campaign=americas`));
  assert.match(m.html, /6 outlets · 12 articles in the last 24 hours/);
  assert.match(m.html, /Latest:<\/span> Newest big headline/);
  assert.doesNotMatch(m.html, /earthquake/i);
  assert.doesNotMatch(m.html, /One outlet earnings/);
  assert.doesNotMatch(m.html, /Small tech story/); // 7th: not in the top 6
  assert.match(m.html, /Developing/);              // biz began 2 h ago
  assert.match(m.html, /That&#39;s the morning\. — the Intern, ScoopFeeds/);
  assert.match(m.text, /That's the morning\. — the Intern, ScoopFeeds/);
  assert.doesNotMatch(m.html, /Your topics/);      // no topics → no block, no heading
  assert.doesNotMatch(m.text, /YOUR TOPICS/);
  assert.doesNotMatch(m.html, /What we know|Reality Index/i);
});

test("v2 on: a subscriber with topics gets a 'Your topics' block, no duplicates of Top stories", async () => {
  process.env.MORNING_SCOOP_V2 = "1";
  const { db } = v2Fixture();
  addTopicsSub(db, "lon@x.test", "GB", ["tech"]);
  addTopicsSub(db, "none@x.test", "GB", ["weather"]); // picked topics, nothing matches → no block
  await sendDailyDigest({ db, edition: "rest" });
  const lon = outbox.find((m) => m.to === "lon@x.test");
  const none = outbox.find((m) => m.to === "none@x.test");
  assert.match(lon.html, /Your topics/);
  const yours = lon.html.split("Your topics")[1];
  assert.match(yours, /Small tech story/);
  assert.doesNotMatch(yours, /Chip export rules/); // already in Top stories
  assert.equal((lon.html.match(/>Chip export rules<\/a>/g) || []).length, 1);
  assert.match(lon.html, /utm_campaign=rest/);
  assert.doesNotMatch(none.html, /Your topics/);
});

test("v2 on: fewer than 3 eligible events falls back to the article list", async () => {
  process.env.MORNING_SCOOP_V2 = "1";
  const { db } = makeTestDb();
  seed(db);
  seedEvent(db, { title: "Only eligible story" });
  seedEvent(db, { title: "Quake", machine: true, outlets: ["Reuters", "AP", "BBC News", "CNN"] });
  addSub(db, "ny@x.test", "US");
  await sendDailyDigest({ db, edition: "americas" });
  assert.doesNotMatch(outbox[0].html, /utm_source=morning-scoop|Only eligible story<\/a>/);
  assert.match(outbox[0].html, /Lead story headline/); // the v1 article list
});

test("v2 on: editions, once-per-day and skips still hold", async () => {
  process.env.MORNING_SCOOP_V2 = "1";
  const { db } = v2Fixture();
  addSub(db, "ny@x.test", "US");
  addSub(db, "lon@x.test", "GB");
  addSub(db, "unverified@x.test", "US", { verified: false });
  addSub(db, "gone@x.test", "GB", { unsub: true });
  await sendDailyDigest({ db, edition: "americas" });
  assert.deepEqual(outbox.map((m) => m.to), ["ny@x.test"]);
  await sendDailyDigest({ db, edition: "rest" });
  await sendDailyDigest({ db, edition: "rest" });
  await sendDailyDigest({ db });
  assert.deepEqual(outbox.map((m) => m.to), ["ny@x.test", "lon@x.test"]);
});

test("v2 preview: ?v2=1 shows v2 with the flag off, touches no subscriber; topics add the block", () => {
  const { db } = v2Fixture();
  addSub(db, "ny@x.test", "US");
  const before = db.prepare("SELECT * FROM subscribers").all();
  const p = buildDigestPreview({ db, v2: true, edition: "americas", topics: ["tech"] });
  assert.equal(p.v2, true);
  assert.match(p.html, /Top stories/);
  assert.match(p.html, /Your topics/);
  assert.match(p.html, /utm_campaign=americas/);
  assert.equal(buildDigestPreview({ db }).v2, undefined); // flag off, no override → v1
  assert.deepEqual(db.prepare("SELECT * FROM subscribers").all(), before);
});
