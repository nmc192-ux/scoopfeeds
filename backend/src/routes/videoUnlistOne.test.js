/**
 * THE TARGETED WITHDRAWAL, EXERCISED FOR REAL.
 *
 * The defect (DrJ, Gate E): the only programmatic retraction we had was
 * `POST /scoop-ops/video/unlist-recent`, which flips the last N published
 * videos. Using it to retract ONE specific video either requires that video to
 * be the most recent, or takes down N-1 videos nobody asked about. A takedown
 * tool that cannot name its target is not a takedown tool.
 *
 * WHAT THIS TEST ACTUALLY EXERCISES, AND WHAT IT DOES NOT.
 *
 * Real: an express app, the real router module, real HTTP over a real socket,
 * the real `setYouTubePrivacy` client, the real SQLite database (a temp one),
 * and the real `videoPostByYouTubeId` query. Every layer between the request
 * and the wire is the shipped code.
 *
 * Faked: the wire. `globalThis.fetch` is replaced with a stub that answers
 * Google's two endpoints and PASSES EVERYTHING ELSE THROUGH to the real fetch,
 * so the test's own HTTP requests to the local server are genuine. The stub
 * RECORDS the video id that reached the API, which is the whole point: the
 * property under test is "the video acted on is the one named, not the newest",
 * and that property is only observable at the API boundary.
 *
 * Not covered here, and stated rather than implied: a real YouTube call. No
 * credential in this environment can make one, and the route has never
 * successfully run in production. See the report and runbook §3.
 *
 * THE FIXTURE IS BUILT SO THE OLD BUG WOULD FAIL IT. Three published videos
 * exist and the one targeted is the OLDEST — so a handler that reached for
 * `recentPublishedVideos(1)` would touch a different video and every assertion
 * below would go red. A single-row fixture would have passed either way.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import http from "http";

// ── Environment, BEFORE the modules that read it at import time ─────────────
//
// `database.js` resolves its data directory once at module scope, and
// `youtubeClient.js` resolves its token-cache path the same way. Both are
// pointed at a throwaway directory here so this test can never read a real
// token or write to a real news.db — which is also why every import below is
// dynamic.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "unlist-one-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = DATA_DIR;
process.env.YOUTUBE_CLIENT_ID = "test-client-id";
process.env.YOUTUBE_CLIENT_SECRET = "test-client-secret";
process.env.YOUTUBE_REFRESH_TOKEN = "test-refresh-token";

const express = (await import("express")).default;
const { default: videoOpsRouter } = await import("./video-ops.js");
const { getDb } = await import("../models/database.js");

const NEWEST = "yt-newest-0003";
const MIDDLE = "yt-middle-0002";
const OLDEST = "yt-oldest-0001";
const UNKNOWN_TO_US = "yt-not-in-our-table";

/** Videos the stubbed API will admit exist and belong to us. */
const EXISTS_ON_YOUTUBE = new Set([NEWEST, MIDDLE, OLDEST, UNKNOWN_TO_US]);

const db = getDb();
{
  const n = Date.now();
  const ins = db.prepare(`
    INSERT INTO video_posts (article_id, source_name, title, status, youtube_id, privacy_status, created_at, updated_at, published_at)
    VALUES (?, 'Example', ?, 'published', ?, 'public', ?, ?, ?)
  `);
  ins.run("art-oldest", "The oldest short", OLDEST, n, n, n - 3 * 86_400_000);
  ins.run("art-middle", "The middle short", MIDDLE, n, n, n - 2 * 86_400_000);
  ins.run("art-newest", "The newest short", NEWEST, n, n, n - 1 * 86_400_000);
}

// ── The wire stub ───────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
/** Every Google call this test saw, in order. */
let calls = [];

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);

  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    calls.push({ kind: "token" });
    return jsonResponse({ access_token: "stub-access-token", expires_in: 3600 });
  }

  if (url.startsWith("https://www.googleapis.com/youtube/v3/videos")) {
    const method = (init.method || "GET").toUpperCase();
    if (method === "GET") {
      const id = new URL(url).searchParams.get("id");
      calls.push({ kind: "status-read", id });
      if (!EXISTS_ON_YOUTUBE.has(id)) return jsonResponse({ items: [] });
      return jsonResponse({
        items: [{ status: { privacyStatus: "public", madeForKids: false, embeddable: true, license: "youtube" } }],
      });
    }
    const body = JSON.parse(init.body);
    calls.push({ kind: "privacy-write", id: body.id, privacyStatus: body.status?.privacyStatus, status: body.status });
    if (FAIL_NEXT_WRITE) return new Response("quota exceeded", { status: 403 });
    return jsonResponse({ id: body.id, status: body.status });
  }

  // Anything else — including this test's own requests to 127.0.0.1 — is real.
  return realFetch(input, init);
};

let FAIL_NEXT_WRITE = false;
const jsonResponse = (obj) =>
  new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });

// ── A real server ───────────────────────────────────────────────────────────

