// #249: the overnight repeat re-checks the repeated hour's Markets Now at the REPEAT's air time.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildClock } from "./clock.js";
import { prepareRepeat, spliceProgramme, retimeProgramme, cutSlotToMusic, REPEAT_SOURCE_SEGMENTS } from "./repeat.js";
import { recheckRepeatedMarkets } from "./marketsClock.js";
import { airCheck, repeatMarketsProblems } from "./airCheck.js";
import { partAt } from "../playout/playout.js";
import { writeHourAudio, writeWav, renderProgramme, linesFor } from "../../testing/radioWav.js";

const utc = (s) => Date.parse(s);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const PART = "part-countdown.wav";

const rows = (t) => [
  { key: "S&P 500", sym: "^GSPC", group: "US", price: 6800.5, pct: 0.31, time: t },
  { key: "Dow", sym: "^DJI", group: "US", price: 47100.2, pct: 0.42, time: t },
  { key: "Nasdaq", sym: "^IXIC", group: "US", price: 23000.1, pct: -0.25, time: t },
  { key: "Gold", sym: "GC=F", group: "Commodities", price: 4100, pct: -0.6, time: t },
  { key: "Bitcoin", sym: "BTC", group: "Crypto", price: 98450.12, pct: 1.84, time: t },
];

/** A produced hour as produce.mjs leaves it: one part from the countdown, cues per slot, its segments and pack. */
function seedHour(H, { marketsLines, rowsAt, segmentsOverride, noMusic = false }) {
  const dir = tmp("src-hour-");
  let slots = buildClock(H).map(({ id, kind, start, end, title }) => ({ id, kind, start, end, title: title || null }));
  if (noMusic) slots = slots.map((s) => (s.kind === "music" ? { ...s, kind: "series" } : s));
  const cues = [];
  for (const s of slots) {
    if (s.id.startsWith("markets")) cues.push({ at: s.start, scene: "sting", overlay: true, data: {} }, { at: s.start + 2600, scene: "markets", data: { title: s.title, rows: rowsAt } });
    else if (s.kind === "music") cues.push({ at: s.start, scene: "music", data: { credit: "Music: Test Artist – Bed" } });
    else cues.push({ at: s.start, scene: "title", data: { title: s.title } });
  }
  // compared-2 ran short: its music card points at Markets Now; its close shows "Next: Markets Now"
  const m2 = slots.find((s) => s.id === "markets-2");
  cues.push({ at: m2.start - 20e3, scene: "music", data: { next: { title: "Markets Now", at: m2.start } } }, { at: m2.start - 40e3, scene: "title", data: { kicker: "Next", title: "Markets Now", items: [] } });
  cues.sort((a, b) => a.at - b.at);
  // a mixed hour the listen-back passes (#273): one part from the countdown, line timings for every spoken slot
  const { audio, lines } = writeHourAudio(dir, H, { file: PART, slots });
  fs.writeFileSync(path.join(dir, "programme.json"), JSON.stringify({ version: 1, hourStart: H, endsAt: H + 3630e3, audio, lines, cues, slots }));
  const segments = segmentsOverride || {
    "the-hour": { lines: [{ id: "open", text: "It's two." }] },
    "markets-1": { lines: marketsLines },
    "markets-2": { lines: marketsLines },
  };
  fs.writeFileSync(path.join(dir, "segments.json"), JSON.stringify(segments));
  fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify({ builtAt: H - 600e3, top: [], desks: {}, markets: rowsAt, weather: [], marketsCheckedAt: H + 361e3 }));
  return dir;
}

// Friday 23 Oct 2026, 14:00 New York (EDT): every US row is live, a few minutes old.
const FRI_14_ET = utc("2026-10-23T18:00:00Z");
const FRI_LINES = [
  { id: "m1", text: "The Dow is up 0.4 percent, as of 2 PM in New York." },
  { id: "m2", text: "The S&P 500 is up 0.3 percent." },
  { id: "m3", text: "Gold is down 0.6 percent." },
];
// Saturday 24 Oct 2026, 01:00 New York: the repeat.
const SAT_01_ET = utc("2026-10-24T05:00:00Z");

