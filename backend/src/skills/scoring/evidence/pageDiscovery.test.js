/**
 * pageDiscovery.test.js — B.6.2b-2a primitive tests (node --test, offline).
 *
 * Covers the keyword matcher (incl. the Q2 hazards: word-boundary "ai",
 * subscribe≠funding, "about"→leadership), strict confirmPage (soft-404,
 * redirect-to-home, no-positive-keyword), and discoverSite via an injected
 * transport (homepage fixture → candidates; linkless → empty; fetch fail →
 * ok:false reason).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseHtml } from "./httpFetch.js";
import { classifyLink, extractCandidates, discoverSite, CONVENTION_PATHS } from "./pageDiscovery.js";
import { confirmPage } from "./confirmPage.js";

// ── keyword matcher ───────────────────────────────────────────────────────────
test("classifyLink — representative links map to the right types", () => {
  assert.deepEqual(classifyLink("About Us", "/about"), ["leadership"]);
  assert.deepEqual(classifyLink("Editorial Guidelines", "/editorial-guidelines"), ["standards"]);
  assert.deepEqual(classifyLink("Corrections & clarifications", "/corrections"), ["corrections"]);
  assert.deepEqual(classifyLink("Support us", "/support"), ["funding"]);
  assert.deepEqual(classifyLink("AI policy", "/ai-policy"), ["ai"]);
  assert.deepEqual(classifyLink("Complaints", "/complaints"), ["corrections"]);
});

test("Q2 — 'ai' is word-boundary ONLY (never the substring)", () => {
  assert.deepEqual(classifyLink("Email us", "/email"), []);           // not ai
  assert.deepEqual(classifyLink("Available jobs", "/available"), []); // not ai
  assert.deepEqual(classifyLink("Campaign", "/campaign"), []);        // not ai
  assert.deepEqual(classifyLink("Main menu", "/main"), []);           // not ai
  assert.deepEqual(classifyLink("AI", "/ai"), ["ai"]);                // standalone word → ai
  assert.deepEqual(classifyLink("Artificial Intelligence", "/x"), ["ai"]);
});

test("Q2 — 'subscribe' is EXCLUDED from funding; donate/support are not", () => {
  assert.equal(classifyLink("Subscribe", "/subscribe").includes("funding"), false);
  assert.equal(classifyLink("Subscription options", "/subscription").includes("funding"), false);
  assert.deepEqual(classifyLink("Donate", "/donate"), ["funding"]);
  assert.deepEqual(classifyLink("Membership", "/membership"), ["funding"]);
});

test("Q2 — 'about' yields a leadership candidate (confirmation-gated later)", () => {
  assert.deepEqual(classifyLink("About", "/about"), ["leadership"]);
});

test("extractCandidates — parses nav/footer anchors, dedupes, resolves absolute", () => {
  const html = `<html><body>
    <nav><a href="/about">About Us</a><a href="/subscribe">Subscribe</a></nav>
    <footer>
      <a href="/editorial-guidelines">Editorial Guidelines</a>
      <a href="https://help.x.com/corrections">Corrections &amp; complaints</a>
      <a href="/ai-policy">Our use of AI</a>
      <a href="/support-us">Support us</a>
    </footer></body></html>`;
  const c = extractCandidates(parseHtml(html), "https://x.com");
  assert.equal(c.leadership.length, 1);
  assert.equal(c.leadership[0].url, "https://x.com/about");
  assert.equal(c.leadership[0].source, "nav");
  assert.equal(c.standards.length, 1);
  assert.equal(c.corrections[0].url, "https://help.x.com/corrections"); // cross-host absolute kept
  assert.equal(c.ai.length, 1);
  assert.equal(c.funding.length, 1);
  assert.equal(c.funding[0].linkText, "Support us");
  // Subscribe did NOT become a funding candidate.
  assert.ok(!c.funding.some((x) => /subscribe/i.test(x.linkText)));
});

// ── confirmPage (STRICT) ──────────────────────────────────────────────────────
const STANDARDS_CFG = { confirmKeywords: ["editorial standards", "ethics", "accuracy", "impartiality", "corrections policy"] };
const AI_CFG = { confirmKeywords: ["artificial intelligence", "ai", "automation", "machine-generated", "generative"] };

test("confirmPage — genuine standards page → confirmed (positive kw + path + no 404)", () => {
  const doc = parseHtml("<html><head><title>Editorial Standards</title></head><body><h1>Our Editorial Standards</h1><p>We value accuracy and impartiality.</p></body></html>");
  const r = confirmPage(doc, "https://x.com/editorial-standards", "/editorial-standards", STANDARDS_CFG);
  assert.equal(r.confirmed, true);
  assert.equal(r.signals.positiveKeyword, true);
  assert.ok(r.confidence > 0.5);
});

test("confirmPage — soft-404 (200 but 'page not found' body) → NOT confirmed", () => {
  const doc = parseHtml("<html><head><title>Page not found</title></head><body><h1>404</h1><p>This page doesn't exist.</p></body></html>");
  const r = confirmPage(doc, "https://x.com/ethics", "/ethics", STANDARDS_CFG);
  assert.equal(r.confirmed, false);
  assert.equal(r.signals.negativeMarker, true);
});

test("confirmPage — redirect to home (finalUrl path '/') → NOT confirmed (pathPreserved false)", () => {
  const doc = parseHtml("<html><head><title>Welcome</title></head><body><p>accuracy and ethics matter</p></body></html>");
  const r = confirmPage(doc, "https://x.com/", "/ethics", STANDARDS_CFG);
  assert.equal(r.signals.pathPreserved, false);
  assert.equal(r.confirmed, false);
});

test("confirmPage — generic 200 with no positive keyword → NOT confirmed (strict bias)", () => {
  const doc = parseHtml("<html><head><title>Welcome to our site</title></head><body><p>Latest news and weather.</p></body></html>");
  const r = confirmPage(doc, "https://x.com/standards", "/standards", STANDARDS_CFG);
  assert.equal(r.signals.positiveKeyword, false);
  assert.equal(r.confirmed, false);
});

test("confirmPage — 'ai' confirm keyword is word-boundary in BODY ('email'/'available' do NOT satisfy it)", () => {
  // Page is NOT at an /ai path (so the slug signal can't fire) — this isolates
  // the BODY word-boundary check: substrings inside email/available must not count.
  const doc = parseHtml("<html><head><title>Contact</title></head><body><p>Reach us by email. Newsletters available.</p></body></html>");
  const r = confirmPage(doc, "https://x.com/contact", "/contact", AI_CFG);
  assert.equal(r.signals.positiveKeyword, false, "'email'/'available' must not satisfy the 'ai' keyword");
  assert.equal(r.confirmed, false);
});

test("confirmPage — genuine AI page (standalone 'AI' + 'generative') → confirmed", () => {
  const doc = parseHtml("<html><head><title>Our use of AI</title></head><body><h1>AI at our newsroom</h1><p>We disclose generative tooling and automation.</p></body></html>");
  const r = confirmPage(doc, "https://x.com/ai-policy", "/ai-policy", AI_CFG);
  assert.equal(r.signals.positiveKeyword, true);
  assert.equal(r.confirmed, true);
});

// ── discoverSite (offline transport) ──────────────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-disc-"));
const db = new Database(path.join(dir, "t.db"));
db.exec(`CREATE TABLE articles (id TEXT PRIMARY KEY, url TEXT, source_name TEXT NOT NULL, published_at INTEGER NOT NULL, is_duplicate INTEGER DEFAULT 0);`);
const insA = db.prepare(`INSERT INTO articles (id,url,source_name,published_at,is_duplicate) VALUES (?,?,?,?,0)`);
for (let i = 0; i < 5; i++) insA.run(`m-${i}`, `https://mock.example/news/${i}`, "Mock", 1000 + i);

function makeTransport(routeFn) {
  return async (url, opts) => {
    const r = routeFn(url) || { status: 404, data: "" };
    if (opts.validateStatus && !opts.validateStatus(r.status)) {
      const e = new Error(`status ${r.status}`); e.response = { status: r.status }; throw e;
    }
    return { status: r.status, data: r.data ?? "", headers: { "content-type": "text/html" }, finalUrl: r.finalUrl || url };
  };
}

test("discoverSite — homepage with nav/footer → candidates per type", async () => {
  const homepage = `<html><body><footer>
    <a href="/about">About</a>
    <a href="/editorial-standards">Editorial Standards</a>
    <a href="/corrections">Corrections</a>
    <a href="/support-us">Support us</a>
    <a href="/ai">AI</a>
  </footer></body></html>`;
  const transport = makeTransport((u) => (u.endsWith("/robots.txt") ? { status: 404 } : { status: 200, data: homepage }));
  const d = await discoverSite({ name: "Mock" }, { db, transport });
  assert.equal(d.ok, true);
  assert.equal(d.candidates.leadership.length, 1);
  assert.equal(d.candidates.standards.length, 1);
  assert.equal(d.candidates.corrections.length, 1);
  assert.equal(d.candidates.funding.length, 1);
  assert.equal(d.candidates.ai.length, 1);
  assert.equal(d.candidates.standards[0].url, "https://mock.example/editorial-standards");
});

test("discoverSite — linkless homepage → empty candidates (→ pending later, honest)", async () => {
  const transport = makeTransport((u) => (u.endsWith("/robots.txt") ? { status: 404 } : { status: 200, data: "<html><body><p>JS app root</p></body></html>" }));
  const d = await discoverSite({ name: "Mock" }, { db, transport });
  assert.equal(d.ok, true);
  for (const t of Object.keys(d.candidates)) assert.equal(d.candidates[t].length, 0);
});

test("discoverSite — homepage fetch fails → ok:false with reason", async () => {
  const transport = makeTransport((u) => (u.endsWith("/robots.txt") ? { status: 404 } : { status: 403 }));
  const d = await discoverSite({ name: "Mock" }, { db, transport });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "blocked"); // 403 → blocked
  assert.equal(d.homepageOk, false);
});

test("discoverSite — no editorial domain → ok:false no-editorial-domain", async () => {
  const d = await discoverSite({ name: "NoArticles" }, { db });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "no-editorial-domain");
});

test("CONVENTION_PATHS — exported for 2b, covers all 5 types", () => {
  for (const t of ["leadership", "standards", "corrections", "funding", "ai"]) {
    assert.ok(Array.isArray(CONVENTION_PATHS[t]) && CONVENTION_PATHS[t].length > 0);
  }
});

// ── Live-validation tuning fixes ──────────────────────────────────────────────
test("FIX #1 — long prose 'about' is NOT a leadership candidate (label gate)", () => {
  // BBC's real footer link: long sentence containing "about" + an editorial-
  // guidelines href. Must NOT be leadership; SHOULD be standards via the
  // de-hyphenated path segment "editorialguidelines".
  const types = classifyLink("Read about our approach to external linking", "/editorialguidelines/guidance/links-and-feeds");
  assert.equal(types.includes("leadership"), false, "long prose 'about' must not match leadership");
  assert.equal(types.includes("standards"), true, "de-hyphenated /editorialguidelines must match standards");
});

test("FIX #1 — short 'About Us' label still matches leadership", () => {
  assert.deepEqual(classifyLink("About the BBC", "/aboutthebbc"), ["leadership"]);
});

test("FIX #2 — de-hyphenated path segments match (editorialguidelines, codeofethics)", () => {
  assert.equal(classifyLink("x", "/editorialguidelines").includes("standards"), true);
  assert.equal(classifyLink("x", "/codeofethics").includes("standards"), true);
});

test("FIX #3 — candidates resolving to homepage '/' are dropped", () => {
  const html = `<html><body><footer>
    <a href="/">Support us</a>
    <a href="/donate">Donate</a>
  </footer></body></html>`;
  const c = extractCandidates(parseHtml(html), "https://x.com");
  // "Support us"→"/" dropped; "/donate" kept.
  assert.equal(c.funding.length, 1);
  assert.equal(c.funding[0].url, "https://x.com/donate");
});

const CORRECTIONS_CFG = { confirmKeywords: ["correction", "corrected", "clarification", "we regret", "errata", "accuracy"] };

test("FIX (slug signal) — thin-body corrections page confirms via the URL slug", () => {
  // The Guardian case: real corrections landing page, body has no standalone
  // keyword, but the slug /corrections-and-clarifications is strong evidence.
  const doc = parseHtml("<html><head><title>The Guardian</title></head><body><p>Browse the latest stories.</p></body></html>");
  const r = confirmPage(doc, "https://www.theguardian.com/theguardian/series/corrections-and-clarifications", "/theguardian/series/corrections-and-clarifications", CORRECTIONS_CFG);
  assert.equal(r.signals.slugSignal, true, "slug 'corrections-and-clarifications' should signal (plural via leading boundary)");
  assert.equal(r.confirmed, true);
  assert.ok(r.confidence > 0.5);
});

test("FIX (slug signal) — short token 'ai' does NOT slug-match 'airport'", () => {
  const doc = parseHtml("<html><head><title>Airport coverage</title></head><body><p>flights and travel</p></body></html>");
  const r = confirmPage(doc, "https://x.com/airport", "/airport", AI_CFG);
  assert.equal(r.signals.slugSignal, false, "'ai' must not slug-match 'airport'");
  assert.equal(r.confirmed, false);
});

test.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
