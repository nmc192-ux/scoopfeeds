/**
 * pipelineHealth — data-derived liveness for the ingest→embed→cluster→promote chain.
 *
 * Born from three consecutive silent outages where every process LOOKED healthy while
 * the pipeline was dead: the vec0 regression (scheduler couldn't cluster), the BullMQ
 * singleton-dedup trap ("Enqueued" logged every 30 min, nothing executed for days), and
 * the vecAvailable per-process flag (worker ingested articles with embedDocument
 * silently no-oping). In each case the homepage served 200 and logs looked green.
 *
 * Principle: liveness is derived from the DATABASE, not from in-process counters or
 * queue logs — the DB is the one place a cross-process lie can't hide. Each stage
 * reports the newest artifact it should be producing; a stage is stale when that
 * artifact is older than its threshold (sized ~3× the stage's normal cadence).
 *
 * Read-only, cheap (MAX over small/indexed tables), and defensive: any per-stage query
 * failure reports as { error } rather than throwing — the health endpoint must never
 * 500 because of its own diagnostics.
 */
import { isVecAvailable } from "../realityIndex/schema.js";

const MIN = 60 * 1000;
const STAGES = [
  // name        query (MAX-timestamp of the stage's newest artifact)                                        threshold
  ["ingest",     "SELECT MAX(fetched_at) t FROM articles",                                                   45 * MIN],
  ["embed",      "SELECT MAX(created_at) t FROM embedding_meta WHERE scope = 'article'",                     45 * MIN],
  ["extraction", "SELECT MAX(processed_at) t FROM article_entity_processed",                                 45 * MIN],
  ["clusters",   "SELECT MAX(updated_at) t FROM story_clusters",                                             5 * 60 * MIN], // analysis cron is 2-hourly; alert after 2 missed cycles
  // matching refreshes last_activity_at every promoter cycle (30 min); creation is
  // legitimately bursty (a quiet news day can gap for hours), hence the wide threshold.
  ["event_activity", "SELECT MAX(last_activity_at) t FROM events",                                           2 * 60 * MIN],
  ["event_creation", "SELECT MAX(created_at) t FROM events",                                                 24 * 60 * MIN],
];

export function getPipelineHealth(db) {
  const now = Date.now();
  const out = { ok: true, vec_available: isVecAvailable() };
  if (!out.vec_available) out.ok = false;
  for (const [name, sql, staleMs] of STAGES) {
    try {
      const t = db.prepare(sql).get()?.t ?? null;
      const age_min = t == null ? null : Math.round((now - t) / MIN);
      const stale = t == null || now - t > staleMs;
      out[name] = { newest: t == null ? null : new Date(t).toISOString(), age_min, stale };
      if (stale) out.ok = false;
    } catch (err) {
      out[name] = { error: err.message };
      out.ok = false;
    }
  }
  try {
    // graph hygiene: orphaned event links (self-heals at the 03:00 prune; expect ~0)
    out.dangling_links = db.prepare(
      "SELECT COUNT(*) c FROM event_articles ea WHERE NOT EXISTS (SELECT 1 FROM articles a WHERE a.id = ea.article_id)"
    ).get().c;
  } catch (err) {
    out.dangling_links = null;
  }
  return out;
}
