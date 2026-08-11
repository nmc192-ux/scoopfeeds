#!/usr/bin/env node
/**
 * pull-prod-db.mjs — pull a SUBSET of the production database to
 * backend/data/prod-live.db for local analysis.
 *
 * WHY A SUBSET: prod news.db is ~11.8 GB, but 91% of that is two tables that
 * no analysis touches — reality_index_snapshots (~6.9 GB incl. indexes) and
 * sentiment_snapshots (~3.8 GB). Measured against a real prod snapshot,
 * `articles` is only 18.8 MB and articles.content is 9.8 MB of it. So the
 * lever is NOT dropping heavy columns — it is simply not copying the two
 * snapshot tables. The tables below total ~20 MB on disk / ~5 MB gzipped for
 * a 30-day window, which is a practical transfer over a home connection.
 *
 * HOW: the subset is built ON THE VPS by reading the live DB READ-ONLY
 * (file:...?mode=ro) and writing into a fresh ATTACHed output file. This:
 *   - needs ~25 MB of remote scratch, not ~11 GB (no .backup of the whole file)
 *   - takes no write lock, so prod writers are never blocked (WAL MVCC read)
 *   - runs inside a single BEGIN/COMMIT so every table is the same snapshot
 *
 * ⚠️ THE REMOTE HALF IS UNTESTED. It was authored in an environment with no
 * SSH access to the VPS. --dry-run prints the exact remote script without
 * executing anything: RUN THAT FIRST and read it. Every failure path below
 * errors loudly with a specific cause; there are deliberately no silent
 * fallbacks (in particular we never fall back to ?immutable=1, which would
 * read a torn snapshot from under a live writer).
 *
 * USAGE
 *   node scripts/pull-prod-db.mjs --dry-run          # print remote script, do nothing
 *   node scripts/pull-prod-db.mjs                    # pull last 30 days
 *   node scripts/pull-prod-db.mjs --days 7 --force   # 7 days, overwrite existing
 *   node scripts/pull-prod-db.mjs --with-content     # include articles.content (+~10 MB)
 *
 * ENV (never hardcoded)
 *   PROD_SSH_HOST   required  — VPS hostname or IP
 *   PROD_SSH_USER   default root
 *   PROD_SSH_PORT   default 22
 *   PROD_DB_PATH    default /opt/scoopfeeds/data/news.db — VERIFY THIS with
 *                   --dry-run before the first real run; a wrong path fails
 *                   loudly rather than silently pulling nothing.
 */

import "../src/config/env.js";
import { existsSync, statSync, unlinkSync } from "fs";
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const DEST = path.join(BACKEND_ROOT, "data", "prod-live.db");

// ── CLI ───────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { days: 30, force: false, withContent: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") out.force = true;
    else if (a === "--with-content") out.withContent = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--days") {
      const n = Number.parseInt(argv[++i], 10);
      if (!Number.isFinite(n) || n <= 0) die(`--days needs a positive integer (got "${argv[i]}")`);
      out.days = n;
    } else if (a.startsWith("--days=")) {
      const n = Number.parseInt(a.slice(7), 10);
      if (!Number.isFinite(n) || n <= 0) die(`--days needs a positive integer (got "${a.slice(7)}")`);
      out.days = n;
    } else die(`unknown flag: ${a}\nSupported: --days N, --force, --with-content, --dry-run`);
  }
  return out;
}

function die(msg, code = 1) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(code);
}

// ── Subset definition ─────────────────────────────────────────────────────
// Every table an analysis has actually needed. Anything not listed is NOT
// copied — that omission is what keeps the pull small.
//
//   where: SQL predicate using :cutoff (ms epoch). null = copy whole table
//          (only for tables that are small and unbounded by nature).
const ARTICLE_COLS_BASE = [
  "id", "title", "description", "url", "image_url", "source_name", "category",
  "region", "author", "published_at", "fetched_at", "credibility", "is_featured",
  "view_count", "tags", "language", "is_duplicate", "ig_summary",
];

