/**
 * evidenceCache.js — DAO for the scoring_evidence_cache table (Migration 007).
 *
 * Stores one current evidence row per (source_id, sub_criterion); upsert on
 * re-gather. Mirrors the better-sqlite3 house pattern (scoringDao.js): JSON
 * `value` hydrated/serialized at the boundary. Every function accepts an
 * optional `db` handle (defaults to the shared getDb()) so the runner + tests
 * can inject a temp DB — the testability precedent set by the contract.
 */

import { getDb } from "../../../models/database.js";

const UPSERT_SQL = `
  INSERT INTO scoring_evidence_cache
    (source_id, sub_criterion, status, value, confidence, evidence_url, gathered_at, methodology_version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_id, sub_criterion) DO UPDATE SET
    status              = excluded.status,
    value               = excluded.value,
    confidence          = excluded.confidence,
    evidence_url        = excluded.evidence_url,
    gathered_at         = excluded.gathered_at,
    methodology_version = excluded.methodology_version
`;

function hydrate(row) {
  if (!row) return null;
  return { ...row, value: row.value ? JSON.parse(row.value) : null };
}

/** Current evidence row for (source, sub-criterion), or null. value is hydrated. */
export function getEvidence(sourceId, subCriterion, db = getDb()) {
  const row = db
    .prepare(`SELECT * FROM scoring_evidence_cache WHERE source_id = ? AND sub_criterion = ?`)
    .get(sourceId, subCriterion);
  return hydrate(row);
}

/** All current evidence rows for a source, ordered by sub-criterion. */
export function listEvidenceForSource(sourceId, db = getDb()) {
  return db
    .prepare(`SELECT * FROM scoring_evidence_cache WHERE source_id = ? ORDER BY sub_criterion`)
    .all(sourceId)
    .map(hydrate);
}

// ── Founder-review surface (B.6.4b) ──────────────────────────────────────────
// founderFlag lives INSIDE the value JSON (not a column); query via json_extract
// (no migration). The flag stored as JSON true → json_extract returns 1.
const FLAGGED_SQL = `
  SELECT s.name AS source_name, e.*
  FROM scoring_evidence_cache e
  JOIN sources s ON s.id = e.source_id
  WHERE json_extract(e.value, '$.founderFlag') = 1
  ORDER BY e.confidence ASC, e.source_id
`;
const MODEL_NOT_VALIDATED_SQL = `
  SELECT s.name AS source_name, e.*
  FROM scoring_evidence_cache e
  JOIN sources s ON s.id = e.source_id
  WHERE json_extract(e.value, '$.reason') = 'model-not-validated'
  ORDER BY e.source_id, e.sub_criterion
`;

/** Corpus-wide flagged judgments (founderFlag=1), lowest-confidence first, value hydrated. */
export function listFlaggedEvidence(db = getDb()) {
  return db.prepare(FLAGGED_SQL).all().map(hydrate);
}

/** Operational anomalies: gated judgments the model-tier guard refused (B.6.4a / #109). */
export function listModelNotValidatedEvidence(db = getDb()) {
  return db.prepare(MODEL_NOT_VALIDATED_SQL).all().map(hydrate);
}

/**
 * upsertEvidence — write/replace the current evidence for (source, sub-criterion).
 * @returns {number} rows changed.
 */
export function upsertEvidence(sourceId, subCriterion, ev, methodologyVersion, db = getDb()) {
  const info = db.prepare(UPSERT_SQL).run(
    sourceId,
    subCriterion,
    ev.status,
    ev.value != null ? JSON.stringify(ev.value) : null,
    ev.confidence,
    ev.evidenceUrl ?? null,
    ev.gatheredAt,
    methodologyVersion,
  );
  return info.changes;
}

// Recoverable COVERAGE-GAP rows (#116 extension): a row that records a transient/resolvable
// gap — NOT a completed observation — is never "fresh"; it re-attempts next run, exactly like
// `blocked`. Keyed status → the set of value.reason values that a clean low-contention scoring
// re-run can resolve (the underlying articles exist, or an upstream criterion can resolve):
//   - pending-llm / no-article-bodies : the body pre-pass found no bodies (fetch contended);
//       a low-contention re-run re-fetches → the article-text judgments can finally run.
//   - unavailable / owner-unknown     : 2.2.d COI pre-flight had no resolved owner; resolves
//       once 2.4.a (itself re-attempted when blocked) resolves with a named owner.
// DELIBERATELY EXCLUDED (kept on normal TTL):
//   - completed observations          : unavailable/no-relevant-article-in-sample,
//       pending-llm/runs-disagree — a judgment DID run (nothing relevant / model split).
//   - ingestion-conditional gaps      : no-editorial-domain, no-articles, no-ingested-articles,
//       feeder-unavailable — a scoring re-run cannot fix these (they need ingestion, #114).
const RECOVERABLE_GAP_REASONS = Object.freeze({
  "pending-llm": new Set(["no-article-bodies"]),
  "unavailable": new Set(["owner-unknown"]),
});

// Read value.reason whether the row's value is hydrated (object — the getEvidence path used
// at every runner call site) or raw JSON (string — defensive, in case an unhydrated row arrives).
function reasonOf(row) {
  let v = row.value;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  return v && typeof v === "object" ? (v.reason ?? null) : null;
}

/**
 * isStale — true if there is no cached row, it records a recoverable gap (blocked, or a
 * listed coverage-gap reason), or it is older than ttlDays. Drives "re-gather only when
 * stale" at all three runner gates (discovery pre-pass, body pre-pass, per-module skip).
 */
export function isStale(row, ttlDays, now) {
  if (!row) return true;
  // A `blocked` row records a TRANSIENT gather failure (e.g. Wikidata DNS/timeout),
  // not an observation. Per the evidence contract it must be retried next run — so it
  // is ALWAYS stale regardless of age (#116).
  if (row.status === "blocked") return true;
  // #116 extension: a recoverable COVERAGE GAP (resolvable on a clean re-run) is never
  // fresh either — same principle as blocked. Completed observations + ingestion-conditional
  // gaps are NOT listed, so they fall through to normal TTL behavior below.
  const recoverable = RECOVERABLE_GAP_REASONS[row.status];
  if (recoverable && recoverable.has(reasonOf(row))) return true;
  const ageMs = now - row.gathered_at;
  return ageMs > ttlDays * 24 * 60 * 60 * 1000;
}
