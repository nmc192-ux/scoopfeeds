/**
 * llmUsage — write one llm_usage row per provider attempt, and summarise.
 *
 * Writes are best-effort and fail-open: a broken usage ledger must never take
 * down a generation call (same stance as the daily-budget counter). The sink
 * is injectable so llmQueue can be tested without a database.
 */

import { getDb } from "../models/database.js";
import { logger } from "../services/logger.js";

let _failedOnce = false;

function defaultSink(row) {
  getDb().prepare(`
    INSERT INTO llm_usage (ts, task, provider, model, input_tokens, output_tokens, est_cost_usd, ok, error_class)
    VALUES (@ts, @task, @provider, @model, @input_tokens, @output_tokens, @est_cost_usd, @ok, @error_class)
  `).run(row);
}

let sink = defaultSink;

/** Test seam. Pass null to restore the database sink. */
export function setLlmUsageSink(fn) { sink = fn || defaultSink; }

export function recordLlmUsage({ task, provider, model, inputTokens, outputTokens, estCostUsd, ok, errorClass }) {
  try {
    sink({
      ts: Date.now(),
      task: task || "untagged",
      provider,
      model: model ?? null,
      input_tokens: inputTokens ?? null,
      output_tokens: outputTokens ?? null,
      est_cost_usd: estCostUsd ?? null,
      ok: ok ? 1 : 0,
      error_class: ok ? null : (errorClass || "unknown"),
    });
  } catch (err) {
    if (!_failedOnce) {
      _failedOnce = true;
      logger.warn(`📒 llm_usage write failed (fail-open, logged once): ${err.message}`);
    }
  }
}

/**
 * Daily per-task / per-provider summary for /scoop-ops/metrics-ops.
 * `day` is a UTC YYYY-MM-DD (default today). Also returns the last 7 UTC days
 * per provider so a cost drift is visible without a second query.
 */
export function getLlmUsageSummary(db, { day = new Date().toISOString().slice(0, 10) } = {}) {
  const start = Date.parse(`${day}T00:00:00Z`);
  const end   = start + 86_400_000;
  const rows = db.prepare(`
    SELECT task, provider, model,
           COUNT(*)                                   AS calls,
           SUM(ok)                                    AS ok_calls,
           COUNT(*) - SUM(ok)                         AS failed_calls,
           COALESCE(SUM(input_tokens), 0)             AS input_tokens,
           COALESCE(SUM(output_tokens), 0)            AS output_tokens,
           SUM(est_cost_usd)                          AS est_cost_usd,
           SUM(CASE WHEN est_cost_usd IS NULL THEN 1 ELSE 0 END) AS cost_unknown_calls
    FROM llm_usage
    WHERE ts >= ? AND ts < ?
    GROUP BY task, provider, model
    ORDER BY COALESCE(SUM(est_cost_usd), 0) DESC, calls DESC
  `).all(start, end);

  const errors = db.prepare(`
    SELECT provider, error_class, COUNT(*) AS n
    FROM llm_usage WHERE ts >= ? AND ts < ? AND ok = 0
    GROUP BY provider, error_class ORDER BY n DESC
  `).all(start, end);

  const week = db.prepare(`
    SELECT date(ts / 1000, 'unixepoch') AS day, provider,
           COUNT(*) AS calls, SUM(est_cost_usd) AS est_cost_usd
    FROM llm_usage WHERE ts >= ?
    GROUP BY day, provider ORDER BY day DESC, provider
  `).all(start - 6 * 86_400_000);

  const total = rows.reduce((a, r) => ({
    calls: a.calls + r.calls,
    failed_calls: a.failed_calls + r.failed_calls,
    est_cost_usd: a.est_cost_usd + (r.est_cost_usd || 0),
    cost_unknown_calls: a.cost_unknown_calls + r.cost_unknown_calls,
  }), { calls: 0, failed_calls: 0, est_cost_usd: 0, cost_unknown_calls: 0 });

  return {
    day, total, by_task_provider: rows, errors, last_7_days: week,
    note: "est_cost_usd sums only calls with known token counts and a priced model; cost_unknown_calls counts the rest (providers that return no usage, or models missing from llmPricing.js).",
  };
}
