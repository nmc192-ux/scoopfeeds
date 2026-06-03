/**
 * bylineCrossCheck.test.js — B.6.2b-4 tests (node --test, offline).
 *
 * detectByline (signal priority incl. JSON-LD + Organization-skip), the
 * cross-check module (Q6 upgrade / Q7 honest-low terminal / skip-when-evidenced
 * / all-fetch-fail stays pending / budget ≤5), and the runner null no-op sentinel.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseHtml } from "./httpFetch.js";
import { detectByline } from "./bylineDetect.js";
import { getEvidence, upsertEvidence } from "./evidenceCache.js";
import { gatherForSource } from "./runner.js";
import { runMigrations } from "../../../db/migrate.js";
import xcheck from "./modules/bylineCrossCheck_2_1_c.js";

const NOW = Date.now();
const doc = (h) => parseHtml(h);

// ── detectByline ──────────────────────────────────────────────────────────────
test("detectByline — meta[name=author]", () => {
  const r = detectByline(doc('<html><head><meta name="author" content="Jane Doe"></head><body></body></html>'));
  assert.equal(r.found, true); assert.equal(r.signal, "meta-author"); assert.equal(r.value, "Jane Doe");
});

test("detectByline — JSON-LD person author (the BBC case)", () => {
  const r = detectByline(doc('<html><head><script type="application/ld+json">{"@type":"NewsArticle","author":{"@type":"Person","name":"Bob Smith"}}</script></head><body></body></html>'));
  assert.equal(r.found, true); assert.equal(r.signal, "jsonld-author"); assert.equal(r.value, "Bob Smith");
});

test("detectByline — JSON-LD @graph + author array", () => {
  const r = detectByline(doc('<html><head><script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"NewsArticle","author":[{"name":"A. Writer"}]}]}</script></head><body></body></html>'));
  assert.equal(r.found, true); assert.equal(r.signal, "jsonld-author"); assert.equal(r.value, "A. Writer");
});

test("detectByline — JSON-LD Organization author is SKIPPED (publisher ≠ reporter byline)", () => {
  const r = detectByline(doc('<html><head><script type="application/ld+json">{"@type":"NewsArticle","author":{"@type":"Organization","name":"BBC News"}}</script></head><body><p>no byline</p></body></html>'));
  assert.equal(r.found, false);
});

test("detectByline — itemprop / rel / class", () => {
  assert.equal(detectByline(doc('<html><body><span itemprop="author"><span itemprop="name">Carl</span></span></body></html>')).signal, "itemprop-author");
  assert.equal(detectByline(doc('<html><body><a rel="author">Dana</a></body></html>')).signal, "rel-author");
  assert.equal(detectByline(doc('<html><body><p class="byline">By Eve</p></body></html>')).signal, "class-byline");
});

test("detectByline — no markup → not found; priority: meta beats class", () => {
  assert.equal(detectByline(doc('<html><body><p>just a story</p></body></html>')).found, false);
  const r = detectByline(doc('<html><head><meta name="author" content="Meta Wins"></head><body><p class="byline">By Class</p></body></html>'));
  assert.equal(r.signal, "meta-author");
});

// ── cross-check module (temp DB + injected transport) ─────────────────────────
function makeEnv(articleRoute, counter) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-bx-"));
  const db = new Database(path.join(dir, "t.db"));
  runMigrations(db);
  db.exec(`CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, url TEXT, source_name TEXT NOT NULL, published_at INTEGER NOT NULL, is_duplicate INTEGER DEFAULT 0);`);
  const sid = db.prepare(`INSERT INTO sources (name,url,source_type,category,region,created_at,updated_at) VALUES ('PendSrc','https://feeds.pendsrc.example/rss','rss','tech','global',?,?)`).run(NOW, NOW).lastInsertRowid;
  const ins = db.prepare(`INSERT INTO articles (id,url,source_name,published_at,is_duplicate) VALUES (?,?,?,?,0)`);
  for (let i = 0; i < 6; i++) ins.run(`p${i}`, `https://pendsrc.example/news/${i}`, "PendSrc", NOW - i * 86400000);
  const transport = async (url, opts) => {
    if (!url.endsWith("/robots.txt") && counter) counter.n += 1;
    const r = url.endsWith("/robots.txt") ? { status: 404 } : articleRoute(url);
    if (opts.validateStatus && !opts.validateStatus(r.status)) { const e = new Error(`s${r.status}`); e.response = { status: r.status }; throw e; }
    return { status: r.status, data: r.data ?? "", headers: { "content-type": "text/html" }, finalUrl: url };
  };
  const cleanup = () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { db, sid, transport, cleanup, dir };
}
const PENDING_211C = { status: "pending", value: { ratio: 0, bylined: 0, sampled: 20, bucket: "inconclusive", signal: "rss-metadata-gap" }, confidence: 0, evidenceUrl: null, gatheredAt: NOW };
const LD = (name) => ({ status: 200, data: `<html><head><script type="application/ld+json">{"@type":"NewsArticle","author":{"@type":"Person","name":"${name}"}}</script></head><body>story</body></html>` });
const PLAIN = { status: 200, data: "<html><head><title>News</title></head><body><p>story</p></body></html>" };

test("Q6 — pending source, article pages ARE bylined → upgraded to evidenced via article-page, ratio recorded", async () => {
  const counter = { n: 0 };
  const env = makeEnv(() => LD("Reporter X"), counter);
  upsertEvidence(env.sid, "2.1.c", PENDING_211C, "v1.1", env.db);
  const ret = await xcheck.gather({ id: env.sid, name: "PendSrc" }, { db: env.db, now: NOW, transport: env.transport, methodologyVersion: "v1.1" });
  assert.equal(ret, null, "gather upserts 2.1.c directly and returns null");
  const ev = getEvidence(env.sid, "2.1.c", env.db);
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.via, "article-page");
  assert.equal(ev.value.ratio, 1);
  assert.ok(ev.confidence > 0.5);
  assert.ok(counter.n <= 5, `budget: ≤5 article fetches (got ${counter.n})`);
  env.cleanup();
});

test("Q7 — pending source, NO byline markup on pages → honest LOW-confidence evidenced (never never/pending/pending-llm)", async () => {
  const env = makeEnv(() => PLAIN);
  upsertEvidence(env.sid, "2.1.c", PENDING_211C, "v1.1", env.db);
  await xcheck.gather({ id: env.sid, name: "PendSrc" }, { db: env.db, now: NOW, transport: env.transport, methodologyVersion: "v1.1" });
  const ev = getEvidence(env.sid, "2.1.c", env.db);
  assert.equal(ev.status, "evidenced");           // NOT pending, NOT pending-llm
  assert.equal(ev.value.ratio, 0);
  assert.equal(ev.value.flag, "rss-and-page-both-absent");
  assert.notEqual(ev.value.bucket, "never");       // never a confident "never"
  assert.ok(ev.confidence <= 0.3, `honest low confidence (got ${ev.confidence})`);
  env.cleanup();
});

test("skip — already-evidenced 2.1.c (RSS) → no-op, ZERO article fetches", async () => {
  const counter = { n: 0 };
  const env = makeEnv(() => LD("Should Not Fetch"), counter);
  upsertEvidence(env.sid, "2.1.c", { status: "evidenced", value: { ratio: 0.9, bucket: "usually" }, confidence: 0.9, evidenceUrl: null, gatheredAt: NOW }, "v1.1", env.db);
  const ret = await xcheck.gather({ id: env.sid, name: "PendSrc" }, { db: env.db, now: NOW, transport: env.transport, methodologyVersion: "v1.1" });
  assert.equal(ret, null);
  assert.equal(counter.n, 0, "no article-page fetches for an already-evidenced source");
  assert.equal(getEvidence(env.sid, "2.1.c", env.db).value.ratio, 0.9, "RSS evidence untouched");
  env.cleanup();
});

test("all-fetch-fail — every article page blocked → 2.1.c STAYS pending (fetch failure is not byline absence)", async () => {
  const env = makeEnv(() => ({ status: 403 }));
  upsertEvidence(env.sid, "2.1.c", PENDING_211C, "v1.1", env.db);
  await xcheck.gather({ id: env.sid, name: "PendSrc" }, { db: env.db, now: NOW, transport: env.transport, methodologyVersion: "v1.1" });
  assert.equal(getEvidence(env.sid, "2.1.c", env.db).status, "pending", "couldn't complete the check → leave pending, retry next run");
  env.cleanup();
});

test("publisher-name guard — pages whose author == source name are NOT counted → Q7 publisher-name-author-only", async () => {
  // Every page stamps the outlet's own name (the Al Jazeera case).
  const env = makeEnv(() => LD("PendSrc"));
  upsertEvidence(env.sid, "2.1.c", PENDING_211C, "v1.1", env.db);
  await xcheck.gather({ id: env.sid, name: "PendSrc" }, { db: env.db, now: NOW, transport: env.transport, methodologyVersion: "v1.1" });
  const ev = getEvidence(env.sid, "2.1.c", env.db);
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.ratio, 0, "publisher-name authors don't count as reporter bylines");
  assert.equal(ev.value.bylined, 0);
  assert.equal(ev.value.publisherStamped, 5);
  assert.equal(ev.value.flag, "publisher-name-author-only");
  assert.ok(ev.confidence <= 0.3);
  env.cleanup();
});

test("publisher-name guard — MIX (3 reporter-named, 2 publisher-stamped) → ratio counts only reporters", async () => {
  const route = (url) => {
    const i = Number(url.match(/\/news\/(\d+)/)?.[1] ?? 9);
    return i < 3 ? LD(`Real Reporter ${i}`) : LD("PendSrc"); // 0,1,2 reporters; 3,4 publisher
  };
  const env = makeEnv(route);
  upsertEvidence(env.sid, "2.1.c", PENDING_211C, "v1.1", env.db);
  await xcheck.gather({ id: env.sid, name: "PendSrc" }, { db: env.db, now: NOW, transport: env.transport, methodologyVersion: "v1.1" });
  const ev = getEvidence(env.sid, "2.1.c", env.db);
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.bylined, 3, "only reporter-named pages count");
  assert.equal(ev.value.publisherStamped, 2);
  assert.equal(ev.value.sampled, 5);
  assert.equal(ev.value.ratio, 0.6);
  env.cleanup();
});

// ── runner null no-op sentinel ────────────────────────────────────────────────
test("runner — a module returning null is a no-op (no upsert, no cache row, no throw)", async () => {
  const env = makeEnv(() => PLAIN);
  const nullMod = { id: "fake.null", component: "ET", ttlDays: 30, gather: () => null };
  const res = await gatherForSource({ id: env.sid, name: "PendSrc" }, { db: env.db, now: NOW, modules: [nullMod] });
  assert.equal(res[0].noop, true);
  assert.equal(getEvidence(env.sid, "fake.null", env.db), null, "no cache row written for a no-op module");
  env.cleanup();
});
