/**
 * 031 — stock_asset_usage: when each curated cutaway was last on screen.
 *
 * WHY THIS IS IN THE DATABASE AND THE LIBRARY IS NOT. The manifest is DATA
 * written by an operator toolchain on another machine and synced here read-only;
 * it is the same on every box and nothing at runtime may write to it. This table
 * is the opposite: mutable state produced by rendering, local to this
 * installation, and meaningless anywhere else. Keeping the two apart is what
 * lets the library be re-synced at any time without losing rotation history, and
 * lets rotation history survive a library re-sync.
 *
 * WHAT IT BUYS. Selection prefers the least-recently-used asset so the same clip
 * does not open two videos in a row. With a few assets per subject class that is
 * the difference between a library that reads as a library and one that reads as
 * a single clip someone likes.
 *
 * NO FOREIGN KEY, deliberately, following video_posts and longform_posts. There
 * is nothing in this database to reference — the assets live in a JSON manifest
 * on disk. A row whose asset has since been curated out is harmless: selection
 * only ever reads usage for assets the manifest still offers, so a stale row is
 * ignored rather than wrong. Rows are keyed on the manifest's own asset id.
 */

export const id = "031_stock_asset_usage";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_asset_usage (
      asset_id     TEXT PRIMARY KEY,
      last_used_at INTEGER NOT NULL,
      uses         INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Selection reads the whole table (tens of rows, not thousands) and sorts in
  // JS, so this index is for the ops question — "what has been used lately" —
  // rather than for the hot path.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_asset_usage_last
           ON stock_asset_usage(last_used_at DESC);`);
}
