import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTestDb } from "../testing/testDb.js";
import { syncSourcesFromConfig } from "./sourceSync.js";
import { RSS_SOURCES, YOUTUBE_SOURCES } from "../config/sources.js";

const rowsOf = (db) => db.prepare("SELECT * FROM sources ORDER BY id").all();

test("bootstrapSchema gives every config/sources.js entry a sources row", () => {
  const { db } = makeTestDb();
  const urls = new Set(db.prepare("SELECT url FROM sources WHERE source_type='rss'").all().map((r) => r.url));
  const chans = new Set(db.prepare("SELECT channel_id FROM sources WHERE source_type='youtube'").all().map((r) => r.channel_id));
  for (const s of RSS_SOURCES) assert.ok(urls.has(s.url), `missing rss row: ${s.name}`);
  for (const s of YOUTUBE_SOURCES) assert.ok(chans.has(s.channelId), `missing youtube row: ${s.name}`);
});

test("a missing entry is inserted; existing rows stay byte-identical", () => {
  const { db } = makeTestDb();
  // An existing row the scorer already wrote to: the sync must not touch it.
  db.prepare("UPDATE sources SET quality_score = 71, category = 'hand-edited', updated_at = 1 WHERE url = ?").run(RSS_SOURCES[0].url);
  const before = rowsOf(db);
  const added = { name: "Brand New Outlet", url: "https://example.org/feed.xml", category: "top", region: "uk", credibility: 7 };
  const r = syncSourcesFromConfig(db, { rss: [...RSS_SOURCES, added], youtube: YOUTUBE_SOURCES, now: 123 });
  assert.equal(r.inserted, 1);
  const after = rowsOf(db);
  assert.deepEqual(after.slice(0, before.length), before);   // every existing row unchanged
  const row = after.at(-1);
  assert.equal(row.url, added.url);
  assert.equal(row.source_type, "rss");
  assert.equal(row.region, "uk");
  assert.equal(row.credibility_legacy, 7);
  assert.equal(row.quality_score, null);   // new and unscored
});

test("the sync is idempotent", () => {
  const { db } = makeTestDb();
  const before = rowsOf(db);
  assert.equal(syncSourcesFromConfig(db).inserted, 0);
  assert.deepEqual(rowsOf(db), before);
});

test("the sync never issues UPDATE or DELETE (stop-list item 1)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("./sourceSync.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(src, /\b(UPDATE|DELETE|DROP|REPLACE)\b/);
});

test("every RSS_SOURCES url and every YOUTUBE_SOURCES channel is unique", () => {
  const urls = RSS_SOURCES.map((s) => s.url);
  assert.equal(new Set(urls).size, urls.length, `duplicate urls: ${urls.filter((u, i) => urls.indexOf(u) !== i)}`);
  const ch = YOUTUBE_SOURCES.map((s) => s.channelId);
  assert.equal(new Set(ch).size, ch.length);
});
