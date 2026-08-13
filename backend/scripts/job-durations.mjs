/**
 * job-durations — how long background jobs actually take, from the ledger.
 *
 * WHY A SCRIPT AND NOT A SQL ONE-LINER. The prod DB is root-owned at
 * /var/lib/scoop/news.db and the runtime image is slim — no sqlite3 binary. The
 * app's own better-sqlite3 is the only reader present, so the query has to run
 * through node. Shipping it as a file also means the command that runs it needs
 * no quoting at all, which is the failure mode that mangled the last few pastes.
 *
 * Run it in the worker (any container with the scoop_data volume works):
 *
 *   cd /opt/scoopfeeds
 *   docker compose -f docker-compose.production.yml exec -T worker node scripts/job-durations.mjs
 *
 * Optional args, both plain: a queue name and a window in hours.
 *   ... node scripts/job-durations.mjs reality-index 24
 *   ... node scripts/job-durations.mjs all 6
 *
 * READ-ONLY. Opens the database with readonly:true, runs one SELECT, writes
 * nothing. Safe to run against live prod at any time.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

const queueArg = process.argv[2] || "reality-index";
const hours = Number.parseFloat(process.argv[3] || "24") || 24;

const dataDir = process.env.SCOOP_PERSISTENT_DATA_DIR || "/var/lib/scoop";
const dbPath = process.env.SCOOP_DB_PATH || path.join(dataDir, "news.db");

if (!existsSync(dbPath)) {
  console.error(`no database at ${dbPath}`);
  console.error("set SCOOP_DB_PATH, or run this inside a container with the scoop_data volume.");
  process.exit(2);
}

let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch (err) {
  console.error(`could not open ${dbPath} read-only: ${err.message}`);
  process.exit(2);
}

const hasTable = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='background_job_runs'")
  .get();
if (!hasTable) {
  console.error("background_job_runs does not exist in this database — nothing has been recorded.");
  process.exit(1);
}

const sinceMs = Date.now() - hours * 3600_000;
const whereQueue = queueArg === "all" ? "" : "AND queue = ?";
const params = queueArg === "all" ? [sinceMs] : [sinceMs, queueArg];

const rows = db.prepare(`
  SELECT queue, job_id,
         COUNT(*)          AS runs,
         MAX(duration_ms)  AS worst_ms,
         AVG(duration_ms)  AS avg_ms,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
  FROM background_job_runs
  WHERE created_at > ? AND duration_ms IS NOT NULL ${whereQueue}
  GROUP BY queue, job_id
  ORDER BY worst_ms DESC
`).all(...params);

db.close();

console.log(`background_job_runs · queue=${queueArg} · last ${hours}h · ${dbPath}\n`);

if (rows.length === 0) {
  console.log("no completed runs recorded in this window.");
  console.log("if that is a surprise, the jobs may be failing before withJobRunLogging writes a duration.");
  process.exit(0);
}

const secs = (ms) => (ms / 1000).toFixed(1).padStart(8);
console.log("     worst        avg   runs  failed  job");
console.log("----------  ---------  -----  ------  ------------------------------");
for (const r of rows) {
  console.log(
    `${secs(r.worst_ms)}s ${secs(r.avg_ms)}s  ${String(r.runs).padStart(5)}  ${String(r.failed).padStart(6)}  ${r.job_id || "(no id)"}`
  );
}

// The decision this measurement exists to settle, stated so the number does not
// need re-interpreting later. The reality-index lock was raised to 10 min as an
// INTERIM fix; eventPromoter + eventBreaker are one uninterrupted synchronous
// block, so the lock cannot be renewed at all while the job runs.
const worst = Math.max(...rows.map((r) => r.worst_ms));
const LOCK_MS = 10 * 60_000;
console.log(`\nworst single run: ${(worst / 1000).toFixed(1)}s against a ${LOCK_MS / 60000}-minute lock.`);
if (worst > LOCK_MS * 0.5) {
  console.log("VERDICT: too close. The block itself is the problem — a bigger lock only defers it.");
  console.log("         Yielding inside the promoter's outer loops is the real fix.");
} else if (worst > 60_000) {
  console.log("VERDICT: comfortable for now, but past a 1-minute block. Worth re-checking as the graph grows.");
} else {
  console.log("VERDICT: tens of seconds — the 10-minute lock is ample and no yield work is needed.");
}
