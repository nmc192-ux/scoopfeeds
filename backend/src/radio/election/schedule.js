/**
 * schedule.js — when the election map goes on air (#204 build item 4).
 *
 *  - Top-of-hour headlines on 3–6 Nov (New York dates): the map is shown in the headlines.
 *  - Election night, 3 Nov 18:00 ET → 4 Nov 06:00 ET (the first polls close at 18:00 ET
 *    in parts of Indiana and Kentucky): full-screen at every 15-minute update
 *    (:00, :15, :30, :45).
 *  - The election desk shows it whenever the desk runs and the map has a call.
 *  - The governors view rotates in: :15 and :45 updates use it, :00 and :30 the Senate.
 *
 * The callers (the programme clock and the election desk) live in PR #168 / #197 and are
 * not on main yet; this module is the contract they call.
 */
const TZ = "America/New_York";

function etParts(d) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const o = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute };
}

export const ELECTION = Object.freeze({ year: 2026, month: 11, day: 3, nightStartHour: 18, nightEndHour: 6 });
export const UPDATE_MINUTES = Object.freeze([0, 15, 30, 45]);

export function isElectionNight(now = new Date()) {
  const p = etParts(new Date(now));
  if (p.y !== ELECTION.year || p.m !== ELECTION.month) return false;
  return (p.d === ELECTION.day && p.h >= ELECTION.nightStartHour) || (p.d === ELECTION.day + 1 && p.h < ELECTION.nightEndHour);
}

export function inHeadlinesWindow(now = new Date()) {
  const p = etParts(new Date(now));
  return p.y === ELECTION.year && p.m === ELECTION.month && p.d >= 3 && p.d <= 6;
}

/**
 * What the map does at `now`. `hasCall` = buildMapState().hasAnyCall.
 * @returns {{ headlines: boolean, fullScreen: boolean, desk: boolean, view: "senate"|"governor" }}
 */
export function mapCue(now = new Date(), { hasCall = false, slot } = {}) {
  const p = etParts(new Date(now));
  const quarter = slot ?? UPDATE_MINUTES.findLast((m) => m <= p.min);
  return {
    headlines: inHeadlinesWindow(now),
    fullScreen: isElectionNight(now) && UPDATE_MINUTES.includes(p.min),
    desk: hasCall,
    view: quarter === 15 || quarter === 45 ? "governor" : "senate",
  };
}
