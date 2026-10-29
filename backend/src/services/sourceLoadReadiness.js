/**
 * sourceLoadReadiness — the pure half of the Source step 2 readiness readout (#292).
 *
 * Question it answers, with numbers: do the event promoter and the RI compose
 * cycle keep up TODAY, so adding sources will not push them past their slots?
 *
 * No DB access here: the CLI (backend/scripts/sources/load-readiness.mjs) reads a
 * read-only COPY of news.db and hands rows in. Keeping the verdict pure is what
 * lets it be tested on fixture rows, including the "not enough data" case.
 *
 * HONESTY (docs/agentic-workflow.md §5): too little data is UNVERIFIED, never
 * READY. A missing table is UNVERIFIED. Every threshold is printed with the
 * verdict, so the reader can see what was tested.
 */

/** The promoter runs every 30 min (:13 and :43). */
export const PROMOTER_RUNS_PER_DAY = 48;
/** Two-thirds of the promoter's 30-minute slot. */
export const PROMOTER_P95_MAX_MS = 1_200_000;
/** Failure rate must be BELOW this (failed / finished). */
export const PROMOTER_MAX_FAILURE_RATE = 0.05;
/** Runs seen must be at least this share of the runs expected in the window. */
export const PROMOTER_MIN_RUN_SHARE = 0.9;
/** The promoter's step-1 LIMIT (eventPromoter.js). At or over it, clusters wait. */
export const PROMOTER_ELIGIBLE_CAP = 300;
/** Fewer promoter runs than this in the window → UNVERIFIED. */
export const PROMOTER_MIN_RUNS_FOR_VERDICT = 24;

export const THRESHOLDS = Object.freeze({
  promoterP95MaxMs: PROMOTER_P95_MAX_MS,
  promoterMaxFailureRate: PROMOTER_MAX_FAILURE_RATE,
  promoterMinRunShare: PROMOTER_MIN_RUN_SHARE,
  promoterRunsPerDay: PROMOTER_RUNS_PER_DAY,
  promoterEligibleCap: PROMOTER_ELIGIBLE_CAP,
  promoterMinRunsForVerdict: PROMOTER_MIN_RUNS_FOR_VERDICT,
});

/** Nearest-rank percentile on an ascending-sorted array; null when empty. */
export function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length, Math.max(1, rank)) - 1];
}

/**
 * Summarise background_job_runs rows for one job.
 * rows: [{ status, duration_ms }]. Durations come from FINISHED runs (completed
 * or failed) — a run that failed after 25 minutes still occupied the slot.
 * `running` rows are counted but have no duration (in flight, or the worker died).
 */
export function summariseRuns(rows, { expected = null } = {}) {
  const runs = rows.length;
  const completed = rows.filter((r) => r.status === "completed").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const running = rows.filter((r) => r.status === "running").length;
  const finished = completed + failed;
  const durations = rows
    .filter((r) => (r.status === "completed" || r.status === "failed") && Number.isFinite(r.duration_ms))
    .map((r) => r.duration_ms)
    .sort((a, b) => a - b);
  return {
    runs,
    expected,
    completed,
    failed,
    running,
    failureRate: finished ? +(failed / finished).toFixed(4) : null,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: durations.length ? durations[durations.length - 1] : null,
  };
}

/**
 * The verdict. Inputs:
 *   promoter     summariseRuns() output for events.promote, or null when the
 *                background_job_runs table is missing
 *   eligibleNow  eligible cluster count (no LIMIT), or null when unmeasurable
 *
 * READY only if every test passes. UNVERIFIED when the evidence is too thin to
 * judge (table missing, < 24 promoter runs, eligible count unmeasurable).
 * Otherwise NOT READY with the failed tests named.
 */
export function readinessVerdict({ promoter, eligibleNow }) {
  const unverified = [];
  if (!promoter) unverified.push("background_job_runs table missing");
  else if (promoter.runs < PROMOTER_MIN_RUNS_FOR_VERDICT) {
    unverified.push(`only ${promoter.runs} events.promote runs in the window (need ≥ ${PROMOTER_MIN_RUNS_FOR_VERDICT})`);
  }
  if (eligibleNow == null) unverified.push("eligible cluster count could not be measured");
  if (unverified.length) return { verdict: "UNVERIFIED", reasons: unverified, failed: [], thresholds: THRESHOLDS };

  const failed = [];
  if (promoter.p95Ms == null || promoter.p95Ms > PROMOTER_P95_MAX_MS) {
    failed.push(`promoter p95 ${promoter.p95Ms ?? "n/a"} ms > ${PROMOTER_P95_MAX_MS} ms`);
  }
  if (promoter.failureRate == null || promoter.failureRate >= PROMOTER_MAX_FAILURE_RATE) {
    failed.push(`promoter failure rate ${promoter.failureRate ?? "n/a"} ≥ ${PROMOTER_MAX_FAILURE_RATE}`);
  }
  if (promoter.expected != null && promoter.runs < PROMOTER_MIN_RUN_SHARE * promoter.expected) {
    failed.push(`promoter ran ${promoter.runs} of ${promoter.expected} expected (< ${PROMOTER_MIN_RUN_SHARE * 100}%)`);
  }
  if (eligibleNow >= PROMOTER_ELIGIBLE_CAP) {
    failed.push(`eligible clusters ${eligibleNow} ≥ cap ${PROMOTER_ELIGIBLE_CAP}`);
  }
  return {
    verdict: failed.length ? "NOT READY" : "READY",
    reasons: failed.length ? failed : ["all tests passed"],
    failed,
    thresholds: THRESHOLDS,
  };
}
