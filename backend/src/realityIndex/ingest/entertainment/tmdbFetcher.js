/**
 * tmdbFetcher — Phase 5 entertainment layer: TMDB trending movies + TV.
 *
 * Pulls the daily trending all-media list from The Movie Database (TMDB).
 * Requires a free TMDB_API_KEY (register at themoviedb.org/settings/api).
 * When the key is absent, syncTmdbCycle() returns { skipped: 'no_key' } so
 * the cron stays silent in dev and on cold deploys — same pattern as FRED.
 *
 * Severity is derived from TMDB popularity score:
 *   pop ≥ 100 → 0.9  |  ≥ 50 → 0.7  |  ≥ 20 → 0.5  |  else 0.3
 *
 * Slug = `tmdb-{media_type}-{tmdb_id}`. Title = "{title} ({release_year})".
 * Hero image = full backdrop URL (falls back to poster).
 *
 * ENABLE_TMDB env (default true). TMDB_API_KEY env (required for real data).
 */

import crypto from "crypto";
import { getDb } from "../../../models/database.js";
import { logger } from "../../../services/logger.js";

const ENABLED    = String(process.env.ENABLE_TMDB ?? "true").toLowerCase() !== "false";
const ENDPOINT   = "https://api.themoviedb.org/3/trending/all/day";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w780";
const TIMEOUT_MS = 15_000;

function severityFromPopularity(pop) {
  if (pop == null || !Number.isFinite(pop)) return 0.3;
  if (pop >= 100) return 0.9;
  if (pop >= 50)  return 0.7;
  if (pop >= 20)  return 0.5;
  return 0.3;
}

function releaseYear(item) {
  // Movies use release_date; TV shows use first_air_date.
  const raw = item.release_date || item.first_air_date || "";
  if (!raw) return null;
  const y = parseInt(raw.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

function displayTitle(item) {
  // Movies use title; TV shows use name.
  return item.title || item.name || "Untitled";
}

async function fetchTrending(key) {
  const url = `${ENDPOINT}?api_key=${encodeURIComponent(key)}`;
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) { logger.warn(`tmdb: HTTP ${r.status}`); return []; }
    const data = await r.json();
    return Array.isArray(data?.results) ? data.results : [];
  } catch (e) {
    if (e.name !== "AbortError") logger.warn(`tmdb: ${e.message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function syncTmdbCycle() {
  if (!ENABLED) return { skipped: "ENABLE_TMDB=false" };

  const key = process.env.TMDB_API_KEY;
  if (!key) return { skipped: "no_key" };

  const results = await fetchTrending(key);
  if (!results.length) return { fetched: 0, upserted: 0, skipped: 0 };

  const db  = getDb();
  const now = Date.now();

  const upsert = db.prepare(`
    INSERT INTO events
      (id, slug, cluster_id, title, summary, category, status, severity,
       geo_country_codes, geo_lat, geo_lng, hero_image_url,
       started_at, last_activity_at, meta, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?, 'entertainment', 'active', ?,
            NULL, NULL, NULL, ?,
            ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title            = excluded.title,
      summary          = excluded.summary,
      severity         = MAX(events.severity, excluded.severity),
      hero_image_url   = excluded.hero_image_url,
      last_activity_at = excluded.last_activity_at,
      updated_at       = excluded.updated_at
  `);

  let upserted = 0, skipped = 0;

  for (const item of results) {
    const tmdbId    = item.id;
    const mediaType = item.media_type || "movie"; // 'movie' | 'tv' | 'person'
    if (!tmdbId || mediaType === "person") { skipped++; continue; }

    const slug      = `tmdb-${mediaType}-${tmdbId}`;
    const id        = crypto.createHash("sha1").update(slug).digest("hex").slice(0, 36);
    const year      = releaseYear(item);
    const rawTitle  = displayTitle(item);
    const title     = year ? `${rawTitle} (${year})` : rawTitle;
    const overview  = (item.overview || "").slice(0, 500) || `Trending ${mediaType === "tv" ? "TV series" : "movie"} on TMDB.`;
    const pop       = typeof item.popularity === "number" ? item.popularity : null;
    const severity  = severityFromPopularity(pop);

    // Hero image: prefer backdrop, fall back to poster.
    const imagePath  = item.backdrop_path || item.poster_path || null;
    const heroUrl    = imagePath ? `${IMAGE_BASE}${imagePath}` : null;

    const releaseDate = item.release_date || item.first_air_date || null;

    const meta = JSON.stringify({
      source:            "tmdb",
      id:                tmdbId,
      media_type:        mediaType,
      vote_average:      item.vote_average    ?? null,
      popularity:        pop,
      original_language: item.original_language ?? null,
      release_date:      releaseDate,
    });

    try {
      upsert.run(
        id, slug, title, overview, severity,
        heroUrl,
        now, now, meta, now, now,
      );
      upserted++;
    } catch (err) {
      logger.warn(`tmdb upsert failed for ${slug}: ${err.message}`);
      skipped++;
    }
  }

  if (upserted) {
    logger.info(`🎬 TMDB: ${results.length} fetched, ${upserted} upserted, ${skipped} skipped`);
  }
  return { fetched: results.length, upserted, skipped };
}
