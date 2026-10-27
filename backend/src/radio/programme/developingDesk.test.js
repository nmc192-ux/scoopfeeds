// #201: the developing desk on the Mac: where a bulletin goes, what it may say, how it is spliced into the hour on
// air, and (rehearsal) a fake fast-growing event on air within 15 minutes, end to end through bulletin.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildClock } from "./clock.js";
import { partAt } from "../playout/playout.js";
import { RollingStation, WriterLedger, refreshSlot } from "./rollingStation.js";
import { buildPrompt } from "./writer.js";
import {
  insertionPlan, DevelopingDesk, developingTick, bulletinPack, mechanicalBulletin, checkBulletin, applyInsert, reapplyInserts,
  insertBulletin, addDevelopingStories, deskEnabled, OPEN_LINE, CLOSE_LINE,
} from "./developingDesk.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIN = 60_000, HOUR = 3_600_000;
const H = Date.parse("2026-10-27T18:00:00Z");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const prog = (h = H) => {
  const slots = buildClock(h);
  return { version: 1, hourStart: h, endsAt: slots.at(-1).end, audio: [{ file: "part-countdown.wav", from: slots[0].start }], cues: [],
    slots: slots.map(({ id, kind, start, end, title }) => ({ id, kind, start, end, title: title || null })) };
};
const at = (id, h = H) => buildClock(h).find((s) => s.id === id).start;
const EV = {
  id: "e1", headline: "Large fire at Rotterdam port warehouse, roads closed", fires: true, follow: true, kind: "new", sensitive: false,
  recent: { articles: 6, outlets: 4 },
  outlets: [
    { source: "Reuters", title: "Large fire at Rotterdam port warehouse, roads closed", description: "A large fire broke out at a warehouse in the port of Rotterdam on Tuesday, police said, and roads around the harbour were closed." },
    { source: "BBC News", title: "Rotterdam port fire: roads closed as crews tackle blaze", description: "Fire crews are tackling a blaze at a port warehouse in Rotterdam. Police closed roads around the harbour." },
    { source: "NOS", title: "Grote brand in loods in Rotterdamse haven", description: "Smoke could be seen across the city, NOS reported." },
  ],
};

test("flag: the desk is dark unless RADIO_DEVELOPING_ENABLED is literally 1", () => {
  assert.equal(deskEnabled({}), false);
  assert.equal(deskEnabled({ RADIO_DEVELOPING_ENABLED: "true" }), false);
  assert.equal(deskEnabled({ RADIO_DEVELOPING_ENABLED: "1" }), true);
});

test("insertion: the next segment boundary, far enough ahead to produce, never an ident, the sign-off or the end card", () => {
  const p = prog();
  const now = H + 9 * MIN;                                  // during compared-1 (8:00-14:00)
  const plan = insertionPlan(p, { now, detectedAt: now });
  assert.equal(plan.slot.id, "music-1");                    // 14:00, 5 min away (> 4 min to produce)
  assert.equal(plan.cut, at("music-1"));
  assert.equal(plan.end - plan.cut, 75_000);
  assert.equal(plan.resumeAt, at("desk-me"), "the grid resumes at the next segment");
  assert.equal(plan.next.title, "Middle East desk");
  // too close to produce in time: the boundary after
  assert.equal(insertionPlan(p, { now: H + 11 * MIN, detectedAt: H + 11 * MIN }).slot.id, "desk-me");
  // late in the hour: the sign-off, idents and end card are never displaced
  const late = insertionPlan(p, { now: H + 54 * MIN, detectedAt: H + 54 * MIN });
  assert.ok(late.none, "nothing left in this hour after music-4");
  // a short slot (the 60 s film) takes a bulletin of its own length, with no resume music
  const film = insertionPlan(p, { now: at("film") - 5 * MIN, detectedAt: at("film") - 5 * MIN, lastInsertAt: -Infinity, opts: { prepSec: 240 } });
  assert.ok(["desk-us", "film"].includes(film.slot.id));
});

test("insertion: 15 minutes from detection at most, and never inside 20 minutes of the last interruption", () => {
  const p = prog();
  const det = H + 9 * MIN;
  const held = insertionPlan(p, { now: det, detectedAt: det, lastInsertAt: H + 2 * MIN });
  assert.ok(held.cut >= H + 22 * MIN, "20 minutes after the last one");
  assert.ok(held.cut <= det + 15 * MIN);
  const none = insertionPlan(p, { now: det, detectedAt: det, lastInsertAt: H + 8 * MIN });
  assert.match(none.none, /20-minute rule/);
  const stale = insertionPlan(p, { now: det + 12 * MIN, detectedAt: det });
  assert.match(stale.none, /too late/);
});

