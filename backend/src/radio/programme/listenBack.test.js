// #273: the pre-air listen-back on the mixed audio. Small synthetic WAVs with WavWriter's header; no ffmpeg.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readWavInfo, windowStats, listenBack, LISTEN_RULES, mmss } from "./listenBack.js";
import { airCheck } from "./airCheck.js";
import { placedLines } from "./assemble.js";
import { retimeProgramme, spliceProgramme } from "./repeat.js";
import { applyInsert } from "./developingDesk.js";
import { writeWav, renderProgramme, linesFor, amp, writeHourAudio } from "../../testing/radioWav.js";

const RATE = 44100;
const H = Date.UTC(2026, 9, 27, 16);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "listen-"));
const S = (s) => H + s * 1000;

/** A tiny programme: a spoken slot (with lines) and a music slot, rendered into one 44.1 kHz part. */
function tiny({ fx = null, duckDb = -18, music = { start: 12, end: 20 }, extra = [], noBed = false, linesOverride = null } = {}) {
  const dir = tmp();
  const slots = [
    { id: "the-hour", kind: "spoken", start: S(0), end: S(12), ...(noBed ? { noBed: true } : {}) },
    { id: "music-1", kind: "music", start: S(music.start), end: S(music.end) },
    ...extra,
  ];
  const lines = linesOverride ?? linesFor(slots[0], { secs: 2, gap: 0.9, lead: 1 });
  const from = slots[0].start, to = slots.at(-1).end;
  writeWav(path.join(dir, "part.wav"), renderProgramme({ slots, lines, from, to, duckDb, fx }));
  return { dir, prog: { hourStart: H, slots, lines, audio: [{ file: "part.wav", from }] } };
}

test("readWavInfo parses WavWriter's header and walks extra chunks; windowStats measures levels", () => {
  const d = tmp();
  const f = writeWav(path.join(d, "a.wav"), new Int16Array(RATE * 2).fill(amp(-20)));
  assert.deepEqual(readWavInfo(f), { rate: RATE, channels: 2, bits: 16, dataOffset: 44, dataBytes: RATE * 4 });
  // a LIST chunk before data: the data offset moves, nothing is assumed about 44 bytes
  const raw = fs.readFileSync(f);
  const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([6, 0, 0, 0]), Buffer.from("INFOab")]);
  const g = path.join(d, "b.wav");
  const hdr = Buffer.from(raw.subarray(0, 36)); hdr.writeUInt32LE(raw.length - 8 + list.length, 4);
  fs.writeFileSync(g, Buffer.concat([hdr, list, raw.subarray(36)]));
  assert.equal(readWavInfo(g).dataOffset, 58);
  const st = windowStats(g, { fromSec: 0, toSec: 1, winSec: 0.25 });
  assert.equal(st.windows.length, 4);
  for (const db of st.windows) assert.ok(Math.abs(db - -20) < 0.1, String(db));
  assert.equal(st.clipped, 0);
  assert.ok(Math.abs(st.peakDbfs - -20) < 0.1);
  assert.equal(mmss(-300_000), "-05:00");
  assert.equal(mmss(1_575_000), "26:15");
});

test("a clean spoken slot (voice ~18 dB over the bed, with gaps) passes", () => {
  const { dir, prog } = tiny();
  const r = listenBack(dir, prog);
  assert.deepEqual(r.problems, []);
  assert.equal(r.stats.slots, 2);
  assert.ok(r.stats.speechOverBedDbMin >= 17, String(r.stats.speechOverBedDbMin));
});

test("voice only 4 dB above the bed fails with the slot id", () => {
  const { dir, prog } = tiny({ duckDb: -4 });
  const r = listenBack(dir, prog);
  assert.equal(r.problems.length, 1, r.problems.join("\n"));
  assert.match(r.problems[0], /^listen-back: the-hour: speech only \d+(\.\d)? dB above the bed \(need 10 dB\)/);
});

