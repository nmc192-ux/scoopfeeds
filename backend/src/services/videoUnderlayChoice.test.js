/**
 * Which picture a photo card gets, and therefore whose name goes on it.
 *
 * This is the one place in the shorts pipeline that makes a RIGHTS decision,
 * and until it was extracted it could not be tested at all — it sat inside a
 * function needing a database, a spec model and a voice API before it would run
 * a line. "Credit the right owner" is not a thing to verify by watching the
 * channel and hoping.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { choosePhotoUnderlay } from "./videoAutopost.js";

const ARTICLE = { id: "a1", image_url: "https://pub.example/photo.jpg", title: "Floods hit Sindh province" };
const ATTR = { publisher: "Reuters" };
const CARD = { t: "photo", subject: "flooded streets in Sindh" };
const FOOTAGE = {
  imageUrl: "https://d34.cloudfront.net/photos/1.jpg",
  credit: "Air Force / DVIDS · SSgt Stacey Thornburg",
  screenCredit: "Air Force / DVIDS",
  licence: "Public domain — US Government work (17 U.S.C. §105)",
  source: "DVIDS", sourceUrl: "https://www.dvidshub.net/image/1/x",
};
const QUIET = { info() {}, warn() {} };

/** A buildMount that succeeds only for the URLs it is told to accept. */
const mountFor_ = (accept) => async ({ imageUrl }) =>
  accept.includes(imageUrl) ? `/tmp/mount-${accept.indexOf(imageUrl)}.png` : null;

const run = (over = {}) => choosePhotoUnderlay({
  card: CARD, article: ARTICLE, attribution: ATTR, ordinal: 0, work: "/tmp/w",
  _footageEnabled: () => true,
  _findFootageStill: async () => FOOTAGE,
  _buildMount: mountFor_([ARTICLE.image_url, FOOTAGE.imageUrl]),
  _log: QUIET,
  ...over,
});

test("the first photo card uses the article's own photograph, credited to the publisher", async () => {
  // An editor chose that image for this story. No keyword search beats that.
  const r = await run();
  assert.ok(r.underlayPath);
  assert.equal(r.imageCredit, "Reuters");
  assert.equal(r.footage, null, "footage was fetched when the article photo was available");
});

test("a later photo card does NOT reuse the article photo while footage exists", async () => {
  // The defect this fixes: one picture shown twice as if it were two.
  const r = await run({ ordinal: 1 });
  assert.equal(r.imageCredit, "Air Force / DVIDS");
  assert.equal(r.footage?.source, "DVIDS");
});

test("footage covers a first card with no article photograph", async () => {
  const r = await run({ article: { ...ARTICLE, image_url: null } });
  assert.ok(r.underlayPath);
  assert.equal(r.imageCredit, "Air Force / DVIDS");
});

test("the badge takes the short credit, the record keeps the full one", async () => {
  // "AIR FORCE / DVIDS · SSGT STACEY THORNBURG" rendered through the wordmark.
  const r = await run({ ordinal: 1 });
  assert.equal(r.imageCredit, FOOTAGE.screenCredit);
  assert.equal(r.footage.credit, FOOTAGE.credit, "the photographer must survive into the description");
});

test("footage is never credited to the article's publisher", async () => {
  // A false attribution, not a cosmetic slip.
  for (const ordinal of [0, 1]) {
    const r = await run({ ordinal, article: { ...ARTICLE, image_url: null } });
    assert.notEqual(r.imageCredit, "Reuters");
  }
});

test("with footage off, a later card falls back to the article photo on a DIFFERENT mount", async () => {
  // A relevant picture repeated still beats a black slide — but on the same
  // mount it reads as a stuck frame, which is the whole complaint. So the
  // mount actually handed to buildMount is what gets asserted, not a stand-in.
  const seen = [];
  const spy = async ({ imageUrl, mount }) => { seen.push(mount); return `/tmp/m-${mount}.png`; };
  const first = await run({ ordinal: 0, _footageEnabled: () => false, _buildMount: spy });
  const later = await run({ ordinal: 1, _footageEnabled: () => false, _buildMount: spy });
  assert.ok(first.underlayPath && later.underlayPath);
  assert.equal(later.imageCredit, "Reuters");
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0], seen[1], "the repeated photograph landed on the same mount");
});

test("no picture means no credit", async () => {
  // The mount can fail — a photo that will not fetch, a decode error. Before
  // this, a failed mount still rendered the publisher's name over bare black.
  const r = await run({ _buildMount: async () => null });
  assert.equal(r.underlayPath, null);
  assert.equal(r.imageCredit, null);
  assert.equal(r.footage, null);
});

test("a failed footage mount does not report footage as used", async () => {
  // The description must not credit an image the video never showed.
  const r = await run({
    ordinal: 1,
    _buildMount: mountFor_([]),           // everything fails
  });
  assert.equal(r.footage, null, "credited footage that never rendered");
  assert.equal(r.imageCredit, null);
});

test("an article with no photograph and no footage renders bare, uncredited", async () => {
  const r = await run({ article: { ...ARTICLE, image_url: null }, _findFootageStill: async () => null });
  assert.deepEqual(r, { underlayPath: null, imageCredit: null, imageDate: null, footage: null });
});

// ─── dating archive material ────────────────────────────────────────────────

test("footage older than the window is dated on screen", async () => {
  // Recency ranking prefers newer pictures; it cannot conjure one. Plenty of
  // stories have no rights-clean image newer than years old, and an undated
  // 2022 flood photograph under a 2026 flood story tells the viewer something
  // untrue.
  const r = await run({ ordinal: 1, _findFootageStill: async () => ({ ...FOOTAGE, date: "2022-06-27" }) });
  assert.equal(r.imageDate, "JUN 2022");
});

test("recent footage carries no date — it would be clutter", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const r = await run({ ordinal: 1, _findFootageStill: async () => ({ ...FOOTAGE, date: today }) });
  assert.equal(r.imageDate, null);
});

test("undated footage stays undated rather than being guessed", async () => {
  const r = await run({ ordinal: 1, _findFootageStill: async () => ({ ...FOOTAGE, date: null }) });
  assert.equal(r.imageDate, null);
});

test("the article's own photograph is never dated", async () => {
  // It was published with the story. Dating it would imply archive material.
  const r = await run({ ordinal: 0 });
  assert.equal(r.imageCredit, "Reuters");
  assert.equal(r.imageDate, null);
});
