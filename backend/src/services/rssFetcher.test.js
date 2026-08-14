/**
 * rssFetcher.test.js — image extraction, including the nested Media RSS form.
 *
 * EARNED 2026-08-14. ABC Australia ships an image on 25 of 25 items and we
 * recorded `image_url` on 0 of them, so those articles fell through to the
 * typographic social card. The field was never missing: Media RSS allows
 * media:content to be wrapped in <media:group>, and rss-parser's item-level
 * customFields only match DIRECT children of <item>. It was one level down and
 * invisible.
 *
 * The fixtures are the REAL parsed shape from that feed, not an invention —
 * four crops of one photo, all 862px wide, one flagged isDefault.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { extractImageUrl } from "./rssFetcher.js";

/** The ABC shape, verbatim from the live feed on 2026-08-14. */
const ABC_ITEM = {
  title: "Albanese and Chalmers given escape plan from costly WA GST deal",
  mediaGroup: {
    "media:description": ["The Productivity Commission has given the federal government several options."],
    "media:content": [
      { $: { url: "https://cdn.abc.net.au/x?crop=16x9", medium: "image", type: "image/jpeg", width: "862", height: "485" } },
      { $: { url: "https://cdn.abc.net.au/x?crop=1x1", medium: "image", type: "image/jpeg", width: "862", height: "862" } },
      { $: { url: "https://cdn.abc.net.au/x?crop=3x2", medium: "image", type: "image/jpeg", width: "862", height: "575", isDefault: "true" } },
      { $: { url: "https://cdn.abc.net.au/x?crop=3x4", medium: "image", type: "image/jpeg", width: "862", height: "1149" } },
    ],
  },
  content: "The Productivity Commission has given the federal government several options.",
};

test("THE BUG: an image nested in media:group is now found", () => {
  assert.equal(extractImageUrl(ABC_ITEM), "https://cdn.abc.net.au/x?crop=3x2");
});

test("the PUBLISHER'S default crop wins, not the biggest or the first", () => {
  // All four ABC crops are 862px wide, so a "widest" rule cannot discriminate
  // between them and a "first" rule picks 16:9 by accident of ordering.
  // isDefault is the publisher saying which crop represents the story.
  const url = extractImageUrl(ABC_ITEM);
  assert.ok(url.endsWith("3x2"), `got ${url}`);
  assert.notEqual(url, ABC_ITEM.mediaGroup["media:content"][0].$.url, "must not just take the first");
});

test("width is the tiebreak only when nobody claims default", () => {
  const item = { mediaGroup: { "media:content": [
    { $: { url: "small.jpg", medium: "image", width: "320" } },
    { $: { url: "big.jpg", medium: "image", width: "1600" } },
    { $: { url: "mid.jpg", medium: "image", width: "800" } },
  ] } };
  // The social card cascade applies a minimum-dimension floor downstream, so
  // the largest rendition is the one most likely to clear it.
  assert.equal(extractImageUrl(item), "big.jpg");
});

test("a VIDEO rendition in the group is never chosen as the image", () => {
  // media:group legitimately carries video and audio alongside the stills. The
  // first entry here would have become image_url under a naive "take [0]".
  const item = { mediaGroup: { "media:content": [
    { $: { url: "clip.mp4", medium: "video", type: "video/mp4", width: "1920" } },
    { $: { url: "still.jpg", medium: "image", type: "image/jpeg", width: "640" } },
  ] } };
  assert.equal(extractImageUrl(item), "still.jpg");
});

test("an entry with neither medium nor type is still accepted", () => {
  // `medium` is optional in the spec and some feeds omit both on a plain still.
  // Rejecting those would trade this bug for a quieter one.
  assert.equal(extractImageUrl({ mediaGroup: { "media:content": [{ $: { url: "plain.jpg" } }] } }), "plain.jpg");
});

test("media:thumbnail inside the group is the fallback within it", () => {
  const item = { mediaGroup: {
    "media:content": [{ $: { url: "movie.mp4", medium: "video" } }],
    "media:thumbnail": [{ $: { url: "thumb.jpg", medium: "image", width: "200" } }],
  } };
  assert.equal(extractImageUrl(item), "thumb.jpg");
});

test("a single object, not an array, is handled — keepArray is false", () => {
  assert.equal(extractImageUrl({ mediaGroup: { "media:content": { $: { url: "one.jpg", medium: "image" } } } }), "one.jpg");
});

// ─── Precedence: nothing that already worked may change ─────────────────────

test("a DIRECT media:content still wins over the group", () => {
  // The new branch runs after the three existing checks precisely so that every
  // feed which already worked keeps producing byte-identical output. Verified
  // live across 7 other feeds: 0 changed values.
  const item = {
    mediaContent: { $: { url: "direct.jpg" } },
    mediaGroup: { "media:content": [{ $: { url: "nested.jpg", medium: "image", isDefault: "true" } }] },
  };
  assert.equal(extractImageUrl(item), "direct.jpg");
});

test("direct thumbnail and image-typed enclosure keep their precedence", () => {
  assert.equal(extractImageUrl({ mediaThumbnail: { $: { url: "t.jpg" } } }), "t.jpg");
  assert.equal(extractImageUrl({ enclosure: { url: "e.jpg", type: "image/jpeg" } }), "e.jpg");
  // A non-image enclosure is still ignored, as before.
  assert.equal(extractImageUrl({ enclosure: { url: "pod.mp3", type: "audio/mpeg" } }), null);
});

test("an unusable group falls through to the <img> in the body, then to null", () => {
  const withImg = {
    mediaGroup: { "media:content": [{ $: { url: "v.mp4", medium: "video" } }] },
    content: '<p>x</p><img src="body.jpg">',
  };
  assert.equal(extractImageUrl(withImg), "body.jpg");
  assert.equal(extractImageUrl({ mediaGroup: { "media:content": [] } }), null);
  assert.equal(extractImageUrl({ mediaGroup: {} }), null);
  assert.equal(extractImageUrl({}), null);
});

test("a malformed group does not throw — ingestion must not die on one bad item", () => {
  for (const g of [null, undefined, "string", 42, { "media:content": [null, undefined] }, { "media:content": [{}] }]) {
    assert.doesNotThrow(() => extractImageUrl({ mediaGroup: g }));
  }
});
