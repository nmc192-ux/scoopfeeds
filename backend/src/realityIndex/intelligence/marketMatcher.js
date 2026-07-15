/**
 * marketMatcher — binds story_clusters to prediction_markets.
 *
 * Two passes per cycle:
 *
 *   PASS A — embed markets that don't yet have a vector.
 *     • Picks the most-traded unembedded markets (caps per cycle to fit quota).
 *     • Stores embedding via embeddingService.embedDocument(scope='market').
 *
 *   PASS B — match unbound clusters to top-K markets.
 *     • For each cluster: embedQuery on a composed query string.
 *     • vector search (top 20 markets) → keep top 8 by liquidity floor.
 *     • Gemini re-ranks the shortlist into the top 3 with explicit weights.
 *     • Persist via setClusterMarketLinks().
 *
 * Both passes are bounded per cycle so we don't blow the LLM queue or the
 * Polymarket-side data freshness window.
 */

import { getDb } from "../../models/database.js";
import { listUnmatchedClusters, setClusterMarketLinks } from "../dal/linksDao.js";
import { listMarkets, getMarketById } from "../dal/marketsDao.js";
import { searchNearest, getEmbeddingMeta } from "../dal/embeddingsDao.js";
import { embedDocument, embedQuery } from "../embeddings/embeddingService.js";
import { isVecAvailable } from "../schema.js";
import { callJson } from "../llmQueue.js";
import { logger } from "../../services/logger.js";

const MARKETS_PER_CYCLE  = Number.parseInt(process.env.RI_MATCHER_MARKETS_PER_CYCLE  || "60", 10);
const CLUSTERS_PER_CYCLE = Number.parseInt(process.env.RI_MATCHER_CLUSTERS_PER_CYCLE || "8",  10);
const SHORTLIST_K        = 20;
const KEEP_AFTER_FILTER  = 8;
const MIN_LIQUIDITY      = Number.parseFloat(process.env.RI_MIN_LIQUIDITY || "1000");
const MIN_WEIGHT         = 0.5;
const MAX_LINKS_PER_CLUSTER = 3;

// ─── Pass A: embed markets ──────────────────────────────────────────────────

function listMarketsNeedingEmbedding(limit) {
  const db = getDb();
  return db.prepare(`
    SELECT m.id, m.question, m.description, m.tags, m.category, m.volume_24h, m.liquidity
    FROM prediction_markets m
    LEFT JOIN embedding_meta em
      ON em.scope = 'market' AND em.scope_id = m.id
    WHERE m.active = 1
      AND em.scope_id IS NULL
      AND m.question IS NOT NULL
      AND length(m.question) > 5
    ORDER BY (CASE WHEN m.volume_24h IS NULL THEN 0 ELSE m.volume_24h END) DESC,
             m.updated_at DESC
    LIMIT ?
  `).all(limit);
}

function marketEmbeddingText(m) {
  const parts = [m.question?.trim()];
  if (m.description) parts.push(m.description.trim().slice(0, 1500));
  if (m.category) parts.push(`Category: ${m.category}`);
  if (m.tags) {
    try {
      const tags = JSON.parse(m.tags);
      if (Array.isArray(tags) && tags.length) parts.push(`Tags: ${tags.join(", ")}`);
    } catch { /* ignore malformed tags */ }
  }
  return parts.filter(Boolean).join("\n");
}

export async function embedPendingMarkets({ limit = MARKETS_PER_CYCLE } = {}) {
  if (!isVecAvailable()) return { embedded: 0, skipped_no_vec: true };
  const rows = listMarketsNeedingEmbedding(limit);
  if (!rows.length) return { embedded: 0 };

  let embedded = 0;
  for (const m of rows) {
    const text = marketEmbeddingText(m);
    if (!text) continue;
    const out = await embedDocument({ scope: "market", scope_id: m.id, text });
    if (out) embedded++;
  }
  if (embedded) logger.info(`🧮 Embedded ${embedded} markets`);
  return { embedded, scanned: rows.length };
}

// ─── Pass B: match clusters → markets ──────────────────────────────────────

function clusterQueryText(c) {
  const parts = [c.title?.trim()];
  if (c.summary) parts.push(c.summary.trim().slice(0, 1000));
  try {
    const kw = JSON.parse(c.keywords || "[]");
    if (Array.isArray(kw) && kw.length) parts.push(kw.slice(0, 12).join(", "));
  } catch { /* ignore */ }
  return parts.filter(Boolean).join("\n");
}