test("words: the mechanical bulletin passes the checks; confirmed needs two named outlets, anything else says unconfirmed", () => {
  const pack = bulletinPack(EV, H);
  const slot = { id: "developing-x", kind: "spoken", segment: "developing", startSec: 840, endSec: 915, lenSec: 75, sting: true };
  const mech = checkBulletin(mechanicalBulletin(pack), slot, pack);
  assert.equal(mech.ok, true, JSON.stringify(mech.report));
  assert.equal(mech.segment.lines[0].text, OPEN_LINE);
  assert.equal(mech.segment.lines.at(-1).text, CLOSE_LINE);
  assert.equal(mech.segment.lines.find((l) => l.id === "c1").confirmed, true);
  const raw = { lines: [
    { id: "open", text: "BREAKING: a huge disaster." },                                                                   // replaced by ours
    { id: "c1", text: "Reuters and BBC News both report a large fire at a port warehouse in Rotterdam.", confirmedBy: ["Reuters", "BBC News"] },
    { id: "c2", text: "Smoke could be seen across the city, NOS reported.", confirmedBy: ["NOS"] },                         // one outlet, not labelled
    { id: "c3", text: "NOS reports smoke could be seen across the city, which has not been confirmed by other outlets.", confirmedBy: ["NOS"] },
    { id: "c4", text: "Reuters reports 40 people were hurt, which is unconfirmed.", confirmedBy: ["Reuters"] },           // a figure not in the pack
    { id: "c5", text: "Officials say the fire is under control.", confirmedBy: [] },                                       // names no outlet
    { id: "c6", text: "Reuters and BBC News report roads around the harbour were closed.", confirmedBy: ["Reuters", "AP"] }, // AP is not in the pack: one valid name
  ] };
  const c = checkBulletin(raw, slot, pack);
  assert.deepEqual(c.segment.lines.map((l) => l.id), ["open", "c1", "c3", "close"]);
  assert.deepEqual(c.report.map((r) => r.line).sort(), ["c2", "c4", "c5", "c6"]);
  assert.equal(c.segment.lines[0].text, OPEN_LINE, "the opening is never the model's");
  assert.equal(checkBulletin({ lines: [{ id: "c1", text: "Officials say it is over." }] }, slot, pack).ok, false, "nothing survives: no bulletin");
});

test("splice: the bulletin airs at the boundary, the hour's own audio resumes at the next segment, and a refresh keeps it", () => {
  const p = prog();
  const plan = insertionPlan(p, { now: H + 9 * MIN, detectedAt: H + 9 * MIN });
  const ins = { id: "developing-1814", eventId: "e1", cut: plan.cut, end: plan.end, resumeAt: plan.resumeAt, partFile: "part-developing-1814.wav",
    cues: [{ at: plan.cut, scene: "story", data: { banner: "Breaking" } }, { at: plan.end + 2000, scene: "music", data: {} }] };
  const q = applyInsert(p, ins);
  assert.equal(partAt(q, plan.cut + 1000).file, "part-developing-1814.wav");
  const back = partAt(q, plan.resumeAt + 1000);
  assert.equal(back.file, "part-countdown.wav");
  assert.equal(back.origin, p.audio[0].from, "the hour's part resumes from its own origin, in step");
  assert.deepEqual(q.slots.filter((s) => s.insert).map((s) => s.kind), ["breaking", "music"]);
  assert.ok(!q.slots.find((s) => s.id === "music-1"), "the displaced slot is gone");
  assert.equal(refreshSlot(q, plan.cut - MIN).id, "music-2", "a refresh never starts from an insert's own slot");
  // a refresh from music-1's predecessor... re-produced audio from compared-1 replaces everything after it, then the insert is put back
  const cut = at("compared-1");
  const refreshed = { ...q, audio: [...q.audio.filter((a) => a.from < cut), { file: "part-refresh.wav", from: cut }], cues: q.cues.filter((c) => c.at < cut), slots: prog().slots };
  const r = reapplyInserts(refreshed, q.inserts, cut);
  assert.equal(partAt(r, plan.cut + 1000).file, "part-developing-1814.wav");
  assert.equal(partAt(r, plan.resumeAt + 1000).file, "part-refresh.wav");
  assert.equal(partAt(r, plan.resumeAt + 1000).origin, cut);
});

