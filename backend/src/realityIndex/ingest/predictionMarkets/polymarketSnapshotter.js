/**
 * polymarketSnapshotter — refresh prices for already-known markets.
 *
 * The fetcher above (polymarketFetcher) already snapshots-on-upsert, so for
 * a normal cycle we don't strictly need this. It exists as a faster-cadence
 * complement: we can run the snapshotter every 15 min while the full fetcher
 * runs every 30 min, since refreshing prices for known markets is cheaper
 * (smaller payload, no metadata churn).
 *
 * Strategy:
 *   • Pull the most recent prices from Gamma for active markets we already
 *     have, using ?id=... query batching.
 *   • Insert a snapshot row + update the cached yes_price/no_price/spread on
 *     the markets row.
 *
 * Phase 1 keeps things simple — we just call syncPolymarketMarkets again
 * with a tighter page limit. The dedicated batched implementation can come
 * in Phase 1.5 if cron load becomes a concern.
 */

import { syncPolymarketMarkets } from "./polymarketFetcher.js";

export async function snapshotActiveMarkets() {
  // 2 pages = up to 1000 most-traded markets, which is the universe we care
  // about. Anything beyond that has zero matched-cluster impact.
  return syncPolymarketMarkets({ activeOnly: true, maxPages: 2 });
}
