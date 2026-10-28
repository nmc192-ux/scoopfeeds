/**
 * electionNight.js - the election night special, the day after, and the dress rehearsal (#198).
 *
 *   THE SPECIAL   Tue 3 Nov 18:00 ET to Wed 4 Nov 03:00 ET (23:00 to 08:00 UTC; Wed 4 am to 1 pm PKT).
 *                 Its own clock (buildSpecialClock) replaces the normal hour: a results update every 15 minutes
 *                 (update-00/15/30/45, 3 min each), a full round-up at the top of the hour, "The News, Compared"
 *                 on the biggest race, three race-by-race blocks (Senate, governors, House and control), short
 *                 music beds only. The rolling station switches to it by the clock (stationPlan), on its own.
 *   15-MINUTE     each update slot is produced with the hour as a mechanical placeholder (the poll closings due in
 *   UPDATES       that quarter, then "counting continues" and the board), then re-produced on its own a few minutes
 *                 before it airs from a fresh election pack (update.mjs) and spliced in. An update that fails its
 *                 checks, or misses its window, is skipped: the placeholder airs and the hour goes on.
 *   POLL CLOSINGS called out by state at their scheduled times, from races2026.js LAST_POLLS_CLOSE_ET (all
 *                 closings fall on :00 or :30, so each is read in update-00 or update-30 of its hour).
 *   DAY AFTER     Wed 4 03:00 ET to the end of Fri 6 Nov (New York): the normal clock, with an hourly
 *                 "Counting continues" desk on the races not yet called, in place of the Midterms desk.
 *   REHEARSAL     the same night moved in time (nightWindow({ startAt })): the special starts at the rehearsal's
 *                 first hour, poll closings and fixture projections move with it. Disk only, never streamed.
 *
 * ScoopFeeds never calls a race: every result line names the organisation that projected it and must match an
 * attributed item in the election pack (checks.js electionReason); attributionAudit re-checks every aired line.
 *
 * Dark unless RADIO_ELECTION_NIGHT is literally "1" (or a rehearsal forces it). Pure apart from the file helpers
 * at the end; the clock is always passed in.
 */
import fs from "node:fs";
import path from "node:path";
import { planHour, etHour } from "./dayClock.js";
import { PREROLL_SEC, TAIL_SEC, checkClock, wordBudget } from "./clock.js";
import { withProgrammeLock } from "./developingDesk.js";
import { spliceProgramme } from "./repeat.js";
import { isElectoral, electionReason, ELECTION_SEGMENTS } from "./checks.js";
import { STATE_NAMES, SENATE_UP, GOVERNOR_UP, LAST_POLLS_CLOSE_ET } from "../election/races2026.js";

const MIN = 60_000, HOUR = 3_600_000;
export const SPECIAL_FROM = Date.parse("2026-11-03T23:00:00Z");     // 18:00 ET (EST, UTC-5)
export const SPECIAL_UNTIL = Date.parse("2026-11-04T08:00:00Z");    // 03:00 ET, 4 Nov
export const DAY_AFTER_UNTIL = Date.parse("2026-11-07T05:00:00Z");  // end of Fri 6 Nov, New York
const POLL_DAY_ET0 = Date.parse("2026-11-03T05:00:00Z");            // 00:00 ET on 3 Nov: LAST_POLLS_CLOSE_ET hours count from here

export { ELECTION_SEGMENTS };   // segments that carry election results (the board, the election checks): checks.js
export const UPDATE_ID = /^update-\d\d$/;

export const FRESH_AFTER_H = 3;   // hours after the special that are produced even where the day clock says repeat
export const nightEnabled = (env = process.env) => env.RADIO_ELECTION_NIGHT === "1";

/**
 * The night, real or moved for a rehearsal. `startAt` (rehearsal): the special starts at that hour, and every
 * scheduled time of the night (poll closings, fixture projections) moves by the same `shift`. A rehearsal has no
 * day-after window.
 */
