/**
 * usgsEarthquakeFetcher — Phase 5 geo signal: USGS significant-earthquakes feed.
 *
 * Pulls https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson
 * (or `significant_week` per env), filters by magnitude threshold, and
 * upserts each quake as an `events` row with geo_lat/geo_lng populated.
 * No cluster needed — these events are first-class on geographic merit.
 *
 * Severity = magnitude → [0,1] curve (M5→0.4, M6→0.6, M7→0.8, M8→0.95).
 *
 * Slug derives from USGS event id, so re-runs are idempotent and updates
 * (e.g. mag revisions) flow through cleanly.
 *
 * No auth, no rate limit. Free real-time data.
 */

import crypto from "crypto";
import { getDb } from "../../../models/database.js";
import { logger } from "../../../services/logger.js";

const FEED   = process.env.USGS_FEED || "all_day"; // all_hour|all_day|significant_day|significant_week
const URL    = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${FEED}.geojson`;
const MIN_MAG = parseFloat(process.env.USGS_MIN_MAG || "5.0");
const TIMEOUT_MS = 12_000;
const ENABLED = String(process.env.ENABLE_USGS ?? "true").toLowerCase() !== "false";

function severityFromMag(m) {
  if (m == null || !Number.isFinite(m)) return 0.3;
  if (m >= 8.5) return 1.0;
  if (m >= 8.0) return 0.95;
  if (m >= 7.0) return 0.85;
  if (m >= 6.0) return 0.65;
  if (m >= 5.0) return 0.45;
  return 0.3;
}

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").trim().replace(/\s+/g, "-").slice(0, 70);
}

async function fetchFeed() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(URL, { signal: ctrl.signal });
    if (!r.ok) { logger.warn(`usgs: HTTP ${r.status}`); return []; }
    const data = await r.json();
    return Array.isArray(data?.features) ? data.features : [];
  } catch (e) {
    if (e.name !== "AbortError") logger.warn(`usgs: ${e.message}`);
    return [];
  } finally { clearTimeout(timer); }
}

export async function syncUsgsCycle() {
  if (!ENABLED) return { skipped: "ENABLE_USGS=false" };
  const features = await fetchFeed();
  if (!features.length) return { fetched: 0, upserted: 0 };

  const db = getDb();
  const now = Date.now();

  // Existing events keyed by usgs id stored in `meta` JSON. Cheaper than
  // adding a new column for one ingester. We dedupe via slug = usgs:<id>.
  const upsert = db.prepare(`
    INSERT INTO events
      (id, slug, cluster_id, title, summary, category, status, severity,
       geo_country_codes, geo_lat, geo_lng, hero_image_url,
       started_at, last_activity_at, meta, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?, 'geo', 'active', ?,
            ?, ?, ?, NULL,
            ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title             = excluded.title,
      summary           = excluded.summary,
      severity          = MAX(events.severity, excluded.severity),
      geo_lat           = excluded.geo_lat,
      geo_lng           = excluded.geo_lng,
      last_activity_at  = excluded.last_activity_at,
      updated_at        = excluded.updated_at
  `);

  let upserted = 0, skipped = 0;
  for (const f of features) {
    const p = f?.properties;
    const g = f?.geometry;
    if (!p || !g || !Array.isArray(g.coordinates)) { skipped++; continue; }
    const mag = p.mag;
    if (mag == null || mag < MIN_MAG) { skipped++; continue; }
    const place = p.place || "Earthquake";
    const ts    = p.time || now;
    const usgsId = f.id || p.code || crypto.createHash("sha1").update(`${ts}-${place}`).digest("hex").slice(0, 12);
    const slug = `usgs-${slugify(usgsId)}`;
    const id   = crypto.createHash("sha1").update(slug).digest("hex").slice(0, 36);
    const title = `M${mag.toFixed(1)} earthquake — ${place}`;
    const summary = p.title || `Magnitude ${mag} earthquake near ${place}.`;
    const meta = JSON.stringify({
      source: "usgs",
      usgs_id: usgsId,
      mag,
      depth_km: g.coordinates[2],
      url: p.url || null,
      tsunami: !!p.tsunami,
      felt: p.felt || null,
    });

    try {
      upsert.run(
        id, slug, title, summary, severityFromMag(mag),
        null,          // geo_country_codes — left null; could enrich via reverse-geo later
        g.coordinates[1],  // lat
        g.coordinates[0],  // lng
        ts, now, meta, now, now,
      );
      upserted++;
    } catch (err) {
      logger.warn(`usgs upsert failed for ${slug}: ${err.message}`);
      skipped++;
    }
  }

  if (upserted) logger.info(`🌍 USGS: ${features.length} fetched (M≥${MIN_MAG}), ${upserted} upserted, ${skipped} skipped`);
  return { fetched: features.length, upserted, skipped };
}
