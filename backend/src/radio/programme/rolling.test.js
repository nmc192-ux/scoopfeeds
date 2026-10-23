// #195: the 24/7 rolling loop. The station runs on a virtual clock here, so six simulated hours take milliseconds.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planHour, sessionsAt, etHour, broadcastRollDue } from "./dayClock.js";
import { buildClock, checkClock } from "./clock.js";
import { retimeProgramme, spliceProgramme, pickStrongest, prepareRepeat } from "./repeat.js";
import { RollingStation, WriterLedger, SerialQueue, firstHour, topChanged, refreshSlot, hourStamp, continuousBroadcast } from "./rollingStation.js";
import { rollingLive } from "./rolling.mjs";
import { isLimitError, buildPrompt } from "./writer.js";
import { partAt } from "../playout/playout.js";
import { broadcastBody } from "../live/youtubeLive.js";

const MIN = 60_000, HOUR = 3_600_000;
const utc = (s) => Date.parse(s);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// ── the day clock ──
test("day clock: 6 am to midnight New York is produced, overnight is a repeat, in summer and winter time", () => {
  // 27 Oct 2026 is EDT (UTC-4); 3 Nov 2026 is EST (UTC-5)
  assert.equal(planHour(utc("2026-10-27T10:00:00Z")).format, "produced");   // 06:00 ET
  assert.equal(planHour(utc("2026-10-27T09:00:00Z")).format, "repeat");     // 05:00 ET
  assert.equal(planHour(utc("2026-10-28T03:00:00Z")).format, "produced");   // 23:00 ET
  assert.equal(planHour(utc("2026-10-28T04:00:00Z")).format, "repeat");     // 00:00 ET
  assert.equal(planHour(utc("2026-11-03T11:00:00Z")).format, "produced");   // 06:00 EST
  assert.equal(planHour(utc("2026-11-03T10:00:00Z")).format, "repeat");     // 05:00 EST
  const counts = { produced: 0, repeat: 0 };
  for (let h = 0; h < 24; h++) counts[planHour(utc("2026-10-27T00:00:00Z") + h * HOUR).format]++;
  assert.deepEqual(counts, { produced: 18, repeat: 6 });
});

test("day clock: overnight hours are labelled for the Middle East, then UK/Europe, mornings; weather every 2 hours", () => {
  assert.equal(planHour(utc("2026-10-27T04:00:00Z")).audience, "middle-east-morning");   // 00 ET = 08 Dubai
  assert.equal(planHour(utc("2026-10-27T07:00:00Z")).audience, "uk-europe-morning");     // 03 ET = 07 London (GMT from 25 Oct)
  assert.equal(planHour(utc("2026-10-27T14:00:00Z")).audience, "us");
  const weather = Array.from({ length: 24 }, (_, h) => planHour(utc("2026-10-27T00:00:00Z") + h * HOUR)).filter((p) => p.weather);
  assert.equal(weather.length, 12);
  assert.ok(weather.every((p) => p.etHour % 2 === 0));
});

test("day clock: Markets Now follows the exchanges in session", () => {
  const ids = (t) => sessionsAt(utc(t)).map((s) => s.id).sort();
  assert.deepEqual(ids("2026-10-27T14:00:00Z"), ["LSE", "NYSE", "XETRA"]);   // Tue 10:00 ET, 14:00 London
  assert.deepEqual(ids("2026-10-27T20:30:00Z"), []);                          // after the New York close, before Asia
  assert.deepEqual(ids("2026-10-27T05:00:00Z"), ["HKEX", "NSE", "PSX", "TSE"]);
  assert.deepEqual(ids("2026-10-31T14:00:00Z"), []);                          // Saturday
  const slots = [{ id: "markets-1", segment: "markets", title: "Markets Now", lenSec: 120, sting: true }];
  const pack = { top: [], desks: {}, markets: [], weather: [] };
  assert.match(buildPrompt(pack, slots, { hourLabel: "x", cityTimes: "y", marketsAsOf: {}, marketsLead: { "markets-1": ["Europe"] } }), /lead with the Europe rows/);
  assert.match(buildPrompt(pack, slots, { hourLabel: "x", cityTimes: "y", marketsAsOf: {} }), /lead with the US indices/);
});

