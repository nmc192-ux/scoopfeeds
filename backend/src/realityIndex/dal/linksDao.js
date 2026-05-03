/**
 * linksDao — cluster_market_links + article_market_links.
 *
 * Bridge tables connecting our internal entities (story_clusters, articles)
 * to prediction_markets. Many-to-many; matcher records HOW the link was made
 * so we can audit and re-rank when the matcher gets smarter.
 */

import { getDb } from "../../models/database.js";

function now() { return Date.now(); }

// ─── Cluster ↔ Market ──────────────────────────────────────────────────────

/**
 * Replace the links for a cluster atomically. Caller passes the new full set
 * of (market_id, weight, rank, reason). We delete + insert in one tx so the
 * cluster's bound markets always look consistent to readers.
 */
export function setClusterMarketLinks(clusterId, links, { matcher = "embedding+llm" } = {}) {
  if (!clusterId || !Array.isArray(links)) return { written: 0 };
  const db = getDb();
  const ts = now();
  const del = db.prepare(`DELETE FROM cluster_market_links WHERE cluster_id = ?`);
  const ins = db.prepare(`
    INSERT INTO cluster_market_links
      (cluster_id, market_id, weight, rank, matcher, reason, matched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    del.run(clusterId);
    let n = 0;
    for (const l of links) {
      ins.run(clusterId, l.market_id, l.weight, l.rank ?? n + 1, matcher, l.reason ?? null, ts);
      n++;
    }
    return n;
  });
  return { written: tx() };
}

/** All markets bound to a cluster, ordered by rank. */
export function listClusterMarkets(clusterId, { limit = 5 } = {}) {
  return getDb().prepare(`
    SELECT m.*, l.weight, l.rank, l.matcher, l.reason, l.matched_at
    FROM cluster_market_links l
    JOIN prediction_markets m ON m.id = l.market_id
    WHERE l.cluster_id = ?
    ORDER BY l.rank ASC
    LIMIT ?
  `).all(clusterId, limit);
}

/** Clusters that bind to a given market (reverse lookup). */
export function listClustersForMarket(marketId, { limit = 20 } = {}) {
  return getDb().prepare(`
    SELECT c.id, c.title, c.category, c.summary, c.article_count,
           l.weight, l.rank, l.matched_at
    FROM cluster_market_links l
    JOIN story_clusters c ON c.id = l.cluster_id
    WHERE l.market_id = ?
    ORDER BY l.weight DESC
    LIMIT ?
  `).all(marketId, limit);
}

/** Clusters with no market link yet (for the matcher to work on). */
export function listUnmatchedClusters({ limit = 20, sinceMs = null } = {}) {
  const since = sinceMs ?? (Date.now() - 24 * 60 * 60 * 1000);
  return getDb().prepare(`
    SELECT c.*
    FROM story_clusters c
    LEFT JOIN cluster_market_links l ON l.cluster_id = c.id
    WHERE l.cluster_id IS NULL AND c.updated_at >= ?
    ORDER BY c.article_count DESC, c.updated_at DESC
    LIMIT ?
  `).all(since, limit);
}

// ─── Article ↔ Market ──────────────────────────────────────────────────────

export function upsertArticleMarketLink({ article_id, market_id, relevance, matcher }) {
  return getDb().prepare(`
    INSERT INTO article_market_links (article_id, market_id, relevance, matcher, matched_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(article_id, market_id) DO UPDATE SET
      relevance = excluded.relevance,
      matcher   = excluded.matcher,
      matched_at = excluded.matched_at
  `).run(article_id, market_id, relevance, matcher, now());
}

export function listArticleMarkets(articleId, { limit = 5 } = {}) {
  return getDb().prepare(`
    SELECT m.*, l.relevance, l.matcher, l.matched_at
    FROM article_market_links l
    JOIN prediction_markets m ON m.id = l.market_id
    WHERE l.article_id = ?
    ORDER BY l.relevance DESC
    LIMIT ?
  `).all(articleId, limit);
}
