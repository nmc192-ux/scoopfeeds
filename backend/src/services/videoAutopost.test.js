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
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// These tests exercise the REAL production functions, which all reach the
// getDb() singleton — so the fixture is a temp SCOOP_PERSISTENT_DATA_DIR and a
// normal boot, not makeTestDb()'s separate handle. getDb() goes through
// bootstrapSchema() (initializeSchema → initRealityIndex → runMigrations), so
// the schema here cannot drift from production's.
//
// This block used to pre-mark every migration EXCEPT 022 as already applied, to
// work around runMigrations() dying at 011 on a branch where bootstrapSchema()
// did not exist yet. Both it and src/testing/testDb.js are on main now, so the
// workaround is obsolete — and it was actively dangerous: written as
// "everything except 022", it silently suppressed every migration added after
// it. 023 would never have run, and the facebook_* columns these tests depend
// on would have been missing with no error to say why.
const TMP = mkdtempSync(path.join(os.tmpdir(), "videoautopost-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = TMP;

const HOUR = 3600 * 1000;
const { getDb } = await import("../models/database.js");
const db = getDb();

const {
  claimVideoPost, markVideoPublished, markVideoFailed, getVideoPost,
  findFreshUnvideoedArticles, countVideosPublishedSince, lastVideoPublishedAt,
  publisherPublishedSince, eventPublishedSince, recentPublishedVideos,
  markVideoPrivacy, VIDEO_PENDING_HANG_MS,
  markVideoFacebook, countFacebookPostsSince,
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

// ─── The cycle, end to end ──────────────────────────────────────────────────
//
// THE COVERAGE GAP THAT COST A PROD RUN. Everything above tests the loop's
// PARTS — gates, cooldowns, the stale-pending rule — and nothing drove
// runVideoRenderCycle itself. So when writeVideoSpec's too-thin path returned
// bare null while the caller read `r.costUsd` unconditionally, the first thin
// article threw out of the whole cycle and the remaining candidates were never
// attempted. The verification harness had this via --fail-first; the loop did
// not. These tests are that coverage, moved into the suite where it runs.
//
// Only the collaborators are injected (spec, packaging, render, upload, config
// probes). The gates, the rate limits and the database are REAL — a test that
// stubbed those would pass while the thing it claims to cover was broken.

const { runVideoRenderCycle } = await import("./videoAutopost.js");

const OK_SPEC = { slides: [{ t: "title" }], meta: { finishReason: "STOP", costUsd: 0.0003 } };

function cycleEnv() {
  process.env.VIDEO_AUTOPOST_ENABLED = "1";
  process.env.VIDEO_MAX_PER_DAY = "10";
  process.env.VIDEO_MIN_INTERVAL_MS = "1";   // not 0 — 0 is falsy and falls back
  db.exec("DELETE FROM video_posts");
  db.exec("DELETE FROM articles");
}

/** Every collaborator stubbed to succeed; individual tests override one. */
const baseDeps = () => ({
  isVideoSpecEnabled: () => true,
  isVoiceConfigured: () => true,
  isYouTubeConfigured: () => true,
  writeVideoSpec: async () => ({ ok: true, spec: OK_SPEC, costUsd: 0.0003, reason: null, attempts: 1 }),
  produceVideo: async () => ({ path: path.join(TMP, "v.mp4"), slides: [] }),
  writePackaging: async () => ({ titles: ["Packaged title"], description_hook: "", tags: [] }),
  uploadToYouTube: async () => ({ videoId: "yt-e2e" }),
});

test("a REJECTED first candidate does not abort the cycle — the second still publishes", async () => {
  cycleEnv();
  const thin = seedArticle({ source: "Reuters", cred: 9 });
  const good = seedArticle({ source: "AP", cred: 8 });   // cred DESC orders selection

  const res = await runVideoRenderCycle({
    dryRun: true,
    deps: {
      ...baseDeps(),
      writeVideoSpec: async (article) => article.id === thin
        ? { ok: false, spec: null, costUsd: 0.00012, reason: "too thin — only 4 slides remain (< 6)", attempts: 1 }
        : { ok: true, spec: OK_SPEC, costUsd: 0.00031, reason: null, attempts: 1 },
    },
  });

  assert.equal(res.error, undefined, `cycle threw: ${res.error}`);
  assert.equal(res.tried, 2, "both candidates must be attempted");
  assert.equal(res.produced?.articleId, good, "the second candidate must produce the video");
  assert.equal(res.attempts[0].id, thin);
  assert.equal(res.attempts[0].stage, "spec");
  assert.match(res.attempts[0].reason, /too thin/);
  assert.equal(res.attempts[1].stage, "ok-dry");
  // The rejected article SPENT. Discarding that spend is what the result
  // contract was introduced to stop, so the cycle total must include it.
  assert.ok(Math.abs(res.spendUsd - 0.00043) < 1e-9,
    `spend must include the rejected attempt, got ${res.spendUsd}`);
});

test("a collaborator that breaks the contract and returns null skips ONE article, not the run", async () => {
  // The exact 2026-08-03 prod shape, driven from the caller's side. Even with
  // the callee fixed, the loop must not be one stale return away from dying.
  cycleEnv();
  const bad = seedArticle({ source: "Reuters", cred: 9 });
  const good = seedArticle({ source: "AP", cred: 8 });

  const res = await runVideoRenderCycle({
    dryRun: true,
    deps: {
      ...baseDeps(),
      writeVideoSpec: async (article) => article.id === bad ? null : ({ ok: true, spec: OK_SPEC, costUsd: 0.0002, reason: null, attempts: 1 }),
    },
  });

  assert.equal(res.error, undefined, `a null return must not abort the cycle (got: ${res.error})`);
  assert.equal(res.tried, 2);
  assert.equal(res.produced?.articleId, good);
  assert.match(res.attempts[0].reason, /broke its contract/);
});

test("an attempt that THROWS is still counted and names the stage it died in", async () => {
  // "tried 0" while one article had been attempted is what made the prod log
  // useless. The record is written at attempt time, so a throw cannot erase it.
  cycleEnv();
  const boom = seedArticle({ source: "Reuters", cred: 9 });

  const res = await runVideoRenderCycle({
    dryRun: true,
    deps: { ...baseDeps(), writeVideoSpec: async () => { throw new Error("kaboom"); } },
  });

  assert.equal(res.error, "kaboom");
  assert.equal(res.tried, 1, "an attempt that threw must still be counted");
  assert.equal(res.attempts[0].id, boom);
  assert.equal(res.attempts[0].stage, "spec", "the record must name the stage it died in");
  assert.equal(res.attempts[0].error, "kaboom");
});

test("an unset VIDEO_SPEC_ENABLED aborts ONCE — it does not skip eight candidates", async () => {
  // The earlier dry run reported eight ordinary-looking spec skips for a reason
  // no article could ever satisfy. A misconfiguration must not read as a yield
  // problem, and must not cost eight candidates their one shot in the window.
  cycleEnv();
  for (let i = 0; i < 8; i++) seedArticle({ source: `Src${i}`, cred: 9 });

  let specCalls = 0;
  const res = await runVideoRenderCycle({
    dryRun: true,
    deps: {
      ...baseDeps(),
      isVideoSpecEnabled: () => false,
      writeVideoSpec: async () => { specCalls++; return { ok: false, spec: null, costUsd: 0, reason: "x", attempts: 0 }; },
    },
  });

  assert.equal(res.skipped, "no-spec");
  assert.equal(res.tried, 0, "no article should be attempted at all");
  assert.equal(specCalls, 0, "the spec writer must never be called in this configuration");
});

// ─── Candidate ordering: substance before recency ───────────────────────────
//
// The 2026-08-03 dry run walked all 8 candidates and rejected every one as
// "too thin" at 4-5 slides. The pool was not the problem; the ORDER BY was.
// `credibility DESC, published_at DESC` buckets on a coarse 4-value tier and
// then takes the FRESHEST rows inside the bucket — which are the ones
// ingestion has just written and contentEnricher has not filled yet. Measured
// against a prod snapshot: top-8 median 111 stored chars against a pool median
// of 2,219, below the 10th percentile, 0/8 overlap with a by-length ordering.
//
// These pin the ordering, not the yield. Yield is a live measurement.

function seedSized({ id, chars, source = "Wire", cred = 9, published = Date.now() - HOUR }) {
  db.prepare(`
    INSERT INTO articles (id, title, description, content, url, category, source_name,
                          published_at, fetched_at, credibility, is_duplicate)
    VALUES (?, ?, '', ?, ?, 'world', ?, ?, ?, ?, 0)
  `).run(id, `Headline ${id}`, "x".repeat(chars), `https://e.example/${id}`, source, published, Date.now(), cred);
  return id;
}

test("a DENSE older article outranks a THIN fresher one", () => {
  db.exec("DELETE FROM video_posts"); db.exec("DELETE FROM articles");
  const thinFresh = seedSized({ id: "ord-thin", chars: 120, published: Date.now() - 60_000 });
  const denseOld = seedSized({ id: "ord-dense", chars: 4800, published: Date.now() - 6 * HOUR });

  const got = ids(findFreshUnvideoedArticles({ limit: 10 }));
  assert.equal(got[0], denseOld, "substance must outrank recency — this is the whole fix");
  assert.equal(got[1], thinFresh);
});

test("credibility no longer dominates — it is a tiebreak, and the FLOOR is unchanged", () => {
  db.exec("DELETE FROM video_posts"); db.exec("DELETE FROM articles");
  const denseLowerCred = seedSized({ id: "ord-dense-8", chars: 4800, cred: 8 });
  const thinTopCred = seedSized({ id: "ord-thin-10", chars: 120, cred: 10 });
  const belowFloor = seedSized({ id: "ord-below", chars: 5000, cred: 6 });

  const got = ids(findFreshUnvideoedArticles({ limit: 10 }));
  assert.equal(got[0], denseLowerCred, "a denser cred-8 article must outrank a thin cred-10 one");
  assert.ok(got.includes(thinTopCred));
  assert.ok(!got.includes(belowFloor),
    "the credibility >= 7 FLOOR must still exclude — only the ORDER BY changed");
});

test("event breadth breaks ties among articles saturated at the 5,000-char cap", () => {
  // contentEnricher caps content at 5,000, so length stops discriminating
  // exactly at the dense end — 12-17% of prod candidates sit there. Event
  // breadth is what separates them.
  db.exec("DELETE FROM video_posts"); db.exec("DELETE FROM articles");
  db.exec("DELETE FROM event_articles");
  const lonely = seedSized({ id: "ord-cap-lonely", chars: 5000, published: Date.now() - 60_000 });
  const broad = seedSized({ id: "ord-cap-broad", chars: 5000, published: Date.now() - 6 * HOUR });

  const link = db.prepare("INSERT INTO event_articles (event_id, article_id, added_at) VALUES (?, ?, ?)");
  link.run("evt-broad", broad, Date.now());
  for (let i = 0; i < 5; i++) {                       // 5 more outlets on the same story
    const sib = seedSized({ id: `ord-sib-${i}`, chars: 300, source: `Outlet${i}` });
    link.run("evt-broad", sib, Date.now());
  }
  link.run("evt-lonely", lonely, Date.now());

  const got = ids(findFreshUnvideoedArticles({ limit: 10 }));
  assert.equal(got[0], broad,
    "at equal length, the story carried by six outlets must outrank the one carried by one");
  assert.equal(got[1], lonely);
  db.exec("DELETE FROM event_articles");
});

// ─── Facebook cross-post ────────────────────────────────────────────────────
//
// The load-bearing property is NEGATIVE: a Facebook failure must not be able to
// touch the YouTube upload that already succeeded. `status` stays 'published',
// the article stays retired, the cycle still reports produced, and nothing
// throws. Everything else here is bookkeeping around that.

const {
  crossPostToFacebook, facebookCrossPostEnabled, VIDEO_FACEBOOK_MAX_PER_DAY,
} = await import("./videoAutopost.js");

function fbEnv({ enabled = "1", max } = {}) {
  process.env.VIDEO_FACEBOOK_ENABLED = enabled;
  if (max === undefined) delete process.env.VIDEO_FACEBOOK_MAX_PER_DAY;
  else process.env.VIDEO_FACEBOOK_MAX_PER_DAY = String(max);
  process.env.FACEBOOK_PAGE_ID = "1126859220500685";
  process.env.FACEBOOK_PAGE_TOKEN = "test-token-not-real";
}

/** An article that has already been published to YouTube. */
function publishedArticle(source = "Reuters") {
  const id = seedArticle({ source });
  claimVideoPost({ articleId: id, sourceName: source, title: "t" });
  markVideoPublished(id, { youtubeId: `yt-${id}`, privacyStatus: "public" });
  return id;
}

test("the cap defaults to VIDEO_MAX_PER_DAY, so raising one does not leave the other behind", () => {
  const savedMax = process.env.VIDEO_MAX_PER_DAY;
  delete process.env.VIDEO_FACEBOOK_MAX_PER_DAY;
  process.env.VIDEO_MAX_PER_DAY = "12";
  assert.equal(VIDEO_FACEBOOK_MAX_PER_DAY(), 12);
  process.env.VIDEO_MAX_PER_DAY = "4";
  assert.equal(VIDEO_FACEBOOK_MAX_PER_DAY(), 4, "unset must TRACK the YouTube cap, not pin a literal");
  if (savedMax === undefined) delete process.env.VIDEO_MAX_PER_DAY; else process.env.VIDEO_MAX_PER_DAY = savedMax;
});

test("an explicit cap overrides, and 0 means ZERO rather than falling through", () => {
  // Someone throttling mid-incident types 0 before they type 1. `|| default`
  // would have turned that into twelve.
  process.env.VIDEO_MAX_PER_DAY = "12";
  process.env.VIDEO_FACEBOOK_MAX_PER_DAY = "3";
  assert.equal(VIDEO_FACEBOOK_MAX_PER_DAY(), 3);
  process.env.VIDEO_FACEBOOK_MAX_PER_DAY = "0";
  assert.equal(VIDEO_FACEBOOK_MAX_PER_DAY(), 0, "0 must throttle to nothing, not fall through to 12");
  delete process.env.VIDEO_FACEBOOK_MAX_PER_DAY;
});

test("the kill switch is off by default and writes NOTHING when off", async () => {
  cycleEnv();
  delete process.env.VIDEO_FACEBOOK_ENABLED;
  assert.equal(facebookCrossPostEnabled(), false, "must ship dark");

  const id = publishedArticle();
  const res = await crossPostToFacebook({ id }, { filePath: "/nonexistent.mp4", title: "t" });

  assert.equal(res.status, "off");
  // NULL means "never attempted". Writing 'skipped' for every video shipped
  // during a dark period would make the column lie about a decision never taken.
  assert.equal(getVideoPost(id).facebook_status, null);
});

test("the daily cap skips without attempting an upload", async () => {
  cycleEnv();
  fbEnv({ max: 1 });

  const first = publishedArticle("CapWireA");
  markVideoFacebook(first, { status: "posted", postId: "fb-1" });

  const second = publishedArticle("CapWireB");
  const res = await crossPostToFacebook({ id: second }, { filePath: "/nonexistent.mp4", title: "t" });

  assert.equal(res.status, "skipped");
  assert.equal(res.reason, "daily-cap");
  const row = getVideoPost(second);
  assert.equal(row.facebook_status, "skipped");
  assert.match(row.facebook_error, /daily cap 1\/1/);
  assert.equal(row.status, "published", "the YouTube state is untouched");
});

test("the cap counts a ROLLING 24h — a post 25h old does not consume a slot", () => {
  cycleEnv();
  const now = Date.now();
  const old = publishedArticle("RollWire");
  markVideoFacebook(old, { status: "posted", postId: "fb-old" });
  db.prepare("UPDATE video_posts SET published_at = ? WHERE article_id = ?").run(now - 25 * HOUR, old);
  assert.equal(countFacebookPostsSince(now - 24 * HOUR), 0);

  const recent = publishedArticle("RollWire2");
  markVideoFacebook(recent, { status: "posted", postId: "fb-new" });
  assert.equal(countFacebookPostsSince(now - 24 * HOUR), 1);
});

test("a failed upload records 'failed' and NEVER throws", async () => {
  cycleEnv();
  fbEnv();
  const id = publishedArticle("FailWire");

  // No stub needed: the real client is configured but the file does not exist,
  // so postVideoToFacebook throws before any network call.
  const res = await crossPostToFacebook({ id }, { filePath: "/definitely/not/here.mp4", title: "t" });

  assert.equal(res.status, "failed");
  const row = getVideoPost(id);
  assert.equal(row.facebook_status, "failed");
  assert.ok(row.facebook_error, "the failure must be attributable without reading logs");
});

test("A FACEBOOK FAILURE CANNOT UNDO THE YOUTUBE PUBLISH", async () => {
  // The whole point. markVideoFailed would flip status back to 'failed', and
  // the stale-pending retire rule would make the article selectable again —
  // uploading the same video to YouTube twice. markVideoFacebook writes a
  // disjoint set of columns, so it structurally cannot.
  cycleEnv();
  fbEnv();
  const id = publishedArticle("IsolationWire");
  const before = getVideoPost(id);

  await crossPostToFacebook({ id }, { filePath: "/definitely/not/here.mp4", title: "t" });

  const after = getVideoPost(id);
  assert.equal(after.status, "published", "status must NOT move to 'failed'");
  assert.equal(after.youtube_id, before.youtube_id);
  assert.equal(after.published_at, before.published_at);
  assert.equal(after.attempts, before.attempts, "no attempt may be consumed");
  assert.equal(after.error, null, "the YouTube error column must stay clean");
  assert.ok(!ids(findFreshUnvideoedArticles({ limit: 50 })).includes(id),
    "the article must stay retired — re-selection would publish to YouTube twice");
});

test("markVideoFacebook cannot write the YouTube status column at all", () => {
  cycleEnv();
  const id = publishedArticle("ColumnWire");
  markVideoFacebook(id, { status: "failed", error: "meta 500" });
  const row = getVideoPost(id);
  assert.equal(row.status, "published");
  assert.equal(row.facebook_status, "failed");
});

test("a Meta 403 mentioning a rate limit does not trip the YouTube quota abort", () => {
  // isQuotaExceeded matches /403/ AND /quota|dailyLimitExceeded/i on a bare
  // message. Meta says all of these; none of them are a YouTube quota, and a
  // match would abort the cycle for the rest of the day.
  assert.equal(isQuotaExceeded(new Error("facebook /videos → 403 (#4) Application request limit reached")), false);
  assert.equal(isQuotaExceeded(new Error("facebook /videos → 403 (#80001) There have been too many calls from this page")), false);
  // And the one that WOULD match textually is unreachable, because the
  // cross-post is outside the try/catch that consults isQuotaExceeded at all.
});

test("the cycle still reports produced when the cross-post fails", async () => {
  cycleEnv();
  fbEnv();
  seedArticle({ source: "Reuters", cred: 9 });

  const res = await runVideoRenderCycle({
    deps: {
      ...baseDeps(),
      crossPostToFacebook: async () => { throw new Error("meta exploded past its own guard"); },
    },
  });

  assert.equal(res.error, undefined, `a cross-post throw must not fail the cycle: ${res.error}`);
  assert.equal(res.produced?.youtubeId, "yt-e2e", "the YouTube publish must still be reported");
  assert.equal(res.attempts.at(-1).stage, "ok", "the attempt must still read as a success");
  assert.equal(getVideoPost(res.produced.articleId).status, "published");
});

test("a successful cross-post is attached to the cycle result", async () => {
  cycleEnv();
  fbEnv();
  seedArticle({ source: "Reuters", cred: 9 });

  const res = await runVideoRenderCycle({
    deps: {
      ...baseDeps(),
      crossPostToFacebook: async () => ({ status: "posted", id: "fb-99", url: "https://fb/1" }),
    },
  });

  assert.equal(res.produced?.facebook?.status, "posted");
  assert.equal(res.produced.facebook.id, "fb-99");
});

test("the cross-post runs on the SAME MP4 the upload used, in the same cycle", async () => {
  // "Before the 48h sweep" is satisfied structurally rather than by a check:
  // the file is the one produceVideo just returned and the cycle has not ended.
  cycleEnv();
  fbEnv();
  seedArticle({ source: "Reuters", cred: 9 });

  const rendered = path.join(TMP, "same-file.mp4");
  let seenByFacebook = null;
  await runVideoRenderCycle({
    deps: {
      ...baseDeps(),
      produceVideo: async () => ({ path: rendered, slides: [] }),
      crossPostToFacebook: async (_a, opts) => { seenByFacebook = opts.filePath; return { status: "posted", id: "fb-1" }; },
    },
  });

  assert.equal(seenByFacebook, rendered);
});

// ─── Liveness: staleness + the /fail classification ─────────────────────────
//
// The video cycle had HANG detection only, so a loop that simply stopped being
// dispatched produced no signal at all — no start to go stale, no error, no
// failed row. A dead YouTube token ran 17h behind that gap.

const { getVideoCycleHealth, videoCycleFailure, VIDEO_CYCLE_STALE_MS } =
  await import("./videoAutopost.js");
const { recordHeartbeat } = await import("../models/database.js");

test("the video cycle now has a staleness threshold — 3 missed hourly runs", () => {
  delete process.env.VIDEO_CYCLE_STALE_MS;
  assert.equal(VIDEO_CYCLE_STALE_MS(), 3 * HOUR);
  process.env.VIDEO_CYCLE_STALE_MS = "5400000";
  assert.equal(VIDEO_CYCLE_STALE_MS(), 5400000, "tunable without a deploy");
  delete process.env.VIDEO_CYCLE_STALE_MS;
});

test("a runner that STOPPED FIRING is reported stale — the 17h gap", () => {
  const now = Date.now();
  recordHeartbeat("video_cycle", { phase: "complete", startedAt: now - 17 * HOUR });
  db.prepare("UPDATE system_heartbeats SET last_at = ? WHERE name = 'video_cycle'").run(now - 17 * HOUR);

  const h = getVideoCycleHealth({ now });
  assert.equal(h.stale, true, "a loop dark for 17h must be stale");
  assert.equal(h.hung, false, "and NOT hung — it completed, it just never ran again");
  assert.ok(h.ageMs >= 17 * HOUR);
});

test("a cycle that ran recently is not stale", () => {
  const now = Date.now();
  recordHeartbeat("video_cycle", { phase: "complete", startedAt: now - 60_000 });
  const h = getVideoCycleHealth({ now });
  assert.equal(h.stale, false);
});

test("NEVER-FIRED is not stale — a fresh deploy has nothing to be late for", () => {
  db.exec("DELETE FROM system_heartbeats WHERE name = 'video_cycle'");
  const h = getVideoCycleHealth({ now: Date.now() });
  assert.equal(h.stale, false, "no heartbeat at all must not read as an outage");
  // getHeartbeatRow returns lastAt: 0 for a missing row (not null); 0 is falsy,
  // which is exactly what keeps the staleness branch from firing.
  assert.equal(h.lastAt, 0);
  assert.equal(h.ageMs, null, "no age is computable without a first execution");
});

test("8 of 8 failing at the SAME stage is an incident", () => {
  const attempts = Array.from({ length: 8 }, (_, n) => ({ n, stage: "upload", reason: "401" }));
  const r = videoCycleFailure(attempts);
  assert.equal(r.uniform, true);
  assert.equal(r.stage, "upload");
});

test("a cycle that PRODUCED a video is never a failure, however many were rejected", () => {
  // Seven rejections and one success is the loop working exactly as designed.
  const attempts = [
    ...Array.from({ length: 7 }, () => ({ stage: "spec", reason: "too thin" })),
    { stage: "ok" },
  ];
  assert.equal(videoCycleFailure(attempts).uniform, false);
  assert.equal(videoCycleFailure([{ stage: "ok-dry" }, { stage: "spec" }, { stage: "spec" }, { stage: "spec" }]).uniform, false);
});

test("mixed rejection stages are a bad news day, not an incident", () => {
  const attempts = [
    { stage: "spec", reason: "too thin" },
    { stage: "sport", reason: "category" },
    { stage: "publisher-24h", reason: "cooldown" },
    { stage: "spec", reason: "too thin" },
  ];
  assert.equal(videoCycleFailure(attempts).uniform, false);
});

test("VIDEO_FAIL_PING_IGNORE_STAGES silences one stage without a deploy", () => {
  // `spec` is the ambiguous one: 8/8 "too thin" was a real ordering defect on
  // 2026-08-03, but a genuinely thin news hour reads identically from here.
  const attempts = Array.from({ length: 8 }, () => ({ stage: "spec", reason: "too thin" }));
  assert.equal(videoCycleFailure(attempts).uniform, true, "counted by default");

  process.env.VIDEO_FAIL_PING_IGNORE_STAGES = "spec";
  try {
    assert.equal(videoCycleFailure(attempts).uniform, false, "one env line, no deploy");
  } finally { delete process.env.VIDEO_FAIL_PING_IGNORE_STAGES; }
});

test("event breadth is SECONDARY — a thin linked story does not outrank a dense unlinked one", () => {
  // Only 8.4% of prod candidates have event linkage (measured, 72h window).
  // Leading with breadth would hand the window to that minority regardless of
  // whether those stories carry any substance.
  db.exec("DELETE FROM video_posts"); db.exec("DELETE FROM articles");
  db.exec("DELETE FROM event_articles");
  const denseUnlinked = seedSized({ id: "ord-dense-unlinked", chars: 4800 });
  const thinLinked = seedSized({ id: "ord-thin-linked", chars: 200 });

  const link = db.prepare("INSERT INTO event_articles (event_id, article_id, added_at) VALUES (?, ?, ?)");
  link.run("evt-big", thinLinked, Date.now());
  for (let i = 0; i < 9; i++) {
    link.run("evt-big", seedSized({ id: `ord-big-sib-${i}`, chars: 100, source: `O${i}` }), Date.now());
  }

  const got = ids(findFreshUnvideoedArticles({ limit: 10 }));
  assert.equal(got[0], denseUnlinked,
    "a dense article with no event must still outrank a 200-char one on a 10-outlet event");
  db.exec("DELETE FROM event_articles");
});

// ─── Facebook Reels — a NEW PUBLISH SURFACE, so Rule 0 gates it itself ──────
//
// The cycle's single assertPublishAllowed sits ahead of the YouTube upload, and
// both Facebook surfaces run after it — so Pakistan content could not reach
// Meta even before this. But only by ORDERING. Rule 0 is three independent
// layers precisely so that no publish path is safe by accident of sequence, and
// these tests pin that each surface refuses on its own.

const GEO_BILAWAL_JAAC = {
  id: "fixture-geo-bilawal-jaac-2026-08-02",
  source_name: "Geo News",
  category: "pakistan",
  title: "Bilawal says PPP will resist JAAC in its current form",
  description: "PPP Chairman Bilawal Bhutto-Zardari addressed party workers on the proposed judicial appointments framework.",
  content: "Speaking in Karachi, Bilawal Bhutto-Zardari said the party would oppose the JAAC legislation in the National Assembly...",
  tags: "pakistan,politics,ppp",
};
const CLEAN_ARTICLE = {
  id: "fixture-benign-eu-ai-act",
  source_name: "Reuters",
  category: "technology",
  title: "EU agrees final text of the AI Act",
  description: "Negotiators settled the remaining articles on general-purpose models.",
  content: "The European Parliament and Council reached agreement on the final text...",
  tags: "eu,ai,regulation",
};

function withReelsFlag(value, fn) {
  const saved = process.env.VIDEO_FACEBOOK_REELS_ENABLED;
  const savedFb = process.env.VIDEO_FACEBOOK_ENABLED;
  if (value === undefined) delete process.env.VIDEO_FACEBOOK_REELS_ENABLED;
  else process.env.VIDEO_FACEBOOK_REELS_ENABLED = value;
  process.env.VIDEO_FACEBOOK_ENABLED = "1";
  try { return fn(); }
  finally {
    if (saved === undefined) delete process.env.VIDEO_FACEBOOK_REELS_ENABLED;
    else process.env.VIDEO_FACEBOOK_REELS_ENABLED = saved;
    if (savedFb === undefined) delete process.env.VIDEO_FACEBOOK_ENABLED;
    else process.env.VIDEO_FACEBOOK_ENABLED = savedFb;
  }
}

test("RULE 0 REFUSES the Facebook Reel — nothing reaches Meta", async () => {
  const { reelToFacebook } = await import("./videoAutopost.js");
  const r = await withReelsFlag("1", () => reelToFacebook(GEO_BILAWAL_JAAC, {
    filePath: "/nonexistent/should-never-be-read.mp4",
    title: "T", attribution: { publisher: "Geo News" },
  }));
  assert.equal(r.status, "refused");
  assert.equal(r.reason, "rule0");
  // The filePath is deliberately nonexistent: if the refusal did NOT come
  // first, the function would fail on the missing file instead and this test
  // would pass for the wrong reason.
});

test("RULE 0 refuses even when the block is only in the GENERATED spec", async () => {
  // Layer 3 checks the article AND everything generated. A clean article whose
  // narration names a blocked subject must still be refused.
  const { reelToFacebook } = await import("./videoAutopost.js");
  const r = await withReelsFlag("1", () => reelToFacebook(CLEAN_ARTICLE, {
    filePath: "/nonexistent/should-never-be-read.mp4",
    title: "T", attribution: { publisher: "Reuters" },
    slides: [{ caption: "As Bilawal told reporters in Karachi this week..." }],
  }));
  assert.equal(r.status, "refused");
  assert.equal(r.reason, "rule0");
});

test("a CLEAN article gets past Rule 0 and attempts the publish", async () => {
  // The refusal test above is only meaningful if a clean article is NOT
  // refused. This one reaches the publish attempt and fails on the missing
  // file, which is exactly how far it should get without real credentials.
  const { reelToFacebook } = await import("./videoAutopost.js");
  const r = await withReelsFlag("1", () => reelToFacebook(CLEAN_ARTICLE, {
    filePath: "/nonexistent/deliberately-missing.mp4",
    title: "EU agrees final text of the AI Act",
    attribution: { publisher: "Reuters" },
    slides: [{ caption: "The final text settles the general-purpose model rules." }],
  }));
  assert.notEqual(r.status, "refused");
  assert.ok(["failed", "skipped"].includes(r.status), `got ${JSON.stringify(r)}`);
});

test("the Reels flag is OFF by default — nothing is attempted", async () => {
  const { reelToFacebook, facebookReelsEnabled } = await import("./videoAutopost.js");
  delete process.env.VIDEO_FACEBOOK_REELS_ENABLED;
  assert.equal(facebookReelsEnabled(), false);
  const r = await reelToFacebook(CLEAN_ARTICLE, { filePath: "/x.mp4", title: "T", attribution: {} });
  assert.equal(r.status, "off");
});

test("the Reels flag is SEPARATE from the feed cross-post flag", async () => {
  // One flag would mean enabling the unproven surface as a side effect of the
  // proven one, and disabling the proven one to switch the unproven one off.
  const { facebookReelsEnabled, facebookCrossPostEnabled } = await import("./videoAutopost.js");
  const saved = { r: process.env.VIDEO_FACEBOOK_REELS_ENABLED, f: process.env.VIDEO_FACEBOOK_ENABLED };
  try {
    process.env.VIDEO_FACEBOOK_ENABLED = "1";
    delete process.env.VIDEO_FACEBOOK_REELS_ENABLED;
    assert.equal(facebookCrossPostEnabled(), true);
    assert.equal(facebookReelsEnabled(), false);
  } finally {
    if (saved.r === undefined) delete process.env.VIDEO_FACEBOOK_REELS_ENABLED; else process.env.VIDEO_FACEBOOK_REELS_ENABLED = saved.r;
    if (saved.f === undefined) delete process.env.VIDEO_FACEBOOK_ENABLED; else process.env.VIDEO_FACEBOOK_ENABLED = saved.f;
  }
});

test("RULE 0 also refuses the FEED cross-post — the gap that was closed", async () => {
  const { crossPostToFacebook } = await import("./videoAutopost.js");
  const saved = process.env.VIDEO_FACEBOOK_ENABLED;
  process.env.VIDEO_FACEBOOK_ENABLED = "1";
  try {
    const r = await crossPostToFacebook(GEO_BILAWAL_JAAC, {
      filePath: "/nonexistent/should-never-be-read.mp4",
      title: "T", attribution: { publisher: "Geo News" },
    });
    assert.equal(r.status, "refused");
    assert.equal(r.reason, "rule0");
  } finally {
    if (saved === undefined) delete process.env.VIDEO_FACEBOOK_ENABLED;
    else process.env.VIDEO_FACEBOOK_ENABLED = saved;
  }
});

test("NEITHER Facebook surface can throw into the cycle", async () => {
  // Both are called inside the upload try-block; a throw would reach the outer
  // catch, call markVideoFailed on an article whose YouTube video is LIVE, and
  // the stale-pending rule would re-upload it.
  const { reelToFacebook, crossPostToFacebook } = await import("./videoAutopost.js");
  await withReelsFlag("1", async () => {
    for (const fn of [reelToFacebook, crossPostToFacebook]) {
      await assert.doesNotReject(() => fn(GEO_BILAWAL_JAAC, { filePath: null, title: null, attribution: null }));
      await assert.doesNotReject(() => fn(CLEAN_ARTICLE, {}));
    }
  });
});

// ─── Instagram + Threads: Rule 0 per publish point ─────────────────────────
//
// Two more publish surfaces, so two more independent gates. Same reasoning as
// the Facebook pair: the cycle's single assertPublishAllowed protects these by
// ORDERING alone, and Rule 0 is three independent layers precisely so that no
// path is safe by accident of sequence.
//
// Both are URL-FETCH surfaces, which adds a second thing worth pinning: a
// refusal must leave nothing pending, or the sweep would hold an MP4 for a
// publish that was never attempted.

function withChannel(envVar, value, fn) {
  const saved = process.env[envVar];
  if (value === undefined) delete process.env[envVar];
  else process.env[envVar] = value;
  try { return fn(); }
  finally {
    if (saved === undefined) delete process.env[envVar];
    else process.env[envVar] = saved;
  }
}

for (const [channel, envVar, fnName] of [
  ["Instagram", "VIDEO_INSTAGRAM_REELS_ENABLED", "reelToInstagram"],
  ["Threads",   "VIDEO_THREADS_ENABLED",         "videoToThreads"],
  // Bluesky joins the same loop rather than getting its own copies: the five
  // properties below are the CHANNEL CONTRACT, and a channel that needs its own
  // version of them is a channel that has quietly broken it. Its protocol
  // differences are covered separately further down.
  ["Bluesky",   "VIDEO_BLUESKY_ENABLED",         "videoToBluesky"],
]) {
  test(`RULE 0 REFUSES the ${channel} publish — nothing reaches the platform`, async () => {
    const mod = await import("./videoAutopost.js");
    const r = await withChannel(envVar, "1", () => mod[fnName](GEO_BILAWAL_JAAC, {
      filePath: "/nonexistent/should-never-be-read.mp4",
      title: "T", attribution: { publisher: "Geo News" },
    }));
    assert.equal(r.status, "refused");
    assert.equal(r.reason, "rule0");
    // The filePath is deliberately nonexistent: if the refusal did not come
    // FIRST, this would fail on the missing file and pass for the wrong reason.
  });

  test(`RULE 0 refuses the ${channel} publish on a blocked GENERATED spec too`, async () => {
    const mod = await import("./videoAutopost.js");
    const r = await withChannel(envVar, "1", () => mod[fnName](CLEAN_ARTICLE, {
      filePath: "/nonexistent/should-never-be-read.mp4",
      title: "T", attribution: { publisher: "Reuters" },
      slides: [{ caption: "As Bilawal told reporters in Karachi this week..." }],
    }));
    assert.equal(r.status, "refused");
    assert.equal(r.reason, "rule0");
  });

  test(`a CLEAN article gets past Rule 0 on ${channel}`, async () => {
    // Only meaningful because the refusals above are not vacuous.
    const mod = await import("./videoAutopost.js");
    const r = await withChannel(envVar, "1", () => mod[fnName](CLEAN_ARTICLE, {
      filePath: "/nonexistent/deliberately-missing.mp4",
      title: "EU agrees final text of the AI Act",
      attribution: { publisher: "Reuters" },
      slides: [{ caption: "The final text settles the general-purpose model rules." }],
    }));
    assert.notEqual(r.status, "refused");
    assert.ok(["failed", "skipped"].includes(r.status), `got ${JSON.stringify(r)}`);
  });

  test(`${channel} is OFF by default`, async () => {
    const mod = await import("./videoAutopost.js");
    const r = await withChannel(envVar, undefined, () =>
      mod[fnName](CLEAN_ARTICLE, { filePath: "/x.mp4", title: "T", attribution: {} }));
    assert.equal(r.status, "off");
  });

  test(`${channel} cannot throw into the cycle`, async () => {
    const mod = await import("./videoAutopost.js");
    await withChannel(envVar, "1", async () => {
      await assert.doesNotReject(() => mod[fnName](GEO_BILAWAL_JAAC, { filePath: null, title: null, attribution: null }));
      await assert.doesNotReject(() => mod[fnName](CLEAN_ARTICLE, {}));
    });
  });
}

test("the four channel flags are INDEPENDENT of each other", async () => {
  // One combined flag would enable an unproven surface as a side effect of a
  // proven one, and disabling the proven one would be the only way off.
  const {
    facebookCrossPostEnabled, facebookReelsEnabled,
    instagramReelsEnabled, threadsVideoEnabled,
  } = await import("./videoAutopost.js");
  const vars = [
    ["VIDEO_FACEBOOK_ENABLED", facebookCrossPostEnabled],
    ["VIDEO_FACEBOOK_REELS_ENABLED", facebookReelsEnabled],
    ["VIDEO_INSTAGRAM_REELS_ENABLED", instagramReelsEnabled],
    ["VIDEO_THREADS_ENABLED", threadsVideoEnabled],
  ];
  const saved = Object.fromEntries(vars.map(([v]) => [v, process.env[v]]));
  try {
    for (const [v] of vars) delete process.env[v];
    for (const [, fn] of vars) assert.equal(fn(), false, "all must be dark by default");
    for (const [v, fn] of vars) {
      process.env[v] = "1";
      assert.equal(fn(), true, `${v} must enable only itself`);
      const others = vars.filter(([x]) => x !== v);
      for (const [, otherFn] of others) assert.equal(otherFn(), false, `${v} must not enable a sibling`);
      delete process.env[v];
    }
  } finally {
    for (const [v] of vars) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  }
});

test("every channel cap tracks VIDEO_MAX_PER_DAY, and 0 means zero", async () => {
  // Prod runs VIDEO_MAX_PER_DAY=12 (read live 2026-08-13), NOT the code default
  // of 4 — so an unset channel cap must be 12 there, not 4.
  const mod = await import("./videoAutopost.js");
  const caps = [
    ["VIDEO_FACEBOOK_MAX_PER_DAY", mod.VIDEO_FACEBOOK_MAX_PER_DAY],
    ["VIDEO_INSTAGRAM_MAX_PER_DAY", mod.VIDEO_INSTAGRAM_MAX_PER_DAY],
    ["VIDEO_THREADS_MAX_PER_DAY", mod.VIDEO_THREADS_MAX_PER_DAY],
  ];
  const savedMax = process.env.VIDEO_MAX_PER_DAY;
  try {
    process.env.VIDEO_MAX_PER_DAY = "12";
    for (const [v, fn] of caps) {
      delete process.env[v];
      assert.equal(fn(), 12, `${v} unset must track VIDEO_MAX_PER_DAY`);
      process.env[v] = "0";
      assert.equal(fn(), 0, `${v}=0 must mean ZERO, not unset`);
      process.env[v] = "3";
      assert.equal(fn(), 3);
      delete process.env[v];
    }
  } finally {
    if (savedMax === undefined) delete process.env.VIDEO_MAX_PER_DAY;
    else process.env.VIDEO_MAX_PER_DAY = savedMax;
  }
});

test("the Instagram duration ceiling is an EDGE the format reaches", async () => {
  const { INSTAGRAM_REEL_MAX_SECS } = await import("./videoAutopost.js");
  assert.equal(INSTAGRAM_REEL_MAX_SECS(), 90);
  // §5: the format runs 60-100s. If the ceiling sat above the format's own
  // range the guard could never fire, which reads as protection and gives none.
  assert.ok(INSTAGRAM_REEL_MAX_SECS() < 100, "the ceiling must sit inside the observed range");
});

test("the public URL is built from the ARTICLE ID, not the filename", async () => {
  // The route resolves the design-key suffix itself, so a re-render between
  // publish attempts cannot invalidate a URL already handed to Meta.
  const { publicVideoUrl } = await import("./videoAutopost.js");
  const u = publicVideoUrl("abc-123");
  assert.match(u, /\/scoop-ops\/videos-gen\/file\/abc-123$/);
  assert.ok(!u.includes("vid-v"), "the design key must not appear in the URL");
  assert.match(publicVideoUrl("a b/c"), /a%20b%2Fc$/, "the id must be encoded");
});

// ─── The three budgets, and the hoisted prefilters ──────────────────────────
//
// The defect these pin, verbatim from prod: `tried 8, produced 0 · spec spend
// $0.00000`. All eight attempts were pre-spec refusals (7 publisher-24h, 1
// event-48h), so they cost nothing — and still consumed a budget whose entire
// purpose is capping Gemini spend.

const {
  publisherCooldownFilter, buildRecentTitleCorpus, cooldownGate, diversifyByPublisher,
} = await import("./videoSelection.js");
const { MAX_SPEC_CALLS, MAX_SCAN, CANDIDATE_POOL } = await import("./videoAutopost.js");

/** seedArticle with a custom title/body length — needed to steer ORDER BY LENGTH. */
let bseq = 0;
function seedArt({ source, title = null, cred = 9, len = 3000, category = "world" } = {}) {
  const id = `budget-${++bseq}`;
  db.prepare(`
    INSERT INTO articles (id, title, description, content, url, category, source_name,
                          published_at, fetched_at, credibility, is_duplicate)
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(id, title || `Budget headline ${id}`, "x".repeat(len), `https://b.example/${id}`,
         category, source, Date.now() - HOUR, Date.now(), cred);
  return id;
}
/**
 * Put a publisher inside its 24h cooldown by publishing a video for it.
 *
 * BACKDATED TWO HOURS. markVideoPublished stamps `now`, which leaves the SPACING
 * gate blocking on its own freshness — the cycle would then decline before
 * reaching any of the selection logic under test and the assertion would pass or
 * fail for the wrong reason. Two hours is comfortably inside the 24h cooldown
 * (which is the state being set up) and comfortably outside any spacing window.
 */
function coolDown(source) {
  const id = seedArt({ source, len: 10 });
  claimVideoPost({ articleId: id, sourceName: source, title: `cooled ${source}` });
  markVideoPublished(id, { youtubeId: `yt-cool-${source}`, privacyStatus: "public" });
  db.prepare("UPDATE video_posts SET published_at = ? WHERE article_id = ?")
    .run(Date.now() - 2 * HOUR, id);
}
function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; process.env[k] = String(v); }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
  return Promise.resolve(fn()).finally(restore);
}

test("THE DEFECT: cooled publishers no longer consume the spec budget", async () => {
  cycleEnv();
  // Four mastheads that already published inside 24h, two candidates each — the
  // eight free refusals that ate the whole cap in prod. Long bodies so
  // ORDER BY LENGTH puts every one of them AHEAD of the live candidate.
  for (const p of ["P1", "P2", "P3", "P4"]) {
    coolDown(p);
    seedArt({ source: p, len: 5000 });
    seedArt({ source: p, len: 4900 });
  }
  const fresh = seedArt({ source: "FreshWire", len: 100 });   // sorts LAST

  const res = await runVideoRenderCycle({ dryRun: true, deps: baseDeps() });

  assert.equal(res.error, undefined, `cycle threw: ${res.error}`);
  assert.equal(res.produced?.articleId, fresh,
    "the live candidate sits behind 8 cooled ones by body length; it must still be reached");
  assert.equal(res.specCalls, 1, "exactly one spec call — the eight refusals are free");
  assert.equal(res.tried, 1, "the cooled articles must never enter the attempt loop at all");
});

test("the cooldown filter asks once per PUBLISHER, not once per article", () => {
  cycleEnv();
  coolDown("Repeat");
  const arts = [
    { id: "a", source_name: "Repeat" }, { id: "b", source_name: "Repeat" },
    { id: "c", source_name: "Repeat" }, { id: "d", source_name: "Cold" },
    { id: "e", source_name: "Cold" },
  ];
  const { kept, dropped, queries } = publisherCooldownFilter(arts, { now: Date.now() });
  assert.equal(queries, 2, "two distinct publishers means two queries, not five");
  assert.equal(dropped.length, 3);
  assert.deepEqual(kept.map(a => a.id), ["d", "e"]);
  assert.match(dropped[0].reason, /Repeat already published inside 24h/);
});

test("an article with no publisher name passes the cooldown filter", () => {
  // The gate has always let these through; a prefilter that is STRICTER than the
  // gate it hoists is a behaviour change wearing an optimisation's clothes.
  const { kept, queries } = publisherCooldownFilter(
    [{ id: "x", source_name: null }, { id: "y" }], { now: Date.now() });
  assert.equal(kept.length, 2);
  assert.equal(queries, 0, "no name, no query");
});

test("cooldown-before-diversity is EQUIVALENT today — pinned so it fails if that changes", () => {
  // The comment in publisherCooldownFilter claims the order is not load-bearing,
  // because diversifyByPublisher caps per publisher and has no global ceiling.
  // Measured here rather than asserted in prose. Add a global cap to diversity
  // and this test fails, which is the signal that the order now matters.
  const arts = [
    { id: "h1", source_name: "HOT" }, { id: "h2", source_name: "HOT" }, { id: "h3", source_name: "HOT" },
    { id: "c1", source_name: "COLD" }, { id: "c2", source_name: "COLD" }, { id: "d1", source_name: "DEEP" },
  ];
  const cool = (l) => l.filter(a => a.source_name !== "HOT");
  const cooldownFirst = diversifyByPublisher(cool(arts)).kept.map(a => a.id);
  const diversityFirst = cool(diversifyByPublisher(arts).kept).map(a => a.id);
  assert.deepEqual(cooldownFirst, diversityFirst,
    "if these diverge, publisherCooldownFilter's ordering note is now wrong");
});

test("REGRESSION (#11): the title-similarity branch does not throw ReferenceError", async () => {
  // `export { tooSimilar } from "…"` is a pure re-export and does NOT bind the
  // name locally. #11 replaced the local definition with that re-export, so this
  // branch threw for every article with no event linkage and a non-empty corpus
  // — which is every article, on any day a video has published in the last 48h.
  // It stayed invisible because the cadence gates returned first.
  cycleEnv();
  const id = seedArt({ source: "SimWire", title: "Undersea cable severed by anchor near Taiwan strait" });
  claimVideoPost({ articleId: id, sourceName: "SimWire", title: "Undersea cable severed by anchor near Taiwan strait" });
  markVideoPublished(id, { youtubeId: "yt-sim", privacyStatus: "public" });

  const corpus = buildRecentTitleCorpus({ now: Date.now() });
  assert.ok(corpus.length > 0, "the corpus must be non-empty or this proves nothing");

  const near = { id: "near-1", title: "Undersea cable severed by anchor near Taiwan strait waters", source_name: "OtherWire" };
  const far = { id: "far-1", title: "Municipal budget hearing adjourned without a vote", source_name: "OtherWire" };
  const g1 = cooldownGate(near, { now: Date.now(), titleCorpus: corpus });
  assert.equal(g1.ok, false);
  assert.equal(g1.gate, "title-similarity");
  assert.equal(cooldownGate(far, { now: Date.now(), titleCorpus: corpus }).ok, true);
});

test("the corpus is injectable, and an omitted one is still built", () => {
  // Hoisting must not change the ANSWER, only how often the query runs.
  const now = Date.now();
  const article = { id: "inj-1", title: "Municipal budget hearing adjourned without a vote", source_name: "OtherWire" };
  const built = cooldownGate(article, { now });
  const injected = cooldownGate(article, { now, titleCorpus: buildRecentTitleCorpus({ now }) });
  assert.deepEqual(built, injected);
});

test("the spec cap stops the cycle at the cap, counting only spec calls", async () => {
  cycleEnv();
  for (const p of ["S1", "S2", "S3", "S4", "S5"]) seedArt({ source: p });
  const res = await withEnv({ VIDEO_MAX_SPEC_CALLS_PER_CYCLE: 2 }, () =>
    runVideoRenderCycle({
      dryRun: true,
      deps: { ...baseDeps(), writeVideoSpec: async () => ({ ok: false, spec: null, costUsd: 0.0001, reason: "too thin", attempts: 1 }) },
    }));
  assert.equal(res.specCalls, 2, "the cap is on spec calls");
  assert.equal(res.tried, 2, "and nothing is examined beyond it");
  assert.equal(res.produced, null);
});

test("free refusals do NOT consume the spec budget — the whole point", async () => {
  cycleEnv();
  // Four live-blogs (refused by staticGate, before any model call), long bodies
  // so they sort first. One real candidate, shortest, last in the queue.
  for (const p of ["L1", "L2", "L3", "L4"]) {
    seedArt({ source: p, len: 5000, title: `Ukraine war live: rolling coverage from ${p}` });
  }
  const good = seedArt({ source: "GoodWire", len: 100 });
  const res = await withEnv({ VIDEO_MAX_SPEC_CALLS_PER_CYCLE: 1 }, () =>
    runVideoRenderCycle({ dryRun: true, deps: baseDeps() }));

  assert.equal(res.tried, 5, "all five were examined");
  assert.equal(res.specCalls, 1, "only the one that reached the model cost a slot");
  assert.equal(res.produced?.articleId, good,
    "with a budget of 1, four free refusals must still leave the call available");
});

test("the scan bound is a real backstop and says so when it fires", async () => {
  cycleEnv();
  for (const p of ["B1", "B2", "B3", "B4", "B5", "B6"]) {
    seedArt({ source: p, title: `Election night live: rolling coverage from ${p}` });
  }
  const res = await withEnv({ VIDEO_MAX_SCAN_PER_CYCLE: 3 }, () =>
    runVideoRenderCycle({ dryRun: true, deps: baseDeps() }));
  assert.equal(res.tried, 3, "the scan bound must stop the loop");
  assert.equal(res.specCalls, 0, "and it fired without a single spec call");
  assert.equal(res.produced, null);
});

test("the pool no longer derives from the attempt cap", async () => {
  // Was `limit: MAX_ATTEMPTS * 6` — raising the budget silently widened the
  // editorial sample. The two are now independent numbers.
  assert.equal(CANDIDATE_POOL(), 200, "the default pool is 200, not 8 x 6");
  await withEnv({ VIDEO_MAX_SPEC_CALLS_PER_CYCLE: 40 }, () => {
    assert.equal(MAX_SPEC_CALLS(), 40);
    assert.equal(CANDIDATE_POOL(), 200, "moving the budget must not move the pool");
  });
  await withEnv({ VIDEO_CANDIDATE_POOL: 25 }, () => {
    assert.equal(CANDIDATE_POOL(), 25);
    assert.equal(MAX_SPEC_CALLS(), 8, "and moving the pool must not move the budget");
  });
});

test("the pool limit actually bounds what the cycle examines", async () => {
  cycleEnv();
  for (const p of ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]) {
    seedArt({ source: p, title: `Budget vote live: rolling coverage from ${p}` });
  }
  const res = await withEnv({ VIDEO_CANDIDATE_POOL: 3 }, () =>
    runVideoRenderCycle({ dryRun: true, deps: baseDeps() }));
  assert.equal(res.tried, 3, "six candidates exist; the pool limit admits three");
});

