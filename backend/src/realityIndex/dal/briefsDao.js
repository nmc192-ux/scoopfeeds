/**
 * briefsDao — read/write helpers for generated_briefs.
 *
 * Statuses: draft → reviewed → published, OR draft → rejected.
 * v1 invariant (plan §5J): no path from draft to published without an
 * editor's manual approval. The generator only ever writes status='draft'.
 */

import { getDb } from "../../models/database.js";

const ALLOWED_STATUSES = new Set(["draft", "reviewed", "published", "rejected"]);

export function insertBrief({
  slug, event_id = null, cluster_id = null,
  title, thesis, body_md, body_html = null,
  evidence_json, confidence = null, ri_snapshot_ts = null,
  provider = null, model = null,
}) {
  return getDb().prepare(`
    INSERT INTO generated_briefs
      (slug, event_id, cluster_id, title, thesis, body_md, body_html,
       evidence_json, confidence, ri_snapshot_ts, provider, model,
       status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
  `).run(
    slug, event_id, cluster_id,
    title, thesis, body_md, body_html,
    typeof evidence_json === "string" ? evidence_json : JSON.stringify(evidence_json || []),
    confidence, ri_snapshot_ts, provider, model,
    Date.now(),
  );
}

export function getBriefById(id) {
  return getDb().prepare("SELECT * FROM generated_briefs WHERE id = ?").get(id);
}

export function getBriefBySlug(slug) {
  return getDb().prepare("SELECT * FROM generated_briefs WHERE slug = ?").get(slug);
}

export function listBriefs({ status = null, limit = 30, offset = 0 } = {}) {
  let sql = "SELECT * FROM generated_briefs WHERE 1=1";
  const params = [];
  if (status) { sql += " AND status = ?"; params.push(status); }
  sql += " ORDER BY COALESCE(published_at, created_at) DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  return getDb().prepare(sql).all(...params);
}

export function setBriefStatus(id, status, { reviewer_note = null } = {}) {
  if (!ALLOWED_STATUSES.has(status)) throw new Error(`invalid status: ${status}`);
  const now = Date.now();
  const isPublishing = status === "published";
  return getDb().prepare(`
    UPDATE generated_briefs
    SET status = ?,
        reviewer_note = COALESCE(?, reviewer_note),
        reviewed_at = ?,
        published_at = CASE WHEN ? = 1 THEN ? ELSE published_at END
    WHERE id = ?
  `).run(status, reviewer_note, now, isPublishing ? 1 : 0, now, id);
}

export function alreadyHasRecentDraft(eventId, withinMs = 24 * 60 * 60 * 1000) {
  if (!eventId) return false;
  const since = Date.now() - withinMs;
  return !!getDb().prepare(
    "SELECT 1 FROM generated_briefs WHERE event_id = ? AND created_at >= ? LIMIT 1"
  ).get(eventId, since);
}
