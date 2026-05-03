/**
 * eventTracker — promotes story clusters into first-class Event entities.
 *
 * Promotion criteria (either condition triggers):
 *   A. cluster.article_count >= MIN_ARTICLES (default 5)
 *   B. cluster has ≥1 matched prediction market
 *
 * Per-run steps:
 *   1. Find eligible clusters not yet promoted (or needing refresh).
 *   2. Upsert events row (slug, title, category, severity, hero image).
 *   3. Sync event_articles from cluster.article_ids.
 *   4. Sync event_market_links from cluster_market_links.
 *   5. Demote events with no activity in DORMANT_AFTER_MS.
 *
 * Timeline entries and actor extraction are handled by their own modules
 * (eventTimelineBuilder, eventActorExtractor) which run after this job.
 */

import crypto from "crypto";
import { getDb } from "../../models/database.js";
import { logger } from "../../services/logger.js";

const MIN_ARTICLES    = parseInt(process.env.EVENT_MIN_ARTICLES || "5", 10);
const DORMANT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
}

function uniqueSlug(db, base) {
  let slug = base;
  let i = 2;
  while (db.prepare("SELECT 1 FROM events WHERE slug = ?").get(slug)) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

function firstImageFromCluster(db, articleIds) {
  if (!articleIds.length) return null;
  const placeholders = articleIds.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT image_url FROM articles WHERE id IN (${placeholders}) AND image_url IS NOT NULL LIMIT 1`
    )
    .get(...articleIds);
  return row?.image_url ?? null;
}

function severityFromCluster(cluster, marketCount) {
  // Simple heuristic: more articles + markets = higher severity.
  const artScore    = Math.min(cluster.article_count / 30, 1) * 0.6;
  const marketScore = Math.min(marketCount / 3, 1) * 0.4;
  return Math.round((artScore + marketScore) * 100) / 100;
}

function summaryFromCluster(cluster) {
  try {
    const briefs = JSON.parse(cluster.brief || "[]");
    return briefs[0]?.text ?? cluster.summary ?? null;
  } catch {
    return cluster.summary ?? null;
  }
}

export async function runEventTracker() {
  const db  = getDb();
  const now = Date.now();

  // ── 1. Find eligible clusters ─────────────────────────────────────────
  const eligible = db.prepare(`
    SELECT sc.*,
           (SELECT COUNT(*) FROM cluster_market_links cml WHERE cml.cluster_id = sc.id) AS market_count
    FROM story_clusters sc
    WHERE sc.article_count >= ?
       OR (SELECT COUNT(*) FROM cluster_market_links cml WHERE cml.cluster_id = sc.id) >= 1
    ORDER BY sc.updated_at DESC
    LIMIT 300
  `).all(MIN_ARTICLES);

  let promoted = 0;
  let refreshed = 0;

  // Partial unique index on cluster_id (WHERE cluster_id IS NOT NULL) requires the
  // same WHERE clause on the ON CONFLICT target for SQLite to match it.
  const upsertEvent = db.prepare(`
    INSERT INTO events
      (id, slug, cluster_id, title, summary, category, status, severity,
       hero_image_url, started_at, last_activity_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(cluster_id) WHERE cluster_id IS NOT NULL DO UPDATE SET
      title            = excluded.title,
      summary          = excluded.summary,
      severity         = excluded.severity,
      hero_image_url   = COALESCE(excluded.hero_image_url, events.hero_image_url),
      last_activity_at = excluded.last_activity_at,
      updated_at       = excluded.updated_at
  `);

  const linkArticle = db.prepare(`
    INSERT OR IGNORE INTO event_articles (event_id, article_id, relevance, added_at)
    VALUES (?, ?, 1.0, ?)
  `);

  const linkMarket = db.prepare(`
    INSERT OR REPLACE INTO event_market_links (event_id, market_id, weight, rank, matched_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const cluster of eligible) {
    try {
      let articleIds = [];
      try { articleIds = JSON.parse(cluster.article_ids || "[]"); } catch { /* skip */ }

      const severity    = severityFromCluster(cluster, cluster.market_count);
      const summary     = summaryFromCluster(cluster);
      const heroImage   = firstImageFromCluster(db, articleIds.slice(0, 10));
      const existing    = db.prepare("SELECT id FROM events WHERE cluster_id = ?").get(cluster.id);

      if (!existing) {
        const id   = crypto.randomUUID();
        const slug = uniqueSlug(db, slugify(cluster.title) || id.slice(0, 8));
        upsertEvent.run(
          id, slug, cluster.id, cluster.title, summary, cluster.category,
          "active", severity, heroImage,
          cluster.created_at, cluster.updated_at, now, now
        );
        promoted++;
      } else {
        // Refresh severity + activity timestamp
        db.prepare(`
          UPDATE events SET severity = ?, last_activity_at = ?, updated_at = ?,
            hero_image_url = COALESCE(?, hero_image_url), summary = COALESCE(?, summary)
          WHERE cluster_id = ?
        `).run(severity, cluster.updated_at, now, heroImage, summary, cluster.id);
        refreshed++;
      }

      // ── 2. Sync event_articles ──────────────────────────────────────
      const event = db.prepare("SELECT id FROM events WHERE cluster_id = ?").get(cluster.id);
      if (!event) continue;

      const insertArticles = db.transaction(() => {
        for (const aid of articleIds) {
          linkArticle.run(event.id, aid, now);
        }
      });
      insertArticles();

      // ── 3. Sync event_market_links from cluster_market_links ────────
      const clusterMarkets = db.prepare(
        "SELECT * FROM cluster_market_links WHERE cluster_id = ? ORDER BY rank"
      ).all(cluster.id);
      for (const cml of clusterMarkets) {
        linkMarket.run(event.id, cml.market_id, cml.weight, cml.rank, now);
      }

    } catch (err) {
      logger.warn(`eventTracker: cluster ${cluster.id} failed — ${err.message}`);
    }
  }

  // ── 4. Demote stale events ─────────────────────────────────────────
  const dormantCutoff = now - DORMANT_AFTER_MS;
  const { changes: dormanted } = db.prepare(`
    UPDATE events SET status = 'dormant', updated_at = ?
    WHERE status = 'active' AND last_activity_at < ?
  `).run(now, dormantCutoff);

  const stats = { eligible: eligible.length, promoted, refreshed, dormanted };
  logger.info(`🗂️  eventTracker done — ${JSON.stringify(stats)}`);
  return stats;
}
