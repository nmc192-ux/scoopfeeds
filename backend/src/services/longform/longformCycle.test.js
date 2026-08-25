/**
 * longformCycle.test.js — the gates and the record-keeping (#80).
 *
 * Uses makeTestDb() (never runMigrations() directly — that throws on an
 * unseeded DB by design) so the real bootstrap order applies, which is also
 * what proves migration 030 is registered.
 *
 * The behaviours that matter, each of which has cost this project something:
 *   1. the kill switch actually kills
 *   2. the rate window is ROLLING — a calendar window lets a quiet week burst
 *   3. quota is preflighted BEFORE the expensive work
 *   4. long-form yields to the shorts loop
 *   5. the claim is atomic, so a crashed run cannot publish a second copy
 *   6. one failure leaves the topic selectable, two retire it
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeTestDb } from "../../testing/testDb.js";
import {
  isLongformAutopostEnabled, rateGate, quotaGate, contentionGate, preflight,
  claimEvent, recentPublishTimes, filmedEventIds, recordFailure, recordPublished,
  getLongformHealth, minIntervalMs, WEEK_MS, BUNDLE_UNITS, MAX_PER_WEEK,
} from "./longformCycle.js";

const NOW = 1_790_000_000_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const withEnv = (vars, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
};
const on = (extra = {}) => ({ LONGFORM_AUTOPOST_ENABLED: "1", ...extra });

// ── Kill switch ─────────────────────────────────────────────────────────────

test("the kill switch is literal 1 and nothing runs without it", () => {
  withEnv({ LONGFORM_AUTOPOST_ENABLED: undefined }, () => {
    assert.equal(isLongformAutopostEnabled(), false);
    assert.deepEqual(preflight({ now: NOW }), { skipped: "disabled", reason: "LONGFORM_AUTOPOST_ENABLED != 1" });
  });
  for (const bad of ["true", "yes", "0", ""]) {
    withEnv({ LONGFORM_AUTOPOST_ENABLED: bad }, () => {
      assert.equal(isLongformAutopostEnabled(), false, `"${bad}" must not enable the loop`);
    });
  }
});

// ── Rate: ROLLING, not calendar ─────────────────────────────────────────────

test("THE WINDOW IS ROLLING — three films six days ago still block today", () => {
  // A calendar week would reset on Monday and let a quiet week burst. This is
  // the test a calendar implementation fails.
  withEnv(on({ LONGFORM_MAX_PER_WEEK: "3" }), () => {
    const recent = [NOW - 6 * DAY, NOW - 6 * DAY - HOUR, NOW - 6 * DAY - 2 * HOUR];
    assert.match(rateGate({ recentPublishedAt: recent, now: NOW }), /3 film\(s\) in the last 7 days/);
    // …and stop blocking once they age out.
    assert.equal(rateGate({ recentPublishedAt: recent.map((t) => t - 2 * DAY), now: NOW }), null);
  });
});

test("spacing has slack, so a failure costs time rather than a film", () => {
  withEnv(on({ LONGFORM_MAX_PER_WEEK: "3" }), () => {
    // 7 days / 3 * 0.8 = ~44.8h between films: more slots than films.
    assert.ok(minIntervalMs() < WEEK_MS / MAX_PER_WEEK(), "the 0.8 slack must yield extra slots");
    assert.match(rateGate({ recentPublishedAt: [NOW - HOUR], now: NOW }), /need \d+h spacing/);
    assert.equal(rateGate({ recentPublishedAt: [NOW - 3 * DAY], now: NOW }), null);
  });
});

test("MAX_PER_WEEK of 0 pauses the channel without unsetting the flag", () => {
  withEnv(on({ LONGFORM_MAX_PER_WEEK: "0" }), () => {
    assert.match(rateGate({ recentPublishedAt: [], now: NOW }), /is 0 — the channel is paused/);
  });
});

// ── Quota ───────────────────────────────────────────────────────────────────

test("quota is preflighted, and refuses BEFORE the expensive work", () => {
  const tight = quotaGate({ unitsUsedToday: 15000, dailyCeiling: 20000 });
  assert.equal(tight.ok, false);
  assert.match(tight.reason, new RegExp(`only 5000 quota units left today, a bundle needs ${BUNDLE_UNITS}`));
  assert.equal(quotaGate({ unitsUsedToday: 5000, dailyCeiling: 30000 }).ok, true);
});

test("an UNKNOWN ceiling does not block, but an unmeasurable usage does", () => {
  // An unknown ceiling is not evidence of exhaustion — blocking on it would
  // stop the loop forever. Unmeasurable USAGE against a known ceiling is a
  // different thing: that is a failed check, and unmeasured is not a pass.
  const unknown = quotaGate({ unitsUsedToday: null, dailyCeiling: null });
  assert.equal(unknown.ok, true);
  assert.match(unknown.note, /ceiling unknown/);
  assert.equal(quotaGate({ unitsUsedToday: null, dailyCeiling: 20000 }).ok, false);
});

// ── Contention ──────────────────────────────────────────────────────────────

test("long-form yields to a running shorts cycle", () => {
  assert.match(contentionGate({ shortsCycleActive: true }), /yields to the proven channel/);
  assert.equal(contentionGate({ shortsCycleActive: false }), null);
});

test("preflight refuses in cost order — contention before rate before quota", () => {
  withEnv(on({ LONGFORM_MAX_PER_WEEK: "3" }), () => {
    const all = { recentPublishedAt: [NOW, NOW, NOW], shortsCycleActive: true,
                  unitsUsedToday: 19999, dailyCeiling: 20000, now: NOW };
    assert.equal(preflight(all).skipped, "contention", "the cheapest refusal wins");
    assert.equal(preflight({ ...all, shortsCycleActive: false }).skipped, "rate");
    assert.equal(preflight({ ...all, shortsCycleActive: false, recentPublishedAt: [] }).skipped, "quota");
    assert.equal(preflight({ ...all, shortsCycleActive: false, recentPublishedAt: [],
                             unitsUsedToday: 0 }), null, "all clear proceeds");
  });
});

// ── Record keeping (real DB via makeTestDb) ─────────────────────────────────

test("migration 030 applies through the real bootstrap order", () => {
  const { db } = makeTestDb();
  const cols = db.prepare("PRAGMA table_info(longform_posts)").all().map((c) => c.name);
  for (const c of ["event_id", "status", "attempts", "youtube_id", "published_at"]) {
    assert.ok(cols.includes(c), `longform_posts must have ${c}`);
  }
});

test("THE CLAIM IS ATOMIC — a second run cannot film the same event", () => {
  // The re-entry guard. A crash between upload and insert would otherwise
  // orphan a published film and the next cycle would film it again; for
  // long-form that is a second subscriber notification that cannot be recalled.
  const { db } = makeTestDb();
  const ev = { eventId: "e1", slug: "strait", title: "T", now: NOW };
  assert.equal(claimEvent(db, ev), true, "first run claims it");
  assert.equal(claimEvent(db, { ...ev, slug: "other" }), false, "second run loses and must skip");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM longform_posts").get().n, 1);
});

test("a claimed row is excluded from selection immediately, before publishing", () => {
  const { db } = makeTestDb();
  claimEvent(db, { eventId: "e1", slug: "s", now: NOW });
  assert.ok(filmedEventIds(db).has("e1"), "an in-flight film must not be re-selected");
});

test("ONE failure leaves the topic selectable; TWO retire it", () => {
  const { db } = makeTestDb();
  claimEvent(db, { eventId: "e1", slug: "s", now: NOW });

  const first = recordFailure(db, { eventId: "e1", stage: "render", error: "ffmpeg died", now: NOW });
  assert.equal(first.status, "retry");
  assert.ok(!filmedEventIds(db).has("e1"), "after one failure the story is selectable again");

  const second = recordFailure(db, { eventId: "e1", stage: "render", error: "again", now: NOW });
  assert.equal(second.status, "failed");
  assert.equal(second.attempts, 2);
  assert.ok(!filmedEventIds(db).has("e1"), "a retired row does not block, it just stops being retried");
});

test("the rate gate counts PUBLISHED films, not claimed ones", () => {
  // A run of failures must not pause the channel — that would turn one bad
  // week into a silent outage.
  const { db } = makeTestDb();
  for (const id of ["a", "b", "c"]) claimEvent(db, { eventId: id, slug: id, now: NOW });
  assert.deepEqual(recentPublishTimes(db, { now: NOW }), [], "claimed-but-unpublished consumes no slot");

  recordPublished(db, { eventId: "a", youtubeId: "yt1", privacyStatus: "private",
                        publishAt: NOW + DAY, shorts: [{ id: "s1" }], qc: { pass: true }, now: NOW });
  assert.deepEqual(recentPublishTimes(db, { now: NOW }), [NOW]);
});

test("a published row records what was actually accepted", () => {
  const { db } = makeTestDb();
  claimEvent(db, { eventId: "e1", slug: "s", now: NOW });
  recordPublished(db, { eventId: "e1", youtubeId: "abc123", privacyStatus: "private",
                        publishAt: NOW + DAY, shorts: [{ id: "s1" }, { id: "s2" }],
                        qc: { pass: true }, now: NOW });
  const row = db.prepare("SELECT * FROM longform_posts WHERE event_id='e1'").get();
  assert.equal(row.status, "published");
  assert.equal(row.youtube_id, "abc123");
  assert.equal(row.privacy_status, "private", "uploads go up PRIVATE with a publishAt");
  assert.equal(JSON.parse(row.shorts_json).length, 2);
  assert.equal(JSON.parse(row.qc_json).pass, true, "the verdict is kept as the record");
});

test("health makes a not-running loop visibly not-running", () => {
  withEnv(on({ LONGFORM_MAX_PER_WEEK: "3" }), () => {
    const { db } = makeTestDb();
    const empty = getLongformHealth(db, { now: NOW });
    assert.equal(empty.enabled, true);
    assert.equal(empty.publishedLast7d, 0);
    assert.equal(empty.lastPublishedAt, null);
    assert.equal(empty.hoursSinceLastPublish, null, "never-published is null, not 0");

    claimEvent(db, { eventId: "e1", slug: "s", now: NOW });
    recordPublished(db, { eventId: "e1", youtubeId: "y", now: NOW - 2 * DAY });
    const h = getLongformHealth(db, { now: NOW });
    assert.equal(h.publishedLast7d, 1);
    assert.equal(h.hoursSinceLastPublish, 48);
    assert.equal(h.maxPerWeek, 3);
  });
});
