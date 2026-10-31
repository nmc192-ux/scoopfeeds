/**
 * electionDesk.js - "The Midterms" desk in the produced hour (#197): when it runs, where it sits
 * on the clock, the "what's on the ballot" explainer rotation, and the election board's data.
 *
 * Dark by default: the desk is added only when RADIO_ELECTION_DESK is literally "1" (or produce.mjs
 * is run with --election-desk for a rehearsal), and only for hours from 26 Oct (00:00 New York)
 * to the end of 6 Nov (New York). The explainer rotation runs until the first polls close on 3 Nov.
 *
 * Clock: the desk takes the first 180 s of music-1 (14:00-17:00). Nothing else moves, so the hour
 * stays contiguous and every other slot keeps its time. In the v1.5 clock (#285, music blocks of 90 s at most) it
 * takes the US desk's slot instead (45:00-48:00): the Midterms desk is the US politics desk while it runs.
 */
import { STATE_NAMES, SENATE_UP, SENATE_NOT_UP, GOVERNOR_UP, SENATE_SEATS, SENATE_MAJORITY, HOUSE_SEATS, HOUSE_MAJORITY } from "../election/races2026.js";

export const DESK_FROM = Date.parse("2026-10-26T04:00:00Z");      // 26 Oct, midnight in New York (EDT)
export const DESK_UNTIL = Date.parse("2026-11-07T05:00:00Z");     // end of 6 Nov in New York (EST)
export const EXPLAINER_UNTIL = Date.parse("2026-11-03T23:00:00Z"); // 6 pm New York, 3 Nov: the first polls close at 6 pm local
export const DESK_SEC = 180;

/** Is the desk on for this hour? */
export function deskOn(hourStart, { env = process.env, force = false } = {}) {
  if (!force && String(env.RADIO_ELECTION_DESK ?? "") !== "1") return false;
  return hourStart >= DESK_FROM && hourStart < DESK_UNTIL;
}

/** Put the desk into the clock IN PLACE (the first 180 s of music-1). Returns the desk slot, or null. */
export function addDeskToClock(clock, hourStart) {
  // #285: the v1.5 clock has no music block long enough; the desk takes the US desk's slot (`electionDonor`), same time
  const u = clock.findIndex((s) => s.electionDonor);
  if (u >= 0 && clock[u].lenSec >= DESK_SEC) {
    const d = clock[u];
    const desk = { id: "midterms", kind: "spoken", segment: "midterms", title: "The Midterms", sting: true, daypart: "evening",
      startSec: d.startSec, endSec: d.endSec, lenSec: d.lenSec, start: d.start, end: d.end, ...(d.elements ? { elements: d.elements } : {}) };
    clock.splice(u, 1, desk);
    return desk;
  }
  const i = clock.findIndex((s) => s.id === "music-1");
  if (i < 0 || clock[i].lenSec < DESK_SEC + 60) return null;
  const m = clock[i];
  const at = (sec) => hourStart + sec * 1000;
  const desk = { id: "midterms", kind: "spoken", segment: "midterms", title: "The Midterms", sting: true, daypart: "evening",
    startSec: m.startSec, endSec: m.startSec + DESK_SEC, lenSec: DESK_SEC, start: at(m.startSec), end: at(m.startSec + DESK_SEC) };
  const rest = { ...m, sting: false, startSec: desk.endSec, lenSec: m.endSec - desk.endSec, start: desk.end };
  clock.splice(i, 1, desk, rest);
  return desk;
}

const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * The "what's on the ballot" lines for this hour: mechanical, from the static race list, one theme per
 * hour in rotation. They go through checks.js like every other line. Empty after the explainer window.
 */
