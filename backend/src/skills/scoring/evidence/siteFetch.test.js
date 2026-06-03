/**
 * siteFetch.test.js — B.6.2b-1 foundation tests (node --test, offline).
 *
 * Network is never touched: fetchRaw takes an injected ctx.transport, so robots
 * + page fetches are served from canned responses. Covers the SSRF guard, error
 * taxonomy, robots parser (allow/deny/crawl-delay/default-allow), the
 * editorial-domain resolver (feed-host ≠ editorial-domain), the per-source
 * budget, and robots-disallow enforcement in the fetch primitive.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isSafeUrl, classifyError } from "./httpFetch.js";
import { parseRobots, loadRobots } from "./robots.js";
import { resolveEditorialDomain } from "./domainResolver.js";
import { openSite } from "./siteFetch.js";

// ── A faithful axios-like transport mock: honors validateStatus (throws on 4xx
//    like axios does), routes by URL. ──────────────────────────────────────────
function makeTransport(routeFn) {
  return async (url, opts) => {
    const r = routeFn(url) || { status: 404, data: "" };
    if (opts.validateStatus && !opts.validateStatus(r.status)) {
      const e = new Error(`status ${r.status}`);
      e.response = { status: r.status };
      throw e;
    }
    return { status: r.status, data: r.data ?? "", headers: r.headers ?? { "content-type": "text/html" }, finalUrl: url };
  };
}

// ── SSRF guard ────────────────────────────────────────────────────────────────
test("isSafeUrl — allows public https, rejects localhost/private/non-http", () => {
  assert.equal(isSafeUrl("https://www.bbc.com/news"), true);
  assert.equal(isSafeUrl("http://example.org/"), true);
  assert.equal(isSafeUrl("http://localhost/x"), false);
  assert.equal(isSafeUrl("http://127.0.0.1/"), false);
  assert.equal(isSafeUrl("http://10.0.0.5/"), false);
  assert.equal(isSafeUrl("http://192.168.1.1/"), false);
  assert.equal(isSafeUrl("http://172.16.0.1/"), false);
  assert.equal(isSafeUrl("http://169.254.1.1/"), false);
  assert.equal(isSafeUrl("ftp://example.org/"), false);
  assert.equal(isSafeUrl("file:///etc/passwd"), false);
  assert.equal(isSafeUrl("not a url"), false);
});

// ── Error taxonomy ──────────────────────────────────────────────────────────
test("classifyError — maps representative errors", () => {
  assert.equal(classifyError({ response: { status: 403 } }).kind, "blocked");
  assert.equal(classifyError({ response: { status: 404 } }).kind, "not-found");
  assert.equal(classifyError({ response: { status: 429 } }).kind, "rate-limited");
  assert.equal(classifyError({ response: { status: 500 } }).kind, "server-error");
  assert.equal(classifyError({ code: "ETIMEDOUT" }).kind, "timeout");
  assert.equal(classifyError({ code: "ENOTFOUND" }).kind, "dns");
  assert.equal(classifyError({ code: "UNSAFE_URL" }).kind, "unsafe-url");
});

// ── robots parser ─────────────────────────────────────────────────────────────
test("parseRobots — Disallow/Allow/Crawl-delay against the * group", () => {
  const r = parseRobots("User-agent: *\nDisallow: /private\nCrawl-delay: 5");
  assert.equal(r.isAllowed("/about"), true);
  assert.equal(r.isAllowed("/private/x"), false);
  assert.equal(r.crawlDelay, 5);
});

test("parseRobots — empty/missing → allow everything", () => {
  assert.equal(parseRobots("").isAllowed("/anything"), true);
  assert.equal(parseRobots("# just a comment").isAllowed("/x"), true);
});

test("parseRobots — Allow overrides a broader Disallow (longest match)", () => {
  const r = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a/ok");
  assert.equal(r.isAllowed("/a/ok/page"), true);
  assert.equal(r.isAllowed("/a/no"), false);
});

test("parseRobots — UA-specific group ignored for our browser UA; '*' applies", () => {
  const txt = "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin";
  const r = parseRobots(txt, "*");
  assert.equal(r.isAllowed("/news"), true);   // not subject to Googlebot's blanket block
  assert.equal(r.isAllowed("/admin/x"), false);
});

test("loadRobots — 404 robots.txt → default-allow", async () => {
  const transport = makeTransport((u) => (u.endsWith("/robots.txt") ? { status: 404 } : { status: 200, data: "" }));
  const robots = await loadRobots("https://x.example", { transport });
  assert.equal(robots.basis, "default-allow");
  assert.equal(robots.isAllowed("/anything"), true);
});

test("loadRobots — served robots.txt with Disallow is honored", async () => {
  const transport = makeTransport((u) =>
    u.endsWith("/robots.txt") ? { status: 200, data: "User-agent: *\nDisallow: /admin" } : { status: 200, data: "<html></html>" });
  const robots = await loadRobots("https://x.example", { transport });
  assert.equal(robots.basis, "robots.txt");
  assert.equal(robots.isAllowed("/admin/secret"), false);
  assert.equal(robots.isAllowed("/about"), true);
});

// ── domainResolver (temp DB; the feed-host ≠ editorial-domain case) ────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-sf-"));
const db = new Database(path.join(dir, "t.db"));
db.exec(`CREATE TABLE articles (id TEXT PRIMARY KEY, url TEXT, source_name TEXT NOT NULL, published_at INTEGER NOT NULL, is_duplicate INTEGER DEFAULT 0);`);
const insA = db.prepare(`INSERT INTO articles (id, url, source_name, published_at, is_duplicate) VALUES (?,?,?,?,0)`);
// "BBCt": feed is feeds.bbci.co.uk, but 8 articles on www.bbc.com + 2 stray feed-host links.
for (let i = 0; i < 8; i++) insA.run(`bbc-${i}`, `https://www.bbc.com/news/${i}`, "BBCt", 1000 + i);
for (let i = 0; i < 2; i++) insA.run(`bbcfeed-${i}`, `https://feeds.bbci.co.uk/x/${i}`, "BBCt", 900 + i);
// "Empty": no articles.

test("resolveEditorialDomain — returns the editorial host (www.bbc.com), not the feed host", () => {
  const d = resolveEditorialDomain({ name: "BBCt" }, { db });
  assert.equal(d.host, "www.bbc.com");
  assert.equal(d.registrable, "bbc.com");
  assert.equal(d.basis, "articles");
  assert.ok(!/feeds\./.test(d.host), "must not be a feed host");
});

test("resolveEditorialDomain — no article URLs → null (no feed-host guessing)", () => {
  assert.equal(resolveEditorialDomain({ name: "Empty" }, { db }), null);
});

// ── openSite: budget + robots-disallow enforcement (mocked transport) ──────────
test("openSite — resolves domain, enforces per-source budget", async () => {
  const transport = makeTransport((u) =>
    u.endsWith("/robots.txt") ? { status: 404 } : { status: 200, data: "<html><body><a href='/about'>About</a></body></html>" });
  const site = await openSite({ name: "BBCt" }, { db, transport, maxFetchesPerSource: 2 });
  assert.equal(site.ok, true);
  assert.equal(site.host, "www.bbc.com");

  const a = await site.fetch("/about");
  assert.equal(a.ok, true);
  assert.ok(a.doc.querySelector("a"), "parsed linkedom doc is queryable");

  const b = await site.fetch("/ethics");
  assert.equal(b.ok, true);

  const c = await site.fetch("/standards");
  assert.equal(c.ok, false);
  assert.equal(c.reason, "budget-exhausted");
  assert.equal(site.fetchesUsed(), 2);
});

test("openSite — robots-disallow path is not fetched", async () => {
  const transport = makeTransport((u) =>
    u.endsWith("/robots.txt") ? { status: 200, data: "User-agent: *\nDisallow: /admin" } : { status: 200, data: "<html></html>" });
  const site = await openSite({ name: "BBCt" }, { db, transport, maxFetchesPerSource: 10 });
  const blocked = await site.fetch("/admin/users");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "robots-disallow");
  const ok = await site.fetch("/about");
  assert.equal(ok.ok, true);
});

test("openSite — no editorial domain → unavailable handle", async () => {
  const site = await openSite({ name: "Empty" }, { db });
  assert.equal(site.ok, false);
  assert.equal(site.reason, "no-editorial-domain");
  const r = await site.fetch("/about");
  assert.equal(r.ok, false);
});

test.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
