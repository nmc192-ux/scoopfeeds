/**
 * 038 — shot_assets: the shot engine's asset RECORDS, looked up before any search.
 *
 * REUSE IS REQUIRED (DrJ, 20 Sep 2026), BUT A LIBRARY IS NOT (DrJ, 29 Aug). So
 * this table holds what it takes to find a picture again, never the picture:
 * the source URL, licence, credit, in-points, coordinates, data series and
 * quotes. Media is fetched at render time and only the finished MP4 is kept.
 * The longform film's asset_manifest.json files feed the same table.
 *
 * KEYED ON (subject_key, kind). subject_key is the shot subject normalised
 * (lower case, alphanumerics and single spaces), so "Pituffik Space Base" and
 * "pituffik space base" are one record. Several records per key are allowed —
 * two good clips of one place — and selection prefers the least recently used.
 *
 * `rejected` records are kept too: a clip the vision check refused (casualties,
 * a burned-in banner that cannot be cropped) must not be re-fetched and
 * re-judged every time the same subject comes up.
 *
 * NO FOREIGN KEY, like video_posts and stock_asset_usage: records outlive the
 * articles that first found them, which is the point.
 */

export const id = "038_shot_assets";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shot_assets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_key   TEXT NOT NULL,
      subject       TEXT NOT NULL,
      kind          TEXT NOT NULL,          -- clip | photo | satellite | map | data | quote | headline
      rung          TEXT NOT NULL,          -- incident | commons-video | web-photo | commons-photo | esri | natural-earth | stock | longform
      source_url    TEXT,                   -- human-facing page (Commons file page, article, provider page)
      media_url     TEXT,                   -- what the renderer fetches (transcode, image, tile template)
      licence       TEXT,
      credit        TEXT,                   -- on-screen credit line
      author        TEXT,
      width         INTEGER,
      height        INTEGER,
      duration_s    REAL,
      in_points     TEXT,                   -- JSON [{t, score, note}] — vision-picked
      crop          TEXT,                   -- JSON {ymax, ...} — banner crop applied at render
      coords        TEXT,                   -- JSON {lat, lon, zoom?}
      data_series   TEXT,                   -- JSON
      quotes        TEXT,                   -- JSON [{text, speaker}]
      status        TEXT NOT NULL DEFAULT 'ok',   -- ok | rejected
      reject_reason TEXT,
      found_for     TEXT,                   -- article id that first found it (provenance only)
      created_at    INTEGER NOT NULL,
      last_used_at  INTEGER,
      uses          INTEGER NOT NULL DEFAULT 0,
      UNIQUE(subject_key, kind, media_url)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_shot_assets_lookup ON shot_assets(subject_key, kind, status);`);
}