export function ballotLines(hourStart) {
  if (hourStart >= EXPLAINER_UNTIL) return [];
  const senate = Object.keys(SENATE_UP).length, gov = GOVERNOR_UP.length;
  const themes = [
    [`On the ballot on November 3: ${senate} of the ${SENATE_SEATS} Senate seats. A party needs ${SENATE_MAJORITY} seats for a majority.`,
      `The Senate races are in ${list(Object.keys(SENATE_UP).map((c) => STATE_NAMES[c]).sort())}.`],
    [`On the ballot on November 3: governors in ${gov} states.`,
      `They include ${list(["CA", "TX", "FL", "NY", "PA", "GA", "MI", "AZ", "WI"].filter((c) => GOVERNOR_UP.includes(c)).map((c) => STATE_NAMES[c]))}.`],
    [`On the ballot on November 3: all ${HOUSE_SEATS} seats in the House of Representatives.`,
      `A party needs ${HOUSE_MAJORITY} seats to control the House.`],
  ];
  const t = themes[Math.floor(hourStart / 3600_000) % themes.length];
  return [...t, "ScoopFeeds never calls a race. On election night, every result we report names the news organisation that called it."]
    .map((text, n) => ({ id: `b${n + 1}`, story: null, text }));
}

/** Put this hour's ballot lines after the desk's "open" line, in the writer's raw output (before checks). */
export function addBallotLines(raw, hourStart) {
  const seg = raw?.midterms;
  const b = ballotLines(hourStart);
  if (!seg || !b.length) return raw;
  const lines = (seg.lines || []).filter((l) => !/^b\d+$/.test(l.id || ""));
  const at = lines.findIndex((l) => l.id === "open") + 1;
  lines.splice(at, 0, ...b);
  seg.lines = lines;
  return raw;
}

/**
 * The election board (programme screen). null unless at least one attributed item exists (earn-render).
 * Control bars count ONLY races an organisation projected and every organisation that called it agrees on;
 * seats not up this year are not added here (the 1 Nov board adds them in summary(): SENATE_NOT_UP, checked against
 * the 2026 class lists). Every called race says who projected it.
 */
export function boardData(ep) {
  const calls = (ep?.races || []).filter((r) => r.calls.length);
  const seatReports = (ep?.items || []).filter((i) => i.kind === "house-seats");
  if (!calls.length && !seatReports.length) return null;
  const by = (race, state) => (ep.races || []).find((r) => r.race === race && r.state === state && !r.district);
  const row = (race) => (state) => {
    const r = by(race, state);
    if (!r || !r.calls.length) return { state, name: STATE_NAMES[state], status: "open", label: "Not yet called" };
    return { state, name: STATE_NAMES[state], status: r.status,
      calls: r.calls.map((c) => ({ outlet: c.outlet, party: c.party || null, candidate: c.candidate || null, quote: c.quote, source: c.source, at: c.at })),
      label: r.status === "called" ? `Projected by ${list(r.calls.map((c) => c.outlet))}` : "Outlets disagree" };
  };
  const tally = (rows) => rows.filter((r) => r.status === "called").reduce((t, r) => { const p = r.calls[0].party; if (p) t[p] = (t[p] || 0) + 1; return t; }, {});
  const senate = Object.keys(SENATE_UP).map(row("senate")), governor = GOVERNOR_UP.map(row("governor"));
  const control = (race) => (ep.races || []).filter((r) => r.race === race && r.calls.length).flatMap((r) => r.calls.map((c) => ({ outlet: c.outlet, party: c.party, quote: c.quote, source: c.source, status: r.status })));
  return {
    senate: { seats: SENATE_SEATS, majority: SENATE_MAJORITY, projected: tally(senate), rows: senate, control: control("senate-control") },
    governor: { rows: governor, projected: tally(governor) },
    house: { seats: HOUSE_SEATS, majority: HOUSE_MAJORITY, reports: seatReports.map((h) => ({ outlet: h.outlet, seats: h.seats, quote: h.quote, source: h.source, at: h.at })), control: control("house-control"),
      districts: (ep.races || []).filter((r) => r.race === "house" && r.calls.length).map((r) => ({ name: `${STATE_NAMES[r.state]} ${r.district}`, status: r.status, label: r.status === "called" ? `Projected by ${list(r.calls.map((c) => c.outlet))}` : "Outlets disagree", calls: r.calls.map((c) => ({ outlet: c.outlet, quote: c.quote })) })) },
    latest: (ep.items || []).filter((i) => i.kind !== "count").sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 4).map((i) => ({ outlet: i.outlet, quote: i.quote, source: i.source, at: i.at, kind: i.kind })),
    builtAt: ep.builtAt,
  };
}

