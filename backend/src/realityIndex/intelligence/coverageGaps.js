/**
 * coverageGaps.js — Coverage Gaps (#262, plan v7 Phase 3).
 *
 * A gap is a story that many outlets in one REGION are covering while outlets in
 * another region, which were publishing in the same window, carry nothing on it.
 *
 * BINDING DECISION (DrJ): gaps are measured by region, never by political leaning.
 * There is no leaning data anywhere in this module and none may be added.
 *
 * WHERE AN OUTLET IS comes from ONE place: countryAffinity.outletCountry (#190).
 * This module only folds those countries into fixed region buckets.
 *
 * READ-ONLY. computeGaps() never writes. The weekly report (runWeeklyGapReport)
 * inserts one row per week into coverage_gap_reports and never touches an
 * existing row: a week that already has a report is left exactly as it is.
 *
 * HONESTY RULES (docs/agentic-workflow.md §5):
 *   - an outlet with no known region is UNKNOWN and is never counted as present
 *     or absent; the share of such outlets is returned with every result;
 *   - an event where UNKNOWN outlets are more than half of its outlets in the
 *     window is skipped (its regional spread is unmeasured, not measured as zero);
 *   - a region with fewer than GAP_MIN_BASE outlets publishing in the window can
 *     never be the "absent" side (its silence means nothing);
 *   - the candidate query has a cap, and the result says whether it was hit.
 *
 * Every kept gap and every skip-reason count emits a 🧭 line (gap-found / gap-skip).
 */

import { outletCountry, outletCountriesByEvent, EUROPE } from "../dal/countryAffinity.js";
import { sourceEligibleSql, filterReaderEligible } from "../dal/readerEligibility.js";
import { notMachineEventSql } from "../dal/machineEvents.js";
import { isExplicitHarmHeadline } from "../../services/editorialSensitivity.js";
import { logger } from "../../services/logger.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const UNKNOWN = "UNKNOWN";

/** The bucket table, in display order. `countries` documents the fold; OTHER is "any other resolved country". */
export const BUCKET_TABLE = Object.freeze([
  { id: "US",          label: "US",          countries: ["US"] },
  { id: "UK",          label: "UK",          countries: ["GB"] },
  { id: "EUROPE",      label: "Europe",      countries: [...EUROPE].sort() },
  { id: "MIDDLE_EAST", label: "Middle East", countries: ["AE", "SA", "QA", "IL"] },
  { id: "SOUTH_ASIA",  label: "South Asia",  countries: ["PK", "IN"] },
  { id: "OTHER",       label: "Other",       countries: [] },
  { id: UNKNOWN,       label: "Unknown",     countries: [] },
]);

const BY_COUNTRY = (() => {
  const m = new Map();
  for (const b of BUCKET_TABLE) for (const cc of b.countries) m.set(cc, b.id);
  return m;
})();

/** Region bucket for a country code from outletCountry (null → UNKNOWN). */
export function bucketOf(cc) {
  if (!cc || cc === UNKNOWN) return UNKNOWN;
  return BY_COUNTRY.get(String(cc).toUpperCase()) || "OTHER";
}

