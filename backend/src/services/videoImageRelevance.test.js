import test from "node:test";
import assert from "node:assert/strict";
import {
  contentTokens, candidateMatches, looksNamed, isAbstractQuery, firstRelevant,
} from "./videoImageRelevance.js";

// ─── THE ACCEPTANCE TEST ────────────────────────────────────────────────────

test("ACCEPTANCE: the polar bear. Any model that passes this has failed", () => {
  // Live from prod, 2026-08-30. The old gate (any shared >=4-char token) took a
  // USAF refuelling exercise NAMED "Polar Bear Charge" as a picture of a polar
  // bear. One of three cached hits was this. It is on the record as the bar
  // every future relevance model must clear, so it is asserted, not commented.
  const query = "A polar bear on ice";
  const candidate = "168th Refueling Wing performs Polar Bear Charge on Eielson Air Force Base";

  assert.equal(candidateMatches(query, candidate), false,
    "the gate accepted the Polar Bear Charge — this is the exact defect it replaces");

  // And for the reason it must: the word carrying the meaning is absent.
  assert.ok(contentTokens(query).includes("ice"));
  assert.ok(!contentTokens(candidate).includes("ice"));

  // The OLD rule, restated here so the regression is visible rather than
  // remembered: it passed on coincidence.
  const old = (q, c) => {
    const cs = new Set(contentTokens(c));
    return contentTokens(q).some((t) => t.length >= 4 && cs.has(t));
  };
  assert.equal(old(query, candidate), true, "the old rule really did accept it");
});

// ─── Conjunctive coverage ───────────────────────────────────────────────────

test("every query token must be present, not merely one of them", () => {
  assert.equal(candidateMatches("polar bear", "Polar bear on sea ice in the Arctic"), true);
  assert.equal(candidateMatches("winter landscape", "Snowy winter landscape at dusk"), true);
  assert.equal(candidateMatches("gas pipeline", "Natural gas pipeline crossing tundra"), true);
  // One token shared, one missing — the shape of every coincidence.
  assert.equal(candidateMatches("gas storage tanks", "Industrial storage tanks at a refinery"), false);
  assert.equal(candidateMatches("flooded village", "Village fete cancelled"), false);
});

test("the gate is CONSERVATIVE by design, and rejects true matches too", () => {
  // "Trump, Putin meet for Alaska 2025 Summit" IS a picture of Putin, and this
  // gate refuses it on the missing "vladimir". That is the intended trade: a
  // miss falls to the next tier and finally to a card, which is a correct
  // video, while a false accept ships a wrong picture unattended 12x a day.
  // Named subjects have an exact path (QID -> P18) that needs no text match.
  assert.equal(candidateMatches("Vladimir Putin", "Trump, Putin meet for Alaska 2025 Summit"), false);
  // Loosening this to "most tokens" would re-admit the polar bear at 2 of 3.
});

test("an empty or stopword-only query never matches anything", () => {
  for (const q of ["", "   ", "the of and", null, undefined]) {
    assert.equal(candidateMatches(q, "anything at all"), false, `expected no match for ${JSON.stringify(q)}`);
  }
});

// ─── Named vs abstract, which is what keeps stock honest ────────────────────

test("named subjects are recognised, so stock can be refused for them", () => {
  for (const s of [
    "Qalandiya Training Centre", "Vladimir Putin", "NASA", "UNRWA headquarters",
    "168th Refueling Wing", "the Isle of Grain gas terminal in Kent",
  ]) {
    assert.equal(looksNamed(s), true, `expected named: ${s}`);
    assert.equal(isAbstractQuery(s), false, `stock must be refused for: ${s}`);
  }
});

test("abstract subjects are the ONLY ones stock may answer", () => {
  for (const s of ["winter landscape", "gas pipeline", "school gate", "flooded streets", "shipping containers"]) {
    assert.equal(looksNamed(s), false, `expected abstract: ${s}`);
    assert.equal(isAbstractQuery(s), true, `stock should be allowed for: ${s}`);
  }
});

test("the Qalandiya case: a plausible stock answer is the failure, not the fix", () => {
  // DrJ's worked example. A stock "school gate" for a named facility is
  // plausible, wrong, and unacceptable — refused at the abstractness gate
  // before any candidate is even fetched.
  assert.equal(isAbstractQuery("Qalandiya Training Centre"), false);
  // The generic beat beside it stays eligible.
  assert.equal(isAbstractQuery("school gate"), true);
});

// ─── Selection ──────────────────────────────────────────────────────────────

test("firstRelevant takes provider order and never re-ranks", () => {
  // A ranking function over candidates IS a scorer, and a scorer is what
  // produced the polar bear. First pass wins; nothing is scored.
  const cands = [
    { title: "Village fete cancelled" },
    { title: "Snowy winter landscape at dusk" },
    { title: "Winter landscape with a frozen lake" },
  ];
  assert.equal(firstRelevant("winter landscape", cands).title, "Snowy winter landscape at dusk");
  assert.equal(firstRelevant("polar bear", cands), null);
});

test("firstRelevant reads alt and description, not only title", () => {
  assert.equal(firstRelevant("gas pipeline", [{ alt: "A gas pipeline in snow" }])?.alt, "A gas pipeline in snow");
  assert.equal(firstRelevant("gas pipeline", [{ description: "gas pipeline segment" }])?.description,
    "gas pipeline segment");
});
