/**
 * llmPricing — the one price table behind llm_usage.est_cost_usd.
 *
 * USD per 1M tokens. A (provider, model) NOT in this table records cost as
 * null and warns once per model per process: a guessed price is worse than a
 * visible gap. Verified against the providers' pricing pages 2026-10-09.
 *
 * Anthropic bills a higher rate when the prompt exceeds `longThreshold`
 * tokens (applies to the whole request). Batch (-50%) and cache-read rates
 * are listed for reference but unused — this path makes neither.
 */

export const LLM_PRICES = {
  anthropic: {
    "claude-haiku-5-5": {
      in: 0.10, out: 0.50,
      longThreshold: 100_000, longIn: 0.50, longOut: 2.50,
      cacheRead: 0.01, // reference only
    },
  },
  gemini: {
    "gemini-3.1-flash-lite": { in: 0.25, out: 1.50 },
    "gemini-3.5-flash":      { in: 1.50, out: 9.00 },
  },
};

const _warned = new Set();

/**
 * @returns {number|null} USD, or null when tokens are unknown or the model is
 *          not in the table.
 */
export function estimateCostUsd(provider, model, inputTokens, outputTokens, { logger } = {}) {
  if (inputTokens == null || outputTokens == null) return null;
  const p = LLM_PRICES[provider]?.[model];
  if (!p) {
    const key = `${provider}:${model}`;
    if (!_warned.has(key)) {
      _warned.add(key);
      logger?.warn?.(`💲 llm price table has no entry for ${key} — est_cost_usd recorded as null (add it to LLM_PRICES in llmPricing.js)`);
    }
    return null;
  }
  const long = p.longThreshold != null && inputTokens > p.longThreshold;
  const rin  = long ? p.longIn  : p.in;
  const rout = long ? p.longOut : p.out;
  return (inputTokens / 1e6) * rin + (outputTokens / 1e6) * rout;
}

/** Test seam: forget which models were already warned about. */
export function _resetPricingWarnings() { _warned.clear(); }