const intEnv = (name, def, env) => {
  const n = Number.parseInt(String(env[name] ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};

/** Thresholds, read at call time so a change needs no rebuild. */
export function gapConfig(env = process.env) {
  return {
    minPresent: intEnv("GAP_MIN_PRESENT", 4, env),
    minBase:    intEnv("GAP_MIN_BASE", 5, env),
    dailyMax:   intEnv("GAP_DAILY_MAX", 10, env),
  };
}

/** The weekly cron is ON by default (flag flip, 24 h dark after #268); COVERAGE_GAPS_ENABLED=0 switches it off (read at call time). */
export const coverageGapsEnabled = (env = process.env) => String(env.COVERAGE_GAPS_ENABLED ?? "1") === "1";

const CANDIDATE_CAP = 3000;

/**
 * Per-bucket "active base": distinct outlets that published ANY article in the window.
 * An outlet counts once, in the bucket of the first row that places it.
 */
export function activeBases(db, { since, until }) {
  const rows = db.prepare(`
    SELECT DISTINCT source_name, region FROM articles
    WHERE published_at >= ? AND published_at <= ?
      AND source_name IS NOT NULL AND source_name <> ''
  `).all(since, until);
  const outlet = new Map(); // name → bucket
  for (const r of rows) {
    const b = bucketOf(outletCountry(r.source_name, r.region));
    const prev = outlet.get(r.source_name);
    if (prev === undefined || (prev === UNKNOWN && b !== UNKNOWN)) outlet.set(r.source_name, b);
  }
  const bases = Object.fromEntries(BUCKET_TABLE.map((b) => [b.id, 0]));
  for (const b of outlet.values()) bases[b] += 1;
  const total = outlet.size;
  return { bases, activeOutlets: total, unknownShare: total ? round3(bases[UNKNOWN] / total) : null };
}

function round3(x) { return Math.round(x * 1000) / 1000; }

/**
 * The gaps for one window. Read-only.
 *
 * @param {object} o
 * @param {number} [o.now]       end of the window (ms)
 * @param {number} [o.windowH]   window length in hours (24 daily, 168 weekly)
 * @param {string[]} [o.statuses] event statuses considered ("active" daily; the weekly
 *                                report adds "dormant" so a story that cooled during the
 *                                week still counts)
 * @param {number} [o.max]       how many gaps to keep (GAP_DAILY_MAX by default)
 * @returns {{ items, method, measured_by: "region", skips }}
 */
export function computeGaps(db, { now = Date.now(), windowH = 24, statuses = ["active"], max = null, env = process.env } = {}) {
  const cfg = gapConfig(env);
  const keep = max ?? cfg.dailyMax;
  const until = now;
  const since = now - windowH * HOUR_MS;

  const base = activeBases(db, { since, until });

  const statusSql = statuses.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT e.id, e.slug, e.title, e.last_activity_at, e.meta
    FROM events e
    WHERE e.status IN (${statusSql})
      AND e.last_activity_at >= ?
      AND EXISTS (SELECT 1 FROM event_articles ea WHERE ea.event_id = e.id)
      AND ${notMachineEventSql("e")}
      AND ${sourceEligibleSql("e")}
    ORDER BY e.last_activity_at DESC
    LIMIT ${CANDIDATE_CAP + 1}
  `).all(...statuses, since);
  const capped = rows.length > CANDIDATE_CAP;
  const candidates = filterReaderEligible(db, capped ? rows.slice(0, CANDIDATE_CAP) : rows, { now });

  const byEvent = outletCountriesByEvent(db, candidates.map((r) => r.id), { since, until, unknownKey: UNKNOWN });
  const skips = { "unknown-majority": 0, "small-base": 0, harm: 0 };
  const found = [];

  for (const ev of candidates) {
    if (isExplicitHarmHeadline(ev.title)) { skips.harm += 1; continue; }
    const counts = Object.fromEntries(BUCKET_TABLE.map((b) => [b.id, 0]));
    for (const [cc, n] of byEvent.get(ev.id) || []) counts[bucketOf(cc)] += n;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!total) continue;
    if (counts[UNKNOWN] * 2 > total) { skips["unknown-majority"] += 1; continue; }

    let best = null;
    let smallBaseOnly = false;
    for (const A of BUCKET_TABLE) {
      if (A.id === UNKNOWN || counts[A.id] < cfg.minPresent || !base.bases[A.id]) continue;
      // The absent side: a measured region with zero outlets on the story. Of those, the one
      // with the largest active base is the most telling silence.
      let absent = null;
      for (const B of BUCKET_TABLE) {
        if (B.id === UNKNOWN || B.id === A.id || counts[B.id] !== 0) continue;
        if (base.bases[B.id] < cfg.minBase) { smallBaseOnly = true; continue; }
        if (!absent || base.bases[B.id] > absent.activeBase) absent = { bucket: B.id, activeBase: base.bases[B.id] };
      }
      if (!absent) continue;
      const score = round3(counts[A.id] / base.bases[A.id]);
      if (!best || score > best.score) best = { present: { bucket: A.id, outlets: counts[A.id] }, absent, score };
    }
    if (!best) { if (smallBaseOnly) skips["small-base"] += 1; continue; }
    found.push({ slug: ev.slug, title: ev.title, ...best, _at: ev.last_activity_at });
  }

  found.sort((a, b) => b.score - a.score || b.present.outlets - a.present.outlets || b._at - a._at);
  const items = found.slice(0, keep).map(({ _at, ...it }) => it);

  for (const it of items) {
    logger.info(`🧭 gap-found slug=${it.slug} present=${it.present.bucket}:${it.present.outlets}/${base.bases[it.present.bucket]} absent=${it.absent.bucket} base=${it.absent.activeBase} score=${it.score}`);
  }
  for (const [reason, n] of Object.entries(skips)) if (n) logger.info(`🧭 gap-skip reason=${reason} n=${n}`);

  return {
    measured_by: "region",
    items,
    skips,
    method: {
      buckets: BUCKET_TABLE.map(({ id, label, countries }) => ({ id, label, countries })),
      minPresent: cfg.minPresent,
      minBase: cfg.minBase,
      unknownShare: base.unknownShare,
      bases: base.bases,
      activeOutlets: base.activeOutlets,
      windowH,
      since,
      until,
      statuses,
      candidates: candidates.length,
      candidateCap: CANDIDATE_CAP,
      capped,
      found: found.length,
      kept: items.length,
    },
  };
}

// ── Weekly Gap Report ────────────────────────────────────────────────────────

/** Monday 00:00 UTC on or before `ms`, as YYYY-MM-DD. */
export function mondayOf(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

/** The week that ended most recently before `now`: its Monday, and the window [start, start+7d). */
export function lastFullWeek(now = Date.now()) {
  const weekStart = mondayOf(now - 7 * DAY_MS);
  const startMs = Date.parse(`${weekStart}T00:00:00Z`);
  return { weekStart, startMs, endMs: startMs + 7 * DAY_MS - 1 };
}

export const WEEKLY_MAX = 20;

/**
 * Store the Gap Report for the last full week, once. Insert-only: an existing
 * week_start row is left alone and nothing is recomputed for it.
 * → { weekStart, inserted: boolean, kept? }
 */
export function runWeeklyGapReport(db, { now = Date.now(), env = process.env } = {}) {
  const { weekStart, endMs } = lastFullWeek(now);
  const exists = db.prepare("SELECT 1 FROM coverage_gap_reports WHERE week_start = ?").get(weekStart);
  if (exists) {
    logger.info(`🧭 gap-weekly week=${weekStart} already stored; left unchanged`);
    return { weekStart, inserted: false };
  }
  const r = computeGaps(db, { now: endMs, windowH: 168, statuses: ["active", "dormant"], max: WEEKLY_MAX, env });
  const info = db.prepare(`
    INSERT OR IGNORE INTO coverage_gap_reports (week_start, generated_at, body_json, method_json)
    VALUES (?, ?, ?, ?)
  `).run(weekStart, now, JSON.stringify({ items: r.items, skips: r.skips }), JSON.stringify(r.method));
  logger.info(`🧭 gap-weekly week=${weekStart} stored=${info.changes === 1} kept=${r.items.length} unknownShare=${r.method.unknownShare}`);
  return { weekStart, inserted: info.changes === 1, kept: r.items.length };
}

/** A stored report (latest when weekStart is omitted), parsed; null when none. */
export function readWeeklyGapReport(db, weekStart = null) {
  const row = weekStart
    ? db.prepare("SELECT * FROM coverage_gap_reports WHERE week_start = ?").get(weekStart)
    : db.prepare("SELECT * FROM coverage_gap_reports ORDER BY week_start DESC LIMIT 1").get();
  if (!row) return null;
  const body = JSON.parse(row.body_json || "{}");
  return {
    measured_by: "region",
    week_start: row.week_start,
    generated_at: row.generated_at,
    items: body.items || [],
    skips: body.skips || {},
    method: JSON.parse(row.method_json || "{}"),
  };
}
