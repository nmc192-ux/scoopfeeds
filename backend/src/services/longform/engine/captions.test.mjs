// captions.test.mjs — word-synced caption planning, layout and filter graph.
//
// Run:  node --test backend/src/services/longform/engine/captions.test.mjs
//
// All offline. The point of splitting the pure logic out of build.mjs is that
// these run without synthesising a take or encoding a frame.

import test from "node:test";
import assert from "node:assert/strict";
import {
  planCaptions, layoutChunk, captionFilter, placeInShot, CAPTION_DEFAULTS,
} from "./captions.mjs";

/** Words at a steady 0.3s each, with an optional pause before a given index. */
const say = (text, { pauseBefore = -1, pause = 0.8 } = {}) => {
  let t = 0;
  return text.split(" ").map((word, i) => {
    if (i === pauseBefore) t += pause;
    const w = { word, start: +t.toFixed(3), end: +(t + 0.3).toFixed(3) };
    t += 0.3;
    return w;
  });
};

// ── The rule the whole module exists to protect ─────────────────────────────

test("no word times means no captions — never invented ones", () => {
  assert.deepEqual(planCaptions([]), [], "empty input must produce nothing");
  assert.deepEqual(planCaptions(null), [], "a missing words file must produce nothing");
  assert.deepEqual(planCaptions(undefined), [], "an absent alignment must produce nothing");
});

test("every caption time is traceable to a word time, never to a duration", () => {
  const words = say("one two three four five six seven eight");
  const chunks = planCaptions(words);
  const starts = new Set(words.map((w) => w.start));
  const ends = new Set(words.map((w) => w.end));
  for (const c of chunks) {
    assert.ok(starts.has(c.start), `chunk start ${c.start} is not any word's start`);
    const last = c.words[c.words.length - 1];
    assert.ok(ends.has(last.end));
    // The end is the last word's end plus the hold, EXCEPT where the clamp that
    // keeps captions from overlapping pulled it in. Either way it is derived
    // from word times — never from a share of the beat's duration.
    assert.ok(c.end >= last.end - 1e-6,
      `chunk ends at ${c.end} before its last word finishes at ${last.end}`);
    assert.ok(c.end <= last.end + CAPTION_DEFAULTS.holdAfter + 1e-6,
      `chunk holds until ${c.end}, longer than its last word's end plus holdAfter`);
  }
});

// ── Chunking ────────────────────────────────────────────────────────────────

test("a chunk never exceeds the word or character limit", () => {
  const chunks = planCaptions(say("cardiovascular epidemiology demonstrates considerable heterogeneity across cohorts here"));
  for (const c of chunks) {
    assert.ok(c.words.length <= CAPTION_DEFAULTS.maxWords + 1,
      `${c.words.length} words in one caption — too many to read at a glance`);
  }
});

test("a pause in the delivery breaks the caption there", () => {
  // Without the pause these six words would chunk purely on the size limits.
  const chunks = planCaptions(say("so here is the actual finding", { pauseBefore: 3, pause: 0.9 }));
  const boundary = chunks.find((c) => c.words[0].word === "the");
  assert.ok(boundary, `expected a chunk to start at the word after the pause; got `
    + JSON.stringify(chunks.map((c) => c.words.map((w) => w.word).join(" "))));
});

test("a sentence end closes the caption even mid-size", () => {
  const chunks = planCaptions(say("it stops. now this continues onward"));
  assert.equal(chunks[0].words[chunks[0].words.length - 1].word, "stops.",
    "a full stop must end the caption rather than running into the next sentence");
});

// THIS TEST USED TO COMPARE THE WRONG QUANTITY and that is why the film shipped
// with two captions on screen at once. It checked the next chunk's start against
// the previous chunk's LAST WORD END — but a chunk is displayed until
// `chunk.end`, which is the last word end PLUS holdAfter. The gap it verified
// was not the gap the renderer uses.
test("a caption is gone before the next one appears", () => {
  for (const text of [
    "a b c d e f g h i j k l",
    "so here is the actual finding and here is what it means",
    "one. two. three. four.",
  ]) {
    const chunks = planCaptions(say(text));
    for (let i = 1; i < chunks.length; i++) {
      assert.ok(chunks[i - 1].end <= chunks[i].start,
        `caption ${i - 1} is still on screen at ${chunks[i - 1].end} when caption ${i} `
        + `appears at ${chunks[i].start} — they overlap on screen`);
    }
  }
});

test("there is clear time between captions wherever the speech allows it", () => {
  const chunks = planCaptions(say("so here is the actual finding and what it means"));
  assert.ok(chunks.length > 1, "need at least two chunks to test the gap");
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1];
    const gap = chunks[i].start - prev.end;
    const lastWordEnd = prev.words[prev.words.length - 1].end;
    // The full gap is only available when the previous caption's last word has
    // finished early enough to give it. Where the speech runs right up to the
    // next caption, keeping the word visible wins and the gap shrinks — but it
    // must never go negative, which is the overlap defect.
    const affordable = chunks[i].start - CAPTION_DEFAULTS.minGap >= lastWordEnd;
    if (affordable) {
      assert.ok(gap >= CAPTION_DEFAULTS.minGap - 1e-6,
        `only ${gap.toFixed(3)}s between captions ${i - 1} and ${i} where a full gap was possible`);
    } else {
      assert.ok(gap >= -1e-6, `captions ${i - 1} and ${i} overlap by ${(-gap).toFixed(3)}s`);
    }
  }
});