// Monday 26 Oct 2026, 22:00 New York: the US close (16:00) is already in, and the lines say so.
const MON_22_ET = utc("2026-10-27T02:00:00Z");
const MON_CLOSE = utc("2026-10-26T20:00:00Z");
const MON_LINES = [
  { id: "m1", text: "The stock markets are closed at this hour." },
  { id: "m2", text: "On Monday, the Dow closed at 47100, up 0.4 percent." },
  { id: "m3", text: "Gold settled on Monday down 0.6 percent." },
];
// Tuesday 27 Oct 2026, 03:00 New York: the repeat.
const TUE_03_ET = utc("2026-10-27T07:00:00Z");

const slotOf = (prog, id) => prog.slots.find((s) => s.id === id);

test("Friday 14:00 ET hour repeated Saturday 01:00 ET: the stale Markets Now slots are cut to the hour's own music", () => {
  const src = seedHour(FRI_14_ET, { marketsLines: FRI_LINES, rowsAt: rows(FRI_14_ET - 5 * 60e3) });
  // at the source hour itself the lines were fine (the rows were live)
  const atSource = recheckRepeatedMarkets(JSON.parse(fs.readFileSync(path.join(src, "programme.json"), "utf8")).slots,
    JSON.parse(fs.readFileSync(path.join(src, "segments.json"), "utf8")), JSON.parse(fs.readFileSync(path.join(src, "pack.json"), "utf8")));
  assert.deepEqual(atSource.map((v) => v.stale.length), [0, 0]);

  const dst = path.join(tmp("air-"), "2026-10-24T05");
  const p = prepareRepeat(src, dst, SAT_01_ET, { now: 42 });
  assert.equal(p.repeatMarkets.checkedAt, 42);
  assert.deepEqual(p.repeatMarkets.slots.map((s) => [s.id, s.action]), [["markets-1", "cut to music"], ["markets-2", "cut to music"]]);
  assert.match(p.repeatMarkets.slots[0].stale.join("\n"), /m1: markets: Dow is from the last session/);
  assert.equal(p.repeatMarkets.slots[0].stale.length, 3, "every Friday line reads a closed row as now");

  for (const id of ["markets-1", "markets-2"]) {
    const s = slotOf(p, id);
    assert.equal(s.kind, "music"); assert.equal(s.title, null); assert.match(s.cut, /#249/);
    // nothing of the recorded Markets Now is on screen or on air in its window
    assert.deepEqual(p.cues.filter((c) => c.at >= s.start && c.at < s.end).map((c) => c.scene), ["music"]);
    const prog = { ...p, endsAt: SAT_01_ET + 3630e3 };
    for (const t of [s.start, s.start + 30e3, s.end - 1]) {
      const part = partAt(prog, t);
      const pos = t - part.origin;   // where the playout seeks in the part
      const donor = p.slots.find((x) => x.kind === "music" && !x.cut && pos >= x.start - (SAT_01_ET - 900e3) + 4e3 - 1 && pos < x.end - (SAT_01_ET - 900e3));
      assert.ok(donor, `${id} at +${(t - s.start) / 1e3} s plays a music slot of the same hour (pos ${pos / 1e3} s)`);
    }
    // the hour resumes in step at the slot's end
    const after = partAt(prog, s.end);
    assert.deepEqual([after.file, after.origin], [PART, SAT_01_ET - 900e3]);
  }
  // cue pointers to the cut Markets Now move on; the "Next: Markets Now" card is gone
  const m2 = slotOf(p, "markets-2");
  assert.ok(!p.cues.some((c) => c.data?.next?.title === "Markets Now"));
  assert.ok(!p.cues.some((c) => c.data?.kicker === "Next" && c.data?.title === "Markets Now"));
  assert.equal(p.cues.find((c) => c.at === m2.start - 20e3).data.next.title, "ScoopFeeds Radio", "the next titled slot after markets-2 is the sign-off");
  assert.equal(p.cues.find((c) => c.at === m2.start && c.scene === "music").data.credit, "Music: Test Artist – Bed", "the cut carries the bed's credit");

  // the splice run (--from the-hour --to markets-1) keeps the cut: at markets-1 the music, not the old Markets Now
  const spliced = spliceProgramme(p, { cut: slotOf(p, "the-hour").start, resumeAt: slotOf(p, "markets-1").start, partFile: "part-the-hour-new.wav", cues: [] });
  const m1 = slotOf(spliced, "markets-1");
  assert.deepEqual(spliced.audio.filter((a) => a.from >= m1.start && a.from < m1.end), p.audio.filter((a) => a.from >= m1.start && a.from < m1.end));
  assert.equal(partAt({ ...spliced, endsAt: SAT_01_ET + 3630e3 }, m1.start - 1).file, "part-the-hour-new.wav");

  // the repeated hour's own lines are kept for airCheck, and the re-check finds nothing left on air
  assert.ok(fs.existsSync(path.join(dst, REPEAT_SOURCE_SEGMENTS)));
  const r = repeatMarketsProblems(p, { "the-hour": {} }, () => { throw new Error("no Markets slot is left on air, nothing to load"); });
  assert.deepEqual(r, { problems: [], stats: { checked: 0, cut: 2, measured: true } });
});

test("Monday 22:00 ET hour repeated Tuesday 03:00 ET: close wording already, the hour is unchanged", () => {
  const src = seedHour(MON_22_ET, { marketsLines: MON_LINES, rowsAt: rows(MON_CLOSE) });
  const dst = path.join(tmp("air-"), "2026-10-27T07");
  const p = prepareRepeat(src, dst, TUE_03_ET, { now: 1 });
  assert.deepEqual(p.repeatMarkets.slots.map((s) => [s.id, s.action, s.stale.length]), [["markets-1", "kept", 0], ["markets-2", "kept", 0]]);
  const plain = retimeProgramme(JSON.parse(fs.readFileSync(path.join(src, "programme.json"), "utf8")), TUE_03_ET);
  assert.deepEqual(p.audio, plain.audio);
  assert.deepEqual(p.cues, plain.cues);
  assert.deepEqual(p.slots, plain.slots);
  // airCheck's second lock re-reads the kept slots and finds them fine
  const r = repeatMarketsProblems(p, { "the-hour": {} }, () => ({ segments: JSON.parse(fs.readFileSync(path.join(dst, REPEAT_SOURCE_SEGMENTS), "utf8")), pack: JSON.parse(fs.readFileSync(path.join(dst, "repeat-source-pack.json"), "utf8")) }));
  assert.deepEqual(r, { problems: [], stats: { checked: 2, cut: 0, measured: true } });
});

test("a repeated Markets slot whose lines were overwritten (a :30 refresh) is unmeasured, so it is cut", () => {
  const src = seedHour(MON_22_ET, { rowsAt: rows(MON_CLOSE), segmentsOverride: { "markets-2": { lines: MON_LINES } } });
  const p = prepareRepeat(src, path.join(tmp("air-"), "x"), TUE_03_ET, { now: 1 });
  assert.deepEqual(p.repeatMarkets.slots.map((s) => [s.id, s.action]), [["markets-1", "cut to music"], ["markets-2", "kept"]]);
  assert.match(slotOf(p, "markets-1").cut, /unmeasured: .*markets-1 lines are not in its segments\.json/);
});

test("no music to cut to: the slot stays, and airCheck refuses the repeat", () => {
  const src = seedHour(FRI_14_ET, { marketsLines: FRI_LINES, rowsAt: rows(FRI_14_ET - 5 * 60e3), noMusic: true });
  const dst = path.join(tmp("air-"), "y");
  const p = prepareRepeat(src, dst, SAT_01_ET, { now: 1 });
  assert.match(p.repeatMarkets.slots[0].action, /^not cut \(the hour has no music slot to cut to\)/);
  assert.equal(cutSlotToMusic(p, "markets-1").ok, false);
  const check = airCheck(fresh(dst, SAT_01_ET), { hourStart: SAT_01_ET });
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((x) => /^repeat markets-1\/m1: markets: Dow is from the last session/.test(x)), check.problems.join("\n"));
  assert.deepEqual(check.stats.repeatMarkets, { checked: 2, cut: 0, measured: true });
});

