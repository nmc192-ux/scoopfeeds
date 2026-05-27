/**
 * trackerDetector — the Tracker Auto-Detection Engine.
 *
 * Reads events post-promotion (made-existing by eventPromoter.js), evaluates
 * per-template trigger conditions, and creates tracker_instances via the
 * Sprint 1.2 DAO (backend/src/models/trackers.js). Each detector is
 * independent; multi-template fan-out is allowed (an event can carry more
 * than one tracker if multiple template types apply). Per-(event_id,
 * template_type) dedup is enforced cheaply at the composer via
 * listTrackersByEvent before each createTracker call (DAO-layer rather than
 * SQL UNIQUE per locked decision 2).
 *
 * Pattern mirrors anomalyDetector.js — constants at top, one detector
 * function per template type, one composer with per-detector try/catch and
 * counted output. Editorial-seed triggers are out of scope (auto-detection
 * only per locked decision 5); operators create trackers manually via the
 * DAO.
 *
 * Sprint 1.3.2 scope: scaffolding for all 8 template types plus live
 * implementations for conflict + environmental (the two templates with the
 * cleanest live source-feed signals — ACLED and USGS/NOAA respectively).
 * The remaining 6 detectors are scaffolded as no-op stubs returning [] so
 * the composer loop stays uniform; Sprint 1.3.3 fills them in.
 *
 * Initial metrics on tracker creation are minimal and honest — we write
 * only what the event row genuinely provides. Empty `{}` is acceptable per
 * Sprint 1.2 spec; subsequent ingestion cycles populate the rest. We never
 * fabricate values or default-to-zero — absence is the honest signal that
 * a measurement does not yet exist.
 *
 * Scheduler hook is NOT in this sprint (deferred to Sprint 1.3.4). The
 * detector currently runs only when called directly (or by the local
 * verification harness).
 */

import { getDb } from "../../models/database.js";
import { logger } from "../../services/logger.js";
import {
  createTracker,
  listTrackersByEvent,
  TEMPLATE_TYPES,
} from "../../models/trackers.js";

// ─── Constants ─────────────────────────────────────────────────────────────
// Harvested from the 8 templates' §1 trigger conditions. Sprint 1.1 set the
// per-template wire-density windows and minimum article counts.

// events.category strings that each template should consider. Union of:
// (a) the categories named in each template's §1 wire-density trigger,
// (b) the categories actually written by today's ingesters (ACLED writes
//     'conflict' directly; USGS writes 'geo'; NOAA writes 'weather') — these
//     are surfaced by the Sprint 1.3 investigation and added to the filter
//     so source-feed-originated events are matched even if their category
//     differs from the wire-cluster vocabulary.
//
// TODO (Sprint 1.3.3+ cleanup): there is a small but real gap between what
// the 8 templates' §1 says (e.g., conflict.md: "politics or international
// clusters") and what live ingesters actually write (ACLED writes
// category='conflict'). This filter papers over the gap by accepting both
// sides of the union. Future cleanup is one of two paths — neither is
// strictly better, both worth weighing:
//   (i)  Align the template §1 docs with ingester reality (cheaper; pure
//        documentation update).
//   (ii) Align ingester output with template categories (cleaner data
//        model; requires touching live ingesters).
// Do not fix now — this filter is correct in behavior, just slightly
// over-broad. Surface the gap in Sprint 1.3.3 retrospective.
const TEMPLATE_CATEGORY_FILTER = Object.freeze({
  conflict:      ["politics", "international", "conflict"],
  outbreak:      ["medicine", "public-health", "health"],
  incident:      ["top", "international", "politics"],
  sports:        ["sports"],
  environmental: ["environment", "international", "top", "geo", "weather"],
  election:      ["politics", "international"],
  entertainment: ["entertainment", "top"],
  study:         ["science", "medicine", "public-health", "health"],
});

