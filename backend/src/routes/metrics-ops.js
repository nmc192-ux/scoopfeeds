/**
 * /scoop-ops/metrics — Phase A baseline metrics dashboard (Sprint 3.4).
 *
 * Single read-only endpoint surfacing the 4 of 5 Phase A baseline metrics
 * specified in Phase A Kickoff Brief Issue 3.4. Designed for solo founder
 * + AI dashboard consumption; safe to hit on production.
 *
 * Metrics:
 *   #1 Production uptime           — completed / total jobs in last 24h
 *   #2 Scheduler last-run age      — max() of last*Run across all job types
 *   #3 BullMQ failure rate (24h)   — failed / total jobs in last 24h
 *   #4 Layer 1 returning user rate — BRIDGED to Phase B Track 1 analytics
 *                                    work per session 28-extension DEC1.
 *                                    Not implemented; explicit stub.
 *   #5 Source diversity index      — distinct (category × region) cells
 *                                    in sources table (Migration 002)
 *
 * Important denominator note (visible in JSON + dashboard): the denominator
 * for #1 uptime and #3 failure rate is the TOTAL count of background_job_runs
 * rows created in the last 24h — including in-flight statuses (running,
 * queued). This means uptime can drop and failure_rate can rise even when
 * no actual job has failed — under sustained high in-flight load, the
 * unfinished tail of work pulls both metrics. The status_breakdown field
 * surfaces the raw counts so dashboard readers can distinguish "many jobs
 * failed" from "many jobs are still running."
 *
 * Admin auth: inherited from the global /scoop-ops mount in
 * backend/server.js (adminRouteLimiter + adminAuth + adminAuditLogger).
 * No per-route auth code needed.
 */

import { Router } from "express";
import { getDb } from "../models/database.js";
import { getSchedulerStatus } from "../services/scheduler.js";

const router = Router();
const DAY_MS = 24 * 60 * 60 * 1000;

function formatPct(ratio) {
  if (ratio == null) return "n/a";
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatAge(secs) {
  if (secs == null) return "—";
  if (secs < 60)    return `${secs}s ago`;
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

router.get("/", (_req, res) => {
  try {
    const db = getDb();
    const now = Date.now();
    const dayAgo = now - DAY_MS;

    // ── Metrics #1 + #3: derive both from a single background_job_runs query.
    // Denominator includes in-flight statuses (running, queued) — see header
    // comment. status_breakdown is surfaced so readers can distinguish
    // failure-driven dips from load-driven dips.
    const jobCountsRows = db.prepare(`
      SELECT status, COUNT(*) AS n
      FROM background_job_runs
      WHERE created_at >= ?
      GROUP BY status
    `).all(dayAgo);

    const statusBreakdown = jobCountsRows.reduce(
      (acc, r) => { acc[r.status] = r.n; acc.total += r.n; return acc; },
      { total: 0 }
    );
    const completed = statusBreakdown.completed || 0;
    const failed    = statusBreakdown.failed    || 0;
    const uptimeRatio    = statusBreakdown.total > 0 ? completed / statusBreakdown.total : null;
    const failureRate24h = statusBreakdown.total > 0 ? failed    / statusBreakdown.total : null;

    const denominatorNotes =
      "Denominator includes in-flight statuses (running, queued). Under sustained high load, uptime can drop and failure rate can rise even with zero actual failures. See status_breakdown for raw counts.";

    // ── Metric #2: max(lastRun) across all scheduler job types.
    const sched = getSchedulerStatus();
    const lastRunTimestamps = Object.entries(sched)
      .filter(([k, v]) => k.startsWith("last") && k.endsWith("Run") && typeof v === "number" && v > 0)
      .map(([, v]) => v);
    const latestLastRun = lastRunTimestamps.length > 0 ? Math.max(...lastRunTimestamps) : null;
    const ageSecs = latestLastRun ? Math.floor((now - latestLastRun) / 1000) : null;

    // ── Metric #5: distinct (category, region) cells from sources table.
    const diversity = db.prepare(`
      SELECT COUNT(DISTINCT category || '|' || region) AS cells,
             COUNT(*) AS total_sources,
             COUNT(DISTINCT category) AS categories,
             COUNT(DISTINCT region) AS regions
      FROM sources
    `).get();

    res.json({
      ok: true,
      computed_at: new Date(now).toISOString(),
      window_hours: 24,
      methodology_version: "v1.1",
      metrics: {
        uptime: {
          label: "Production uptime (job success ratio, 24h)",
          value: uptimeRatio,
          display: formatPct(uptimeRatio),
          numerator: completed,
          denominator: statusBreakdown.total,
          denominator_notes: denominatorNotes,
          status_breakdown: statusBreakdown,
        },
        scheduler_last_run_age: {
          label: "Scheduler last-run age",
          value_seconds: ageSecs,
          display: formatAge(ageSecs),
          most_recent_ts: latestLastRun,
          observed_job_types: lastRunTimestamps.length,
        },
        bullmq_failure_rate_24h: {
          label: "BullMQ failure rate (24h)",
          value: failureRate24h,
          display: formatPct(failureRate24h),
          numerator: failed,
          denominator: statusBreakdown.total,
          denominator_notes: denominatorNotes,
        },
        returning_user_rate: {
          label: "Layer 1 returning user rate (7-day)",
          value: null,
          display: "—",
          bridged_to: "Phase B Track 1 Distribution (Layer 1 analytics infrastructure)",
          note: "Anonymous-visitor return rate requires analytics instrumentation (GA/Plausible/equivalent) not currently in the repo. Per session 28-extension DEC1, bridged rather than backfilled in Phase A.",
        },
        source_diversity_index: {
          label: "Source diversity index (distinct category × region cells)",
          value: diversity.cells,
          display: `${diversity.cells} cells`,
          total_sources: diversity.total_sources,
          distinct_categories: diversity.categories,
          distinct_regions: diversity.regions,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