test("clock: an hour without weather gives its 90 s to the half-hour headlines and stays contiguous", () => {
  const H = utc("2026-10-27T15:00:00Z");
  const c = buildClock(H, { weather: false });
  assert.deepEqual(checkClock(c), []);
  assert.ok(!c.find((s) => s.id === "weather"));
  const half = c.find((s) => s.id === "half");
  assert.equal(half.endSec, 2070); assert.equal(half.stories, 7);
  const f = buildClock(H, { weather: false, featureSec: 700 });
  assert.deepEqual(checkClock(f), []);
  assert.deepEqual(checkClock(buildClock(H)), []);
  assert.ok(buildClock(H).find((s) => s.id === "weather"), "the default clock is unchanged");
});

test("broadcast roll: at a quiet hand-over after 6 h, and always before 12 h", () => {
  const start = utc("2026-10-27T13:00:00Z");   // 09:00 ET
  const at = (h) => start + h * HOUR - MIN;      // hand-overs, a minute before the hour
  assert.equal(broadcastRollDue({ startedAt: start, at: at(3) }), false);
  assert.equal(broadcastRollDue({ startedAt: start, at: at(7) }), true, "16:00 ET is a roll slot, 7 h in");
  assert.equal(broadcastRollDue({ startedAt: utc("2026-10-27T15:00:00Z"), at: utc("2026-10-27T20:00:00Z") - MIN }), false, "16:00 ET but only 5 h old");
  assert.equal(broadcastRollDue({ startedAt: utc("2026-10-27T11:00:00Z"), at: utc("2026-10-27T22:00:00Z") - MIN }), true, "the next hour would pass 12 h");
  for (let h = 1; h <= 12; h++) if (broadcastRollDue({ startedAt: start, at: at(h) })) return;
  assert.fail("never rolled within 12 h");
});

// ── repeats and splices ──
test("retime: every programme time moves with the hour; the market time stays real", () => {
  const H0 = utc("2026-10-27T02:00:00Z"), H1 = utc("2026-10-27T05:00:00Z"), d = H1 - H0;
  const p = retimeProgramme({ hourStart: H0, endsAt: H0 + 3630e3, builtAt: 7, audio: [{ file: "a", from: H0 - 900e3 }, { file: "b", from: H0 + 60e3, origin: H0 - 900e3 }],
    cues: [{ at: H0 - 900e3, scene: "countdown", data: { target: H0 } }, { at: H0 + 9, scene: "film", data: { t0: H0 + 9 } }, { at: H0 + 10, scene: "music", data: { next: { title: "x", at: H0 + 99 } } }, { at: H0 + 11, scene: "markets", data: { asOf: 123 } }],
    slots: [{ id: "x", start: H0, end: H0 + 5 }] }, H1);
  assert.equal(p.hourStart, H1); assert.equal(p.endsAt, H1 + 3630e3);
  assert.deepEqual(p.audio.map((a) => a.from), [H0 - 900e3 + d, H0 + 60e3 + d]);
  assert.equal(p.audio[1].origin, H0 - 900e3 + d);
  assert.equal(p.cues[0].data.target, H1); assert.equal(p.cues[1].data.t0, H0 + 9 + d); assert.equal(p.cues[2].data.next.at, H0 + 99 + d);
  assert.equal(p.cues[3].data.asOf, 123);
  assert.equal(p.slots[0].start, H1); assert.equal(p.repeatOf.hourStart, H0);
});

