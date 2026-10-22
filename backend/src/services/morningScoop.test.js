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

const HOUR = 60 * 60 * 1000;
let outbox;

beforeEach(() => {
  outbox = [];
  delete process.env.SITE_MARKET_ODDS;
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
