/**
 * Tracker DAO — Phase B Sprint 1.2.
 *
 * Data-access layer for the Tracker Auto-Detection Engine v1. Sits on top
 * of Migration 005's tracker_instances + tracker_metric_revisions tables.
 * Per locked decision 1, this module owns JSON-shape validation of
 * tracker_instances.metrics — SQL enforces only the envelope (valid
 * template_type, status enum, FK integrity).
 *
 * Canonical data contract: docs/specs/tracker_metrics_json.md.
 *
 * Sprint 1.3 (detection engine) is the primary consumer. Sprint 1.5
 * (frontend) reads via list-* functions.
 *
 * Scope discipline: this module ships DAO functions + JSON validation
 * only. No detection logic, no scheduler hooks, no ingestion side-effects.
 */

import crypto from "crypto";
import { getDb } from "./database.js";

// ─── Template + vocabulary constants ───────────────────────────────────────
// Mirror docs/specs/tracker_metrics_json.md §2 and §6.3. Any change here
// MUST land in the spec doc and (for template_type additions) in a new
// migration per spec §6.2.

export const TEMPLATE_TYPES = Object.freeze([
  "conflict",
  "outbreak",
  "incident",
  "sports",
  "environmental",
  "election",
  "entertainment",
  "study",
]);

const METRIC_NAMES_BY_TEMPLATE = Object.freeze({
  conflict: new Set([
    "casualties_killed", "casualties_wounded", "casualties_missing",
    "displaced", "event_count", "geographic_scope", "escalation",
  ]),
  outbreak: new Set([
    "suspected_cases", "probable_cases", "confirmed_cases", "deaths",
    "cfr", "geographic_extent", "r0_rt", "who_designation", "testing_intensity",
  ]),
  incident: new Set([
    "casualties_killed", "casualties_injured", "casualties_missing",
    "people_affected", "cause_attribution", "economic_damage", "response_status",
  ]),
  sports: new Set([
    "score", "standings", "series_state", "key_stats",
    "fixture_schedule", "context", "milestones",
  ]),
  environmental: new Set([
    "magnitude_intensity", "affected_area", "affected_population",
    "casualties", "damage_estimate", "alert_level", "hazard_chain",
  ]),
  election: new Set([
    "votes_by_contestant", "seats", "turnout", "count_completion_pct",
    "race_called_by", "provisional_final_flag", "recount_dispute",
  ]),
  entertainment: new Set([
    "box_office_opening", "box_office_cumulative", "worldwide_total",
    "budget", "critical_reception", "audience_reception", "awards_milestones",
  ]),
  study: new Set([
    "finding_summary", "study_type", "sample_size", "effect_size",
    "peer_review_status", "replication_status", "coi",
  ]),
});

const CONFIDENCE_VOCAB_BY_TEMPLATE = Object.freeze({
  conflict:      new Set(["provisional", "disputed", "confirmed"]),
  outbreak:      new Set(["suspected", "probable", "confirmed"]),
  incident:      new Set(["preliminary", "investigating", "official-finding"]),
  sports:        new Set(["scheduled", "live", "final"]),
  environmental: new Set(["preliminary-reading", "revised", "confirmed"]),
  election:      new Set(["projected", "partial-count", "certified-official"]),
  entertainment: new Set(["estimated", "studio-reported", "final-actuals"]),
  study:         new Set(["preprint", "peer-reviewed", "replicated-or-consensus"]),
});

export const REVISION_REASONS = Object.freeze(new Set([
  "ingestion-update",
  "source-revision",
  "editorial-override",
  "retraction",
  "recount",
  "closeout",
]));

const STATUS_VALUES = Object.freeze(new Set(["active", "dormant", "archived"]));

// ─── Validation ────────────────────────────────────────────────────────────
// Per spec §1, the validator enforces structural minimum + per-template
// vocabulary conformance. It does NOT type-check the `value` payload against
// the metric's expected shape — that's Sprint 1.3 / DTO territory.

export class TrackerValidationError extends Error {
  constructor(message, { code, metricName } = {}) {
    super(message);
    this.name = "TrackerValidationError";
    this.code = code || "tracker_validation";
    if (metricName) this.metricName = metricName;
  }
}

function validateTemplateType(templateType) {
  if (!TEMPLATE_TYPES.includes(templateType)) {
    throw new TrackerValidationError(
      `unknown template_type "${templateType}" (allowed: ${TEMPLATE_TYPES.join(", ")})`,
      { code: "bad_template_type" }
    );
  }
}