test("splice: a fresh top of the hour, then the repeated hour resumes in step", () => {
  const H = 1_000_000_000_000;
  const prog = { hourStart: H, audio: [{ file: "part-countdown.wav", from: H - 900e3 }, { file: "part-music-4-x.wav", from: H + 3150e3 }],
    cues: [{ at: H - 900e3, scene: "countdown" }, { at: H + 10e3, scene: "title", old: true }, { at: H + 400e3, scene: "markets" }] };
  const out = spliceProgramme(prog, { cut: H + 6e3, resumeAt: H + 360e3, partFile: "part-the-hour-new.wav", cues: [{ at: H + 7e3, scene: "title", fresh: true }] });
  assert.deepEqual(out.audio, [
    { file: "part-countdown.wav", from: H - 900e3 },
    { file: "part-the-hour-new.wav", from: H + 6e3 },
    { file: "part-countdown.wav", from: H + 360e3, origin: H - 900e3 },
    { file: "part-music-4-x.wav", from: H + 3150e3 }]);
  assert.deepEqual(out.cues.map((c) => c.scene + (c.fresh ? "*" : "")), ["countdown", "title*", "markets"]);
  // the playout seeks the resumed part from its own origin, not from the switch time
  const p = { ...out, endsAt: H + 3630e3 };
  assert.deepEqual(partAt(p, H + 100e3), { file: "part-the-hour-new.wav", from: H + 6e3, origin: H + 6e3, key: `part-the-hour-new.wav@${H + 6e3}` });
  assert.equal(partAt(p, H + 400e3).origin, H - 900e3);
  assert.equal(partAt(p, H + 3700e3), null);
});

function seedProduced(airDir, H, { keptShare = 0.9, hourStories = 5, decision = "produced", ok = true } = {}) {
  const dir = path.join(airDir, hourStamp(H));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "part-countdown.wav"), "RIFF-fake");
  fs.writeFileSync(path.join(dir, "programme.json"), JSON.stringify({ hourStart: H, endsAt: H + 3630e3, audio: [{ file: "part-countdown.wav", from: H - 900e3 }], cues: [{ at: H - 900e3, scene: "countdown", data: { target: H } }], slots: [] }));
  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({ hourStart: H, decision, check: { ok, stats: { keptShare, hourStories, cues: 40 } } }));
  return dir;
}

test("strongest recent hour: produced and passed, best score, within the window; repeats are never repeated", () => {
  const air = tmp("air-"), H = utc("2026-10-27T04:00:00Z");
  seedProduced(air, H - 2 * HOUR, { keptShare: 0.7 });
  const best = seedProduced(air, H - 4 * HOUR, { keptShare: 0.95 });
  seedProduced(air, H - 1 * HOUR, { keptShare: 1, decision: "repeat" });
  seedProduced(air, H - 3 * HOUR, { keptShare: 1, ok: false });
  seedProduced(air, H - 30 * HOUR, { keptShare: 1 });
  assert.equal(pickStrongest(air, H).dir, best);
  assert.equal(pickStrongest(tmp("air-"), H), null);
  const dst = path.join(air, hourStamp(H));
  const p = prepareRepeat(best, dst, H);
  assert.equal(p.hourStart, H);
  assert.equal(fs.readFileSync(path.join(dst, "part-countdown.wav"), "utf8"), "RIFF-fake");
  assert.ok(!fs.existsSync(path.join(dst, "status.json")), "the source hour's status is not copied");
});

