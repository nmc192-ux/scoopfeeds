// #284: two presenters (RADIO_DUO). Casting is pure; the fixture hour is mixed with the fake voice and listened back.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { duoOn, loadPresenters, castLines, castSegments, DEFAULT_VOICE_A, DEFAULT_VOICE_B, HANDOVER_ID, DUO_WRITER_NOTE } from "./presenters.js";
import { assemble, fakeVoice, layoutSlot, placedLines } from "./assemble.js";
import { buildPrompt } from "./writer.js";
import { buildClock } from "./clock.js";
import { listenBack } from "./listenBack.js";
import { cacheKeyFor } from "../../services/videoVoice.js";

const CAST = { A: { key: "A", name: "Daniel", voice: "bm_george" }, B: { key: "B", name: "Leah", voice: "bf_emma" } };
const HOUR = [
  { id: "open", text: "It's noon in New York. This is ScoopFeeds Radio, the news, compared." },
  { id: "s1", story: "t1", text: "Story one." },
  { id: "s2", story: "t2", text: "Story two." },
  { id: "s3", story: "t3", text: "Story three." },
  { id: "s4", story: "t4", text: "Story four." },
  { id: "close", text: "Markets Now, after this." },
];

test("RADIO_DUO is on only when literally 1; off means no cast at all", () => {
  for (const v of [undefined, "", "0", "true", "yes", " 2"]) assert.equal(duoOn({ RADIO_DUO: v }), false, String(v));
  assert.equal(duoOn({ RADIO_DUO: "1" }), true);
  assert.equal(loadPresenters({}), null);
  assert.equal(loadPresenters({ RADIO_DUO: "0", RADIO_VOICE_A: "x", RADIO_VOICE_B: "x" }), null);
});

test("the cast: names from presenters.json, voices from RADIO_VOICE_A/B with male and female defaults; one voice twice is refused", () => {
  const c = loadPresenters({ RADIO_DUO: "1" });
  assert.equal(c.A.voice, DEFAULT_VOICE_A); assert.equal(c.B.voice, DEFAULT_VOICE_B);
  assert.match(DEFAULT_VOICE_A, /^[ab]m_/); assert.match(DEFAULT_VOICE_B, /^[ab]f_/);
  assert.ok(c.A.name && c.B.name && c.A.name !== c.B.name);
  assert.equal(loadPresenters({ RADIO_DUO: "1", RADIO_VOICE_A: "am_michael", RADIO_VOICE_B: "af_heart" }).B.voice, "af_heart");
  assert.throws(() => loadPresenters({ RADIO_DUO: "1", RADIO_VOICE_A: "bf_emma", RADIO_VOICE_B: "bf_emma" }), /same voice/);
});

test("castLines: the lead opens, stories alternate, one handover read by the lead, the close is the lead's", () => {
  const out = castLines(HOUR, CAST);
  assert.deepEqual(out.map((l) => `${l.id}:${l.speaker}`), ["open:A", "s1:A", `${HANDOVER_ID}:A`, "s2:B", "s3:A", "s4:B", "close:A"]);
  assert.equal(out.filter((l) => l.id === HANDOVER_ID).length, 1);
  assert.equal(out.find((l) => l.id === HANDOVER_ID).text, "Over to you, Leah.");
  assert.ok(out.every((l) => l.voice === CAST[l.speaker].voice && l.presenter === CAST[l.speaker].name));
  assert.equal(HOUR[0].speaker, undefined, "the input is not changed");
  // two lines of one story stay with one presenter
  assert.deepEqual(castLines([{ id: "d1", story: "x", text: "a" }, { id: "d1b", story: "x", text: "b" }, { id: "d2", story: "y", text: "c" }], CAST).map((l) => l.speaker), ["A", "A", "A", "B"]);
});

test("castLines: story-less segments stay with the lead; Compared alternates by outlet; the sign-off names both", () => {
  assert.deepEqual(castLines([{ id: "m1", story: null, text: "a" }, { id: "m2", story: null, text: "b" }], CAST).map((l) => l.speaker), ["A", "A"]);
  const cmp = castLines([{ id: "intro", text: "i" }, { id: "o1", outlet: "Reuters", text: "r" }, { id: "o2", outlet: "BBC News", text: "b" }, { id: "agree", text: "g" }, { id: "close", text: "c" }], CAST);
  assert.deepEqual(cmp.map((l) => `${l.id}:${l.speaker}`), ["intro:A", "o1:A", "handover:A", "o2:B", "agree:A", "close:A"]);
  const so = castLines([{ id: "s1", text: "That was ScoopFeeds Radio." }], CAST, { segment: "signoff" });
  assert.deepEqual(so.map((l) => [l.speaker, l.text]), [["A", "That was ScoopFeeds Radio."], ["A", "I'm Daniel."], ["B", "And I'm Leah."]]);
  assert.deepEqual(castLines([], CAST, { segment: "signoff" }), []);
});

test("castSegments with the flag off returns the checked segments untouched", () => {
  const segs = { "the-hour": { lines: HOUR } };
  assert.equal(castSegments(segs, [{ id: "the-hour", segment: "the-hour" }], null), segs);
});

test("the writer's prompt is unchanged with the flag off and carries the duo note with it on", () => {
  const pack = { top: [], desks: {}, markets: [], weather: [] };
  const slots = [{ id: "signoff", segment: "signoff", title: "Sign-off", lenSec: 20 }];
  const when = { hourLabel: "noon in New York", cityTimes: "nine in the evening in Karachi", marketsAsOf: {} };
  assert.ok(!buildPrompt(pack, slots, when).includes(DUO_WRITER_NOTE));
  assert.ok(buildPrompt(pack, slots, { ...when, duo: true }).includes(DUO_WRITER_NOTE));
});