/*
 * Board pages (#197 review, 25 Oct). At DrJ's 26 px floor a grid of every race cannot fit one 1080p screen
 * (35 Senate + 36 governor rows), so the board is paged, and the pages run one after another in the desk slot:
 *   1. "overview": Senate control bar, House bars or calls, and the latest projections quoted word for word.
 *   2. "races" pages per view (Senate, then governors when any governor race is called): called and conflicting
 *      races as cards in three columns, each card naming who projected it; the races nobody has called are listed
 *      by name under "Not yet called" on the view's last page. No race is dropped: a full board just has more pages.
 * Page fill is estimated from text length with deliberately pessimistic sizes; the rendered test in
 * screen/fontFloor.test.js renders a worst-case full board and fails if anything runs past the frame.
 */
export const PAGE = { colH: 640, line: 31, card: 20, cpl: 30, openCpl: 95, openHead: 46, cols: 3 };
const lines = (s, cpl) => Math.max(1, Math.ceil(String(s || "").length / cpl));

/** The text lines of one race card (what the screen prints under the state name). */
export function cardLines(r) {
  if (r.status === "conflict") return ["Outlets disagree", ...r.calls.map((c) => `${c.outlet}: ${c.candidate || c.party || "?"}`)];
  const c = r.calls[0];
  return [...(c.candidate ? [`${c.candidate}${c.party ? ` (${c.party})` : ""}`] : c.party ? [{ D: "Democrats", R: "Republicans", I: "Independent" }[c.party] || c.party] : []), r.label];
}
const cardH = (r) => PAGE.card + PAGE.line * (lines(r.name, PAGE.cpl) + cardLines(r).reduce((n, t) => n + lines(t, PAGE.cpl), 0));
const openH = (names) => (names.length ? PAGE.openHead + PAGE.line * lines(names.join(", "), PAGE.openCpl) : 0);

/** Split one view's rows into pages of three columns. Called and conflicting races first, newest call first. */
export function racePages(rows, view) {
  const newest = (r) => Math.max(...r.calls.map((c) => Date.parse(c.at) || 0));
  const called = rows.filter((r) => r.status !== "open").sort((a, b) => newest(b) - newest(a) || a.name.localeCompare(b.name));
  const open = rows.filter((r) => r.status === "open").map((r) => r.name);
  const pages = [];
  let cols = [[]], used = [0];
  const flush = () => { pages.push({ cols }); cols = [[]]; used = [0]; };
  for (const r of called) {
    const h = cardH(r);
    if (used.at(-1) + h > PAGE.colH && cols.at(-1).length) {
      if (cols.length === PAGE.cols) flush(); else { cols.push([]); used.push(0); }
    }
    cols.at(-1).push(r); used[used.length - 1] += h;
  }
  if (cols[0].length) flush();
  // the "Not yet called" list goes under the last page's columns, or on a page of its own when it does not fit
  const last = pages.at(-1);
  if (open.length) {
    const tallest = last ? Math.max(...last.cols.map((c) => c.reduce((n, r) => n + cardH(r), 0))) : 0;
    if (last && tallest + openH(open) <= PAGE.colH) last.open = open; else pages.push({ cols: [], open });
  }
  // each card carries the exact lines the screen prints (one source for the fill estimate and the render)
  const card = (r) => ({ state: r.state, name: r.name, status: r.status, party: r.status === "called" ? r.calls[0].party || null : null, lines: cardLines(r), calls: r.calls });
  return pages.map((p, i) => ({ kind: "races", view, n: i + 1, of: pages.length, cols: p.cols.map((c) => c.map(card)), open: p.open || [] }));
}