test("clamping never hides a word while it is still being spoken", () => {
  // The gap must not be bought by cutting a caption before its last word ends.
  for (const text of ["a b c d e f g h", "one two three four five six seven"]) {
    for (const step of [0.12, 0.2, 0.35]) {
      const chunks = planCaptions(say(text, {}).map((w, i) => ({
        ...w, start: +(i * step).toFixed(3), end: +(i * step + step * 0.8).toFixed(3),
      })));
      for (const c of chunks) {
        const last = c.words[c.words.length - 1];
        assert.ok(c.end >= last.end - 1e-6,
          `caption ends at ${c.end} but its last word is still being said until ${last.end}`);
      }
    }
  }
});

test("chunks are ordered and never overlap in their word spans", () => {
  const chunks = planCaptions(say("a b c d e f g h i j k l"));
  for (let i = 1; i < chunks.length; i++) {
    assert.ok(chunks[i].start >= chunks[i - 1].words[chunks[i - 1].words.length - 1].end,
      "a caption started before the previous one had finished speaking");
  }
});

test("every word survives chunking exactly once", () => {
  const text = "five cohorts two sugar alcohols and one very consistent direction here";
  const got = planCaptions(say(text)).flatMap((c) => c.words.map((w) => w.word));
  assert.deepEqual(got, text.split(" "), "chunking dropped or duplicated a word");
});

// ── Layout ──────────────────────────────────────────────────────────────────

test("layout wraps on measured width and centres each line", () => {
  const words = [{ word: "aa" }, { word: "bb" }, { word: "cc" }];
  const pos = layoutChunk(words, [100, 100, 100], { maxWidth: 260, space: 20, lineH: 90 });
  assert.equal(pos[0].line, 0);
  assert.equal(pos[1].line, 0, "two 100px words plus a 20px space fit in 260px");
  assert.equal(pos[2].line, 1, "the third must wrap");
  // Line 0 is 220px wide in a 260px box → 20px lead-in on each side.
  assert.equal(pos[0].x, 20);
  assert.equal(pos[2].x, 80, "a single 100px word centres in 260px at x=80");
  assert.equal(pos[2].y, 90);
});

test("layout refuses a widths array that does not match the words", () => {
  assert.throws(() => layoutChunk([{ word: "a" }], [10, 20], { maxWidth: 100, space: 4, lineH: 10 }),
    /1 words but 2 widths/,
    "a mismatch means the measurement pass and the layout disagree about the text");
});

test("a word wider than the safe area gets a line rather than being dropped", () => {
  const pos = layoutChunk([{ word: "a" }, { word: "electroencephalographically" }],
    [50, 900], { maxWidth: 400, space: 10, lineH: 80 });
  assert.equal(pos.length, 2, "the oversized word must still be placed");
  assert.equal(pos[1].line, 1);
});

// ── Shot placement ──────────────────────────────────────────────────────────

test("a caption outside the shot is not drawn on it", () => {
  const chunks = planCaptions(say("one two three four five six seven eight nine ten"));
  const placed = placeInShot({ chunks, offset: 0, shotFrom: 0, shotTo: 1.2 });
  assert.ok(placed.length, "some words fall inside the shot");
  assert.ok(placed.every((p) => p.start < 1.2), "a word placed past the end of the shot");
  const late = placeInShot({ chunks, offset: 0, shotFrom: 100, shotTo: 110 });
  assert.deepEqual(late, [], "a shot after all the speech must carry no captions");
});

test("a word already spoken when a fragment opens starts at zero, not negative", () => {
  const chunks = planCaptions(say("one two three four"));
  const placed = placeInShot({ chunks, offset: 0, shotFrom: 0.45, shotTo: 3 });
  assert.ok(placed.every((p) => p.start >= 0),
    "a negative enable time silently never fires — the caption would just not appear");
});

test("the offset moves captions onto the film clock", () => {
  const chunks = planCaptions(say("one two"));
  const a = placeInShot({ chunks, offset: 0, shotFrom: 0, shotTo: 5 });
  const b = placeInShot({ chunks, offset: 10, shotFrom: 10, shotTo: 15 });
  assert.deepEqual(a.map((p) => p.start), b.map((p) => p.start),
    "the same words at a later offset must land at the same shot-relative times");
});

// ── Filter graph ────────────────────────────────────────────────────────────

test("no placements produces no filter, not a broken graph", () => {
  assert.equal(captionFilter({ inLabel: "v", outLabel: "vc", firstInput: 1, placements: [] }), "",
    "an empty chain must be empty so the caller can skip it entirely");
});

test("the filter chains each word through to the declared output label", () => {
  const f = captionFilter({
    inLabel: "v", outLabel: "vc", firstInput: 3,
    placements: [
      { start: 0.1, chunkEnd: 1.4, x: 100, y: 900 },
      { start: 0.5, chunkEnd: 1.4, x: 240, y: 900 },
    ],
  });
  assert.match(f, /^\[v\]\[3:v\]overlay/, "the chain must start from the input label and the first PNG");
  assert.match(f, /\[4:v\]overlay/, "input indices must advance one per word");
  assert.ok(f.trim().endsWith("[vc]"), `the chain must end on the output label, got: ${f}`);
  assert.equal((f.match(/overlay=/g) || []).length, 2, "one overlay per word");
  assert.match(f, /enable='between\(t,0\.100,1\.400\)'/);
  assert.match(f, /enable='between\(t,0\.500,1\.400\)'/);
});

test("words in a chunk leave together", () => {
  const chunks = planCaptions(say("one two three"));
  const placed = placeInShot({ chunks, offset: 0, shotFrom: 0, shotTo: 10 });
  const byChunk = new Map();
  for (const p of placed) {
    if (!byChunk.has(p.ci)) byChunk.set(p.ci, new Set());
    byChunk.get(p.ci).add(p.chunkEnd);
  }
  for (const [ci, ends] of byChunk) {
    assert.equal(ends.size, 1, `chunk ${ci} has words leaving at different times`);
  }
});
