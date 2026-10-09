/**
 * reembed — re-embed the live corpus on the CURRENT embedding model, in
 * rate-capped batches, resumable from a checkpoint.
 *
 * NO CUTOVER IS NEEDED TODAY. Embeddings stay on gemini-embedding-001 (768-dim),
 * so the vectors already in the index are the current model's and nothing has to
 * be rebuilt. This script is kept as a TOOL for the day the embedding model (or
 * EMBED_PROVIDER) changes, and as a gap-filler: without --clear it only embeds
 * targets that have no vector from the current model, which is a backfill of
 * whatever the live embedder missed (e.g. after an outage like the 2026-10-07
 * embedder stall) — safe to run at any time.
 *
 * WHY IT EXISTS. Vectors from different models live in different spaces: a
 * cosine between an old and a new vector is noise, and the pipeline compares
 * stored vectors with each other (clustering, event matching/merging, market
 * shortlist). If the model ever changes, the two must never coexist in one index.
 *
 * HOW MIXING IS PREVENTED (both layers):
 *   1. CLEAR-FIRST  — on a model change, `--clear --yes` deletes EVERY stored
 *      vector once, then this script refills the corpus that matters. After it,
 *      the index holds a single model.
 *   2. MODEL FILTER — embedding_meta.model records the writer; searchNearest()
 *      takes a `model` filter and marketMatcher passes the current one, so a
 *      straggler writing another model cannot pollute results.
 *      `countEmbeddingsByModel()` (also on /scoop-ops/ri-ops/dashboard as
 *      embeddings_by_model) shows whether the index is mixed.
 *
 * TARGETS (in this order):
 *   1. articles that belong to ACTIVE / DORMANT events (event centroids are
 *      computed from their member articles' stored vectors, whatever their age)
 *   2. non-duplicate articles from the last --days (default 7)
 *   3. active prediction markets
 * Texts are built EXACTLY as production builds them ("title. description" for
 * articles — rssFetcher; marketEmbeddingText for markets).
 *
 * RESUMABLE. The database is the source of truth: a row already stored by the
 * current model is skipped, so re-running just continues. A small checkpoint
 * file (default $SCOOP_PERSISTENT_DATA_DIR/reembed.checkpoint.json) records
 * progress for humans and guards `--clear` from running twice.
 *
 * USAGE
 *   node scripts/reembed.mjs                    # plan only (counts, nothing written)  == --dry
 *   node scripts/reembed.mjs --run              # embed whatever is missing for the current model
 *   node scripts/reembed.mjs --clear --yes --run   # ONLY on a model change: wipe, then refill
 *   node scripts/reembed.mjs --status           # vectors per scope/model + checkpoint
 *   options: --days 7  --rate 8 (embeds/second cap)  --batch 100  --checkpoint PATH
 *            --force-clear (allow a second --clear)
 *
 * Run it where the embedding lane is reachable (GEMINI_API_KEY) and the scoop_data
 * volume is mounted, e.g.:
 *   docker compose -f docker-compose.production.yml exec -T worker \
 *     node scripts/reembed.mjs --run     # (backfill; add --clear --yes only on a model change)
 * Stop the writers' embed work first or accept that new articles embed on the
 * same model in parallel (harmless: same model, upsert by (scope, scope_id)).
 */

import "../src/config/env.js";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/models/database.js";
import { initRealityIndex, isVecAvailable } from "../src/realityIndex/schema.js";
import { embedDocument, embeddingsConfig } from "../src/realityIndex/embeddings/embeddingService.js";
import { countEmbeddingsByModel, clearAllEmbeddings } from "../src/realityIndex/dal/embeddingsDao.js";
import { marketEmbeddingText } from "../src/realityIndex/intelligence/marketMatcher.js";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const DAYS = Math.max(1, Number.parseInt(opt("days", "7"), 10) || 7);
const RATE = Math.max(0.5, Number.parseFloat(opt("rate", "8")) || 8);          // embeds per second
const BATCH = Math.max(1, Number.parseInt(opt("batch", "100"), 10) || 100);
const RUN = flag("run");
const CLEAR = flag("clear");
const YES = flag("yes");
const STATUS = flag("status");
const FORCE_CLEAR = flag("force-clear");
const CONSECUTIVE_FAIL_LIMIT = 25;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = getDb();
initRealityIndex(db);
const cfg = embeddingsConfig();
const dataDir = process.env.SCOOP_PERSISTENT_DATA_DIR || ".";
const CHECKPOINT = opt("checkpoint", path.join(dataDir, "reembed.checkpoint.json"));

