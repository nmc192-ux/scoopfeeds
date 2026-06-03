/**
 * presenceDetector.test.js — B.6.2b-2b tests (node --test, offline).
 *
 * Factory: the Q1 nav-vs-guess asymmetry (nav-found NEVER demotes to pending;
 * unconfirmed guess NEVER becomes evidenced), plus discovery-unavailable/blocked
 * mapping. Pre-pass: discovery runs once when a scrape detector is stale, is
 * skipped when all fresh, and own-DB modules run regardless. Plus 5-config
 * smoke + the corrections single-row check + the evidence-only invariant.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseHtml } from "./httpFetch.js";
import { makePresenceDetector } from "./presenceDetector.js";
import { EVIDENCE_MODULES } from "./registry.js";
import { gatherForSource } from "./runner.js";
import { runMigrations } from "../../../db/migrate.js";
import standards_2_1_b from "./modules/standards_2_1_b.js";
import correctionsPresence from "./modules/correctionsPresence.js";

const NOW = Date.now();
const det = makePresenceDetector({ id: "test.std", component: "ET", pageType: "standards", confirmKeywords: ["ethics", "editorial standards", "accuracy"] });

const ethicsDoc = parseHtml("<html><head><title>Editorial Standards</title></head><body><h1>Our Ethics</h1><p>We value accuracy and impartiality.</p></body></html>");
const genericDoc = parseHtml("<html><head><title>Welcome</title></head><body><p>Latest news.</p></body></html>");
const fakeSite = (routeFn) => ({ fetch: async (u) => routeFn(u) });
const navDisc = (cands, site) => ({ ok: true, site, candidates: { standards: cands } });

// ── Q1 asymmetry ──────────────────────────────────────────────────────────────
test("nav-advertised + confirm success → EVIDENCED, high confidence, via nav", async () => {
  const site = fakeSite(() => ({ ok: true, doc: ethicsDoc, finalUrl: "https://x.com/ethics" }));
  const disc = navDisc([{ url: "https://x.com/ethics", source: "nav", linkText: "Ethics" }], site);
  const ev = await det.gather({ id: 1, name: "X" }, { now: NOW, discovery: disc });
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.via, "nav");
  assert.equal(ev.value.confirmed, true);
  assert.ok(ev.confidence >= 0.7);
});

test("nav-advertised + confirm-MISS (budget-exhausted) → STILL evidenced, low conf + flag (NEVER pending)", async () => {
  const site = fakeSite(() => ({ ok: false, reason: "budget-exhausted" }));
  const disc = navDisc([{ url: "https://x.com/ethics", source: "nav", linkText: "Ethics" }], site);
  const ev = await det.gather({ id: 1, name: "X" }, { now: NOW, discovery: disc });
  assert.equal(ev.status, "evidenced");          // ← the asymmetry: not pending
  assert.notEqual(ev.status, "pending");
  assert.equal(ev.confidence, 0.4);
  assert.equal(ev.value.flag, "nav-advertised-unconfirmed");
  assert.equal(ev.value.fetchReason, "budget-exhausted");
});

test("nav-advertised + fetch ok but confirmPage FALSE (thin body, non-keyword slug) → STILL evidenced low (NEVER pending)", async () => {
  // Nav link labelled "Ethics" but pointing to a non-keyword path → neither body
  // nor slug confirms, yet it's nav-advertised, so it stays evidenced (low).
  const site = fakeSite(() => ({ ok: true, doc: genericDoc, finalUrl: "https://x.com/about/our-values" }));
  const disc = navDisc([{ url: "https://x.com/about/our-values", source: "nav", linkText: "Ethics" }], site);
  const ev = await det.gather({ id: 1, name: "X" }, { now: NOW, discovery: disc });
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.confirmed, false);
  assert.equal(ev.value.flag, "nav-advertised-unconfirmed");
});

test("no nav candidate + convention guess CONFIRMED → evidenced via convention (medium)", async () => {
  const site = fakeSite((u) => (u.includes("/ethics") ? { ok: true, doc: ethicsDoc, finalUrl: "https://x.com/ethics" } : { ok: true, doc: genericDoc, finalUrl: "https://x.com" + u }));
  const disc = navDisc([], site); // no nav candidate
  const ev = await det.gather({ id: 1, name: "X" }, { now: NOW, discovery: disc, maxConventionAttempts: 3 });
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.via, "convention");
  assert.equal(ev.value.confirmed, true);
  assert.ok(ev.confidence <= 0.8);
});

test("no nav candidate + all guesses UNCONFIRMED → PENDING (never evidenced, never negative)", async () => {
  const site = fakeSite((u) => ({ ok: true, doc: genericDoc, finalUrl: "https://x.com" + u })); // nothing confirms
  const disc = navDisc([], site);
  const ev = await det.gather({ id: 1, name: "X" }, { now: NOW, discovery: disc, maxConventionAttempts: 3 });
  assert.equal(ev.status, "pending");
  assert.equal(ev.value.found, false);
  assert.ok(ev.value.attempts.length > 0);
});

test("discovery unavailable (no editorial domain) → unavailable; discovery blocked → blocked", async () => {
  const u = await det.gather({ id: 1, name: "X" }, { now: NOW, discovery: { ok: false, reason: "no-editorial-domain" } });
  assert.equal(u.status, "unavailable");
  const b = await det.gather({ id: 1, name: "X" }, { now: NOW, discovery: { ok: false, reason: "blocked" } });
  assert.equal(b.status, "blocked");
});

// ── 5-config smoke + corrections single row ───────────────────────────────────
test("registry — 5 scrape presence detectors registered, all contract-valid", () => {
  const scrape = EVIDENCE_MODULES.filter((m) => m.needsDiscovery);
  assert.equal(scrape.length, 5);
  const ids = scrape.map((m) => m.id).sort();
  assert.deepEqual(ids, ["2.1.a", "2.1.b", "2.2.e", "2.4.b", "corrections-presence"]);
  for (const m of scrape) {
    assert.equal(typeof m.gather, "function");
    assert.equal(m.ttlDays, 120);
    assert.ok(["ET", "MT", "Ind"].includes(m.component));
  }
});

test("corrections is ONE row: id 'corrections-presence' (Q7 — not three rows)", () => {
  assert.equal(correctionsPresence.id, "corrections-presence");
  const correctionsLike = EVIDENCE_MODULES.filter((m) => m.pageType === "corrections");
  assert.equal(correctionsLike.length, 1);
});

// ── Pre-pass integration (temp DB + injected transport) ───────────────────────
function makeTransport(routeFn, counter) {
  return async (url, opts) => {
    if (!url.endsWith("/robots.txt") && counter) counter.n += 1; // count non-robots fetches
    const r = routeFn(url) || { status: 404, data: "" };
    if (opts.validateStatus && !opts.validateStatus(r.status)) {
      const e = new Error(`status ${r.status}`); e.response = { status: r.status }; throw e;
    }
    return { status: r.status, data: r.data ?? "", headers: { "content-type": "text/html" }, finalUrl: r.finalUrl || url };
  };
}

const HOMEPAGE = `<html><body><footer><a href="/ethics">Ethics</a></footer></body></html>`;
const ETHICS = `<html><head><title>Editorial Standards</title></head><body><h1>Ethics</h1><p>accuracy and impartiality</p></body></html>`;
function siteRoute(url) {
  if (url.endsWith("/robots.txt")) return { status: 404 };
  if (url.includes("/ethics")) return { status: 200, data: ETHICS };
  return { status: 200, data: HOMEPAGE }; // homepage "/"
}

const fakeOwnDb = {
  id: "fake.owndb", component: "ET", ttlDays: 30,
  gather: (source, ctx) => ({ status: "evidenced", value: { ownDb: true }, confidence: 1, evidenceUrl: null, gatheredAt: ctx.now }),
};

test("pre-pass — discovery runs once (scrape stale), skips when fresh; own-DB runs regardless; evidence-only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-pp-"));
  const db = new Database(path.join(dir, "t.db"));
  runMigrations(db);
  db.exec(`CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, url TEXT, source_name TEXT NOT NULL, published_at INTEGER NOT NULL, is_duplicate INTEGER DEFAULT 0);`);
  const sid = db.prepare(`INSERT INTO sources (name,url,source_type,category,region,created_at,updated_at) VALUES ('MockNews','https://feeds.mock.example/rss','rss','tech','global',?,?)`).run(NOW, NOW).lastInsertRowid;
  const insA = db.prepare(`INSERT INTO articles (id,url,source_name,published_at,is_duplicate) VALUES (?,?,?,?,0)`);
  for (let i = 0; i < 5; i++) insA.run(`a${i}`, `https://mocknews.example/news/${i}`, "MockNews", NOW - i * 86400000);

  const counter = { n: 0 };
  const opts = { db, now: NOW, transport: makeTransport(siteRoute, counter), modules: [fakeOwnDb, standards_2_1_b] };

  const run1 = await gatherForSource({ id: sid, name: "MockNews" }, opts);
  const own1 = run1.find((r) => r.id === "fake.owndb");
  const std1 = run1.find((r) => r.id === "2.1.b");
  assert.equal(own1.status, "evidenced", "own-DB module ran");
  assert.equal(std1.status, "evidenced", "standards found the nav ethics link → evidenced");
  assert.equal(std1.fromCache, false);
  assert.ok(counter.n >= 1, "discovery ran → at least the homepage was fetched");
  const afterRun1 = counter.n;

  const run2 = await gatherForSource({ id: sid, name: "MockNews" }, opts);
  assert.equal(run2.find((r) => r.id === "2.1.b").fromCache, true, "scrape detector fresh → reused from cache");
  assert.equal(counter.n, afterRun1, "discovery SKIPPED on the second run (no new fetches)");
  // own-DB module re-runs regardless of discovery (its own TTL governs it).
  assert.ok(run2.find((r) => r.id === "fake.owndb"));

  // Evidence-only invariant.
  assert.equal(db.prepare("SELECT quality_score FROM sources WHERE id=?").get(sid).quality_score, null);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
