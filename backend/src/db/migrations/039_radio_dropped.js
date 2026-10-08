/**
 * 039 — radio_dropped: every story ScoopFeeds Radio's gate refused, kept 14 days.
 *
 * WHY A TABLE. The D1 gate fails closed (radio/radioRules.js): an LLM judge error
 * drops the story rather than airing it. A gate that drops silently cannot be
 * reviewed, so DrJ reads this table weekly to see what was refused and why
 * (rule + reason), and to spot a rule that is over-blocking.
 *
 * article_id OR event_id: R2 sources articles; event_id is reserved for when the
 * event graph is live again and radio can rank events directly.
 *
 * Pruned by the radio cycle itself (pruneDrops, 14 days). Logged at most once per
 * (article, rule) per 24 h, so a 5-minute cadence cannot bloat it.
 * NO FOREIGN KEY: the 7-day article prune must not be blocked by, or cascade into,
 * a review log that outlives it by a week.
 *
 * Idempotent: CREATE … IF NOT EXISTS throughout.
 */

export const id = "039_radio_dropped";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS radio_dropped (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id  TEXT,
      event_id    TEXT,
      title       TEXT,
      source      TEXT,
      rule        TEXT NOT NULL,      -- d1:category | d1:term | radio:pk-politics-names | radio:indian-outlet-pk | radio:critical-of-pk | radio:judge
      reason      TEXT,
      created_at  INTEGER NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_radio_dropped_created ON radio_dropped(created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_radio_dropped_article_rule ON radio_dropped(article_id, rule, created_at);`);
}