test("the old env name still pins the money", () => {
  // Prod may have VIDEO_MAX_ATTEMPTS_PER_CYCLE set; it steered spend, and must
  // keep steering spend rather than silently reverting to the default.
  return withEnv({ VIDEO_MAX_ATTEMPTS_PER_CYCLE: 3 }, () => {
    assert.equal(MAX_SPEC_CALLS(), 3);
  }).then(() => withEnv({ VIDEO_MAX_ATTEMPTS_PER_CYCLE: 3, VIDEO_MAX_SPEC_CALLS_PER_CYCLE: 9 }, () => {
    assert.equal(MAX_SPEC_CALLS(), 9, "the new name wins when both are set");
  }));
});

test("MAX_SCAN defaults above the realistic eligible count but is not infinite", () => {
  // Measured: a 200-article pool at 2/publisher yields ~55 eligible. The bound
  // must sit above that (so it is a backstop, not a policy) and below unbounded.
  assert.equal(MAX_SCAN(), 200);
  assert.ok(MAX_SCAN() >= CANDIDATE_POOL(), "a scan bound below the pool would silently cap selection");
});

// ─── Bluesky: the parts that are NOT like the other channels ────────────────
//
// The loop above proves Bluesky honours the shared channel contract. These prove
// the three things that make it different: raw-bytes upload instead of a URL
// fetch, two hard platform ceilings, and a transcode job that has to be waited
// on without the cycle hanging on it.