function readCheckpoint() { try { return JSON.parse(fs.readFileSync(CHECKPOINT, "utf8")); } catch { return null; } }
function writeCheckpoint(cp) {
  try { fs.writeFileSync(CHECKPOINT, JSON.stringify({ ...cp, updatedAt: new Date().toISOString() }, null, 2)); }
  catch (e) { console.error(`(could not write checkpoint ${CHECKPOINT}: ${e.message})`); }
}

console.log("─".repeat(78));
console.log(`reembed · lane ${cfg.provider} · ${cfg.model} · ${cfg.dims}d · vec available: ${cfg.available}`);
console.log(`db ${db.name} · checkpoint ${CHECKPOINT}`);
if (!isVecAvailable()) { console.error("sqlite-vec is not available — nothing can be stored. Aborting."); process.exit(1); }

const byModel = countEmbeddingsByModel();
console.log("\nstored vectors now (scope · model · n):");
for (const r of byModel) console.log(`  ${r.scope.padEnd(8)} ${String(r.model).padEnd(28)} ${r.n}`);
if (!byModel.length) console.log("  (none)");
const foreign = byModel.filter((r) => r.model !== cfg.model);
if (foreign.length) console.log(`\n⚠️  ${foreign.reduce((a, r) => a + r.n, 0)} vector(s) were written by a model other than ${cfg.model}. They must not mix with new ones: use --clear --yes.`);
if (STATUS) { console.log("\ncheckpoint:", JSON.stringify(readCheckpoint(), null, 2)); process.exit(0); }

// ── targets ────────────────────────────────────────────────────────────────
const cutoff = Date.now() - DAYS * 86_400_000;
const eventArticles = db.prepare(`
  SELECT DISTINCT a.id, a.title, a.description
  FROM events e
  JOIN event_articles ea ON ea.event_id = e.id
  JOIN articles a ON a.id = ea.article_id
  WHERE e.status IN ('active','dormant') AND a.is_duplicate = 0
`).all();
const recentArticles = db.prepare(`
  SELECT id, title, description FROM articles
  WHERE published_at > ? AND is_duplicate = 0 ORDER BY published_at DESC
`).all(cutoff);
const markets = db.prepare(`
  SELECT id, question, description, tags, category FROM prediction_markets
  WHERE active = 1 AND question IS NOT NULL AND length(question) > 5
  ORDER BY (CASE WHEN volume_24h IS NULL THEN 0 ELSE volume_24h END) DESC
`).all();

const articleText = (a) => ((a.title || "") + ". " + (a.description || "")).trim() || (a.title || "");
const seen = new Set();
const jobs = [];
for (const a of eventArticles) { if (!seen.has(a.id)) { seen.add(a.id); jobs.push({ scope: "article", id: a.id, text: articleText(a), phase: "event-articles" }); } }
for (const a of recentArticles) { if (!seen.has(a.id)) { seen.add(a.id); jobs.push({ scope: "article", id: a.id, text: articleText(a), phase: "recent-articles" }); } }
for (const m of markets) jobs.push({ scope: "market", id: m.id, text: marketEmbeddingText(m), phase: "markets" });

const doneSet = new Set(
  db.prepare(`SELECT scope || '|' || scope_id AS k FROM embedding_meta WHERE model = ?`).all(cfg.model).map((r) => r.k)
);
const todo = jobs.filter((j) => j.text && !doneSet.has(`${j.scope}|${j.id}`));

console.log(`\nplan: event-linked articles ${eventArticles.length} · articles in last ${DAYS}d ${recentArticles.length} · active markets ${markets.length}`);
console.log(`      distinct targets ${jobs.length} · already on ${cfg.model} ${jobs.length - todo.length} · to embed ${todo.length}`);
console.log(`      ~${Math.ceil(todo.length / RATE / 60)} min at ${RATE}/s (batch ${BATCH})`);