// Wire-density triggers per template §1 — minimum distinct dispatches over
// the rolling window. Used when no source-feed signal is present.
const WIRE_DENSITY = Object.freeze({
  conflict:      { min: 3, windowMs: 14 * 24 * 60 * 60 * 1000 },
  outbreak:      { min: 3, windowMs: 14 * 24 * 60 * 60 * 1000 },
  incident:      { min: 3, windowMs:      24 * 60 * 60 * 1000 },
  sports:        { min: 3, windowMs:  7 * 24 * 60 * 60 * 1000 },
  environmental: { min: 5, windowMs:      24 * 60 * 60 * 1000 },
  election:      { min: 5, windowMs:      24 * 60 * 60 * 1000 },
  entertainment: { min: 3, windowMs:      24 * 60 * 60 * 1000 },
  study:         { min: 5, windowMs: 14 * 24 * 60 * 60 * 1000 },
});

// Source-feed availability per template — recorded on tracker creation in
// data_source_provenance per Sprint 1.2 spec §5. "live" = a dedicated
// ingester writes events directly for this template. "wire-aggregation-only"
// = trackers depend on article clustering alone (templates' documented
// data-source gaps).
const INGESTER_TAG = Object.freeze({
  conflict:      "live",                       // ACLED (slug prefix "acled-")
  outbreak:      "wire-aggregation-only",
  incident:      "wire-aggregation-only",
  sports:        "live",                       // SportsDB
  environmental: "live",                       // USGS ("usgs-") + NOAA ("noaa-")
  election:      "wire-aggregation-only",
  entertainment: "live",                       // TMDB
  study:         "wire-aggregation-only",
});

// Slug prefixes that signal source-feed origin. When an event matches one
// of these, the detector skips the wire-density check and fires the
// trigger directly — the source ingester is itself the high-confidence
// signal. Sprint 1.3.2 wires this for ACLED/USGS/NOAA; Sprint 1.3.3 adds
// SportsDB/TMDB prefixes when those detectors land.
const SOURCE_FEED_SLUG_PREFIXES = Object.freeze({
  conflict:      ["acled-"],
  environmental: ["usgs-", "noaa-"],
  sports:        ["sports-"],          // Sprint 1.3.3a — sportsdbFetcher.js writes slug=`sports-${eventId}`
  entertainment: ["tmdb-"],            // Sprint 1.3.3a — tmdbFetcher.js writes slug=`tmdb-${mediaType}-${tmdbId}`
});

// ─── Helpers ───────────────────────────────────────────────────────────────

// Counts articles linked to an event within a recent window. Powers the
// wire-density check across all 8 detectors.
function countArticlesInWindow(eventId, windowMs, now) {
  const cutoff = now - windowMs;
  return getDb().prepare(`
    SELECT COUNT(*) AS n FROM event_articles
    WHERE event_id = ? AND added_at >= ?
  `).get(eventId, cutoff).n;
}

// Returns true if any tracker already exists for this (event, template_type)
// pair. Cheap dedup before each createTracker — locked decision 2.
function hasExistingTracker(eventId, templateType) {
  return listTrackersByEvent(eventId).some((t) => t.template_type === templateType);
}

// SELECT helper: events in matching categories that have been touched
// within the longest window for the template (covers both source-feed and
// wire-density paths in a single query). Filters status='active'.
function selectCandidateEvents(templateType, now) {
  const categories = TEMPLATE_CATEGORY_FILTER[templateType];
  const windowMs   = WIRE_DENSITY[templateType].windowMs;
  const cutoff     = now - windowMs;
  const placeholders = categories.map(() => "?").join(",");
  return getDb().prepare(`
    SELECT id, slug, title, category, severity, geo_country_codes,
           started_at, last_activity_at
    FROM events
    WHERE status = 'active'
      AND category IN (${placeholders})
      AND last_activity_at >= ?
    ORDER BY last_activity_at DESC
    LIMIT 500
  `).all(...categories, cutoff);
}

// Parses events.geo_country_codes (TEXT JSON array of ISO-2 codes). Returns
// null when absent or unparseable so callers can omit the metric block
// rather than write a fabricated empty value.
function parseGeoCountryCodes(raw) {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length > 0 ? arr : null;
  } catch {
    return null;
  }
}

function matchesSourceFeed(slug, prefixes) {
  if (!slug || !prefixes) return false;
  return prefixes.some((p) => slug.startsWith(p));
}