test("5 s of digital silence inside a music slot fails; silence after an endcard fade passes", () => {
  const silent = tiny({ music: { start: 12, end: 24 }, fx: (t, a) => (t >= S(14) && t < S(19) ? 0 : a) });
  const r = listenBack(silent.dir, silent.prog);
  assert.equal(r.problems.length, 1, r.problems.join("\n"));
  assert.match(r.problems[0], /^listen-back: music-1: 5(\.\d)? s of dead air at 00:14$/);

  const end = tiny({ extra: [{ id: "endcard", kind: "endcard", start: S(20), end: S(32), silentFrom: S(24) }] });
  assert.deepEqual(listenBack(end.dir, end.prog).problems, []);
  // the same silence in the middle of the endcard, not at the end, is dead air
  const mid = tiny({ extra: [{ id: "endcard", kind: "endcard", start: S(20), end: S(32), silentFrom: S(32) }], fx: (t, a, s) => (s.id === "endcard" && t >= S(22) && t < S(28) ? 0 : a) });
  assert.match(listenBack(mid.dir, mid.prog).problems.join(), /endcard: 6(\.\d)? s of dead air at 00:22/);
  // a 3 s pause is not
  const short = tiny({ music: { start: 12, end: 24 }, fx: (t, a) => (t >= S(14) && t < S(17) ? 0 : a) });
  assert.deepEqual(listenBack(short.dir, short.prog).problems, []);
});

test("full-scale samples beyond the limit fail; a peak over -0.1 dBFS fails even with few clipped samples", () => {
  const clip = tiny({ fx: (t, a, s) => (s.id === "music-1" && t >= S(13) && t < S(13.01) ? 32767 : a) });
  const r = listenBack(clip.dir, clip.prog);
  assert.ok(r.problems.some((p) => /^listen-back: music-1: \d+ clipped samples \(at most 100\)$/.test(p)), r.problems.join("\n"));
  assert.ok(r.problems.some((p) => /^listen-back: peak 0 dBFS/.test(p)), r.problems.join("\n"));
  assert.ok(r.stats.clipped > LISTEN_RULES.maxClippedSamples);
  const few = tiny({ fx: (t, a, s) => (s.id === "music-1" && t >= S(13) && t < S(13) + (10 / RATE) * 1000 ? 32767 : a) });
  const f = listenBack(few.dir, few.prog);
  assert.ok(!f.problems.some((p) => /clipped samples/.test(p)), f.problems.join("\n"));
  assert.ok(f.problems.some((p) => /peak/.test(p)), f.problems.join("\n"));
});

test("unmeasured is a failure: truncated file, 24-bit header, missing part, spoken slot without line timings", () => {
  const t = tiny();
  const f = path.join(t.dir, "part.wav");
  fs.truncateSync(f, fs.statSync(f).size - RATE * 4);   // the header still promises the last second
  assert.match(listenBack(t.dir, t.prog).problems.join(), /listen-back: the-hour: audio part\.wav cannot be read: truncated.*\(unmeasured\)/);

  const b24 = tiny();
  writeWav(path.join(b24.dir, "part.wav"), new Int16Array(RATE * 2 * 20), { bits: 24 });
  assert.match(listenBack(b24.dir, b24.prog).problems.join(), /listen-back: the-hour: audio part\.wav cannot be read: 24-bit audio.*\(unmeasured\)/);

  const gone = tiny();
  fs.rmSync(path.join(gone.dir, "part.wav"));
  assert.match(listenBack(gone.dir, gone.prog).problems.join(), /listen-back: the-hour: audio part\.wav is missing \(unmeasured\)/);

  const short = tiny();
  writeWav(path.join(short.dir, "part.wav"), renderProgramme({ slots: short.prog.slots, lines: short.prog.lines, from: S(0), to: S(15) }));
  assert.match(listenBack(short.dir, short.prog).problems.join(), /music-1: audio part\.wav: the part holds 15\.0 s of audio, the programme needs it to 20\.0 s \(unmeasured\)/);

  const noLines = tiny();
  delete noLines.prog.lines;
  assert.match(listenBack(noLines.dir, noLines.prog).problems.join(), /listen-back: programme\.json has no line timings/);
  const otherSlot = tiny();
  otherSlot.prog.lines = otherSlot.prog.lines.map((l) => ({ ...l, slot: "elsewhere" }));
  assert.match(listenBack(otherSlot.dir, otherSlot.prog).problems.join(), /listen-back: the-hour: no voiced lines recorded/);

  const noSlots = tiny();
  assert.match(listenBack(noSlots.dir, { ...noSlots.prog, slots: [] }).problems.join(), /no slot list/);
  const late = tiny();
  assert.match(listenBack(late.dir, { ...late.prog, audio: [{ file: "part.wav", from: S(2) }] }).problems.join(), /the-hour: no audio part covers 00:00 to 00:02/);
});

