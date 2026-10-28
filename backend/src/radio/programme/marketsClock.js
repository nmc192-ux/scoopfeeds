/**
 * marketsClock.js - is a market row today's move, or the last session's? (#245)
 *
 * On a weekend, a holiday or before the open, the quote feeds still return the LAST session's price and
 * percent change. Read as "the Dow is up 0.4 percent" on a Sunday, that is Friday's move presented as today's.
 *
 *   labelMarkets(pack, at)   stamps every non-crypto row with `closed` when its last trade is not on the same
 *                            local day (in its exchange's time zone) as `at`, the air time. A row with no usable
 *                            trade time is closed too: never treated as live. Crypto trades 24/7 and is left alone.
 *   staleMarketLine(text, rows)   null when a Markets line may air; otherwise why not. A line that names a
 *                            closed row must say it is a close ("closed", "on Friday", ...) and no sentence
 *                            naming it may present it as now ("is up", "today", "this afternoon", ...).
 *
 * Pure: no I/O and no clock reads. Exchange holidays are not modelled, and need not be: on a holiday the last
 * trade is from the previous session, so the same-day rule marks it closed.
 */
import { sessionsAt } from "./dayClock.js";

/** Why the markets prompt must say the exchanges are shut at `ms`: "weekend", "overnight", or null (some exchange is in session). */
export function marketsShutAt(ms) {
  if (sessionsAt(ms).length) return null;
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date(ms));
  return ["Sat", "Sun"].includes(wd) ? "weekend" : "overnight";
}

const TZ_BY_SYM = {
  "^GSPC": "America/New_York", "^DJI": "America/New_York", "^IXIC": "America/New_York",
  "^FTSE": "Europe/London", "^GDAXI": "Europe/Berlin", "^N225": "Asia/Tokyo",
  "BZ=F": "America/New_York", "GC=F": "America/New_York",   // futures: their trading day, read in New York time
};
const TZ_BY_GROUP = { US: "America/New_York", Europe: "Europe/London", Asia: "Asia/Tokyo", Commodities: "America/New_York" };
const FUTURE_SLACK_MS = 10 * 60_000;   // a trade stamped a little after `at` is clock skew, not the future

const dayKey = (ms, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const part = (ms, tz, o) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...o }).format(new Date(ms));

export const isCrypto = (row) => row?.group === "Crypto";
export const rowTz = (row) => TZ_BY_SYM[row?.sym] || TZ_BY_GROUP[row?.group] || "America/New_York";

/** `closed` for one row at air time `at`, or null when the row is today's. */
export function closedFor(row, at) {
  if (isCrypto(row)) return null;
  const t = Number(row?.time);
  if (!Number.isFinite(t) || t <= 0 || t > at + FUTURE_SLACK_MS) return { label: "closed: last trade time unknown, not today's move", weekday: null, day: null };
  const tz = rowTz(row);
  if (dayKey(t, tz) === dayKey(at, tz)) return null;
  const weekday = part(t, tz, { weekday: "long" });
  const day = Number(part(t, tz, { day: "numeric" }));
  const month = part(t, tz, { month: "short" });
  return { label: `closed: at ${weekday}'s close, ${day} ${month}`, weekday, day, month, time: t };
}

/** Stamp every market row; records the air time the check was made for (airCheck refuses an unstamped pack). */
export function labelMarkets(pack, at) {
  if (!Number.isFinite(at)) throw new Error("labelMarkets: at must be a number");
  pack.markets = (pack.markets || []).map((r) => {
    const { closed: _old, ...row } = r;
    const c = closedFor(row, at);
    return c ? { ...row, closed: c } : row;
  });
  pack.marketsCheckedAt = at;
  return pack;
}

export const closedRows = (rows) => (rows || []).filter((r) => r?.closed);

