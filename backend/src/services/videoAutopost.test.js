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
