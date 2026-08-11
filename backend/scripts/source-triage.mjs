/**
 * source-triage.mjs — triage the ingestion source list.
 *
 * Answers three questions about the failing sources in `source_health`:
 *
 *   1. Which health rows no longer correspond to a configured source?
 *      (orphans — nothing fetches them, their counters are frozen, and they
 *      inflate the failure count on /api/news/stats forever)
 *   2. Which failing sources are FIXABLE (wrong URL, UA-gated, moved, slow)
 *      and which are genuinely dead? — requires --probe
 *   3. Did several sources stop working at the same instant? If so, what was
 *      the first error each of them logged at that moment? — the shared-cause
 *      question, answered from `ingestion_logs`.
 *
 * READ-ONLY. Opens SQLite in readonly mode and deliberately does NOT call
 * getDb()/bootstrapSchema(), so it is safe to point at a pulled prod snapshot
 * without mutating it. It never edits config/sources.js: retiring or repointing
 * a source is a judgement call with a DrJ approval gate, so this prints
 * recommendations and stops.
 *
 * Usage:
 *   npm run source:triage                      # offline: reconcile + cohorts
 *   npm run source:triage -- --probe           # + live-fetch every source
 *   npm run source:triage -- --db /tmp/prod.db # against a prod snapshot
 *   npm run source:triage -- --json out.json   # machine-readable report
 *
 * --probe makes one request per configured source (154 today) with the
 * production User-Agent, and a second request with a browser UA for each
 * failure. Run it from a host with normal egress: a sandbox or CI runner whose
 * proxy blocks news domains will report every source as blocked and the
 * verdicts will be worthless.
 */

import "../src/config/env.js";
import fs from "node:fs";
import Database from "better-sqlite3";
import Parser from "rss-parser";
import { getDbPath } from "../src/models/database.js";
import { RSS_SOURCES, YOUTUBE_SOURCES } from "../src/config/sources.js";
import {
  configuredHealthKeys,
  reconcile,
  classifyProbe,
  normalizeParserError,
  findCohorts,
  neverWorked,
  wasteEstimate,
  logKey,
  failureBudget,
} from "../src/services/sourceTriage.js";

// Cron cadences, read from scheduler.js:603 ("2,32 * * * *") and :618 ("9 * * * *").
// Kept here rather than parsed so a scheduler edit shows up as a diff to review.
const RSS_CYCLES_PER_DAY = 48;
const YT_CYCLES_PER_DAY = 24;

