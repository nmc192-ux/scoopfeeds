/**
 * test-reality-index.js — Phase 1 smoke test.
 *
 * Verifies, in order:
 *   1. sqlite-vec extension loads
 *   2. All Reality Index tables exist
 *   3. Polymarket Gamma API is reachable + returns parseable rows
 *   4. upsertMarket + insertSnapshot path works
 *   5. listMarkets returns the just-inserted markets
 *   6. (when GEMINI_API_KEY is set) embedding API + sqlite-vec round-trip
 *   7. (when GEMINI_API_KEY + a story_cluster exists) market matcher
 *
 * Run with: `node backend/scripts/test-reality-index.js`
 * Add `--no-network` to skip Polymarket calls (offline / CI).
 */

import { getDb } from "../src/models/database.js";
import { initRealityIndex, isVecAvailable } from "../src/realityIndex/schema.js";
import { syncPolymarketMarkets } from "../src/realityIndex/ingest/predictionMarkets/polymarketFetcher.js";
import { listMarkets, countActiveMarkets } from "../src/realityIndex/dal/marketsDao.js";
import { snapshotCounts } from "../src/realityIndex/dal/snapshotsDao.js";
import { embedDocument, embedQuery, embeddingsConfig } from "../src/realityIndex/embeddings/embeddingService.js";
import { searchNearest, countEmbeddings } from "../src/realityIndex/dal/embeddingsDao.js";
import { runMarketMatcherCycle } from "../src/realityIndex/intelligence/marketMatcher.js";
import { scoreMarketConfidence } from "../src/realityIndex/intelligence/confidenceScorer.js";

const NO_NETWORK = process.argv.includes("--no-network");
const SKIP_LLM   = process.argv.includes("--no-llm");

const ok  = (msg) => console.log(`  ✅ ${msg}`);
const bad = (msg) => { console.error(`  ❌ ${msg}`); process.exitCode = 1; };
const info = (msg) => console.log(`  ℹ️  ${msg}`);
const step = (n, msg) => console.log(`\n${n}. ${msg}`);

async function run() {
  console.log("Reality Index Phase 1 smoke test\n");

  step(1, "Schema init + sqlite-vec");
  const db = getDb();
  initRealityIndex(db);
  if (isVecAvailable()) ok("sqlite-vec loaded");
  else bad("sqlite-vec NOT loaded — embedding/matcher will be no-ops");

  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type IN ('table','virtual')
    ORDER BY name
  `).all().map(r => r.name);
  for (const t of [
    "prediction_markets", "prediction_market_snapshots",
    "cluster_market_links", "article_market_links",
    "raw_signals",
  ]) {
    if (tables.includes(t)) ok(`table exists: ${t}`);
    else bad(`MISSING table: ${t}`);
  }
  if (tables.includes("embeddings") && tables.includes("embedding_meta")) {
    ok("vector tables exist");
  } else if (isVecAvailable()) {
    bad("vector tables MISSING despite vec-available");
  }

  if (NO_NETWORK) {
    info("Network tests skipped (--no-network).");
    finalSummary();
    return;
  }

  step(2, "Polymarket Gamma API fetch");
  const beforeCount = countActiveMarkets();
  info(`active markets before: ${beforeCount}`);
  let res;
  try {
    res = await syncPolymarketMarkets({ activeOnly: true, maxPages: 1 });
  } catch (err) {
    bad(`syncPolymarketMarkets threw: ${err.message}`);
    finalSummary();
    return;
  }
  if (!res || res.fetched === 0) {
    bad(`Polymarket returned no rows — fetched=${res?.fetched}`);
  } else {
    ok(`fetched=${res.fetched}, upserted=${res.upserted}, snapshots=${res.snapshots}`);
  }
  const afterCount = countActiveMarkets();
  info(`active markets after: ${afterCount}`);
  if (afterCount > 0) ok(`${afterCount} markets persisted`);

  step(3, "Read back via DAL");
  const sample = listMarkets({ limit: 3 });
  if (sample.length) {
    ok(`listMarkets returned ${sample.length} rows`);
    for (const s of sample) {
      info(`  • [${s.source}] ${s.question?.slice(0, 80)} — yes=${s.yes_price}, vol24h=${s.volume_24h}, liq=${s.liquidity}`);
      const conf = scoreMarketConfidence(s);
      info(`     confidence: ${conf.score} (${conf.label})`);
    }
  } else {
    bad("listMarkets returned 0 — pipeline didn't persist");
  }

  step(4, "Snapshots present");
  const counts = snapshotCounts();
  info(`snapshot counts: ${JSON.stringify(counts)}`);
  if ((counts.hot || 0) > 0) ok("hot-tier snapshots present");
  else bad("no snapshots written");

  if (SKIP_LLM || !process.env.GEMINI_API_KEY) {
    info("LLM tests skipped (no GEMINI_API_KEY or --no-llm).");
    finalSummary();
    return;
  }

  step(5, "Embedding round-trip");
  info(`embeddings config: ${JSON.stringify(embeddingsConfig())}`);
  if (sample.length) {
    const m = sample[0];
    const text = `${m.question}\n${m.description || ""}`;
    const rowid = await embedDocument({ scope: "market", scope_id: m.id, text });
    if (rowid) ok(`embedded market ${m.id} → rowid ${rowid}`);
    else bad("embedDocument returned null");

    const q = await embedQuery(m.question || "test query");
    if (q && q.length === 768) ok(`embedQuery returned ${q.length}-dim vector`);
    else bad(`embedQuery returned ${q?.length} dims (expected 768)`);

    if (q) {
      const hits = searchNearest({ vector: q, k: 5, scope: "market" });
      if (hits.length) ok(`vec search returned ${hits.length} hits (top distance ${hits[0].distance.toFixed(4)})`);
      else bad("vec search returned no hits despite recent insert");
    }
    info(`total market embeddings: ${countEmbeddings("market")}`);
  }

  step(6, "Market matcher (uses real story_clusters if any exist)");
  const clusterCount = db.prepare(`SELECT COUNT(*) AS n FROM story_clusters`).get().n;
  info(`story_clusters in DB: ${clusterCount}`);
  if (clusterCount > 0) {
    const matchOut = await runMarketMatcherCycle();
    info(`matcher result: ${JSON.stringify(matchOut)}`);
    if (matchOut.embedded > 0 || matchOut.matched > 0) ok("matcher ran");
    else info("matcher had nothing to do (clusters may already be bound)");
  } else {
    info("no story_clusters yet — matcher skipped (run rss + analysis first)");
  }

  finalSummary();
}

function finalSummary() {
  console.log("\n" + (process.exitCode ? "❌ FAIL" : "✅ ALL TESTS PASSED"));
}

run().catch(err => {
  console.error("Test runner crashed:", err);
  process.exit(2);
});