if (CLEAR && !YES) { console.error("\n--clear is destructive (deletes every stored vector). Re-run with --clear --yes."); process.exit(2); }
if (!RUN && !CLEAR) { console.log("\nplan only — nothing written. Add --run to backfill what is missing (add --clear --yes only after a model change)."); process.exit(0); }

// ── preflight: the lane must work before anything is deleted ───────────────
const probe = await embedDocument({ scope: "reembed-probe", scope_id: "probe", text: "reembed preflight" });
if (!probe) {
  console.error(`\npreflight FAILED: the embedding lane (${cfg.provider}) returned nothing. Is the embedding lane up (GEMINI_API_KEY / EMBED_PROVIDER)? Nothing was deleted.`);
  process.exit(3);
}
db.prepare("DELETE FROM embedding_meta WHERE scope = 'reembed-probe'").run();
// vec0 row for the probe: remove by rowid we just created
try { db.prepare("DELETE FROM embeddings WHERE rowid = ?").run(probe); } catch { /* best-effort */ }

let cp = readCheckpoint() || {};
if (CLEAR) {
  if (cp.clearedForModel === cfg.model && !FORCE_CLEAR) {
    console.error(`\nA clear was already done for ${cfg.model} at ${cp.clearedAt}. Not clearing again (that would discard the refill). Use --force-clear to override.`);
    process.exit(4);
  }
  const removed = clearAllEmbeddings();
  cp = { ...cp, clearedForModel: cfg.model, clearedAt: new Date().toISOString(), removedVectors: removed };
  writeCheckpoint(cp);
  console.log(`\n🧹 cleared ${removed} vector(s). The index is empty; refilling on ${cfg.model}.`);
  doneSet.clear();
}
const work = jobs.filter((j) => j.text && !doneSet.has(`${j.scope}|${j.id}`));

// ── run, rate-capped, batch by batch ───────────────────────────────────────
const t0 = Date.now();
let ok = 0, failed = 0, consecutive = 0, aborted = false;
const perPhase = {};
const gap = 1000 / RATE;

for (let off = 0; off < work.length && !aborted; off += BATCH) {
  const slice = work.slice(off, off + BATCH);
  for (const j of slice) {
    const started = Date.now();
    let vec = null;
    try { vec = await embedDocument({ scope: j.scope, scope_id: j.id, text: j.text }); } catch { vec = null; }
    perPhase[j.phase] ||= { ok: 0, failed: 0 };
    if (vec) { ok++; consecutive = 0; perPhase[j.phase].ok++; }
    else {
      failed++; consecutive++; perPhase[j.phase].failed++;
      if (consecutive >= CONSECUTIVE_FAIL_LIMIT) { aborted = true; break; }
    }
    const spent = Date.now() - started;
    if (spent < gap) await sleep(gap - spent);
  }
  const elapsed = (Date.now() - t0) / 1000;
  writeCheckpoint({ ...cp, model: cfg.model, phase: slice.at(-1)?.phase, embedded: ok, failed, remaining: work.length - ok - failed, aborted, elapsedSec: Math.round(elapsed), perPhase });
  console.log(`  ${Math.min(off + BATCH, work.length)}/${work.length} · ok ${ok} · failed ${failed} · ${elapsed.toFixed(0)}s · ${(ok / Math.max(1, elapsed)).toFixed(1)}/s`);
}

console.log("\n" + "─".repeat(78));
if (aborted) console.log(`⏸  stopped after ${CONSECUTIVE_FAIL_LIMIT} consecutive failures (lane down?). Fix it and re-run --run: finished rows are skipped.`);
console.log(`embedded ${ok}, failed ${failed}, in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log("stored vectors now (scope · model · n):");
for (const r of countEmbeddingsByModel()) console.log(`  ${r.scope.padEnd(8)} ${String(r.model).padEnd(28)} ${r.n}`);
process.exit(aborted ? 5 : 0);
