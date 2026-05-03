/**
 * gdeltFetcher — Phase 5 global news multiplier.
 *
 * GDELT 2.0 indexes thousands of news outlets in 65 languages every 15 min.
 * This fetcher pulls fresh English-language articles by topic via the GDELT
 * DOC 2.0 API and persists them as `articles` rows so the existing
 * cluster / event tracker / RI pipeline picks them up unchanged. URL-keyed
 * dedupe (articles.url is UNIQUE) means re-running is idempotent.
 *
 * API: https://api.gdeltproject.org/api/v2/doc/doc?query=...&format=json&...
 * No auth, no rate limit (within reason — GDELT publishes a 15-min cadence
 * for new content so polling more frequently is wasted).
 *
 * Topics / category mapping is intentionally narrow and high-signal —
 * configurable via GDELT_TOPICS env (comma-separated). Default covers the
 * categories most likely to have prediction markets.
 */

import crypto from "crypto";
import { upsertArticle, markDuplicateIfSimilar } from "../../../models/database.js";
import { logger } from "../../../services/logger.js";

const ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";

// GDELT theme/topic queries → our category. Picks high-signal themes that
// (a) overlap with the prediction markets we track and (b) tend to produce
// well-formed articles with images.
const DEFAULT_TOPICS = [
  { category: "politics",    query: 'theme:GOV_ELECTION OR theme:WB_840_JUSTICE' },
  { category: "business",    query: 'theme:ECON_STOCKMARKET OR theme:ECON_MONOPOLY OR theme:ECON_INTEREST_RATES' },
  { category: "international", query: 'theme:GENERAL_GOVERNMENT OR theme:DIPLOMATIC_RELATIONS' },
  { category: "tech",        query: 'theme:TECH_AUTOMATION OR theme:GENERAL_GOVERNMENT' },
  { category: "ai",          query: 'theme:TECH_AI OR (artificial intelligence)' },
  { category: "climate",     query: 'theme:ENV_CLIMATECHANGE OR theme:ENV_GREENPARTY' },
  { category: "health",      query: 'theme:HEALTH OR theme:HEALTH_PANDEMIC OR theme:WB_2160_HEALTH' },
];

const FETCH_TIMEOUT_MS  = 15_000;
const MAX_PER_TOPIC     = parseInt(process.env.GDELT_MAX_PER_TOPIC || "30", 10);
const TIMESPAN          = process.env.GDELT_TIMESPAN || "30min";  // last 30 min of articles
const ENABLED           = String(process.env.ENABLE_GDELT ?? "true").toLowerCase() !== "false";
const UA                = "scoopfeeds/1.0 (+https://scoopfeeds.com)";

// ─── Helpers ─────────────────────────────────────────────────────────────
function loadTopics() {
  const env = (process.env.GDELT_TOPICS || "").trim();
  if (!env) return DEFAULT_TOPICS;
  // Format: "politics:theme:GOV_ELECTION,business:theme:ECON_STOCKMARKET"
  return env.split(",").map(p => {
    const [category, ...rest] = p.split(":");
    return { category: category.trim(), query: rest.join(":").trim() };
  }).filter(t => t.category && t.query);
}

// GDELT timestamps look like "20260503T160000Z" — convert to ms.
function parseGdeltTs(s) {
  if (!s || typeof s !== "string" || s.length < 15) return Date.now();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return Date.parse(s) || Date.now();
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

// Stable URL-derived id matching the rest of the codebase's article ids
// (url-hash as an opaque string). Same hash function the RSS pipeline uses
// for cross-source dedupe — keeps id collisions consistent.
function articleIdFromUrl(url) {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 36);
}

async function fetchTopic({ category, query }) {
  const params = new URLSearchParams({
    query:      `${query} sourcelang:eng`,
    mode:       "ArtList",
    format:     "json",
    timespan:   TIMESPAN,
    maxrecords: String(Math.min(MAX_PER_TOPIC, 250)),
    sort:       "DateDesc",
  });
  const url = `${ENDPOINT}?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: controller.signal });
    if (!res.ok) {
      logger.warn(`gdelt ${category}: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data?.articles) ? data.articles : [];
  } catch (err) {
    if (err.name !== "AbortError") logger.warn(`gdelt ${category}: ${err.message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function normalize(raw, category, now) {
  if (!raw?.url || !raw?.title) return null;
  return {
    id:           articleIdFromUrl(raw.url),
    title:        String(raw.title).slice(0, 500),
    description:  raw.seendate ? null : null,            // GDELT DOC API doesn't ship descriptions
    content:      null,
    url:          raw.url,
    image_url:    raw.socialimage || null,
    source_name:  raw.domain || raw.sourcecountry || "GDELT",
    category,
    region:       (raw.sourcecountry || "global").toLowerCase().slice(0, 12),
    author:       null,
    published_at: parseGdeltTs(raw.seendate) || now,
    fetched_at:   now,
    credibility:  7,                                     // GDELT-aggregated: average-strong
    tags:         JSON.stringify(["gdelt", category]),
    language:     (raw.language || "en").toLowerCase().slice(0, 5),
  };
}

// ─── Public ──────────────────────────────────────────────────────────────
export async function syncGdeltCycle({ topics = loadTopics() } = {}) {
  if (!ENABLED) return { skipped: "ENABLE_GDELT=false" };
  const now = Date.now();
  let attempted = 0, fetched = 0, inserted = 0, skipped = 0;

  for (const t of topics) {
    attempted++;
    const raws = await fetchTopic(t);
    fetched += raws.length;
    for (const raw of raws) {
      const a = normalize(raw, t.category, now);
      if (!a) { skipped++; continue; }
      try {
        const r = upsertArticle(a);
        if (r.changes > 0) {
          inserted++;
          // Same dedupe pass the RSS pipeline runs — silently swallowed on failure.
          try { markDuplicateIfSimilar(a); } catch { /* ignore */ }
        } else {
          skipped++;
        }
      } catch (err) {
        // URL UNIQUE collision is the most common path; logged as debug elsewhere
        skipped++;
      }
    }
  }

  if (inserted) logger.info(`🌍 GDELT: ${attempted} topics, ${fetched} fetched, ${inserted} new articles, ${skipped} dupes/skipped`);
  return { attempted, fetched, inserted, skipped };
}
