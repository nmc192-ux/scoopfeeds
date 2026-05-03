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

/**
 * Per-category brief approval rates over the last `daysBack` days.
 *
 * approval_rate = published / (published + rejected)  — drafts and 'reviewed'
 * are in-flight and don't count toward the decided rate. We also return
 * pending so editors can see backlog per topic.
 *
 * Per plan §5J: this is the calibration benchmark feeding the future
 * auto-publication gate. Threshold for auto-promotion is NOT applied here
 * — this DAL is read-only.
 *
 * Returns: [{ category, published, rejected, pending, decided, approval_rate, avg_confidence_published }]
 * Sorted by `decided` DESC so well-sampled categories surface first.
 */
export function getBriefApprovalRates({ daysBack = 90 } = {}) {
  const since = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  return getDb().prepare(`
    SELECT
      COALESCE(e.category, 'uncategorized') AS category,
      SUM(CASE WHEN b.status = 'published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN b.status = 'rejected'  THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN b.status IN ('draft', 'reviewed') THEN 1 ELSE 0 END) AS pending,
      AVG(CASE WHEN b.status = 'published' THEN b.confidence END) AS avg_confidence_published
    FROM generated_briefs b
    LEFT JOIN events e ON e.id = b.event_id
    WHERE b.created_at >= ?
    GROUP BY COALESCE(e.category, 'uncategorized')
  `).all(since).map(r => {
    const decided = (r.published || 0) + (r.rejected || 0);
    return {
      category: r.category,
      published: r.published || 0,
      rejected:  r.rejected  || 0,
      pending:   r.pending   || 0,
      decided,
      approval_rate: decided > 0 ? r.published / decided : null,
      avg_confidence_published: r.avg_confidence_published,
    };
  }).sort((a, b) => b.decided - a.decided);
}

/**
 * Overall approval-rate roll-up across all categories. Useful as a
 * top-line "are we calibrated as a publication" stat.
 */
export function getOverallApprovalRate({ daysBack = 90 } = {}) {
  const since = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const r = getDb().prepare(`
    SELECT
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN status = 'rejected'  THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status IN ('draft', 'reviewed') THEN 1 ELSE 0 END) AS pending,
      AVG(CASE WHEN status = 'published' THEN confidence END) AS avg_confidence_published
    FROM generated_briefs
    WHERE created_at >= ?
  `).get(since);
  const published = r.published || 0;
  const rejected  = r.rejected || 0;
  const decided   = published + rejected;
  return {
    published, rejected,
    pending: r.pending || 0,
    decided,
    approval_rate: decided > 0 ? published / decided : null,
    avg_confidence_published: r.avg_confidence_published,
    days_back: daysBack,
  };
}