function validateMetricBlock(metricName, block, templateType) {
  if (block === null || typeof block !== "object" || Array.isArray(block)) {
    throw new TrackerValidationError(
      `metric "${metricName}" block must be a JSON object`,
      { code: "bad_block_shape", metricName }
    );
  }
  if (!("value" in block)) {
    throw new TrackerValidationError(
      `metric "${metricName}" missing required field "value"`,
      { code: "missing_value", metricName }
    );
  }
  if (!("confidence" in block)) {
    throw new TrackerValidationError(
      `metric "${metricName}" missing required field "confidence"`,
      { code: "missing_confidence", metricName }
    );
  }
  const vocab = CONFIDENCE_VOCAB_BY_TEMPLATE[templateType];
  if (!vocab.has(block.confidence)) {
    throw new TrackerValidationError(
      `metric "${metricName}" confidence "${block.confidence}" not in ${templateType} vocabulary ` +
      `(allowed: ${[...vocab].join(", ")})`,
      { code: "bad_confidence", metricName }
    );
  }
}

export function validateMetrics(metrics, templateType) {
  validateTemplateType(templateType);
  if (metrics === null || typeof metrics !== "object" || Array.isArray(metrics)) {
    throw new TrackerValidationError(
      `metrics must be a JSON object keyed by metric_name`,
      { code: "bad_metrics_root" }
    );
  }
  const allowed = METRIC_NAMES_BY_TEMPLATE[templateType];
  for (const [metricName, block] of Object.entries(metrics)) {
    if (!allowed.has(metricName)) {
      throw new TrackerValidationError(
        `metric "${metricName}" not allowed for template_type "${templateType}" ` +
        `(allowed: ${[...allowed].join(", ")})`,
        { code: "unknown_metric", metricName }
      );
    }
    validateMetricBlock(metricName, block, templateType);
  }
}

// ─── Row hydration ─────────────────────────────────────────────────────────
// Parse the JSON columns on read so callers don't repeat the JSON.parse dance.

function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    metrics:                row.metrics ? JSON.parse(row.metrics) : {},
    template_meta:          row.template_meta ? JSON.parse(row.template_meta) : null,
    data_source_provenance: row.data_source_provenance ? JSON.parse(row.data_source_provenance) : null,
  };
}

function hydrateRevision(row) {
  if (!row) return null;
  return {
    ...row,
    prev_block: row.prev_block ? JSON.parse(row.prev_block) : null,
    new_block:  row.new_block  ? JSON.parse(row.new_block)  : null,
  };
}

// ─── CRUD: trackers ────────────────────────────────────────────────────────

/**
 * createTracker — insert a new tracker_instances row.
 *
 * Required: event_id, template_type, started_at. Per locked decision 7,
 * event_id MUST reference an existing events row (editorial seed creates
 * the event first, then the tracker).
 *
 * metrics defaults to {} on initial create — Sprint 1.3 detection engine
 * fills metrics on subsequent updateTrackerMetrics calls. Validation runs
 * on whatever shape is passed.
 */
