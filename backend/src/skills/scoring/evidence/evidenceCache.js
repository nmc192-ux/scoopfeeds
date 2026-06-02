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

/**
 * isStale — true if there is no cached row, or it is older than ttlDays.
 * Drives "re-gather only when stale" in the weekly run.
 */
export function isStale(row, ttlDays, now) {
  if (!row) return true;
  const ageMs = now - row.gathered_at;
  return ageMs > ttlDays * 24 * 60 * 60 * 1000;
}
