/**
 * #178: every route's own head tags, for every user agent; dossier sitemaps; llms.txt.
 *
 * Real: an express app with the real seo router and the real SPA catch-all (spaShellHandler, the
 * same function server.js mounts), real HTTP on a local socket, a temp SQLite DB through the real
 * database.js, and the real frontend/index.html as the shell. Nothing is mocked.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "spa-head-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = DATA_DIR;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(DATA_DIR, "index.html");
copyFileSync(path.join(HERE, "../../../frontend/index.html"), INDEX);

const { headFor, injectHead, canonicalPath } = await import("./spaHead.js");

const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const one = (html, re) => { const m = html.match(re); return m ? m[1] : null; };
const titleOf = (h) => one(h, /<title>([^<]*)<\/title>/);
const canonicalOf = (h) => one(h, /<link rel="canonical" href="([^"]*)"/);
const robotsOf = (h) => one(h, /<meta name="robots" content="([^"]*)"/);

test("headFor: two different routes never share a canonical", () => {
  const lookup = { event: (s) => ({ title: `Story ${s}`, outlets: 3 }), brief: (s) => ({ title: `Brief ${s}`, thesis: "One. Two. Three." }) };
  const paths = ["/", "/events", "/events/a", "/events/b", "/topic/ai", "/topic/world", "/topic/ai/US", "/briefs", "/briefs/x",
    "/search", "/saved", "/markets", "/live-tv", "/about", "/source/reuters", "/weather", "/some/unknown/path"];
  const canon = paths.map((p) => headFor(p, lookup).canonical);
  assert.equal(new Set(canon).size, paths.length, canon.join("\n"));
  // the query string never changes the canonical, and a trailing slash is the same route
  assert.equal(headFor("/events/a?ref=x", lookup).canonical, headFor("/events/a/", lookup).canonical);
  assert.equal(canonicalPath("/topic/ai/?x=1"), "/topic/ai");
});

test("headFor: search and saved are noindex; a missing dossier is noindex; a merged one points at its survivor", () => {
  assert.equal(headFor("/search").robots, "noindex,follow");
  assert.equal(headFor("/saved").robots, "noindex,follow");
  assert.equal(headFor("/events/gone", { event: () => null }).robots, "noindex,follow");
  const m = headFor("/events/old", { event: () => ({ title: "T", outlets: 2, mergedIntoSlug: "survivor" }) });
  assert.equal(m.canonical, "https://scoopfeeds.com/events/survivor");
  assert.equal(headFor("/").robots, "index,follow");
});

test("headFor: the dossier title is the headline plus the outlet count; the description is mechanical", () => {
  const h = headFor("/events/q", { event: () => ({ title: "Quake hits Japan", outlets: 7 }) });
  assert.equal(h.title, "Quake hits Japan · 7 outlets · Scoopfeeds");
  assert.equal(h.description, "Quake hits Japan: the timeline, and how 7 outlets covered it.");
});

test("injectHead replaces the homepage's tags once, escapes, and leaves the body alone", () => {
  const html = `<!doctype html><html><head><title>Home</title><meta name="description" content="home" /><link rel="canonical" href="https://scoopfeeds.com" /><link rel="alternate" hreflang="ur" href="x" /></head><body><div id="root"></div></body></html>`;
  const out = injectHead(html, { title: `A "quoted" <b>`, description: "d", canonical: "https://scoopfeeds.com/events/a", robots: "index,follow" });
  assert.equal((out.match(/<title>/g) || []).length, 1);
  assert.equal((out.match(/rel="canonical"/g) || []).length, 1);
  assert.ok(!out.includes("hreflang"));
  assert.ok(out.includes("<title>A &quot;quoted&quot; &lt;b&gt;</title>"));
  assert.ok(out.endsWith(`<body><div id="root"></div></body></html>`));
});

test("server: a browser user agent gets each dossier's own title and canonical; sitemaps and llms.txt list real dossiers", async () => {
  const express = (await import("express")).default;
  const { default: seoRouter } = await import("./seo.js");
  const { spaShellHandler } = await import("./spaHead.js");
  const { getDb } = await import("../models/database.js");

  const db = getDb();
  const now = Date.now();
  const ins = db.prepare(`INSERT INTO events (id, slug, title, category, status, started_at, last_activity_at, created_at, updated_at, meta)
                          VALUES (?, ?, ?, 'top', ?, ?, ?, ?, ?, ?)`);
  ins.run("e1", "senate-vote", "Senate passes the budget", "active", now, now - 3600_000, now, now, null);
  ins.run("e2", "port-strike", "Port strike spreads", "active", now, now - 3 * 86400_000, now, now, null);
  ins.run("e3", "usgs-quake", "M5.1 quake", "active", now, now, now, now, null);                    // machine event: no articles
  ins.run("e4", "old-slug", "Senate budget vote", "merged", now, now, now, now, JSON.stringify({ merged_into_slug: "senate-vote" }));
  const art = db.prepare(`INSERT INTO articles (id, title, url, source_name, category, published_at, fetched_at) VALUES (?, ?, ?, ?, 'top', ?, ?)`);
  const link = db.prepare(`INSERT INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?, ?, 1.0, ?)`);
  [["a1", "Reuters", "e1"], ["a2", "AP", "e1"], ["a3", "BBC", "e1"], ["a4", "AP", "e2"], ["a5", "AP", "e4"]].forEach(([id, src, ev]) => {
    art.run(id, `t ${id}`, `https://x.test/${id}`, src, now, now); link.run(ev, id, now);
  });

  const app = express();
  app.use("/", seoRouter);
  app.get(/^(?!\/api)/, spaShellHandler({ indexFile: INDEX, getDb, log: { warn() {} } }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, ua = BROWSER) => { const r = await fetch(base + p, { headers: { "user-agent": ua } }); return { status: r.status, text: await r.text() }; };
  try {
    const a = await get("/events/senate-vote");
    assert.equal(a.status, 200);
    assert.equal(titleOf(a.text), "Senate passes the budget · 3 outlets · Scoopfeeds");
    assert.equal(canonicalOf(a.text), "https://scoopfeeds.com/events/senate-vote");
    assert.ok(a.text.includes('<div id="root">'), "the SPA body is served");

    const b = await get("/events/port-strike", "curl/8.4.0");   // not in the bot whitelist: same treatment
    assert.equal(titleOf(b.text), "Port strike spreads · 1 outlet · Scoopfeeds");
    assert.notEqual(canonicalOf(b.text), canonicalOf(a.text));

    assert.equal(canonicalOf((await get("/events/old-slug")).text), "https://scoopfeeds.com/events/senate-vote");
    assert.equal(robotsOf((await get("/search?q=budget")).text), "noindex,follow");
    assert.equal(robotsOf((await get("/saved")).text), "noindex,follow");

    const topic = await get("/topic/world", "Googlebot/2.1");   // no SSR hub: bots get the shell, not a 404
    assert.equal(topic.status, 200);
    assert.equal(titleOf(topic.text), "World — latest stories · Scoopfeeds");
    assert.equal(canonicalOf(topic.text), "https://scoopfeeds.com/topic/world");

    const sm = (await get("/sitemap.xml")).text;
    assert.ok(sm.includes("/events/senate-vote</loc>"));
    // #243: port-strike has one outlet, so the reader-eligibility rules keep it out of the sitemap
    // (its dossier still answers by URL, above). With the rules off it is listed as before.
    assert.ok(!sm.includes("/events/port-strike</loc>"), "single-outlet events are not listed");
    process.env.EVENT_READER_ELIGIBILITY = "false";
    try { assert.ok((await get("/sitemap.xml")).text.includes("/events/port-strike</loc>")); }
    finally { delete process.env.EVENT_READER_ELIGIBILITY; }
    assert.ok(!sm.includes("usgs-quake") && !sm.includes("old-slug"), "machine and merged events are not listed");
    assert.ok(!sm.includes("/article/"), "noindex article pages are not listed");
    const news = (await get("/sitemap-news.xml")).text;
    assert.ok(news.includes("/events/senate-vote</loc>"));
    assert.ok(!news.includes("port-strike"), "older than 48 h");
    const llms = await get("/llms.txt");
    assert.equal(llms.status, 200);
    assert.match(llms.text, /^# Scoopfeeds/);
    assert.ok(llms.text.includes("[News](https://scoopfeeds.com/events)"));
    assert.ok(llms.text.includes("[Senate passes the budget](https://scoopfeeds.com/events/senate-vote)"));
    assert.ok(!llms.text.includes("usgs-quake"));
  } finally {
    server.close();
  }
});