test("desk: one bulletin per event per 6 hours; detection time is the first sighting; follow-ups only while still growing", () => {
  const dir = tmp("dev-desk-");
  let now = H;
  const desk = new DevelopingDesk({ dir, now: () => now });
  const list = { updatedAt: H - MIN, events: [EV, { ...EV, id: "e2", fires: false }] };
  const c1 = desk.candidates(list, now);
  assert.deepEqual(c1.map((e) => e.id), ["e1"]);
  assert.equal(c1[0].detectedAt, H - MIN, "the list's own build time");
  now = H + 5 * MIN;
  assert.equal(desk.candidates({ ...list, updatedAt: H + 4 * MIN }, now)[0].detectedAt, H - MIN, "still the first sighting");
  desk.record({ eventId: "e1", cut: H + 10 * MIN });
  assert.deepEqual(desk.candidates(list, now), []);
  assert.equal(desk.followups(list, now).length, 1);
  assert.equal(desk.followups({ events: [{ ...EV, follow: false }] }, now).length, 0, "no longer growing: no follow-up");
  now = H + 7 * HOUR;
  assert.equal(desk.candidates({ ...list, updatedAt: now }, now).length, 1, "after 6 hours it may interrupt again");
  assert.equal(new DevelopingDesk({ dir, now: () => now }).lastInsertAt(), H + 10 * MIN, "the memory survives a restart");
});

test("follow-up: the next hour's pack leads with the developing story and the writer is told so", () => {
  const pack = { top: [{ id: "t1", headline: "Fed holds rates steady", outlets: [{ source: "CNBC", title: "Fed holds rates steady" }], count: 1 }], desks: {}, markets: [], weather: [] };
  addDevelopingStories(pack, [{ eventId: "e1", headline: EV.headline, outlets: EV.outlets }]);
  assert.equal(pack.top[0].id, "dv1");
  assert.equal(pack.top[0].developing, true);
  const slots = [{ id: "the-hour", segment: "the-hour", title: "The Hour", lenSec: 354, stories: 5 }];
  const prompt = buildPrompt(pack, slots, { hourLabel: "x", cityTimes: "y", marketsAsOf: {} });
  assert.match(prompt, /\[dv1\] DEVELOPING: Large fire/);
  assert.match(prompt, /Stories marked DEVELOPING are still growing: lead with them/);
  const plain = buildPrompt({ ...pack, top: pack.top.slice(1) }, slots, { hourLabel: "x", cityTimes: "y", marketsAsOf: {} });
  assert.doesNotMatch(plain, /DEVELOPING/, "no developing story: the prompt is unchanged");
  // already in the pack: marked, not duplicated
  const p2 = { top: [{ id: "t1", headline: "Large fire at Rotterdam port warehouse", outlets: EV.outlets.slice(0, 1), count: 1 }], desks: {} };
  addDevelopingStories(p2, [{ eventId: "e1", headline: EV.headline, outlets: EV.outlets }]);
  assert.equal(p2.top.length, 1); assert.equal(p2.top[0].developing, true);
});

test("tick: the 24/7 screen on air defers; past the window the event is missed and not interrupted for later", async () => {
  const dir = tmp("dev-tick-");
  const desk = new DevelopingDesk({ dir, now: () => H });
  const produceBulletin = async () => { throw new Error("must not produce"); };
  const r1 = await developingTick({ desk, list: { updatedAt: H, events: [EV] }, targets: [], produceBulletin, now: H });
  assert.equal(r1.result, "no insertion this tick");
  const r2 = await developingTick({ desk, list: { updatedAt: H + 12 * MIN, events: [EV] }, targets: [], produceBulletin, now: H + 12 * MIN });
  assert.equal(r2.result, "no insertion this tick");
  assert.equal(desk.state.missed.length, 1);
  const stale = await developingTick({ desk, list: { updatedAt: H - 20 * MIN, events: [EV] }, targets: [], produceBulletin, now: H });
  assert.match(stale.result, /stale/);
});

test("station: the rolling loop runs the desk while it waits, with the hour on air and the next ready hour as targets", async () => {
  let now = H + 10 * MIN;
  const calls = [];
  const st = new RollingStation({
    airDir: tmp("dev-st-"), now: () => now, sleep: async (ms) => { now += ms; }, produce: async () => 0, check: () => ({ ok: true, problems: [], stats: {} }),
    topStory: async () => null, playout: { start: () => ({ stop: async () => {}, done: new Promise(() => {}) }) },
    ledger: new WriterLedger({ dir: tmp("dev-led-"), now: () => now }),
    developing: async (o) => { calls.push(o); return { result: "nothing firing" }; },
  });
  st.onAir = { kind: "programme", dir: "/air/H", hourStart: H };
  st.ready.set(H + HOUR, { dir: "/air/H1" });
  await st.sleepUntil(H + 15 * MIN);
  await st.devBusy;
  assert.ok(calls.length >= 2, `called every 2 minutes (${calls.length})`);
  assert.deepEqual(calls[0].targets, [{ dir: "/air/H", hourStart: H }, { dir: "/air/H1", hourStart: H + HOUR }]);
  st.onAir = { kind: "247", hourStart: H };
  assert.deepEqual(st.developingTargets(), [{ dir: "/air/H1", hourStart: H + HOUR }], "never the 24/7 screen itself; the next produced hour still may");
});