export function nightWindow({ startAt = null } = {}) {
  if (startAt == null) return { from: SPECIAL_FROM, until: SPECIAL_UNTIL, dayAfterUntil: DAY_AFTER_UNTIL, shift: 0, rehearsal: false };
  const from = Math.floor(Number(startAt) / HOUR) * HOUR;
  if (!Number.isFinite(from)) throw new Error("nightWindow: startAt must be epoch ms");
  const until = from + (SPECIAL_UNTIL - SPECIAL_FROM);
  return { from, until, dayAfterUntil: until, shift: from - SPECIAL_FROM, rehearsal: true };
}

/**
 * The plan for hour H: the election special, a day-after hour (the normal plan with the counting desk), or the
 * normal day clock. With the night off it is exactly planHour(H).
 */
export function stationPlan(H, { env = process.env, night = nightWindow(), force = false, base = planHour } = {}) {
  const plan = base(H);
  if (!(force || nightEnabled(env))) return plan;
  if (H >= night.from && H < night.until) {
    const n = Math.round((H - night.from) / HOUR) + 1, of = Math.round((night.until - night.from) / HOUR);
    return { ...plan, hourStart: H, etHour: etHour(H - night.shift), format: "election-special", election: "special", weather: false, audience: "us",
      label: `election night special, hour ${n} of ${of}${night.rehearsal ? " (dress rehearsal)" : ""}` };
  }
  if (H >= night.until && H < night.dayAfterUntil) {
    // the night's last overnight hours (03-06 ET, 4 Nov) are produced: a repeat would replay an hour from before the results
    const fresh = plan.format === "repeat" && H < night.until + FRESH_AFTER_H * HOUR;
    return { ...plan, ...(fresh ? { format: "produced" } : {}), election: "day-after", label: `${fresh ? `${plan.etHour}:00 ET produced hour (after the special)` : plan.label}, counting continues` };
  }
  return plan;
}

// ── the special's clock ──────────────────────────────────────────────────────────────────────────────────────
// [id, startSec, endSec, kind, extra]. Music beds are short (at most 3 minutes) and carry the board.
const SPECIAL = [
  ["countdown", -900, -4, "countdown", { bed: "full" }],
  ["ident-top", -4, 6, "ident", { mode: "top" }],
  ["update-00", 6, 186, "spoken", { segment: "update", title: "Election update", quarter: 0 }],
  ["roundup", 186, 600, "spoken", { segment: "roundup", title: "Election night: the round-up", sting: true, daypart: "evening" }],
  ["compared-1", 600, 840, "spoken", { segment: "compared", title: "The News, Compared: the biggest race", sting: true, race: true, daypart: "evening" }],
  ["music-1", 840, 900, "music", { nextAt: 900, nextTitle: "Election update" }],
  ["update-15", 900, 1080, "spoken", { segment: "update", title: "Election update", sting: true, quarter: 15 }],
  ["results-1", 1080, 1500, "spoken", { segment: "results", focus: "senate", title: "Race by race: the Senate", sting: true, daypart: "evening" }],
  ["half", 1500, 1680, "spoken", { segment: "half", title: "The rest of the news", stories: 4 }],
  ["music-2", 1680, 1792, "music", { nextAt: 1800, nextTitle: "Election update" }],
  ["ident-half", 1792, 1800, "ident", { mode: "id" }],
  ["update-30", 1800, 1980, "spoken", { segment: "update", title: "Election update", quarter: 30 }],
  ["results-2", 1980, 2520, "spoken", { segment: "results", focus: "governor", title: "Race by race: governors", sting: true, daypart: "evening" }],
  ["music-3", 2520, 2700, "music", { nextAt: 2700, nextTitle: "Election update" }],
  ["update-45", 2700, 2880, "spoken", { segment: "update", title: "Election update", sting: true, quarter: 45 }],
  ["results-3", 2880, 3300, "spoken", { segment: "results", focus: "house", title: "Race by race: the House and control of Congress", sting: true, daypart: "evening" }],
  ["music-4", 3300, 3480, "music", { nextAt: 3480, nextTitle: "Sign-off" }],
  ["signoff", 3480, 3525, "spoken", { segment: "signoff", title: "ScoopFeeds Radio" }],
  ["ident-end", 3525, 3533, "ident", { mode: "id" }],
  ["endcard", 3533, 3600 + TAIL_SEC, "endcard", { fadeFrom: 3570, silentFrom: 3600 }],
];
export const MAX_SPECIAL_MUSIC_SEC = 180;

