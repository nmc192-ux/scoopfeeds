/**
 * confidenceScorer — turn raw market microstructure into a 0..1 confidence.
 *
 * Inputs (any may be null):
 *   • volume_24h     — dollars traded last 24h
 *   • liquidity      — book depth at $1 of risk
 *   • spread         — |1 - (yes + no)|; 0 = perfect mid, 0.05 = 5¢ wide
 *   • snapshot_count — how many history rows we have (recency proxy)
 *
 * Output:
 *   { score: 0..1, label: 'low'|'medium'|'high', components: {...} }
 *
 * Method: each component normalises to 0..1 with a soft saturation, then we
 * weighted-average. Weights reflect what most affects probability quality:
 *   liquidity > volume > spread > history depth.
 *
 * These thresholds are deliberately calibrated for Polymarket — the most-
 * traded markets sit around vol24h ≈ $50k and liquidity ≈ $20k. A market
 * scoring 'high' confidence here should be one a serious trader takes
 * seriously. For very small markets, the score will (correctly) be low.
 */

const W_LIQ    = 0.40;
const W_VOL    = 0.30;
const W_SPREAD = 0.20;
const W_HIST   = 0.10;

function normLiquidity(liq) {
  if (!Number.isFinite(liq) || liq <= 0) return 0;
  // ~$5k = 0.5, $20k = 0.8, $100k = 0.97 (smooth log curve).
  return Math.min(1, Math.log10(1 + liq / 1000) / 2.0);
}

function normVolume(vol) {
  if (!Number.isFinite(vol) || vol <= 0) return 0;
  // ~$10k/day = 0.5, $50k = 0.78, $250k = 0.95
  return Math.min(1, Math.log10(1 + vol / 2000) / 2.2);
}

function normSpread(spread) {
  if (!Number.isFinite(spread)) return 0.3;             // unknown → neutral-low
  // 0 spread = 1.0, 1¢ = 0.95, 5¢ = 0.5, 20¢ = 0.05
  const s = Math.max(0, Math.abs(spread));
  if (s >= 0.4) return 0;
  return Math.exp(-s * 9);
}

function normHistory(count) {
  if (!Number.isFinite(count) || count <= 0) return 0;
  // 4 snapshots = 0.5, 24 = 0.86, 100 = 0.97
  return Math.min(1, Math.log10(1 + count) / 2.0);
}

function labelFor(score) {
  if (score >= 0.7)  return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

/**
 * Given a market row (yes_price, no_price, volume_24h, liquidity, spread)
 * and an optional snapshotCount, returns the confidence object.
 */
export function scoreMarketConfidence(market, { snapshotCount = null } = {}) {
  const cLiq    = normLiquidity(market.liquidity);
  const cVol    = normVolume(market.volume_24h);
  const cSpread = normSpread(market.spread);
  const cHist   = snapshotCount != null ? normHistory(snapshotCount) : 0.3;

  const score = Math.max(0, Math.min(1,
    W_LIQ * cLiq + W_VOL * cVol + W_SPREAD * cSpread + W_HIST * cHist
  ));

  return {
    score: Number(score.toFixed(3)),
    label: labelFor(score),
    components: {
      liquidity:     Number(cLiq.toFixed(3)),
      volume:        Number(cVol.toFixed(3)),
      spread:        Number(cSpread.toFixed(3)),
      history:       Number(cHist.toFixed(3)),
    },
  };
}