test("a no-bed slot (sensitive developing story) passes speech-over-bed but still gets the dead-air check", () => {
  const nb = tiny({ noBed: true });
  assert.deepEqual(listenBack(nb.dir, nb.prog).problems, []);
  const long = tiny({ noBed: true, linesOverride: [{ slot: "the-hour", at: S(1), end: S(3) }] });   // 9 s of nothing after one line
  assert.match(listenBack(long.dir, long.prog).problems.join(), /the-hour: 9(\.\d)? s of dead air at 00:03/);
  // a sensitive insert is known from prog.inserts too (its slot is kind "breaking")
  const ins = tiny({ duckDb: -4 });   // what the insert's mix holds does not matter once it is marked sensitive
  const slots = ins.prog.slots.map((s) => (s.id === "the-hour" ? { id: s.id, kind: "breaking", start: s.start, end: s.end } : s));
  assert.deepEqual(listenBack(ins.dir, { ...ins.prog, slots, inserts: [{ id: "the-hour", sensitive: true }] }).problems, []);
  assert.match(listenBack(ins.dir, { ...ins.prog, slots }).problems.join(), /the-hour: speech only/);
});

test("a two-part programme (splice) maps each slot to the right part, from its origin", () => {
  const dir = tmp();
  const slots = [
    { id: "the-hour", kind: "spoken", start: S(0), end: S(10) },
    { id: "music-1", kind: "music", start: S(10), end: S(18) },
    { id: "markets-1", kind: "spoken", start: S(18), end: S(26) },
  ];
  const lines = [...linesFor(slots[0], { secs: 2, lead: 1 }), ...linesFor(slots[2], { secs: 2, lead: 1 })];
  // the original part covers the whole programme, but its The Hour is flat (voice no louder than the bed)
  writeWav(path.join(dir, "part-old.wav"), renderProgramme({ slots, lines, from: S(0), to: S(26), fx: (t, a, s) => (s.id === "the-hour" ? amp(-30) : a) }));
  // the fresh The Hour, spliced over [0, 10); the old part resumes at 10 s, read from its own origin
  writeWav(path.join(dir, "part-new.wav"), renderProgramme({ slots: slots.slice(0, 1), lines, from: S(0), to: S(10) }));
  const prog = { hourStart: H, slots, lines, audio: [{ file: "part-new.wav", from: S(0) }, { file: "part-old.wav", from: S(10), origin: S(0) }] };
  assert.deepEqual(listenBack(dir, prog).problems, []);
  // the old part alone: its flat The Hour fails
  assert.match(listenBack(dir, { ...prog, audio: [{ file: "part-old.wav", from: S(0) }] }).problems.join(), /the-hour: speech only/);
  // the origin ignored (the old part read from its start at 10 s): Markets Now would hear music and fail
  const noOrigin = listenBack(dir, { ...prog, audio: [prog.audio[0], { file: "part-old.wav", from: S(10) }] });
  assert.match(noOrigin.problems.join(), /markets-1: /);
});

