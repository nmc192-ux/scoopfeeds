/**
 * polymarketFetcher — pull active markets from Polymarket's public Gamma API.
 *
 * Endpoint: https://gamma-api.polymarket.com/markets
 *   • No auth required for read.
 *   • Returns up to 500 per page; we paginate.
 *   • Each market exposes: id, question, slug, description, conditionId,
 *     outcomePrices (JSON array string '["0.63","0.37"]'), volume, volume24hr,
 *     liquidity, active, closed, archived, endDate, category.
 *
 * Persists into prediction_markets via marketsDao.upsertMarket. Each upsert
 * also writes a snapshot row via snapshotsDao.insertSnapshot when a price
 * is present — that gives us the time-series for free, no separate poll.
 *
 * Defensive on the wire format: Polymarket's API has changed several times
 * (outcomePrices started as JSON string, then became array, etc.). We accept
 * both. Markets that lack a price are still upserted (metadata only) and
 * later snapshot polls will fill them in.
 */

import axios from "axios";
import { upsertMarket } from "../../dal/marketsDao.js";
import { insertSnapshot } from "../../dal/snapshotsDao.js";
import { logger } from "../../../services/logger.js";

const GAMMA_BASE = process.env.POLYMARKET_GAMMA_BASE || "https://gamma-api.polymarket.com";
const PAGE_SIZE  = 500;
const MAX_PAGES  = 6;     // 3000 markets is plenty; Polymarket has ~1000 active

function parseOutcomePrices(raw) {
  // Accept: '[\"0.63\",\"0.37\"]', ['0.63','0.37'], [0.63,0.37], or null.
  if (!raw) return null;
  let arr = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return null; }
  }
  if (!Array.isArray(arr) || !arr.length) return null;
  const yes = Number(arr[0]);
  const no  = arr.length > 1 ? Number(arr[1]) : (Number.isFinite(yes) ? 1 - yes : null);
  return {
    yes: Number.isFinite(yes) ? yes : null,
    no:  Number.isFinite(no)  ? no  : null,
  };
}

function parseEndDate(raw) {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function spread(yes, no) {
  if (!Number.isFinite(yes) || !Number.isFinite(no)) return null;
  return Math.abs(1 - (yes + no));
}

async function fetchPage({ offset, activeOnly }) {
  const params = {
    limit: PAGE_SIZE,
    offset,
    archived: false,
    closed: false,
    order: "volume24hr",
    ascending: false,
  };
  if (activeOnly) params.active = true;
  const { data } = await axios.get(`${GAMMA_BASE}/markets`, {
    params,
    timeout: 25_000,
    headers: { "User-Agent": "Scoopfeeds/1.0 (+https://scoopfeeds.com)" },
  });
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch active markets, upsert them, and write a fresh snapshot row.
 * Returns counts: { fetched, upserted, snapshots, pages }.
 */
export async function syncPolymarketMarkets({
  activeOnly = true,
  maxPages = MAX_PAGES,
} = {}) {
  let fetched = 0, upserted = 0, snapshots = 0, pages = 0;

  for (let page = 0; page < maxPages; page++) {
    let rows;
    try {
      rows = await fetchPage({ offset: page * PAGE_SIZE, activeOnly });
    } catch (err) {
      logger.warn(`📈 Polymarket fetch page ${page} failed: ${err.message}`);
      break;
    }
    if (!rows.length) break;
    pages++;
    fetched += rows.length;

    for (const row of rows) {
      const sourceMarketId = String(row.conditionId || row.condition_id || row.id);
      if (!sourceMarketId) continue;

      const prices = parseOutcomePrices(row.outcomePrices);
      const yesPrice = prices?.yes ?? null;
      const noPrice  = prices?.no  ?? null;

      const liquidityRaw = row.liquidity ?? row.liquidityNum ?? null;
      const volume24Raw  = row.volume24hr ?? row.volume24hrNum ?? row.volume_24hr ?? null;

      const liquidity = liquidityRaw != null ? Number(liquidityRaw) : null;
      const volume24h = volume24Raw  != null ? Number(volume24Raw)  : null;
      const sp        = spread(yesPrice, noPrice);

      const m = {
        source: "polymarket",
        source_market_id: sourceMarketId,
        question: row.question || row.title || "",
        description: row.description || null,
        slug: row.slug || null,
        category: row.category || null,
        tags: row.tags ? JSON.stringify(row.tags) : null,
        end_date: parseEndDate(row.endDate || row.end_date_iso || row.endDateIso),
        resolved: row.closed ? 1 : 0,
        outcome: null,
        active: row.active === false ? 0 : 1,
        yes_price: yesPrice,
        no_price:  noPrice,
        volume_24h: volume24h,
        liquidity,
        spread: sp,
        url: row.slug ? `https://polymarket.com/market/${row.slug}` : null,
        icon_url: row.image || row.icon || null,
        raw_meta: JSON.stringify({
          outcomePrices: row.outcomePrices,
          volume: row.volume,
          createdAt: row.createdAt,
        }),
      };

      let internalId;
      try {
        internalId = upsertMarket(m);
        upserted++;
      } catch (err) {
        logger.warn(`📈 upsertMarket failed for ${sourceMarketId}: ${err.message}`);
        continue;
      }

      // Time-series row when we have any price signal.
      if (yesPrice != null || noPrice != null) {
        try {
          insertSnapshot({
            market_id: internalId,
            yes_price: yesPrice,
            no_price:  noPrice,
            volume_24h: volume24h,
            liquidity,
            spread: sp,
          });
          snapshots++;
        } catch (err) {
          logger.warn(`📈 insertSnapshot failed for ${sourceMarketId}: ${err.message}`);
        }
      }
    }

    // Polymarket returned a partial page → that's the tail.
    if (rows.length < PAGE_SIZE) break;
  }

  logger.info(`📈 Polymarket sync: ${pages} pages, ${fetched} fetched, ${upserted} upserted, ${snapshots} snapshots`);
  return { fetched, upserted, snapshots, pages };
}