const { writeFileSync: wfs, mkdirSync: mkd } = await import("node:fs");
const { truncateGraphemes, videoToBluesky, VIDEO_BLUESKY_MAX_PER_DAY } = await import("./videoAutopost.js");
const bsky = await import("./blueskyClient.js");

const BS_DIR = path.join(TMP, "bsky");
mkd(BS_DIR, { recursive: true });
/** A file of exactly `bytes` length that ffprobe will never be asked about. */
function fakeMp4(name, bytes) {
  const p = path.join(BS_DIR, name);
  wfs(p, Buffer.alloc(bytes, 0x42));
  return p;
}

function withBskyEnv(vars, fn) {
  const keys = {
    BLUESKY_HANDLE: "test.bsky.social",
    BLUESKY_APP_PASSWORD: "test-app-password",
    ...vars,
  };
  const saved = {};
  for (const [k, v] of Object.entries(keys)) { saved[k] = process.env[k]; process.env[k] = String(v); }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
  return Promise.resolve(fn()).finally(restore);
}

/**
 * Stand in for the whole AT Protocol surface. `jobStates` is consumed one per
 * getJobStatus call, the last value repeating — which is how a stuck transcode
 * is simulated without waiting on a real one.
 */
function stubBluesky({ jobStates = ["JOB_STATE_COMPLETED"], onUpload = null } = {}) {
  const realFetch = globalThis.fetch;
  const calls = [];
  let jobIdx = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (u.includes("createSession")) return json({ did: "did:plc:test", accessJwt: "acc", refreshJwt: "ref" });
    if (u.includes("refreshSession")) return json({ did: "did:plc:test", accessJwt: "acc", refreshJwt: "ref" });
    if (u.includes("getServiceAuth")) return json({ token: "svc-token" });
    if (u.includes("uploadVideo")) { onUpload?.(u, init); return json({ jobStatus: { jobId: "job-1", state: "JOB_STATE_RUNNING" } }); }
    if (u.includes("getJobStatus")) {
      const state = jobStates[Math.min(jobIdx++, jobStates.length - 1)];
      return json({ jobStatus: {
        jobId: "job-1", state,
        ...(state === "JOB_STATE_COMPLETED" ? { blob: { $type: "blob", ref: { $link: "bafy-video" }, mimeType: "video/mp4", size: 1234 } } : {}),
        ...(state === "JOB_STATE_FAILED" ? { error: "transcode_failed", message: "bad codec" } : {}),
      } });
    }
    if (u.includes("createRecord")) return json({ uri: "at://did:plc:test/app.bsky.feed.post/rkey1", cid: "cid-1" });
    return json({});
  };
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

