// captionBurn.test.mjs — the shot-level caption layer.
//
// Run: node --test backend/src/services/longform/engine/captionBurn.test.mjs
//
// The rule under test is the one that matters most: a take with no word
// timings gets NO captions and says so. Evenly spreading words across a beat's
// duration would look right in a screenshot and drift against the voice, which
// is undetectable in review and therefore worse than nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { captionLayer, wordsFileFor, CAPTION_BOX } from "./captionBurn.mjs";

const TMP = mkdtempSync(path.join(os.tmpdir(), "capburn-"));
const WORDS = path.join(TMP, "capwords");
mkdirSync(WORDS, { recursive: true });

const take = (name, words) => {
  const mp3 = path.join(TMP, `${name}.mp3`);
  writeFileSync(mp3, "");
  if (words) writeFileSync(path.join(TMP, `${name}.words.json`), JSON.stringify(words));
  return mp3;
};
const say = (text, step = 0.35) => text.split(" ").map((word, i) => ({
  word, start: +(0.2 + i * step).toFixed(3), end: +(0.2 + i * step + 0.3).toFixed(3),
}));
const shotOf = (audio, o = {}) => ({
  beat: 1, text: "line", audio, audioStart: 0, audioLead: 0, seconds: 6, ...o,
});

test("no words file means no captions, and the reason is reported", async () => {
  const r = await captionLayer({ shot: shotOf(take("nowords", null)), nextInput: 1, wordsDir: WORDS });
  assert.equal(r.words, 0);
  assert.equal(r.filter, "", "no filter may be emitted when there are no timings");
  assert.match(r.skipped, /no \.words\.json/,
    "a silent skip is the failure mode this exists to prevent");
});

test("a take with timings produces one overlay per word", async () => {
  const r = await captionLayer({
    shot: shotOf(take("ok", say("xylitol does not hang around"))), nextInput: 1, wordsDir: WORDS,
  });
  assert.equal(r.skipped, null);
  assert.equal(r.words, 5, "every spoken word in the shot should be placed");
  assert.equal(r.args.filter((a) => a === "-i").length, 5, "one PNG input per placed word");
  assert.equal((r.filter.match(/overlay=/g) || []).length, 5);
});

test("the chain starts at the given input index and ends on the returned label", async () => {
  const r = await captionLayer({
    shot: shotOf(take("idx", say("one two three"))), nextInput: 4, wordsDir: WORDS, inLabel: "v",
  });
  assert.match(r.filter, /^\[v\]\[4:v\]overlay/,
    "the first word must take the input index the caller reserved — an off-by-one "
    + "here silently overlays the wrong stream");
  assert.ok(r.filter.trim().endsWith(`[${r.label}]`));
});

test("a corrupt words file is skipped with its reason, not thrown", async () => {
  const mp3 = path.join(TMP, "bad.mp3");
  writeFileSync(mp3, "");
  writeFileSync(path.join(TMP, "bad.words.json"), "{not json");
  const r = await captionLayer({ shot: shotOf(mp3), nextInput: 1, wordsDir: WORDS });
  assert.equal(r.words, 0);
  assert.match(r.skipped, /unreadable words file/);
});

test("a shot with no narration is not a skip — it is simply captionless", async () => {
  const r = await captionLayer({
    shot: { beat: "title", text: null, audio: null, seconds: 3 }, nextInput: 1, wordsDir: WORDS,
  });
  assert.equal(r.skipped, null, "a title card has no words to miss; reporting it would be noise");
  assert.equal(r.filter, "");
});

test("captions stay inside the frame", async () => {
  const r = await captionLayer({
    shot: shotOf(take("bounds", say("cardiovascular epidemiology demonstrates heterogeneity"))),
    nextInput: 1, wordsDir: WORDS,
  });
  const xs = [...r.filter.matchAll(/overlay=x=(-?\d+):y=(-?\d+)/g)]
    .map((m) => ({ x: +m[1], y: +m[2] }));
  assert.ok(xs.length, "expected placements to inspect");
  for (const p of xs) {
    assert.ok(p.x > -40 && p.x < 1920, `x=${p.x} puts a caption off the frame`);
    assert.ok(p.y > 0 && p.y < 1080, `y=${p.y} puts a caption off the frame`);
    assert.ok(p.y > 1080 - CAPTION_BOX.bottomPad - 4 * CAPTION_BOX.lineH,
      `y=${p.y} is far above the caption band — layout is not bottom-anchored`);
  }
});

test("a word beyond the shot's audio window is not drawn on it", async () => {
  const words = say("one two three four five six seven eight nine ten");
  const r = await captionLayer({
    shot: shotOf(take("window", words), { audioStart: 0, seconds: 1.2 }),
    nextInput: 1, wordsDir: WORDS,
  });
  const starts = [...r.filter.matchAll(/between\(t,([\d.]+),/g)].map((m) => +m[1]);
  assert.ok(starts.length, "some words fall inside the window");
  assert.ok(starts.every((s) => s < 1.2), `a caption starts after the shot ends: ${starts}`);
});

test("wordsFileFor answers about the file that actually exists", () => {
  const mp3 = take("exists", say("a b"));
  assert.ok(wordsFileFor(mp3));
  assert.equal(wordsFileFor(path.join(TMP, "ghost.mp3")), null);
  assert.equal(wordsFileFor(null), null);
});
