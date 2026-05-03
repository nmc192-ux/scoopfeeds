/**
 * snapshotsDao — time-series storage for prediction market prices.
 *
 * Three tiers, downsampled by realityIndex/jobs/snapshotDownsampler.js:
 *   hot  — 15-min granularity, last 7 days
 *   warm — 1-hour granularity, 7–30 days
 *   cold — daily granularity,  30+ days (older raw rows pruned)
 *
 * Reads consolidate across tiers transparently — callers ask for
 * "history of market X over last N hours" and we return the right rows.
 */

import { getDb } from "../../models/database.js";

function now() { return Date.now(); }

/**
 * Insert a snapshot row at tier='hot'. PRIMARY KEY (market_id, ts) means a
 * second insert at the exact same ms is ignored — this is intentional so
 * cron retries are idempotent.
 */
export function insertSnapshot({
  market_id, ts = now(), yes_price = null, no_price = null,
  volume_24h = null, liquidity = null, spread = null,
}) {
  return getDb().prepare(`
    INSERT OR IGNORE INTO prediction_market_snapshots
      (market_id, ts, tier, yes_price, no_price, volume_24h, liquidity, spread)
    VALUES (?, ?, 'hot', ?, ?, ?, ?, ?)
  `).run(market_id, ts, yes_price, no_price, volume_24h, liquidity, spread);
}

/**
 * Bulk insert. Same semantics as insertSnapshot but wrapped in a single
 * transaction for efficiency during a refresh cycle.
 */
export function insertSnapshots(rows) {
  if (!rows?.length) return { inserted: 0 };
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO prediction_market_snapshots
      (market_id, ts, tier, yes_price, no_price, volume_24h, liquidity, spread)
    VALUES (?, ?, 'hot', ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(items => {
    let n = 0;
    for (const r of items) {
      const out = stmt.run(
        r.market_id, r.ts ?? now(),
        r.yes_price ?? null, r.no_price ?? null,
        r.volume_24h ?? null, r.liquidity ?? null, r.spread ?? null,
      );
      n += out.changes;
    }
    return n;
  });
  return { inserted: tx(rows) };
}

/**
 * Fetch the snapshot history for one market, oldest → newest.
 * Spans all tiers; downsampler ensures no overlap.
 */
export function getSnapshotHistory(marketId, { sinceMs = null, limit = 5000 } = {}) {
  const since = sinceMs ?? (now() - 7 * 24 * 60 * 60 * 1000); // default last 7d
  return getDb().prepare(`
    SELECT ts, tier, yes_price, no_price, volume_24h, liquidity, spread
    FROM prediction_market_snapshots
    WHERE market_id = ? AND ts >= ?
    ORDER BY ts ASC
    LIMIT ?
  `).all(marketId, since, limit);
}

/** Latest snapshot row for a market (any tier). */
export function getLatestSnapshot(marketId) {
  return getDb().prepare(`
    SELECT * FROM prediction_market_snapshots
    WHERE market_id = ?
    ORDER BY ts DESC
    LIMIT 1
  `).get(marketId) ?? null;
}

/**
 * Compact 'hot' rows older than 7 days into 'warm' (1h buckets).
 * Returns the number of rows written / deleted.
 */
export function downsampleHotToWarm() {
  const db = getDb();
  const cutoff = now() - 7 * 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;

  // Aggregate hot rows older than cutoff into 1-hour buckets.
  const buckets = db.prepare(`
    SELECT market_id,
           (ts / ${HOUR}) * ${HOUR} AS bucket_ts,
           AVG(yes_price)  AS yes_price,
           AVG(no_price)   AS no_price,
           AVG(volume_24h) AS volume_24h,
           AVG(liquidity)  AS liquidity,
           AVG(spread)     AS spread
    FROM prediction_market_snapshots
    WHERE tier = 'hot' AND ts < ?
    GROUP BY market_id, bucket_ts
  `).all(cutoff);

  if (!buckets.length) return { promoted: 0, deleted: 0 };

  const ins = db.prepare(`
    INSERT OR REPLACE INTO prediction_market_snapshots
      (market_id, ts, tier, yes_price, no_price, volume_24h, liquidity, spread)
    VALUES (?, ?, 'warm', ?, ?, ?, ?, ?)
  `);
  const del = db.prepare(
    `DELETE FROM prediction_market_snapshots WHERE tier = 'hot' AND ts < ?`
  );

  const tx = db.transaction(() => {
    let p = 0;
    for (const b of buckets) {
      ins.run(b.market_id, b.bucket_ts, b.yes_price, b.no_price, b.volume_24h, b.liquidity, b.spread);
      p++;
    }
    const d = del.run(cutoff).changes;
    return { promoted: p, deleted: d };
  });
  return tx();
}

/** Compact 'warm' rows older than 30 days into 'cold' (daily buckets). */
export function downsampleWarmToCold() {
  const db = getDb();
  const cutoff = now() - 30 * 24 * 60 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;

  const buckets = db.prepare(`
    SELECT market_id,
           (ts / ${DAY}) * ${DAY} AS bucket_ts,
           AVG(yes_price)  AS yes_price,
           AVG(no_price)   AS no_price,
           AVG(volume_24h) AS volume_24h,
           AVG(liquidity)  AS liquidity,
           AVG(spread)     AS spread
    FROM prediction_market_snapshots
    WHERE tier = 'warm' AND ts < ?
    GROUP BY market_id, bucket_ts
  `).all(cutoff);

  if (!buckets.length) return { promoted: 0, deleted: 0 };

  const ins = db.prepare(`
    INSERT OR REPLACE INTO prediction_market_snapshots
      (market_id, ts, tier, yes_price, no_price, volume_24h, liquidity, spread)
    VALUES (?, ?, 'cold', ?, ?, ?, ?, ?)
  `);
  const del = db.prepare(
    `DELETE FROM prediction_market_snapshots WHERE tier = 'warm' AND ts < ?`
  );

  const tx = db.transaction(() => {
    let p = 0;
    for (const b of buckets) {
      ins.run(b.market_id, b.bucket_ts, b.yes_price, b.no_price, b.volume_24h, b.liquidity, b.spread);
      p++;
    }
    const d = del.run(cutoff).changes;
    return { promoted: p, deleted: d };
  });
  return tx();
}

export function snapshotCounts() {
  const db = getDb();
  const out = db.prepare(`
    SELECT tier, COUNT(*) AS n FROM prediction_market_snapshots GROUP BY tier
  `).all();
  return Object.fromEntries(out.map(r => [r.tier, r.n]));
}
