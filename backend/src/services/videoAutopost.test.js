/**
 * videoAutopost.test.js — the loop's gates and the stale-pending rule.
 *
 * DB-backed. See the fixture note below for why makeTestDb is unavailable on
 * this branch and what stands in for it.
 *
 * The two things most worth pinning: an upload failure must NOT permanently
 * retire an article (the 5-day IG outage retired ~23 events/day under an
 * any-row rule), and the two rate gates must be independent — a cap that only
 * counts and a spacing rule that only spaces, so a failure costs time rather
 * than a video.
 */

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// CLAUDE.md says to build a test DB through makeTestDb() from
// src/testing/testDb.js. That file does NOT exist on this branch: it landed in
// 9d6c3e4 on j-loop/issue-1-schema-bootstrap-order, which is not merged to
// main, and it depends on bootstrapSchema() which is also absent here. It is
// the same gap that leaves 64 skills/scoring tests failing on this branch.
//
// So the fixture reproduces its INTENT with what exists. runMigrations() alone
// on an empty DB dies at 011 ("no such table: event_articles") because that
// migration assumes initRealityIndex has run — verified, not assumed. The way
// through, without calling runMigrations directly:
//   1. pre-mark migrations 001-021 as applied, so none of them execute
//   2. let getDb() run initializeSchema (idempotent CREATE TABLE IF NOT EXISTS),
//      which owns `articles`
//   3. leave 022 unapplied so it is the only migration that actually runs
// 022 creates a standalone table and depends on nothing earlier, which is what
// makes this safe rather than a fudge.
const TMP = mkdtempSync(path.join(os.tmpdir(), "videoautopost-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = TMP;
{
  const seed = new Database(path.join(TMP, "news.db"));
  seed.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const ins = seed.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)");
  const { getRegisteredMigrations } = await import("../db/migrate.js");
  for (const id of getRegisteredMigrations()) {
    if (id === "022_video_posts") continue;   // the one under test
    ins.run(id, Date.now());
  }
  seed.close();
}

const HOUR = 3600 * 1000;
const { getDb } = await import("../models/database.js");
const db = getDb();

const {
  claimVideoPost, markVideoPublished, markVideoFailed, getVideoPost,
  findFreshUnvideoedArticles, countVideosPublishedSince, lastVideoPublishedAt,
  publisherPublishedSince, eventPublishedSince, recentPublishedVideos,
  markVideoPrivacy, VIDEO_PENDING_HANG_MS,
} = await import("../models/database.js");

const { rateGate, isQuotaExceeded, VIDEO_MAX_PER_DAY, videoMinIntervalMs } =
  await import("./videoAutopost.js");

let seq = 0;
function seedArticle({ id = `art-${++seq}`, source = "Reuters", published = Date.now() - HOUR, cred = 9 } = {}) {
  db.prepare(`
    INSERT INTO articles (id, title, description, content, url, category, source_name,
                          published_at, fetched_at, credibility, is_duplicate)
    VALUES (?, ?, '', ?, ?, 'world', ?, ?, ?, ?, 0)
  `).run(id, `Headline ${id}`, "x".repeat(3000), `https://e.example/${id}`, source, published, Date.now(), cred);
  return id;
}
const ids = (rows) => rows.map(r => r.id);

// ─── The stale-pending rule (mirrors 021 / 5fd41c8) ─────────────────────────

test("a fresh article with no video row is selectable", () => {
  const id = seedArticle();
  assert.ok(ids(findFreshUnvideoedArticles({ limit: 50 })).includes(id));
});

test("a PUBLISHED article is retired immediately", () => {
  const id = seedArticle();
  claimVideoPost({ articleId: id, sourceName: "Reuters", title: "t" });
  markVideoPublished(id, { youtubeId: "yt1", privacyStatus: "public" });
  assert.ok(!ids(findFreshUnvideoedArticles({ limit: 50 })).includes(id));
});

test("ONE failure does NOT retire — a transient outage must recover", () => {
  // The 5-day IG outage retired ~23 events/day under an any-row rule. One
  // failure is the platform; two is the article.
  const id = seedArticle();
  claimVideoPost({ articleId: id, sourceName: "Reuters", title: "t" });
  markVideoFailed(id, "upload 503");
  assert.ok(ids(findFreshUnvideoedArticles({ limit: 50 })).includes(id),
    "a single failed upload must leave the article selectable");
  assert.equal(getVideoPost(id).attempts, 1);
});

test("TWO failures retire it", () => {
  const id = seedArticle();
  claimVideoPost({ articleId: id, sourceName: "Reuters", title: "t" });
  markVideoFailed(id, "upload 503");
  claimVideoPost({ articleId: id, sourceName: "Reuters", title: "t" });
  markVideoFailed(id, "upload 503 again");
  assert.equal(getVideoPost(id).attempts, 2);
  assert.ok(!ids(findFreshUnvideoedArticles({ limit: 50 })).includes(id));
});

test("a pending row still INSIDE the hang window is not re-selected", () => {
  // It is genuinely in flight; re-selecting would render the same article twice
  // concurrently and race on the daily cap.
  const id = seedArticle();
  claimVideoPost({ articleId: id, sourceName: "Reuters", title: "t" });
  assert.ok(!ids(findFreshUnvideoedArticles({ limit: 50 })).includes(id));
});

test("a STALE pending row counts as a failed attempt and frees the article", () => {
  // The process died mid-upload. Insert-pending + UNIQUE(article_id) would
  // otherwise retire this article permanently on the first crash.
  const id = seedArticle();
  claimVideoPost({ articleId: id, sourceName: "Reuters", title: "t" });
  db.prepare("UPDATE video_posts SET updated_at = ? WHERE article_id = ?")
    .run(Date.now() - VIDEO_PENDING_HANG_MS - 60_000, id);
  assert.ok(ids(findFreshUnvideoedArticles({ limit: 50 })).includes(id),
    "a crashed upload must not retire the article permanently");
});

test("the claim is an UPSERT — UNIQUE(article_id) holds and attempts accumulate", () => {
  const id = seedArticle();
  claimVideoPost({ articleId: id, sourceName: "Reuters", title: "t" });
  claimVideoPost({ articleId: id, sourceName: "Reuters", title: "t" });
  const rows = db.prepare("SELECT COUNT(*) n FROM video_posts WHERE article_id = ?").get(id).n;
  assert.equal(rows, 1, "UNIQUE(article_id) means attempts are columns, not rows");
  assert.equal(getVideoPost(id).attempts, 2);
});

test("write-before-upload: the row exists before any youtube_id does", () => {
  const id = seedArticle();
  const row = claimVideoPost({ articleId: id, sourceName: "Reuters", title: "t" });
  assert.equal(row.status, "pending");
  assert.equal(row.youtube_id, null);
  // A crash here leaves a recoverable pending row rather than a published
  // video with no record of it.
});

// ─── Rate gates ─────────────────────────────────────────────────────────────

test("the daily cap counts a ROLLING 24h, not a calendar day", () => {
  const now = Date.now();
  // 25h ago must NOT count — a calendar day would reset at midnight and let a
  // quiet day burst.
  const old = seedArticle();
  claimVideoPost({ articleId: old, sourceName: "OldWire", title: "t" });
  markVideoPublished(old, { youtubeId: "ytOld", privacyStatus: "public" });
  db.prepare("UPDATE video_posts SET published_at = ? WHERE article_id = ?").run(now - 25 * HOUR, old);
  const before = countVideosPublishedSince(now - 24 * HOUR);

  const recent = seedArticle();
  claimVideoPost({ articleId: recent, sourceName: "NewWire", title: "t" });
  markVideoPublished(recent, { youtubeId: "ytNew", privacyStatus: "public" });
  assert.equal(countVideosPublishedSince(now - 24 * HOUR), before + 1);
});

test("spacing is derived from the cap, with slack so a miss costs time not a video", () => {
  // 24h / 4 = 6h exactly would mean one missed slot pushes every later one back
  // and the day quietly delivers three. 0.8 gives five opportunities for four.
  assert.equal(VIDEO_MAX_PER_DAY(), 4);
  const expected = Math.round((24 * HOUR / 4) * 0.8);
  assert.equal(videoMinIntervalMs(), expected);
  assert.ok(videoMinIntervalMs() < 24 * HOUR / VIDEO_MAX_PER_DAY(),
    "spacing must leave slack under the even division, or a miss loses a video");
});

test("the two gates are INDEPENDENT — under cap but too soon still blocks", () => {
  const id = seedArticle();
  claimVideoPost({ articleId: id, sourceName: "SpacingWire", title: "t" });
  markVideoPublished(id, { youtubeId: "ytSpacing", privacyStatus: "public" });
  const g = rateGate({ now: Date.now() });
  assert.equal(g.ok, false);
  assert.equal(g.gate, "spacing", `expected spacing to block, got ${JSON.stringify(g)}`);
});

test("lastVideoPublishedAt drives the spacing gate", () => {
  assert.ok(lastVideoPublishedAt() > 0);
});

// ─── Cooldown queries ───────────────────────────────────────────────────────

test("per-publisher counting is scoped to that publisher", () => {
  const now = Date.now();
  assert.ok(publisherPublishedSince("SpacingWire", now - 24 * HOUR) >= 1);
  assert.equal(publisherPublishedSince("NoSuchWire", now - 24 * HOUR), 0);
});

test("event counting is scoped to that event", () => {
  const id = seedArticle();
  claimVideoPost({ articleId: id, eventId: "ev-1", sourceName: "EvWire", title: "t" });
  markVideoPublished(id, { youtubeId: "ytEv", privacyStatus: "public" });
  assert.equal(eventPublishedSince("ev-1", Date.now() - 48 * HOUR), 1);
  assert.equal(eventPublishedSince("ev-2", Date.now() - 48 * HOUR), 0);
});

// ─── Recovery surface ───────────────────────────────────────────────────────

test("recentPublishedVideos returns newest first and only published rows", () => {
  const rows = recentPublishedVideos(50);
  assert.ok(rows.length >= 3);
  assert.ok(rows.every(r => r.status === "published" && r.youtube_id));
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].published_at >= rows[i].published_at, "must be newest first");
  }
});

