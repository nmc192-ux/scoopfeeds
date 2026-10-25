/**
 * 042 — event_slug_aliases (#179, slug follows headline).
 *
 * When an event's lead headline moves to a different story, the promoter (behind
 * EVENT_SLUG_FOLLOWS_HEADLINE) mints a new slug. The old slug lands here so the
 * dossier API and the /events/:slug page answer it with a 301 to the current one,
 * and uniqueSlug() never hands it to a different event.
 *
 * Additive: a new table and an index. Nothing existing is read, changed or
 * removed. Idempotent.
 */

export const id = "042_event_slug_aliases";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_slug_aliases (
      slug        TEXT PRIMARY KEY,
      event_id    TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_slug_aliases_event ON event_slug_aliases(event_id);
  `);
}
