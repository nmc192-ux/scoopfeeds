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

test("a single object, not an array, is still handled", () => {
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

// ─── The Guardian's three renditions (2026-08-31) ────────────────────────────
//
// EARNED, and expensive: 526 of the 529 Guardian articles fetched in a week
// carried an image_url declaring a width under 400px, and they are 97% of every
// undersized image we hold. The 700px rendition was in the same <item> the
// whole time — the parser was collapsing the siblings to the first, and the
// flat branch of extractImageUrl took it without looking at the rest.
//
// Downstream this is not a small picture, it is NO picture: buildFullBleed
// rejects the 140px file ("photo is 3648B — too small"), so no Guardian story
// could carry a photograph in a Short. The fixture below is the real parsed
// shape from theguardian.com/us-news/rss.

const GUARDIAN_RENDITIONS = [
  { $: { width: "140", url: "https://i.guim.co.uk/img/media/bfb0/master/3600.jpg?width=140&s=50165b5a" } },
  { $: { width: "460", url: "https://i.guim.co.uk/img/media/bfb0/master/3600.jpg?width=460&s=e5c90729" } },
  { $: { width: "700", url: "https://i.guim.co.uk/img/media/bfb0/master/3600.jpg?width=700&s=ad2ee188" } },
];

test("THE BUG: a Guardian item yields its widest rendition, not the 140px thumbnail", () => {
  const url = extractImageUrl({ mediaContent: GUARDIAN_RENDITIONS });
  assert.equal(url, GUARDIAN_RENDITIONS[2].$.url);
});

test("the chosen Guardian rendition clears the size floor that rejected the old one", () => {
  // Pinned as a NUMBER rather than as a URL string: the point of this fix is the
  // dimension, and a future change that still returns "a Guardian URL" while
  // dropping back to 140px would pass a URL-equality test.
  const url = extractImageUrl({ mediaContent: GUARDIAN_RENDITIONS });
  const declared = Number(new URL(url).searchParams.get("width"));
  assert.ok(declared >= 400, `expected a usable width, got ${declared}px`);
});

test("the widest rendition wins even when the smallest arrives first", () => {
  // Order is the whole bug. Reversed, the answer must not change.
  const reversed = [...GUARDIAN_RENDITIONS].reverse();
  assert.equal(extractImageUrl({ mediaContent: reversed }), GUARDIAN_RENDITIONS[2].$.url);
});

test("a flat media:thumbnail list is picked from too, not taken first", () => {
  const item = { mediaThumbnail: [
    { $: { width: "100", url: "small.jpg" } },
    { $: { width: "900", url: "large.jpg" } },
  ] };
  assert.equal(extractImageUrl(item), "large.jpg");
});

test("a video rendition among flat siblings is never chosen", () => {
  // isImageEntry already enforced this for the group branch; the flat branch
  // reached it for the first time with this change, so it is pinned here too.
  const item = { mediaContent: [
    { $: { url: "clip.mp4", medium: "video", width: "1920" } },
    { $: { url: "still.jpg", medium: "image", width: "600" } },
  ] };
  assert.equal(extractImageUrl(item), "still.jpg");
});
