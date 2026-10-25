/**
 * coherence-report — the GROUND run for #179's coherence floor.
 *
 * For every active/dormant event: its coherence score on the SAME code the
 * promoter gate and the dossier API use (eventCoherence.js over storyAffinity's
 * measure), then the distribution and the worst N. Use it to set
 * EVENT_COHERENCE_FLOOR before switching EVENT_COHERENCE_GATE on.
 *
 * Run it in the worker (any container with the scoop_data volume works):
 *
 *   cd /opt/scoopfeeds
 *   docker compose -f docker-compose.production.yml exec -T worker node scripts/coherence-report.mjs
 *
 * Or against a pulled copy:  SCOOP_DB_PATH=/path/to/copy.db node scripts/coherence-report.mjs
 * Optional arg: how many of the worst to list (default 20).
 *
 * READ-ONLY. Opens the database with readonly:true and runs SELECTs only.
 * No sampling: every active/dormant event with members is scored, and the
 * count of events scored null (too few keyed members) is printed, not hidden.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { buildAffinityCtx } from "../src/realityIndex/intelligence/storyAffinity.js";
import { eventCoherence, coherenceFloor } from "../src/realityIndex/intelligence/eventCoherence.js";

const worstN = Number.parseInt(process.argv[2] || "20", 10) || 20;
const dataDir = process.env.SCOOP_PERSISTENT_DATA_DIR || "/var/lib/scoop";
const dbPath = process.env.SCOOP_DB_PATH || path.join(dataDir, "news.db");
if (!existsSync(dbPath)) {
  console.error(`no database at ${dbPath} — set SCOOP_DB_PATH, or run inside a container with the scoop_data volume.`);
  process.exit(2);
}
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const ctx = buildAffinityCtx(db);
const events = db.prepare(`
  SELECT e.id, e.slug, e.title, e.status FROM events e
  WHERE e.status IN ('active','dormant') AND EXISTS (SELECT 1 FROM event_articles ea WHERE ea.event_id = e.id)
`).all();
const members = db.prepare("SELECT article_id FROM event_articles WHERE event_id = ?");

const rows = [];
for (const e of events) {
  const ids = members.all(e.id).map((r) => r.article_id);
  rows.push({ ...e, ...eventCoherence(ctx, db, ids) });
}

const scored = rows.filter((r) => r.score !== null).sort((a, b) => a.score - b.score);
const floor = coherenceFloor();
const pct = (q) => (scored.length ? scored[Math.min(scored.length - 1, Math.floor(q * scored.length))].score : null);
const bucket = new Map();
for (const r of scored) { const b = Math.min(9, Math.floor(r.score * 10)); bucket.set(b, (bucket.get(b) || 0) + 1); }

console.log(`db: ${dbPath}`);
console.log(`entity_idf keys: ${ctx.idfMap.size}${ctx.idfMap.size ? "" : "  (EMPTY — scores are unweighted)"}`);
console.log(`events with members: ${rows.length}   scored: ${scored.length}   unmeasured (null): ${rows.length - scored.length}`);
console.log(`floor in force (EVENT_COHERENCE_FLOOR): ${floor}   below it: ${scored.filter((r) => r.score < floor).length}`);
console.log(`p10 ${pct(0.1)}  p25 ${pct(0.25)}  p50 ${pct(0.5)}  p75 ${pct(0.75)}  p90 ${pct(0.9)}`);
console.log("\nscore bucket  events");
for (let b = 0; b < 10; b++) console.log(`  ${(b / 10).toFixed(1)}–${((b + 1) / 10).toFixed(1)}    ${bucket.get(b) || 0}`);
console.log(`\nworst ${Math.min(worstN, scored.length)} (score, members, keyed, core keys, status, slug — title):`);
for (const r of scored.slice(0, worstN)) {
  console.log(`  ${r.score.toFixed(3)}  ${String(r.members).padStart(4)}  ${String(r.measured).padStart(4)}  ${String(r.coreSize).padStart(3)}  ${r.status.padEnd(7)}  ${r.slug} — ${(r.title || "").slice(0, 70)}`);
}
