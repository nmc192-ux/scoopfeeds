/**
 * countryAffinity.js — "reader's country first" ordering for GET /api/events (#190).
 *
 * WHY THE SOURCE, NOT THE EVENT. News events carry no country: the promoter never
 * writes events.geo_country_codes. What every article does carry is its outlet, and
 * every outlet has a region in config/sources.js. So an event's affinity to a country
 * is the number of DISTINCT outlets from that country among its articles.
 *
 * WHERE AN OUTLET IS. One list, not a second one:
 *   1. the source's own region tag, when it names a place ("us-west", "pk", "uk", "fr"),
 *      resolved through COUNTRY_REGIONS (config/sources.js) plus the few tags it lacks;
 *   2. for the many "global"-tagged outlets, radio/sourceRegions.js's name overrides
 *      (Radio already places BBC, Bloomberg, Al Jazeera … by name). Its "europe" bucket
 *      is UK outlets apart from the two named in EUROPE_NOT_UK;
 *   3. sourceRegions' Indian-outlet list, for Indian wires arriving via aggregators.
 * An outlet none of these place has no country: it never makes an event affine.
 *
 * ORDERING, NEVER FILTERING. reorderByCountry() is a stable partition of the rows the
 * query already returned, in the order it returned them: affine events first, then the
 * rest. Membership never changes and the prominence formula is untouched. When the
 * reader's country has no outlets at all, the tiers are US, then GB, then Europe.
 */
import { COUNTRY_REGIONS, RSS_SOURCES } from "../../config/sources.js";
import { _internals as radioRegions, isIndianOutlet } from "../../radio/sourceRegions.js";

// Region tags config/sources.js uses that COUNTRY_REGIONS does not list. "eu" is the
// pan-European bucket, not a country: it only counts in the Europe fallback tier.
const EXTRA_TAGS = { fr: "FR", de: "DE", il: "IL", qa: "QA", eu: "EU" };

// radio/sourceRegions.js puts UK and continental outlets in one "europe" bucket.
// Every name in it is a UK outlet except these.
const EUROPE_NOT_UK = { "DW English": "DE", "France 24": "FR" };

// Country codes that count as "Europe" in the fallback tier (GB has its own tier).
const EUROPE = new Set(["EU", "FR", "DE", "IE", "ES", "IT", "NL", "BE", "PT", "AT", "CH",
  "SE", "NO", "DK", "FI", "PL", "CZ", "GR", "HU", "RO", "UA"]);

export const FALLBACK_TIERS = Object.freeze(["US", "GB", "EUROPE"]);

const TAG_TO_COUNTRY = (() => {
  const m = new Map(Object.entries(EXTRA_TAGS));
  for (const [cc, tags] of Object.entries(COUNTRY_REGIONS)) for (const t of tags) m.set(t, cc);
  return m;
})();

/** The ISO country (or "EU") an outlet publishes from, or null when unknown. */
export function outletCountry(sourceName, regionTag) {
  const tag = String(regionTag || "").trim().toLowerCase();
  if (tag && tag !== "global" && TAG_TO_COUNTRY.has(tag)) return TAG_TO_COUNTRY.get(tag);
  const name = String(sourceName || "").trim();
  if (!name) return null;
  // The source's configured tag wins over the article's (aggregator articles say "global").
  const cfg = radioRegions.SOURCES.get(name);
  if (cfg && cfg.code && cfg.code !== "global" && TAG_TO_COUNTRY.has(cfg.code)) return TAG_TO_COUNTRY.get(cfg.code);
  const placed = radioRegions.OVERRIDES[name];
  if (placed === "us") return "US";
  if (placed === "europe") return EUROPE_NOT_UK[name] || "GB";
  if (placed === "middle_east") return "QA"; // Al Jazeera, the only entry
  if (isIndianOutlet(name)) return "IN";
  return null;
}

// Countries at least one configured source resolves to. A reader elsewhere gets the
// fallback tiers, because no event can be affine to a country with no outlets.
const COVERED = new Set(
  RSS_SOURCES.map((s) => outletCountry(s?.name, s?.region)).filter((c) => c && c !== "EU"),
);

/** True when some configured outlet publishes from this country. */
export function hasCountrySources(cc) {
  return COVERED.has(String(cc || "").toUpperCase());
}

/** Normalise a ?country= value: two letters, upper-cased, or null. */
export function parseCountry(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/**
 * Distinct outlets per country for each event id: Map<eventId, Map<cc, count>>.
 * One query over the event_articles join; no new column.
 */
export function outletCountriesByEvent(db, eventIds) {
  const out = new Map();
  if (!eventIds.length) return out;
  const rows = db.prepare(`
    SELECT DISTINCT ea.event_id AS event_id, a.source_name AS source_name, a.region AS region
    FROM event_articles ea JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id IN (${eventIds.map(() => "?").join(",")})
      AND a.source_name IS NOT NULL AND a.source_name <> ''
  `).all(...eventIds);
  const seen = new Map(); // eventId → Set("cc|outlet")
  for (const r of rows) {
    const cc = outletCountry(r.source_name, r.region);
    if (!cc) continue;
    const key = `${cc}|${r.source_name}`;
    if (!seen.has(r.event_id)) seen.set(r.event_id, new Set());
    if (seen.get(r.event_id).has(key)) continue; // one outlet counts once per event
    seen.get(r.event_id).add(key);
    if (!out.has(r.event_id)) out.set(r.event_id, new Map());
    const m = out.get(r.event_id);
    m.set(cc, (m.get(cc) || 0) + 1);
  }
  return out;
}

function countFor(byCountry, tier) {
  if (!byCountry) return 0;
  if (tier !== "EUROPE") return byCountry.get(tier) || 0;
  let n = 0;
  for (const [cc, c] of byCountry) if (EUROPE.has(cc)) n += c;
  return n;
}

/**
 * Stable partition of `rows` (already in prominence/recency order) for a reader in
 * `country`. Returns { rows, affinity: Map<id, n>, tiers } where `affinity` is the
 * outlet count for the reader's own country (0 under the fallback).
 */
export function reorderByCountry(db, rows, country) {
  const cc = parseCountry(country);
  if (!cc || !rows.length) return { rows, affinity: new Map(), tiers: [] };
  const byEvent = outletCountriesByEvent(db, rows.map((r) => r.id));
  const tiers = hasCountrySources(cc) ? [cc] : [...FALLBACK_TIERS];
  const buckets = tiers.map(() => []);
  const rest = [];
  const affinity = new Map();
  for (const r of rows) {
    const m = byEvent.get(r.id);
    affinity.set(r.id, tiers[0] === cc ? countFor(m, cc) : 0);
    const i = tiers.findIndex((t) => countFor(m, t) >= 1);
    (i === -1 ? rest : buckets[i]).push(r);
  }
  return { rows: [...buckets.flat(), ...rest], affinity, tiers };
}

export const _test = { EUROPE_NOT_UK, TAG_TO_COUNTRY, COVERED };