export function createTracker({
  event_id,
  template_type,
  metrics = {},
  template_meta = null,
  data_source_provenance = null,
  parent_tracker_id = null,
  started_at,
} = {}) {
  if (!event_id) throw new TrackerValidationError("event_id required", { code: "missing_event_id" });
  if (!started_at) throw new TrackerValidationError("started_at required", { code: "missing_started_at" });
  validateMetrics(metrics, template_type);

  const id  = crypto.randomUUID();
  const now = Date.now();
  const db  = getDb();

  db.prepare(`
    INSERT INTO tracker_instances (
      id, event_id, template_type, status, metrics, template_meta,
      data_source_provenance, parent_tracker_id,
      started_at, last_updated_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    event_id,
    template_type,
    JSON.stringify(metrics),
    template_meta ? JSON.stringify(template_meta) : null,
    data_source_provenance ? JSON.stringify(data_source_provenance) : null,
    parent_tracker_id || null,
    started_at,
    started_at,
    now,
    now,
  );

  return getTracker(id);
}

export function getTracker(id) {
  if (!id) return null;
  return hydrate(getDb().prepare(`SELECT * FROM tracker_instances WHERE id = ?`).get(id));
}

export function listTrackersByEvent(event_id) {
  if (!event_id) return [];
  return getDb().prepare(`
    SELECT * FROM tracker_instances
    WHERE event_id = ?
    ORDER BY last_updated_at DESC
  `).all(event_id).map(hydrate);
}

export function listTrackersByType({
  template_type,
  status = "active",
  limit = 100,
} = {}) {
  validateTemplateType(template_type);
  if (!STATUS_VALUES.has(status)) {
    throw new TrackerValidationError(
      `unknown status "${status}" (allowed: ${[...STATUS_VALUES].join(", ")})`,
      { code: "bad_status" }
    );
  }
  return getDb().prepare(`
    SELECT * FROM tracker_instances
    WHERE template_type = ? AND status = ?
    ORDER BY last_updated_at DESC
    LIMIT ?
  `).all(template_type, status, limit).map(hydrate);
}

/**
 * updateTrackerMetrics — merge metric_updates into tracker.metrics and
 * write one tracker_metric_revisions row per updated metric. Atomic per
 * locked decision 2 (single transaction).
 *
 * metric_updates: { metric_name: <new block>, ... }
 * reason: must be one of REVISION_REASONS.
 * changed_at: optional override (defaults to Date.now()).
 *
 * Returns the rehydrated tracker row.
 */
export function updateTrackerMetrics(id, metric_updates, reason, changed_at = null) {
  if (!id) throw new TrackerValidationError("tracker id required", { code: "missing_id" });
  if (!metric_updates || typeof metric_updates !== "object" || Array.isArray(metric_updates)) {
    throw new TrackerValidationError("metric_updates must be a JSON object", { code: "bad_updates_shape" });
  }
  if (!REVISION_REASONS.has(reason)) {
    throw new TrackerValidationError(
      `unknown reason "${reason}" (allowed: ${[...REVISION_REASONS].join(", ")})`,
      { code: "bad_reason" }
    );
  }

  const db = getDb();
  const existing = db.prepare(`SELECT * FROM tracker_instances WHERE id = ?`).get(id);
  if (!existing) {
    throw new TrackerValidationError(`tracker "${id}" not found`, { code: "not_found" });
  }

  const templateType = existing.template_type;
  const prevMetrics  = existing.metrics ? JSON.parse(existing.metrics) : {};
  const newMetrics   = { ...prevMetrics, ...metric_updates };

  // Validate the merged result against the template — this catches new
  // metric_names that don't belong, bad confidence values, missing fields.
  validateMetrics(newMetrics, templateType);

  const ts = changed_at || Date.now();

  const apply = db.transaction(() => {
    db.prepare(`
      UPDATE tracker_instances
      SET metrics = ?, last_updated_at = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(newMetrics), ts, ts, id);

    const revStmt = db.prepare(`
      INSERT INTO tracker_metric_revisions
        (tracker_id, metric_name, prev_block, new_block, reason, changed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const [metricName, newBlock] of Object.entries(metric_updates)) {
      const prevBlock = Object.prototype.hasOwnProperty.call(prevMetrics, metricName)
        ? JSON.stringify(prevMetrics[metricName])
        : null;
      revStmt.run(
        id,
        metricName,
        prevBlock,
        JSON.stringify(newBlock),
        reason,
        ts,
      );
    }
  });
  apply();

  return getTracker(id);
}

/**
 * archiveTracker — flip status to 'archived' and stamp closed_at. Does NOT
 * write a tracker_metric_revisions row: closeout is a status change, not a
 * metric change, and a synthetic __closeout__ metric_name would violate the
 * spec's "metric_name ∈ template's set" rule. Sprint 1.5's audit panel can
 * UNION status changes into its display timeline if it wants closeout shown
 * chronologically alongside revisions.
 *
 * Per locked decision 4, archived is distinct from events.resolved —
 * trackers can outlive event resolution (e.g., NTSB final report dropping
 * years after the underlying event closes). The 'closeout' enum value
 * stays in tracker_metric_revisions.reason for future legitimate use (e.g.,
 * a final ingestion sweep at archive time that updates one last metric).
 */
export function archiveTracker(id, closed_at = null) {
  if (!id) throw new TrackerValidationError("tracker id required", { code: "missing_id" });
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM tracker_instances WHERE id = ?`).get(id);
  if (!existing) {
    throw new TrackerValidationError(`tracker "${id}" not found`, { code: "not_found" });
  }
  const ts = closed_at || Date.now();
  db.prepare(`
    UPDATE tracker_instances
    SET status = 'archived', closed_at = ?, last_updated_at = ?, updated_at = ?
    WHERE id = ?
  `).run(ts, ts, ts, id);

  return getTracker(id);
}

// ─── Revisions ─────────────────────────────────────────────────────────────

export function listTrackerRevisions(tracker_id, { metric_name = null, limit = 100 } = {}) {
  if (!tracker_id) return [];
  const db = getDb();
  if (metric_name) {
    return db.prepare(`
      SELECT * FROM tracker_metric_revisions
      WHERE tracker_id = ? AND metric_name = ?
      ORDER BY changed_at DESC
      LIMIT ?
    `).all(tracker_id, metric_name, limit).map(hydrateRevision);
  }
  return db.prepare(`
    SELECT * FROM tracker_metric_revisions
    WHERE tracker_id = ?
    ORDER BY changed_at DESC
    LIMIT ?
  `).all(tracker_id, limit).map(hydrateRevision);
}