// ─── Detector: conflict ────────────────────────────────────────────────────
// Source-feed path: events with slug prefix "acled-" — ACLED is the
// gold-standard event verification source per conflict.md §6, so the trigger
// fires directly and the initial event_count + geographic_scope are written
// at 'confirmed' confidence.
//
// Wire-density path: events not from ACLED but in the politics/international
// cluster with ≥ 3 article-links over the 14d window. Initial metrics are
// written at 'provisional' confidence — wire density alone is suggestive,
// not verified.
function detectConflictTriggers(now) {
  const proposals = [];
  const events = selectCandidateEvents("conflict", now);
  for (const ev of events) {
    // Dedup is enforced once at the composer (single source of truth). The
    // detector's job is purely trigger evaluation — keeps detectors testable
    // in isolation and makes skipped_existing meaningful.
    const fromAcled = matchesSourceFeed(ev.slug, SOURCE_FEED_SLUG_PREFIXES.conflict);
    const articleCount = countArticlesInWindow(ev.id, WIRE_DENSITY.conflict.windowMs, now);
    if (!fromAcled && articleCount < WIRE_DENSITY.conflict.min) continue;

    // Confidence tier per source-feed vs wire-density origin. ACLED-origin
    // events are 'confirmed' (template §2 vocabulary); wire-density-origin
    // events are 'provisional'.
    const confidence = fromAcled ? "confirmed" : "provisional";
    const source     = fromAcled ? "ACLED" : "event_articles cluster";

    const metrics = {};
    if (articleCount > 0) {
      metrics.event_count = { value: articleCount, confidence, source, as_of: now };
    }
    const geo = parseGeoCountryCodes(ev.geo_country_codes);
    if (geo) {
      metrics.geographic_scope = { value: geo, confidence, source: "events.geo_country_codes", as_of: now };
    }

    proposals.push({
      event_id: ev.id,
      template_meta: { conflict_type: "unknown" },   // honest placeholder; refine in 1.3.3+
      data_source_provenance: { _ingester_status: INGESTER_TAG.conflict, _origin: fromAcled ? "acled" : "wire-density" },
      initial_metrics: metrics,
      started_at: ev.started_at,
    });
  }
  return proposals;
}

// ─── Detector: environmental ───────────────────────────────────────────────
// Source-feed path: events with slug prefix "usgs-" (earthquakes) or
// "noaa-" (severe weather). Both are USGS/NOAA official-instrument signals
// per environmental.md §3 — fire trigger directly, affected_area written
// at 'confirmed' confidence (geographic data is precise from the agency).
//
// Wire-density path: events in environment/weather/geo/top/international
// clusters with ≥ 5 article-links over 24h. Initial metrics at
// 'preliminary-reading' — wire density is suggestive only.
//
// Note: environmental.md §3.2 specifies a `scale` field on
// magnitude_intensity blocks (Mw / Saffir-Simpson / EF / VEI etc.). The
// event row does not carry a clean scale-typed magnitude — that's in
// events.meta or has to be parsed from the title — so this initial pass
// writes only affected_area. Sprint 1.3.3+ can extract magnitude from
// event.meta or event.severity once the parsing strategy is settled.
function detectEnvironmentalTriggers(now) {
  const proposals = [];
  const events = selectCandidateEvents("environmental", now);
  for (const ev of events) {
    // Dedup at composer; see detectConflictTriggers note.
    const fromFeed = matchesSourceFeed(ev.slug, SOURCE_FEED_SLUG_PREFIXES.environmental);
    const articleCount = countArticlesInWindow(ev.id, WIRE_DENSITY.environmental.windowMs, now);
    if (!fromFeed && articleCount < WIRE_DENSITY.environmental.min) continue;

    const confidence = fromFeed ? "confirmed" : "preliminary-reading";
    const originTag  = fromFeed
      ? (ev.slug.startsWith("usgs-") ? "usgs" : "noaa")
      : "wire-density";

    const metrics = {};
    const geo = parseGeoCountryCodes(ev.geo_country_codes);
    if (geo) {
      metrics.affected_area = { value: geo, confidence, source: "events.geo_country_codes", as_of: now };
    }

    proposals.push({
      event_id: ev.id,
      template_meta: { hazard_kind: "unknown" },     // honest placeholder; refine when meta-parsing lands
      data_source_provenance: { _ingester_status: INGESTER_TAG.environmental, _origin: originTag },
      initial_metrics: metrics,
      started_at: ev.started_at,
    });
  }
  return proposals;
}

