/**
 * projections.js — the only way a state gets a colour on the election map (#204).
 *
 * Input is the election pack's projection items (#197, `programme/electionPack.js`
 * when it lands). The contract, which that pack must produce:
 *
 *   { kind: "projection", race: "senate" | "governor", state: "NC",
 *     party: "D" | "R" | "I" | <other>, candidate?: "Roy Cooper",
 *     outlet: "AP", at: ISO time, url?: article link, quote?: the article's sentence }
 *
 * Rules, all tested in election.test.js:
 *  - Only `kind: "projection"` with a named outlet, a party and a state that has that
 *    race this year is accepted. Everything else is refused, with the reason.
 *  - A quote that reads as a poll, a lead or a partial count, and does not also say
 *    the race was projected / called, is refused. The map NEVER colours from a poll
 *    or a lead in a partial count, whatever the extractor upstream did.
 *  - The latest item per (state, race, outlet) is that outlet's call.
 *  - All outlets agree on the party → "called", coloured, "Projected by <outlets>".
 *    Outlets disagree → "conflict": NOT coloured, every call shown side by side.
 *  - A results feed's own `winner` flag (civicAPI) is not an input here, so it can
 *    never colour a state.
 */
import { hasRace } from "./races2026.js";

const PROJECTION_WORDS = /\b(project(s|ed|ing|ion|ions)?|call(s|ed|ing)?|declare[sd]?|race call)\b/i;
const NOT_A_RESULT = /\b(polls?|polling|survey|leads?|leading|ahead|trails?|trailing|early (returns|results)|partial|so far|with \d+% (of|in)|% of (the )?(vote|precincts|expected) (in|counted|reporting))\b/i;

export const PARTY_NAMES = Object.freeze({ D: "Democrats", R: "Republicans", I: "Independent" });

export function normParty(p) {
  const s = String(p || "").trim();
  if (/^(d|dem|democrat(ic)?|democrats|dfl)$/i.test(s)) return "D";
  if (/^(r|rep|gop|republican|republicans)$/i.test(s)) return "R";
  if (/^(i|ind|independent)$/i.test(s)) return "I";
  return s ? s.toUpperCase() : "";
}

/** null when the item may colour a state; otherwise the reason it may not. */
export function refuseReason(item) {
  if (!item || typeof item !== "object") return "not-an-item";
  if (item.kind !== "projection") return `kind:${item.kind || "missing"}`;
  if (!String(item.outlet || "").trim()) return "no-outlet";
  const state = String(item.state || "").toUpperCase();
  if (!hasRace(item.race, state)) return "no-such-race";
  if (!normParty(item.party)) return "no-party";
  if (!item.at || Number.isNaN(Date.parse(item.at))) return "no-time";
  const q = String(item.quote || "");
  if (q && NOT_A_RESULT.test(q) && !PROJECTION_WORDS.test(q)) return "poll-or-lead";
  return null;
}

/**
 * Fold projection items into per-state calls for one race.
 * @returns {{ calls: Map<string, {status:"called"|"conflict", party?:string, projections:Array}>, refused: Array }}
 */
export function foldProjections(items, race) {
  const refused = [];
  const latest = new Map(); // `${state}|${outlet}` → item
  for (const raw of items || []) {
    if (raw?.race && raw.race !== race) continue;
    const why = refuseReason(raw);
    if (why) { refused.push({ item: raw, reason: why }); continue; }
    const it = {
      state: String(raw.state).toUpperCase(),
      party: normParty(raw.party),
      candidate: raw.candidate ? String(raw.candidate) : null,
      outlet: String(raw.outlet).trim(),
      at: new Date(raw.at).toISOString(),
      url: raw.url || null,
    };
    const key = `${it.state}|${it.outlet.toLowerCase()}`;
    const prev = latest.get(key);
    if (!prev || Date.parse(prev.at) <= Date.parse(it.at)) latest.set(key, it);
  }
  const byState = new Map();
  for (const it of latest.values()) {
    if (!byState.has(it.state)) byState.set(it.state, []);
    byState.get(it.state).push(it);
  }
  const calls = new Map();
  for (const [state, projections] of byState) {
    projections.sort((a, b) => a.at.localeCompare(b.at) || a.outlet.localeCompare(b.outlet));
    const parties = new Set(projections.map((p) => p.party));
    calls.set(state, parties.size === 1
      ? { status: "called", party: projections[0].party, projections }
      : { status: "conflict", projections });
  }
  return { calls, refused };
}

/**
 * House control from attributed seat reports:
 *   { kind: "house-seats", outlet, at, url?, seats: { D: n, R: n } }
 * The latest report per outlet is kept. Outlets that disagree are shown side by side;
 * nothing is averaged or merged.
 */
export function foldHouseReports(items) {
  const latest = new Map();
  for (const it of items || []) {
    if (it?.kind !== "house-seats") continue;
    const outlet = String(it.outlet || "").trim();
    if (!outlet || !it.at || Number.isNaN(Date.parse(it.at)) || !it.seats) continue;
    const seats = {};
    for (const [p, n] of Object.entries(it.seats)) {
      const k = normParty(p);
      if (k && Number.isInteger(n) && n >= 0 && n <= 435) seats[k] = n;
    }
    if (!Object.keys(seats).length) continue;
    const rec = { outlet, at: new Date(it.at).toISOString(), url: it.url || null, seats };
    const prev = latest.get(outlet.toLowerCase());
    if (!prev || Date.parse(prev.at) <= Date.parse(rec.at)) latest.set(outlet.toLowerCase(), rec);
  }
  return [...latest.values()].sort((a, b) => b.at.localeCompare(a.at));
}
