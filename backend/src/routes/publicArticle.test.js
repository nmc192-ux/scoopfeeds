/**
 * #176: no public article endpoint returns the stored publisher body.
 *
 * Real: an express app, the real news router, real HTTP on a local socket, and a
 * temp SQLite database through the real `database.js`. The fixture's `content`
 * is a marker string, so any route that leaks the column fails on the marker,
 * whatever the key is called.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import http from "http";
import { toPublicArticle, toPublicArticles, BODY_FIELDS } from "./publicArticle.js";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "public-article-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = DATA_DIR;

const MARKER = "FULL-PUBLISHER-BODY-MARKER";

test("toPublicArticle drops body fields and caps the description at 3 sentences", () => {
  const out = toPublicArticle({
    id: "a1", title: "T", url: "https://x.test/a", content: `<p>${MARKER}</p>`,
    description: "One. Two. Three. Four. Five.",
  });
  for (const k of BODY_FIELDS) assert.ok(!(k in out), `${k} must not be exposed`);
  assert.equal(out.description, "One. Two. Three.");
  assert.equal(out.title, "T");
  assert.ok(!JSON.stringify(out).includes(MARKER));
});

test("toPublicArticle leaves non-objects and lists alone", () => {
  assert.equal(toPublicArticle(null), null);
  assert.equal(toPublicArticle(undefined), undefined);
  assert.deepEqual(toPublicArticles([]), []);
  assert.equal(toPublicArticles(null), null);
});

test("/api/news, /api/news/featured and /api/news/:id carry no article body", async () => {
  const express = (await import("express")).default;
  const { default: newsRouter } = await import("./news.js");
  const { getDb } = await import("../models/database.js");

  const db = getDb();
  const now = Date.now();
  db.prepare(`INSERT INTO articles (id, title, description, content, url, source_name, category, published_at, fetched_at, credibility, is_featured)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("pa-1", "A headline", "First. Second. Third. Fourth.", `<p>${MARKER}</p>`.repeat(5),
         "https://publisher.test/story", "Publisher", "top", now, now, 9, 1);

  const app = express();
  app.use("/api/news", newsRouter);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/api/news`;
  try {
    for (const u of [`${base}/pa-1`, `${base}?limit=10`, `${base}/featured`]) {
      const res = await fetch(u);
      const text = await res.text();
      assert.equal(res.status, 200, `${u} → ${res.status} ${text.slice(0, 200)}`);
      assert.ok(!text.includes(MARKER), `${u} leaked the stored body`);
      const body = JSON.parse(text);
      const rows = Array.isArray(body.data) ? body.data : [body.data];
      assert.ok(rows.some((r) => r?.id === "pa-1"), `${u} did not return the fixture`);
      for (const r of rows) {
        assert.ok(!("content" in r), `${u} returned a content key`);
        if (r.id === "pa-1") assert.equal(r.description, "First. Second. Third.");
      }
    }
  } finally {
    server.close();
  }
});
