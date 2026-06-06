/**
 * runSummary.js — pure aggregation of a scoring run's per-source/per-module results
 * into one summary (B.6.4a). Deterministic, no I/O — unit-testable in isolation.
 */

const STATUS_KEYS = ["evidenced", "pending", "pending-llm", "unavailable", "blocked", "noop"];

/**
 * buildRunSummary({ runResults, flaggedCount, startedAt, finishedAt, sourcesProcessed })
 *   runResults: gatherForAllSources output — [{ source_id, name, results:[{id,status,confidence,guarded?}] }]
 * → { startedAt, finishedAt, durationMs, sourcesProcessed, byStatus, guardedCount, flaggedCount }
 */
export function buildRunSummary({ runResults = [], flaggedCount = 0, startedAt, finishedAt, sourcesProcessed } = {}) {
  const byStatus = Object.fromEntries(STATUS_KEYS.map((k) => [k, 0]));
  let guardedCount = 0;
  for (const s of runResults) {
    for (const r of s.results || []) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1; // tolerate any unexpected status key
      if (r.guarded) guardedCount += 1;
    }
  }
  return {
    startedAt: startedAt ?? null,
    finishedAt: finishedAt ?? null,
    durationMs: startedAt != null && finishedAt != null ? finishedAt - startedAt : null,
    sourcesProcessed: sourcesProcessed ?? runResults.length,
    byStatus,
    guardedCount,
    flaggedCount,
  };
}
