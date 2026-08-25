/**
 * Hashtags for X, sized to what the platform actually rewards.
 *
 * Measured across 2026 studies: 1-2 tags earn ~21% more engagement than none;
 * 3+ costs ~17%; 5+ costs up to 40% of reach. X ranks on semantic understanding
 * of the text now, so a GENERIC tag buys no discovery and still pays the
 * penalty. Two, specific, or none.
 *
 * The fixtures below are real entities pulled from three published videos, junk
 * included — that junk is the reason the title filter exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashtagsFor, toTag, withHashtags } from "./xHashtags.js";

test("real entities, real junk: only what the headline named survives", () => {
  // Verbatim from article_entities for the Iran/China video.
  const tags = hashtagsFor({
    title: "Without China's Cooperation, Iran Will Not Face An Economic Collapse",
    entities: [
      { label: "Iran", entity_type: "place" },
      { label: "UTC+03:30", entity_type: "place" },          // a timezone
      { label: "mainland China", entity_type: "place" },
      { label: "People's Republic of China", entity_type: "place" },
    ],
  });
  assert.deepEqual(tags, ["#China", "#Iran"], "China is named first in the headline");
  assert.ok(!tags.some(t => /UTC/i.test(t)), "a timezone is not a subject");
});

test("the Vietnam story drops 'orientalist' and 'sport in Vietnam'", () => {
  const tags = hashtagsFor({
    title: "Why Starlink won't open Vietnam's heavily censored internet",
    entities: [
      { label: "Vietnam", entity_type: "place" },
      { label: "sport in Vietnam", entity_type: "place" },
      { label: "Southeast Asian studies", entity_type: "unknown" },
      { label: "orientalist", entity_type: "place" },
    ],
  });
  assert.deepEqual(tags, ["#Vietnam"]);
});

test("no entities means no tags, not a generic filler", () => {
  // The Wired composter review resolved zero entities. "#News" here would cost
  // reach and tell a reader nothing.
  assert.deepEqual(hashtagsFor({ title: "I Tested Kitchen Composters for 2 Years", entities: [] }), []);
});

test("never more than two", () => {
  const tags = hashtagsFor({
    title: "Iran, China, Russia and India meet in Moscow over oil",
    entities: ["Iran","China","Russia","India","Moscow"].map(l => ({ label: l, entity_type: "place" })),
  });
  assert.equal(tags.length, 2, "3+ tags costs ~17% engagement");
});

test("generic tags are refused even when the headline says them", () => {
  const tags = hashtagsFor({
    title: "Breaking news: markets react to the technology report",
    entities: [
      { label: "Breaking", entity_type: "org" }, { label: "markets", entity_type: "org" },
      { label: "technology", entity_type: "org" }, { label: "news", entity_type: "org" },
    ],
  });
  assert.deepEqual(tags, [], "X already knows this is news");
});

test("a tag must be linkable", () => {
  assert.equal(toTag("Iran"), "Iran");
  assert.equal(toTag("Vietnam's"), "Vietnam");
  assert.equal(toTag("People's Republic of China"), "China");
  assert.equal(toTag("United States"), "US");
  assert.equal(toTag("2026 election"), null, "X will not link a tag starting with a digit");
  assert.equal(toTag("!!!"), null);
  assert.equal(toTag(""), null);
  assert.equal(toTag("a"), null, "too short to be a destination");
});

test("tags are dropped before the sentence is cut", () => {
  // The text is what gets ranked. A truncated sentence costs more than a
  // missing tag.
  const long = "x".repeat(272);
  const out = withHashtags(long, ["#Iran", "#China"]);
  assert.ok([...out].length <= 280);
  assert.ok(out.startsWith(long), "the body must never be truncated");
  const room = withHashtags("Short headline", ["#Iran", "#China"]);
  assert.match(room, /#Iran #China$/, "both fit, and share one line");
});

test("no tags means the caption is returned untouched", () => {
  assert.equal(withHashtags("Just the headline", []), "Just the headline");
  assert.equal(withHashtags("Just the headline"), "Just the headline");
});
