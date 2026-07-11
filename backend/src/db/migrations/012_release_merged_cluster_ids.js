/**
 * Migration 012: release cluster_id claims held by merged tombstone events.
 *
 * ROOT CAUSE (found 2026-07-11 while chasing promoted=0). Cluster identity is a
 * title hash (sha256(anchor.title)[:16]), so recurring anchor titles reproduce
 * the same cluster_id across days. The merge path set status='merged' but kept
 * the event's cluster_id — and merged events are excluded from the promoter's
 * match-candidate set. Result: the tombstone squats the identity forever; every
 * later recurrence of that title-hash fails to match AND collides on INSERT
 * (UNIQUE events.cluster_id). On prod this reached ~290 collisions per cycle,
 * promoted=0, and zero new events for days.
 *
 * This migration NULLs cluster_id on merged events (the UNIQUE index is partial,
 * WHERE cluster_id IS NOT NULL, so multiple NULLs are fine). Their id/slug/
 * dossier/meta are untouched. Idempotent — re-running updates nothing new.
 *
 * The recurrence is fixed in the same commit: markMerged now clears cluster_id,
 * and the promoter's insert path reclaims a squatted id from any still-standing
 * holder (hollow or gate-rejected) instead of throwing.
 */

export const id = "012_release_merged_cluster_ids";

export function up(db) {
  db.exec(`
    UPDATE events SET cluster_id = NULL
    WHERE status = 'merged' AND cluster_id IS NOT NULL;
  `);
}
