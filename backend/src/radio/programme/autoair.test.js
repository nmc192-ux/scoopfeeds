import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { airCheck } from "./airCheck.js";
import { STATION_ID_LINE } from "../safety/disclosure.js";
import { nextHour, newestVideo } from "./autoair.mjs";
import { parseCnbc } from "./factPack.js";

const H = Date.UTC(2026, 9, 14, 16);
function produced({ hourStart = H, kept = 10, written = 12, hourStories = 5, partBytes = 2_000_000, stationId = true } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "air-"));
  fs.writeFileSync(path.join(d, "part-the-hour.wav"), Buffer.alloc(partBytes));
  fs.writeFileSync(path.join(d, "programme.json"), JSON.stringify({ hourStart, cues: Array(30).fill({}), audio: [{ file: "part-the-hour.wav", from: H }], headlines: [] }));
  const lines = (n, story) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, story }));
  fs.writeFileSync(path.join(d, "segments.raw.json"), JSON.stringify({ "the-hour": { lines: lines(written, "t1") } }));
  const sid = stationId ? [{ id: "station-id", story: null, text: STATION_ID_LINE, mechanical: true }] : [];
  fs.writeFileSync(path.join(d, "segments.json"), JSON.stringify({ "the-hour": { lines: sid.concat(lines(Math.min(kept, hourStories), "t1"), lines(Math.max(0, kept - hourStories), null)) } }));
  return d;
}

test("air check: a good hour passes", () => {
  const r = airCheck(produced(), { hourStart: H });
  assert.equal(r.ok, true, r.problems.join("; "));
});
test("air check: wrong hour, short audio, heavy fact-check losses and a thin Hour all fail", () => {
  assert.match(airCheck(produced({ hourStart: H - 3600_000 }), { hourStart: H }).problems.join(), /not 2026/);
  assert.match(airCheck(produced({ partBytes: 10 }), { hourStart: H }).problems.join(), /only 10 bytes/);
  assert.match(airCheck(produced({ kept: 5, written: 12 }), { hourStart: H }).problems.join(), /passed the fact checks/);
  assert.match(airCheck(produced({ hourStories: 2 }), { hourStart: H }).problems.join(), /only 2 checked stories/);
});
test("air check (#208): an hour without the spoken station-ID disclosure does not air; the mechanical line is not counted as kept", () => {
  assert.match(airCheck(produced({ stationId: false }), { hourStart: H }).problems.join(), /station-ID disclosure/);
  // 9 written lines kept of 12 = 75 %: the station-ID line must not lift it, nor 7 of 12 (58 %) over the 60 % bar
  assert.match(airCheck(produced({ kept: 7, written: 12 }), { hourStart: H }).problems.join(), /passed the fact checks/);
  assert.equal(airCheck(produced({ kept: 7, written: 12 }), { hourStart: H }).stats.linesKept, 7);
});
test("air check: an empty directory is a failure, not a pass", () => {
  const r = airCheck(fs.mkdtempSync(path.join(os.tmpdir(), "air-")), { hourStart: H });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /programme.json missing/.test(p)));
});

test("next hour: a run at 8:14 pm is for 9 pm; at 8:40 pm, for 10 pm", () => {
  assert.equal(nextHour(Date.UTC(2026, 9, 14, 15, 14)), H);
  assert.equal(nextHour(Date.UTC(2026, 9, 14, 15, 40)), H + 3600_000);
  assert.equal(nextHour(Date.UTC(2026, 9, 14, 15, 35)), H);
});
test("newest video in a folder", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vid-"));
  fs.writeFileSync(path.join(d, "a.mp4"), "a"); fs.writeFileSync(path.join(d, "notes.txt"), "x");
  fs.writeFileSync(path.join(d, "b.mp4"), "b"); fs.utimesSync(path.join(d, "a.mp4"), new Date(1e12), new Date(1e12));
  assert.equal(path.basename(newestVideo(d)), "b.mp4");
  assert.equal(newestVideo(path.join(d, "none")), null);
});

test("CNBC quotes: prices, percent, UNCH as zero, unknown symbols ignored", () => {
  const q = parseCnbc({ FormattedQuoteResult: { FormattedQuote: [
    { symbol: ".SPX", last: "7,805.45", change_pct: "-0.02%", last_time: "2026-10-13" },
    { symbol: ".GDAXI", last: "25,259.90", change_pct: "UNCH" },
    { symbol: "@LCO.1", last: "106.28", change_pct: "+0.56%" },
    { symbol: ".NOPE", last: "1" }] } });
  assert.deepEqual([q["^GSPC"].price, q["^GSPC"].pct], [7805.45, -0.02]);
  assert.equal(q["^GDAXI"].pct, 0);
  assert.equal(q["BZ=F"].pct, 0.56);
  assert.equal(Object.keys(q).length, 3);
});
