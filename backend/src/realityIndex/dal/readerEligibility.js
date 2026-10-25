/**
 * readerEligibility — #243. "May a reader be shown this event in a list?"
 *
 * DrJ's audit (25 Oct 2026) found incoherent and single-source "events" leading
 * reader pages: a 206-article blob of unrelated finance stories as the Today
 * lead, Hacker News posts as two events, one outlet's earnings transcripts for
 * many companies as one event. They predate the #179 coherence gate, which only
 * holds NEW articles out.
 *
 * This module HIDES, it never deletes or rewrites: no stored event row is
 * touched (deletion or repair is stop-list item 1 and waits for DrJ). Every
 * reader list asks the same question through this one module:
 *
 *   1. sources      — at least MIN_SOURCES (3) distinct named outlets;
 *   2. dominance    — no single outlet supplies more than MAX_SOURCE_SHARE (70%)
 *                     of the event's articles that carry an outlet name;
 *   3. coherence    — the #179 score (eventCoherence.js, which is storyAffinity's
 *                     measure; no second similarity) is not below its floor
 *                     (EVENT_COHERENCE_FLOOR, default 0.60).
 *
 * Rules 1 and 2 are pure SQL (`sourceEligibleSql`), so a list query can filter
 * BEFORE its LIMIT and pages stay full. Rule 3 needs entity keys, so it runs in
 * JS on the rows a query returned (`filterReaderEligible`), with a per-event
 * cache.
 *
 * UNMEASURED COHERENCE: an event with too few entity-keyed members scores null
 * (eventCoherence's contract). Null is not a pass, but it is not evidence of
 * incoherence either, so rule 3 does not hide on null; rules 1 and 2 still
 * apply to it. The report script lists those events as "coherence unmeasured".
 *
 * MACHINE EVENTS (USGS/NOAA) are exempt: they carry no articles by design, and
 * the reader list already keeps them out unless a quake/weather surface asks
 * with ?include_machine=1 (CLAUDE.md). These rules are about news coverage.
 *
 * Flag: EVENT_READER_ELIGIBILITY, default ON (it only hides). "false" or "0"
 * turns every rule off and every list is byte-identical to before.
 */

import { eventCoherence, coherenceFloor, readCtx } from "../intelligence/eventCoherence.js";
import { notMachineEventSql, isMachineEvent } from "./machineEvents.js";

export const MIN_SOURCES = 3;
export const MAX_SOURCE_SHARE = 0.7;

/** Read at call time, so a flip needs no rebuild and tests can toggle it. */
export function readerEligibilityOn() {
  const v = String(process.env.EVENT_READER_ELIGIBILITY ?? "true").trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "off");
}

// Named outlets only: a NULL or empty source_name is not a second voice.
const NAMED = "a.source_name IS NOT NULL AND a.source_name <> ''";

/**
 * SQL predicate for rules 1 and 2 over an events alias. Returns "1=1" when the
 * flag is off, so callers can always splice it in.
 */
export function sourceEligibleSql(alias = "e") {
  if (!readerEligibilityOn()) return "1=1";
  return `(NOT ${notMachineEventSql(alias)} OR (
    (SELECT COUNT(DISTINCT a.source_name) FROM event_articles ea JOIN articles a ON a.id = ea.article_id
       WHERE ea.event_id = ${alias}.id AND ${NAMED}) >= ${MIN_SOURCES}
    AND (SELECT MAX(c) FROM (SELECT COUNT(*) AS c FROM event_articles ea JOIN articles a ON a.id = ea.article_id
           WHERE ea.event_id = ${alias}.id AND ${NAMED} GROUP BY a.source_name))
        <= ${MAX_SOURCE_SHARE} * (SELECT COUNT(*) FROM event_articles ea JOIN articles a ON a.id = ea.article_id
           WHERE ea.event_id = ${alias}.id AND ${NAMED})
  ))`;
}

// ── Per-event evaluation (all three rules, with reasons) ────────────────────
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new WeakMap(); // db → Map(eventId → { at, members, result })

function sourceStats(db, eventId) {
  const rows = db.prepare(`
    SELECT a.source_name AS s, COUNT(*) AS c FROM event_articles ea JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ? AND ${NAMED} GROUP BY a.source_name ORDER BY c DESC
  `).all(eventId);
  const named = rows.reduce((n, r) => n + r.c, 0);
  return { sources: rows.length, named, topSource: rows[0]?.s ?? null, topShare: named ? rows[0].c / named : null };
}

/**
 * → { eligible, reasons: string[], sources, topSource, topShare, coherence, floor }
 * Reasons are "too_few_sources", "one_source_dominates", "incoherent".
 * With the flag off: { eligible: true, reasons: [], off: true }.
 */
export function eventReaderEligibility(db, eventId, { now = Date.now(), useCache = true } = {}) {
  if (!readerEligibilityOn()) return { eligible: true, reasons: [], off: true };
  const row = db.prepare("SELECT meta FROM events WHERE id = ?").get(eventId);
  if (row && isMachineEvent(row)) return { eligible: true, reasons: [], machine: true };
  const ids = db.prepare("SELECT article_id FROM event_articles WHERE event_id = ?").all(eventId).map((r) => r.article_id);
  let byDb = cache.get(db);
  if (!byDb) { byDb = new Map(); cache.set(db, byDb); }
  const hit = useCache ? byDb.get(eventId) : null;
  if (hit && now - hit.at < CACHE_TTL_MS && hit.members === ids.length) return hit.result;

  const s = sourceStats(db, eventId);
  const floor = coherenceFloor();
  const reasons = [];
  if (s.sources < MIN_SOURCES) reasons.push("too_few_sources");
  if (s.topShare !== null && s.topShare > MAX_SOURCE_SHARE) reasons.push("one_source_dominates");
  const coh = eventCoherence(readCtx(db, now), db, ids).score;
  if (coh !== null && coh < floor) reasons.push("incoherent");
  const result = {
    eligible: reasons.length === 0, reasons,
    sources: s.sources, topSource: s.topSource,
    topShare: s.topShare === null ? null : Math.round(s.topShare * 1000) / 1000,
    coherence: coh, floor, members: ids.length,
  };
  byDb.set(eventId, { at: now, members: ids.length, result });
  return result;
}

export function isReaderEligible(db, eventId, opts) {
  return eventReaderEligibility(db, eventId, opts).eligible;
}

/** Keep only the rows a reader may see. Flag off → the input array itself. */
export function filterReaderEligible(db, rows, { idKey = "id", now = Date.now() } = {}) {
  if (!readerEligibilityOn() || !rows?.length) return rows;
  return rows.filter((r) => isReaderEligible(db, r[idKey], { now }));
}

/** Test hook: drop the per-event cache for one DB handle. */
export function _clearEligibilityCache(db) { cache.delete(db); }
