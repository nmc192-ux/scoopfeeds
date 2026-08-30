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

test("with footage off, the SAME photograph is not served twice", async () => {
  // This used to assert the repeat landed on a different MOUNT — a relevant
  // picture repeated beat a black slide, so long as the treatment varied. The
  // mounts are deleted (DrJ, 2026-08-30) and the answer is no longer a
  // different dressing on one photograph: the ledger refuses the second use
  // outright, and the beat renders without a picture.
  const { createImageLedger } = await import("./videoBeatImagery.js");
  const { execFileSync } = await import("node:child_process");
  const { getFFmpegPath } = await import("./videoGenerator.js");
  const real = execFileSync(getFFmpegPath(), ["-loglevel", "error", "-f", "lavfi",
    "-i", "testsrc2=size=1200x800", "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "pipe:1"],
    { maxBuffer: 1 << 24 });
  const ledger = createImageLedger({ _log: QUIET });
  // A buildMount stand-in that claims through the ledger the way the real
  // buildFullBleed does, so the second call meets a spent photograph.
  const spy = async ({ ledger: l }) => (l && !l.claim(real, { label: "article photo" }) ? null : "/tmp/fb.png");

  const first = await run({ ordinal: 0, ledger, _footageEnabled: () => false, _buildMount: spy });
  const later = await run({ ordinal: 1, ledger, _footageEnabled: () => false, _buildMount: spy });
  assert.ok(first.underlayPath, "the first beat gets the photograph");
  assert.equal(later.underlayPath, null, "the second must not get it again in a new costume");
  assert.equal(later.imageCredit, null, "and no credit for a picture that is not on screen");
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
  assert.deepEqual(r, {
    underlayPath: null, imageCredit: null, imageDate: null, footage: null,
    // Reported even when nothing was found, so the log can say so — a slide
    // that silently got no picture is how a bad image went undiagnosable.
    imageUrl: null, pickedBy: "none",
  });
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

test("the choice reports WHAT it picked, so a wrong picture is diagnosable", async () => {
  // Extracting this function for testability (#63) deleted the only log line
  // that recorded which image a slide received. The loss was invisible until a
  // published short carried an obviously wrong picture and nothing said where
  // it came from.
  const first = await run({ ordinal: 0 });
  assert.equal(first.pickedBy, "article-photo");
  assert.equal(first.imageUrl, ARTICLE.image_url);

  const later = await run({ ordinal: 1 });
  assert.equal(later.pickedBy, "footage:DVIDS");
  assert.equal(later.imageUrl, FOOTAGE.imageUrl);

  const reused = await run({ ordinal: 1, _footageEnabled: () => false });
  assert.equal(reused.pickedBy, "article-photo-reused");
});

// ─── The sensitivity gates, per tier ────────────────────────────────────────
//
// Added 2026-08-30. This path previously had NO gate: the same headline got a
// typographic social card and a full-bleed publisher photograph in the Short.
// The two bars differ by who vetted the picture against THIS story.

const harmRun = (over = {}) => run({
  article: { ...ARTICLE, title: "Six killed in Kabul bombing" },
  ...over,
});

test("an explicit-harm headline withholds the publisher's photograph", async () => {
  // The article photo was chosen to illustrate THIS event, which on a massacre
  // story is exactly what makes it the image most likely to be graphic.
  const r = await harmRun({ _findFootageStill: async () => null });
  assert.equal(r.underlayPath, null);
  assert.equal(r.pickedBy, "none");
  assert.equal(r.imageUrl, null, "no picture may be carried under any key");
});

test("an explicit-harm headline withholds ARCHIVE footage too", async () => {
  // Rights-clean is not the same as suitable. Archive material on a massacre
  // story is the same problem as stock.
  const r = await harmRun();
  assert.equal(r.underlayPath, null);
  assert.equal(r.footage, null);
});

test("the reused photo on a later card is withheld as well", async () => {
  // The ordinal > 0 branch is a second doorway to the same photograph.
  const r = await harmRun({ ordinal: 1, _findFootageStill: async () => null });
  assert.equal(r.underlayPath, null);
});

test("a METAPHOR keeps the publisher photo but still refuses footage", async () => {
  // The whole point of splitting the tiers. "crash" in a market headline is a
  // keyword firing on a figure of speech; the picture editor's judgement stands.
  const market = { ...ARTICLE, title: "Bitcoin crash wipes $200bn off crypto market" };

  const withPhoto = await run({ article: market });
  assert.equal(withPhoto.pickedBy, "article-photo", "the publisher's own photo must survive a metaphor");
  assert.equal(withPhoto.imageUrl, market.image_url);

  // ...but with no article photo to fall back on, footage stays refused.
  const noPhoto = await run({ article: { ...market, image_url: null } });
  assert.equal(noPhoto.underlayPath, null, "third-party imagery must not ride a broad-tier headline");
  assert.equal(noPhoto.footage, null);
});

test("ordinary news is untouched by either gate", async () => {
  // The regression guard. ~5% of shorts were expected to lose a photograph;
  // this pins that the other 95% behave exactly as before.
  const r = await run();
  assert.equal(r.pickedBy, "article-photo");
  assert.equal(r.underlayPath, "/tmp/mount-0.png");
});

test("a withheld picture is LOGGED — silence would look identical to a missing photo", async () => {
  const lines = [];
  await harmRun({
    _findFootageStill: async () => null,
    _log: { info: (m) => lines.push(m), warn: () => {} },
  });
  assert.ok(lines.some((l) => /WITHHELD/.test(l)),
    `expected a withheld-picture log line, got: ${JSON.stringify(lines)}`);
});