export const QUOTE_MAX = 600;   // a quoted sentence longer than this is cut and marked "(shortened)" on screen
/** Latest projections, quoted word for word, paged full width. */
export function latestPages(latest) {
  const pages = []; let cur = [], used = 0;
  for (const x of latest || []) {
    const q = x.quote.length > QUOTE_MAX ? { ...x, quote: `${x.quote.slice(0, QUOTE_MAX).replace(/\s+\S*$/, "")}…`, shortened: true } : x;
    const h = PAGE.card + PAGE.line * lines(`${q.quote} ${q.source}${q.shortened ? " (shortened)" : ""}`, 80);
    if (used + h > PAGE.colH && cur.length) { pages.push(cur); cur = []; used = 0; }
    cur.push(q); used += h;
  }
  if (cur.length) pages.push(cur);
  return pages.map((quotes, i) => ({ kind: "latest", n: i + 1, of: pages.length, quotes }));
}

/*
 * The election-night look (DrJ approved the mock-ups, 1 Nov 2026): a results board (balance of power, hot races,
 * projections as they come in), a Senate map, and, before any projection, a countdown to the first poll closing.
 * Plus the compact "election window" that rides on the rail of every other scene. All of it reads the same board,
 * so every figure on it is either a static fact (seats not up, who holds a seat) or an attributed projection.
 */

/** Hot races on the board: an editorial pick, overridable with RADIO_HOT_SENATE="NC,ME,GA,...". Six fit at the 26 px floor. */
export const HOT_SENATE_DEFAULT = Object.freeze(["NC", "ME", "GA", "MI", "OH", "TX"]);
export function hotSenate(env = process.env) {
  const pick = String(env.RADIO_HOT_SENATE || "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => x in SENATE_UP);
  return (pick.length ? [...new Set(pick)] : [...HOT_SENATE_DEFAULT]).slice(0, 6);
}

const newestAt = (r) => Math.max(...(r.calls || []).map((c) => Date.parse(c.at) || 0));
const winner = (r) => (r.status === "called" ? r.calls[0].party || null : null);

/**
 * The night's numbers. Senate totals = seats not up this year (SENATE_NOT_UP; independents counted with the
 * Democrats they caucus with, and said so on screen) + races projected this year with every caller agreeing.
 * A flip is a projected winner from the other party than the one holding the seat (SENATE_UP).
 * House: the newest seat count an organisation reported, named; we never add up districts ourselves.
 */
export function summary(board) {
  const rows = board?.senate?.rows || [];
  const won = { D: SENATE_NOT_UP.D + SENATE_NOT_UP.I, R: SENATE_NOT_UP.R };
  const flips = { D: 0, R: 0 };
  for (const r of rows) {
    const p = winner(r); if (p !== "D" && p !== "R") continue;
    won[p]++; if (SENATE_UP[r.state] && SENATE_UP[r.state] !== p) flips[p]++;
  }
  const decided = rows.filter((r) => winner(r) === "D" || winner(r) === "R").length;
  const hr = [...(board?.house?.reports || [])].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))[0] || null;
  const gp = board?.governor?.projected || {};
  return {
    senate: { D: won.D, R: won.R, toGo: Object.keys(SENATE_UP).length - decided, majority: SENATE_MAJORITY, seats: SENATE_SEATS, flips, notUp: { D: SENATE_NOT_UP.D + SENATE_NOT_UP.I, R: SENATE_NOT_UP.R } },
    house: hr ? { D: hr.seats?.D || 0, R: hr.seats?.R || 0, toGo: Math.max(0, HOUSE_SEATS - (hr.seats?.D || 0) - (hr.seats?.R || 0) - (hr.seats?.I || 0)), majority: HOUSE_MAJORITY, seats: HOUSE_SEATS, outlet: hr.outlet }
      : { D: 0, R: 0, toGo: HOUSE_SEATS, majority: HOUSE_MAJORITY, seats: HOUSE_SEATS, outlet: null },
    governor: { D: gp.D || 0, R: gp.R || 0, toGo: GOVERNOR_UP.length - (gp.D || 0) - (gp.R || 0) - (gp.I || 0) },
  };
}

