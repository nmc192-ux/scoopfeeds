/**
 * #260: /api/originals — only already-public content reaches the Originals page.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";

// getDb() resolves its data directory at module load, so set it before importing.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-originals-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = dir;

const { makeTestDb } = await import("../../testing/testDb.js");
const { getDb } = await import("../../models/database.js");
const dao = await import("./originalsDao.js");
const originalsRouter = (await import("../../routes/originals.js")).default;

const NOW = Date.now();
const H = 3600_000;

function seed(db) {
  const brief = db.prepare(`INSERT INTO generated_briefs
    (slug, title, thesis, body_md, evidence_json, status, published_at, created_at)
    VALUES (?, ?, 'T', 'B', '[]', ?, ?, ?)`);
  brief.run("draft-brief", "Draft", "draft", null, NOW);
  brief.run("rejected-brief", "Rejected", "rejected", null, NOW);
  for (let i = 0; i < 10; i++) brief.run(`pub-${i}`, `Pub ${i}`, "published", NOW - i * H, NOW - i * H);

  const ex = db.prepare(`INSERT INTO explained_pieces
    (id, slug, title, category, summary, content, image_url, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, 'world', 'S', '<p>secret body</p>', NULL, ?, ?, ?)`);
  ex.run("e-old", "expired", "Expired", NOW - 20 * H, NOW - 20 * H, NOW - 8 * H);
  for (let i = 0; i < 8; i++) ex.run(`e${i}`, `live-${i}`, `Live ${i}`, NOW - i * H, NOW - i * H, NOW + 6 * H);

  const film = db.prepare(`INSERT INTO longform_posts
    (event_id, slug, title, status, youtube_id, privacy_status, publish_at, published_at,
     qc_json, facebook_status, instagram_status, created_at, updated_at)
    VALUES (?, ?, ?, 'done', ?, ?, ?, ?, '{"secret":1}', 'ok', 'ok', ?, ?)`);
  film.run("ev-private",   "private",   "Private",   "yt_priv",  "private",  null,       NOW - H, NOW, NOW);
  film.run("ev-unlisted",  "unlisted",  "Unlisted",  "yt_unl",   "unlisted", null,       NOW - H, NOW, NOW);
  film.run("ev-scheduled", "scheduled", "Scheduled", "yt_sch",   "public",   NOW + 5 * H, NOW - H, NOW, NOW);
  film.run("ev-future",    "future",    "Future",    "yt_fut",   "public",   null,       NOW + H, NOW, NOW);
  film.run("ev-noyt",      "noyt",      "No YT",     null,       "public",   null,       NOW - H, NOW, NOW);
  film.run("ev-draft",     "draft",     "Draft",     "yt_dr",    "public",   null,       null,    NOW, NOW);
  for (let i = 0; i < 8; i++) film.run(`ev-p${i}`, `film-${i}`, `Film ${i}`, `yt_${i}`, "public", NOW - 2 * H, NOW - (i + 1) * H, NOW, NOW);
}

test("DAL: drafts, expired, private/unlisted/scheduled/unpublished/no-youtube films excluded; newest first; capped", () => {
  const { db } = makeTestDb({ prefix: "scoop-originals-dal-" });
  seed(db);
  const out = dao.listOriginals({ now: NOW, db });

  assert.equal(out.analysis.length, dao.ORIGINALS_LIMITS.analysis);
  assert.deepEqual(out.analysis.map(b => b.slug), [0, 1, 2, 3, 4, 5, 6, 7].map(i => `pub-${i}`));

  assert.equal(out.explained.length, dao.ORIGINALS_LIMITS.explained);
  assert.deepEqual(out.explained.map(e => e.slug), [0, 1, 2, 3, 4, 5].map(i => `live-${i}`));
  assert.ok(out.explained.every(e => !("content" in e)));

  assert.equal(out.stories.length, dao.ORIGINALS_LIMITS.stories);
  assert.deepEqual(out.stories.map(f => f.slug), [0, 1, 2, 3, 4, 5].map(i => `film-${i}`));
  for (const f of out.stories) {
    assert.deepEqual(Object.keys(f).sort(), ["published_at", "slug", "title", "youtube_id"]);
  }
});

test("DAL: empty database → three empty lists", () => {
  const { db } = makeTestDb({ prefix: "scoop-originals-empty-" });
  assert.deepEqual(dao.listOriginals({ now: NOW, db }), { analysis: [], explained: [], stories: [] });
});

test("GET /api/originals returns the three lists with no internal film fields", async () => {
  seed(getDb());
  const app = express();
  app.use("/api/originals", originalsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/originals`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") || "", /max-age=120/);
    const text = await res.text();
    for (const leak of ["qc_json", "secret", "facebook_status", "instagram_status", "privacy_status", "yt_priv", "yt_unl", "yt_sch", "yt_fut", "draft-brief"]) {
      assert.ok(!text.includes(leak), `response leaked ${leak}`);
    }
    const body = JSON.parse(text);
    assert.deepEqual(Object.keys(body).sort(), ["analysis", "explained", "stories"]);
    assert.equal(body.stories[0].youtube_id, "yt_0");
  } finally {
    server.close();
  }
});
