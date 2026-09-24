import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildTimeline, anchorTime, placeShots, subCut, firstNumber, buildPlan, MAX_SHOT_SECS } from "./shotVideo.js";
import { shotMetrics, savePlan, loadPlan, hasFreshPlan, PLAN_TTL_MS } from "./shotProduce.js";
import { slideTotalSecs } from "../videoAssembler.js";

// Two slides; word timings as ElevenLabs returns them (per clip, from 0).
const W = (word, start, end) => ({ word, start, end });
const slides = [
  { t: "title", lines: [["SIGNED.", "white"], ["NOT SOLD.", "lime"]], caption: "The pact was signed at the UN on Tuesday.", eyebrow: "GREENLAND" },
  { t: "stat", value: 3, unit: "sites", lines: ["named"], source: "Al Jazeera", caption: "It lets America open three sites, not one.", eyebrow: "WHAT IT ALLOWS" },
];
const audio = [
  { durationSecs: 3.0, path: "a0.mp3", words: [W("The", 0.1, 0.2), W("pact", 0.25, 0.5), W("was", 0.55, 0.7), W("signed", 0.75, 1.1), W("at", 1.15, 1.25), W("the", 1.3, 1.4), W("UN", 1.45, 1.8), W("on", 1.85, 1.95), W("Tuesday.", 2.0, 2.6)] },
  { durationSecs: 2.8, path: "a1.mp3", words: [W("It", 0.1, 0.2), W("lets", 0.25, 0.45), W("America", 0.5, 0.95), W("open", 1.0, 1.25), W("three", 1.3, 1.6), W("sites,", 1.65, 2.0), W("not", 2.1, 2.25), W("one.", 2.3, 2.6)] },
];

test("the timeline accumulates slide lengths exactly as the slide path and the bed do", () => {
  const tl = buildTimeline(slides, audio);
  assert.equal(tl.starts[0], 0);
  assert.equal(tl.starts[1], slideTotalSecs(3.0));
  assert.equal(tl.words.length, 17);
  assert.equal(tl.words[9].w, "It");
  assert.ok(Math.abs(tl.words[9].s - (slideTotalSecs(3.0) + 0.1)) < 1e-6);
  assert.equal(tl.narrationSecs, slideTotalSecs(3.0) + slideTotalSecs(2.8));
});

test("a shot starts on its anchor word; the first shot of a slide starts with the slide", () => {
  const tl = buildTimeline(slides, audio);
  assert.equal(anchorTime(0, slides[0].caption, "at the UN", tl, audio), 1.15);
  assert.ok(Math.abs(anchorTime(1, slides[1].caption, "three sites,", tl, audio) - (tl.starts[1] + 1.3)) < 1e-6);
  assert.equal(anchorTime(0, slides[0].caption, "not in the caption", tl, audio), null);
  const placed = placeShots(slides, [
    { slide: 0, shot: 0, anchor: "The pact", kind: "clip", subject: "UN hall", record: null },
    { slide: 0, shot: 1, anchor: "at the UN", kind: "clip", subject: "UN hall", record: null },
    { slide: 1, shot: 0, anchor: "It lets", kind: "count", subject: "sites", record: null },
  ], tl, audio);
  assert.deepEqual(placed.map((p) => p.t0), [0, 1.15, tl.starts[1]]);
  assert.ok(Math.abs(placed[0].T - 1.15) < 1e-6, "a shot runs until the next one starts");
  assert.ok(Math.abs(placed.at(-1).t0 + placed.at(-1).T - tl.narrationSecs) < 1e-6, "the last shot runs to the end of the narration");
});

