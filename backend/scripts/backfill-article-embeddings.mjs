/**
 * backfill-article-embeddings.mjs — populate per-article vectors for semantic clustering
 * (Sprint 1). Reuses embedDocument({scope:'article', scope_id, text}) — idempotent upsert
 * keyed by (scope, scope_id), so the DB itself is the checkpoint: re-running recomputes the
 * missing set and skips done ones. Resumable across laptop-sleep sessions with NO state file.
 *
 * Target = non-duplicate articles with no article-vector. Embed text = "title. description"
 * (title-only fallback). Concurrency is bounded by the global EMBED_CONCURRENCY cap (4) — we
 * do NOT burst (the Cloudflare free tier was burned by un-throttled bursts before).
 *
 * On a persistent rate-limit / neuron-cap (a run of failures), it logs and exits 0 cleanly
 * (graceful pause, not a crash) — re-run to resume. Per-article failures are logged + skipped
 * (they stay in the set for the next run).
 *
 * Usage:  node scripts/backfill-article-embeddings.mjs [--limit N]
 *   --limit N  embed only the first N missing (newest first) — for smoke-testing.
 * Honors SCOOP_PERSISTENT_DATA_DIR (set it explicitly for dev/working-copy runs).
 */
import "../src/config/env.js"; // load .env → process.env (EMBED_PROVIDER + Cloudflare creds)
import { getDb } from "../src/models/database.js";
import { initRealityIndex, isVecAvailable } from "../src/realityIndex/schema.js";
import { embedDocument, embeddingsConfig } from "../src/realityIndex/embeddings/embeddingService.js";
import { countEmbeddings } from "../src/realityIndex/dal/embeddingsDao.js";
import { logger } from "../src/services/logger.js";

const BATCH = 250;
const CONC = 4;                 // matches the global EMBED_CONCURRENCY cap; do not burst
const CAP_FAILS = 20;           // consecutive failures ⇒ assume rate-limit/cap ⇒ graceful pause
const RETRY_BACKOFF_MS = [400, 1200];

const limArg = process.argv.indexOf("--limit");
const LIMIT = limArg >= 0 ? Math.max(0, parseInt(process.argv[limArg + 1], 10) || 0) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = getDb();
initRealityIndex(db); // loads sqlite-vec (server.js does this at boot; required for persistence)
const cfg = embeddingsConfig();
const dbPath = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? process.env.SCOOP_PERSISTENT_DATA_DIR + "/news.db" : "data/news.db (default)";
console.log(`📍 DB: ${dbPath}`);
console.log(`🧮 embedding lane: ${cfg.provider} · ${cfg.model} · ${cfg.dims}d · vec available: ${cfg.available}`);
if (!isVecAvailable()) { console.error("❌ sqlite-vec not available — cannot persist embeddings. Aborting."); process.exit(1); }

const MISSING_IDS_SQL =
  "SELECT a.id FROM articles a " +
  "LEFT JOIN embedding_meta m ON m.scope='article' AND m.scope_id = a.id " +
  "WHERE m.rowid IS NULL AND a.is_duplicate = 0 " +
  "ORDER BY a.published_at DESC" + (LIMIT ? ` LIMIT ${LIMIT}` : "");
const targetTotal = db.prepare(
  "SELECT COUNT(*) c FROM articles a LEFT JOIN embedding_meta m ON m.scope='article' AND m.scope_id = a.id WHERE m.rowid IS NULL AND a.is_duplicate = 0"
).get().c;
const startVecs = countEmbeddings("article");
const ids = db.prepare(MISSING_IDS_SQL).all().map((r) => r.id);
console.log(`🎯 missing (non-dup): ${targetTotal} | article-vectors now: ${startVecs} | this run will attempt: ${ids.length}${LIMIT ? ` (--limit ${LIMIT})` : ""}\n`);
if (ids.length === 0) { console.log("✅ nothing to do — all targeted articles already embedded."); process.exit(0); }

const t0 = Date.now();
let done = 0, failed = 0, skipped = 0, recentFails = 0, capped = false;

async function embedOne(row) {
  if (capped) return;
  const text = ((row.title || "") + ". " + (row.description || "")).trim() || (row.title || "");
  if (!text) { skipped++; return; }
  let vec = null;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length && !vec; attempt++) {
    try { vec = await embedDocument({ scope: "article", scope_id: row.id, text }); }
    catch { vec = null; }
    if (!vec && attempt < RETRY_BACKOFF_MS.length) await sleep(RETRY_BACKOFF_MS[attempt]);
  }
  if (vec) { done++; recentFails = 0; }
  else { failed++; recentFails++; if (recentFails >= CAP_FAILS) capped = true; }
}

// concurrency-CONC pool over one batch
async function runBatch(rows) {
  let next = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (!capped) { const i = next++; if (i >= rows.length) break; await embedOne(rows[i]); }
  }));
}

for (let off = 0; off < ids.length && !capped; off += BATCH) {
  const batchIds = ids.slice(off, off + BATCH);
  const rowsById = new Map(
    db.prepare(`SELECT id,title,description FROM articles WHERE id IN (${batchIds.map(() => "?").join(",")})`).all(...batchIds).map((r) => [r.id, r])
  );
  const rows = batchIds.map((id) => rowsById.get(id)).filter(Boolean);
  await runBatch(rows);
  const elapsed = (Date.now() - t0) / 1000;
  const rate = done / Math.max(1, elapsed);
  const remaining = ids.length - (done + failed + skipped);
  console.log(`  batch @${off + rows.length}/${ids.length}: done ${done}, failed ${failed}, skipped ${skipped} | ${elapsed.toFixed(0)}s, ${rate.toFixed(1)}/s, ~${remaining > 0 && rate > 0 ? (remaining / rate / 60).toFixed(1) : "0"}min left`);
}

const endVecs = countEmbeddings("article");
if (capped) {
  console.log(`\n⏸  HIT CAP / persistent failures — graceful pause. done ${done}, remaining ~${targetTotal - done}. Re-run to resume (idempotent).`);
  console.log(`article-vectors: ${startVecs} → ${endVecs}`);
  process.exit(0);
}
console.log(`\n✅ done. embedded ${done}, failed ${failed}, skipped(empty) ${skipped} in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
console.log(`article-vectors: ${startVecs} → ${endVecs} | remaining missing (non-dup): ${targetTotal - done}`);
process.exit(0);