function parseArgs(argv) {
  const out = { probe: false, db: null, json: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--probe") out.probe = true;
    else if (a === "--db") out.db = argv[++i];
    else if (a === "--json") out.json = argv[++i];
    else if (a === "--only") out.only = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else die(`unknown argument "${a}" (try --help)`);
  }
  return out;
}
function die(msg) {
  console.error(`source-triage: ${msg}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?|^ \* ?/gm, ""));
  process.exit(0);
}

const dbPath = args.db || getDbPath();
if (!fs.existsSync(dbPath)) die(`no database at ${dbPath}`);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const hasTable = (name) =>
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
if (!hasTable("source_health")) die(`${dbPath} has no source_health table — is this a scoopfeeds database?`);

const healthRows = db.prepare("SELECT * FROM source_health").all();
const configured = configuredHealthKeys(RSS_SOURCES, YOUTUBE_SOURCES);
const { active, orphan, unfetched } = reconcile(healthRows, configured);

const NOW = Date.now();
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const fmtDate = (ms) => (ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 16) : "NEVER");
const failing = active.filter((r) => (r.consecutive_failures || 0) > 0);

// ── ingestion_logs forensics ────────────────────────────────────────────────
// The transition — the FIRST error logged after the last success — is the
// evidence that names a shared cause. The latest error tells you what the
// source does today, which may have changed since.
const logsAvailable = hasTable("ingestion_logs");
const firstErrorAfter = logsAvailable
  ? db.prepare(`
      SELECT error_msg, fetched_at FROM ingestion_logs
      WHERE source_name = ? AND status = 'error' AND fetched_at > ?
      ORDER BY fetched_at ASC LIMIT 1
    `)
  : null;
const latestError = logsAvailable
  ? db.prepare(`
      SELECT error_msg, fetched_at FROM ingestion_logs
      WHERE source_name = ? AND status = 'error'
      ORDER BY fetched_at DESC LIMIT 1
    `)
  : null;

function forensics(row) {
  if (!logsAvailable) return {};
  // source_health and ingestion_logs key YouTube sources differently.
  const key = row.config ? logKey(row.config, row.config.kind) : row.source_name;
  return {
    transition: row.last_success ? firstErrorAfter.get(key, row.last_success) : null,
    latest: latestError.get(key),
  };
}

// ── report ──────────────────────────────────────────────────────────────────
const report = { generatedAt: Date.now(), dbPath, probed: args.probe };
const line = (s = "") => console.log(s);
const rule = (t) => line(`\n─── ${t} ${"─".repeat(Math.max(0, 68 - t.length))}`);

line(`source-triage — ${dbPath}`);
line(`config: ${RSS_SOURCES.length} RSS + ${YOUTUBE_SOURCES.length} YouTube = ${configured.size} sources`);
line(`source_health rows: ${healthRows.length}`);

rule("1. RECONCILIATION");
report.reconciliation = {
  healthRows: healthRows.length,
  configured: configured.size,
  active: active.length,
  orphan: orphan.map((r) => r.source_name),
  unfetched: unfetched.map((r) => r.source_name),
};
line(`active (configured + has a health row): ${active.length}`);
line(`orphan (health row, no config entry):   ${orphan.length}`);
line(`unfetched (configured, never ran):      ${unfetched.length}`);

if (orphan.length) {
  line(`\nOrphan rows — these are NOT failing sources. Nothing fetches them, so`);
  line(`their counters are frozen at whatever they were when the config entry was`);
  line(`removed. They cannot be "retired" (there is no config entry to delete);`);
  line(`they need the health row swept. Until then they inflate every failure`);
  line(`count on /api/news/stats.`);
  for (const r of orphan) {
    line(`  ${r.source_name.padEnd(34)} failures=${String(r.consecutive_failures).padStart(6)}  ` +
         `articles=${String(r.total_articles ?? 0).padStart(6)}  last_success=${fmtDate(r.last_success)}`);
  }
}
if (unfetched.length) {
  line(`\nConfigured but no health row yet:`);
  for (const r of unfetched.slice(0, 15)) line(`  ${r.source_name}`);
  if (unfetched.length > 15) line(`  … and ${unfetched.length - 15} more (see --json for the full list)`);
}

rule("2. NEVER WORKED (configured, zero successes ever)");
const never = neverWorked(active);
report.neverWorked = never.map((r) => ({
  source: r.source_name, failures: r.consecutive_failures, url: r.config?.url || r.config?.channelId,
}));
line(`${never.length} configured sources have never once succeeded.`);
line(`No regression to find — the entry has been wrong since it was added.\n`);
for (const r of never) {
  const f = forensics(r);
  line(`  ${r.source_name.padEnd(34)} ${String(r.consecutive_failures).padStart(6)}x  ${r.config?.url || r.config?.channelId || ""}`);
  if (f.latest?.error_msg) line(`  ${" ".repeat(34)} └─ ${f.latest.error_msg}`);
}

rule("3. COHORTS (stopped working at the same instant)");
const cohorts = findCohorts(active, dayOf);
report.cohorts = [];
if (!cohorts.length) {
  line("No two sources share a last-success day AND an identical failure count.");
} else {
  line(`Identical consecutive_failures across sources means they have failed in`);
  line(`lockstep in every cycle since the same moment — one cause, not N.\n`);
}
for (const c of cohorts) {
  line(`  ${c.members.length} sources · last success ${c.day} · ${c.consecutiveFailures} consecutive failures`);
  const entry = { day: c.day, consecutiveFailures: c.consecutiveFailures, members: [] };
  for (const m of c.members) {
    const f = forensics(m);
    line(`    ${m.source_name.padEnd(30)} ${m.config?.url || m.config?.channelId || ""}`);
    line(`      last success  ${fmtDate(m.last_success)}`);
    if (f.transition) {
      line(`      FIRST error   ${fmtDate(f.transition.fetched_at)}  "${f.transition.error_msg}"`);
    } else if (logsAvailable) {
      line(`      FIRST error   (not in ingestion_logs — pull a wider --days window)`);
    }
    if (f.latest) line(`      latest error  ${fmtDate(f.latest.fetched_at)}  "${f.latest.error_msg}"`);
    entry.members.push({
      source: m.source_name,
      url: m.config?.url || m.config?.channelId,
      lastSuccess: m.last_success,
      transition: f.transition || null,
      latest: f.latest || null,
    });
  }
  // The gap between last success and first error is the tell: contiguous means
  // the source broke; a multi-cycle gap means the CYCLE stopped running, and
  // the source is a bystander.
  const gaps = entry.members.map((m) => (m.transition ? m.transition.fetched_at - m.lastSuccess : null)).filter(Boolean);
  if (gaps.length) {
    const expected = (24 / RSS_CYCLES_PER_DAY) * 3600 * 1000; // one cycle
    const maxGap = Math.max(...gaps);
    line(`\n    gap last-success → first-error: ${(maxGap / 3600000).toFixed(1)}h ` +
         `(one ingestion cycle = ${(expected / 3600000).toFixed(1)}h)`);
    line(maxGap > expected * 3
      ? `    ⚠ larger than one cycle — the ingestion CYCLE likely stopped for a while;\n` +
        `      these sources may be bystanders rather than the thing that broke.`
      : `    contiguous — these sources broke while ingestion kept running.`);
  }

  // Does the counter account for every cycle since the last success? If not,
  // the shortfall is the scheduler's, not the source's.
  const cyclesPerDay = c.members.every((m) => m.config?.kind === "yt") ? YT_CYCLES_PER_DAY : RSS_CYCLES_PER_DAY;
  const budget = failureBudget(c.members[0], { now: NOW, cyclesPerDay });
  if (budget) {
    entry.budget = budget;
    line(`    failure budget: ${budget.observed} observed vs ${budget.expected} expected ` +
         `(${budget.days}d x ${cyclesPerDay}/day) — ratio ${budget.ratio}`);
    if (budget.shortfall) {
      line(`    ⚠ ${budget.expected - budget.observed} cycles never attempted these sources.`);
      line(`      consecutive_failures only increments on an attempt, so the missing`);
      line(`      cycles did not run. Check the scheduler/worker for that window before`);
      line(`      concluding anything about the sources themselves.`);
    }
  }
  report.cohorts.push(entry);
  line("");
}

rule("4. WASTE");
const waste = wasteEstimate(active, { rssCyclesPerDay: RSS_CYCLES_PER_DAY, ytCyclesPerDay: YT_CYCLES_PER_DAY });
report.waste = waste;
line(`${waste.failingRss} failing RSS + ${waste.failingYt} failing YouTube sources are still`);
line(`fetched on every cycle — fetchAllSources() has no backoff, quarantine or`);
line(`retry ceiling (rssFetcher.js:239-255), so failure count never affects`);
line(`whether a source is attempted again.`);
line(`\n  ≈ ${waste.fetchesPerDay.toLocaleString()} wasted outbound requests/day`);

// ── 5. live probe ───────────────────────────────────────────────────────────
if (args.probe) {
  rule("5. LIVE PROBE");

  // Verbatim from rssFetcher.js:21-26 and videoFetcher.js:9-14 — the point is
  // to reproduce production's request exactly, so a verdict here means the
  // same thing as a row in source_health.
  const ACCEPT = "application/rss+xml, application/xml, text/xml, application/atom+xml";
  const mkParser = (ua, timeout) => new Parser({ timeout, headers: { "User-Agent": ua, Accept: ACCEPT } });
  const prodRss = mkParser("NewsAggregator/1.0 (RSS Reader; educational/news aggregation)", 15000);
  const prodYt = mkParser("NewsAggregator/1.0 (YouTube RSS Reader)", 12000);
  const browser = mkParser(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    20000,
  );

  async function attempt(parser, url) {
    try {
      const feed = await parser.parseURL(url);
      const itemCount = (feed.items || []).length;
      return { ok: itemCount > 0, status: 200, isFeed: true, itemCount, finalUrl: url };
    } catch (err) {
      return { ok: false, ...normalizeParserError(err.message) };
    }
  }

  const targets = [];
  for (const s of RSS_SOURCES) targets.push({ kind: "rss", name: s.name, url: s.url, parser: prodRss });
  for (const s of YOUTUBE_SOURCES) {
    targets.push({
      kind: "yt", name: `yt:${s.name}`, parser: prodYt,
      url: `https://www.youtube.com/feeds/videos.xml?channel_id=${s.channelId}`,
    });
  }
  const list = args.only
    ? targets.filter((t) => t.name.toLowerCase().includes(args.only.toLowerCase()))
    : targets;

  // Same batching discipline as fetchAllSources(): 5 at a time, 1s between
  // batches. Do not raise it — this hits 154 third-party origins.
  const results = [];
  for (let i = 0; i < list.length; i += 5) {
    const batch = list.slice(i, i + 5);
    const done = await Promise.all(batch.map(async (t) => {
      const prod = await attempt(t.parser, t.url);
      const alt = prod.ok ? null : await attempt(browser, t.url);
      return { name: t.name, kind: t.kind, ...classifyProbe({ url: t.url, prod, browser: alt }) };
    }));
    results.push(...done);
    for (const r of done) process.stderr.write(`  ${r.verdict.padEnd(13)} ${r.name}\n`);
    if (i + 5 < list.length) await new Promise((r) => setTimeout(r, 1000));
  }

  const byBucket = { fix: [], retire: [], review: [], keep: [] };
  for (const r of results) byBucket[r.bucket].push(r);
  report.probe = results.map((r) => ({
    source: r.name, url: r.url, verdict: r.verdict, bucket: r.bucket, action: r.action,
    prodError: r.prod?.raw || null, browserError: r.browser?.raw || null,
  }));

  for (const [bucket, label] of [
    ["fix", "(a) FIX — recoverable"],
    ["retire", "(b) RETIRE — delete the config entry"],
    ["review", "REVIEW — needs a human call before acting"],
  ]) {
    const rows = byBucket[bucket];
    line(`\n${label}: ${rows.length}`);
    for (const r of rows) {
      line(`  ${r.name.padEnd(30)} ${r.verdict.padEnd(13)} ${r.action}`);
      line(`  ${" ".repeat(30)} ${r.url}`);
      if (r.prod?.raw) line(`  ${" ".repeat(30)} prod-UA: ${r.prod.raw}`);
    }
  }
  line(`\nhealthy: ${byBucket.keep.length}/${results.length}`);
}

if (args.json) {
  fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
  line(`\nwrote ${args.json}`);
}

db.close();