test("the 100MB ceiling is asserted BEFORE the bytes are read", async () => {
  // Guarded with a small ceiling so the test does not write 100MB to disk. The
  // number is env-tunable precisely so the guard is reachable in a test.
  const file = fakeMp4("too-big.mp4", 64 * 1024);
  await withBskyEnv({ BLUESKY_VIDEO_MAX_BYTES: 32 * 1024 }, async () => {
    await assert.rejects(
      () => bsky.postVideoToBluesky({ text: "t", filePath: file, durationSecs: 60 }),
      /over the .*MB ceiling — nothing was uploaded/,
    );
  });
  assert.equal(bsky.BLUESKY_VIDEO_MAX_BYTES(), 100 * 1024 * 1024, "the default is the platform's 100MB");
});

test("a truncated render is refused as implausible, not uploaded", async () => {
  const file = fakeMp4("tiny.mp4", 128);
  await withBskyEnv({}, async () => {
    await assert.rejects(
      () => bsky.postVideoToBluesky({ text: "t", filePath: file, durationSecs: 60 }),
      /implausible for a video/,
    );
  });
});

test("the 3-minute ceiling is asserted, and it is the platform's", async () => {
  const file = fakeMp4("long.mp4", 64 * 1024);
  await withBskyEnv({}, async () => {
    await assert.rejects(
      () => bsky.postVideoToBluesky({ text: "t", filePath: file, durationSecs: 181 }),
      /181.0s is over the 180s ceiling — nothing was uploaded/,
    );
  });
  assert.equal(bsky.BLUESKY_VIDEO_MAX_SECS(), 180);
});