function tableSpecs({ withContent }) {
  const articleCols = withContent
    ? [...ARTICLE_COLS_BASE.slice(0, 3), "content", ...ARTICLE_COLS_BASE.slice(3)]
    : ARTICLE_COLS_BASE;
  return [
    // articles.content excluded by default: 9.8 MB of a ~20 MB subset, and no
    // analysis reads it. --with-content opts back in.
    { name: "articles", cols: articleCols, where: "published_at >= :cutoff" },
    // events is NOT retention-pruned, so the date bound genuinely bites here
    // (36,176 rows unbounded → ~8,200 at 30 days on the measured snapshot).
    { name: "events", cols: null, where: "last_activity_at >= :cutoff" },
    { name: "event_articles", cols: null, where: "added_at >= :cutoff" },
    { name: "event_timeline", cols: null, where: "ts >= :cutoff" },
    // No timestamp column; scoped by the events that survive the bound.
    { name: "event_actors", cols: null, where: "event_id IN (SELECT id FROM main.events WHERE last_activity_at >= :cutoff)" },
    { name: "social_posts", cols: null, where: "posted_at >= :cutoff" },
    { name: "pushed_articles", cols: null, where: "pushed_at >= :cutoff" },
    { name: "push_subscriptions", cols: null, where: null },
    // First-class: the primary evidence for ingestion continuity (per-source
    // fetch success/error/duration). 44 MB unbounded, so it MUST be bounded.
    { name: "ingestion_logs", cols: null, where: "fetched_at >= :cutoff" },
    // The per-source counters ingestion_logs is the history for. One row per
    // source (162 on prod), so it is never worth bounding — and without it a
    // snapshot cannot answer "which sources are failing", which is what
    // `npm run source:triage -- --db <snapshot>` exists to do.
    { name: "source_health", cols: null, where: null },
    { name: "sources", cols: null, where: null },
    // May not exist yet on prod (ships with the heartbeat branch) — the remote
    // script skips absent tables rather than aborting the transaction.
    { name: "system_heartbeats", cols: null, where: null },
  ];
}

// ── Remote script ─────────────────────────────────────────────────────────
// Emitted as a self-contained bash script piped to `ssh ... bash -s`, which
// avoids nested-quoting hazards entirely. --dry-run prints this verbatim.
function buildRemoteScript({ dbPath, cutoff, specs }) {
  const perTable = specs.map((s) => {
    const select = s.cols ? s.cols.join(",") : "*";
    const where = s.where ? ` WHERE ${s.where.replace(/:cutoff/g, String(cutoff))}` : "";
    return `add_table "${s.name}" "SELECT ${select} FROM main.${s.name}${where}"`;
  }).join("\n");

  return `set -euo pipefail

DB=${shq(dbPath)}
OUT="/tmp/scoop-subset-$$.db"
GZ="\${OUT}.gz"

# Any failure removes partial prod data from the box. The .gz is deliberately
# NOT trapped: it must survive for scp. The local orchestrator always issues a
# final remote rm, including on failure.
cleanup_partial() { rm -f "$OUT"; }
trap cleanup_partial EXIT

command -v sqlite3 >/dev/null 2>&1 || { echo "PULL_ERR|no_sqlite3|sqlite3 is not installed on the VPS (apt-get install -y sqlite3)" >&2; exit 4; }
[ -f "$DB" ] || { echo "PULL_ERR|db_missing|prod DB not found at $DB — set PROD_DB_PATH to the real path" >&2; exit 3; }
[ -r "$DB" ] || { echo "PULL_ERR|db_unreadable|cannot read $DB as this SSH user" >&2; exit 3; }

# A read-only connection to a WAL database still needs to read -wal and
# create/read -shm, which requires write permission on the DB *directory*.
# We do NOT fall back to ?immutable=1: that ignores the WAL and can read a
# torn snapshot from under a live writer. Fail loudly instead.
DBDIR="$(dirname "$DB")"
[ -w "$DBDIR" ] || { echo "PULL_ERR|dir_not_writable|$DBDIR is not writable by this user; SQLite cannot create the -shm file needed to read a live WAL database read-only. Run as a user with write access to the directory (the DB file itself is never modified). Refusing ?immutable=1 fallback — it can read a torn snapshot." >&2; exit 5; }

rm -f "$OUT" "$GZ"

SQL="ATTACH '$OUT' AS out;
BEGIN;
"
add_table() {
  local t="$1" q="$2"
  local exists
  exists="$(sqlite3 "file:\${DB}?mode=ro" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='\$t' LIMIT 1;" 2>/dev/null || true)"
  if [ "\$exists" = "1" ]; then
    SQL="\${SQL}CREATE TABLE out.\${t} AS \${q};
"
  else
    echo "PULL_SKIP|\${t}|table not present on prod — skipped" >&2
  fi
}

${perTable}

SQL="\${SQL}COMMIT;
"

# Single transaction = one consistent snapshot across every table.
if ! printf '%s' "$SQL" | sqlite3 "file:\${DB}?mode=ro" 2>/tmp/scoop-subset-err.$$; then
  echo "PULL_ERR|subset_failed|sqlite3 failed building the subset. sqlite stderr follows:" >&2
  cat /tmp/scoop-subset-err.$$ >&2 || true
  rm -f /tmp/scoop-subset-err.$$
  exit 6
fi
rm -f /tmp/scoop-subset-err.$$

[ -s "$OUT" ] || { echo "PULL_ERR|empty_subset|subset file is empty — check PROD_DB_PATH points at the live DB" >&2; exit 7; }

gzip -9 "$OUT" || { echo "PULL_ERR|gzip_failed|gzip failed on $OUT" >&2; exit 8; }
trap - EXIT   # $OUT is gone (gzip replaced it); $GZ must survive for scp

echo "PULL_OK|\${GZ}|$(stat -c %s "$GZ" 2>/dev/null || stat -f %z "$GZ")"
`;
}

