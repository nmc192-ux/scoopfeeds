/**
 * marketsDao — read/write helpers for prediction_markets.
 *
 * Thin wrapper so that when we cut over to Postgres + pgvector + TimescaleDB
 * (post-launch), only this file needs to change shape — callers don't touch SQL.
 */

import crypto from "crypto";
import { getDb } from "../../models/database.js";

function now() { return Date.now(); }

/**
 * Upsert a market. Matches on (source, source_market_id). Returns the internal id.
 * If the row already exists, refreshes the mutable fields and bumps updated_at.
 */
export function upsertMarket(m) {
  const db = getDb();
  const ts = now();
  const existing = db.prepare(
    `SELECT id FROM prediction_markets WHERE source = ? AND source_market_id = ?`
  ).get(m.source, m.source_market_id);

  if (existing) {
    db.prepare(`
      UPDATE prediction_markets SET
        question    = COALESCE(@question, question),
        description = COALESCE(@description, description),
        slug        = COALESCE(@slug, slug),
        category    = COALESCE(@category, category),
        tags        = COALESCE(@tags, tags),
        end_date    = COALESCE(@end_date, end_date),
        resolved    = COALESCE(@resolved, resolved),
        outcome     = COALESCE(@outcome, outcome),
        active      = COALESCE(@active, active),
        yes_price   = COALESCE(@yes_price, yes_price),
        no_price    = COALESCE(@no_price, no_price),
        volume_24h  = COALESCE(@volume_24h, volume_24h),
        liquidity   = COALESCE(@liquidity, liquidity),
        spread      = COALESCE(@spread, spread),
        url         = COALESCE(@url, url),
        icon_url    = COALESCE(@icon_url, icon_url),
        raw_meta    = COALESCE(@raw_meta, raw_meta),
        updated_at  = @updated_at
      WHERE id = @id
    `).run({ ...m, id: existing.id, updated_at: ts });
    return existing.id;
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO prediction_markets
      (id, source, source_market_id, question, description, slug, category, tags,
       end_date, resolved, outcome, active, yes_price, no_price, volume_24h,
       liquidity, spread, url, icon_url, created_at, updated_at, raw_meta)
    VALUES
      (@id, @source, @source_market_id, @question, @description, @slug, @category,
       @tags, @end_date, @resolved, @outcome, @active, @yes_price, @no_price,
       @volume_24h, @liquidity, @spread, @url, @icon_url, @created_at, @updated_at,
       @raw_meta)
  `).run({
    id,
    source:           m.source,
    source_market_id: m.source_market_id,
    question:         m.question ?? null,
    description:      m.description ?? null,
    slug:             m.slug ?? null,
    category:         m.category ?? null,
    tags:             m.tags ?? null,
    end_date:         m.end_date ?? null,
    resolved:         m.resolved ?? 0,
    outcome:          m.outcome ?? null,
    active:           m.active ?? 1,
    yes_price:        m.yes_price ?? null,
    no_price:         m.no_price ?? null,
    volume_24h:       m.volume_24h ?? null,
    liquidity:        m.liquidity ?? null,
    spread:           m.spread ?? null,
    url:              m.url ?? null,
    icon_url:         m.icon_url ?? null,
    created_at:       ts,
    updated_at:       ts,
    raw_meta:         m.raw_meta ?? null,
  });
  return id;
}

export function getMarketById(id) {
  return getDb().prepare(
    `SELECT * FROM prediction_markets WHERE id = ?`
  ).get(id) ?? null;
}

export function getMarketBySource(source, sourceMarketId) {
  return getDb().prepare(
    `SELECT * FROM prediction_markets WHERE source = ? AND source_market_id = ?`
  ).get(source, sourceMarketId) ?? null;
}

/**
 * List markets, optionally filtered by category/source/active and sorted by
 * volume (24h) desc — i.e. "most-traded right now first".
 */
export function listMarkets({
  source = null,
  category = null,
  activeOnly = true,
  minVolume = 0,
  limit = 50,
  offset = 0,
} = {}) {
  const where = [];
  const params = [];
  if (source) { where.push("source = ?"); params.push(source); }
  if (category) { where.push("category = ?"); params.push(category); }
  if (activeOnly) { where.push("active = 1"); }
  if (minVolume > 0) { where.push("(volume_24h IS NOT NULL AND volume_24h >= ?)"); params.push(minVolume); }

  const sql = `
    SELECT * FROM prediction_markets
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY (CASE WHEN volume_24h IS NULL THEN 0 ELSE volume_24h END) DESC,
             updated_at DESC
    LIMIT ? OFFSET ?
  `;
  return getDb().prepare(sql).all(...params, limit, offset);
}

/** Mark as inactive — used when an upstream market disappears or resolves. */
export function deactivateMarket(id) {
  getDb().prepare(
    `UPDATE prediction_markets SET active = 0, updated_at = ? WHERE id = ?`
  ).run(now(), id);
}

export function countActiveMarkets({ source = null } = {}) {
  if (source) {
    return getDb().prepare(
      `SELECT COUNT(*) AS n FROM prediction_markets WHERE active = 1 AND source = ?`
    ).get(source).n;
  }
  return getDb().prepare(
    `SELECT COUNT(*) AS n FROM prediction_markets WHERE active = 1`
  ).get().n;
}

/**
 * Top movers: largest |Δ price| over the last `windowMs` based on snapshots.
 * Returns markets joined with their delta. Used by /api/predictions/movers later.
 */
export function listTopMovers({ windowMs = 24 * 60 * 60 * 1000, limit = 20 } = {}) {
  const cutoff = now() - windowMs;
  return getDb().prepare(`
    SELECT m.*,
           latest.yes_price AS latest_yes,
           earliest.yes_price AS earliest_yes,
           ABS(latest.yes_price - earliest.yes_price) AS delta_abs
    FROM prediction_markets m
    JOIN (
      SELECT market_id, yes_price
      FROM prediction_market_snapshots s1
      WHERE ts = (SELECT MAX(ts) FROM prediction_market_snapshots WHERE market_id = s1.market_id AND ts >= ?)
    ) latest ON latest.market_id = m.id
    JOIN (
      SELECT market_id, yes_price
      FROM prediction_market_snapshots s2
      WHERE ts = (SELECT MIN(ts) FROM prediction_market_snapshots WHERE market_id = s2.market_id AND ts >= ?)
    ) earliest ON earliest.market_id = m.id
    WHERE m.active = 1
      AND latest.yes_price IS NOT NULL
      AND earliest.yes_price IS NOT NULL
    ORDER BY delta_abs DESC
    LIMIT ?
  `).all(cutoff, cutoff, limit);
}
