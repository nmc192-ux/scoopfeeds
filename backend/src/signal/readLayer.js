/**
 * readLayer — the ONLY DB-touching code in the Signal Service.
 *
 * Pure read functions over the existing better-sqlite3 connection (getDb()), with
 * parameterized prepared statements only (no string interpolation of inputs). READ-ONLY:
 * no INSERT/UPDATE/DELETE anywhere. Mirrors the house style in models/database.js and
 * skills/scoring/scoringDao.js.
 *
 * Honesty invariant: a source with no B.6 score has quality_score = NULL in the DB; we
 * pass NULL through untouched (the contract layer renders it as credibility_score: null /
 * credibility_status: "unscored"). We never coerce NULL → 0.0.
 *
 * Articles carry no source_id FK — they reference a source by name — so we LEFT JOIN
 * sources ON sources.name = articles.source_name to resolve source_id + the per-source score.
 */
import { getDb } from "../models/database.js";
import { SCORER_VERSION } from "../skills/scoring/scorer.js";
import { SIGNAL } from "./config.js";

const WINDOW_RE = /^(\d+)\s*([mhdw])$/i;
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** "48h" | "7d" | "30m" | "2w" → milliseconds, or null if unparseable. */
export function parseWindowMs(window) {
  const m = WINDOW_RE.exec(String(window ?? "").trim());
  return m ? Number(m[1]) * UNIT_MS[m[2].toLowerCase()] : null;
}

/** Accept ISO-8601 or ms-epoch; return ms-epoch number or null. */
function toMs(v) {
  if (v == null || v === "") return null;
  if (/^\d+$/.test(String(v))) return Number(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// sources.name is NOT unique (UNIQUE is on url) — an outlet can have both an RSS row and a
// YouTube row, so a naive name-join fans out and duplicates article rows. Resolve exactly one
// source per name: prefer the RSS row (articles are RSS-ingested, so that row carries the
// article's credibility), tie-broken by lowest id. We deliberately do NOT prefer a scored row
// over the article's true (rss) source — that would borrow another row's score (dishonest).
const ARTICLE_SELECT = `
  SELECT a.id, a.source_name, a.title, a.description, a.url, a.published_at, a.fetched_at,
         a.is_duplicate,
         s.id AS source_id, s.quality_score, s.quality_score_methodology_version
  FROM articles a
  LEFT JOIN (
    SELECT name, id, quality_score, quality_score_methodology_version,
           ROW_NUMBER() OVER (PARTITION BY name ORDER BY (source_type = 'rss') DESC, id) AS rn
    FROM sources
  ) s ON s.name = a.source_name AND s.rn = 1
`;

export function health() {
  let db_connected = false, total_source_count = 0, scored_source_count = 0;
  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
    db_connected = true;
    // Count deduped OUTLETS (one row per name, same rule as listSources) so /health agrees
    // with /sources rather than over-counting collision/youtube rows.
    const row = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN quality_score IS NOT NULL THEN 1 ELSE 0 END) AS scored
      FROM (
        SELECT quality_score,
               ROW_NUMBER() OVER (
                 PARTITION BY name
                 ORDER BY (quality_score IS NOT NULL) DESC, (source_type = 'rss') DESC, id
               ) AS rn
        FROM sources
      )
      WHERE rn = 1
    `).get();
    total_source_count  = row.total ?? 0;
    scored_source_count = row.scored ?? 0;
  } catch {
    db_connected = false;
  }
  return { db_connected, scorer_version: SCORER_VERSION, scored_source_count, total_source_count };
}

export function listSources() {
  // Dedup to one row per outlet name (sources.name is not unique). Prefer the row that carries a
  // quality_score (so a scored outlet always surfaces its score exactly once), then the RSS row,
  // then lowest id. NB: this is scored-first BY DESIGN — unlike the /articles join above
  // (rss-first), which must not borrow another row's score for an article. See contract.js.
  return getDb().prepare(`
    SELECT id, name, quality_score, quality_score_methodology_version
    FROM (
      SELECT id, name, quality_score, quality_score_methodology_version,
             ROW_NUMBER() OVER (
               PARTITION BY name
               ORDER BY (quality_score IS NOT NULL) DESC, (source_type = 'rss') DESC, id
             ) AS rn
      FROM sources
    )
    WHERE rn = 1
    ORDER BY name COLLATE NOCASE
  `).all();
}

/**
 * queryArticles — recency-ordered window query.
 *   window         "48h"-style; default SIGNAL.defaultWindow. Sets the lower published bound
 *                  unless min_published is given explicitly.
 *   min/max_published  ISO-8601 or ms-epoch overrides.
 *   limit/offset   limit capped at SIGNAL.maxLimit; offset >= 0.
 * Returns { window, limit, offset, rows, next_offset } — next_offset is offset+limit when a
 * (limit+1)th row exists, else null.
 */
export function queryArticles({ window, limit, offset, min_published, max_published } = {}) {
  const win = window || SIGNAL.defaultWindow;
  const winMs = parseWindowMs(win);
  const now = Date.now();

  let minMs = toMs(min_published);
  if (minMs == null && winMs != null) minMs = now - winMs;
  const maxMs = toMs(max_published);

  let lim = Number.parseInt(limit ?? SIGNAL.defaultLimit, 10);
  if (!Number.isFinite(lim) || lim <= 0) lim = SIGNAL.defaultLimit;
  lim = Math.min(lim, SIGNAL.maxLimit);

  let off = Number.parseInt(offset ?? 0, 10);
  if (!Number.isFinite(off) || off < 0) off = 0;

  const where = [];
  const params = [];
  if (minMs != null) { where.push("a.published_at >= ?"); params.push(minMs); }
  if (maxMs != null) { where.push("a.published_at <= ?"); params.push(maxMs); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // Fetch limit+1 to detect whether another page exists (→ next_offset).
  const rows = getDb().prepare(`
    ${ARTICLE_SELECT}
    ${whereSql}
    ORDER BY a.published_at DESC, a.id
    LIMIT ? OFFSET ?
  `).all(...params, lim + 1, off);

  const hasMore = rows.length > lim;
  return {
    window: win,
    limit: lim,
    offset: off,
    rows: hasMore ? rows.slice(0, lim) : rows,
    next_offset: hasMore ? off + lim : null,
  };
}

export function getArticle(id) {
  return getDb().prepare(`${ARTICLE_SELECT} WHERE a.id = ?`).get(id) ?? null;
}
