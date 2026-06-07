/**
 * scoringDao.js — sources-table read/write for the scoring service.
 *
 * Reads source identity + previous score; writes the five Migration 002
 * quality columns (quality_score, quality_score_components, source_posture,
 * quality_score_methodology_version, quality_score_last_updated). Mirrors the
 * better-sqlite3 house pattern (models/*.js): getDb().prepare(...).get/run,
 * JSON columns hydrated/serialized at the boundary.
 *
 * Skill-isolation note (Q2 — minimal contract): this skill OWNS source-scoring
 * writes, but reaches the shared `sources` table via the existing canonical DB
 * handle (models/database.js getDb) rather than a private connection. Full
 * physical data isolation (Skills Arch v1 §5 "skills handle their own data")
 * is a later-phase concern; for now the skill is folder-isolated and
 * reads/writes the shared schema through the canonical handle. This is the one
 * sanctioned reach OUT of the skill folder (into models/database.js) and is
 * documented in README.md as a deliberate v1 simplification.
 */

import { getDb } from "../../models/database.js";

const READ_SQL = `
  SELECT id, name, url, channel_id, source_type, category, region,
         quality_score, quality_score_components, source_posture,
         quality_score_methodology_version, quality_score_last_updated
  FROM sources
  WHERE id = ?
`;

/**
 * getSourceForScoring — read a source's identity + previous score.
 * Returns null if the id doesn't resolve. quality_score_components is
 * JSON-hydrated.
 */
export function getSourceForScoring(id, db = getDb()) {
  if (id == null) return null;
  const row = db.prepare(READ_SQL).get(id);
  if (!row) return null;
  return {
    ...row,
    quality_score_components: row.quality_score_components
      ? JSON.parse(row.quality_score_components)
      : null,
  };
}

const WRITE_SQL = `
  UPDATE sources
     SET quality_score                     = ?,
         quality_score_components          = ?,
         source_posture                    = ?,
         quality_score_methodology_version = ?,
         quality_score_last_updated        = ?,
         updated_at                        = ?
   WHERE id = ?
`;

/**
 * writeSourceScore — persist a computed score to the sources table.
 *
 * @param {number} id
 * @param {object} score
 * @param {number} score.quality_score        Combined 0–100.
 * @param {object} score.components           {ET,MT,DE,Ind,HA} sub-scores (stored as JSON).
 * @param {string} [score.posture]            One of the 8 posture labels.
 * @param {string} [score.methodology_version]
 * @param {number} [score.scored_at]          Unix ms; defaults to now.
 * @param {object} [db]                        Connection handle (default canonical getDb()).
 * @returns {number} rows updated (0 if id doesn't exist).
 *
 * `quality_score` may be NULL for an evaluated-but-insufficient source: writing NULL while
 * still stamping `quality_score_last_updated` (= scored_at) is what distinguishes
 * "evaluated → insufficient-data" (last_updated SET) from "never evaluated" (last_updated NULL).
 */
export function writeSourceScore(id, {
  quality_score,
  components,
  posture,
  methodology_version,
  scored_at = Date.now(),
} = {}, db = getDb()) {
  if (id == null) throw new Error("writeSourceScore: id required");
  const info = db.prepare(WRITE_SQL).run(
    quality_score ?? null,
    components ? JSON.stringify(components) : null,
    posture ?? null,
    methodology_version ?? null,
    scored_at,
    scored_at,
    id,
  );
  return info.changes;
}

const AUDIT_INSERT_SQL = `
  INSERT INTO scoring_audit_log
    (source_id, scoring_run_id, methodology_version, component_scores, posture_label,
     combined_score, reasoning_per_subcriterion, confidence_per_subcriterion,
     override_present, override_rationale, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * insertAuditLog — append one immutable scoring_audit_log row (migration 006).
 * Objects in JSON-shaped columns are serialized at the boundary; strings pass through.
 * `combined_score` is NULL for an insufficient-data run; `override_present`=1 records that
 * a human override is in effect and the automated score was NOT written to `sources`.
 *
 * @returns {number|bigint} the new row id.
 */
export function insertAuditLog(row = {}, db = getDb()) {
  if (row.source_id == null) throw new Error("insertAuditLog: source_id required");
  if (!row.scoring_run_id) throw new Error("insertAuditLog: scoring_run_id required");
  if (!row.methodology_version) throw new Error("insertAuditLog: methodology_version required");
  const ser = (v) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));
  const info = db.prepare(AUDIT_INSERT_SQL).run(
    row.source_id,
    row.scoring_run_id,
    row.methodology_version,
    ser(row.component_scores),
    row.posture_label ?? null,
    row.combined_score ?? null,
    ser(row.reasoning_per_subcriterion),
    ser(row.confidence_per_subcriterion),
    row.override_present ? 1 : 0,
    row.override_rationale ?? null,
    row.created_at ?? Date.now(),
  );
  return info.lastInsertRowid;
}

const LATEST_OVERRIDE_SQL = `
  SELECT id, scoring_run_id, combined_score, override_present, override_rationale, created_at
  FROM scoring_audit_log
  WHERE source_id = ? AND override_present = 1
  ORDER BY created_at DESC, id DESC
  LIMIT 1
`;

/**
 * getLatestOverride — most recent audit row carrying a human override for a source, or null.
 * Read-only forward-guard: callers must NOT clobber `sources.quality_score` when this returns
 * a row. (No override rows exist yet; this is a guard for when override-WRITE lands.)
 */
export function getLatestOverride(sourceId, db = getDb()) {
  if (sourceId == null) return null;
  return db.prepare(LATEST_OVERRIDE_SQL).get(sourceId) || null;
}