// ── line check ──────────────────────────────────────────────────────────────
const ALIASES = {
  "S&P 500": /\bS ?(&|and) ?P\b/i, Dow: /\bDow\b/i, Nasdaq: /\bNasdaq\b/i, "FTSE 100": /\bFTSE\b|\bFootsie\b/i,
  DAX: /\bDAX\b/i, Brent: /\bBrent\b|\boil\b|\bcrude\b/i, Gold: /\bgold\b/i,
};
const nameRe = (row) => ALIASES[row.key] || new RegExp(`\\b${String(row.key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

const DAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
/** Wording that marks a figure as a close. */
export const CLOSED_WORDING = new RegExp(`\\b(closed|close|closing|ended|finished|settled|last session|last trade|last traded)\\b|\\b(on|last) (${DAYS})\\b|\\b(${DAYS})['’]s\\b`, "i");
/** Wording that presents a figure as happening now. */
export const NOW_WORDING = new RegExp([
  "\\btoday\\b", "\\btonight\\b", "\\bthis (morning|afternoon|evening|hour)\\b", "\\bright now\\b", "\\bcurrently\\b", "\\bat the moment\\b", "\\bso far\\b",
  "\\b(is|are|it's|it’s|stands|sits|trades|'s|’s)\\s+(now\\s+)?(up|down|higher|lower|flat|unchanged|at|trading|rising|falling|gaining|losing|climbing|sliding|slipping|edging|rallying)\\b",
  "\\b(rising|falling|gaining|climbing|sliding|slipping|rallying)\\b",
].join("|"), "i");
const AS_OF_CLOCK = /\bas of \d{1,2}(:\d{2})?\b/i;
const sentences = (t) => String(t).split(/(?<=[.!?])\s+/).filter(Boolean);

/** null when the line may air; otherwise why it may not. Rows without `closed` are today's and never trip it. */
export function staleMarketLine(text, rows) {
  const closed = closedRows(rows);
  if (!closed.length || !text) return null;
  const named = closed.filter((r) => nameRe(r).test(text));
  if (!named.length) return null;
  const keys = named.map((r) => r.key).join(", ");
  if (!CLOSED_WORDING.test(text)) return `markets: ${keys} is from the last session but the line does not say it is a close`;
  for (const sn of sentences(text)) {
    if (!named.some((r) => nameRe(r).test(sn))) continue;
    if (NOW_WORDING.test(sn)) return `markets: ${keys} is from the last session but the line presents it as today's move`;
    if (AS_OF_CLOCK.test(sn) && !new RegExp(`\\b(${DAYS})\\b`, "i").test(sn)) return `markets: ${keys} is from the last session but the line gives it "as of" a time today`;
  }
  return null;
}

/** Dates a closed row's label names ("24 October", "October 24") are not market figures: strip them before the figures check. */
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
export function stripCloseDates(text, rows) {
  const days = new Set(closedRows(rows).map((r) => r.closed.day).filter(Number.isFinite));
  if (!days.size) return text;
  const keep = (m, d) => (days.has(Number(d)) ? " " : m);
  return String(text)
    .replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})\\b\\.?`, "gi"), keep)
    .replace(new RegExp(`\\b(?:${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi"), keep);
}

// ── the overnight repeat (#249) ─────────────────────────────────────────────
/** A Markets Now slot ("markets-1", "markets-2"), by id: the programme's slot list does not keep the segment. */
export const isMarketsSlot = (s) => /^markets(-|$)/.test(String(s?.id || ""));

/**
 * #249: a repeated hour's Markets Now lines, re-checked against its own pack re-labelled at the REPEAT's air time
 * (each slot's start + 1 min, as produce.mjs labels a fresh pack). Only slots still spoken are checked: a slot that
 * was already music (too few market rows) airs no market lines. A slot whose lines or pack cannot be read is
 * `measured: false`, never a pass. Pure.
 * @returns {{ id, start, end, airAt, measured: boolean, why?: string, lines?: number, stale: string[] }[]}
 */
export function recheckRepeatedMarkets(slots, segments, pack) {
  return (slots || []).filter((s) => isMarketsSlot(s) && s.kind === "spoken").map((s) => {
    const base = { id: s.id, start: s.start, end: s.end, airAt: s.start + 60_000, stale: [] };
    if (!Number.isFinite(s.start)) return { ...base, measured: false, why: `${s.id} has no start time` };
    if (!Array.isArray(pack?.markets)) return { ...base, measured: false, why: "the repeated hour's pack.json is missing or has no market rows" };
    const seg = segments?.[s.id];
    if (!seg || !Array.isArray(seg.lines)) return { ...base, measured: false, why: `the repeated hour's ${s.id} lines are not in its segments.json` };
    const rows = labelMarkets({ markets: pack.markets }, base.airAt).markets;
    const stale = seg.lines.map((l) => { const why = staleMarketLine(l?.text, rows); return why ? `${l?.id}: ${why}` : null; }).filter(Boolean);
    return { ...base, measured: true, lines: seg.lines.length, stale };
  });
}

// ── the programme screen (#282) ─────────────────────────────────────────────
/** A labelled copy of market rows at `at` (labelMarkets on a throwaway pack). Pure. */
export const labelRows = (rows, at) => labelMarkets({ markets: Array.isArray(rows) ? rows : [] }, at).markets;

/**
 * #282: stamp `closed` on every market row the programme screen shows, against the time it is SHOWN: a Markets
 * scene's rows at the end of that scene (the next non-overlay cue, else the hour's end), the right rail's rows at
 * the hour's end. The figures were fetched before the hour, so a row live at the end of its showing is live
 * throughout it; the later time is the stricter one. Run after a fresh produce and after a repeat is retimed, so
 * a repeated hour is labelled against its own air time. Crypto is untouched. Pure.
 */
export function labelScreenMarkets(prog) {
  const cues = prog.cues || [];
  const end = Number.isFinite(prog.endsAt) ? prog.endsAt : (Number(prog.hourStart) || 0) + 3_600_000;
  const shownUntil = (c) => cues.reduce((m, o) => (!o.overlay && o.at > c.at && o.at < m ? o.at : m), end);
  const out = {
    ...prog,
    cues: cues.map((c) => (c.scene === "markets" && Array.isArray(c.data?.rows) && Number.isFinite(c.at)
      ? { ...c, data: { ...c.data, rows: labelRows(c.data.rows, Math.max(c.at, shownUntil(c))) } } : c)),
  };
  if (Array.isArray(prog.rail?.markets)) out.rail = { ...prog.rail, markets: labelRows(prog.rail.markets, end) };
  return out;
}
