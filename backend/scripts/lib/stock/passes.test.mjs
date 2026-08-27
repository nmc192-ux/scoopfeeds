/**
 * passes.test.mjs — the order requests are spent in.
 *
 * Run: cd backend && node --test "scripts/lib/stock/*.test.mjs"
 *
 * Getting this order wrong costs quota rather than correctness, which is why it
 * needs a test: the tool would still work, just spend 200 requests/hour fetching
 * 720p landscape it was going to discard. The acquire loop stops issuing passes
 * once a class is full, so whatever sits at the front is what most runs actually
 * pay for.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { applicablePasses, describePass, PASSES } from "./passes.mjs";
import { gradeCandidate } from "./cropGate.mjs";

test("passes are ordered best-first, across providers", () => {
  const ranks = PASSES.map((p) => p.rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "PASSES must already be sorted");
  assert.equal(PASSES[0].provider, "pexels");
  assert.equal(PASSES[0].orientation, "portrait");
  assert.equal(PASSES[0].size, "large", "portrait 4K is the one request worth making first");
});

test("the cheapest grade is asked for LAST", () => {
  // Full HD landscape is soft-hd-crop, which §5 rations anyway. Spending early
  // requests on it is spending them on candidates the quota will refuse.
  const last = PASSES[PASSES.length - 1];
  assert.equal(last.provider, "pexels");
  assert.equal(last.orientation, "landscape");
  assert.equal(last.size, "medium");
});

test("every pass would satisfy the crop gate it targets", () => {
  // The point of the provider-side filters is to pre-empt the gate, so a pass
  // that asks for something the gate rejects is a wasted request by construction.
  const fourK = gradeCandidate({ width: 3840, height: 2160, durationSec: 10 });
  assert.equal(fourK.grade, "crisp-4k-crop");
  const portraitHd = gradeCandidate({ width: 1080, height: 1920, durationSec: 10 });
  assert.equal(portraitHd.grade, "native-portrait");

  for (const p of PASSES.filter((x) => x.provider === "pixabay")) {
    assert.ok(p.minHeight >= 1080, "no pass may ask for something below the 1080p floor");
  }
  for (const p of PASSES.filter((x) => x.provider === "pexels")) {
    assert.ok(["large", "medium"].includes(p.size),
      "size=small is HD — below what the gate accepts for a landscape crop");
  }
});

test("restricting providers keeps the remaining passes in order", () => {
  const pexelsOnly = applicablePasses(["pexels"]);
  assert.ok(pexelsOnly.length > 0);
  assert.ok(pexelsOnly.every((p) => p.provider === "pexels"));
  assert.deepEqual(pexelsOnly.map((p) => p.rank), [...pexelsOnly.map((p) => p.rank)].sort((a, b) => a - b));

  const pixabayOnly = applicablePasses(["pixabay"]);
  assert.ok(pixabayOnly.every((p) => p.provider === "pixabay"));
  assert.equal(applicablePasses([]).length, 0);
  assert.equal(applicablePasses(["pexels", "pixabay"]).length, PASSES.length);
});

test("both providers get a turn before either exhausts its options", () => {
  // If one provider owned the whole front of the queue, a class would fill from
  // it alone and the library would inherit that provider's look wholesale.
  const firstThree = PASSES.slice(0, 3).map((p) => p.provider);
  assert.ok(firstThree.includes("pexels") && firstThree.includes("pixabay"),
    `both providers must appear early; got ${firstThree.join(", ")}`);
});

test("a pass describes itself well enough to read in a run log", () => {
  // The acquire run prints which passes it issued and which it skipped, because
  // an early stop bounds coverage and must not read as a full search.
  assert.equal(describePass({ provider: "pexels", orientation: "portrait", size: "large" }), "pexels portrait/large");
  assert.equal(describePass({ provider: "pixabay", minHeight: 2160 }), "pixabay ≥2160p");
  for (const p of PASSES) {
    assert.ok(describePass(p).length > 0);
    assert.ok(!describePass(p).includes("undefined"), `${JSON.stringify(p)} describes badly`);
  }
});