test("layout: a handover whose second presenter's story was cut for time is cut too", () => {
  const slot = { startSec: 0, endSec: 14, lenSec: 14 };
  const lines = castLines(HOUR, CAST).map((l) => ({ ...l, secs: l.id === "s1" ? 6 : 2 }));
  assert.deepEqual(layoutSlot(slot, lines).placed.map((l) => l.id), ["open", "s1", "close"]);
  // with room for the second story, the handover stays in front of it
  assert.deepEqual(layoutSlot({ startSec: 0, endSec: 20, lenSec: 20 }, lines).placed.map((l) => l.id), ["open", "s1", HANDOVER_ID, "s2", "close"]);
  // an uncast hour lays out exactly as before
  const plain = HOUR.map((l) => ({ ...l, secs: 2 }));
  assert.deepEqual(layoutSlot(slot, plain).placed.map((l) => l.id), layoutSlot(slot, plain.map((l) => ({ ...l }))).placed.map((l) => l.id));
});

test("Kokoro cache key: no voice override = the env voice's key, byte for byte; another voice = another key", () => {
  const prev = process.env.VIDEO_TTS_KOKORO_VOICE;
  process.env.VIDEO_TTS_KOKORO_VOICE = "bm_george";
  try {
    const k = cacheKeyFor("Story one.", "kokoro");
    assert.equal(cacheKeyFor("Story one.", "kokoro", {}), k);
    assert.equal(cacheKeyFor("Story one.", "kokoro", { voice: "bm_george" }), k);
    assert.notEqual(cacheKeyFor("Story one.", "kokoro", { voice: "bf_emma" }), k);
    assert.equal(cacheKeyFor("Story one.", "elevenlabs", { voice: "bf_emma" }), cacheKeyFor("Story one.", "elevenlabs"));
  } finally { if (prev === undefined) delete process.env.VIDEO_TTS_KOKORO_VOICE; else process.env.VIDEO_TTS_KOKORO_VOICE = prev; }
});

// ── the fixture hour: The Hour, mixed with the fake voice, flag off and on ──
const H = Date.UTC(2026, 10, 3, 17);
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duo-"));
  const bed = path.join(dir, "bed.wav");
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=30", "-ac", "2", "-ar", "44100", bed]);
  const slot = buildClock(H).find((s) => s.id === "the-hour");
  const top = [1, 2, 3, 4, 5].map((n) => ({ id: `t${n}`, headline: `Headline ${n}`, count: 1, outlets: [{ source: "Reuters", title: `Headline ${n}`, description: "" }] }));
  const pack = { top, desks: {}, markets: [], weather: [], builtAt: H };
  const words = (n) => Array.from({ length: 40 }, (_, i) => `word${n}${i}`).join(" ") + ".";
  const lines = [{ id: "open", text: "It's noon in New York. This is ScoopFeeds Radio." }, ...top.map((t, i) => ({ id: `s${i + 1}`, story: t.id, text: words(i) })), { id: "close", text: "Markets Now, after this." }];
  return { dir, bed, slot, pack, segments: { "the-hour": { lines } } };
}
async function mix(f, segments, tag) {
  const calls = [];
  const fake = fakeVoice(path.join(f.dir, `v-${tag}`));
  const voice = async (...args) => { calls.push(args); return fake(...args); };
  const outWav = path.join(f.dir, `part-${tag}.wav`);
  const r = await assemble({ slots: [f.slot], segments, pack: f.pack, hourStart: H, bedFor: () => ({ file: f.bed, lufs: -16, len: 30 }), voice, outWav });
  return { ...r, calls, file: path.basename(outWav) };
}

test("flag off: every line is voiced with the one voice (no voice argument), no name tags, as today", async () => {
  const f = fixture();
  const segs = castSegments(f.segments, [f.slot], loadPresenters({}));
  assert.equal(segs, f.segments);
  const r = await mix(f, segs, "off");
  assert.ok(r.calls.length === 7 && r.calls.every((a) => a.length === 1), JSON.stringify(r.calls.map((a) => a.length)));
  assert.ok(r.lines.every((l) => !("presenter" in l)));
  assert.deepEqual(r.lines.map((l) => l.id), ["open", "s1", "s2", "s3", "s4", "s5", "close"]);
});

test("flag on: the fixture hour alternates voices by story, carries name tags, and passes the listen-back", async () => {
  const f = fixture();
  const cast = loadPresenters({ RADIO_DUO: "1" });
  const segs = castSegments(f.segments, [f.slot], cast);
  const r = await mix(f, segs, "on");
  const voices = r.calls.map((a) => a[1]?.voice);
  assert.deepEqual(voices, [cast.A, cast.A, cast.A, cast.B, cast.A, cast.B, cast.A, cast.A].map((p) => p.voice));   // open s1 handover s2 s3 s4 s5 close
  assert.deepEqual(r.lines.map((l) => `${l.id}:${l.presenter}`), ["open", "s1", "handover", "s2", "s3", "s4", "s5", "close"].map((id, i) => `${id}:${[cast.A, cast.A, cast.A, cast.B, cast.A, cast.B, cast.A, cast.A][i].name}`));
  const prog = { hourStart: H, slots: [{ id: f.slot.id, kind: f.slot.kind, start: f.slot.start, end: f.slot.end }], lines: r.lines, audio: [{ file: r.file, from: f.slot.start }] };
  const lb = listenBack(f.dir, prog);
  assert.deepEqual(lb.problems, []);
  assert.equal(lb.stats.slots, 1);
  assert.deepEqual(placedLines({ x: [{ id: "a", atSec: 1, endSec: 2, presenter: "Leah" }] }, H), [{ slot: "x", id: "a", at: H + 1000, end: H + 2000, presenter: "Leah" }]);
});