// ── rehearsal: a fake fast-growing event, end to end, through the real bulletin.mjs ──
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
test("REHEARSAL: a fake fast-growing event is on air within 15 minutes (bulletin.mjs, fake voice and writer)", { skip: hasFfmpeg ? false : "no ffmpeg here: UNVERIFIED on this machine" }, async () => {
  const dir = tmp("dev-air-");
  const musicDir = tmp("dev-music-");
  // the hour on air: one part from the countdown on (silence is enough; the playout only reads programme.json)
  const p = prog(Date.parse("2026-10-27T18:00:00Z"));
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "1", path.join(dir, "part-countdown.wav")]);
  fs.writeFileSync(path.join(dir, "programme.json"), JSON.stringify(p));
  const desk = new DevelopingDesk({ dir: tmp("dev-air-desk-") });
  const detectedAt = Date.now();
  // the boundary must be in the future for the real splice: put "now" 9 minutes into this programme's hour
  const shift = (H + 9 * MIN) - detectedAt;
  const shifted = { ...p, hourStart: p.hourStart - shift, endsAt: p.endsAt - shift, audio: p.audio.map((a) => ({ ...a, from: a.from - shift })),
    slots: p.slots.map((s) => ({ ...s, start: s.start - shift, end: s.end - shift })) };
  fs.writeFileSync(path.join(dir, "programme.json"), JSON.stringify(shifted));
  const codes = [];
  const produceBulletin = async ({ dir: d, event, plan, writer }) => {
    const evFile = path.join(d, "ev.json"); fs.writeFileSync(evFile, JSON.stringify(event));
    const r = spawnSync(process.execPath, [path.join(HERE, "bulletin.mjs"), "--dir", d, "--event", evFile, "--cut", String(plan.cut), "--end", String(plan.end), "--resume", String(plan.resumeAt),
      "--slot", plan.slot.id, "--music-dir", musicDir, "--writer", writer, "--fake-voice", "--fake-writer", ...(plan.next ? ["--next-title", plan.next.title, "--next-at", String(plan.next.at)] : [])], { encoding: "utf8" });
    codes.push(r.status, r.stdout.slice(-600), r.stderr.slice(-600));
    return r.status;
  };
  const r = await developingTick({ desk, list: { updatedAt: detectedAt, events: [EV] }, targets: [{ dir, hourStart: shifted.hourStart }], produceBulletin, now: detectedAt, useClaude: false });
  assert.equal(r.result, "inserted", JSON.stringify(codes));
  assert.ok(r.delaySec <= 15 * 60, `on air ${r.delaySec} s after detection`);
  const after = JSON.parse(fs.readFileSync(path.join(dir, "programme.json"), "utf8"));
  const part = partAt(after, r.cut + 2000);
  assert.match(part.file, /^part-developing-/);
  assert.ok(fs.statSync(path.join(dir, part.file)).size > 44100 * 4 * 60, "a minute and more of audio");
  const card = after.cues.find((c) => c.at === r.cut && c.scene === "story");
  assert.equal(card.data.banner, "Breaking");
  assert.equal(card.data.headline, EV.headline, "the outlets' own headline, verbatim");
  assert.deepEqual(card.data.outlets, ["Reuters", "BBC News", "NOS"]);
  assert.ok(after.cues.some((c) => c.at === r.cut && c.scene === "sting"), "the sting: not a sensitive story");
  assert.equal(partAt(after, after.inserts[0].resumeAt + 1000).file, "part-countdown.wav", "the hour resumes");
  const rec = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => /^developing-.*\.json$/.test(f))), "utf8"));
  assert.equal(rec.checked.lines[0].text, OPEN_LINE);
  // a sensitive story (the radio's sensitivity switch): no sting and no music bed under it
  const t2 = Date.now() + 12 * MIN;
  const sens = await developingTick({ desk: new DevelopingDesk({ dir: tmp("dev-air-desk2-") }), list: { updatedAt: t2, events: [{ ...EV, id: "e9", sensitive: true }] },
    targets: [{ dir, hourStart: shifted.hourStart }], produceBulletin, now: t2, useClaude: false });
  assert.equal(sens.result, "inserted", JSON.stringify(codes.slice(-3)));
  const after2 = JSON.parse(fs.readFileSync(path.join(dir, "programme.json"), "utf8"));
  assert.equal(after2.inserts.length, 2);
  assert.ok(!after2.cues.some((c) => c.at === sens.cut && c.scene === "sting"), "no sting");
  const rec2 = after2.inserts.find((i) => i.cut === sens.cut);
  assert.equal(rec2.sensitive, true);
  const slotRec = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).filter((f) => /^developing-.*\.json$/.test(f) && !f.startsWith("developing-event")).find((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).event.id === "e9")), "utf8")).slot;
  assert.equal(slotRec.noBed, true);
  assert.equal(slotRec.sting, false);
});
