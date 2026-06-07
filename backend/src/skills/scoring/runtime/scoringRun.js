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
import { writeSourceScore, insertAuditLog, getLatestOverride } from "../scoringDao.js";
import { scoreSource, SCORER_VERSION, MIN_COVERAGE, N_COMPONENTS } from "../scorer.js";
import { COMPONENT_KEYS } from "../rubric.js";
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

  // ── Scoring pass (B.6.5): evidence → component → quality_score + audit row. ──────
  // One read of each source's evidence serves both the flagged tally and the scorer.
  // writeScores defaults on; pass {writeScores:false} for an evidence-only run.
  const scoringRunId = opts.scoringRunId || `scoring-${startedAt}`;
  const writeScores = opts.writeScores !== false;
  let flaggedCount = 0;
  let scoredCount = 0, insufficientCount = 0, overriddenCount = 0;

  for (const s of sources) {
    const evidence = listEvidenceForSource(s.id, db);
    // flaggedCount: founderFlag lives inside value JSON — read it back per source.
    for (const ev of evidence) {
      if (ev.value && ev.value.founderFlag === true) flaggedCount += 1;
    }
    if (!writeScores) continue;

    const card = scoreSource(evidence, { minCoverage: MIN_COVERAGE, nComponents: N_COMPONENTS });
    const scored = card.status === "scored";

    // Per-component score (null where insufficient) + coverage + confidence for the audit row.
    const componentScores = {}, coverage = {}, confidence = {};
    for (const c of COMPONENT_KEYS) {
      const comp = card.components[c] || {};
      componentScores[c] = comp.insufficient ? null : comp.score;
      coverage[c] = comp.coverage ?? 0;
      confidence[c] = comp.insufficient ? null : (comp.confidence ?? null);
    }
    const reasoning = scored
      ? { status: "scored", presentComponents: card.presentComponents, presentCount: card.presentCount, coverage, floorTriggered: card.floorTriggered }
      : { status: "insufficient-data", reason: "insufficient-data", presentComponents: card.presentComponents, presentCount: card.presentCount, coverage };

    // Read-only forward-guard: never clobber a human override (none exist yet).
    const override = getLatestOverride(s.id, db);
    const overrideInEffect = !!(override && override.override_present === 1);

    if (!overrideInEffect) {
      // Scored → write the number. Insufficient → write NULL quality_score but stamp
      // quality_score_last_updated (= startedAt) so it reads "evaluated → insufficient",
      // NOT "never evaluated"; partial components JSON kept for transparency.
      writeSourceScore(s.id, {
        quality_score: scored ? card.quality_score : null,
        components: componentScores,
        posture: null,
        methodology_version: SCORER_VERSION,
        scored_at: startedAt,
      }, db);
      if (scored) scoredCount += 1; else insufficientCount += 1;
    } else {
      overriddenCount += 1; // sources.quality_score left as the human's value
    }

    insertAuditLog({
      source_id: s.id,
      scoring_run_id: scoringRunId,
      methodology_version: SCORER_VERSION,
      component_scores: componentScores,
      posture_label: null,
      combined_score: scored ? card.quality_score : null, // the automated value (even when overridden — for the record)
      reasoning_per_subcriterion: reasoning,
      confidence_per_subcriterion: { components: confidence, source: scored ? (card.confidence ?? null) : null },
      override_present: overrideInEffect ? 1 : 0,
      override_rationale: overrideInEffect
        ? (override.override_rationale || "override in effect — automated score not written")
        : null,
      created_at: startedAt,
    }, db);
  }

  const finishedAt = opts.finishedAt ?? Date.now();
  const summary = buildRunSummary({ runResults, flaggedCount, startedAt, finishedAt, sourcesProcessed: sources.length });
  if (writeScores) {
    summary.scoringRunId = scoringRunId;
    summary.scored = scoredCount;
    summary.insufficientData = insufficientCount;
    summary.overridden = overriddenCount;
  }

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