// POSIX single-quote escaping for values interpolated into the remote script.
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// ── Main ──────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));

const host = process.env.PROD_SSH_HOST;
const user = process.env.PROD_SSH_USER || "root";
const port = process.env.PROD_SSH_PORT || "22";
const dbPath = process.env.PROD_DB_PATH || "/opt/scoopfeeds/data/news.db";

const missing = [];
if (!host) missing.push("PROD_SSH_HOST  (VPS hostname or IP — required)");
if (missing.length) {
  die(
    `Missing required environment:\n  ${missing.join("\n  ")}\n\n` +
    `Optional (defaults shown):\n` +
    `  PROD_SSH_USER=${user}\n  PROD_SSH_PORT=${port}\n  PROD_DB_PATH=${dbPath}\n\n` +
    `Set them in your shell or ~/.scoopfeeds.env, then re-run with --dry-run first.`
  );
}

const cutoff = Date.now() - args.days * 24 * 60 * 60 * 1000;
const specs = tableSpecs({ withContent: args.withContent });
const remoteScript = buildRemoteScript({ dbPath, cutoff, specs });

if (args.dryRun) {
  console.log(`\n=== DRY RUN — nothing executed ===\n`);
  console.log(`Would connect:  ssh -p ${port} ${user}@${host} bash -s`);
  console.log(`Remote DB:      ${dbPath}`);
  console.log(`Window:         last ${args.days} days (cutoff ${new Date(cutoff).toISOString()})`);
  console.log(`articles.content: ${args.withContent ? "INCLUDED" : "excluded"}`);
  console.log(`Destination:    ${DEST}${existsSync(DEST) ? "  ⚠️ EXISTS (needs --force)" : ""}`);
  console.log(`\n--- remote script (piped to \`bash -s\`) ---\n`);
  console.log(remoteScript);
  console.log(`--- end remote script ---\n`);
  console.log(`Then: scp -P ${port} ${user}@${host}:<GZ> <tmp> && gunzip → ${DEST}`);
  console.log(`Then: ssh ... rm -f <GZ>   (always attempted, including on failure)\n`);
  process.exit(0);
}

if (existsSync(DEST) && !args.force) {
  die(
    `${DEST} already exists (${(statSync(DEST).size / 1048576).toFixed(1)} MB, modified ${statSync(DEST).mtime.toISOString()}).\n` +
    `Refusing to overwrite. Re-run with --force if you want to replace it.`
  );
}

// BatchMode=yes: never prompt for a password. Without it a failed key auth
// blocks forever on a prompt nothing can answer in a non-interactive run.
// ConnectTimeout: a wrong PROD_SSH_HOST fails in seconds, not minutes.
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];
const sshBase = [...SSH_OPTS, "-p", String(port), `${user}@${host}`];
let remoteGz = null;

function remoteCleanup() {
  if (!remoteGz) return;
  try {
    execFileSync("ssh", [...sshBase, "rm", "-f", remoteGz], { stdio: "pipe", timeout: 30_000 });
    console.log(`🧹 removed remote temp file ${remoteGz}`);
  } catch (e) {
    console.error(
      `\n⚠️  COULD NOT REMOVE REMOTE TEMP FILE ${remoteGz}\n` +
      `   Prod data may be left on the VPS. Remove it manually:\n` +
      `   ssh -p ${port} ${user}@${host} rm -f ${remoteGz}\n` +
      `   (cause: ${e.message})\n`
    );
  }
}

// Always attempt remote cleanup, whatever happens after the subset is built.
process.on("exit", remoteCleanup);
process.on("SIGINT", () => process.exit(130));

const tmpGz = path.join(BACKEND_ROOT, "data", `.prod-live.pull.${process.pid}.db.gz`);

