/**
 * judgmentOnPresence.test.js — B.6.3b tests (node --test, offline).
 *
 * The two judgment-on-presence modules (2.1.d functioning corrections, 2.4.b
 * funding-mix) on temp DBs with mocked feeder rows, a mocked fetch transport, and
 * a mocked llmCall (NO real LLM, NO real network). Proves: feeder-evidenced →
 * judged; the LOCUS-grounding (low bucket stays grounded, NOT 0.4-penalized); the
 * Q2 honesty (feeder-pending → pending, never lowest bucket); re-fetch-fail →
 * blocked (2.1.d) / no-op keep-presence (2.4.b); 2.4.b upgrade-in-place + the
 * split→pending-llm-with-presenceConfirmed; already-judged skip; evidence-only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runMigrations } from "../../../db/migrate.js";
import { getEvidence, upsertEvidence } from "./evidenceCache.js";
import { parseHtml } from "./httpFetch.js";
import { pageText } from "./llm/pageText.js";
import corrections from "./modules/functioningCorrections_2_1_d.js";
import funding from "./modules/fundingMixJudgment_2_4_b.js";

const NOW = 1_750_000_000_000;
const DOMAIN = "outlet.example";

function makeEnv(route) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-jop-"));
  const db = new Database(path.join(dir, "t.db"));
  runMigrations(db);
  db.exec(`CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, url TEXT, source_name TEXT NOT NULL, published_at INTEGER NOT NULL, is_duplicate INTEGER DEFAULT 0);`);
  const sid = db.prepare(`INSERT INTO sources (name,url,source_type,category,region,created_at,updated_at) VALUES ('Outlet','https://feeds.outlet.example/rss','rss','news','global',?,?)`).run(NOW, NOW).lastInsertRowid;
  const ins = db.prepare(`INSERT INTO articles (id,url,source_name,published_at,is_duplicate) VALUES (?,?,?,?,0)`);
  for (let i = 0; i < 5; i++) ins.run(`a${i}`, `https://${DOMAIN}/news/${i}`, "Outlet", NOW - i * 86400000);
  const transport = async (url, opts) => {
    const r = url.endsWith("/robots.txt") ? { status: 404 } : route(url);
    if (opts.validateStatus && !opts.validateStatus(r.status)) { const e = new Error(`s${r.status}`); e.response = { status: r.status }; throw e; }
    return { status: r.status, data: r.data ?? "", headers: { "content-type": "text/html" }, finalUrl: url };
  };
  return { db, sid, transport, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const html = (body) => ({ status: 200, data: `<html><body><main>${body}</main></body></html>` });
function mockLLM(results) { let i = 0; const calls = []; const fn = async (p) => { calls.push(p); return results[i++] ?? null; }; fn.calls = calls; return fn; }
const j = (bucket, quote) => ({ bucket, groundingQuote: quote, reasoning: "r" });
const setFeeder = (env, id, ev) => upsertEvidence(env.sid, id, { confidence: 0.7, evidenceUrl: null, gatheredAt: NOW, ...ev }, "v1.1", env.db);
const ctxOf = (env, llmCall) => ({ db: env.db, now: NOW, transport: env.transport, methodologyVersion: "v1.1", llmCall, buildPrompt: () => "PROMPT" });

// ── 2.1.d functioning corrections ─────────────────────────────────────────────
test("2.1.d — feeder evidenced + public-log page → EVIDENCED top bucket, grounded", async () => {
  const env = makeEnv(() => html("Public corrections log. We append timestamped corrections describing the original error."));
  setFeeder(env, "corrections-presence", { status: "evidenced", value: { found: true, via: "nav", url: `https://${DOMAIN}/corrections` }, evidenceUrl: `https://${DOMAIN}/corrections` });
  const ev = await corrections.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, mockLLM([j("public corrections log", "Public corrections log"), j("public corrections log", "timestamped corrections"), j("public corrections log", "Public corrections log")])));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.bucket, "public corrections log");
  assert.equal(ev.value.ungrounded, false);
  assert.ok(ev.confidence >= 0.9);
  env.cleanup();
});

test("2.1.d — LOCUS grounding: empty corrections page → lowest bucket but GROUNDED (not 0.4-penalized)", async () => {
  const env = makeEnv(() => html("Corrections. No corrections have been published."));
  setFeeder(env, "corrections-presence", { status: "evidenced", value: { found: true, via: "nav", url: `https://${DOMAIN}/corrections` }, evidenceUrl: `https://${DOMAIN}/corrections` });
  // All runs pick the lowest bucket, grounding the LOCUS (the empty-state text that IS on the page).
  const ev = await corrections.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, mockLLM([j("no corrections process", "No corrections have been published"), j("no corrections process", "No corrections have been published"), j("no corrections process", "No corrections have been published")])));
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.bucket, "no corrections process");
  assert.equal(ev.value.ungrounded, false, "the locus quote grounds the low bucket");
  assert.equal(ev.value.groundingFactor, 1);
  assert.equal(ev.confidence, 1, "locus-grounded low bucket is NOT the 0.4 ungrounded penalty");
  env.cleanup();
});

test("2.1.d — Q2 honesty: feeder PENDING → PENDING, NEVER the lowest bucket", async () => {
  const env = makeEnv(() => html("should not be fetched"));
  setFeeder(env, "corrections-presence", { status: "pending", value: { found: false }, evidenceUrl: null });
  const llm = mockLLM([j("no corrections process", "x")]);
  const ev = await corrections.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, llm));
  assert.equal(ev.status, "pending");
  assert.equal(ev.value.reason, "corrections-page-not-located");
  assert.equal(ev.value.bucket, undefined, "must NOT assign a bucket from absence-of-location");
  assert.equal(llm.calls.length, 0, "no judgment attempted without a located page");
  env.cleanup();
});

test("2.1.d — feeder blocked/unavailable → propagate", async () => {
  const env = makeEnv(() => html("x"));
  setFeeder(env, "corrections-presence", { status: "unavailable", value: { found: false, reason: "no-editorial-domain" }, evidenceUrl: null });
  const ev = await corrections.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, mockLLM([])));
  assert.equal(ev.status, "unavailable");
  env.cleanup();
});

test("2.1.d — re-fetch fail → BLOCKED (a fetch failure is not an absence)", async () => {
  const env = makeEnv(() => ({ status: 403 }));
  setFeeder(env, "corrections-presence", { status: "evidenced", value: { found: true, via: "nav", url: `https://${DOMAIN}/corrections` }, evidenceUrl: `https://${DOMAIN}/corrections` });
  const ev = await corrections.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, mockLLM([])));
  assert.equal(ev.status, "blocked");
  assert.match(ev.value.reason, /^refetch-/);
  env.cleanup();
});

test("2.1.d — split runs → PENDING-LLM (never a confident pick)", async () => {
  const env = makeEnv(() => html("Some corrections text here for grounding purposes."));
  setFeeder(env, "corrections-presence", { status: "evidenced", value: { found: true, via: "nav", url: `https://${DOMAIN}/corrections` }, evidenceUrl: `https://${DOMAIN}/corrections` });
  const ev = await corrections.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, mockLLM([j("no corrections process", "Some corrections"), j("corrections issued but not transparent", "Some corrections"), j("public corrections log", "Some corrections")])));
  assert.equal(ev.status, "pending-llm");
  assert.equal(ev.value.founderFlag, true);
  env.cleanup();
});

// ── 2.4.b funding mix (upgrade in place) ──────────────────────────────────────
const presence24b = { status: "evidenced", value: { found: true, via: "nav", url: `https://${DOMAIN}/funding` }, evidenceUrl: `https://${DOMAIN}/funding` };

test("2.4.b — presence + named-funder page → UPGRADED in place to 'disclosed by named funder'", async () => {
  const env = makeEnv(() => html("Funded by the Acme Foundation and the XYZ Trust. We also run membership."));
  setFeeder(env, "2.4.b", presence24b);
  const ret = await funding.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, mockLLM([j("disclosed by named funder", "Funded by the Acme Foundation"), j("disclosed by named funder", "Funded by the Acme Foundation"), j("disclosed by named funder", "the XYZ Trust")])));
  assert.equal(ret, null, "upgrade-in-place returns null (no own row)");
  const row = getEvidence(env.sid, "2.4.b", env.db);
  assert.equal(row.status, "evidenced");
  assert.equal(row.value.bucket, "disclosed by named funder");
  assert.equal(row.value.basis, "llm-multi-run-agreement");
  assert.equal(row.value.presenceConfirmed, true);
  env.cleanup();
});

test("2.4.b — opaque page → 'opaque', LOCUS-grounded (not 0.4-penalized)", async () => {
  const env = makeEnv(() => html("We are reader-supported and fiercely independent."));
  setFeeder(env, "2.4.b", presence24b);
  await funding.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, mockLLM([j("opaque", "We are reader-supported and fiercely independent"), j("opaque", "reader-supported and fiercely independent"), j("opaque", "We are reader-supported")])));
  const row = getEvidence(env.sid, "2.4.b", env.db);
  assert.equal(row.value.bucket, "opaque");
  assert.equal(row.value.ungrounded, false);
  assert.equal(row.confidence, 1);
  env.cleanup();
});

test("2.4.b — already judged (basis set) → NO-OP, no re-judge", async () => {
  const env = makeEnv(() => html("should not fetch"));
  setFeeder(env, "2.4.b", { status: "evidenced", value: { found: true, url: `https://${DOMAIN}/funding`, basis: "llm-multi-run-agreement", bucket: "opaque" }, evidenceUrl: `https://${DOMAIN}/funding` });
  const llm = mockLLM([j("disclosed by named funder", "x")]);
  const ret = await funding.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, llm));
  assert.equal(ret, null);
  assert.equal(llm.calls.length, 0, "already-judged row must not be re-judged");
  assert.equal(getEvidence(env.sid, "2.4.b", env.db).value.bucket, "opaque", "row unchanged");
  env.cleanup();
});

test("2.4.b — presence PENDING (page not located) → NO-OP (Q2: never 'opaque' from absence)", async () => {
  const env = makeEnv(() => html("x"));
  setFeeder(env, "2.4.b", { status: "pending", value: { found: false }, evidenceUrl: null });
  const llm = mockLLM([j("opaque", "x")]);
  const ret = await funding.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, llm));
  assert.equal(ret, null);
  assert.equal(llm.calls.length, 0);
  assert.equal(getEvidence(env.sid, "2.4.b", env.db).status, "pending", "presence-pending left untouched");
  env.cleanup();
});

test("2.4.b — re-fetch fail → NO-OP, KEEPS the presence row (no downgrade)", async () => {
  const env = makeEnv(() => ({ status: 403 }));
  setFeeder(env, "2.4.b", presence24b);
  const ret = await funding.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, mockLLM([])));
  assert.equal(ret, null);
  const row = getEvidence(env.sid, "2.4.b", env.db);
  assert.equal(row.status, "evidenced");
  assert.equal(row.value.found, true, "presence row preserved, not downgraded");
  assert.equal(row.value.bucket, undefined);
  env.cleanup();
});

test("2.4.b — genuine split → upsert PENDING-LLM with presenceConfirmed:true (page-exists fact preserved)", async () => {
  const env = makeEnv(() => html("Funding info that is genuinely ambiguous about category vs named funders."));
  setFeeder(env, "2.4.b", presence24b);
  await funding.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, mockLLM([j("disclosed in aggregate", "Funding info"), j("disclosed by category", "genuinely ambiguous"), j("disclosed by named funder", "named funders")])));
  const row = getEvidence(env.sid, "2.4.b", env.db);
  assert.equal(row.status, "pending-llm");
  assert.equal(row.value.presenceConfirmed, true, "downgrade must not erase that the page exists");
  assert.match(row.value.reason, /runs-(disagree|tie)/);
  env.cleanup();
});

test("2.4.b — LLM_DISABLED → NO-OP, keeps presence (no fabricated/ downgraded score)", async () => {
  const prev = process.env.LLM_DISABLED;
  process.env.LLM_DISABLED = "1";
  try {
    const env = makeEnv(() => html("Funded by the Acme Foundation."));
    setFeeder(env, "2.4.b", presence24b);
    const ret = await funding.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, mockLLM([j("disclosed by named funder", "x")])));
    assert.equal(ret, null);
    const row = getEvidence(env.sid, "2.4.b", env.db);
    assert.equal(row.status, "evidenced");
    assert.equal(row.value.found, true, "presence kept when LLM disabled");
    env.cleanup();
  } finally {
    if (prev === undefined) delete process.env.LLM_DISABLED; else process.env.LLM_DISABLED = prev;
  }
});

// ── pageText + evidence-only ──────────────────────────────────────────────────
test("pageText — truncation flag set when capped; main-region preferred", () => {
  const long = "word ".repeat(5000); // ~25k chars
  const r = pageText(parseHtml(`<html><body><main>${long}</main></body></html>`), { cap: 1000 });
  assert.equal(r.truncated, true);
  assert.ok(r.text.length <= 1000);
  const r2 = pageText(parseHtml("<html><body><nav>menu</nav><main>short main text</main></body></html>"), { cap: 1000 });
  assert.equal(r2.truncated, false);
  assert.match(r2.text, /short main text/);
});

test("evidence-only — neither module writes sources.quality_score", async () => {
  const env = makeEnv(() => html("Funded by the Acme Foundation."));
  setFeeder(env, "corrections-presence", { status: "evidenced", value: { found: true, url: `https://${DOMAIN}/corrections` }, evidenceUrl: `https://${DOMAIN}/corrections` });
  setFeeder(env, "2.4.b", presence24b);
  await corrections.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, mockLLM([j("public corrections log", "Funded"), j("public corrections log", "Funded"), j("public corrections log", "Funded")])));
  await funding.gather({ id: env.sid, name: "Outlet" }, ctxOf(env, mockLLM([j("disclosed by named funder", "Funded by the Acme Foundation"), j("disclosed by named funder", "Funded by the Acme Foundation"), j("disclosed by named funder", "Funded by the Acme Foundation")])));
  assert.equal(env.db.prepare("SELECT quality_score FROM sources WHERE id=?").get(env.sid).quality_score, null);
  env.cleanup();
});
