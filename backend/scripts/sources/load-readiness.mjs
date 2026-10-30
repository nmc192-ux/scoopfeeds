#!/usr/bin/env node
/**
 * load-readiness.mjs — Source step 2 readiness readout (#292). READ-ONLY.
 *
 *   node scripts/sources/load-readiness.mjs --db <a COPY of news.db> [--days 7]
 *
 * Prints JSON: events.promote and reality-index.compose run stats from
 * background_job_runs over the window, eligible clusters right now (the
 * promoter's step-1 predicate, counted without its LIMIT), active events, active
 * RSS sources, and a READY / NOT READY / UNVERIFIED verdict with the thresholds
 * it used (src/services/sourceLoadReadiness.js).
 *
 * The DB is opened { readonly: true, fileMustExist: true }. This script never
 * writes. Point it at a COPY (online backup), not the live file.
 */
import { pathToFileURL } from "node:url";
import {
  summariseRuns, readinessVerdict, PROMOTER_RUNS_PER_DAY, PROMOTER_ELIGIBLE_CAP,
} from "../../src/services/sourceLoadReadiness.js";

export { readinessVerdict, summariseRuns };

const PROMOTE_JOB = "events.promote";
const COMPOSE_JOB = "reality-index.compose";

/**
 * DUPLICATED, NOT IMPORTED, from eventPromoter.js step 1 ("Eligible clusters",
 * the `const eligible = db.prepare(...)` query) and marketsDao.js
 * eligibleMarketSql(). Importing either pulls in models/database.js, which opens
 * the app's own DB path. Keep in step with those two if they change.
 * Same predicate; COUNT(*) instead of SELECT … LIMIT 300.
 */
function eligibleMarketSql(alias, nowMs) {
  const t = Math.floor(Number(nowMs));
  return `(${alias}.active = 1 AND COALESCE(${alias}.resolved, 0) = 0 AND ${alias}.end_date IS NOT NULL AND ${alias}.end_date > ${t})`;
}
export function eligibleClusterCountSql(nowMs = Date.now()) {
  return `
    SELECT COUNT(*) AS n
    FROM story_clusters sc
    WHERE sc.article_count >= ?
       OR (SELECT COUNT(*) FROM cluster_market_links cml JOIN prediction_markets pm ON pm.id = cml.market_id
              WHERE cml.cluster_id = sc.id AND ${eligibleMarketSql("pm", nowMs)}) >= 1`;
}

function opt(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

async function main() {
  const dbPath = opt("db");
  if (!dbPath) { console.error("usage: load-readiness.mjs --db <COPY of news.db> [--days 7]"); process.exit(1); }
  const days = Number(opt("days", "7"));
  if (!Number.isFinite(days) || days <= 0) { console.error("--days must be a positive number"); process.exit(1); }

  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const now = Date.now();
  const since = now - days * 86_400_000;

  let promoter = null, compose = null;
  if (tableExists(db, "background_job_runs")) {
    const q = db.prepare("SELECT status, duration_ms FROM background_job_runs WHERE job_name = ? AND created_at >= ?");
    promoter = summariseRuns(q.all(PROMOTE_JOB, since), { expected: Math.round(PROMOTER_RUNS_PER_DAY * days) });
    compose = summariseRuns(q.all(COMPOSE_JOB, since));
  }

  let eligibleNow = null, eligibleError = null;
  try {
    const minArticles = parseInt(process.env.EVENT_MIN_ARTICLES || "5", 10);
    eligibleNow = db.prepare(eligibleClusterCountSql(now)).get(minArticles).n;
  } catch (err) { eligibleError = err.message; }

  let activeEvents = null;
  try { activeEvents = db.prepare("SELECT COUNT(*) AS n FROM events WHERE status='active'").get().n; }
  catch { /* reported as null */ }

  let activeRssSources = null;
  try {
    const { RSS_SOURCES } = await import("../../src/config/sources.js");
    activeRssSources = RSS_SOURCES.length;
  } catch { /* reported as null */ }

  const verdict = readinessVerdict({ promoter, eligibleNow });
  console.log(JSON.stringify({
    measuredAt: new Date(now).toISOString(),
    db: dbPath,
    windowDays: days,
    [PROMOTE_JOB]: promoter,
    [COMPOSE_JOB]: compose,
    eligibleClustersNow: eligibleNow,
    eligibleAtOrOverCap: eligibleNow == null ? null : eligibleNow >= PROMOTER_ELIGIBLE_CAP,
    ...(eligibleError ? { eligibleError } : {}),
    activeEvents,
    activeRssSources,
    ...verdict,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