try {
  // ── Step 1: build the subset remotely ─────────────────────────────────
  console.log(`⏳ building subset on ${user}@${host} (${args.days}-day window)…`);
  let stdout;
  try {
    stdout = execFileSync("ssh", [...sshBase, "bash", "-s"], {
      input: remoteScript,
      encoding: "utf8",
      timeout: 10 * 60 * 1000,
      stdio: ["pipe", "pipe", "inherit"], // remote stderr (PULL_ERR/PULL_SKIP) streams through
    });
  } catch (e) {
    die(
      `STEP 1 FAILED (build subset on VPS).\n` +
      `The remote script exited ${e.status ?? "?"}. Its stderr is above — look for a PULL_ERR| line.\n` +
      `Common causes: wrong PROD_DB_PATH, sqlite3 not installed, SSH auth, or a non-writable DB directory.\n` +
      `Re-run with --dry-run to inspect the exact script.`
    );
  }

  const ok = String(stdout).split("\n").find((l) => l.startsWith("PULL_OK|"));
  if (!ok) {
    die(`STEP 1 FAILED: remote script produced no PULL_OK marker.\nRaw stdout:\n${stdout}`);
  }
  const [, gzPath, gzSize] = ok.trim().split("|");
  remoteGz = gzPath;
  console.log(`✅ subset built: ${gzPath} (${(Number(gzSize) / 1048576).toFixed(1)} MB gzipped)`);

  // ── Step 2: transfer ──────────────────────────────────────────────────
  console.log(`⏳ transferring…`);
  if (existsSync(tmpGz)) unlinkSync(tmpGz);
  try {
    execFileSync("scp", [...SSH_OPTS, "-P", String(port), `${user}@${host}:${gzPath}`, tmpGz], {
      stdio: "inherit",
      timeout: 30 * 60 * 1000,
    });
  } catch (e) {
    die(`STEP 2 FAILED (scp transfer). The remote temp file will still be cleaned up.\nCause: ${e.message}`);
  }
  if (!existsSync(tmpGz) || statSync(tmpGz).size === 0) {
    die(`STEP 2 FAILED: transferred file is missing or empty at ${tmpGz}`);
  }

  // ── Step 3: unpack ────────────────────────────────────────────────────
  console.log(`⏳ unpacking…`);
  if (existsSync(DEST)) unlinkSync(DEST);
  // gunzip to an explicit destination without relying on suffix rules.
  try {
    execFileSync("/bin/sh", ["-c", `gunzip -c ${shq(tmpGz)} > ${shq(DEST)}`], { stdio: "inherit" });
  } catch (e) {
    die(`STEP 3 FAILED (gunzip). Cause: ${e.message}`);
  }
  unlinkSync(tmpGz);
} finally {
  // remoteCleanup also runs on 'exit'; calling here makes the ordering explicit
  // for the success path so the "removed remote temp file" line reads in order.
  remoteCleanup();
  remoteGz = null;
}

// ── Step 4: VERIFY freshness — never assume ───────────────────────────────
// Every compromised analysis this week came from trusting a snapshot's age.
const { default: Database } = await import("better-sqlite3");
const db = new Database(DEST, { readonly: true });

const tableNames = specs.map((s) => s.name);
console.log(`\n📦 ${DEST}  (${(statSync(DEST).size / 1048576).toFixed(1)} MB)\n`);
console.log(`   table                    rows`);
console.log(`   ─────────────────────────────`);
for (const t of tableNames) {
  let n;
  try { n = db.prepare(`SELECT count(*) c FROM ${t}`).get().c; }
  catch { n = "— (absent)"; }
  console.log(`   ${t.padEnd(22)} ${String(n).padStart(8)}`);
}

const q = (sql) => { try { return db.prepare(sql).get().v; } catch { return null; } };
const maxPub = q(`SELECT max(published_at) v FROM articles`);
const maxFet = q(`SELECT max(fetched_at) v FROM articles`);
const igPosted = q(`SELECT count(*) v FROM social_posts WHERE platform='instagram' AND status='posted'`);
const socialTotal = q(`SELECT count(*) v FROM social_posts`);
db.close();

const iso = (ms) => (ms ? new Date(ms).toISOString() : "—");
const ageH = maxFet ? (Date.now() - maxFet) / 3600000 : null;

console.log(`\n   FRESHNESS`);
console.log(`   max(published_at)  ${iso(maxPub)}`);
console.log(`   max(fetched_at)    ${iso(maxFet)}${ageH != null ? `  (${ageH.toFixed(1)}h old)` : ""}`);
console.log(`   social_posts       ${socialTotal ?? 0} total, ${igPosted ?? 0} instagram/posted`);

if (ageH == null) {
  console.log(`\n⚠️  Could not determine freshness — articles table is empty or absent.\n`);
} else if (ageH > 6) {
  console.log(
    `\n⚠️  STALE: newest ingested article is ${ageH.toFixed(1)}h old (>6h).\n` +
    `   Ingestion may be wedged on prod, or PROD_DB_PATH points at an old copy.\n` +
    `   Do NOT treat this pull as current without checking why.\n`
  );
} else {
  console.log(`\n✅ Fresh (newest ingest ${ageH.toFixed(1)}h old). Safe to analyse.\n`);
}