/** The special's hour. The update slots are mechanical in the hour's own run (placeholders: update.mjs replaces them). */
export function buildSpecialClock(hourStartMs) {
  if (!Number.isFinite(hourStartMs)) throw new Error("buildSpecialClock: hourStartMs must be a number");
  const slots = SPECIAL.map(([id, s, e, kind, extra]) => ({
    id, kind, startSec: s, endSec: e, lenSec: e - s, start: hourStartMs + s * 1000, end: hourStartMs + e * 1000,
    ...(UPDATE_ID.test(id) ? { mechanical: true } : {}), ...extra,
  }));
  const bad = checkClock(slots);
  if (bad.length || slots[0].startSec !== -PREROLL_SEC) throw new Error(`special clock is broken: ${bad.join("; ")}`);
  return slots;
}

/** The day-after desk: the first 180 s of music-1, as the Midterms desk (electionDesk.addDeskToClock), renamed. */
export function addCountingDesk(clock, hourStart, { deskSec = 180 } = {}) {
  const i = clock.findIndex((s) => s.id === "music-1");
  if (i < 0 || clock[i].lenSec < deskSec + 60) return null;
  const m = clock[i];
  const desk = { id: "counting", kind: "spoken", segment: "counting", title: "Counting continues", sting: true, daypart: "evening",
    startSec: m.startSec, endSec: m.startSec + deskSec, lenSec: deskSec, start: m.start, end: m.start + deskSec * 1000 };
  clock.splice(i, 1, desk, { ...m, sting: false, startSec: desk.endSec, lenSec: m.endSec - desk.endSec, start: desk.end });
  return desk;
}

// ── poll closings ────────────────────────────────────────────────────────────────────────────────────────────
/** When the last polls close in `state` on the night (moved by `night.shift` in a rehearsal). */
export const pollCloseAt = (state, night = nightWindow()) => POLL_DAY_ET0 + LAST_POLLS_CLOSE_ET[state] * HOUR + night.shift;

/** Poll closings in [fromMs, toMs), grouped by time: [{ at, states: ["GA", ...] }], earliest first. */
export function pollClosings(fromMs, toMs, night = nightWindow()) {
  const by = new Map();
  for (const st of Object.keys(LAST_POLLS_CLOSE_ET)) {
    if (st === "DC") continue;
    const at = pollCloseAt(st, night);
    if (at >= fromMs && at < toMs) by.set(at, [...(by.get(at) || []), st]);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([at, states]) => ({ at, states: states.sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b])) }));
}

const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const HOURS = ["midnight", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "noon"];
const hourName = (h) => (h === 0 ? "midnight" : h === 12 ? "noon" : `${HOURS[h % 12]}`);
const dayPart = (h) => (h === 0 || h === 12 ? "" : h < 12 ? " in the morning" : h < 17 ? " in the afternoon" : " in the evening");
/** "half past seven in the evening": New York time in words, to the nearest quarter (no digits: checks.js wants every figure backed). */
export function etWords(ms) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(ms));
  const h = Number(f.find((p) => p.type === "hour").value) % 24, m = Number(f.find((p) => p.type === "minute").value);
  if (m >= 53) { const n = (h + 1) % 24; return `${hourName(n)}${n % 12 ? " o'clock" : ""}${dayPart(n)}`; }
  if (m >= 38) { const n = (h + 1) % 24; return `quarter to ${hourName(n)}${dayPart(n)}`; }
  const q = m >= 23 ? "half past " : m >= 8 ? "quarter past " : "";
  return `${q}${hourName(h)}${!q && h % 12 ? " o'clock" : ""}${dayPart(h)}`;
}