/** Every called or disputed race, newest call first: the "projections as they come in" column. */
export function timeline(board, { max = 6 } = {}) {
  const rows = [...(board?.senate?.rows || []).map((r) => ({ ...r, race: "senate" })), ...(board?.governor?.rows || []).map((r) => ({ ...r, race: "governor" }))];
  return rows.filter((r) => r.status !== "open").sort((a, b) => newestAt(b) - newestAt(a)).slice(0, max).map((r) => ({
    at: new Date(newestAt(r)).toISOString(), state: r.state, name: STATE_NAMES[r.state], race: r.race, status: r.status, party: winner(r),
    candidate: r.status === "called" ? r.calls[0].candidate || null : null,
    flip: r.race === "senate" && winner(r) && SENATE_UP[r.state] && SENATE_UP[r.state] !== winner(r) ? true : false,
    outlets: [...new Set(r.calls.map((c) => c.outlet))],
    calls: r.status === "conflict" ? r.calls.map((c) => ({ outlet: c.outlet, party: c.party || null, candidate: c.candidate || null })) : [],
  }));
}

/** One hot-race card. Candidate names appear only once a call names them; we keep no candidate list. */
export function hotCards(board, states, { pollClose = () => null } = {}) {
  return states.map((st) => {
    const r = (board?.senate?.rows || []).find((x) => x.state === st) || { state: st, status: "open", calls: [] };
    const base = { state: st, name: STATE_NAMES[st], holder: SENATE_UP[st] || null, status: r.status, pollsClose: pollClose(st) };
    if (r.status === "open") return base;
    if (r.status === "conflict") return { ...base, calls: r.calls.map((c) => ({ outlet: c.outlet, party: c.party || null, candidate: c.candidate || null })) };
    const p = winner(r);
    return { ...base, party: p, candidate: r.calls[0].candidate || null, at: new Date(newestAt(r)).toISOString(), outlets: [...new Set(r.calls.map((c) => c.outlet))], flip: !!(p && SENATE_UP[st] && SENATE_UP[st] !== p) };
  });
}

/** The Senate map: every state with a race this year, coloured from projections only (D / R / X = outlets disagree / open). */
export function mapStates(board) {
  const out = {};
  for (const st of Object.keys(SENATE_UP)) {
    const r = (board?.senate?.rows || []).find((x) => x.state === st);
    out[st] = !r || r.status === "open" ? "open" : r.status === "conflict" ? "X" : winner(r) || "open";
  }
  return out;
}

/** Every page of the board, in airing order. [] when there is no board (earn-render). */
export function boardPages(board, { env = process.env, pollClose = () => null, nextClose = null } = {}) {
  if (!board) return [];
  const sum = summary(board);
  const results = { kind: "board", summary: sum, hot: hotCards(board, hotSenate(env), { pollClose }), timeline: timeline(board), nextClose };
  const map = { kind: "map", summary: sum, states: mapStates(board), nextClose };
  const gov = board.governor.rows.some((r) => r.status !== "open");
  return [results, map, ...latestPages(board.latest), ...racePages(board.senate.rows, "senate"), ...(gov ? racePages(board.governor.rows, "governor") : [])];
}

/** Before any projection: the countdown to the first poll closing, every closing time, and the races to watch. */
export function beforePage({ closings = [], env = process.env } = {}) {
  if (!closings.length) return null;
  return { kind: "before", target: closings[0].at, first: closings[0].states, firstNames: closings[0].states.map((st) => STATE_NAMES[st] || st), closings: closings.map((c) => ({ at: c.at, states: c.states })),
    watch: hotSenate(env).map((st) => ({ state: st, name: STATE_NAMES[st], holder: SENATE_UP[st] })),
    goingIn: { D: 45 + 2, R: 53 }, seatsUp: { senate: Object.keys(SENATE_UP).length, house: HOUSE_SEATS, governor: GOVERNOR_UP.length } };
}

/**
 * The election window on the rail of every other scene (headlines, music, films): the running totals, the newest
 * projection (flagged "just in" for JUST_IN_MS after its time) and the next poll closing. null without a board
 * and without closings to come (earn-render).
 */
export const JUST_IN_MS = 90_000;
export function windowData(board, { nextClose = null } = {}) {
  if (!board && !nextClose) return null;
  const tl = board ? timeline(board, { max: 1 }) : [];
  return { summary: summary(board), latest: tl[0] || null, nextClose, builtAt: board?.builtAt || null };
}
