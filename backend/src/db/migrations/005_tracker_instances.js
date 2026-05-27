/**
 * Migration 005: tracker_instances + tracker_metric_revisions.
 *
 * Phase B Sprint 1.2 — data layer for the Tracker Auto-Detection Engine v1.
 * Derived from the 8 markdown templates shipped in Sprint 1.1 / 1.1.3
 * (docs/content/tracker_templates/*.md); the per-template metric names +
 * confidence vocabulary + block-shape rules live in the canonical spec at
 * docs/specs/tracker_metrics_json.md and are enforced at the DAO layer
 * (backend/src/models/trackers.js), not in SQL CHECK constraints. Per DrJ
 * locked decision 1, SQL enforces only the envelope (valid template_type,
 * status enum, FK integrity); per-template metric-block conformance lives
 * in DAO-layer validation. Per decision 5, template_type is an inline
 * CHECK list — adding a 9th template requires a migration.
 *
 * tracker_instances
 * -----------------
 * - id                     UUID, app-side generated (TEXT PK like events).
 * - event_id               FK to events(id). NOT NULL per locked decision 7
 *                          (editorial seed must promote an event first; no
 *                          nullable-FK backfill mess). CASCADE on delete.
 * - template_type          8-value CHECK enum mirroring the Sprint 1.1
 *                          template set.
 * - status                 'active' | 'dormant' | 'archived'. Distinct from
 *                          events.status ('active'|'dormant'|'resolved')
 *                          per locked decision 4 — trackers outlive event
 *                          resolution (e.g., NTSB final report years after
 *                          the underlying event is "resolved").
 * - metrics                JSON map keyed by metric_name. Each block carries
 *                          the Option-3 triple {value, confidence, source}
 *                          plus per-template special-case fields (parties[]
 *                          for disputed conflict, scale for environmental
 *                          magnitude, derived:false for outbreak relay-only
 *                          fields, etc.). Canonical spec in
 *                          docs/specs/tracker_metrics_json.md.
 * - template_meta          JSON for tracker-level qualifiers that are not
 *                          metrics — conflict_type, electoral_system,
 *                          pathogen, validating_authority, hazard_kind,
 *                          evidence_badge, fixture_kind, title_kind. Per
 *                          spec §4.
 * - data_source_provenance JSON for per-metric provenance + ingester-gap
 *                          flags (election and study templates ship with
 *                          documented data-source gaps — those gaps land
 *                          here, surfaced on the tracker, not hidden).
 * - parent_tracker_id      Self-FK for fixture_group (sports), multi-front
 *                          conflicts, multi-hazard chains, outbreak
 *                          pathogen-family umbrellas. ON DELETE SET NULL
 *                          so deleting a parent does not cascade-destroy
 *                          children.
 * - started_at             Tracker birth (may equal event started_at, may
 *                          differ when an event was already running).
 * - last_updated_at        Last metric write; drives "as-of" display.
 * - closed_at              Set when status flips to archived; NULL otherwise.
 * - created_at, updated_at Audit timestamps (mirroring events).
 *
 * Indexes:
 *   idx_tracker_instances_event   — listTrackersByEvent
 *   idx_tracker_instances_type    — listTrackersByType (template + status filter)
 *   idx_tracker_instances_status  — generic status scan
 *   idx_tracker_instances_parent  — children-of-parent lookup (partial)
 *   idx_tracker_instances_active  — partial index for the hot "active"
 *                                   list (Layer 1 card surface)
 *
 * tracker_metric_revisions
 * ------------------------
 * Per locked decision 2 — separate table (not in-JSON history arrays) so
 * revisions are first-class queryable: how many times was cause-attribution
 * revised? when did this magnitude get bumped from M6.8 → M7.2? Editorial
 * overrides land here too (per locked decision 8) via
 * reason='editorial-override', so no dedicated overrides table needed.
 *
 * - id            AUTOINCREMENT PK (revisions are write-once, ordered).
 * - tracker_id    FK to tracker_instances(id). CASCADE on delete.
 * - metric_name   Which key in tracker_instances.metrics changed.
 * - prev_block    JSON snapshot before the change. NULL on first set
 *                 (no prior state to capture).
 * - new_block     JSON snapshot after. NOT NULL.
 * - reason        6-value CHECK enum naming the change cause.
 * - changed_at    Server-time of the change.
 *
 * Indexes:
 *   idx_tracker_metric_revisions_tracker_ts — per-tracker timeline
 *   idx_tracker_metric_revisions_metric     — per-metric history
 *
 * Naming-collision note: backend/src/realityIndex/intelligence/eventTracker.js
 * already exists and does *cluster → Event promotion*, not the strategic
 * Tracker concept this migration introduces. The naming overlap is captured
 * in Phase B Finding #90 with the rename deferred to Sprint 1.3 per locked
 * decision (Sprint 1.2 ships schema only; rename is out of scope here).
 *
 * Refs: Sprint 1.2 plan in phase_b_retrospective_inputs.md; 8 template
 * design specs at docs/content/tracker_templates/; canonical JSON spec at
 * docs/specs/tracker_metrics_json.md; events table created via
 * realityIndex/schema.js initRealityIndex (NOT a migration).
 */

export const id = "005_tracker_instances";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracker_instances (
      id                       TEXT PRIMARY KEY,
      event_id                 TEXT NOT NULL,
      template_type            TEXT NOT NULL CHECK (template_type IN (
                                 'conflict', 'outbreak', 'incident', 'sports',
                                 'environmental', 'election', 'entertainment', 'study'
                               )),
      status                   TEXT NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'dormant', 'archived')),
      metrics                  TEXT NOT NULL DEFAULT '{}',
      template_meta            TEXT,
      data_source_provenance   TEXT,
      parent_tracker_id        TEXT,
      started_at               INTEGER NOT NULL,
      last_updated_at          INTEGER NOT NULL,
      closed_at                INTEGER,
      created_at               INTEGER NOT NULL,
      updated_at               INTEGER NOT NULL,
      FOREIGN KEY (event_id)          REFERENCES events(id)            ON DELETE CASCADE,
      FOREIGN KEY (parent_tracker_id) REFERENCES tracker_instances(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tracker_instances_event  ON tracker_instances(event_id);
    CREATE INDEX IF NOT EXISTS idx_tracker_instances_type   ON tracker_instances(template_type, status, last_updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tracker_instances_status ON tracker_instances(status, last_updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tracker_instances_parent ON tracker_instances(parent_tracker_id) WHERE parent_tracker_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tracker_instances_active ON tracker_instances(last_updated_at DESC) WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS tracker_metric_revisions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tracker_id   TEXT NOT NULL,
      metric_name  TEXT NOT NULL,
      prev_block   TEXT,
      new_block    TEXT NOT NULL,
      reason       TEXT NOT NULL CHECK (reason IN (
                     'ingestion-update', 'source-revision', 'editorial-override',
                     'retraction', 'recount', 'closeout'
                   )),
      changed_at   INTEGER NOT NULL,
      FOREIGN KEY (tracker_id) REFERENCES tracker_instances(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tracker_metric_revisions_tracker_ts ON tracker_metric_revisions(tracker_id, changed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tracker_metric_revisions_metric     ON tracker_metric_revisions(tracker_id, metric_name, changed_at DESC);
  `);
}