// ── cost guard ──
test("writer ledger: counts per day and hour; the budget and a usage limit both stop the writer", () => {
  let now = utc("2026-10-27T12:00:00Z");
  const L = new WriterLedger({ dir: tmp("ledger-"), maxPerDay: 3, cooldownMin: 60, now: () => now });
  assert.equal(L.guard().ok, true);
  L.add(now, { calls: 2, failures: 1 });
  assert.equal(L.day().byHour["2026-10-27T12"].calls, 2);
  L.add(now, { calls: 1, failures: 0 });
  assert.match(L.guard().reason, /day budget spent \(3\/3/);
  now += 13 * HOUR;   // next UTC day
  assert.equal(L.guard().ok, true);
  L.add(now, { calls: 1, failures: 1, limitHit: true });
  assert.match(L.guard().reason, /cool-down/);
  now += 61 * MIN;
  assert.equal(L.guard().ok, true);
  assert.equal(isLimitError("Claude AI usage limit reached|1761300000"), true);
  assert.equal(isLimitError("claude error: 429 rate_limit_error"), true);
  assert.equal(isLimitError("unbalanced JSON in the reply"), false);
});

test("helpers: first hour, top-story change, refresh slot, gates", () => {
  assert.equal(firstHour(utc("2026-10-27T13:20:00Z")), utc("2026-10-27T14:00:00Z"));
  assert.equal(firstHour(utc("2026-10-27T13:40:00Z")), utc("2026-10-27T15:00:00Z"));
  const a = { id: "t1", headline: "Senate passes the budget bill after an all-night session" };
  assert.equal(topChanged(a, { id: "t1", headline: a.headline }), false);
  assert.equal(topChanged(a, { id: "t7", headline: "Senate passes budget bill", outlets: [{ title: "Senate passes the budget bill after all-night session" }] }), false);
  assert.equal(topChanged(a, { id: "t2", headline: "Earthquake strikes northern Japan", outlets: [{ title: "Strong earthquake hits Japan" }] }), true);
  assert.equal(topChanged(null, a), false, "unmeasurable is not a change");
  const H = utc("2026-10-27T14:00:00Z");
  const prog = { slots: buildClock(H).map(({ id, kind, start }) => ({ id, kind, start })) };
  assert.equal(refreshSlot(prog, H + 42 * MIN).id, "music-4");
  assert.equal(refreshSlot(prog, H + 30 * MIN).id, "music-3");
  assert.equal(refreshSlot(prog, H + 56 * MIN), null);
  for (const [e, want] of [[{ RADIO_AUTOAIR_ENABLED: "1", RADIO_ROLLING_ENABLED: "1" }, true], [{ RADIO_AUTOAIR_ENABLED: "1" }, false], [{ RADIO_ROLLING_ENABLED: "1" }, false], [{ RADIO_AUTOAIR_ENABLED: "1", RADIO_ROLLING_ENABLED: "true" }, false]]) assert.equal(rollingLive(e), want);
  assert.equal(broadcastBody({ title: "t", startMs: 0, autoStop: false }).contentDetails.enableAutoStop, false);
  assert.equal(broadcastBody({ title: "t", startMs: 0 }).contentDetails.enableAutoStop, true, "the one-hour broadcast keeps auto-stop");
});

test("serial queue: jobs never overlap", async () => {
  const q = new SerialQueue();
  const order = [];
  await Promise.all([1, 2, 3].map((n) => q.enqueue(`j${n}`, async () => { order.push(`+${n}`); await new Promise((r) => setTimeout(r, 5)); order.push(`-${n}`); })));
  assert.deepEqual(order, ["+1", "-1", "+2", "-2", "+3", "-3"]);
  assert.equal(q.maxRunning, 1);
});

// ── the station, on a virtual clock ──
function virtualClock(start) {
  let now = start, seq = 0;
  const timers = [];
  const sleep = (ms) => new Promise((r) => timers.push({ t: now + Math.max(0, ms), r, seq: seq++ }));
  async function drive(p) {
    let done = false; p.then(() => { done = true; }, () => { done = true; });
    for (let i = 0; i < 200_000; i++) {
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

function rig({ start, forceFail = [], paused = false, ledgerMax = 96, top = { id: "t9", headline: "Earthquake strikes northern Japan", outlets: [{ title: "Strong earthquake hits Japan" }] } } = {}) {
  const clock = virtualClock(start);
  const airDir = tmp("rolling-air-");
  const calls = [], plays = [], alerts = [], logs = [];
  const produce = async (a) => {
    calls.push({ ...a, at: clock.now() });
    await clock.sleep(10 * MIN);
    fs.mkdirSync(a.out, { recursive: true });
    const wf = path.join(a.out, "writer.json");
    let w = { runs: [] }; try { w = JSON.parse(fs.readFileSync(wf, "utf8")); } catch { /* */ }
    w.runs.push({ calls: a.headlineWriter ? 0 : 1, failures: 0 }); fs.writeFileSync(wf, JSON.stringify(w));
    if (!a.from) {
      fs.writeFileSync(path.join(a.out, "programme.json"), JSON.stringify({ hourStart: a.hourStart, endsAt: a.hourStart + 3630e3, audio: [{ file: "part-countdown.wav", from: a.hourStart - 900e3 }], cues: [],
        slots: buildClock(a.hourStart, { weather: a.weather }).map(({ id, kind, start: s, end }) => ({ id, kind, start: s, end })) }));
      fs.writeFileSync(path.join(a.out, "part-countdown.wav"), "x");
      fs.writeFileSync(path.join(a.out, "pack.json"), JSON.stringify({ top: [{ id: "t1", headline: "Senate passes the budget bill after an all-night session" }] }));
    }
    return 0;
  };
  const check = (dir, { hourStart }) => {
    try { const p = JSON.parse(fs.readFileSync(path.join(dir, "programme.json"), "utf8")); return p.hourStart === hourStart ? { ok: true, problems: [], stats: { keptShare: 0.9, hourStories: 5, cues: 40 } } : { ok: false, problems: ["wrong hour"], stats: {} }; }
    catch { return { ok: false, problems: ["programme.json missing"], stats: {} }; }
  };
  const playout = { start(o) { let end; const done = new Promise((r) => { end = r; }); plays.push({ ...o, at: clock.now() }); return { done, stop: async () => { plays.at(-1).stoppedAt ??= clock.now(); end(0); } }; } };
  const ledger = new WriterLedger({ dir: tmp("ledger-"), maxPerDay: ledgerMax, now: clock.now });
  const station = new RollingStation({
    airDir, produce, check, playout, ledger, now: clock.now, sleep: clock.sleep,
    topStory: async () => top, log: (m) => logs.push(m), alert: async (m) => { alerts.push(m); },
    isPaused: () => paused, forceFail: new Set(forceFail.map(hourStamp)),
  });
  return { clock, airDir, calls, plays, alerts, logs, ledger, station };
}

test("station: six produced hours, the :30 refresh on a changed top story, a forced failure falls back without dead air", async () => {
  const start = utc("2026-10-27T13:20:00Z");   // 09:20 ET: hours 10..15 ET are all prime
  const H1 = utc("2026-10-27T14:00:00Z");
  const r = rig({ start, forceFail: [H1 + 2 * HOUR] });
  const hours = await r.clock.drive(r.station.run({ hours: 6 }));

  assert.deepEqual(hours.map((h) => h.aired), ["programme", "programme", "247", "programme", "programme", "programme"]);
  assert.equal(hours[2].reason, "producer failed (exit 1)");
  assert.equal(r.alerts.length, 0, "one failed hour alone does not alert DrJ");
  assert.equal(r.station.queue.maxRunning, 1, "producers never overlap");

  // prepares start at :15 of the hour before, and finish before :45
  const prepares = r.calls.filter((c) => !c.from);
  assert.equal(prepares.length, 5, "the forced-fail hour never ran the producer");
  for (const c of prepares) { assert.equal(c.at, Math.max(start, c.hourStart - 45 * MIN)); assert.equal(c.deadline, c.hourStart - 15 * MIN); }

  // the :30 refresh fires for every produced hour on air, from the first music slot >= 12 min ahead
  const refreshes = r.calls.filter((c) => c.from);
  assert.ok(refreshes.length >= 4, `refreshes: ${refreshes.length}`);
  for (const c of refreshes) { assert.equal(c.from, "music-4"); assert.equal(c.at, c.hourStart + 30 * MIN); assert.equal(c.deadline, c.hourStart + 3150e3 - MIN); }
  assert.ok(!refreshes.some((c) => c.hourStart === H1 + 2 * HOUR), "the fallback hour is not refreshed");

  // air never goes dark: every hand-over starts the next playout as the old one stops
  assert.equal(r.plays[0].kind, "247");
  for (let i = 1; i < r.plays.length; i++) assert.equal(r.plays[i].at, r.plays[i - 1].stoppedAt, `gap before play ${i}`);
  const progs = r.plays.filter((p) => p.kind === "programme");
  assert.equal(progs.length, 5);
  for (const p of progs) assert.equal(p.at, p.hourStart - MIN);

  // writer calls per hour: in status.json and in the day ledger
  const st = JSON.parse(fs.readFileSync(path.join(r.airDir, hourStamp(H1), "status.json"), "utf8"));
  assert.equal(st.writer.calls, 2, "the produce call and its refresh");
  assert.equal(st.decision, "produced"); assert.equal(st.aired, "programme"); assert.match(st.refresh.result, /re-produced from music-4/);
  const failed = JSON.parse(fs.readFileSync(path.join(r.airDir, hourStamp(H1 + 2 * HOUR), "status.json"), "utf8"));
  assert.equal(failed.aired, "247"); assert.equal(failed.failed, true);
  assert.equal(r.ledger.day().calls, r.calls.length);
  assert.ok(r.logs.some((l) => /writer 1 call\(s\), 0 failure\(s\); today/.test(l)));
});

test("station: two failed hours in a row alert DrJ once; the next good hour resets the count", async () => {
  const H1 = utc("2026-10-27T14:00:00Z");
  const r = rig({ start: utc("2026-10-27T13:20:00Z"), forceFail: [H1, H1 + HOUR] });
  const hours = await r.clock.drive(r.station.run({ hours: 4 }));
  assert.deepEqual(hours.map((h) => h.aired), ["247", "247", "programme", "programme"]);
  assert.equal(r.alerts.length, 1);
  assert.match(r.alerts[0], /2 hours in a row/);
  assert.equal(r.plays.filter((p) => p.kind === "247").length, 1, "the 24/7 screen keeps running across failed hours");
});

test("station: an unchanged top story does not refresh", async () => {
  const r = rig({ start: utc("2026-10-27T13:20:00Z"), top: { id: "t1", headline: "Senate passes the budget bill after an all-night session" } });
  await r.clock.drive(r.station.run({ hours: 3 }));
  assert.equal(r.calls.filter((c) => c.from).length, 0);
});

test("station: an overnight hour repeats the strongest recent hour with a fresh top of the hour", async () => {
  const r = rig({ start: utc("2026-10-27T03:20:00Z") });   // 23:20 ET; 00:00 ET is a repeat
  const src = seedProduced(r.airDir, utc("2026-10-27T01:00:00Z"));
  const hours = await r.clock.drive(r.station.run({ hours: 1 }));
  assert.deepEqual(hours.map((h) => [h.aired, h.decision]), [["programme", "repeat"]]);
  const c = r.calls[0];
  assert.deepEqual([c.from, c.to, c.headlineWriter], ["the-hour", "markets-1", false]);
  const H = utc("2026-10-27T04:00:00Z");
  const dst = path.join(r.airDir, hourStamp(H));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dst, "programme.json"), "utf8")).hourStart, H);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dst, "status.json"), "utf8")).repeatOf, path.basename(src));
});