/** What the splice run leaves: a fresh The Hour in segments*.json, a fresh pack, the fresh part. */
function fresh(dir, H) {
  const lines = Array.from({ length: 5 }, (_, i) => ({ id: `s${i + 1}`, story: "t1", text: "x" }));
  fs.writeFileSync(path.join(dir, "segments.raw.json"), JSON.stringify({ "the-hour": { lines } }));
  fs.writeFileSync(path.join(dir, "segments.json"), JSON.stringify({ "the-hour": { lines } }));
  fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify({ markets: rows(H), marketsCheckedAt: H }));
  const pf = path.join(dir, "programme.json");
  const p = JSON.parse(fs.readFileSync(pf, "utf8"));
  // the fresh The Hour's own audio and line timings (#273)
  const hour = p.slots.find((s) => s.id === "the-hour");
  const fl = linesFor(hour);
  writeWav(path.join(dir, "part-the-hour-new.wav"), renderProgramme({ slots: [hour], lines: fl, from: H + 6e3, to: H + 360e3, rate: 1000 }), { rate: 1000 });   // 1000 Hz: over minPartBytes
  fs.writeFileSync(pf, JSON.stringify(spliceProgramme(p, { cut: H + 6e3, resumeAt: H + 360e3, partFile: "part-the-hour-new.wav", cues: [], lines: fl })));
  return dir;
}