test("sub-cut: real pictures over 3 s become views of the same subject; maps and type cards are held", () => {
  const pic = { kind: "photo", t0: 10, T: 7.2, record: { kind: "photo" } };
  const cut = subCut(pic);
  assert.equal(cut.length, 3);
  assert.ok(cut.every((c) => c.T <= MAX_SHOT_SECS));
  assert.deepEqual(cut.map((c) => c.view), [0, 1, 2]);
  assert.equal(subCut({ kind: "punch", t0: 0, T: 5, record: null }).length, 1);
  assert.equal(subCut({ kind: "map", t0: 0, T: 6, record: { kind: "map" } }).length, 1);
  assert.equal(subCut({ kind: "photo", t0: 0, T: 6, record: { kind: "satellite" } }).length, 1, "a photo shot answered by satellite is one camera move");
  assert.equal(subCut({ kind: "clip", t0: 0, T: 3.1, record: { kind: "clip" } }).length, 1);
});

test("the first spoken number, from digits or words", () => {
  assert.deepEqual(firstNumber("seventy percent of faults"), { value: 70, scale: 1, pct: true, scaleWord: "" });
  assert.equal(firstNumber("at least 1.3 million dollars").value, 1.3);
  assert.equal(firstNumber("at least 1.3 million dollars").scaleWord, "million");
  assert.equal(firstNumber("twenty-six women").value, 26);
  assert.equal(firstNumber("no numbers here"), null);
});

test("buildPlan: a stat card counts up its value; a picture shot with no asset becomes a counted fallback", () => {
  const tl = buildTimeline(slides, audio);
  const segments = [
    { slide: 0, shot: 0, view: 0, t0: 0, T: 3.3, kind: "clip", subject: "UN General Assembly hall", record: { kind: "clip", media_url: "u1", credit: "Video: X, CC BY 4.0", in_points: [{ t: 5 }] } },
    { slide: 1, shot: 0, view: 0, t0: tl.starts[1], T: 3.1, kind: "count", subject: "US sites", record: null },
  ];
  const local = new Map([["u1", null]]);
  const { shots, fallbacks } = buildPlan({ segments, slides, timeline: tl, local, article: { title: "t" }, attribution: { publisher: "DW" }, firstPicture: null });
  assert.equal(shots[0].kind, "graphic");
  assert.match(fallbacks[0], /asset fetch failed/);
  assert.equal(shots[1].kind, "count");
  assert.equal(shots[1].value, 3);
  assert.equal(shots[1].src, "Al Jazeera");
  assert.equal(shots[1].kick, "WHAT IT ALLOWS");
});

test("metrics: average shot length and real/video shares are measured on screen time, end card excluded", () => {
  const m = shotMetrics([
    { kind: "clip", T: 2.5 }, { kind: "photo", T: 2.5 }, { kind: "punch", T: 2 }, { kind: "headline", T: 3 }, { kind: "end", T: 2.6 },
  ], []);
  assert.equal(m.shots, 4);
  assert.equal(m.avgShotSecs, 2.5);
  assert.equal(m.realShare, 0.8);
  assert.equal(m.videoShare, 0.25);
  assert.equal(m.punchCards, 1);
});

test("the plan store: saved, loaded while fresh, expired after its TTL", () => {
  const saved = process.env.SCOOP_PERSISTENT_DATA_DIR;
  process.env.SCOOP_PERSISTENT_DATA_DIR = mkdtempSync(join(tmpdir(), "plans-"));
  try {
    assert.equal(hasFreshPlan(), false);
    savePlan("a-1", { spec: { slides: [] }, resolved: [{ slide: 0 }], attribution: {} }, { now: 1000 });
    assert.equal(loadPlan("a-1", { now: 2000 }).resolved.length, 1);
    assert.equal(loadPlan("a-1", { now: 1000 + PLAN_TTL_MS + 1 }), null);
    assert.equal(loadPlan("a-1", { now: 2000 }), null, "an expired plan is deleted on read");
  } finally {
    if (saved === undefined) delete process.env.SCOOP_PERSISTENT_DATA_DIR; else process.env.SCOOP_PERSISTENT_DATA_DIR = saved;
  }
});