test("airCheck runs the listen-back once the parts exist, and reports its stats", () => {
  const dir = tmp();
  const a = writeHourAudio(dir, H);
  fs.writeFileSync(path.join(dir, "programme.json"), JSON.stringify({ hourStart: H, cues: Array(30).fill({}), headlines: [], ...a }));
  const lines = Array.from({ length: 5 }, (_, i) => ({ id: `s${i + 1}`, story: "t1" }));
  fs.writeFileSync(path.join(dir, "segments.raw.json"), JSON.stringify({ "the-hour": { lines } }));
  fs.writeFileSync(path.join(dir, "segments.json"), JSON.stringify({ "the-hour": { lines } }));
  const ok = airCheck(dir, { hourStart: H });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(Object.keys(ok.stats.listenBack).sort(), ["clipped", "longestSilenceSec", "ms", "peakDbfs", "slots", "speechOverBedDbMin"]);
  assert.equal(ok.stats.listenBack.slots, a.slots.length);

  // dead air in the hour's audio is reported on the hour but (1 Nov 2026) does not refuse it...
  writeHourAudio(dir, H, { fx: (t, a0, s) => (s.id === "music-2" && t >= s.start + 10_000 && t < s.start + 20_000 ? 0 : a0) });
  const soft = airCheck(dir, { hourStart: H });
  assert.equal(soft.ok, true);
  assert.match(soft.notes.join(), /listen-back: music-2: 10(\.\d)? s of dead air/);
  // ...unless RADIO_LISTENBACK_BLOCKS=1
  process.env.RADIO_LISTENBACK_BLOCKS = "1";
  try { assert.match(airCheck(dir, { hourStart: H }).problems.join(), /listen-back: music-2: 10(\.\d)? s of dead air/); }
  finally { delete process.env.RADIO_LISTENBACK_BLOCKS; }

  // a part too small for the size check: the listen-back is not run, and says so
  fs.writeFileSync(path.join(dir, a.audio[0].file), Buffer.alloc(10));
  const small = airCheck(dir, { hourStart: H });
  assert.ok(small.problems.includes("listen-back: not run, the audio parts failed the checks above (unmeasured)"), small.problems.join("\n"));
});

test("line timings travel with the audio: placed by assemble, shifted by a repeat, replaced by a splice or an insert", () => {
  assert.deepEqual(placedLines({ "the-hour": [{ id: "open", atSec: 7, endSec: 9.5 }], "music-1": [] }, H), [{ slot: "the-hour", id: "open", at: S(7), end: S(9.5) }]);
  const prog = { hourStart: H, endsAt: S(3630), audio: [{ file: "a.wav", from: S(-900) }], cues: [], slots: [],
    lines: [{ slot: "the-hour", at: S(7), end: S(9) }, { slot: "markets-1", at: S(370), end: S(372) }] };
  assert.deepEqual(retimeProgramme(prog, H + 3_600_000).lines.map((l) => l.at), [S(3607), S(3970)]);
  const sp = spliceProgramme(prog, { cut: S(6), resumeAt: S(360), partFile: "b.wav", cues: [], lines: [{ slot: "the-hour", at: S(8), end: S(10) }, { slot: "x", at: S(400), end: S(401) }] });
  assert.deepEqual(sp.lines.map((l) => [l.slot, l.at]), [["the-hour", S(8)], ["markets-1", S(370)]]);
  // a splice that brings no timings leaves its stretch without any (unmeasured there), never the old audio's
  assert.deepEqual(spliceProgramme(prog, { cut: S(6), resumeAt: S(360), partFile: "b.wav", cues: [] }).lines.map((l) => l.slot), ["markets-1"]);
  assert.equal(spliceProgramme({ ...prog, lines: undefined }, { cut: S(6), resumeAt: S(360), partFile: "b.wav", cues: [] }).lines, undefined);
  const ins = applyInsert({ ...prog, slots: [{ id: "music-1", kind: "music", start: S(840), end: S(1200) }] },
    { id: "developing-x", cut: S(840), end: S(900), resumeAt: S(1200), partFile: "d.wav", cues: [], lines: [{ slot: "developing-x", at: S(843), end: S(850) }] });
  assert.deepEqual(ins.lines.map((l) => l.slot), ["the-hour", "markets-1", "developing-x"]);
});
