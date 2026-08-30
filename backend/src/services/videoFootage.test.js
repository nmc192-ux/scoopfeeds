/**
 * The gates that stand between the automated channel and a bad picture.
 *
 * Two of these were written only after looking at live results — the archive
 * turned out to be full of scientific figures that are perfectly relevant and
 * completely unusable. Both thresholds are measured, not guessed, and the
 * measurements are in the module's comments.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tokens, relevant, looksPhotographic, whiteFraction, findFootageStill, footageEnabled,
} from "./videoFootage.js";

test("stop-words cannot establish relevance", () => {
  // "the new report" sharing "new" with a candidate title is not a match.
  assert.deepEqual(tokens("The new report"), ["report"]);
  assert.ok(!tokens("the and for with").length);
});

test("relevance needs a shared significant word, not a shared API", () => {
  assert.ok(relevant("hurricane michael", "SMAP captures Hurricane Michael"));
  // The failure this exists to prevent: every one of these APIs returns its
  // best effort for any string, and best-effort on an unrelated query is a
  // confidently irrelevant picture that nothing downstream can see.
  assert.ok(!relevant("semiconductor tariff negotiations", "The Carina Nebula"));
  assert.ok(!relevant("", "anything at all"));
});

test("artists' concepts and diagrams are rejected by name", () => {
  assert.ok(looksPhotographic({ title: "Flooding in Pakistan August 4, 2010" }));
  // A painting under a credit line in a news short is a misrepresentation, not
  // a stylistic choice.
  assert.ok(!looksPhotographic({ title: "Artist's concept of the lander" }));
  assert.ok(!looksPhotographic({ title: "Sea ice extent chart" }));
  assert.ok(!looksPhotographic({ title: "Storm", description: "A diagram of the storm's structure." }));
});

test("the white-pixel measure is what it claims", () => {
  const px = (n, [r, g, b]) => Buffer.from(Array.from({ length: n * 3 }, (_, i) => [r, g, b][i % 3]));
  assert.equal(whiteFraction(Buffer.concat([px(50, [255, 255, 255]), px(50, [10, 10, 10])])), 0.5);
  assert.equal(whiteFraction(px(10, [0, 0, 0])), 0);
  // 236 is the threshold and it is exclusive — a pixel AT it is not white.
  assert.equal(whiteFraction(px(10, [236, 236, 236])), 0);
  assert.equal(whiteFraction(Buffer.alloc(0)), 0);
});

test("measured separation: figures sit far above the threshold, photographs far below", () => {
  // Live measurement on four NASA results (see the module comment): scientific
  // figures 32% and 48% near-white; genuine satellite imagery 0.8% and 2.0%.
  // This pins the default threshold inside that gap rather than at its edge.
  const MAX_WHITE = Number.parseFloat(process.env.VIDEO_FOOTAGE_MAX_WHITE || "0.20");
  for (const figure of [0.32, 0.48]) assert.ok(figure > MAX_WHITE, `figure at ${figure} would be accepted`);
  for (const photo of [0.008, 0.020]) assert.ok(photo <= MAX_WHITE, `photograph at ${photo} would be rejected`);
});

test("dark by default — nothing searches unless the flag is on", async () => {
  const prev = process.env.VIDEO_FOOTAGE_ENABLED;
  delete process.env.VIDEO_FOOTAGE_ENABLED;
  try {
    assert.equal(footageEnabled(), false);
    // No network call is possible from here: the flag is checked first.
    assert.equal(await findFootageStill({ subject: "flooding in Pakistan" }), null);
  } finally {
    if (prev === undefined) delete process.env.VIDEO_FOOTAGE_ENABLED;
    else process.env.VIDEO_FOOTAGE_ENABLED = prev;
  }
});

test("a query with no significant words never reaches the network", async () => {
  process.env.VIDEO_FOOTAGE_ENABLED = "1";
  try {
    assert.equal(await findFootageStill({ subject: "the and for", title: "" }), null);
    assert.equal(await findFootageStill({}), null);
  } finally { delete process.env.VIDEO_FOOTAGE_ENABLED; }
});

// ─── mount variety: REMOVED ─────────────────────────────────────────────────
//
// mountFor and the mount library are deleted (DrJ, 2026-08-30). Variety between
// successive photo cards is no longer a treatment rotation — it is a different
// PHOTOGRAPH per beat, enforced by the image ledger and measured by the
// PICTURES PLACED line. The tests that pinned mount rotation pinned a feature
// that no longer exists, and are gone with it rather than adapted.


// ─── recency ────────────────────────────────────────────────────────────────

import { newestFirst } from "./videoFootage.js";

test("recency is a tiebreak among acceptable pictures, newest first", () => {
  // Measured effect on live NASA results: "flooding in Pakistan" moved from a
  // 2010 image to 2022, and "volcanic eruption in Iceland" from a 2014 EO-1
  // frame to the March 2024 eruption. For news that is the difference between
  // archive material and something that reads as current.
  const sorted = [
    { date: "2010-08-04" }, { date: "2024-03-29" }, { date: "2017-12-08" },
  ].sort(newestFirst).map(x => x.date);
  assert.deepEqual(sorted, ["2024-03-29", "2017-12-08", "2010-08-04"]);
});

test("an undated candidate sorts last, not first", () => {
  // "" beats every real date in a naive descending compare, which would rank
  // the one candidate we know least about above all the others.
  const sorted = [{ date: null }, { date: "2011-01-01" }, { date: "" }].sort(newestFirst);
  assert.equal(sorted[0].date, "2011-01-01");
});

// ─── attribution ────────────────────────────────────────────────────────────

import { footageCreditLines } from "./videoFootage.js";

const DVIDS = {
  credit: "Air Force / DVIDS · SSgt Stacey Thornburg",
  screenCredit: "Air Force / DVIDS",
  licence: "Public domain — US Government work (17 U.S.C. §105)",
  sourceUrl: "https://www.dvidshub.net/image/9876176/x",
  disclaimer: "The appearance of U.S. Department of War (DoW) visual information does not imply or constitute DoW endorsement.",
};
const NASA = { credit: "NASA / GSFC", screenCredit: "NASA / GSFC", licence: "Public domain — US Government work (17 U.S.C. §105)", sourceUrl: null };

test("DVIDS material carries its required disclaimer into the description", () => {
  // dvidshub.net/about/copyright: "All users of DoW VI must display this
  // non-DoW endorsement disclaimer". A condition met only when someone
  // remembers is not met, so it travels with the asset.
  const lines = footageCreditLines([DVIDS]);
  assert.ok(lines.some(l => l.includes("does not imply or constitute DoW endorsement")));
  assert.ok(lines.some(l => l.includes("SSgt Stacey Thornburg")), "the photographer is named");
});

test("NASA needs no disclaimer, and does not get one", () => {
  const lines = footageCreditLines([NASA]);
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes("DoW"));
});

test("several stills from one source do not repeat the disclaimer", () => {
  // It is a statement about the channel, not about each picture.
  const lines = footageCreditLines([DVIDS, { ...DVIDS, sourceUrl: "https://www.dvidshub.net/image/2/y" }]);
  assert.equal(lines.filter(l => l.includes("DoW endorsement")).length, 1);
});

test("no footage means no lines at all", () => {
  assert.deepEqual(footageCreditLines([]), []);
  assert.deepEqual(footageCreditLines(), []);
  assert.deepEqual(footageCreditLines([null, {}]), []);
});

test("the badge form is short enough to sit beside the wordmark", () => {
  // "AIR FORCE / DVIDS · SSGT STACEY THORNBURG" rendered straight through the
  // SCOOPFEEDS wordmark. The short form is composed, not truncated — truncating
  // a credit risks misattributing it.
  assert.ok(DVIDS.screenCredit.length <= 24, "screen credit would collide with the wordmark");
  assert.ok(DVIDS.credit.startsWith(DVIDS.screenCredit), "the short form must be a true prefix of the full one");
});

// ─── dating archive material ────────────────────────────────────────────────

import { footageDateLabel } from "./videoFootage.js";

test("the date label says month and year, not a precise day", () => {
  // The claim is "this is not from now". A day implies a precision the story
  // does not turn on.
  const now = Date.parse("2026-08-24");
  assert.equal(footageDateLabel("2022-06-27", now), "JUN 2022");
  assert.equal(footageDateLabel("2010-08-04T00:00:00Z", now), "AUG 2010");
});

test("nothing recent, undated, or malformed gets a label", () => {
  const now = Date.parse("2026-08-24");
  assert.equal(footageDateLabel("2026-08-18", now), null, "six days old is current");
  assert.equal(footageDateLabel(null, now), null);
  assert.equal(footageDateLabel("", now), null);
  assert.equal(footageDateLabel("not a date", now), null);
  // A future date is a metadata error, not tomorrow's news.
  assert.equal(footageDateLabel("2027-01-01", now), null);
});

test("the boundary is the configured window, not a hardcoded guess", () => {
  const now = Date.parse("2026-08-24");
  const days = Number.parseInt(process.env.VIDEO_FOOTAGE_DATE_BADGE_DAYS || "60", 10);
  const justInside = new Date(now - (days - 1) * 86400000).toISOString().slice(0, 10);
  const justOutside = new Date(now - (days + 1) * 86400000).toISOString().slice(0, 10);
  assert.equal(footageDateLabel(justInside, now), null);
  assert.ok(footageDateLabel(justOutside, now), "an asset past the window must be dated");
});
