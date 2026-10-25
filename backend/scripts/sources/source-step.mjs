#!/usr/bin/env node
/**
 * source-step.mjs — probe, score and admit candidate RSS sources for a plan v7 source step (#251).
 *
 *   node scripts/sources/source-step.mjs probe  [--candidates FILE] [--out FILE]
 *   node scripts/sources/source-step.mjs score  --probed FILE [--floor N] [--out FILE]
 *   node scripts/sources/source-step.mjs floor  --db COPY_OF_news.db
 *
 * probe  Fetches each candidate feed and applies probeVerdict() (sourceAdmission.js): parses,
 *        ≥5 items, newest < 72 h, English, host not already in config/sources.js. Network only;
 *        writes nothing but --out.
 * score  For the candidates that passed the probe: builds a SCRATCH database in a new temp dir
 *        (never the prod DB: SCOOP_PERSISTENT_DATA_DIR is overridden before anything opens a DB),
 *        ingests each feed with the production fetchSource(), runs the production scoring job,
 *        and applies admissionVerdict(). Needs the LLM (ANTHROPIC_API_KEY): most scoring
 *        components are LLM judgments, and without it a candidate can never reach 3 measured
 *        components, so this command refuses to run rather than report everyone "rejected".
 * floor  Reads quality_score of the active RSS sources from a COPY of news.db (opened read-only)
 *        and prints the floor floorFromScores() gives, with the reason.
 *
 * Output (--out, JSON) is what docs/sources/source_batches.md is written from. This script never
 * edits config/sources.js: adding the admitted entries is a reviewed code change.
 *
 * Cloud sandboxes: run with NODE_USE_ENV_PROXY=1 so Node's HTTP goes through the egress proxy.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, dflt = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const writeOut = (obj) => { const out = opt("out"); const s = JSON.stringify(obj, null, 2); if (out) fs.writeFileSync(out, s + "\n"); else console.log(s); };

async function probe() {
  const { default: Parser } = await import("rss-parser");
  const { RSS_SOURCES } = await import("../../src/config/sources.js");
  const { probeVerdict, hostOf } = await import("../../src/skills/scoring/sourceAdmission.js");
  const candidates = JSON.parse(fs.readFileSync(opt("candidates", path.join(here, "step1-candidates.json")), "utf8"));
  const existingHosts = new Set(RSS_SOURCES.map((s) => hostOf(s.url)).filter(Boolean));
  const parser = new Parser({ timeout: 20000, headers: { "User-Agent": "Mozilla/5.0 (compatible; ScoopFeedsBot/1.0; +https://scoopfeeds.com)" } });
  const seen = new Set();
  const results = [];
  for (const c of candidates) {
    let feed = null, error = null;
    const host = hostOf(c.url);
    // Two candidates on one host: only the first that passes joins a batch (no duplicate hosts).
    if (seen.has(host)) { results.push({ ...c, probe: { ok: false, reason: `host already in this batch (${host})` } }); continue; }
    try { feed = await parser.parseURL(c.url); } catch (e) { error = e.message; }
    const v = probeVerdict({ candidate: c, feed, error, existingHosts });
    if (v.ok) seen.add(host);
    results.push({ ...c, probe: v });
    console.error(`${v.ok ? "PASS" : "fail"}  ${c.name}  ${v.reason}`);
  }
  writeOut({ probedAt: new Date().toISOString(), candidates: results.length, passed: results.filter((r) => r.probe.ok).length, results });
}

async function score() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("score: ANTHROPIC_API_KEY is not set. Without the LLM only one scoring component can be measured, " +
      "so no candidate could ever be admitted. Refusing to run (unmeasured is not a rejection either).");
    process.exit(2);
  }
  // A brand-new scratch data dir, set BEFORE anything imports the DB module.
  process.env.SCOOP_PERSISTENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "source-step-"));
  delete process.env.DATABASE_PATH;
  const probed = JSON.parse(fs.readFileSync(opt("probed"), "utf8"));
  const passed = probed.results.filter((r) => r.probe?.ok);
  const { getDb } = await import("../../src/models/database.js");
  const { fetchSource } = await import("../../src/services/rssFetcher.js");
  const { runScoringJob } = await import("../../src/skills/scoring/runtime/scoringRun.js");
  const { syncSourcesFromConfig } = await import("../../src/db/sourceSync.js");
  const { admissionVerdict, sourceQualityFloor } = await import("../../src/skills/scoring/sourceAdmission.js");
  const db = getDb();
  if (!db.name.startsWith(process.env.SCOOP_PERSISTENT_DATA_DIR)) throw new Error(`refusing: DB ${db.name} is not the scratch DB`);
  const floor = opt("floor") != null ? Number(opt("floor")) : sourceQualityFloor();

  syncSourcesFromConfig(db, { rss: passed, youtube: [] });
  for (const c of passed) { const r = await fetchSource(c); console.error(`ingest ${c.name}: ${r.newArticles} new${r.errors.length ? `, ${r.errors.join("; ")}` : ""}`); }
  const rows = passed.map((c) => db.prepare("SELECT id, name, url, category, region FROM sources WHERE url = ?").get(c.url)).filter(Boolean);
  const summary = await runScoringJob({ db, sources: rows, writeStatus: false });

  const results = passed.map((c) => {
    const row = db.prepare("SELECT id, quality_score FROM sources WHERE url = ?").get(c.url);
    const audit = row && db.prepare("SELECT combined_score, reasoning_per_subcriterion FROM scoring_audit_log WHERE source_id = ? ORDER BY rowid DESC LIMIT 1").get(row.id);
    let reasoning = {};
    try { reasoning = JSON.parse(audit?.reasoning_per_subcriterion || "{}"); } catch { /* unreadable = unmeasured */ }
    const s = { status: reasoning.status, quality_score: row?.quality_score ?? null, coverage: reasoning.coverage };
    return { ...c, score: s, admission: admissionVerdict(s, { floor }) };
  });
  writeOut({ scoredAt: new Date().toISOString(), floor, scratchDb: db.name, summary, admitted: results.filter((r) => r.admission.admit).length, results });
}

async function floorCmd() {
  const { default: Database } = await import("better-sqlite3");
  const { floorFromScores, sourceQualityFloor } = await import("../../src/skills/scoring/sourceAdmission.js");
  const { RSS_SOURCES } = await import("../../src/config/sources.js");
  const db = new Database(opt("db"), { readonly: true, fileMustExist: true });
  const active = new Set(RSS_SOURCES.map((s) => s.url));
  const rows = db.prepare("SELECT url, quality_score FROM sources WHERE source_type = 'rss'").all().filter((r) => active.has(r.url));
  const scores = rows.map((r) => r.quality_score);
  const f = floorFromScores(scores, { base: sourceQualityFloor() });
  const measured = scores.filter(Number.isFinite).sort((a, b) => a - b);
  console.log(JSON.stringify({ activeRss: active.size, withRow: rows.length, scored: measured.length, min: measured[0] ?? null, max: measured.at(-1) ?? null, ...f }, null, 2));
}

const run = { probe, score, floor: floorCmd }[cmd];
if (!run) { console.error("usage: source-step.mjs probe|score|floor (see header)"); process.exit(1); }
await run();
process.exit(0);
