/**
 * acledFetcher — Phase 5 geo signal: ACLED armed-conflict events.
 *
 * ACLED (Armed Conflict Location & Event Data) tracks political violence
 * and protests worldwide with date, location, fatalities, actors. Free
 * for academic + journalism use; requires email-based key registration
 * at developer.acleddata.com. Skips silently when ACLED_KEY/EMAIL absent
 * so deploys without credentials are unaffected.
 *
 * Pulls events from the last day, filters to high-fatality ones, upserts
 * as `events` rows with category='conflict' and geo_lat/lng populated.
 * Severity scaled by fatalities: 1→0.4, 5→0.6, 25→0.8, 100→0.95.
 *
 * Endpoint: https://api.acleddata.com/acled/read?...
 */

import crypto from "crypto";
import { getDb } from "../../../models/database.js";
import { logger } from "../../../services/logger.js";

const ENDPOINT  = "https://api.acleddata.com/acled/read";
const TIMEOUT_MS = 15_000;
const MIN_FATALITIES = parseInt(process.env.ACLED_MIN_FATALITIES || "1", 10);
const ENABLED   = String(process.env.ENABLE_ACLED ?? "true").toLowerCase() !== "false";

function severityFromFatalities(n) {
  const f = Number(n) || 0;
  if (f >= 100) return 0.98;
  if (f >= 50)  return 0.92;
  if (f >= 25)  return 0.85;
  if (f >= 10)  return 0.75;
  if (f >= 5)   return 0.65;
  if (f >= 1)   return 0.50;
  return 0.30;
}

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").trim().replace(/\s+/g, "-").slice(0, 70);
}

function isoYesterday() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function fetchAcled() {
  const key   = process.env.ACLED_KEY;
  const email = process.env.ACLED_EMAIL;
  if (!key || !email) return { skipped: "no_key" };

  const params = new URLSearchParams({
    key, email,
    event_date:    `${isoYesterday()}|${new Date().toISOString().slice(0, 10)}`,
    event_date_where: "BETWEEN",
    fatalities:    String(MIN_FATALITIES),
    fatalities_where: ">=",
    limit:         "200",
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${ENDPOINT}?${params}`, { signal: ctrl.signal });
    if (!r.ok) { logger.warn(`acled: HTTP ${r.status}`); return { items: [] }; }
    const data = await r.json();
    return { items: Array.isArray(data?.data) ? data.data : [] };
  } catch (e) {
    if (e.name !== "AbortError") logger.warn(`acled: ${e.message}`);
    return { items: [] };
  } finally { clearTimeout(timer); }
}

export async function syncAcledCycle() {
  if (!ENABLED) return { skipped: "ENABLE_ACLED=false" };
  const out = await fetchAcled();
  if (out.skipped) return out;
  const items = out.items || [];
  if (!items.length) return { fetched: 0, upserted: 0 };

  const db = getDb();
  const now = Date.now();

  const upsert = db.prepare(`
    INSERT INTO events
      (id, slug, cluster_id, title, summary, category, status, severity,
       geo_country_codes, geo_lat, geo_lng, hero_image_url,
       started_at, last_activity_at, meta, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?, 'conflict', 'active', ?,
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
  for (const e of items) {
    const lat = parseFloat(e.latitude);
    const lng = parseFloat(e.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { skipped++; continue; }
    const acledId = e.event_id_cnty || e.data_id || crypto.randomUUID();
    const slug    = `acled-${slugify(acledId)}`;
    const id      = crypto.createHash("sha1").update(slug).digest("hex").slice(0, 36);
    const fat     = parseInt(e.fatalities, 10) || 0;
    const title   = `${e.event_type}${fat > 0 ? ` (${fat} killed)` : ""} — ${e.location || e.country}`;
    const summary = (e.notes || `${e.actor1 || "Unknown actor"}${e.actor2 ? ` vs ${e.actor2}` : ""} — ${e.sub_event_type || e.event_type}`).slice(0, 600);
    const ts      = e.event_date ? Date.parse(e.event_date) : now;
    const meta    = JSON.stringify({
      source: "acled",
      acled_id: acledId,
      event_type: e.event_type,
      sub_event_type: e.sub_event_type,
      actor1: e.actor1, actor2: e.actor2,
      country: e.country, region: e.region,
      fatalities: fat,
    });

    try {
      upsert.run(
        id, slug, title, summary, severityFromFatalities(fat),
        e.iso ? JSON.stringify([(e.iso || "").toLowerCase().slice(0, 3)]) : null,
        lat, lng,
        ts, now, meta, now, now,
      );
      upserted++;
    } catch (err) {
      logger.warn(`acled upsert ${slug}: ${err.message}`);
      skipped++;
    }
  }

  if (upserted) logger.info(`⚔️  ACLED: ${items.length} fetched (≥${MIN_FATALITIES} fatalities), ${upserted} upserted, ${skipped} skipped`);
  return { fetched: items.length, upserted, skipped };
}
