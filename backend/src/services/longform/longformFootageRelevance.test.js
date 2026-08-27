/**
 * longformFootageRelevance.test.js — is this clip about the story?
 *
 * Embedding is injected: vectors here are tiny and hand-built, so the rules
 * (floor, ordering, unmeasured honesty) are tested without a model.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { cosine, candidateText, makeRelevanceScreen } from "./longformFootageRelevance.js";

test("cosine: identical direction is 1, orthogonal is 0, junk is null", () => {
  assert.ok(Math.abs(cosine([1, 0], [2, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(cosine([1, 0], [0, 5])) < 1e-9);
  assert.equal(cosine([1, 0], [1]), null, "length mismatch is unmeasurable, not zero");
  assert.equal(cosine([0, 0], [1, 1]), null, "a zero vector has no direction");
});

// A toy embedding: "face" stories point one way, "army" stories the other.
const fakeEmbed = async (text) => {
  const t = String(text).toLowerCase();
  if (t.includes("face") || t.includes("surveillance")) return [1, 0.1];
  if (t.includes("army") || t.includes("graduation")) return [0.1, 1];
  if (t.includes("unembeddable")) return null;
  return [0.6, 0.6];
};

test("the cut is relative to the best hit; off-story clips are refused with the score in the reason", async () => {
  // Calibration showed absolute floors cannot work: real cosines compress
  // into 0.45-0.65, and what separates the on-story hit from the Lion-Cub-
  // Day b-roll is DISTANCE FROM THE BEST, not any fixed number.
  const screen = makeRelevanceScreen({ embed: fakeEmbed, topicText: "facial surveillance", floor: 0.2, margin: 0.15 });
  const { kept, refused, measured } = await screen([
    { source: "DVIDS", title: "Army graduation ceremony b-roll" },
    { source: "Pexels", title: "surveillance camera on a street face scan" },
    { source: "DVIDS", title: "something neutral" },
  ]);
  assert.equal(measured, true);
  assert.equal(kept[0].title, "surveillance camera on a street face scan", "most relevant first");
  assert.ok(refused.some((r) => r.title.includes("graduation") && /below cut/.test(r.why)),
    "the Army b-roll that filled the first film is exactly what this refuses");
  assert.ok(refused.some((r) => r.title.includes("neutral")),
    "middling clips fall to the relative cut when a clearly better hit exists");
});

test("an unembeddable candidate is refused honestly, not passed on a guess", async () => {
  const screen = makeRelevanceScreen({ embed: fakeEmbed, topicText: "face", floor: 0.3 });
  const { refused } = await screen([{ source: "X", title: "unembeddable thing" }]);
  assert.match(refused[0].why, /unmeasurable/);
});

test("no topic vector: the screen reports itself unmeasured and refuses nothing on relevance", async () => {
  const screen = makeRelevanceScreen({ embed: async () => null, topicText: "anything", floor: 0.3 });
  const { kept, refused, measured } = await screen([{ source: "X", title: "clip" }]);
  assert.equal(measured, false);
  assert.equal(kept.length, 1);
  assert.equal(refused.length, 0, "a screen that could not run must not pretend it did");
});

test("candidateText embeds the candidate's words, not its url", () => {
  assert.equal(candidateText({ title: "T", note: "N", url: "https://x" }), "T — N");
});