const app = express();
app.use("/scoop-ops/video", videoOpsRouter);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/scoop-ops/video`;

test.after(() => {
  globalThis.fetch = realFetch;
  server.close();
  try { db.close(); } catch { /* already closed */ }
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const post = async (p) => {
  const res = await realFetch(`${BASE}${p}`, { method: "POST" });
  return { status: res.status, body: await res.json() };
};
const privacyOf = (ytId) =>
  db.prepare("SELECT privacy_status FROM video_posts WHERE youtube_id = ?").get(ytId)?.privacy_status;

function reset() {
  calls = [];
  FAIL_NEXT_WRITE = false;
  db.prepare("UPDATE video_posts SET privacy_status = 'public'").run();
}

// ─── The property the fix exists for ────────────────────────────────────────

test("the video acted on is the one NAMED, not the most recent", async () => {
  reset();
  // Control: the target is deliberately NOT the newest published video.
  const recent = db.prepare(
    "SELECT youtube_id FROM video_posts WHERE status='published' ORDER BY published_at DESC LIMIT 1"
  ).get();
  assert.equal(recent.youtube_id, NEWEST, "fixture: the newest is not the target");

  const { status, body } = await post(`/unlist/${OLDEST}`);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.youtubeId, OLDEST);

  const writes = calls.filter((c) => c.kind === "privacy-write");
  assert.equal(writes.length, 1, "exactly one video was written to");
  assert.equal(writes[0].id, OLDEST, "the id that reached the YouTube API is the one asked for");
  assert.equal(writes[0].privacyStatus, "private");

  // And nothing else moved. This is the collateral the old route could not avoid.
  assert.equal(privacyOf(OLDEST), "private");
  assert.equal(privacyOf(MIDDLE), "public");
  assert.equal(privacyOf(NEWEST), "public");
});

test("the existing status is merged, not replaced", async () => {
  // videos.update REPLACES the whole `status` part. If the route sent
  // privacyStatus alone it would silently clear madeForKids and embeddable —
  // a worse outcome than the incident being recovered from.
  reset();
  await post(`/unlist/${MIDDLE}`);
  const write = calls.find((c) => c.kind === "privacy-write");
  assert.equal(write.status.madeForKids, false);
  assert.equal(write.status.embeddable, true);
  assert.equal(write.status.license, "youtube");
  assert.equal(write.status.privacyStatus, "private");
});

test("unlisted is reachable; public is not", async () => {
  reset();
  const unlisted = await post(`/unlist/${MIDDLE}?privacy=unlisted`);
  assert.equal(unlisted.status, 200);
  assert.equal(privacyOf(MIDDLE), "unlisted");

  reset();
  const republish = await post(`/unlist/${MIDDLE}?privacy=public`);
  assert.equal(republish.status, 400, "a takedown route must not be able to re-publish");
  assert.equal(calls.length, 0, "and it refuses before touching the API");
});

test("a video we hold no row for is still pulled, and says so", async () => {
  // A takedown is about a video on a platform, not about our bookkeeping.
  reset();
  const { status, body } = await post(`/unlist/${UNKNOWN_TO_US}`);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.known, false);
  assert.equal(body.dbRowUpdated, false);
  assert.equal(body.articleId, null);
  assert.equal(calls.find((c) => c.kind === "privacy-write").id, UNKNOWN_TO_US);
});

test("a YouTube failure is a 502 and leaves the row alone", async () => {
  // A row marked private while the video is still public is worse than no row
  // change: it makes the next operator believe the problem is handled.
  reset();
  FAIL_NEXT_WRITE = true;
  const { status, body } = await post(`/unlist/${OLDEST}`);
  assert.equal(status, 502);
  assert.equal(body.ok, false);
  assert.match(body.error, /403/);
  assert.equal(privacyOf(OLDEST), "public", "the DB must not claim a flip that did not happen");
});

test("an id YouTube does not recognise fails loudly rather than flipping something else", async () => {
  reset();
  const { status, body } = await post("/unlist/definitely-not-a-video");
  assert.equal(status, 502);
  assert.match(body.error, /no such video/i);
  assert.equal(calls.filter((c) => c.kind === "privacy-write").length, 0,
    "a bad id must write to nothing at all");
});

test("the response points at the six surfaces that are NOT programmatic", async () => {
  // The finding from the takedown grounding: only YouTube can be retracted by
  // API. An operator reading a 200 here must not conclude the video is gone.
  reset();
  const { body } = await post(`/unlist/${MIDDLE}`);
  for (const surface of ["Facebook", "Instagram", "Threads", "Bluesky", "TikTok", "X"]) {
    assert.match(body.note, new RegExp(surface));
  }
  assert.match(body.note, /incident_takedown\.md/);
});

// ─── The old route is untouched ─────────────────────────────────────────────

test("unlist-recent still flips the last N — the 3am button was not traded away", async () => {
  reset();
  const res = await realFetch(`${BASE}/unlist-recent?n=2`, { method: "POST" });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.flipped, 2);
  const ids = calls.filter((c) => c.kind === "privacy-write").map((c) => c.id);
  assert.deepEqual(ids, [NEWEST, MIDDLE], "newest first, and only two");
  assert.equal(privacyOf(OLDEST), "public");
});

test("the targeted handler does not reach for the recent list", () => {
  // A source-level guard, because the two handlers live in one file and the
  // failure being prevented — a targeted route that quietly resolves its target
  // by recency — would still return 200 and would still flip A video.
  const src = readFileSync(new URL("./video-ops.js", import.meta.url), "utf8");
  const start = src.indexOf('router.post("/unlist/:youtubeId"');
  assert.ok(start > 0, "the targeted route must exist");
  const end = src.indexOf('router.get("/status"', start);
  const handler = src.slice(start, end > 0 ? end : undefined);
  assert.match(handler, /videoPostByYouTubeId\(youtubeId\)/);
  assert.equal(/recentPublishedVideos/.test(handler), false,
    "the targeted route must resolve its target by id, never by recency");
});
