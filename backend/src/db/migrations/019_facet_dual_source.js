/**
 * Migration 019: event_facets dual-source columns + old-scheme truncate — A5 Phase 2.
 *
 * The Phase-2 revised design (docs/specs/a5_event_facets_design.md, post-spike) replaces
 * the Phase-1 raw-breaker-subs scheme (tau 0.78, anchor included, ungated) with a
 * render-ready pipeline: DUAL SOURCE (tombstone-derived + EVENT_FACET_TAU sub-clusters),
 * earn-render gates applied at write time, member-overlap dedup, hybrid mechanical labels.
 *
 * New columns:
 *   source        'tau' | 'tombstone' — which source produced the facet
 *   label_entity  ENT eyebrow label (top distinctive core entities, display-safe)
 *   core_idf_mass idf mass of the facet's coherent core (gate evidence, diagnostics)
 *   share         facet size / event member count at write time (gate evidence)
 *
 * TRUNCATE (DrJ-approved): rows written under the Phase-1 scheme (breaker tau 0.78, raw)
 * are not comparable to the new pipeline's render-ready rows — delete them; the next
 * breaker sweep repopulates under the new scheme. Additive tables, cheap recompute.
 */

export const id = "019_facet_dual_source";

export function up(db) {
  db.exec(`
    DELETE FROM event_facet_articles;
    DELETE FROM event_facets;
    ALTER TABLE event_facets ADD COLUMN source        TEXT NOT NULL DEFAULT 'tau';
    ALTER TABLE event_facets ADD COLUMN label_entity  TEXT;
    ALTER TABLE event_facets ADD COLUMN core_idf_mass REAL;
    ALTER TABLE event_facets ADD COLUMN share         REAL;
  `);
}