test("a missing file is refused by statSync before any network call", async () => {
  const s = stubBluesky();
  try {
    await withBskyEnv({}, async () => {
      await assert.rejects(() => bsky.postVideoToBluesky({ text: "t", filePath: "/nonexistent/none.mp4", durationSecs: 60 }));
    });
    assert.equal(s.calls.length, 0, "nothing may be sent for a file that does not exist");
  } finally { s.restore(); }
});

test("THE POLL IS BOUNDED — a stuck transcode fails the publish, it does not hang", async () => {
  const file = fakeMp4("stuck.mp4", 64 * 1024);
  const s = stubBluesky({ jobStates: ["JOB_STATE_RUNNING"] });   // never completes
  try {
    const started = Date.now();
    await withBskyEnv({ BLUESKY_VIDEO_POLL_TIMEOUT_MS: 300, BLUESKY_VIDEO_POLL_INTERVAL_MS: 50 }, async () => {
      await assert.rejects(
        () => bsky.postVideoToBluesky({ text: "t", filePath: file, durationSecs: 60 }),
        /did not finish within 300ms.*NOTHING WAS POSTED/s,
      );
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 5000, `the bound must actually bound: took ${elapsed}ms`);
    // The record is what makes a post exist. A timeout must not create one.
    assert.ok(!s.calls.some(c => c.url.includes("createRecord")), "no post record may be written on timeout");
  } finally { s.restore(); }
});

test("a FAILED transcode is reported with its reason, not retried forever", async () => {
  const file = fakeMp4("failjob.mp4", 64 * 1024);
  const s = stubBluesky({ jobStates: ["JOB_STATE_FAILED"] });
  try {
    await withBskyEnv({}, async () => {
      await assert.rejects(
        () => bsky.postVideoToBluesky({ text: "t", filePath: file, durationSecs: 60 }),
        /FAILED: transcode_failed — bad codec/,
      );
    });
    assert.ok(!s.calls.some(c => c.url.includes("createRecord")));
  } finally { s.restore(); }
});

test("the happy path uploads RAW BYTES and embeds a video, not an external card", async () => {
  const file = fakeMp4("good.mp4", 64 * 1024);
  let uploadInit = null;
  const s = stubBluesky({ jobStates: ["JOB_STATE_RUNNING", "JOB_STATE_COMPLETED"], onUpload: (_u, init) => { uploadInit = init; } });
  try {
    const out = await withBskyEnv({ BLUESKY_VIDEO_POLL_INTERVAL_MS: 10 }, () =>
      bsky.postVideoToBluesky({ text: "hello", filePath: file, durationSecs: 60, aspectRatio: { width: 1080, height: 1920 } }));

    // No public URL is ever handed over — this is the property that lets
    // migration 026 skip 'pending' and the sweep ignore this channel entirely.
    assert.ok(!s.calls.some(c => /videos-gen\/file/.test(c.url)), "no public URL may be involved");
    assert.equal(uploadInit.headers["Content-Type"], "video/mp4");
    assert.ok(Buffer.isBuffer(uploadInit.body), "the MP4 must be sent as bytes");
    assert.equal(uploadInit.body.length, 64 * 1024);

    const rec = JSON.parse(s.calls.find(c => c.url.includes("createRecord")).init.body).record;
    assert.equal(rec.embed.$type, "app.bsky.embed.video");
    assert.equal(rec.embed.video.ref.$link, "bafy-video");
    assert.deepEqual(rec.embed.aspectRatio, { width: 1080, height: 1920 });
    assert.equal(out.uri, "at://did:plc:test/app.bsky.feed.post/rkey1");
    assert.match(out.url, /^https:\/\/bsky\.app\/profile\/.+\/post\/rkey1$/);
  } finally { s.restore(); }
});

/**
 * A REAL one-second MP4, because videoToBluesky measures duration with ffprobe
 * before it will publish — a Buffer.alloc file is correctly refused as
 * `unmeasurable`, which is the right behaviour and the wrong fixture.
 *
 * Generated rather than committed: `data/videos/` is gitignored working output,
 * so depending on a file there would pass here and fail on a fresh clone.
 * Skipped, not failed, when ffmpeg is absent — though a machine without it
 * cannot render a video at all, so this is a courtesy rather than a real path.
 */
let REAL_MP4 = null;
try {
  const { execFileSync } = await import("node:child_process");
  const { getFFmpegPath } = await import("./videoGenerator.js");
  const ff = getFFmpegPath?.();
  if (ff) {
    const out = path.join(BS_DIR, "real-1s.mp4");
    execFileSync(ff, [
      "-y", "-hide_banner", "-loglevel", "error",
      // testsrc, not a flat colour: a second of solid black encodes to ~2KB and
      // is correctly refused by the 10KB implausible-file floor. The fixture has
      // to be a plausible video, not merely a valid one.
      "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", "2", out,
    ], { timeout: 30000 });
    REAL_MP4 = out;
  }
} catch { /* leave null — the test below skips */ }

test("the AT-URI is stored, not the bare rkey — handles change, DIDs do not", {
  skip: REAL_MP4 ? false : "ffmpeg unavailable — cannot build a probeable MP4",
}, async () => {
  cycleEnv();
  const id = seedArt({ source: "BskyWire" });
  claimVideoPost({ articleId: id, sourceName: "BskyWire", title: "t" });
  markVideoPublished(id, { youtubeId: "yt-bsky", privacyStatus: "public" });
  const file = REAL_MP4;
  const s = stubBluesky({ jobStates: ["JOB_STATE_COMPLETED"] });
  try {
    const r = await withBskyEnv({ VIDEO_BLUESKY_ENABLED: "1" }, () =>
      videoToBluesky({ id, source_name: "BskyWire", category: "world", title: "T", description: "d", content: "c" },
        { filePath: file, title: "T", attribution: { publisher: "BskyWire" }, slides: [{ caption: "clean" }] }));
    assert.equal(r.status, "posted", JSON.stringify(r));
    const row = getVideoPost(id);
    assert.equal(row.bluesky_status, "posted");
    assert.match(row.bluesky_post_id, /^at:\/\/did:plc:/, "the AT-URI carries the DID; an rkey alone is not addressable");
  } finally { s.restore(); }
});

test("the Bluesky cap is sized against VIDEO_MAX_PER_DAY, like its siblings", () => {
  const savedMax = process.env.VIDEO_MAX_PER_DAY;
  const savedOwn = process.env.VIDEO_BLUESKY_MAX_PER_DAY;
  try {
    process.env.VIDEO_MAX_PER_DAY = "12";           // prod's real value
    delete process.env.VIDEO_BLUESKY_MAX_PER_DAY;
    assert.equal(VIDEO_BLUESKY_MAX_PER_DAY(), 12, "unset must track the master cap, not the code default of 4");
    process.env.VIDEO_BLUESKY_MAX_PER_DAY = "3";
    assert.equal(VIDEO_BLUESKY_MAX_PER_DAY(), 3, "and it must be independently settable");
    process.env.VIDEO_BLUESKY_MAX_PER_DAY = "0";
    assert.equal(VIDEO_BLUESKY_MAX_PER_DAY(), 0, "0 means 0 — a valid way to pause one channel");
  } finally {
    if (savedMax === undefined) delete process.env.VIDEO_MAX_PER_DAY; else process.env.VIDEO_MAX_PER_DAY = savedMax;
    if (savedOwn === undefined) delete process.env.VIDEO_BLUESKY_MAX_PER_DAY; else process.env.VIDEO_BLUESKY_MAX_PER_DAY = savedOwn;
  }
});

test("the sweep guard is NOT widened to Bluesky — there is no fetch window to protect", async () => {
  // hasPendingUrlFetchPublish's name is its contract. Bluesky uploads bytes
  // in-band, so including it would pin every MP4 for the full hold in exchange
  // for guarding a window that does not exist.
  const { hasPendingUrlFetchPublish } = await import("../models/database.js");
  cycleEnv();
  const id = seedArt({ source: "SweepWire" });
  claimVideoPost({ articleId: id, sourceName: "SweepWire", title: "t" });
  db.prepare("UPDATE video_posts SET bluesky_status = 'pending' WHERE article_id = ?").run(id);
  assert.equal(hasPendingUrlFetchPublish(id), false,
    "a bluesky status must never hold an MP4 back from the sweep");
  db.prepare("UPDATE video_posts SET instagram_status = 'pending' WHERE article_id = ?").run(id);
  assert.equal(hasPendingUrlFetchPublish(id), true, "…while Instagram still must");
});

test("truncateGraphemes cuts on cluster boundaries, not code units", () => {
  // The reason this exists: `.length` counts UTF-16 code units, so an emoji is
  // 2 and a family emoji is 11 — a 300-char slice can both truncate a legal
  // post early and cut a cluster in half, publishing a replacement character.
  assert.equal(truncateGraphemes("hello", 10), "hello");
  assert.equal(truncateGraphemes("hello", 3), "hel");
  const family = "👨‍👩‍👧‍👦";
  assert.equal([...family].length > 1, true, "the fixture must be a multi-code-point cluster");
  assert.equal(truncateGraphemes(family, 1), family, "one grapheme must survive whole");
  assert.equal(truncateGraphemes(family + family, 1), family, "and the cut must not split one");
  assert.ok(!truncateGraphemes("é👍🏽🇵🇰x", 3).includes("�"));
});