// ─── Detector: sports ──────────────────────────────────────────────────────
// Source-feed path: events with slug prefix "sports-" (SportsDB fixtures).
// Wire-density path: events in the "sports" category with ≥ 3 article-links
// over the 7d window (per sports.md §1).
//
// Initial metrics = {} per Sprint 1.3.3a DrJ ruling (Q1, locked decision).
// Sports's confidence vocabulary is temporal (scheduled / live / final). We
// cannot honestly declare temporal state on detection without score data:
// SportsDB events can be future, in-progress, or completed; the slug alone
// doesn't tell us which. Tracker creation anchors the fixture; score
// ingestion (future work) populates metrics via updateTrackerMetrics with
// the appropriate tier at that point. Never claim live/final state without
// score data — that's the design discipline.
//
// template_meta carries fixture_kind + sport as "unknown" placeholders. The
// SportsDB title format is structured (`"<home> vs <away> — <league>"`) so
// `sport` and `league` could be parsed from the event title in a future
// pass; deferred deliberately — title-format parsing is fragile and belongs
// in a dedicated ingestion populator, not in detection.
// TODO (Sprint 1.3.3+ cleanup): parse sport/league from SportsDB title when
// the populator pattern is established.
function detectSportsTriggers(now) {
  const proposals = [];
  const events = selectCandidateEvents("sports", now);
  for (const ev of events) {
    const fromFeed = matchesSourceFeed(ev.slug, SOURCE_FEED_SLUG_PREFIXES.sports);
    const articleCount = countArticlesInWindow(ev.id, WIRE_DENSITY.sports.windowMs, now);
    if (!fromFeed && articleCount < WIRE_DENSITY.sports.min) continue;

    proposals.push({
      event_id: ev.id,
      template_meta: { fixture_kind: "unknown", sport: "unknown" },
      data_source_provenance: {
        _ingester_status: INGESTER_TAG.sports,
        _origin: fromFeed ? "source-feed" : "wire-density",
      },
      initial_metrics: {},
      started_at: ev.started_at,
    });
  }
  return proposals;
}

// ─── Detector: entertainment ───────────────────────────────────────────────
// Source-feed path: events with slug prefix "tmdb-" (TMDB ingester). The
// TMDB slug format is contractual — `tmdb-<mediaType>-<tmdbId>` where
// mediaType is "movie" or "tv" — so we can honestly derive title_kind from
// it (per Sprint 1.3.3a DrJ ruling Q2: derive from our own structured slug,
// not fabrication). The derivation is defensive: if the slug split doesn't
// produce the expected 3+ parts or the mediaType doesn't map cleanly,
// title_kind falls through to "unknown" rather than guessing.
//
// Wire-density path: events in entertainment/top clusters with ≥ 3
// article-links over the 24h window. title_kind = "unknown" — wire articles
// don't reveal title kind reliably (could be theatrical / streaming /
// series-arc / awards-event).
//
// Initial metrics = {} regardless. Entertainment metrics are all
// box-office / critical-reception / awards data — none of which the event
// row provides. Detection anchors the title; ingestion populates the rest.
function deriveTitleKindFromTmdbSlug(slug) {
  // Slug format contract: tmdb-<mediaType>-<tmdbId>. Split should yield
  // [..."tmdb", <mediaType>, <id...>]. Anything else → unknown (defensive
  // against ingester-format drift).
  if (!slug || !slug.startsWith("tmdb-")) return "unknown";
  const parts = slug.split("-");
  if (parts.length < 3) return "unknown";
  const mediaType = parts[1];
  if (mediaType === "movie") return "theatrical-release";
  if (mediaType === "tv")    return "series-arc";
  return "unknown";
}

function detectEntertainmentTriggers(now) {
  const proposals = [];
  const events = selectCandidateEvents("entertainment", now);
  for (const ev of events) {
    const fromFeed = matchesSourceFeed(ev.slug, SOURCE_FEED_SLUG_PREFIXES.entertainment);
    const articleCount = countArticlesInWindow(ev.id, WIRE_DENSITY.entertainment.windowMs, now);
    if (!fromFeed && articleCount < WIRE_DENSITY.entertainment.min) continue;

    const titleKind = fromFeed ? deriveTitleKindFromTmdbSlug(ev.slug) : "unknown";

    proposals.push({
      event_id: ev.id,
      template_meta: { title_kind: titleKind },
      data_source_provenance: {
        _ingester_status: INGESTER_TAG.entertainment,
        _origin: fromFeed ? "source-feed" : "wire-density",
      },
      initial_metrics: {},
      started_at: ev.started_at,
    });
  }
  return proposals;
}