test("airCheck on repeats: the cut hour passes; no re-check record, or no source lines, is a failure", () => {
  const src = seedHour(FRI_14_ET, { marketsLines: FRI_LINES, rowsAt: rows(FRI_14_ET - 5 * 60e3) });
  const dst = path.join(tmp("air-"), "z");
  prepareRepeat(src, dst, SAT_01_ET, { now: 1 });
  const ok = airCheck(fresh(dst, SAT_01_ET), { hourStart: SAT_01_ET });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.stats.repeatMarkets, { checked: 0, cut: 2, measured: true });

  // a repeat that bypassed the re-check (the pre-#249 path): the stale Friday lines are caught, and it is unmeasured
  const raw = path.join(tmp("air-"), "w");
  prepareRepeat(src, raw, SAT_01_ET, { now: 1 });
  const pf = path.join(raw, "programme.json");
  fs.writeFileSync(pf, JSON.stringify(retimeProgramme(JSON.parse(fs.readFileSync(path.join(src, "programme.json"), "utf8")), SAT_01_ET)));
  const unmeasured = airCheck(fresh(raw, SAT_01_ET), { hourStart: SAT_01_ET });
  assert.ok(unmeasured.problems.some((x) => /never re-checked at the repeat's air time \(unmeasured\)/.test(x)), unmeasured.problems.join("\n"));

  // the record claims "kept" but the source lines are gone: unmeasured, not a pass
  const p = JSON.parse(fs.readFileSync(pf, "utf8"));
  fs.writeFileSync(pf, JSON.stringify({ ...p, repeatMarkets: { checkedAt: 1, slots: [] } }));
  fs.rmSync(path.join(raw, REPEAT_SOURCE_SEGMENTS));
  const gone = airCheck(raw, { hourStart: SAT_01_ET });
  assert.ok(gone.problems.includes(`${REPEAT_SOURCE_SEGMENTS} missing`), gone.problems.join("\n"));
  assert.ok(gone.problems.some((x) => /^repeat markets-1: .*not in its segments\.json \(unmeasured\)/.test(x)), gone.problems.join("\n"));

  // with the source lines back, the stale Friday lines themselves fail the hour
  fs.writeFileSync(path.join(raw, REPEAT_SOURCE_SEGMENTS), fs.readFileSync(path.join(src, "segments.json")));
  const stale = airCheck(raw, { hourStart: SAT_01_ET });
  assert.ok(stale.problems.some((x) => /^repeat markets-2\/m2: markets: S&P 500 is from the last session/.test(x)), stale.problems.join("\n"));
});