/** The lines that call out one poll closing. Mechanical: no figures, no result, nothing to project. */
export function pollCloseLines(group, night = nightWindow(), n0 = 1) {
  const names = group.states.map((s) => STATE_NAMES[s]);
  const senate = group.states.filter((s) => Object.hasOwn(SENATE_UP, s)).map((s) => STATE_NAMES[s]);
  const gov = group.states.filter((s) => GOVERNOR_UP.includes(s)).map((s) => STATE_NAMES[s]);
  const lines = [{ text: `It is ${etWords(group.at - night.shift)} in New York, and the last polls have closed in ${list(names)}.` }];
  if (senate.length && senate.join() === gov.join()) lines.push({ text: `${list(senate)} ${senate.length > 1 ? "have" : "has"} races for the Senate and for governor.` });
  else if (senate.length || gov.length) {
    const parts = [senate.length ? `${senate.length > 1 ? "Senate races" : "a Senate race"} in ${list(senate)}` : null, gov.length ? `${gov.length > 1 ? "races" : "a race"} for governor in ${list(gov)}` : null];
    lines.push({ text: `There ${senate.length + gov.length > 1 ? "are" : "is"} ${parts.filter(Boolean).join(", and ")}.` });
  }
  return lines.map((l, i) => ({ id: `pc${n0 + i}`, story: null, mechanical: true, closing: group.at, ...l }));
}

/** Put the poll-closing lines due in `slot`'s quarter after its "open" line (raw writer output, before checks). */
export function addPollCloseLines(raw, slot, night = nightWindow()) {
  const seg = raw?.[slot.id];
  if (!seg) return [];
  const nominal = slot.start - (slot.startSec % 60) * 1000;   // update-00 starts at :00:06; its quarter starts at :00
  const groups = pollClosings(nominal, nominal + 15 * MIN, night);
  const pc = groups.flatMap((g, k) => pollCloseLines(g, night, 1 + k * 2));
  const lines = (seg.lines || []).filter((l) => !/^pc\d+$/.test(l.id || ""));
  lines.splice(lines.findIndex((l) => l.id === "open") + 1, 0, ...pc);
  seg.lines = lines;
  return groups;
}

// ── mechanical words (placeholders, the cost-guard fallback, a busy writer) ─────────────────────────────────
const where = (r) => [r.race === "senate" ? "Senate" : r.race === "governor" ? "governor" : r.race === "house" ? "House" : null, r.state ? STATE_NAMES[r.state] : null].filter(Boolean);
const words = (t) => String(t).split(/\s+/).filter(Boolean).length;

/** Attributed projection lines, verbatim from the articles, newest first; conflicts named as such. Within `budget` words. */
export function projectionLines(ep, { budget = Infinity, focus = null, idPrefix = "p", max = Infinity } = {}) {
  const inFocus = (race) => !focus || race === focus || (focus === "house" && ["house", "house-control", "senate-control"].includes(race));
  const races = (ep?.races || []).filter((r) => r.calls.length && inFocus(r.race));
  const calls = races.flatMap((r) => r.calls.map((c) => ({ c, r }))).sort((a, b) => Date.parse(b.c.at) - Date.parse(a.c.at));
  const seats = focus && focus !== "house" ? [] : (ep?.items || []).filter((i) => i.kind === "house-seats").sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const out = []; let used = 0;
  const push = (text) => { if (out.length >= max || used + words(text) > budget) return false; out.push({ id: `${idPrefix}${out.length + 1}`, story: null, mechanical: true, text }); used += words(text); return true; };
  const flagged = new Set();
  for (const { c, r } of calls) {
    if (r.status === "conflict" && !flagged.has(r)) { flagged.add(r); if (!push(`The news organisations disagree on the ${where(r).reverse().join(" ")} race; each call is on screen.`)) break; }
    if (!push(c.quote)) break;
  }
  for (const h of seats) if (!push(h.quote)) break;
  return out;
}