// ─── Detector: not-yet-implemented stubs (Sprint 1.3.3b) ───────────────────
// Each returns []. The composer loop stays uniform so 1.3.3b can drop in
// real implementations without restructuring the composer. KEEP this
// scaffolding (NOT_IMPLEMENTED_DETECTORS dict + makeNotImplementedDetector
// + notImplementedLogged Set) even after 1.3.3b fills in the 4 quartet
// detectors — per Sprint 1.3.2 hygiene comment, it costs nothing and
// protects against a future 9th-template addition being introduced
// stub-first.

const NOT_IMPLEMENTED_DETECTORS = Object.freeze({
  outbreak:      "wire-density only (no WHO/ProMED ingester yet)",
  incident:      "wire-density only (no NTSB/ICAO/IMO ingester yet)",
  election:      "wire-density only (no electoral-commission ingester yet)",
  study:         "wire-density only (no journal-publication ingester yet)",
});
// Log-spam prevention: each not-yet-implemented detector logs once per
// process lifetime, then stays quiet. Keep this Set even after 1.3.3 fills
// in the detectors — it costs nothing and protects against a future stub
// being reintroduced (e.g., a 9th template added scaffold-first).
const notImplementedLogged = new Set();
function makeNotImplementedDetector(templateType) {
  return function () {
    if (!notImplementedLogged.has(templateType)) {
      notImplementedLogged.add(templateType);
      logger.info(`trackerDetector(${templateType}): not yet implemented (Sprint 1.3.3b) — ${NOT_IMPLEMENTED_DETECTORS[templateType]}`);
    }
    return [];
  };
}

// ─── Composer ──────────────────────────────────────────────────────────────
// runTrackerDetector — scans recent events, applies per-template triggers,
// creates tracker_instances. Returns a per-template counter object plus a
// skipped_existing total. Per-template try/catch so one detector failing
// doesn't poison the rest.

const DETECTORS = Object.freeze({
  conflict:      detectConflictTriggers,
  outbreak:      makeNotImplementedDetector("outbreak"),
  incident:      makeNotImplementedDetector("incident"),
  sports:        detectSportsTriggers,
  environmental: detectEnvironmentalTriggers,
  election:      makeNotImplementedDetector("election"),
  entertainment: detectEntertainmentTriggers,
  study:         makeNotImplementedDetector("study"),
});

export function runTrackerDetector() {
  const now = Date.now();
  const out = {
    conflict: 0, outbreak: 0, incident: 0, sports: 0,
    environmental: 0, election: 0, entertainment: 0, study: 0,
    skipped_existing: 0,
  };

  for (const templateType of TEMPLATE_TYPES) {
    try {
      const proposals = DETECTORS[templateType](now);
      for (const p of proposals) {
        // Re-check existence inside the loop in case a prior iteration
        // (multi-template fan-out) just created a sibling — keeps dedup
        // honest under concurrent template evaluation.
        if (hasExistingTracker(p.event_id, templateType)) {
          out.skipped_existing++;
          continue;
        }
        try {
          createTracker({
            event_id:               p.event_id,
            template_type:          templateType,
            metrics:                p.initial_metrics,
            template_meta:          p.template_meta,
            data_source_provenance: p.data_source_provenance,
            started_at:             p.started_at,
          });
          out[templateType]++;
        } catch (err) {
          // DAO-layer TrackerValidationError or DB constraint — log and
          // continue so a single malformed proposal can't block the cycle.
          logger.warn(`trackerDetector(${templateType}): proposal for event ${p.event_id} rejected — ${err.message}`);
        }
      }
    } catch (err) {
      logger.warn(`trackerDetector(${templateType}): detector failed — ${err.message}`);
    }
  }

  const totalCreated = TEMPLATE_TYPES.reduce((s, t) => s + out[t], 0);
  if (totalCreated > 0 || out.skipped_existing > 0) {
    logger.info(`🎯 trackerDetector: ${totalCreated} new, ${out.skipped_existing} skipped-existing ${JSON.stringify(out)}`);
  }
  return out;
}
