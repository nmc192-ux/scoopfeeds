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
 *  - The quote check is strict (review of 23 Oct: a poll or lead sentence that also
 *    said "project" or "call" used to get through). When a quote is present it is
 *    accepted ONLY if it has a positive call form ("AP projects Cooper wins",
 *    "projected winner", "called the race for") AND none of: a negated call ("not yet
 *    called", "too early to call"), a poll / forecast word, a lead or partial-count
 *    word. A refused real call costs a grey tile; an accepted poll would put a false
 *    call on air. The map NEVER colours from a poll or a lead in a partial count.
 *    (One exemption: the phrase "polls closed" is not a poll.) An item with no quote
 *    is trusted on its `kind`, outlet and time alone.
 *  - Retractions: { kind: "retraction", race, state, outlet, at } removes that outlet's
 *    call when it is at least as new as the call. A later call from the same outlet
 *    restores it. Withdrawn calls are listed ("<outlet> withdrew its call"). A
 *    retraction with no race applies to every race in that state (the safe direction).
 *  - The latest item per (state, race, outlet) is that outlet's call.
 *  - All outlets agree on the party → "called", coloured, "Projected by <outlets>".
 *    Outlets disagree → "conflict": NOT coloured, every call shown side by side.
 *  - A results feed's own `winner` flag (civicAPI) is not an input here, so it can
 *    never colour a state.
 */
import { hasRace } from "./races2026.js";

/** A positive call. Required in any quote that is present. */
const CALL_FORM = new RegExp([
  String.raw`\b(project(s|ed)?|has projected|call(s|ed)?|declare[sd]?)\b[^.;]*\b(win(s|ner|ning)?|won|victor(y|ious)|re-?elect(s|ed|ion)?|defeat(s|ed)?|beat(s|en)?|hold(s)?|keep(s)?|flip(s|ped)?)\b`,
  String.raw`\bprojected (winner|victor)\b`,
  String.raw`\b(call(s|ed)?|declare[sd]?) the (race|seat|contest|election)\b`,
  String.raw`\bdeclared [^.;]*\b(the )?winner\b`,
  String.raw`\b(call(s|ed)?|declare[sd]?)\b[^.;]*\b(race|seat|contest)\b[^.;]*\bfor\b`,
].join("|"), "i");
/** A call that did not happen, or was withdrawn. Refused whatever else the quote says. */
const NEGATED = /\b(not (yet )?(been )?(called|projected|declared)|too (early|close|soon) to (call|project|declare)|yet to (be )?(call(ed)?|project(ed)?|declare[d]?)|no (call|projection|winner)s?( has been| yet)?|(un|not )called|can(not|'t|’t) (yet )?(call|project)|(has|have|had)n['’]?t (yet )?(been )?(called|projected)|withdr(ew|awn|aw)|retract(s|ed|ion)?|rescind(s|ed)?)\b/i;
/** Polls, forecasts, leads and partial counts. */
const NOT_A_RESULT = /\b(polls?|polling|pollsters?|survey(s|ed)?|forecast(s|er|ers)?|model(s|led)?|odds|ratings?|toss-?up|likely|lean(s|ing)?|favou?red|expected to|on track|leads?|leading|ahead|trails?|trailing|edge|early (returns|results|count)|partial|so far|preliminary|with \d+(\.\d+)?% (of|in)|\d+(\.\d+)?% (of (the )?)?(vote|votes|precincts|expected vote|ballots)( (in|counted|reporting))?|(precincts|votes|ballots) (counted|reporting|in))\b/i;
const POLLS_CLOSED = /\bpolls? (have |had )?(closed|close[sd]?|closing)\b/gi;

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
  return quoteReason(item.quote);
}

/** null when a projection's quote reads as a real call; otherwise why not. */
export function quoteReason(quote) {
  const q = String(quote || "").trim();
  if (!q) return null;
  if (NEGATED.test(q)) return "negated-call";
  if (NOT_A_RESULT.test(q.replace(POLLS_CLOSED, " "))) return "poll-or-lead";
  if (!CALL_FORM.test(q)) return "no-call-form";
  return null;
}

/** null when a retraction is usable; otherwise why not. */
function retractionReason(item) {
  if (!String(item.outlet || "").trim()) return "no-outlet";
  if (!item.at || Number.isNaN(Date.parse(item.at))) return "no-time";
  const state = String(item.state || "").toUpperCase();
  if (item.race ? !hasRace(item.race, state) : !(hasRace("senate", state) || hasRace("governor", state))) return "no-such-race";
  return null;
}

/**
 * Fold projection (and retraction) items into per-state calls for one race.
 * Items with no `race` are only refused under the Senate fold, so a caller folding
 * both races does not count them twice (review finding 5).
 * @returns {{ calls: Map<string, {status:"called"|"conflict"|"withdrawn", party?:string, projections:Array, withdrawn:Array}>, refused: Array }}
 */
export function foldProjections(items, race) {
  const refused = [];
  const latest = new Map(); // `${state}|${outlet}` → item
  const retractions = new Map(); // `${state}|${outlet}` → latest retraction
  for (const raw of items || []) {
    if (raw?.race && raw.race !== race) continue;
    if (raw?.kind === "retraction") {
      const why = retractionReason(raw);
      if (why) { if (raw.race || race === "senate") refused.push({ item: raw, reason: `retraction:${why}` }); continue; }
      const state = String(raw.state).toUpperCase();
      if (!hasRace(race, state)) continue;
      const r = { state, outlet: String(raw.outlet).trim(), at: new Date(raw.at).toISOString(), url: raw.url || null };
      const key = `${state}|${r.outlet.toLowerCase()}`;
      const prev = retractions.get(key);
      if (!prev || Date.parse(prev.at) <= Date.parse(r.at)) retractions.set(key, r);
      continue;
    }
    if (!raw?.race && race !== "senate") continue;
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
  const slot = (state) => {
    if (!byState.has(state)) byState.set(state, { projections: [], withdrawn: [] });
    return byState.get(state);
  };
  for (const [key, it] of latest) {
    const r = retractions.get(key);
    // A retraction at least as new as the call removes it; a newer call restores it.
    if (r && Date.parse(r.at) >= Date.parse(it.at)) slot(it.state).withdrawn.push({ ...it, withdrawnAt: r.at, retractionUrl: r.url });
    else slot(it.state).projections.push(it);
  }
  const calls = new Map();
  for (const [state, { projections, withdrawn }] of byState) {
    projections.sort((a, b) => a.at.localeCompare(b.at) || a.outlet.localeCompare(b.outlet));
    withdrawn.sort((a, b) => a.withdrawnAt.localeCompare(b.withdrawnAt) || a.outlet.localeCompare(b.outlet));
    const parties = new Set(projections.map((p) => p.party));
    if (!projections.length) calls.set(state, { status: "withdrawn", projections, withdrawn });
    else if (parties.size === 1) calls.set(state, { status: "called", party: projections[0].party, projections, withdrawn });
    else calls.set(state, { status: "conflict", projections, withdrawn });
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
