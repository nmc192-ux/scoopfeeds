/**
 * coiAndSeverity.test.js — B.6.3c-2b tests (node --test, offline).
 *
 * 2.2.d COI (pre-flight 2.4.a read + owner-injection via the find-relevant gate) and
 * 2.5.b correction severity (single-page 2.1.d clone). Mocked llmCall + buildPrompt +
 * ctx.articleBodies (2.2.d) / mocked transport + corrections-presence feeder (2.5.b).
 * No network, no real LLM.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runMigrations } from "../../../db/migrate.js";
import { upsertEvidence, getEvidence } from "./evidenceCache.js";
import coi from "./modules/conflictOfInterestDisclosure_2_2_d.js";
import severity from "./modules/correctionSeverity_2_5_b.js";

const NOW = 1_750_000_000_000;
const DOMAIN = "coisrc.example";

function queueLLM(raws) { let i = 0; const calls = []; const fn = async (p) => { calls.push(p); return raws[i++] ?? null; }; fn.calls = calls; return fn; }
const j = (bucket, quote) => ({ bucket, groundingQuote: quote, reasoning: "r" });
const NA = { bucket: "not-applicable", groundingQuote: "", reasoning: "n/a" };
const body = (text, finalUrl = `https://${DOMAIN}/a`) => ({ url: finalUrl, finalUrl, language: "en", category: "business", title: "t", text, truncated: false, ok: true });

// ── 2.2.d COI ─────────────────────────────────────────────────────────────────
function coiEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-coi-"));
  const db = new Database(path.join(dir, "t.db"));
  runMigrations(db);
  const sid = db.prepare(`INSERT INTO sources (name,url,source_type,category,region,created_at,updated_at) VALUES ('CoiSrc','https://feeds.coisrc.example/rss','rss','news','global',?,?)`).run(NOW, NOW).lastInsertRowid;
  return { db, sid, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const setOwnership = (env, value) => upsertEvidence(env.sid, "2.4.a", { status: "evidenced", value, confidence: 0.9, evidenceUrl: "https://www.wikidata.org/wiki/Q1", gatheredAt: NOW }, "v1.1", env.db);
const coiCtx = (env, bodies, llmCall, buildPrompt) => ({ db: env.db, now: NOW, articleBodies: bodies, llmCall, buildPrompt: buildPrompt || (() => "P") });

test("2.2.d — 2.4.a ABSENT → unavailable 'owner-unknown', NO LLM call", async () => {
  const env = coiEnv();
  const llm = queueLLM([j("disclosed", "x")]);
  const ev = await coi.gather({ id: env.sid, name: "CoiSrc" }, coiCtx(env, [body("text")], llm));
  assert.equal(ev.status, "unavailable");
  assert.equal(ev.value.reason, "owner-unknown");
  assert.equal(llm.calls.length, 0, "no judging without a known owner");
  assert.match(ev.value.notAssessed, /advertiser/i);
  env.cleanup();
});

test("2.2.d — 2.4.a structural-type only (no named owner) → unavailable 'owner-unknown'", async () => {
  const env = coiEnv();
  setOwnership(env, { entity: { qid: "Q1", label: "Indie" }, owner: null, structuralType: ["nonprofit organization"], basis: "wikidata" });
  const llm = queueLLM([j("disclosed", "x")]);
  const ev = await coi.gather({ id: env.sid, name: "CoiSrc" }, coiCtx(env, [body("text")], llm));
  assert.equal(ev.status, "unavailable");
  assert.equal(ev.value.reason, "owner-unknown");
  assert.equal(llm.calls.length, 0);
  env.cleanup();
});

test("2.2.d — owner known → buildInput INJECTS owner/parent into the harness input", async () => {
  const env = coiEnv();
  setOwnership(env, { entity: { qid: "Q1", label: "Outlet" }, owner: { qid: "Q2", label: "Acme Corp" }, parent: { qid: "Q3", label: "Acme Holdings" }, basis: "wikidata" });
  const captured = [];
  const buildPrompt = (input) => { captured.push(input); return "P"; };
  const txt = "A story mentioning Acme Corp and its disclosed ownership tie to this outlet.";
  await coi.gather({ id: env.sid, name: "CoiSrc" }, coiCtx(env, [body(txt)], queueLLM([j("disclosed", "disclosed ownership tie"), j("disclosed", "disclosed ownership tie"), j("disclosed", "disclosed ownership tie")]), buildPrompt));
  assert.ok(captured.length >= 1, "harness received an input");
  assert.equal(captured[0].ownerContext.owner, "Acme Corp", "owner injected into input");
  assert.equal(captured[0].ownerContext.parent, "Acme Holdings", "parent injected into input");
  env.cleanup();
});

test("2.2.d — owner known, no story touches owner (all N/A) → unavailable 'no-relevant-article-in-sample' + owner recorded", async () => {
  const env = coiEnv();
  setOwnership(env, { entity: { qid: "Q1", label: "Outlet" }, owner: { qid: "Q2", label: "Acme Corp" }, parent: null, basis: "wikidata" });
  const ev = await coi.gather({ id: env.sid, name: "CoiSrc" }, coiCtx(env, [body("a"), body("b")], queueLLM([NA, NA, NA, NA, NA, NA])));
  assert.equal(ev.status, "unavailable");
  assert.equal(ev.value.reason, "no-relevant-article-in-sample");
  assert.equal(ev.value.owner, "Acme Corp", "owner recorded on the result");
  assert.match(ev.value.assessedScope, /owner\/parent COI/);
  env.cleanup();
});

test("2.2.d — touching story + disclosure → EVIDENCED bucket", async () => {
  const env = coiEnv();
  setOwnership(env, { entity: { qid: "Q1", label: "Outlet" }, owner: { qid: "Q2", label: "Acme Corp" }, parent: null, basis: "wikidata" });
  const txt = "Acme Corp, which owns this outlet, reported earnings. (Disclosure: Acme Corp owns us.)";
  const ev = await coi.gather({ id: env.sid, name: "CoiSrc" }, coiCtx(env, [body(txt)], queueLLM([j("prominently disclosed", "Disclosure: Acme Corp owns us"), j("prominently disclosed", "Disclosure: Acme Corp owns us"), j("prominently disclosed", "Disclosure: Acme Corp owns us")])));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.bucket, "prominently disclosed");
  assert.equal(ev.value.owner, "Acme Corp");
  env.cleanup();
});

test("2.2.d — levels[0] 'no disclosure' only with a quoted conflicted mention (grounded)", async () => {
  const env = coiEnv();
  setOwnership(env, { entity: { qid: "Q1", label: "Outlet" }, owner: { qid: "Q2", label: "Acme Corp" }, parent: null, basis: "wikidata" });
  const txt = "Acme Corp launched a product to great acclaim, the report said.";
  const ev = await coi.gather({ id: env.sid, name: "CoiSrc" }, coiCtx(env, [body(txt)], queueLLM([j("no disclosure", "Acme Corp launched a product"), j("no disclosure", "Acme Corp launched a product"), j("no disclosure", "Acme Corp launched a product")])));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.bucket, "no disclosure");
  assert.equal(ev.value.ungroundedAtSource, false, "levels[0] grounded by the conflicted-mention locus");
  env.cleanup();
});

// ── 2.5.b correction severity (single-page) ───────────────────────────────────
function sevEnv(route) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-sev-"));
  const db = new Database(path.join(dir, "t.db"));
  runMigrations(db);
  db.exec(`CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, url TEXT, source_name TEXT NOT NULL, published_at INTEGER NOT NULL, is_duplicate INTEGER DEFAULT 0);`);
  const sid = db.prepare(`INSERT INTO sources (name,url,source_type,category,region,created_at,updated_at) VALUES ('SevSrc','https://feeds.sevsrc.example/rss','rss','news','global',?,?)`).run(NOW, NOW).lastInsertRowid;
  const ins = db.prepare(`INSERT INTO articles (id,url,source_name,published_at,is_duplicate) VALUES (?,?,?,?,0)`);
  for (let i = 0; i < 5; i++) ins.run(`a${i}`, `https://${DOMAIN}/news/${i}`, "SevSrc", NOW - i * 86400000);
  const transport = async (url, opts) => {
    const r = url.endsWith("/robots.txt") ? { status: 404 } : route(url);
    if (opts.validateStatus && !opts.validateStatus(r.status)) { const e = new Error(`s${r.status}`); e.response = { status: r.status }; throw e; }
    return { status: r.status, data: r.data ?? "", headers: { "content-type": "text/html" }, finalUrl: url };
  };
  return { db, sid, transport, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const html = (b) => ({ status: 200, data: `<html><body><main>${b}</main></body></html>` });
const feederFound = (env) => upsertEvidence(env.sid, "corrections-presence", { status: "evidenced", value: { found: true, via: "nav", url: `https://${DOMAIN}/corrections` }, confidence: 0.7, evidenceUrl: `https://${DOMAIN}/corrections`, gatheredAt: NOW }, "v1.1", env.db);
const sevCtx = (env, llmCall) => ({ db: env.db, now: NOW, transport: env.transport, methodologyVersion: "v1.1", llmCall, buildPrompt: () => "P" });

test("2.5.b — feeder evidenced+found → fetch + judge → EVIDENCED severity bucket", async () => {
  const env = sevEnv(() => html("Correction: an earlier version misstated the unemployment figure. Also fixed a typo in a name."));
  feederFound(env);
  const ev = await severity.gather({ id: env.sid, name: "SevSrc" }, sevCtx(env, queueLLM([j("mixed", "misstated the unemployment figure"), j("mixed", "misstated the unemployment figure"), j("mixed", "fixed a typo in a name")])));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.bucket, "mixed");
  env.cleanup();
});

test("2.5.b — levels[0] 'substantive errors common' only with a quoted substantive correction", async () => {
  const env = sevEnv(() => html("Correction: the article misreported the court's ruling, a factual error now corrected."));
  feederFound(env);
  const ev = await severity.gather({ id: env.sid, name: "SevSrc" }, sevCtx(env, queueLLM([j("substantive errors common", "misreported the court's ruling"), j("substantive errors common", "misreported the court's ruling"), j("substantive errors common", "a factual error now corrected")])));
  assert.equal(ev.value.bucket, "substantive errors common");
  assert.equal(ev.value.ungrounded, false, "lowest bucket grounded by a substantive-correction locus");
  env.cleanup();
});

test("2.5.b — feeder PENDING → PENDING 'corrections-page-not-located' (not lowest), no LLM call", async () => {
  const env = sevEnv(() => html("x"));
  upsertEvidence(env.sid, "corrections-presence", { status: "pending", value: { found: false }, confidence: 0, evidenceUrl: null, gatheredAt: NOW }, "v1.1", env.db);
  const llm = queueLLM([j("substantive errors common", "x")]);
  const ev = await severity.gather({ id: env.sid, name: "SevSrc" }, sevCtx(env, llm));
  assert.equal(ev.status, "pending");
  assert.equal(ev.value.reason, "corrections-page-not-located");
  assert.equal(ev.value.bucket, undefined);
  assert.equal(llm.calls.length, 0);
  env.cleanup();
});

test("2.5.b — re-fetch fail (403) → BLOCKED", async () => {
  const env = sevEnv(() => ({ status: 403 }));
  feederFound(env);
  const ev = await severity.gather({ id: env.sid, name: "SevSrc" }, sevCtx(env, queueLLM([])));
  assert.equal(ev.status, "blocked");
  assert.match(ev.value.reason, /^refetch-/);
  env.cleanup();
});

test("2.5.b — module shape (HA, ttl 180, no needsArticleBodies)", () => {
  assert.equal(severity.id, "2.5.b");
  assert.equal(severity.component, "HA");
  assert.equal(severity.ttlDays, 180);
  assert.notEqual(severity.needsArticleBodies, true);
});

test("2.2.d — module shape (MT, ttl 120, needsArticleBodies)", () => {
  assert.equal(coi.id, "2.2.d");
  assert.equal(coi.component, "MT");
  assert.equal(coi.ttlDays, 120);
  assert.equal(coi.needsArticleBodies, true);
});