function buildRerankPrompt(cluster, candidates) {
  const lines = candidates.map((c, i) =>
    `[${i}] vol24h=${Math.round(c.volume_24h || 0)}, liq=${Math.round(c.liquidity || 0)}, ` +
    `yes=${c.yes_price?.toFixed?.(2) ?? "?"}\n` +
    `   Q: ${(c.question || "").slice(0, 240)}\n` +
    `   ${(c.description || "").slice(0, 240).replace(/\s+/g, " ")}`
  ).join("\n\n");

  return `You are scoring how RELEVANT each prediction market is to a news story.

NEWS STORY CLUSTER
Title: ${cluster.title}
Category: ${cluster.category || "n/a"}
${cluster.summary ? `Summary: ${cluster.summary.slice(0, 600)}` : ""}

CANDIDATE MARKETS:
${lines}

For each candidate, decide if it directly captures a future-tense outcome of THIS story.
- A relevant market predicts something the story is about (event, person, deadline).
- An irrelevant market is in the same broad topic but answers a different question.

Return STRICT JSON ONLY in this shape:
{"matches": [{"index": <integer>, "weight": <0..1>, "reason": "<one short sentence>"}]}

Rules:
- Include at most ${MAX_LINKS_PER_CLUSTER} matches.
- Include only matches with weight >= ${MIN_WEIGHT}.
- If no candidate is genuinely relevant, return {"matches": []}.
- Order by weight descending.`;
}

async function matchOneCluster(cluster) {
  const queryText = clusterQueryText(cluster);
  if (!queryText) return { ok: false, reason: "empty_query" };

  const qVec = await embedQuery(queryText);
  if (!qVec) return { ok: false, reason: "embed_failed" };

  const hits = searchNearest({ vector: qVec, k: SHORTLIST_K, scope: "market" });
  if (!hits.length) return { ok: false, reason: "no_candidates" };

  // Hydrate market rows; filter low-liquidity to avoid noisy probabilities.
  const candidates = hits
    .map(h => getMarketById(h.scope_id))
    .filter(Boolean)
    .filter(m => (m.liquidity ?? 0) >= MIN_LIQUIDITY)
    .slice(0, KEEP_AFTER_FILTER);

  if (!candidates.length) return { ok: false, reason: "all_below_liquidity" };

  const prompt = buildRerankPrompt(cluster, candidates);
  const llm = await callJson(prompt, { priority: "high", maxOutputTokens: 700, task: "market-match" });
  const matches = Array.isArray(llm?.matches) ? llm.matches : [];

  const links = matches
    .filter(m => Number.isInteger(m.index)
                && m.index >= 0 && m.index < candidates.length
                && Number.isFinite(m.weight) && m.weight >= MIN_WEIGHT)
    .slice(0, MAX_LINKS_PER_CLUSTER)
    .map((m, i) => ({
      market_id: candidates[m.index].id,
      weight:    Number(m.weight),
      rank:      i + 1,
      reason:    m.reason ? String(m.reason).slice(0, 280) : null,
    }));

  setClusterMarketLinks(cluster.id, links, { matcher: "embedding+llm" });
  return { ok: true, linked: links.length, candidates: candidates.length };
}

export async function matchPendingClusters({ limit = CLUSTERS_PER_CYCLE } = {}) {
  if (!isVecAvailable()) return { matched: 0, skipped_no_vec: true };
  const clusters = listUnmatchedClusters({ limit });
  if (!clusters.length) return { matched: 0 };

  let attempted = 0, matched = 0, skipped = 0;
  for (const c of clusters) {
    attempted++;
    const out = await matchOneCluster(c);
    if (out.ok && out.linked > 0) matched++;
    else skipped++;
  }
  logger.info(`🔗 Cluster→market match: ${attempted} attempted, ${matched} bound, ${skipped} skipped`);
  return { attempted, matched, skipped };
}

// ─── Composed cycle ────────────────────────────────────────────────────────

export async function runMarketMatcherCycle() {
  const a = await embedPendingMarkets();
  const b = await matchPendingClusters();
  return { ...a, ...b };
}
