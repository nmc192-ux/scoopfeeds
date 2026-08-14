/**
 * contentEnricher.test.js — og:image extraction and who gets fetched for it.
 *
 * WHY THE IMAGE LIVES HERE. 16 configured feeds ship no image element of any
 * kind (ESPN, CNBC, Science Daily, TechCrunch, Hacker News, Euronews and
 * others, measured across all 110 feeds on 2026-08-14), so the article page is
 * the only place their image exists. This module already fetches that page for
 * text, which makes the image free for every article enrichment was going to
 * fetch anyway — and the selection test below is what keeps it that way.
 *
 * Live verification, not repeated here because it needs the network:
 * og:image was recovered on 20 of 21 real articles across seven of those feeds.
 * The single miss was Hacker News, which links to arbitrary external sites.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = mkdtempSync(path.join(os.tmpdir(), "enricher-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = TMP;

const { extractOgImage, pickEnrichCandidates, IMAGE_ONLY_MAX_AGE_MS } = await import("./contentEnricher.js");
const { getDb } = await import("../models/database.js");
const db = getDb();

const HOUR = 3600 * 1000;
const page = (head) => `<html><head>${head}</head><body><p>body</p></body></html>`;

// ─── og:image extraction ────────────────────────────────────────────────────

test("og:image is found in BOTH attribute orders", () => {
  // The one-order regex is a classic silent miss — it reads as "this site has no
  // card image" when the site simply wrote its meta tags the other way round.
  const a = page(`<meta property="og:image" content="https://x.test/a.jpg">`);
  const b = page(`<meta content="https://x.test/b.jpg" property="og:image">`);
  assert.equal(extractOgImage(a, "https://x.test/story"), "https://x.test/a.jpg");
  assert.equal(extractOgImage(b, "https://x.test/story"), "https://x.test/b.jpg");
});

test("og:image:url is accepted, and og:image wins over twitter:image", () => {
  assert.equal(
    extractOgImage(page(`<meta property="og:image:url" content="https://x.test/u.jpg">`), "https://x.test/s"),
    "https://x.test/u.jpg");
  const both = page(
    `<meta name="twitter:image" content="https://x.test/tw.jpg">` +
    `<meta property="og:image" content="https://x.test/og.jpg">`);
  assert.equal(extractOgImage(both, "https://x.test/s"), "https://x.test/og.jpg",
    "og:image is the publisher's primary statement; twitter:image is the fallback");
});

test("twitter:image is used when og:image is absent", () => {
  assert.equal(
    extractOgImage(page(`<meta name="twitter:image" content="https://x.test/tw.jpg">`), "https://x.test/s"),
    "https://x.test/tw.jpg");
});

test("relative and protocol-relative URLs are resolved against the article", () => {
  // Unresolved these are useless downstream — the card renderer would fetch
  // "/img/a.jpg" against its own origin and get a 404.
  assert.equal(extractOgImage(page(`<meta property="og:image" content="/img/a.jpg">`), "https://news.test/world/story"),
    "https://news.test/img/a.jpg");
  assert.equal(extractOgImage(page(`<meta property="og:image" content="//cdn.test/b.jpg">`), "https://news.test/s"),
    "https://cdn.test/b.jpg");
});

test("a data: URI is refused rather than stored", () => {
  // A base64 placeholder would pass a "has an image" check and then fail to
  // render, which is worse than having no image at all.
  assert.equal(extractOgImage(page(`<meta property="og:image" content="data:image/png;base64,iVBOR">`), "https://x.test/s"), null);
});

test("HTML entities in the URL are decoded", () => {
  assert.equal(
    extractOgImage(page(`<meta property="og:image" content="https://x.test/a.jpg?w=1&amp;h=2">`), "https://x.test/s"),
    "https://x.test/a.jpg?w=1&h=2");
});

test("only the HEAD is searched", () => {
  // An og:image string quoted inside body copy or an embedded JSON blob is not
  // the page's share image.
  const html = `<html><head><title>t</title></head><body>` +
    `<pre>&lt;meta property="og:image" content="https://evil.test/x.jpg"&gt;</pre>` +
    `<meta property="og:image" content="https://body.test/y.jpg"></body></html>`;
  assert.equal(extractOgImage(html, "https://x.test/s"), null);
});

test("missing, malformed and non-string input return null without throwing", () => {
  for (const bad of [null, undefined, 42, {}, "", "<html></html>", page("<title>no meta</title>")]) {
    assert.doesNotThrow(() => extractOgImage(bad, "https://x.test/s"));
    assert.equal(extractOgImage(bad, "https://x.test/s"), null);
  }
  // An unparseable base must not throw either.
  assert.doesNotThrow(() => extractOgImage(page(`<meta property="og:image" content="/a.jpg">`), "not a url"));
});

// ─── Who gets fetched — the half that decides cost ──────────────────────────

let seq = 0;
function seed({ content = null, image = null, ageHours = 1 } = {}) {
  const id = `enrich-${++seq}`;
  db.prepare(`
    INSERT INTO articles (id, title, description, content, url, category, source_name,
                          published_at, fetched_at, credibility, is_duplicate, image_url)
    VALUES (?, ?, '', ?, ?, 'world', 'Wire', ?, ?, 9, 0, ?)
  `).run(id, `T ${id}`, content, `https://e.test/${id}`, Date.now() - ageHours * HOUR, Date.now(), image);
  return id;
}
const picked = (now = Date.now()) => new Set(pickEnrichCandidates({ batchSize: 500, now }).map(r => r.id));

test("THE FREE PATH: a thin-content article is picked, and carries its image state", () => {
  db.exec("DELETE FROM articles");
  const id = seed({ content: null, image: null, ageHours: 1 });
  const rows = pickEnrichCandidates({ batchSize: 10 });
  assert.deepEqual(rows.map(r => r.id), [id]);
  // enrichOne branches on these, so the row must carry them — this is what lets
  // one fetch satisfy both jobs instead of two fetches satisfying one each.
  assert.ok("content" in rows[0] && "image_url" in rows[0],
    "the candidate row must carry current state or enrichOne cannot do both jobs in one pass");
});

test("a thin-content article is picked at ANY age — content is not time-boxed", () => {
  // Content feeds the event graph and video full-text, where an older article
  // is still worth having. Only the IMAGE criterion is windowed.
  db.exec("DELETE FROM articles");
  const old = seed({ content: null, image: "https://x.test/i.jpg", ageHours: 24 * 30 });
  assert.ok(picked().has(old));
});

test("THE NEW COST: an article with good content but no image is picked when RECENT", () => {
  db.exec("DELETE FROM articles");
  const id = seed({ content: "x".repeat(2000), image: null, ageHours: 2 });
  assert.ok(picked().has(id), "this is the case the old query never picked");
});

test("...and is NOT picked once it is past the window", () => {
  // The window is what stops the widened selection eating itself: an article
  // whose page has no og:image can never be satisfied, and unbounded it would
  // be re-picked every 15 minutes forever, crowding out new work with a fetch
  // known to fail.
  db.exec("DELETE FROM articles");
  const stale = seed({ content: "x".repeat(2000), image: null, ageHours: 72 });
  assert.ok(!picked().has(stale));
  assert.equal(IMAGE_ONLY_MAX_AGE_MS, 48 * HOUR);
});

test("the window is FOUR TIMES the 12h posting window it serves", () => {
  // findFreshUnpostedArticles and the video candidate query both use 12h, so an
  // image fetched for a 3-day-old article can never be used by anything. The
  // slack covers a backlog, a slow cycle or a delayed publish.
  assert.equal(IMAGE_ONLY_MAX_AGE_MS / (12 * HOUR), 4);
});

test("an article with BOTH content and an image is never picked", () => {
  db.exec("DELETE FROM articles");
  seed({ content: "x".repeat(2000), image: "https://x.test/i.jpg", ageHours: 1 });
  assert.equal(pickEnrichCandidates({ batchSize: 10 }).length, 0, "nothing to do means no fetch");
});

test("an empty-string image counts as missing, not as present", () => {
  db.exec("DELETE FROM articles");
  const id = seed({ content: "x".repeat(2000), image: "", ageHours: 1 });
  assert.ok(picked().has(id));
});

test("the batch size is still honoured with the widened WHERE", () => {
  db.exec("DELETE FROM articles");
  for (let i = 0; i < 12; i++) seed({ content: "x".repeat(2000), image: null, ageHours: 1 });
  assert.equal(pickEnrichCandidates({ batchSize: 5 }).length, 5);
});