test("markVideoPrivacy updates the row the ops route reports on", () => {
  const row = recentPublishedVideos(1)[0];
  markVideoPrivacy(row.article_id, "private");
  assert.equal(getVideoPost(row.article_id).privacy_status, "private");
});

// ─── Quota ──────────────────────────────────────────────────────────────────

test("403 quotaExceeded is distinguished from every other 403", () => {
  // An upload costs 1,600 of a 10,000/day budget SHARED with ingestion search
  // calls, so late-day exhaustion is the likely first production failure — and
  // it must end the cycle rather than burn a spec+render+TTS per remaining
  // candidate on uploads that cannot succeed.
  assert.equal(isQuotaExceeded(new Error('YouTube upload failed (403): {"error":{"errors":[{"reason":"quotaExceeded"}]}}')), true);
  assert.equal(isQuotaExceeded(new Error("YouTube upload failed (403): dailyLimitExceeded")), true);
  assert.equal(isQuotaExceeded(new Error("YouTube upload failed (403): forbidden — channel not verified")), false);
  assert.equal(isQuotaExceeded(new Error("YouTube upload failed (500): backend error")), false);
  assert.equal(isQuotaExceeded(new Error("ECONNRESET")), false);
});

// ─── Rows are permanent ─────────────────────────────────────────────────────

test("video_posts has NO foreign key — rows must outlive their articles", () => {
  // Articles prune at 7 days; the youtube_id is the lasting record and the
  // dedupe key. A REFERENCES clause would invite a future cascade and re-arm
  // the same-story-twice bug three weeks later.
  const fks = db.prepare("PRAGMA foreign_key_list(video_posts)").all();
  assert.equal(fks.length, 0, `expected no FK, found ${JSON.stringify(fks)}`);
});

test("the dedupe survives its article being pruned", () => {
  const id = seedArticle();
  claimVideoPost({ articleId: id, sourceName: "PruneWire", title: "Kept headline" });
  markVideoPublished(id, { youtubeId: "ytPrune", privacyStatus: "public" });
  db.prepare("DELETE FROM articles WHERE id = ?").run(id);
  const row = getVideoPost(id);
  assert.ok(row, "the video_posts row must survive the article");
  assert.equal(row.youtube_id, "ytPrune");
  assert.equal(row.title, "Kept headline", "denormalised so the cooldowns still work");
});
