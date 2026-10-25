/**
 * machineEvents — the one definition of "machine event" (USGS quakes, NOAA alerts).
 *
 * These are structured live-feed rows: no cluster, no articles, written straight into
 * `events` by realityIndex/ingest/geo/*. They have twice consumed selection windows meant
 * for news ("freshest N events"), so reader lists, social/video/radio/newsletter selection
 * and the per-cycle scorers exclude them by default. Surfaces that want them (the world
 * map, trackers) simply do not apply this guard.
 *
 * Identified by `meta.source`, which both fetchers write — NOT by slug prefix (a news
 * event can legitimately be slugged "noaa-budget-cuts") and NOT by category (those are
 * ordinary category names). No schema change and no backfill: existing rows qualify as-is.
 */

export const MACHINE_EVENT_SOURCES = ["usgs", "noaa"];

/**
 * SQL predicate that is true for every event that is NOT a machine event.
 * `alias` is the events table alias in the caller's query.
 */
export function notMachineEventSql(alias = "events") {
  const list = MACHINE_EVENT_SOURCES.map((s) => `'${s}'`).join(",");
  return `(${alias}.meta IS NULL OR NOT json_valid(${alias}.meta) `
    + `OR COALESCE(json_extract(${alias}.meta, '$.source'), '') NOT IN (${list}))`;
}

/** JS twin of the predicate, for rows already in memory. */
export function isMachineEvent(row) {
  if (!row?.meta) return false;
  try {
    const m = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
    return MACHINE_EVENT_SOURCES.includes(m?.source);
  } catch { return false; }
}
