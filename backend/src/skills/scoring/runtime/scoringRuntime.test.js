/**
 * scoringRuntime.test.js — B.6.4a tests (node --test, offline).
 *
 * Corpus loader predicate, run-summary aggregation, the model-tier guard (both
 * directions, zero-LLM on abstain) via the runner, isModelValidated, and the job
 * over a small own-DB source set (no network, no LLM). Cron is NOT exercised.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runMigrations } from "../../../db/migrate.js";
import { getEvidence } from "../evidence/evidenceCache.js";
import { gatherForSource } from "../evidence/runner.js";
import { isModelValidated, VALIDATED_CAPABLE_MODELS } from "../evidence/llm/modelGuard.js";
import { loadScoreableSources, AGGREGATOR_DENYLIST } from "./corpus.js";
import { buildRunSummary } from "./runSummary.js";
import { runScoringJob } from "./scoringRun.js";

const NOW = 1_750_000_000_000;

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-rt-"));
  const db = new Database(path.join(dir, "t.db"));
  runMigrations(db);
  db.exec(`CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, url TEXT, title TEXT, author TEXT, category TEXT, language TEXT, source_name TEXT NOT NULL, published_at INTEGER NOT NULL, is_duplicate INTEGER DEFAULT 0);`);
  return { db, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

// ── corpus loader ──────────────────────────────────────────────────────────────
test("loadScoreableSources — editorial RSS only; excludes YouTube + aggregator denylist (against the seeded corpus)", () => {
  const { db, cleanup } = tmpDb(); // migration 002 seeds the real corpus
  const rssCount = db.prepare("SELECT COUNT(*) n FROM sources WHERE source_type='rss' AND url IS NOT NULL").get().n;
  const ytCount = db.prepare("SELECT COUNT(*) n FROM sources WHERE source_type='youtube'").get().n;
  const hnPresent = db.prepare("SELECT COUNT(*) n FROM sources WHERE name='Hacker News'").get().n > 0;

  const got = loadScoreableSources(db);
  // count = editorial rss minus any denylisted aggregator present in the seed
  assert.equal(got.length, rssCount - (hnPresent ? 1 : 0));
  assert.ok(got.every((s) => s.url), "every returned source has an editorial url");
  assert.ok(!got.some((s) => s.name === "Hacker News"), "Hacker News (aggregator) excluded");
  assert.ok(AGGREGATOR_DENYLIST.includes("Hacker News"));
  assert.ok(ytCount > 0 && got.length < rssCount + ytCount, "YouTube sources excluded");
  cleanup();
});

// ── run summary ──────────────────────────────────────────────────────────────
test("buildRunSummary — aggregates byStatus, guardedCount, flaggedCount, durationMs", () => {
  const runResults = [
    { source_id: 1, name: "A", results: [{ id: "2.1.c", status: "evidenced" }, { id: "2.2.c", status: "unavailable", guarded: true }, { id: "2.4.b", status: "pending" }] },
    { source_id: 2, name: "B", results: [{ id: "2.1.c", status: "evidenced" }, { id: "2.2.b", status: "blocked" }, { id: "x", status: "noop" }] },
  ];
  const s = buildRunSummary({ runResults, flaggedCount: 3, startedAt: 1000, finishedAt: 4000, sourcesProcessed: 2 });
  assert.equal(s.byStatus.evidenced, 2);
  assert.equal(s.byStatus.unavailable, 1);
  assert.equal(s.byStatus.pending, 1);
  assert.equal(s.byStatus.blocked, 1);
  assert.equal(s.byStatus.noop, 1);
  assert.equal(s.guardedCount, 1);
  assert.equal(s.flaggedCount, 3);
  assert.equal(s.durationMs, 3000);
  assert.equal(s.sourcesProcessed, 2);
});

// ── model-tier guard ──────────────────────────────────────────────────────────
test("isModelValidated — allowlist membership (pure)", () => {
  assert.equal(isModelValidated("qwen2.5-coder:7b"), true);
  assert.equal(isModelValidated("llama3.1:8b"), false);
  assert.equal(isModelValidated("llama3.2:latest"), false);
  assert.equal(isModelValidated(null), false);
  assert.equal(isModelValidated(undefined), false);
  assert.ok(VALIDATED_CAPABLE_MODELS.has("qwen2.5-coder:7b"));
});

function guardEnv() {
  const { db, cleanup } = tmpDb();
  const sid = db.prepare(`INSERT INTO sources (name,url,source_type,category,region,created_at,updated_at) VALUES ('GuardSrc','https://g.example/rss','rss','tech','global',?,?)`).run(NOW, NOW).lastInsertRowid;
  return { db, sid, cleanup };
}
const gatedModule = (spy) => ({ id: "_gated", component: "MT", ttlDays: 30, requiresCapableModel: true, gather: async () => { spy.called = true; return { status: "evidenced", value: { bucket: "x" }, confidence: 1, evidenceUrl: null, gatheredAt: NOW }; } });
const plainModule = (spy) => ({ id: "_plain", component: "MT", ttlDays: 30, gather: async () => { spy.called = true; return { status: "evidenced", value: { bucket: "y" }, confidence: 1, evidenceUrl: null, gatheredAt: NOW }; } });

test("guard — requiresCapableModel + UNVALIDATED model → unavailable 'model-not-validated', gather NOT called (zero LLM)", async () => {
  const env = guardEnv();
  const spy = { called: false };
  const res = await gatherForSource({ id: env.sid, name: "GuardSrc" }, { db: env.db, now: NOW, modules: [gatedModule(spy)], resolvedModel: "llama3.2:latest" });
  assert.equal(spy.called, false, "gather must not run on an unvalidated model");
  assert.equal(res[0].status, "unavailable");
  assert.equal(res[0].guarded, true);
  const row = getEvidence(env.sid, "_gated", env.db);
  assert.equal(row.status, "unavailable");
  assert.equal(row.value.reason, "model-not-validated");
  assert.equal(row.value.model, "llama3.2:latest");
  env.cleanup();
});

test("guard — requiresCapableModel + VALIDATED model → gather runs normally", async () => {
  const env = guardEnv();
  const spy = { called: false };
  const res = await gatherForSource({ id: env.sid, name: "GuardSrc" }, { db: env.db, now: NOW, modules: [gatedModule(spy)], resolvedModel: "qwen2.5-coder:7b" });
  assert.equal(spy.called, true, "gather runs on a validated model");
  assert.equal(res[0].status, "evidenced");
  env.cleanup();
});

test("guard — NON-gated module is unaffected by the resolved model", async () => {
  const env = guardEnv();
  const spy = { called: false };
  const res = await gatherForSource({ id: env.sid, name: "GuardSrc" }, { db: env.db, now: NOW, modules: [plainModule(spy)], resolvedModel: "llama3.2:latest" });
  assert.equal(spy.called, true, "a non-gated module runs regardless of model");
  assert.equal(res[0].status, "evidenced");
  env.cleanup();
});

// ── the job (offline, own-DB modules only) ──────────────────────────────────────
test("runScoringJob — executes a small slice, summarizes, writes a separate status artifact", async () => {
  const env = tmpDb();
  const ins = env.db.prepare(`INSERT INTO sources (name,url,source_type,category,region,created_at,updated_at) VALUES (?,?,'rss',?,?,?,?)`);
  const s1 = ins.run("Src One", "https://one.example/rss", "tech", "global", NOW, NOW).lastInsertRowid;
  const s2 = ins.run("Src Two", "https://two.example/rss", "news", "global", NOW, NOW).lastInsertRowid;
  const art = env.db.prepare(`INSERT INTO articles (id,url,title,author,category,language,source_name,published_at,is_duplicate) VALUES (?,?,?,?,?,?,?,?,0)`);
  for (let i = 0; i < 6; i++) { art.run(`a1${i}`, `https://one.example/n/${i}`, "t", "By Reporter", "tech", "en", "Src One", NOW - i * 86400000); art.run(`a2${i}`, `https://two.example/n/${i}`, "t", "By Writer", "news", "en", "Src Two", NOW - i * 86400000); }

  // own-DB modules only — no network, no LLM.
  const bylines = (await import("../evidence/modules/bylines_2_1_c.js")).default;
  const sustained = (await import("../evidence/modules/sustainedCoverage_2_3_c.js")).default;

  const statusPath = path.join(os.tmpdir(), `scoring-run-status-${Date.now()}.json`);
  const summary = await runScoringJob({
    db: env.db, now: NOW, finishedAt: NOW + 5000,
    sources: [{ id: s1, name: "Src One" }, { id: s2, name: "Src Two" }],
    gatherOpts: { modules: [bylines, sustained] },
    statusPath,
  });

  assert.equal(summary.sourcesProcessed, 2);
  assert.equal(summary.durationMs, 5000);
  const total = Object.values(summary.byStatus).reduce((a, b) => a + b, 0);
  assert.equal(total, 4, "2 sources × 2 modules = 4 module results");
  // Evidence rows were written for the own-DB criteria.
  assert.ok(getEvidence(s1, "2.1.c", env.db) || getEvidence(s1, "2.3.c", env.db), "evidence persisted");
  // Status artifact written to the SEPARATE path (not dashboard/status.json).
  assert.ok(fs.existsSync(statusPath), "status artifact written");
  const onDisk = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  assert.equal(onDisk.sourcesProcessed, 2);
  assert.ok(!statusPath.includes("dashboard"), "must not be the dashboard status.json");
  fs.rmSync(statusPath, { force: true });
  env.cleanup();
});
