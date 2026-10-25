/**
 * reader-eligibility-report — #243. Which stored events are hidden from readers, and why.
 *
 * For every active/dormant event with members: the SAME rules every reader list applies
 * (src/realityIndex/dal/readerEligibility.js) — at least 3 named outlets, no outlet above
 * 70% of the articles, and a #179 coherence score not below its floor. Lists every
 * ineligible event with its reasons, so DrJ can decide on repair or deletion later
 * (both are stop-list item 1; this script decides nothing and changes nothing).
 *
 * Run it in the worker (any container with the scoop_data volume works):
 *
 *   cd /opt/scoopfeeds
 *   docker compose -f docker-compose.production.yml exec -T worker node scripts/reader-eligibility-report.mjs
 *
 * Or against a pulled copy:  SCOOP_DB_PATH=/path/to/copy.db node scripts/reader-eligibility-report.mjs
 * Optional arg: how many ineligible events to list (default: all of them).
 *
 * READ-ONLY. Opens the database with readonly:true and runs SELECTs only. No sampling:
 * every active/dormant event with members is evaluated, and events whose coherence could
 * not be measured (too few entity-keyed members) are counted and printed, not hidden.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

process.env.EVENT_READER_ELIGIBILITY = "true"; // report what the rules WOULD hide, whatever the flag says
const { eventReaderEligibility } = await import("../src/realityIndex/dal/readerEligibility.js");

const listN = Number.parseInt(process.argv[2] || "0", 10) || Infinity;
const dataDir = process.env.SCOOP_PERSISTENT_DATA_DIR || "/var/lib/scoop";
const dbPath = process.env.SCOOP_DB_PATH || path.join(dataDir, "news.db");
if (!existsSync(dbPath)) {
  console.error(`no database at ${dbPath} — set SCOOP_DB_PATH, or run inside a container with the scoop_data volume.`);
  process.exit(2);
}
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const events = db.prepare(`
  SELECT e.id, e.slug, e.title, e.status, e.last_activity_at FROM events e
  WHERE e.status IN ('active','dormant') AND EXISTS (SELECT 1 FROM event_articles ea WHERE ea.event_id = e.id)
  ORDER BY e.last_activity_at DESC
`).all();

const rows = events.map((e) => ({ ...e, ...eventReaderEligibility(db, e.id, { useCache: false }) }));
const bad = rows.filter((r) => !r.eligible);
const byReason = new Map();
for (const r of bad) for (const why of r.reasons) byReason.set(why, (byReason.get(why) || 0) + 1);
const unmeasured = rows.filter((r) => !r.machine && r.coherence === null).length;

console.log(`db: ${dbPath}`);
console.log(`events with members: ${rows.length}   eligible: ${rows.length - bad.length}   HIDDEN: ${bad.length}`);
console.log(`coherence unmeasured (null — not hidden on that rule): ${unmeasured}`);
console.log(`reasons (an event can have several): ${[...byReason].map(([k, v]) => `${k}=${v}`).join("  ") || "none"}`);
console.log(`\nhidden events, most recently active first (reasons | outlets | top outlet share | coherence | members | status | slug — title):`);
for (const r of bad.slice(0, listN)) {
  const share = r.topShare === null ? "  -  " : `${Math.round(r.topShare * 100)}%`.padStart(5);
  const coh = r.coherence === null ? " null" : r.coherence.toFixed(3);
  console.log(`  ${r.reasons.join("+").padEnd(42)} ${String(r.sources).padStart(3)}  ${share} ${r.topSource ? `(${String(r.topSource).slice(0, 24)})` : ""}  ${coh}  ${String(r.members).padStart(4)}  ${r.status.padEnd(7)}  ${r.slug} — ${(r.title || "").slice(0, 70)}`);
}
if (bad.length > listN) console.log(`  … ${bad.length - listN} more (pass a larger count, or none for all)`);
