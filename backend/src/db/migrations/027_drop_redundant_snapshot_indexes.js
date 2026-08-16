/**
 * 027 — drop two snapshot indexes that duplicate their table's PRIMARY KEY.
 *
 * `reality_index_snapshots` and `sentiment_snapshots` each declare a non-INTEGER
 * PRIMARY KEY, which SQLite backs with an automatic unique index. Both tables
 * then also declare an explicit index over the same leading columns:
 *
 *   reality_index_snapshots  PK (scope, scope_id, ts)
 *   idx_ris_scope_ts            (scope, scope_id, ts DESC)     <- same columns
 *
 *   sentiment_snapshots      PK (scope, scope_id, ts, source)
 *   idx_sent_scope_ts           (scope, scope_id, ts DESC)     <- a PK prefix
 *
 * The DESC buys nothing: SQLite scans an index in either direction.
 *
 * MEASURED, NOT REASONED (2026-08-16, on a 6.6GB prod snapshot via dbstat):
 *
 *   sqlite_autoindex_reality_index_snapshots_1   611.7 MB   (the PK)
 *   idx_ris_scope_ts                             611.7 MB   <- byte-identical
 *   sqlite_autoindex_sentiment_snapshots_1       684.1 MB   (the PK)
 *   idx_sent_scope_ts                            615.9 MB
 *
 * 1,227 MB in that snapshot; ~2.8 GB of the 15 GB these tables occupy in prod.
 *
 * AND THEY MADE READS SLOWER. Dropping each on a copy and re-timing the real DAO
 * queries:
 *
 *   drop idx_ris_scope_ts    latest -13%   history  -7%   topTruthGap -87%
 *   drop idx_sent_scope_ts   latest -24%   history -10%   bySource    -31%
 *
 * Every query got faster. The planner falls back to the PK autoindex, which has
 * the same columns — and on topTruthGap the redundant index had been actively
 * MISLEADING it away from idx_ris_truth_gap, which is the index that query
 * actually wants. That -87% is the cost of keeping a duplicate around.
 *
 * THE OTHER TWO INDEXES STAY. idx_ris_truth_gap (233 MB) is the only index
 * serving topTruthGap, and idx_sent_source (224 MB) is the only one serving the
 * by-source volume query. Both earn their place; this migration does not touch
 * them.
 *
 * REVERSIBLE. Recreating either index is one CREATE INDEX — the statements are
 * in `down` below, unused by the runner but kept as the exact rollback. Nothing
 * is deleted except index pages; no row of data is touched.
 *
 * The freed pages do NOT return to the OS on their own (auto_vacuum=0). A VACUUM
 * is what reclaims them, and is deliberately not done here: VACUUM inside a
 * migration would block startup for minutes on an 18GB file. See
 * docs/reference/env_reference.md on ENABLE_SQLITE_VACUUM, which stays off.
 */

export const id = "027_drop_redundant_snapshot_indexes";

const REDUNDANT = [
  // [index, the table whose PRIMARY KEY already covers it]
  ["idx_ris_scope_ts", "reality_index_snapshots"],
  ["idx_sent_scope_ts", "sentiment_snapshots"],
];

export function up(db) {
  for (const [index, table] of REDUNDANT) {
    // These tables come from realityIndex/schema.js:initRealityIndex, which
    // bootstrapSchema guarantees has run first. Checked anyway: a migration that
    // assumes a table it did not create is one restore-from-partial-backup away
    // from failing the whole run.
    const t = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
    if (!t) continue;
    db.prepare(`DROP INDEX IF EXISTS ${index}`).run();
  }
}

/**
 * The exact rollback, if a query is ever found that genuinely needs one of these.
 * Not called by the runner (migrations here are forward-only); present so the
 * statement does not have to be reconstructed from the schema under pressure.
 */
export const down = [
  "CREATE INDEX IF NOT EXISTS idx_ris_scope_ts ON reality_index_snapshots(scope, scope_id, ts DESC)",
  "CREATE INDEX IF NOT EXISTS idx_sent_scope_ts ON sentiment_snapshots(scope, scope_id, ts DESC)",
];
