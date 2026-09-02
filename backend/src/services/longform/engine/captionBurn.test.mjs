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

// ── Defect 2: words on a line must share a baseline ─────────────────────────
//
// The first version positioned each word by subtracting its own `inkTop`. Ink is
// measured per word, so a word with a descender has a different top edge from
// one without, and aligning ink tops hangs every word from its own tallest
// pixel. On screen: words in the same line sitting at different heights.

test("every word on a line lands at the same y", async () => {
  // "gum" has a descender, "cost" has none, "Xylitol" has an ascender and a
  // dot — exactly the mix that exposed the bug.
  const r = await captionLayer({
    shot: shotOf(take("baseline", say("Xylitol gum cost"))), nextInput: 1, wordsDir: WORDS,
  });
  const ys = [...r.filter.matchAll(/overlay=x=-?\d+:y=(-?\d+)/g)].map((m) => +m[1]);
  assert.equal(ys.length, 3, "expected three placed words");
  assert.equal(new Set(ys).size, 1,
    `words on one line sit at ${ys.join(", ")} — they must share a baseline. `
    + "Vertical position comes from the render canvas, never from per-word ink.");
});

test("a second line sits exactly one line-height below the first", async () => {
  const long = "cardiovascular epidemiology demonstrates considerable heterogeneity";
  const r = await captionLayer({
    shot: shotOf(take("twoline", say(long))), nextInput: 1, wordsDir: WORDS,
  });
  const ys = [...new Set([...r.filter.matchAll(/overlay=x=-?\d+:y=(-?\d+)/g)].map((m) => +m[1]))]
    .sort((a, b) => a - b);
  assert.ok(ys.length <= 2, `expected at most two lines, got ys ${ys.join(", ")}`);
  if (ys.length === 2) {
    assert.equal(ys[1] - ys[0], CAPTION_BOX.lineH,
      "line spacing must be exactly lineH — anything else means ink is leaking into y");
  }
});

// ── Defect 3, at the layer that actually renders it ─────────────────────────

test("no two caption groups are enabled at the same instant", async () => {
  const r = await captionLayer({
    shot: shotOf(take("nooverlap", say("so here is the actual finding and what it means")), { seconds: 12 }),
    nextInput: 1, wordsDir: WORDS,
  });
  const wins = [...r.filter.matchAll(/enable='between\(t,([\d.]+),([\d.]+)\)'/g)]
    .map((m) => ({ s: +m[1], e: +m[2] }));
  assert.ok(wins.length > 1, "need several words to test");
  // Group by end time: every word in a group leaves together, so a distinct end
  // is a distinct group.
  const groups = [...new Set(wins.map((w) => w.e))].sort((a, b) => a - b)
    .map((e) => ({ e, s: Math.min(...wins.filter((w) => w.e === e).map((w) => w.s)) }));
  for (let i = 1; i < groups.length; i++) {
    assert.ok(groups[i - 1].e <= groups[i].s,
      `group ending ${groups[i - 1].e} is still drawn when the group starting `
      + `${groups[i].s} appears — this is the on-screen overlap`);
  }
});