/** Races nobody has called yet, by name (the day-after desk, the placeholder). */
export function uncalledRaces(ep, race) {
  const called = new Set((ep?.races || []).filter((r) => r.race === race && r.calls.length).map((r) => r.state));
  const up = race === "senate" ? Object.keys(SENATE_UP) : GOVERNOR_UP;
  return up.filter((s) => !called.has(s)).map((s) => STATE_NAMES[s]).sort();
}

/** An update's words with no writer: the time, the poll closings (added by addPollCloseLines), projections, close. */
export function mechanicalUpdate(ep, slot, night = nightWindow()) {
  const nominal = slot.start - (slot.startSec % 60) * 1000;
  const lines = [{ id: "open", story: null, mechanical: true, text: `The ScoopFeeds election update, at ${etWords(nominal - night.shift)} in New York.` }];
  const proj = projectionLines(ep, { budget: Math.max(0, wordBudget(slot) - 140), max: 8 });   // the newest eight: the board shows the rest
  if (proj.length) lines.push(...proj);
  else lines.push({ id: "p1", story: null, mechanical: true, text: "No news organisation has made a projection in any race yet." });
  lines.push({ id: "close", story: null, mechanical: true, text: "Counting continues. ScoopFeeds never calls a race: every result we report names the organisation that projected it." });
  return { lines };
}

/** The day-after desk with no writer: what is still uncalled, then the projections made since. */
export function mechanicalCounting(ep, slot) {
  const sen = uncalledRaces(ep, "senate"), gov = uncalledRaces(ep, "governor");
  const lines = [{ id: "open", story: null, mechanical: true, text: "Counting continues, on ScoopFeeds Radio." }];
  if (sen.length) lines.push({ id: "u1", story: null, mechanical: true, text: `The Senate ${sen.length > 1 ? "races" : "race"} in ${list(sen)} ${sen.length > 1 ? "have" : "has"} not yet been projected by any news organisation we follow.` });
  if (gov.length) lines.push({ id: "u2", story: null, mechanical: true, text: `The ${gov.length > 1 ? "races" : "race"} for governor in ${list(gov)} ${gov.length > 1 ? "have" : "has"} not yet been projected by any news organisation we follow.` });
  lines.push(...projectionLines(ep, { budget: Math.max(0, wordBudget(slot) - lines.reduce((n, l) => n + words(l.text), 0) - 20) }));
  lines.push({ id: "close", story: null, mechanical: true, text: "Counting continues." });
  return { lines };
}

// ── the 15-minute updates on the station ──────────────────────────────────────────────────────────────────────
export const UPDATE_DEFAULTS = Object.freeze({ leadMin: 6, marginSec: 20 });

/**
 * Which update slot to produce now, from programmes `targets` ([{ dir, hourStart, prog }]). An update starts
 * `leadMin` before its slot and must be spliced `marginSec` before it airs. `done` holds the keys already handled.
 * @returns {{ due: { target, slot, key, deadline }|null, missed: { target, slot, key }[] }}
 */
export function updatesDue(targets, now, done, opts = {}) {
  const o = { ...UPDATE_DEFAULTS, ...opts };
  const missed = []; let due = null;
  for (const t of targets) {
    for (const s of (t.prog?.slots || []).filter((x) => UPDATE_ID.test(x.id) && !x.insert).sort((a, b) => a.start - b.start)) {
      const key = `${t.hourStart}/${s.id}`;
      if (done.has(key)) continue;
      const deadline = s.start - o.marginSec * 1000;
      if (now >= deadline) { missed.push({ target: t, slot: s, key }); continue; }
      if (!due && now >= s.start - o.leadMin * MIN) due = { target: t, slot: s, key, deadline };
    }
  }
  return { due, missed };
}

