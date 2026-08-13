/**
 * socialComposer.threads.test.js — bringing Threads up to the house standard.
 *
 * Threads was the odd platform out. Facebook and Bluesky both ran the headline
 * through cleanHeadline(), preferred a lead quote, trimmed on sentence
 * boundaries and refused to re-state a headline the description already
 * carried. Threads interpolated `article.title` raw and cut on character count,
 * so wire noise that every other channel stripped — "Watch:", "BBC Sport:",
 * a trailing " - BBC News" — went out verbatim, and half-words went out with it.
 *
 * The URL deliberately STAYS in the Threads body, which is the one thing here
 * that is not copied from Bluesky. Bluesky can drop it because its external
 * embed carries the link; the Threads adapter posts `media_type: IMAGE`, which
 * renders no link preview at all, so removing the URL would leave the post with
 * no click path off it. That is asserted below so nobody "tidies" it away.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { composeAllPlatforms } from "./socialComposer.js";

const HOUR = 60 * 60 * 1000;

function article(over = {}) {
  return {
    id: "test-article-id",
    title: "Senate panel advances health funding package",
    description: "The bill cleared committee with bipartisan support after weeks of negotiation.",
    category: "politics",
    source_name: "The Hill",
    // Old enough that the BREAKING prefix never fires unless a test asks for it.
    published_at: Date.now() - 12 * HOUR,
    tags: JSON.stringify(["us-politics"]),
    ...over,
  };
}
const threadsFor = (over) => composeAllPlatforms(article(over)).platforms.threads;

// ─── The wire-noise cases ───────────────────────────────────────────────────

test("THE REAL CASE: a \"Watch:\" prefix is stripped, as it is everywhere else", () => {
  const { caption } = threadsFor({ title: "Watch: Houses engulfed in flames across Stourbridge" });
  assert.ok(!caption.includes("Watch:"), caption);
  assert.ok(caption.includes("Houses engulfed in flames across Stourbridge"));
});

test("a trailing publication name is stripped from the headline", () => {
  const { caption } = threadsFor({ title: "Chancellor signals autumn tax rise - BBC News" });
  assert.ok(!caption.includes("- BBC News"), caption);
  assert.ok(caption.includes("Chancellor signals autumn tax rise"));
});

// ─── Structure ──────────────────────────────────────────────────────────────

test("the post carries source attribution, like Bluesky", () => {
  assert.match(threadsFor().caption, /📍 The Hill/);
});

test("THE CLICK PATH: the article URL stays in the body", () => {
  // An IMAGE post on Threads renders no link preview. This URL is the only way
  // off the post — see the module comment.
  const { caption, url } = threadsFor();
  assert.ok(caption.includes(url), "Threads captions must retain the URL");
  assert.match(url, /utm_source=social_threads/);
});

test("a description that merely restates the headline is dropped, not padded in", () => {
  const title = "Senate panel advances health funding package";
  const { caption } = threadsFor({ title, description: `${title}, according to two aides.` });
  // The headline appears once (in the head), not again as a body paragraph.
  const occurrences = caption.split(title).length - 1;
  assert.equal(occurrences, 1, caption);
});

test("a lead quote is preferred as the body, with its attribution attached", () => {
  const { caption } = threadsFor({
    description: '"This is the most consequential vote of the session," said Dr. Amelia Reyes. Further debate is expected.',
  });
  assert.match(caption, /most consequential vote of the session/);
  // "Dr." must not be treated as a sentence end mid-name.
  assert.ok(!/said Dr\.$/m.test(caption), caption);
});

// ─── The hard cap ───────────────────────────────────────────────────────────

test("never exceeds the 500-character platform cap, even on absurd input", () => {
  for (const desc of ["", "short.", "Lorem ipsum dolor sit amet. ".repeat(60)]) {
    for (const title of ["Short one", "A ".repeat(200) + "very long headline indeed"]) {
      const { caption, characterCount } = threadsFor({ title, description: desc });
      assert.ok(caption.length <= 500, `overflowed at ${caption.length}: ${caption.slice(0, 80)}`);
      assert.equal(characterCount, caption.length);
    }
  }
});

test("the URL and hashtags survive even when the headline eats the budget", () => {
  const { caption, url } = threadsFor({
    title: "A very long headline that goes on and on ".repeat(12),
    description: "Some supporting detail that will not fit.",
  });
  assert.ok(caption.length <= 500);
  assert.ok(caption.includes(url), "the click path must survive truncation");
  assert.ok(caption.includes("#ScoopFeeds"));
});

// ─── Urgency cue ────────────────────────────────────────────────────────────

test("BREAKING fires only for genuinely fresh stories", () => {
  assert.match(threadsFor({ published_at: Date.now() - 5 * 60 * 1000 }).caption, /🚨 BREAKING/);
  assert.doesNotMatch(threadsFor({ published_at: Date.now() - 6 * HOUR }).caption, /🚨 BREAKING/);
});

test("the other platforms are untouched by this change", () => {
  // composeThreads was rewritten in place; a regression here would mean the
  // shared helpers were changed rather than the Threads composer.
  const p = composeAllPlatforms(article()).platforms;
  assert.ok(p.bluesky.caption.length <= 300, "bluesky still respects its 300 cap");
  assert.ok(!p.bluesky.caption.includes(p.bluesky.url), "bluesky still omits the URL (its embed carries it)");
  assert.ok(p.facebook.caption.includes(p.facebook.url), "facebook still carries its URL");
  assert.ok(p.x.caption.length <= 280, "x still respects its 280 cap");
});
