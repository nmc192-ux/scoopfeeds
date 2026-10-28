// #198: the election night special, its 15-minute updates, the day after and the dress rehearsal report.
// The station runs on a virtual clock here: the whole night takes milliseconds.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planHour } from "./dayClock.js";
import { buildClock, checkClock } from "./clock.js";
import { checkSegments } from "./checks.js";
import { extractElectionPack } from "./electionPack.js";
import { insertionPlan } from "./developingDesk.js";
import { RollingStation, WriterLedger, hourStamp } from "./rollingStation.js";
import { buildPrompt } from "./writer.js";
import {
  SPECIAL_FROM, SPECIAL_UNTIL, DAY_AFTER_UNTIL, MAX_SPECIAL_MUSIC_SEC, UPDATE_ID, nightWindow, stationPlan, buildSpecialClock, addCountingDesk,
  pollClosings, pollCloseLines, addPollCloseLines, etWords, mechanicalUpdate, mechanicalCounting, projectionLines, updatesDue, insertUpdate,
  fixtureArticles, DEFAULT_FIXTURE, attributionAudit, audioCoverage,
} from "./electionNight.js";
import { rehearsalReport, wavSeconds } from "./electionReport.js";
import { LAST_POLLS_CLOSE_ET } from "../election/races2026.js";

const MIN = 60_000, HOUR = 3_600_000;
const utc = (s) => Date.parse(s);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const ON = { RADIO_ELECTION_NIGHT: "1" };
const emptyPack = (election) => ({ builtAt: 0, top: [], desks: { midterms: election?.stories || [] }, markets: [], weather: [], dropped: [], election });
const packAt = (mins, night = nightWindow()) => extractElectionPack(fixtureArticles(DEFAULT_FIXTURE, night), { now: night.from + mins * MIN });

// ── the clock and the plan ──
test("the special's hour: contiguous, updates at :00/:15/:30/:45 of 3 minutes, short music beds only", () => {
  const H = utc("2026-11-04T01:00:00Z");
  const c = buildSpecialClock(H);
  assert.deepEqual(checkClock(c), []);
  const up = c.filter((s) => UPDATE_ID.test(s.id));
  assert.deepEqual(up.map((s) => [s.id, s.startSec, s.lenSec]), [["update-00", 6, 180], ["update-15", 900, 180], ["update-30", 1800, 180], ["update-45", 2700, 180]]);
  assert.ok(up.every((s) => s.mechanical && s.segment === "update"));
  assert.ok(c.filter((s) => s.kind === "music").every((s) => s.lenSec <= MAX_SPECIAL_MUSIC_SEC));
  assert.ok(c.find((s) => s.id === "roundup" && s.startSec < 300), "a full round-up at the top of the hour");
  assert.ok(c.find((s) => s.segment === "compared" && s.race), "The News, Compared on the biggest race, every hour");
  assert.ok(!c.some((s) => ["film", "feature", "markets-1", "weather"].includes(s.id)));
});

test("plan: off unless RADIO_ELECTION_NIGHT=1; the special is 6 pm to 3 am ET; then the day after to the end of 6 Nov", () => {
  for (let H = utc("2026-11-03T12:00:00Z"); H < utc("2026-11-07T12:00:00Z"); H += HOUR) assert.deepEqual(stationPlan(H, { env: {} }), planHour(H), "dark: exactly the day clock");
  const special = [];
  for (let H = utc("2026-11-03T12:00:00Z"); H < utc("2026-11-04T12:00:00Z"); H += HOUR) if (stationPlan(H, { env: ON }).format === "election-special") special.push(H);
  assert.equal(special.length, 9);
  assert.equal(special[0], SPECIAL_FROM); assert.equal(special.at(-1), SPECIAL_UNTIL - HOUR);
  assert.equal(stationPlan(SPECIAL_FROM - HOUR, { env: ON }).election, undefined, "5 pm ET is a normal hour");
  const after = stationPlan(SPECIAL_UNTIL, { env: ON });
  assert.equal(after.election, "day-after"); assert.equal(after.format, "produced", "3 am ET on 4 Nov is produced, not a repeat of a pre-results hour");
  assert.equal(stationPlan(SPECIAL_UNTIL + 3 * HOUR, { env: ON }).format, "produced", "6 am ET is prime anyway");
  assert.equal(stationPlan(utc("2026-11-05T07:00:00Z"), { env: ON }).format, "repeat", "Thursday overnight repeats a counting hour");
  assert.equal(stationPlan(DAY_AFTER_UNTIL - HOUR, { env: ON }).election, "day-after");
  assert.equal(stationPlan(DAY_AFTER_UNTIL, { env: ON }).election, undefined);
});