/** Splice a produced update over its placeholder in <dir>/programme.json, under the lock. Refuses once its slot has started. */
export function insertUpdate(dir, ins, { now = Date.now, marginMs = 1500 } = {}) {
  return withProgrammeLock(dir, () => {
    const pf = path.join(dir, "programme.json");
    const prog = JSON.parse(fs.readFileSync(pf, "utf8"));
    if (now() > ins.cut - marginMs) throw new Error(`too late: the update slot at ${new Date(ins.cut).toISOString()} has started`);
    const slot = (prog.slots || []).find((s) => s.id === ins.id);
    if (!slot || slot.start !== ins.cut || slot.end !== ins.resumeAt) throw new Error(`no placeholder ${ins.id} at ${new Date(ins.cut).toISOString()} in this programme`);
    if ((prog.inserts || []).some((x) => x.id !== ins.id && ins.cut < x.resumeAt && x.cut < ins.resumeAt)) throw new Error("another insert already holds that slot");
    const out = spliceProgramme(prog, { cut: ins.cut, resumeAt: ins.resumeAt, partFile: ins.partFile, cues: ins.cues, lines: ins.lines || [] });
    out.slots = prog.slots.map((s) => (s.id === ins.id ? { ...s, insert: true, update: ins.at } : s));
    out.inserts = [...(prog.inserts || []).filter((x) => x.id !== ins.id), ins];
    fs.writeFileSync(`${pf}.tmp`, JSON.stringify(out, null, 1));
    fs.renameSync(`${pf}.tmp`, pf);
    return out;
  });
}

// ── fixtures (the rehearsal's projections) ──────────────────────────────────────────────────────────────────
/**
 * Fixture articles timed from the start of the special ({ minutesAfterStart, source, title, description }),
 * placed on `night`'s clock. extractElectionPack() sees only those already published, so calls arrive over the night.
 */
export function fixtureArticles(file, night = nightWindow()) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  return (j.articles || j).map((a, i) => ({ source: a.source, title: a.title, description: a.description || "",
    published: night.from + Number(a.minutesAfterStart) * MIN, url: a.url || `https://fixture.invalid/election/${i + 1}` }));
}
export const DEFAULT_FIXTURE = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "electionNight.fixture.json");

// ── the rehearsal's measurements ────────────────────────────────────────────────────────────────────────────
/**
 * Every kept electoral line re-checked against its own pack: a result must name the organisation that projected
 * it and match an attributed item. The checks already drop such lines, so any violation here is a bug.
 * @returns {{ lines: number, results: number, violations: { slot, line, text, why }[] }}
 */
export function attributionAudit(segments, slots, pack) {
  const out = { lines: 0, results: 0, violations: [] };
  for (const s of slots) {
    for (const l of segments?.[s.id]?.lines || []) {
      if (!isElectoral(String(l.text || ""), s)) continue;
      out.lines++;
      if (pack?.election && /\b(projects?|projected|called|declared|wins?|won)\b/i.test(l.text)) out.results++;
      const why = electionReason(String(l.text || ""), pack?.election || null);
      if (why) out.violations.push({ slot: s.id, line: l.id, text: String(l.text).slice(0, 160), why });
    }
  }
  return out;
}

/**
 * Dead air in a programme's audio plan: from the pre-roll to the end, every moment must be covered by a part
 * that is long enough. `durationOf(file)` -> seconds (NaN when unreadable: unmeasured, reported as such).
 * @returns {{ gaps: { from, to, sec }[], unmeasured: string[] }}
 */
export function audioCoverage(prog, durationOf) {
  const audio = [...(prog?.audio || [])].sort((a, b) => a.from - b.from);
  const start = prog.hourStart - PREROLL_SEC * 1000, end = prog.endsAt;
  const gaps = [], unmeasured = [];
  if (!audio.length) return { gaps: [{ from: start, to: end, sec: (end - start) / 1000 }], unmeasured };
  if (audio[0].from > start + 1000) gaps.push({ from: start, to: audio[0].from, sec: (audio[0].from - start) / 1000 });
  for (let i = 0; i < audio.length; i++) {
    const a = audio[i], until = i + 1 < audio.length ? audio[i + 1].from : end;
    const d = durationOf(a.file);
    if (!Number.isFinite(d)) { unmeasured.push(a.file); continue; }
    const covered = (a.origin ?? a.from) + d * 1000;
    if (covered < until - 1500) gaps.push({ from: covered, to: until, sec: Math.round((until - covered) / 100) / 10 });
  }
  return { gaps, unmeasured };
}
