/**
 * primaryLinks.test.js — B.6.2d tests (node --test, offline).
 *
 * Two layers:
 *   1. primaryLinkClassify (pure): the broadened Tier-1 taxonomy incl. the ARS
 *      REGRESSION GUARD (dx.doi.org + journal hosts must NOT score zero — the
 *      false-negative the live probe caught), Tier-2/Tier-3 exclusion, and
 *      body-vs-chrome extraction with nested-container dedup + own-domain drop.
 *   2. primaryLinks_2_2_b (temp DB + injected transport): ratio mapping,
 *      all-fetch-fail → blocked, no-articles → unavailable, evidence-only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseHtml } from "./httpFetch.js";
import { isPrimaryHost, extractBodyExternalLinks, classifyLinks } from "./primaryLinkClassify.js";
import { runMigrations } from "../../../db/migrate.js";
import primaryLinks from "./modules/primaryLinks_2_2_b.js";

const NOW = Date.now();
const doc = (h) => parseHtml(h);

// ── isPrimaryHost — the broadened Tier-1 taxonomy (Q1) ──────────────────────────
test("isPrimaryHost — gov/edu/mil/legal/intl cores", () => {
  for (const h of [
    "whitehouse.gov", "sec.gov", "ncbi.nlm.nih.gov", "pubmed.ncbi.nlm.nih.gov", // .gov (NIH/PubMed auto-covered)
    "gov.uk", "www.gov.uk", "ons.gov.uk", "legislation.gov.au",                  // gov.<cc>
    "harvard.edu", "mit.edu", "cam.ac.uk", "ox.ac.uk",                           // edu / ac.<cc>
    "defense.mil", "who.int", "echr.coe.int",                                    // mil / int
    "un.org", "worldbank.org", "courtlistener.com",                              // intergovernmental / legal
  ]) {
    assert.equal(isPrimaryHost(h), true, `expected primary: ${h}`);
  }
});

test("isPrimaryHost — DOI: doi.org AND dx.doi.org both match", () => {
  assert.equal(isPrimaryHost("doi.org"), true);
  assert.equal(isPrimaryHost("dx.doi.org"), true, "dx.doi.org via subdomain match — the draft missed this");
});

test("isPrimaryHost — journal/publisher allowlist incl. publisher subdomains", () => {
  for (const h of [
    "nature.com", "science.org", "thelancet.com", "nejm.org", "bmj.com", "plos.org", "frontiersin.org",
    "journals.aps.org", "pubs.aip.org", "iopscience.iop.org", "pubs.acs.org", "academic.oup.com",
    "arxiv.org", "biorxiv.org", "zenodo.org",
  ]) {
    assert.equal(isPrimaryHost(h), true, `expected primary journal/repo: ${h}`);
  }
});

test("isPrimaryHost — Tier-3 NON-primary (news / social / wiki / aggregator)", () => {
  for (const h of [
    "nytimes.com", "reuters.com", "apnews.com",            // other news outlets
    "x.com", "twitter.com", "facebook.com", "bsky.app", "youtube.com", "reddit.com", // social
    "en.wikipedia.org",                                    // secondary
    "news.google.com", "flipboard.com",                    // aggregators
  ]) {
    assert.equal(isPrimaryHost(h), false, `expected NON-primary: ${h}`);
  }
});

test("isPrimaryHost — Tier-2 ambiguous EXCLUDED (no false-positives)", () => {
  // A bare PDF on an unknown host / a lookalike domain → NOT counted (lower bound).
  assert.equal(isPrimaryHost("example.com"), false);
  assert.equal(isPrimaryHost("notgov.uk"), false, "leading-dot anchoring stops gov.uk lookalikes");
  assert.equal(isPrimaryHost("mygov.com"), false);
  assert.equal(isPrimaryHost("notaps.org"), false);
  assert.equal(isPrimaryHost(""), false);
  assert.equal(isPrimaryHost("localhost"), false);
});

// ── extractBodyExternalLinks + classifyLinks ────────────────────────────────────

// ★ THE ARS REGRESSION GUARD ★ — a science article citing dx.doi.org + journal
// hosts must score primary>0 (the narrow draft scored Ars at ZERO).
test("ARS REGRESSION GUARD — dx.doi.org + journal hosts in body → primary detected (NOT zero)", () => {
  const html = `<html><body>
    <header><a href="https://x.com/arstechnica">follow</a></header>
    <article>
      <p>A new study (<a href="https://dx.doi.org/10.1103/PhysRevLett.1">PRL</a>) and
      coverage in <a href="https://www.nature.com/articles/x">Nature</a>,
      <a href="https://journals.aps.org/prl/abstract/y">APS</a>,
      <a href="https://pubs.aip.org/z">AIP</a>.</p>
      <p>See also <a href="https://en.wikipedia.org/wiki/Physics">background</a> and
      <a href="https://www.nytimes.com/coverage">other coverage</a>.</p>
    </article>
    <footer><a href="https://facebook.com/arstechnica">fb</a></footer>
  </body></html>`;
  const links = extractBodyExternalLinks(doc(html), "https://arstechnica.com/science/x", "arstechnica.com");
  const c = classifyLinks(links);
  assert.ok(c.hasPrimary, "Ars-like article MUST register primary links");
  assert.ok(c.primary.length >= 4, `expected ≥4 primary (got ${c.primary.length}: ${c.primaryHosts.join(",")})`);
  assert.ok(c.primaryHosts.includes("dx.doi.org"));
  assert.ok(c.primaryHosts.includes("nature.com"));
  assert.ok(c.primaryHosts.includes("journals.aps.org"));
  // chrome (social) + Tier-3 (wiki/news) are present as links but NOT primary
  assert.ok(!c.primaryHosts.includes("en.wikipedia.org"));
  assert.ok(!c.primaryHosts.includes("nytimes.com"));
});

test("body-vs-chrome — only article-body links extracted; nav/header/footer excluded", () => {
  const html = `<html><body>
    <nav><a href="https://x.com/share">share</a><a href="https://whitehouse.gov/menu">menu-chrome</a></nav>
    <article><p>cites <a href="https://www.sec.gov/filing">an SEC filing</a></p></article>
    <footer><a href="https://harvard.edu/footer">footer-chrome</a></footer>
  </body></html>`;
  const links = extractBodyExternalLinks(doc(html), "https://outlet.example/news/1", "outlet.example");
  const hosts = links.map((l) => l.host);
  assert.deepEqual(hosts, ["sec.gov"], "only the body link survives; chrome (even primary-looking) excluded");
});

test("dedup — nested containers + repeated href counted once", () => {
  // <article> matches before the nested .article-body; same href twice inside.
  const html = `<html><body><article><div class="article-body">
    <a href="https://doi.org/10.1/a">study</a>
    <a href="https://doi.org/10.1/a">same study again</a>
    <a href="https://doi.org/10.1/a#section">same path, fragment</a>
  </div></article></body></html>`;
  const links = extractBodyExternalLinks(doc(html), "https://outlet.example/p", "outlet.example");
  assert.equal(links.length, 1, "repeated href (and #fragment variant) deduped to one");
  assert.equal(links[0].host, "doi.org");
});

test("own-domain + own-subdomain excluded as internal", () => {
  const html = `<html><body><article>
    <a href="/local/story">relative internal</a>
    <a href="https://www.outlet.example/other">absolute own</a>
    <a href="https://blog.outlet.example/x">own subdomain</a>
    <a href="https://doi.org/10.1/z">external primary</a>
  </article></body></html>`;
  const links = extractBodyExternalLinks(doc(html), "https://www.outlet.example/news/1", "outlet.example");
  const hosts = links.map((l) => l.host);
  assert.deepEqual(hosts, ["doi.org"], "all own-domain (incl. subdomain + relative) dropped");
});

test("whole-doc fallback when no body container matches", () => {
  const html = `<html><body><div id="weird"><p>cites <a href="https://arxiv.org/abs/1">preprint</a></p></div></body></html>`;
  const links = extractBodyExternalLinks(doc(html), "https://outlet.example/p", "outlet.example");
  assert.equal(classifyLinks(links).hasPrimary, true, "no container → fall back to whole doc, still find the link");
});

// ── module integration (temp DB + injected transport) ───────────────────────────
function makeEnv(articleRoute) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-pl-"));
  const db = new Database(path.join(dir, "t.db"));
  runMigrations(db);
  db.exec(`CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, url TEXT, source_name TEXT NOT NULL, published_at INTEGER NOT NULL, is_duplicate INTEGER DEFAULT 0);`);
  const sid = db.prepare(`INSERT INTO sources (name,url,source_type,category,region,created_at,updated_at) VALUES ('LinkSrc','https://feeds.linksrc.example/rss','rss','science','global',?,?)`).run(NOW, NOW).lastInsertRowid;
  const ins = db.prepare(`INSERT INTO articles (id,url,source_name,published_at,is_duplicate) VALUES (?,?,?,?,0)`);
  for (let i = 0; i < 6; i++) ins.run(`l${i}`, `https://linksrc.example/news/${i}`, "LinkSrc", NOW - i * 86400000);
  const transport = async (url, opts) => {
    const r = url.endsWith("/robots.txt") ? { status: 404 } : articleRoute(url);
    if (opts.validateStatus && !opts.validateStatus(r.status)) { const e = new Error(`s${r.status}`); e.response = { status: r.status }; throw e; }
    return { status: r.status, data: r.data ?? "", headers: { "content-type": "text/html" }, finalUrl: url };
  };
  const cleanup = () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { db, sid, transport, cleanup };
}
const run = (env, extra = {}) =>
  primaryLinks.gather({ id: env.sid, name: "LinkSrc" }, { db: env.db, now: NOW, transport: env.transport, methodologyVersion: "v1.1", ...extra });

const PRIMARY_PAGE = { status: 200, data: `<html><body><article><p>cites <a href="https://dx.doi.org/10.1/a">study</a> and <a href="https://www.sec.gov/x">filing</a></p></article></body></html>` };
const PLAIN_PAGE = { status: 200, data: `<html><body><article><p>only <a href="https://www.nytimes.com/x">other news</a> and <a href="https://x.com/y">social</a></p></article></body></html>` };

test("ratio mapping — 3 of 5 articles carry a primary link → EVIDENCED ratio 0.6", async () => {
  const route = (url) => {
    const i = Number(url.match(/\/news\/(\d+)/)?.[1] ?? 9);
    return i < 3 ? PRIMARY_PAGE : PLAIN_PAGE; // 0,1,2 primary; 3,4 none
  };
  const env = makeEnv(route);
  const ev = await run(env);
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.sampled, 5);
  assert.equal(ev.value.articlesWithPrimary, 3);
  assert.equal(ev.value.ratio, 0.6);
  assert.equal(ev.value.bucket, "frequent");
  assert.equal(ev.value.basis, "clear-primary-domains-lower-bound");
  assert.ok(ev.value.primaryHostsSeen.includes("dx.doi.org"));
  assert.ok(ev.value.primaryHostsSeen.includes("sec.gov"));
  assert.ok(ev.confidence <= 0.7 && ev.confidence > 0, `moderate confidence (got ${ev.confidence})`);
  assert.match(ev.value.note, /lower bound/i);
  env.cleanup();
});

test("zero observed — no article carries a clear-primary link → EVIDENCED ratio 0, none-observed (NOT a confident negative)", async () => {
  const env = makeEnv(() => PLAIN_PAGE);
  const ev = await run(env);
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.ratio, 0);
  assert.equal(ev.value.bucket, "none-observed");
  assert.deepEqual(ev.value.primaryHostsSeen, []);
  assert.match(ev.value.note, /NOT that the source doesn't cite primary/i);
  env.cleanup();
});

test("all-fetch-fail — every article page 403 → BLOCKED (not a false 0)", async () => {
  const env = makeEnv(() => ({ status: 403 }));
  const ev = await run(env);
  assert.equal(ev.status, "blocked");
  assert.equal(ev.value.reason, "all-fetches-failed");
  env.cleanup();
});

test("no articles in DB → UNAVAILABLE (nothing to sample)", async () => {
  const env = makeEnv(() => PRIMARY_PAGE);
  env.db.exec(`DELETE FROM articles`);
  const ev = await run(env);
  assert.equal(ev.status, "unavailable");
  assert.equal(ev.value.reason, "no-articles");
  env.cleanup();
});

test("budget — never fetches more than the sample target (≤5)", async () => {
  let n = 0;
  const env = makeEnv((url) => { if (!url.endsWith("/robots.txt")) n += 1; return PRIMARY_PAGE; });
  await run(env);
  assert.ok(n <= 5, `≤5 article-page fetches (got ${n})`);
  env.cleanup();
});

test("evidence-only — gather never writes sources.quality_score", async () => {
  const env = makeEnv(() => PRIMARY_PAGE);
  await run(env);
  assert.equal(env.db.prepare("SELECT quality_score FROM sources WHERE id=?").get(env.sid).quality_score, null);
  env.cleanup();
});