test("rehearsal: the night moves to the rehearsal's hour; poll closings move with it; no day after", () => {
  const n = nightWindow({ startAt: utc("2026-11-01T17:20:00Z") });
  assert.equal(n.from, utc("2026-11-01T17:00:00Z"));
  assert.equal(stationPlan(n.from, { force: true, night: n, env: {} }).format, "election-special");
  assert.match(stationPlan(n.from, { force: true, night: n, env: {} }).label, /dress rehearsal/);
  assert.equal(stationPlan(n.until, { force: true, night: n, env: {} }).election, undefined);
  const real = pollClosings(SPECIAL_FROM, SPECIAL_UNTIL), moved = pollClosings(n.from, n.until, n);
  assert.deepEqual(moved.map((g) => g.at - n.shift), real.map((g) => g.at));
  assert.equal(pollCloseLines(moved[0], n)[0].text, pollCloseLines(real[0])[0].text, "the call-out reads the election night time");
});

test("poll closings: every state once, at :00 or :30, inside the special, called out in the update of their quarter", () => {
  const g = pollClosings(SPECIAL_FROM, SPECIAL_UNTIL);
  const states = g.flatMap((x) => x.states);
  assert.equal(states.length, Object.keys(LAST_POLLS_CLOSE_ET).length - 1, "every state but DC");
  assert.equal(new Set(states).size, states.length);
  assert.ok(g.every((x) => [0, 30].includes(new Date(x.at).getUTCMinutes())));
  assert.deepEqual(g[0].states, ["GA", "IN", "KY", "SC", "VT", "VA"]);
  assert.equal(g[0].at, utc("2026-11-04T00:00:00Z"));
  const clock = buildSpecialClock(utc("2026-11-04T00:00:00Z"));
  const raw = { "update-00": { lines: [{ id: "open", text: "x" }, { id: "close", text: "y" }] }, "update-15": { lines: [{ id: "open", text: "x" }] } };
  assert.equal(addPollCloseLines(raw, clock.find((s) => s.id === "update-00")).length, 1);
  assert.deepEqual(raw["update-00"].lines.map((l) => l.id), ["open", "pc1", "pc2", "close"]);
  assert.match(raw["update-00"].lines[1].text, /^It is seven o'clock in the evening in New York, and the last polls have closed in Georgia, Indiana, Kentucky, South Carolina, Vermont and Virginia\.$/);
  assert.equal(addPollCloseLines(raw, clock.find((s) => s.id === "update-15")).length, 0);
  assert.deepEqual(["2026-11-04T00:30:00Z", "2026-11-04T05:00:00Z", "2026-11-04T04:45:00Z"].map((x) => etWords(utc(x))), ["half past seven in the evening", "midnight", "quarter to midnight"]);
});

// ── the words: ScoopFeeds never calls a race ──
test("updates and poll call-outs pass the election checks; an unattributed result never airs", () => {
  const ep = packAt(300);
  const slot = buildSpecialClock(utc("2026-11-04T01:00:00Z")).find((s) => s.id === "update-00");
  const raw = { [slot.id]: mechanicalUpdate(ep, slot) };
  addPollCloseLines(raw, slot);
  raw[slot.id].lines.push({ id: "x1", text: "Republicans win the Georgia Senate race." }, { id: "x2", text: "Democrats lead the Ohio Senate count." });
  const { segments, report } = checkSegments(raw, [slot], emptyPack(ep));
  assert.deepEqual(report.map((r) => r.line).sort(), ["x1", "x2"], JSON.stringify(report));
  const kept = segments[slot.id].lines;
  assert.ok(kept.some((l) => /^pc/.test(l.id)) && kept.some((l) => /^p\d/.test(l.id)));
  const audit = attributionAudit(segments, [slot], emptyPack(ep));
  assert.equal(audit.violations.length, 0); assert.ok(audit.results >= 5);
  // with no projection yet, the update says so and claims nothing
  const none = mechanicalUpdate(packAt(10), slot);
  assert.ok(none.lines.some((l) => /No news organisation has made a projection/.test(l.text)));
  assert.equal(checkSegments({ [slot.id]: none }, [slot], emptyPack(packAt(10))).report.length, 0);
});

test("projection lines: newest first, conflicts named, within budget, verbatim", () => {
  const ep = packAt(150);   // AP and Fox disagree on North Carolina
  const p = projectionLines(ep);
  assert.match(p[0].text, /disagree on the North Carolina Senate race/);
  assert.ok(p.some((l) => l.text === "AP projects Democrats win the North Carolina Senate race"));
  assert.ok(p.some((l) => l.text === "Fox News Decision Desk projects Republicans win the North Carolina Senate race"));
  assert.ok(projectionLines(ep, { budget: 12 }).length <= 2);
  assert.ok(projectionLines(ep, { focus: "governor" }).every((l) => /governor/.test(l.text)));
  assert.equal(projectionLines(packAt(215)).some((l) => /Fox News Decision Desk projects Republicans win the North Carolina/.test(l.text)), false, "a withdrawn call is not read");
});

test("day after: the counting desk takes music-1, names uncalled races and claims nothing", () => {
  const H = utc("2026-11-04T15:00:00Z");
  const c = buildClock(H);
  const desk = addCountingDesk(c, H);
  assert.equal(desk.id, "counting"); assert.deepEqual(checkClock(c), []);
  const ep = packAt(380);
  const m = mechanicalCounting(ep, desk);
  assert.match(m.lines.find((l) => l.id === "u1").text, /^The Senate races in .*Georgia.* have not yet been projected by any news organisation we follow\.$/);
  assert.doesNotMatch(m.lines.find((l) => l.id === "u1").text, /Kentucky/);
  assert.equal(checkSegments({ counting: m }, [desk], emptyPack(ep)).report.length, 0);
});

test("writer prompts: every special segment carries the never-call rules", () => {
  const slots = buildSpecialClock(utc("2026-11-04T01:00:00Z")).filter((s) => s.kind === "spoken" && !s.mechanical);
  const p = buildPrompt(emptyPack(packAt(100)), slots, { hourLabel: "", cityTimes: "", marketsAsOf: {} });
  for (const id of ["roundup", "results-1", "results-2", "results-3"]) assert.match(p.split("\n").find((l) => l.startsWith(`- "${id}"`)), /ScoopFeeds never calls a race/);
  assert.match(p, /the biggest race of election night/);
  assert.match(buildPrompt(emptyPack(null), [{ id: "update-15", segment: "update", title: "Election update", lenSec: 180, sting: true }], {}), /Lines "pc1".. \(poll closings\) may be added for you/);
});

// ── splicing an update ──
function placeholderProgramme(dir, H) {
  const slots = buildSpecialClock(H).map(({ id, kind, start, end, title }) => ({ id, kind, start, end, title }));
  fs.writeFileSync(path.join(dir, "programme.json"), JSON.stringify({ hourStart: H, endsAt: H + 3630e3, election: "special", audio: [{ file: "part-countdown.wav", from: H - 900e3 }], cues: [], slots }));
}

test("an update replaces its placeholder in place; never after it has started; a developing bulletin never takes its slot", () => {
  const dir = tmp("upd-"), H = utc("2026-11-04T01:00:00Z");
  placeholderProgramme(dir, H);
  const s = JSON.parse(fs.readFileSync(path.join(dir, "programme.json"), "utf8")).slots.find((x) => x.id === "update-15");
  const ins = { id: "update-15", cut: s.start, end: s.end, resumeAt: s.end, partFile: "part-update-15-x.wav", cues: [{ at: s.start + 1000, scene: "known" }], lines: [], at: 1 };
  assert.throws(() => insertUpdate(dir, ins, { now: () => s.start }), /too late/);
  const out = insertUpdate(dir, ins, { now: () => s.start - 5 * MIN });
  assert.deepEqual(out.audio.map((a) => a.file), ["part-countdown.wav", "part-update-15-x.wav", "part-countdown.wav"]);
  assert.equal(out.audio[2].from, s.end); assert.equal(out.audio[2].origin, H - 900e3, "the hour resumes in step after the update");
  assert.ok(out.slots.find((x) => x.id === "update-15").insert);
  assert.throws(() => insertUpdate(dir, { ...ins, id: "update-30" }, { now: () => s.start - 5 * MIN }), /no placeholder/);
  // #201's desk skips the update slots: the first boundary it may take after update-15 is results-1
  const prog = JSON.parse(fs.readFileSync(path.join(dir, "programme.json"), "utf8"));
  const p = insertionPlan({ ...prog, inserts: [] }, { now: s.start - 6 * MIN, detectedAt: s.start - 6 * MIN });
  assert.notEqual(p.slot?.id, "update-15"); assert.ok(!UPDATE_ID.test(p.slot?.id || ""));
});

test("updates are due a few minutes before their slot, and a missed window is recorded", () => {
  const H = utc("2026-11-04T01:00:00Z");
  const prog = { slots: buildSpecialClock(H) };
  const t = [{ dir: "d", hourStart: H, prog }];
  const done = new Set();
  assert.equal(updatesDue(t, H + 8 * MIN, done).due, null);
  const d = updatesDue(t, H + 9 * MIN, done);
  assert.equal(d.due.slot.id, "update-15"); assert.equal(d.due.deadline, H + 900e3 - 20e3);
  assert.deepEqual(d.missed.map((m) => m.slot.id), ["update-00"], "update-00 had already started");
  done.add(d.due.key); done.add(d.missed[0].key);
  assert.deepEqual(updatesDue(t, H + 15 * MIN, done).missed.map((m) => m.slot.id), ["update-15"].filter((id) => !done.has(`${H}/${id}`)));
});

// ── the station on election night, on a virtual clock ──
function virtualClock(start) {
  let now = start, seq = 0;
  const timers = [];
  const sleep = (ms) => new Promise((r) => timers.push({ t: now + Math.max(0, ms), r, seq: seq++ }));
  async function drive(p) {
    let done = false; p.then(() => { done = true; }, () => { done = true; });
    for (let i = 0; i < 400_000; i++) {
      for (let k = 0; k < 15; k++) await new Promise((r) => setImmediate(r));
      if (done) return p;
      if (!timers.length) throw new Error("deadlock: nothing scheduled");
      timers.sort((a, b) => a.t - b.t || a.seq - b.seq);
      const x = timers.shift(); now = Math.max(now, x.t); x.r();
    }
    throw new Error("simulation did not finish");
  }
  return { now: () => now, sleep, drive };
}

function nightRig({ start, failUpdates = [], night = nightWindow(), force = false, env = ON }) {
  const clock = virtualClock(start);
  const airDir = tmp("night-air-");
  const calls = [], upd = [], logs = [];
  const produce = async (a) => {
    calls.push({ hourStart: a.hourStart, election: a.plan?.election || null, format: a.plan?.format, headlineWriter: !!a.headlineWriter, at: clock.now() });
    await clock.sleep(10 * MIN);
    fs.mkdirSync(a.out, { recursive: true });
    fs.writeFileSync(path.join(a.out, "writer.json"), JSON.stringify({ runs: [{ calls: 1, failures: 0 }] }));
    const slots = (a.plan?.election === "special" ? buildSpecialClock(a.hourStart) : buildClock(a.hourStart)).map(({ id, kind, start: s, end, title }) => ({ id, kind, start: s, end, title }));
    fs.writeFileSync(path.join(a.out, "programme.json"), JSON.stringify({ hourStart: a.hourStart, endsAt: a.hourStart + 3630e3, election: a.plan?.election, audio: [{ file: "p.wav", from: a.hourStart - 900e3 }], cues: [], slots }));
    return 0;
  };
  const check = () => ({ ok: true, problems: [], stats: {} });
  const playout = { start() { let end; const done = new Promise((r) => { end = r; }); return { done, stop: async () => end(0) }; } };
  const updates = async ({ dir, hourStart, slot, deadline, writerBusy }) => {
    upd.push({ hour: hourStamp(hourStart), slot: slot.id, at: clock.now(), deadline, airs: slot.start, writerBusy });
    await clock.sleep(2 * MIN);
    if (failUpdates.includes(`${hourStamp(hourStart)}/${slot.id}`)) return 3;
    insertUpdate(dir, { id: slot.id, cut: slot.start, end: slot.end, resumeAt: slot.end, partFile: `part-${slot.id}.wav`, cues: [], lines: [], at: clock.now() }, { now: clock.now });
    return { code: 0, writer: writerBusy ? "mechanical (writer busy)" : "fake" };
  };
  const station = new RollingStation({
    airDir, produce, check, playout, updates, now: clock.now, sleep: clock.sleep, log: (m) => logs.push(m),
    topStory: async () => null, ledger: new WriterLedger({ dir: tmp("night-ledger-"), now: clock.now }),
    grid: (H) => stationPlan(H, { env, night, force }),
  });
  return { clock, airDir, calls, upd, logs, station };
}

test("station: the special starts and ends on its own at 6 pm and 3 am ET; four updates an hour; a failed update is skipped cleanly", async () => {
  const start = utc("2026-11-03T21:20:00Z");   // 4:20 pm ET
  const failing = `${hourStamp(utc("2026-11-04T01:00:00Z"))}/update-30`;
  const r = nightRig({ start, failUpdates: [failing] });
  const hours = await r.clock.drive(r.station.run({ hours: 12 }));
  const by = Object.fromEntries(hours.map((h) => [h.hour, h]));
  assert.equal(by[hourStamp(utc("2026-11-03T22:00:00Z"))].decision, "produced", "5 pm ET: the normal clock");
  for (let H = SPECIAL_FROM; H < SPECIAL_UNTIL; H += HOUR) assert.equal(by[hourStamp(H)].decision, "election-special", hourStamp(H));
  assert.equal(by[hourStamp(SPECIAL_UNTIL)].decision, "produced", "3 am ET: back to the normal clock (day after)");
  assert.equal(r.calls.find((c) => c.hourStart === SPECIAL_UNTIL).election, "day-after");
  assert.ok(hours.every((h) => h.aired === "programme"), "no dead air: every hour aired a programme");

  // every special hour got four updates, each started at most 6 min before its slot and finished before it aired
  const special = r.upd.filter((u) => Date.parse(`${u.hour.slice(0, 10)}T${u.hour.slice(11, 13)}:00:00Z`) < SPECIAL_UNTIL);
  assert.equal(special.length, 9 * 4, JSON.stringify(r.station.updateLog.filter((u) => u.result !== "on air")));
  assert.ok(special.every((u) => u.at >= u.airs - 6 * MIN && u.at + 2 * MIN <= u.deadline));
  assert.ok(!r.upd.some((u) => u.hour === hourStamp(SPECIAL_UNTIL)), "no updates once the special has ended");
  const log = r.station.updateLog;
  assert.equal(log.filter((u) => u.result === "on air").length, 35);
  assert.ok(log.filter((u) => u.result === "on air").every((u) => ["fake", "mechanical (writer busy)"].includes(u.writer)));
  assert.ok(log.some((u) => u.writer === "mechanical (writer busy)"), "updates while the next hour is being written are mechanical");
  const skipped = log.find((u) => `${u.hour}/${u.slot}` === failing);
  assert.equal(skipped.result, "skipped"); assert.match(skipped.reason, /placeholder airs/);
  const st = JSON.parse(fs.readFileSync(path.join(r.airDir, hourStamp(utc("2026-11-04T01:00:00Z")), "status.json"), "utf8"));
  assert.equal(st.updates.length, 4);
  assert.equal(st.stage, "on-air");
});

test("station: with the night off nothing changes; over the cost guard the special is read by the headline writer, never a repeat", async () => {
  const off = nightRig({ start: utc("2026-11-03T22:20:00Z"), env: {} });
  const h = await off.clock.drive(off.station.run({ hours: 3 }));
  assert.ok(h.every((x) => x.decision === "produced")); assert.equal(off.upd.length, 0);

  const r = nightRig({ start: utc("2026-11-03T22:20:00Z") });
  r.station.ledger.maxPerDay = 0;
  const hours = await r.clock.drive(r.station.run({ hours: 2 }));
  assert.ok(hours.every((x) => x.decision === "election-special"));
  assert.ok(r.calls.every((c) => c.headlineWriter));
});

test("dress rehearsal: the special at the rehearsal's own hour, report PASS only when everything is measured and clean", async () => {
  const start = utc("2026-11-01T16:30:00Z");
  const night = nightWindow({ startAt: utc("2026-11-01T17:00:00Z") });
  const r = nightRig({ start, night, force: true, env: {} });
  const hours = await r.clock.drive(r.station.run({ hours: 2 }));
  assert.deepEqual(hours.map((h) => h.decision), ["election-special", "election-special"]);
  // give each hour the files the report reads, with a fixture pack and checked lines
  for (const h of hours) {
    const dir = path.join(r.airDir, h.hour);
    const ep = extractElectionPack(fixtureArticles(DEFAULT_FIXTURE, night), { now: h.hourStart });
    const slot = buildSpecialClock(h.hourStart).find((s) => s.id === "roundup");
    fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify(emptyPack(ep)));
    fs.writeFileSync(path.join(dir, "segments.json"), JSON.stringify({ roundup: { lines: [{ id: "open", text: "This is the special." }, ...projectionLines(ep)] } }));
    fs.writeFileSync(path.join(dir, "checks.json"), "[]");
    const st = JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"));
    fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({ ...st, check: { ok: true, problems: [] } }));
    assert.ok(slot);
  }
  const full = (f) => (f === "p.wav" ? 3630 + 900 : 180);   // the hour's part runs to the end; each update is 3 min
  const rep = rehearsalReport({ airDir: r.airDir, hours, updates: r.station.updateLog, night, durationOf: (p) => full(path.basename(p)) });
  assert.equal(rep.verdict, "PASS", rep.markdown);
  assert.match(rep.markdown, /8 produced on time, 0 skipped/);
  assert.match(rep.markdown, /0 without a named projecting organisation/);

  // a short part is dead air; an unreadable one is unmeasured, never a pass
  const gap = rehearsalReport({ airDir: r.airDir, hours, updates: r.station.updateLog, night, durationOf: (p) => (path.basename(p) === "p.wav" ? 600 : 180) });
  assert.equal(gap.verdict, "FAIL"); assert.match(gap.markdown, /dead air/);
  const blind = rehearsalReport({ airDir: r.airDir, hours, updates: r.station.updateLog, night, durationOf: () => NaN });
  assert.equal(blind.verdict, "UNVERIFIED");
  // an unattributed result in what aired fails the report
  const dir = path.join(r.airDir, hours[0].hour);
  fs.writeFileSync(path.join(dir, "segments.json"), JSON.stringify({ roundup: { lines: [{ id: "x", text: "Republicans won the Georgia Senate race." }] } }));
  const bad = rehearsalReport({ airDir: r.airDir, hours, updates: r.station.updateLog, night, durationOf: (p) => full(path.basename(p)) });
  assert.equal(bad.verdict, "FAIL"); assert.match(bad.markdown, /without the organisation that projected it/);
});

test("audio coverage and WAV length", () => {
  const H = utc("2026-11-04T01:00:00Z");
  const prog = { hourStart: H, endsAt: H + 3630e3, audio: [{ file: "a", from: H - 900e3 }, { file: "u", from: H + 900e3 }, { file: "a", from: H + 1080e3, origin: H - 900e3 }] };
  assert.deepEqual(audioCoverage(prog, (f) => (f === "a" ? 4530 : 180)).gaps, []);
  assert.equal(audioCoverage(prog, (f) => (f === "a" ? 4530 : 100)).gaps[0].sec, 80);
  const f = path.join(tmp("wav-"), "x.wav");
  const data = Buffer.alloc(48000 * 2 * 2 * 3);
  const h = Buffer.alloc(44); h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(48000, 24); h.writeUInt32LE(48000 * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(f, Buffer.concat([h, data]));
  assert.equal(wavSeconds(f), 3);
  assert.ok(Number.isNaN(wavSeconds(path.join(path.dirname(f), "missing.wav"))));
});
