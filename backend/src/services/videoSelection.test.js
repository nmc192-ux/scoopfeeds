/**
 * videoSelection.test.js — the blocking gates.
 *
 * Pure-function gates only; the DB-backed cooldowns are covered in
 * videoAutopost.test.js where a real schema exists. What matters here is that
 * each gate refuses the thing it names and does NOT refuse its neighbours —
 * a stock-commentary rule that also blocks "Fed holds rates" would quietly
 * remove finance as a subject.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { staticGate, tooSimilar, _internals } from "./videoSelection.js";

const art = (over = {}) => ({ id: "a1", title: "T", description: "", category: "world", source_name: "Reuters", ...over });

// ─── Sport ──────────────────────────────────────────────────────────────────

test("sport is blocked by category", () => {
  for (const c of ["sports", "sport", "football", "nba"]) {
    const g = staticGate(art({ category: c }));
    assert.equal(g.ok, false, c);
    assert.equal(g.gate, "sport");
  }
});

test("a world story is not sport", () => {
  assert.equal(staticGate(art({ category: "world" })).ok, true);
});

// ─── Live blogs ─────────────────────────────────────────────────────────────

test("live blogs are blocked — rolling updates have no stable narrative", () => {
  for (const t of [
    "Ukraine war live: Zelensky addresses parliament",
    "Budget 2026 live updates",
    "Election night as it happened",
    "Middle East crisis — rolling coverage",
  ]) {
    const g = staticGate(art({ title: t }));
    assert.equal(g.ok, false, t);
    assert.equal(g.gate, "live-blog");
  }
});

test("an ordinary headline containing 'live' is NOT a live blog", () => {
  // The regex anchors on "live:" / "live updates" / "as it happened", not on
  // the word alone — otherwise "Live music venues face closure" would go.
  for (const t of [
    "Live music venues face closure after funding cut",
    "How long do queen bees live?",
    "Residents live without power for a third day",
  ]) {
    assert.equal(staticGate(art({ title: t })).ok, true, t);
  }
});

// ─── Individual stock commentary ────────────────────────────────────────────

test("individual stock commentary is blocked", () => {
  for (const t of [
    "Forget Nvidia: 3 AI stocks to buy before December",
    "Is Tesla stock a buy after the earnings miss?",
    "5 undervalued dividend stocks for 2026",
    "Analyst raises Apple price target to $310",
    "My top stock pick for the next decade",
  ]) {
    const g = staticGate(art({ title: t }));
    assert.equal(g.ok, false, t);
    assert.equal(g.gate, "stock-commentary");
  }
});

test("finance as a SUBJECT survives — the gate targets the genre, not the topic", () => {
  // If this ever starts failing, the rule has widened from "a security is
  // being recommended to the viewer" into "anything about markets", and the
  // channel loses economics coverage.
  for (const t of [
    "Fed holds rates steady as inflation cools",
    "Nvidia reports record quarterly revenue",
    "European stocks fall after the ECB decision",
    "What the bond selloff means for mortgages",
    "Tesla recalls 400,000 vehicles over a steering fault",
  ]) {
    assert.equal(staticGate(art({ title: t })).ok, true, t);
  }
});

test("the gate reads the description too, not only the title", () => {
  const g = staticGate(art({ title: "Markets wrap", description: "Here are 3 top stocks to buy now." }));
  assert.equal(g.ok, false);
  assert.equal(g.gate, "stock-commentary");
});

// ─── tooSimilar, recovered from 01638c7 ─────────────────────────────────────

const wordSet = (s) => new Set(_internals.norm(s).split(" ").filter(w => w.length > 4));

test("a near-identical headline under another masthead is caught", () => {
  const published = "Subsea cable faults traced to dragged anchors in shallow water";
  const candidate = "Dragged anchors traced as cause of subsea cable faults in shallow water";
  assert.equal(tooSimilar(candidate, [wordSet(published)]), true);
});

test("a genuinely different story is not caught", () => {
  const published = "Subsea cable faults traced to dragged anchors in shallow water";
  const candidate = "European Parliament adopts revised liability rules for high-risk systems";
  assert.equal(tooSimilar(candidate, [wordSet(published)]), false);
});

test("an empty or trivial headline is refused rather than passed", () => {
  assert.equal(tooSimilar("", [wordSet("anything at all here")]), true);
});

test("it is the SAME measure the source bundle used — recovered, not rewritten", () => {
  // A second, subtly different similarity measure is how the create-merge-split
  // treadmill started on the event graph. 60% content-word overlap, words > 4.
  const a = "the quick brown foxes jumped over the lazy sleeping hounds";
  assert.equal(tooSimilar(a, [wordSet(a)]), true);
  assert.equal(tooSimilar("completely unrelated vocabulary appearing nowhere", [wordSet(a)]), false);
});