test("station: over the day's writer budget, a prime hour becomes a repeat read from headlines (no Claude)", async () => {
  const r = rig({ start: utc("2026-10-27T13:20:00Z"), ledgerMax: 1 });
  r.ledger.add(utc("2026-10-27T13:00:00Z"), { calls: 1, failures: 0 });
  seedProduced(r.airDir, utc("2026-10-27T12:00:00Z"));
  const hours = await r.clock.drive(r.station.run({ hours: 1 }));
  assert.deepEqual(hours.map((h) => h.decision), ["repeat"]);
  assert.equal(r.calls[0].headlineWriter, true);
  const st = JSON.parse(fs.readFileSync(path.join(r.airDir, "2026-10-27T14", "status.json"), "utf8"));
  assert.match(st.costGuard, /day budget spent/);
  assert.equal(st.writer.calls, 0);
});

test("station: with nothing to repeat and no budget, the hour falls back rather than failing air", async () => {
  const r = rig({ start: utc("2026-10-27T13:20:00Z"), ledgerMax: 1 });
  r.ledger.add(utc("2026-10-27T13:00:00Z"), { calls: 1, failures: 0 });
  const hours = await r.clock.drive(r.station.run({ hours: 1 }));
  assert.deepEqual(hours.map((h) => [h.aired, h.reason]), [["247", "no produced hour in the last 18 h to repeat"]]);
});

