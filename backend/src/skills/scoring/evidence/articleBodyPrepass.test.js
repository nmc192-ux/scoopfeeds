/**
 * articleBodyPrepass.test.js — B.6.3c-1 tests (node --test, offline).
 *
 * fetchArticleBodies with a mocked fetch transport + temp DB: happy path, honest
 * miss (no throw), ≤limit cap / budget, no-articles → [], mixed ok/miss, and the
 * carried-language passthrough. NO judgments, NO real network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runMigrations } from "../../../db/migrate.js";
import { fetchArticleBodies } from "./llm/articleBodyPrepass.js";

const NOW = 1_750_000_000_000;
const DOMAIN = "bodysrc.example";

function makeEnv(route, { nArticles = 6 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-abp-"));
  const db = new Database(path.join(dir, "t.db"));
  runMigrations(db);
  db.exec(`CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, url TEXT, title TEXT, category TEXT, language TEXT, source_name TEXT NOT NULL, published_at INTEGER NOT NULL, is_duplicate INTEGER DEFAULT 0);`);
  const sid = db.prepare(`INSERT INTO sources (name,url,source_type,category,region,created_at,updated_at) VALUES ('BodySrc','https://feeds.bodysrc.example/rss','rss','news','global',?,?)`).run(NOW, NOW).lastInsertRowid;
  const ins = db.prepare(`INSERT INTO articles (id,url,title,category,language,source_name,published_at,is_duplicate) VALUES (?,?,?,?,?,?,?,0)`);
  for (let i = 0; i < nArticles; i++) ins.run(`a${i}`, `https://${DOMAIN}/news/${i}`, `Title ${i}`, i % 2 ? "tech" : "politics", i === 0 ? "fr" : "en", "BodySrc", NOW - i * 86400000);
  let fetchCount = 0;
  const transport = async (url, opts) => {
    if (!url.endsWith("/robots.txt")) fetchCount++;
    const r = url.endsWith("/robots.txt") ? { status: 404 } : route(url);
    if (opts.validateStatus && !opts.validateStatus(r.status)) { const e = new Error(`s${r.status}`); e.response = { status: r.status }; throw e; }
    return { status: r.status, data: r.data ?? "", headers: { "content-type": "text/html" }, finalUrl: url };
  };
  return { db, sid, transport, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }, fetches: () => fetchCount };
}
const ok = (body) => ({ status: 200, data: `<html><body><main>${body}</main></body></html>` });
const ctx = (env) => ({ db: env.db, now: NOW, transport: env.transport });

// (a) happy path
test("happy path — N ArticleBody with non-empty text + metadata", async () => {
  const env = makeEnv((url) => ok(`Full article body for ${url} with enough text to extract.`));
  const bodies = await fetchArticleBodies({ id: env.sid, name: "BodySrc" }, ctx(env), { limit: 5 });
  assert.equal(bodies.length, 5);
  for (const b of bodies) {
    assert.equal(b.ok, true);
    assert.ok(b.text.length > 0);
    assert.match(b.finalUrl, /bodysrc\.example/);
    assert.ok(["tech", "politics"].includes(b.category));
    assert.ok(typeof b.language === "string");
  }
  env.cleanup();
});

// (b) failing fetch → honest miss, no throw
test("failing fetch (403) → { ok:false, reason } and does NOT throw", async () => {
  const env = makeEnv(() => ({ status: 403 }));
  const bodies = await fetchArticleBodies({ id: env.sid, name: "BodySrc" }, ctx(env), { limit: 5 });
  assert.equal(bodies.length, 5);
  for (const b of bodies) {
    assert.equal(b.ok, false);
    assert.equal(b.text, "");
    assert.ok(b.reason, "miss must carry a reason");
  }
  env.cleanup();
});

// (b2) empty body → miss
test("empty body → { ok:false, reason:'empty-body' }", async () => {
  const env = makeEnv(() => ({ status: 200, data: "<html><body></body></html>" }));
  const bodies = await fetchArticleBodies({ id: env.sid, name: "BodySrc" }, ctx(env), { limit: 3 });
  assert.equal(bodies.length, 3);
  assert.ok(bodies.every((b) => b.ok === false && b.reason === "empty-body"));
  env.cleanup();
});

// (c) ≤limit cap + budget
test("≤limit cap — never fetches more bodies than the limit", async () => {
  const env = makeEnv((url) => ok(`body ${url}`), { nArticles: 12 });
  const bodies = await fetchArticleBodies({ id: env.sid, name: "BodySrc" }, ctx(env), { limit: 5 });
  assert.equal(bodies.length, 5, "only the limit's worth of rows sampled");
  assert.ok(env.fetches() <= 5, `≤5 body fetches (got ${env.fetches()})`);
  env.cleanup();
});

// (d) no articles → []
test("source with no articles → [] cleanly (no fetch)", async () => {
  const env = makeEnv(() => ok("x"));
  env.db.exec("DELETE FROM articles");
  const bodies = await fetchArticleBodies({ id: env.sid, name: "BodySrc" }, ctx(env), { limit: 5 });
  assert.deepEqual(bodies, []);
  assert.equal(env.fetches(), 0);
  env.cleanup();
});

// mixed ok/miss
test("mixed — some bodies fetch, some 404 → per-article ok/miss recorded", async () => {
  const env = makeEnv((url) => (/\/news\/[02]$/.test(url) ? { status: 404 } : ok(`body ${url}`)));
  const bodies = await fetchArticleBodies({ id: env.sid, name: "BodySrc" }, ctx(env), { limit: 5 });
  assert.equal(bodies.length, 5);
  const okCount = bodies.filter((b) => b.ok).length;
  const missCount = bodies.filter((b) => !b.ok).length;
  assert.equal(missCount, 2, "the two 404s are misses");
  assert.equal(okCount, 3);
  assert.ok(bodies.filter((b) => !b.ok).every((b) => b.reason === "not-found"));
  env.cleanup();
});

// carried language passthrough (NOT fed to harness — just present in the shape)
test("carried language — articles.language passes through in the data shape", async () => {
  const env = makeEnv((url) => ok(`body ${url}`));
  const bodies = await fetchArticleBodies({ id: env.sid, name: "BodySrc" }, ctx(env), { limit: 5 });
  // a0 was inserted with language 'fr', the rest 'en'
  assert.ok(bodies.some((b) => b.language === "fr"), "non-en language carried through");
  assert.ok(bodies.some((b) => b.language === "en"));
  env.cleanup();
});

// no editorial domain → all-miss (rows exist but unfetchable), never throws
test("no editorial domain (articles lack resolvable host) → all-miss, no throw", async () => {
  const env = makeEnv(() => ok("x"));
  env.db.exec("UPDATE articles SET url = NULL"); // no URLs → no editorial domain & no sampleable rows
  const bodies = await fetchArticleBodies({ id: env.sid, name: "BodySrc" }, ctx(env), { limit: 5 });
  assert.deepEqual(bodies, [], "no url rows → nothing to sample");
  env.cleanup();
});
