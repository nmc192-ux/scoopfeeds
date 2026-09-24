/**
 * shotAssets.js — the asset-record reuse table (migration 038).
 *
 * The resolver asks here FIRST. A record is everything needed to put the same
 * picture on screen again — URL, licence, credit, in-points, crop, coordinates —
 * and never the picture itself (DrJ, 29 Aug: no large in-house library).
 */

const J = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
const P = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

export const subjectKey = (s) => String(s || "").toLowerCase().normalize("NFKD")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    in_points: P(row.in_points), crop: P(row.crop), coords: P(row.coords),
    data_series: P(row.data_series), quotes: P(row.quotes),
  };
}

/** Usable records for a subject and kind, least recently used first. */
export function findRecords(db, subject, kind, { limit = 5 } = {}) {
  return db.prepare(`
    SELECT * FROM shot_assets
    WHERE subject_key = ? AND kind = ? AND status = 'ok'
    ORDER BY COALESCE(last_used_at, 0) ASC, id ASC
    LIMIT ?
  `).all(subjectKey(subject), kind, limit).map(hydrate);
}

/** Has this exact media already been judged and refused? Stops re-fetch/re-judge loops. */
export function isRejected(db, mediaUrl) {
  if (!mediaUrl) return false;
  return Boolean(db.prepare(`SELECT 1 FROM shot_assets WHERE media_url = ? AND status = 'rejected' LIMIT 1`).get(mediaUrl));
}

/** Insert or refresh a record. Returns its id. */
export function upsertRecord(db, rec, { now = Date.now() } = {}) {
  const key = subjectKey(rec.subject);
  if (!key) throw new Error("shotAssets: a record needs a subject");
  if (!rec.kind || !rec.rung) throw new Error("shotAssets: a record needs kind and rung");
  db.prepare(`
    INSERT INTO shot_assets (subject_key, subject, kind, rung, source_url, media_url, licence, credit, author,
      width, height, duration_s, in_points, crop, coords, data_series, quotes, status, reject_reason, found_for, created_at)
    VALUES (@key, @subject, @kind, @rung, @source_url, @media_url, @licence, @credit, @author,
      @width, @height, @duration_s, @in_points, @crop, @coords, @data_series, @quotes, @status, @reject_reason, @found_for, @now)
    ON CONFLICT(subject_key, kind, media_url) DO UPDATE SET
      rung = excluded.rung, source_url = excluded.source_url, licence = excluded.licence, credit = excluded.credit,
      author = excluded.author, width = excluded.width, height = excluded.height, duration_s = excluded.duration_s,
      in_points = COALESCE(excluded.in_points, shot_assets.in_points), crop = COALESCE(excluded.crop, shot_assets.crop),
      coords = COALESCE(excluded.coords, shot_assets.coords), data_series = COALESCE(excluded.data_series, shot_assets.data_series),
      quotes = COALESCE(excluded.quotes, shot_assets.quotes), status = excluded.status, reject_reason = excluded.reject_reason
  `).run({
    key, subject: String(rec.subject), kind: rec.kind, rung: rec.rung,
    source_url: rec.source_url ?? null, media_url: rec.media_url ?? null, licence: rec.licence ?? null,
    credit: rec.credit ?? null, author: rec.author ?? null, width: rec.width ?? null, height: rec.height ?? null,
    duration_s: rec.duration_s ?? null, in_points: J(rec.in_points), crop: J(rec.crop), coords: J(rec.coords),
    data_series: J(rec.data_series), quotes: J(rec.quotes), status: rec.status || "ok",
    reject_reason: rec.reject_reason ?? null, found_for: rec.found_for ?? null, now,
  });
  return db.prepare(`SELECT id FROM shot_assets WHERE subject_key = ? AND kind = ? AND media_url IS ?`)
    .get(key, rec.kind, rec.media_url ?? null)?.id ?? null;
}

export function markUsed(db, id, { now = Date.now() } = {}) {
  db.prepare(`UPDATE shot_assets SET last_used_at = ?, uses = uses + 1 WHERE id = ?`).run(now, id);
}

/**
 * Feed a longform film's asset_manifest.json into the table.
 *
 * ⚠️ SHAPE UNVERIFIED: no manifest exists in this repo to test against, so
 * this accepts either an array or `{ assets: [...] }` and maps the common field
 * names. Entries missing a subject, kind or URL are SKIPPED AND COUNTED, never
 * guessed. Run it on a real manifest and read the counts before trusting it.
 */
export function importAssetManifest(db, manifest, { source = "longform" } = {}) {
  const list = Array.isArray(manifest) ? manifest : (Array.isArray(manifest?.assets) ? manifest.assets : []);
  let imported = 0;
  const skipped = [];
  for (const a of list) {
    const subject = a.subject || a.query || a.title;
    const kind = a.kind || (a.type === "video" ? "clip" : a.type === "image" ? "photo" : a.type);
    const media = a.media_url || a.url || a.sourceUrl || a.source_url;
    if (!subject || !kind || !media) { skipped.push(a.id || subject || "?"); continue; }
    upsertRecord(db, {
      subject, kind, rung: source, media_url: media, source_url: a.page_url || a.pageUrl || a.sourceUrl || null,
      licence: a.licence || a.license || null, credit: a.credit || null, author: a.author || a.creator || null,
      width: a.width ?? null, height: a.height ?? null, duration_s: a.duration ?? a.duration_s ?? null,
      in_points: a.in_points || a.inPoints || null, coords: a.coords || null, quotes: a.quotes || null,
      data_series: a.data_series || null,
    });
    imported++;
  }
  return { imported, skipped };
}
