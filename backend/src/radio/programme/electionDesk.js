/**
 * electionDesk.js - "The Midterms" desk in the produced hour (#197): when it runs, where it sits
 * on the clock, the "what's on the ballot" explainer rotation, and the election board's data.
 *
 * Dark by default: the desk is added only when RADIO_ELECTION_DESK is literally "1" (or produce.mjs
 * is run with --election-desk for a rehearsal), and only for hours from 26 Oct (00:00 New York)
 * to the end of 6 Nov (New York). The explainer rotation runs until the first polls close on 3 Nov.
 *
 * Clock: the desk takes the first 180 s of music-1 (14:00-17:00). Nothing else moves, so the hour
 * stays contiguous and every other slot keeps its time.
 */
import { STATE_NAMES, SENATE_UP, GOVERNOR_UP, SENATE_SEATS, SENATE_MAJORITY, HOUSE_SEATS, HOUSE_MAJORITY } from "../election/races2026.js";

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
 * seats not up this year are not added (that list is unverified). Every called race says who projected it.
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

/** Every page of the board, in airing order. [] when there is no board (earn-render). */
export function boardPages(board) {
  if (!board) return [];
  const overview = { kind: "overview", senate: { seats: board.senate.seats, majority: board.senate.majority, projected: board.senate.projected, control: board.senate.control },
    house: { seats: board.house.seats, majority: board.house.majority, reports: board.house.reports, control: board.house.control } };
  const gov = board.governor.rows.some((r) => r.status !== "open");
  return [overview, ...latestPages(board.latest), ...racePages(board.senate.rows, "senate"), ...(gov ? racePages(board.governor.rows, "governor") : [])];
}
