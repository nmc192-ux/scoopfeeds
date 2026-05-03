/**
 * noaaAlertsFetcher — Phase 5 geo signal: NOAA active weather alerts.
 *
 * Pulls https://api.weather.gov/alerts/active filtered to high-severity
 * categories (Severe + Extreme), then upserts each alert as an events row
 * with geo_lat/lng populated from the polygon centroid. Same recipe as
 * usgsEarthquakeFetcher — slug = "noaa-{alert_id}", idempotent re-runs.
 *
 * NOAA requires a User-Agent header. No auth, no rate limit (within reason).
 * US-only coverage; international weather signals will need a parallel
 * Met Office / ECMWF adapter later.
 */

import crypto from "crypto";
import { getDb } from "../../../models/database.js";
import { logger } from "../../../services/logger.js";

const URL = "https://api.weather.gov/alerts/active?severity=Severe,Extreme&status=actual";
const TIMEOUT_MS = 15_000;
const ENABLED = String(process.env.ENABLE_NOAA ?? "true").toLowerCase() !== "false";
const UA = "scoopfeeds/1.0 (+https://scoopfeeds.com)";

function severityFor(s, urgency) {
  // NOAA: severity ∈ {Minor, Moderate, Severe, Extreme}; urgency ∈ {Past, Future, Expected, Immediate}.
  let base;
  switch (s) {
    case "Extreme": base = 0.95; break;
    case "Severe":  base = 0.75; break;
    case "Moderate": base = 0.45; break;
    default:        base = 0.30;
  }
  if (urgency === "Immediate") base += 0.05;
  return Math.min(1, base);
}

// Centroid of a GeoJSON Polygon / MultiPolygon ring set. Cheap arithmetic mean
// of vertices — fine for plotting a marker, not for serious GIS.
function centroid(geometry) {
  if (!geometry?.coordinates) return null;
  let xs = [], ys = [];
  const flatten = (coords, depth) => {
    if (depth <= 0) {
      const [x, y] = coords;
      if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
      return;
    }
    if (Array.isArray(coords)) coords.forEach(c => flatten(c, depth - 1));
  };
  if (geometry.type === "Polygon")      flatten(geometry.coordinates, 2);
  else if (geometry.type === "MultiPolygon") flatten(geometry.coordinates, 3);
  else if (geometry.type === "Point")   flatten([geometry.coordinates], 1);
  if (!xs.length) return null;
  return [
    ys.reduce((a, b) => a + b, 0) / ys.length,
    xs.reduce((a, b) => a + b, 0) / xs.length,
  ];
}

async function fetchAlerts() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(URL, { headers: { "User-Agent": UA, Accept: "application/geo+json" }, signal: ctrl.signal });
    if (!r.ok) { logger.warn(`noaa: HTTP ${r.status}`); return []; }
    const data = await r.json();
    return Array.isArray(data?.features) ? data.features : [];
  } catch (e) {
    if (e.name !== "AbortError") logger.warn(`noaa: ${e.message}`);
    return [];
  } finally { clearTimeout(timer); }
}

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").trim().replace(/\s+/g, "-").slice(0, 70);
}

export async function syncNoaaCycle() {
  if (!ENABLED) return { skipped: "ENABLE_NOAA=false" };
  const features = await fetchAlerts();
  if (!features.length) return { fetched: 0, upserted: 0 };

  const db = getDb();
  const now = Date.now();

  const upsert = db.prepare(`
    INSERT INTO events
      (id, slug, cluster_id, title, summary, category, status, severity,
       geo_country_codes, geo_lat, geo_lng, hero_image_url,
       started_at, last_activity_at, meta, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?, 'weather', 'active', ?,
            ?, ?, ?, NULL,
            ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title             = excluded.title,
      summary           = excluded.summary,
      severity          = MAX(events.severity, excluded.severity),
      geo_lat           = COALESCE(excluded.geo_lat, events.geo_lat),
      geo_lng           = COALESCE(excluded.geo_lng, events.geo_lng),
      last_activity_at  = excluded.last_activity_at,
      updated_at        = excluded.updated_at
  `);

  let upserted = 0, skipped = 0;
  for (const f of features) {
    const p = f?.properties;
    if (!p || !p.id) { skipped++; continue; }
    const c = centroid(f.geometry);
    if (!c) { skipped++; continue; }   // skip alerts without geometry
    const slug  = `noaa-${slugify(p.id)}`;
    const id    = crypto.createHash("sha1").update(slug).digest("hex").slice(0, 36);
    const title = `${p.event}: ${p.headline || p.areaDesc || "weather alert"}`.slice(0, 240);
    const summary = (p.description || p.headline || "").slice(0, 600);
    const sev   = severityFor(p.severity, p.urgency);
    const startedAt = p.effective ? Date.parse(p.effective) : now;
    const meta  = JSON.stringify({
      source: "noaa",
      noaa_id: p.id,
      event: p.event,
      severity: p.severity,
      urgency: p.urgency,
      certainty: p.certainty,
      areas: p.areaDesc,
      ends: p.ends || null,
    });

    try {
      upsert.run(
        id, slug, title, summary, sev,
        "us",                  // NOAA is US-only
        c[0], c[1],            // lat, lng
        startedAt, now, meta, now, now,
      );
      upserted++;
    } catch (err) {
      logger.warn(`noaa upsert ${slug}: ${err.message}`);
      skipped++;
    }
  }

  if (upserted) logger.info(`🌪️  NOAA: ${features.length} alerts (Severe+Extreme), ${upserted} upserted, ${skipped} skipped`);
  return { fetched: features.length, upserted, skipped };
}
