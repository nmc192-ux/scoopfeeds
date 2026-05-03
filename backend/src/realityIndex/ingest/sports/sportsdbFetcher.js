/**
 * sportsdbFetcher — Phase 5 sports layer: TheSportsDB free-tier fixtures.
 *
 * Pulls upcoming + recent soccer fixtures for today and tomorrow from the
 * TheSportsDB free API (key=3, no auth required beyond the key in the URL).
 * Each fixture is upserted as an `events` row with category='sports'.
 *
 * Severity is a flat 0.5 default for all fixtures (no meaningful signal to
 * derive severity from a scheduled game; could be extended with rivalry/
 * importance signals later).
 *
 * Slug = `sports-{sportsdb_event_id}`, so re-runs are idempotent and any
 * field updates (e.g. venue change, rescheduled time) flow through cleanly.
 *
 * Free tier: only fetches today + tomorrow to be polite to the public API.
 * ENABLE_SPORTSDB env (default true). SPORTSDB_KEY env (default "3").
 */

import crypto from "crypto";
import { getDb } from "../../../models/database.js";
import { logger } from "../../../services/logger.js";

const ENABLED      = String(process.env.ENABLE_SPORTSDB ?? "true").toLowerCase() !== "false";
const API_KEY      = process.env.SPORTSDB_KEY || "3";
const TIMEOUT_MS   = 15_000;
const BASE_URL     = `https://www.thesportsdb.com/api/v1/json/${API_KEY}/eventsday.php`;

// Sport → ISO 3166-1 alpha-2 country codes (best-effort mapping for top leagues).
// TheSportsDB strLeague names are used for lookup.
const LEAGUE_COUNTRY_MAP = {
  "English Premier League":      "GB",
  "English League Championship": "GB",
  "Spanish La Liga":             "ES",
  "German Bundesliga":           "DE",
  "Italian Serie A":             "IT",
  "French Ligue 1":              "FR",
  "UEFA Champions League":       null, // multi-country
  "UEFA Europa League":          null,
  "MLS":                         "US",
  "Brazilian Série A":           "BR",
  "Argentine Primera Division":  "AR",
};

function isoDate(d) {
  // Returns YYYY-MM-DD for a given Date object.
  return d.toISOString().slice(0, 10);
}

async function fetchDay(date) {
  const url = `${BASE_URL}?d=${date}&s=Soccer`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) { logger.warn(`sportsdb: HTTP ${r.status} for ${date}`); return []; }
    const data = await r.json();
    // API returns `{ events: [...] }` or `{ events: null }` when no fixtures.
    return Array.isArray(data?.events) ? data.events : [];
  } catch (e) {
    if (e.name !== "AbortError") logger.warn(`sportsdb: ${e.message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function syncSportsdbCycle() {
  if (!ENABLED) return { skipped: "ENABLE_SPORTSDB=false" };

  const today    = isoDate(new Date());
  const tomorrow = isoDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

  // Fetch both days; duplicates are handled by idempotent upsert on slug.
  const [todayEvents, tomorrowEvents] = await Promise.all([
    fetchDay(today),
    fetchDay(tomorrow),
  ]);
  const fixtures = [...todayEvents, ...tomorrowEvents];

  if (!fixtures.length) return { fetched: 0, upserted: 0, skipped: 0 };

  const db  = getDb();
  const now = Date.now();

  const upsert = db.prepare(`
    INSERT INTO events
      (id, slug, cluster_id, title, summary, category, status, severity,
       geo_country_codes, geo_lat, geo_lng, hero_image_url,
       started_at, last_activity_at, meta, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?, 'sports', 'active', ?,
            ?, NULL, NULL, NULL,
            ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title            = excluded.title,
      summary          = excluded.summary,
      severity         = MAX(events.severity, excluded.severity),
      geo_country_codes = excluded.geo_country_codes,
      last_activity_at = excluded.last_activity_at,
      updated_at       = excluded.updated_at
  `);

  let upserted = 0, skipped = 0;

  for (const evt of fixtures) {
    const eventId = evt.idEvent;
    if (!eventId) { skipped++; continue; }

    const homeTeam = evt.strHomeTeam  || "Unknown";
    const awayTeam = evt.strAwayTeam  || "Unknown";
    const league   = evt.strLeague    || "Soccer";
    const venue    = evt.strVenue     || null;
    const dateStr  = evt.dateEvent    || today;

    const slug    = `sports-${String(eventId)}`;
    const id      = crypto.createHash("sha1").update(slug).digest("hex").slice(0, 36);
    const title   = `${homeTeam} vs ${awayTeam} — ${league}`;
    const summary = venue
      ? `${homeTeam} host ${awayTeam} in the ${league} at ${venue}.`
      : `${homeTeam} vs ${awayTeam} in the ${league}.`;

    // Map league → country code (null is fine; COALESCE in query handles it).
    const countryCode = LEAGUE_COUNTRY_MAP[league] !== undefined
      ? LEAGUE_COUNTRY_MAP[league]
      : null;

    // started_at: combine dateEvent + strTime if available, else midnight UTC.
    let startedAt = now;
    if (dateStr) {
      const timeStr = evt.strTime ? `T${evt.strTime}` : "T00:00:00";
      const parsed  = Date.parse(`${dateStr}${timeStr}`);
      if (!isNaN(parsed)) startedAt = parsed;
    }

    const meta = JSON.stringify({
      source:      "thesportsdb",
      idEvent:     eventId,
      idHomeTeam:  evt.idHomeTeam  || null,
      idAwayTeam:  evt.idAwayTeam  || null,
      dateEvent:   dateStr,
      strLeague:   league,
      strVenue:    venue,
    });

    try {
      upsert.run(
        id, slug, title, summary,
        0.5,          // severity — flat default for scheduled fixtures
        countryCode,
        startedAt, now, meta, now, now,
      );
      upserted++;
    } catch (err) {
      logger.warn(`sportsdb upsert failed for ${slug}: ${err.message}`);
      skipped++;
    }
  }

  if (upserted) {
    logger.info(`⚽ SportsDB: ${fixtures.length} fetched, ${upserted} upserted, ${skipped} skipped`);
  }
  return { fetched: fixtures.length, upserted, skipped };
}
