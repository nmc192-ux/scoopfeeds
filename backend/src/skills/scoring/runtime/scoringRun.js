/**
 * scoringRun.js — the scoring executor job (B.6.4a).
 *
 * load corpus → gatherForAllSources → build a run summary → write a SEPARATE status
 * artifact (data/scoring-run-status.json — NOT the dashboard's status.json) + log.
 * Idempotent via the runner's TTL-skip (a re-run reuses fresh evidence). Evidence-only;
 * does NOT write quality_score (= B.6.5).
 *
 * The weekly cron is wired in scheduler.js but REGISTERED DISABLED (SCORING_CRON_ENABLED,
 * default off) — this function never auto-fires; it is invoked deliberately.
 */

import fs from "node:fs";
import path from "node:path";
import { getDb } from "../../../models/database.js";
import { logger } from "../../../services/logger.js";
import { gatherForAllSources } from "../evidence/runner.js";
import { listEvidenceForSource } from "../evidence/evidenceCache.js";
import { loadScoreableSources } from "./corpus.js";
import { buildRunSummary } from "./runSummary.js";

function defaultStatusPath() {
  const dataDir = process.env.SCOOP_PERSISTENT_DATA_DIR
    ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
    : path.resolve(process.cwd(), "data");
  return path.join(dataDir, "scoring-run-status.json"); // separate from dashboard/status.json
}

/**
 * runScoringJob(opts) → summary
 *   opts: { db?, now?, finishedAt?, sources?, limit?, gatherOpts?, statusPath?, writeStatus? }
 *   - sources: inject a slice (else loadScoreableSources); limit: cap the loaded set.
 *   - gatherOpts: passed to gatherForAllSources (e.g. {modules, llmCall, resolvedModel, force}).
 */
export async function runScoringJob(opts = {}) {
  const db = opts.db || getDb();
  const startedAt = opts.now ?? Date.now();

  let sources = opts.sources || loadScoreableSources(db);
  if (opts.limit) sources = sources.slice(0, opts.limit);

  const runResults = await gatherForAllSources(sources, { db, now: startedAt, ...(opts.gatherOpts || {}) });
  const finishedAt = opts.finishedAt ?? Date.now();

  // flaggedCount: founderFlag lives inside value JSON — read it back per processed source.
  let flaggedCount = 0;
  for (const s of sources) {
    for (const ev of listEvidenceForSource(s.id, db)) {
      if (ev.value && ev.value.founderFlag === true) flaggedCount += 1;
    }
  }

  const summary = buildRunSummary({ runResults, flaggedCount, startedAt, finishedAt, sourcesProcessed: sources.length });

  if (opts.writeStatus !== false) {
    const statusPath = opts.statusPath || defaultStatusPath();
    try {
      fs.writeFileSync(statusPath, JSON.stringify({ ...summary, generatedAt: finishedAt }, null, 2));
      summary.statusPath = statusPath;
    } catch (e) {
      logger.warn(`🧮 scoring run: could not write status artifact (${statusPath}): ${e.message}`);
    }
  }

  logger.info("🧮 scoring run complete", summary);
  return summary;
}
