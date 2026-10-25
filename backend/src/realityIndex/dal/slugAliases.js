/**
 * Slug aliases (#179). A slug an event used to carry → that event's CURRENT slug.
 * Resolved through event_id, never by chaining old slugs, so an event renamed
 * twice still answers both old slugs in one hop. Read-only.
 */
export function resolveSlugAlias(db, slug) {
  if (!slug) return null;
  try {
    const row = db.prepare(`
      SELECT e.slug FROM event_slug_aliases a JOIN events e ON e.id = a.event_id
      WHERE a.slug = ? AND e.slug <> a.slug
    `).get(slug);
    return row?.slug ?? null;
  } catch {
    return null; // table absent (migration 042 not applied) → no aliases
  }
}
