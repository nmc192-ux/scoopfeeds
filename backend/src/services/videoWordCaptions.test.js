import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import {
  chunkWords, captionTimeline, displayWordSet, displayWord, buildWordCaptionTrack,
  wordCaptionsEnabled, CAPTION_TOP_Y, STRIP_H,
} from "./videoWordCaptions.js";
import { buildSlideFilter, assembleSlide } from "./videoAssembler.js";
import { getFFmpegPath } from "./videoGenerator.js";
import { renderTreeToPng } from "./renderCore.js";

// "The pact was signed on Tuesday, at the UN in New York."
const W = (word, start, end) => ({ word, start, end });
const WORDS = [
  W("The", 0.10, 0.22), W("pact", 0.25, 0.55), W("was", 0.58, 0.70), W("signed", 0.72, 1.10),
  W("on", 1.12, 1.20), W("Tuesday,", 1.22, 1.80), W("at", 2.00, 2.08), W("the", 2.10, 2.18),
  W("UN", 2.20, 2.50), W("in", 2.52, 2.60), W("New", 2.62, 2.80), W("York.", 2.82, 3.30),
];

test("chunks hold at most three words and close on punctuation", () => {
  const ch = chunkWords(WORDS).map((c) => c.map((w) => w.word).join(" "));
  assert.deepEqual(ch, ["The pact was", "signed on Tuesday,", "at the UN", "in New York."]);
});

test("a chunk closes once it runs past 14 characters", () => {
  const ch = chunkWords([W("Extraordinary", 0, 1), W("measures", 1, 2), W("here", 2, 3)]);
  assert.deepEqual(ch.map((c) => c.length), [2, 1]);
});

test("the timeline is contiguous from 0 to the slide's end, so the concat stream covers it", () => {
  const { segments } = captionTimeline(WORDS, { slideSecs: 4.0 });
  assert.equal(segments[0].start, 0);
  assert.equal(segments.at(-1).end, 4.0);
  for (let i = 1; i < segments.length; i++) assert.equal(segments[i].start, segments[i - 1].end);
});

test("each word is lit while it is spoken", () => {
  const { chunks, segments } = captionTimeline(WORDS, { slideSecs: 4.0 });
  const at = (t) => segments.find((s) => s.start <= t && t < s.end);
  const lit = (t) => { const s = at(t); return s.gap ? null : chunks[s.chunk][s.active].word; };
  assert.equal(lit(0.40), "pact");
  assert.equal(lit(0.90), "signed");
  assert.equal(lit(1.50), "Tuesday,");
  assert.equal(lit(2.30), "UN");
  assert.equal(lit(3.10), "York.");
  assert.equal(lit(3.95), null, "nothing lingers past the last word + 0.6s");
});

test("a chunk the card already shows in big type is suppressed", () => {
  const onScreen = displayWordSet({ lines: [["AT THE UN"], ["NEW YORK"]] });
  const { chunks, segments } = captionTimeline(WORDS, { slideSecs: 4.0, onScreen });
  const shown = new Set(segments.filter((s) => !s.gap).map((s) => chunks[s.chunk].map((w) => w.word).join(" ")));
  assert.ok(!shown.has("at the UN"));
  assert.ok(shown.has("in New York."), "'in' is not on the card, so the chunk stays");
  assert.ok(shown.has("The pact was"));
});

test("display form drops trailing soft punctuation and upper-cases", () => {
  assert.equal(displayWord("Tuesday,"), "TUESDAY");
  assert.equal(displayWord("York."), "YORK.");
});

test("the flag is off by default and either switch turns it on", () => {
  const saved = { a: process.env.VIDEO_WORD_CAPTIONS_ENABLED, b: process.env.VIDEO_SHOT_ENGINE_ENABLED };
  try {
    delete process.env.VIDEO_WORD_CAPTIONS_ENABLED; delete process.env.VIDEO_SHOT_ENGINE_ENABLED;
    assert.equal(wordCaptionsEnabled(), false);
    process.env.VIDEO_WORD_CAPTIONS_ENABLED = "1";
    assert.equal(wordCaptionsEnabled(), true);
    delete process.env.VIDEO_WORD_CAPTIONS_ENABLED; process.env.VIDEO_SHOT_ENGINE_ENABLED = "1";
    assert.equal(wordCaptionsEnabled(), true);
  } finally {
    for (const [k, v] of [["VIDEO_WORD_CAPTIONS_ENABLED", saved.a], ["VIDEO_SHOT_ENGINE_ENABLED", saved.b]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("with no word caption the slide graph is byte-for-byte unchanged", () => {
  const base = { stateCount: 3, hold: 2, orientation: "vertical" };
  const a = buildSlideFilter(base);
  const b = buildSlideFilter({ ...base, wordCaption: null });
  assert.equal(a.filter, b.filter);
  assert.ok(!a.filter.includes("[wc]"));
});

test("the caption overlay is the LAST stage, carries no time term, and still ends in [out]", () => {
  for (const cutaway of [null, { inputIndex: 3, seconds: 1.5, credit: null, frame: null }]) {
    const { filter } = buildSlideFilter({ stateCount: 2, hold: 2, orientation: "vertical", cutaway, wordCaption: { inputIndex: 9, y: 1190 } });
    const stages = filter.split("; ");
    assert.match(stages.at(-1), /^\[pre\]\[wc\]overlay=0:1190:eof_action=pass/);
    assert.ok(stages.at(-1).endsWith("[out]"));
    assert.equal(filter.match(/\[out\]/g).length, 1);
    assert.ok(!/overlay=[^;]*\bt\b/.test(stages.at(-1)));
  }
});

test("rendered: the spoken word is lime, inside the caption band, at the right moment", async () => {
  const ff = getFFmpegPath();
  if (!ff) return; // no ffmpeg on this machine — reported by the suite as a pass with nothing measured
  const dir = mkdtempSync(path.join(os.tmpdir(), "wc-"));
  const bg = path.join(dir, "bg.png");
  writeFileSync(bg, await renderTreeToPng(
    { type: "div", props: { style: { width: 1080, height: 1920, display: "flex", background: "#303030" } } },
    { width: 1080, height: 1920 },
  ));
  const track = await buildWordCaptionTrack({ words: WORDS, card: {}, slideSecs: 4.0, workDir: dir, slideIndex: 0 });
  assert.ok(track);
  const out = path.join(dir, "slide.mp4");
  await assembleSlide({ statePaths: [bg], hold: 4.0, outputPath: out, orientation: "vertical", wordCaptionTrack: track, ffmpegPath: ff });

  // Sample the caption band at t, and count lime pixels (R,G high; B low).
  const limeAt = (t) => {
    const raw = execFileSync(ff, ["-v", "error", "-ss", String(t), "-i", out, "-frames:v", "1",
      "-vf", `crop=1080:${STRIP_H}:0:${CAPTION_TOP_Y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
    let n = 0;
    for (let i = 0; i < raw.length; i += 3) if (raw[i] > 170 && raw[i + 1] > 170 && raw[i + 2] < 90) n++;
    return n;
  };
  assert.ok(limeAt(0.9) > 500, "a lit word is visible while 'signed' is spoken");
  assert.ok(limeAt(3.95) < 50, "nothing is lit after the narration has ended");
});
