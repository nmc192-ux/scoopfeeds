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
export function getSourceForScoring(id) {
  if (id == null) return null;
  const row = getDb().prepare(READ_SQL).get(id);
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
 * @returns {number} rows updated (0 if id doesn't exist).
 */
export function writeSourceScore(id, {
  quality_score,
  components,
  posture,
  methodology_version,
  scored_at = Date.now(),
} = {}) {
  if (id == null) throw new Error("writeSourceScore: id required");
  const info = getDb().prepare(WRITE_SQL).run(
    quality_score,
    components ? JSON.stringify(components) : null,
    posture ?? null,
    methodology_version ?? null,
    scored_at,
    scored_at,
    id,
  );
  return info.changes;
}