test("station: PAUSE prepares nothing and keeps the 24/7 screen, without alerts", async () => {
  const r = rig({ start: utc("2026-10-27T13:20:00Z"), paused: true });
  const hours = await r.clock.drive(r.station.run({ hours: 3 }));
  assert.deepEqual(hours.map((h) => h.aired), ["247", "247", "247"]);
  assert.equal(r.calls.length, 0); assert.equal(r.alerts.length, 0);
});

test("station: the continuous YouTube broadcast rolls over at a quiet hand-over, before 12 hours", async () => {
  const r = rig({ start: utc("2026-10-27T13:20:00Z") });   // opens 09:20 ET; 16:00 ET is a roll slot
  const ytCalls = [];
  let n = 0;
  const yt = {
    checkScope: async () => {}, findStream: async () => ({ id: "S" }),
    createBroadcast: async (o) => { ytCalls.push(["create", o.autoStop]); return { id: `B${++n}` }; },
    bind: async (id) => { ytCalls.push(["bind", id]); }, transition: async (id, to) => { ytCalls.push([to, id]); },
  };
  r.station.broadcast = continuousBroadcast({ yt, goLive: async ({ broadcastId }) => { ytCalls.push(["live", broadcastId]); } });
  const hours = await r.clock.drive(r.station.run({ hours: 8 }));
  assert.deepEqual(hours.filter((h) => h.rolled).map((h) => h.hour), ["2026-10-27T20"]);   // the 16:00 ET hand-over
  assert.deepEqual(ytCalls, [["create", false], ["bind", "B1"], ["live", "B1"], ["create", false], ["bind", "B2"], ["complete", "B1"], ["live", "B2"]]);
});

test("disk: hour folders older than the keep window go, by the hour in their name; rehearsal keeps the newest", async () => {
  const { pruneOld } = await import("./rolling.mjs");
  const d = tmp("prune-");
  for (const n of ["2026-10-26T01", "2026-10-27T10", "2026-10-27T13", "notes"]) fs.mkdirSync(path.join(d, n));
  assert.deepEqual(pruneOld(d, { keepHours: 26, now: utc("2026-10-27T14:00:00Z") }), ["2026-10-26T01"]);
  assert.deepEqual(fs.readdirSync(d).sort(), ["2026-10-27T10", "2026-10-27T13", "notes"]);
  const r = tmp("seg-");
  for (const n of ["2026-10-27T10-programme", "2026-10-27T11-247", "2026-10-27T12-programme"]) fs.mkdirSync(path.join(r, n));
  assert.deepEqual(pruneOld(r, { keepNewest: 2 }), ["2026-10-27T10-programme"]);
});
