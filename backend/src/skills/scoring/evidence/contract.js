/**
 * contract.js — the evidence-module contract.
 *
 * ★ PRECEDENT ★ — this interface templates EVERY future sub-criterion module
 * (B.6.2b site-scraping, B.6.2c structured-data lookup, B.6.2d link-ratio).
 * Adding a sub-criterion = adding a module that conforms to this shape and
 * registering it. Keep new modules pure and injectable, exactly like these.
 *
 * An evidence module:
 *   {
 *     id:        string   // sub-criterion id, e.g. "2.1.c"
 *     component: string   // methodology component key: ET|MT|DE|Ind|HA
 *     ttlDays:   number   // staleness threshold — re-gather only when older
 *     gather(source, ctx): Evidence | Promise<Evidence>
 *   }
 *
 * Evidence (the return of gather()):
 *   {
 *     status:      "evidenced" | "pending-llm" | "unavailable" | "blocked"
 *     value:       any (JSON-serializable) — the gathered measure
 *     confidence:  number 0..1
 *     evidenceUrl: string | null — provenance URL (null for own-DB criteria)
 *     gatheredAt:  number — unix ms
 *   }
 *
 * ctx (built + injected by the runner — modules NEVER import getDb or read the
 * clock directly, so they stay pure and unit-testable against a temp DB):
 *   {
 *     db:                 better-sqlite3 handle
 *     now:                number (unix ms)
 *     sampleSize:         number (N for ratio criteria; default 20 per spec §3.1)
 *     methodologyVersion: string
 *   }
 *
 * Status semantics:
 *   evidenced   — a real value was computed and is trustworthy as stated
 *   pending     — a deterministic value was computed but is INCONCLUSIVE from
 *                 this source and needs corroboration by a further deterministic
 *                 source (e.g. 2.1.c: a low/absent RSS byline signal is unknown,
 *                 not negative — it awaits a B.6.2b article-page cross-check).
 *                 Distinct from pending-llm (which needs a judgment call).
 *   pending-llm — the deterministic part is done; the judgment part needs B.6.3
 *   unavailable — data we'd need isn't present (e.g. no ingested articles)
 *   blocked     — an external fetch was refused / timed out (B.6.2b+ only)
 *
 * INVARIANT (Finding #99/#100 — honesty of derivation): evidence modules
 * NEVER write sources.quality_score. B.6.2 produces evidence; the headline
 * score waits until every component is complete (B.6.3). A partial combined
 * score would be dishonest precision.
 */

export const EVIDENCE_STATUS = Object.freeze({
  EVIDENCED: "evidenced",
  PENDING: "pending",
  PENDING_LLM: "pending-llm",
  UNAVAILABLE: "unavailable",
  BLOCKED: "blocked",
});

// Spec §3.1 default sample size N for ratio-based criteria.
export const DEFAULT_SAMPLE_SIZE = 20;

/** Runtime validation of an Evidence object — the runner calls this so a
 *  malformed module surfaces loudly rather than poisoning the cache. */
export function assertEvidenceShape(ev, moduleId) {
  const statuses = Object.values(EVIDENCE_STATUS);
  if (!ev || typeof ev !== "object") {
    throw new Error(`evidence module ${moduleId}: gather() must return an object`);
  }
  if (!statuses.includes(ev.status)) {
    throw new Error(`evidence module ${moduleId}: invalid status "${ev.status}"`);
  }
  if (typeof ev.confidence !== "number" || ev.confidence < 0 || ev.confidence > 1) {
    throw new Error(`evidence module ${moduleId}: confidence must be a number in [0,1]`);
  }
  if (typeof ev.gatheredAt !== "number" || !Number.isFinite(ev.gatheredAt)) {
    throw new Error(`evidence module ${moduleId}: gatheredAt must be a unix-ms number`);
  }
  if (!("value" in ev)) {
    throw new Error(`evidence module ${moduleId}: value is required (use null if none)`);
  }
  if (!("evidenceUrl" in ev)) {
    throw new Error(`evidence module ${moduleId}: evidenceUrl is required (null for own-DB criteria)`);
  }
  return ev;
}

/** Small helper for modules: round to 2 decimals (ratios/confidence). */
export function round2(n) {
  return Math.round(n * 100) / 100;
}
