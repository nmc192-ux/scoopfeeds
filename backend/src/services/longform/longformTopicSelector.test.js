/**
 * longformTopicSelector.test.js — which story becomes a film (#78).
 *
 * The DAL call and the demand lookup are both injected, so nothing here needs
 * a database or a network. The behaviours that matter:
 *
 *   1. machine events (no articles) can never be selected — they have consumed
 *      selection windows twice in production
 *   2. demand is a HARD gate: a topic that fails is skipped with a reason,
 *      never forced through
 *   3. corroboration outranks volume — ten articles from one wire is one story
 *   4. demand is checked only AFTER depth, because each check costs round trips
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  depthScore, depthGate, demandPhrases, demandGate, selectLongformTopics,
} from "./longformTopicSelector.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_780_000_000_000;

/** A qualifying long-form event. */
const ev = (over = {}) => ({
  id: "e1", slug: "strait", title: "Strait of Hormuz closed", summary: "A real summary.",
  articles: 20, sources: 7, n_keys: 10, idf_mass: 30,
  first_activity_at: NOW - 10 * DAY, last_activity_at: NOW - DAY,
  ...over,
});

const demandOk = async (phrase) => ({ seed: phrase, direct: 8, breadth: 20, top: ["a", "b"] });
const demandDead = async (phrase) => ({ seed: phrase, direct: 0, breadth: 1, top: [] });

// ── Depth ───────────────────────────────────────────────────────────────────

test("a machine event (no articles) can never pass the depth gate", () => {
  // USGS/NOAA events carry no articles and have consumed selection windows
  // twice in production. listQualifyingEvents already excludes them; this
  // pins that a second guard exists here even if that query ever loosens.
  assert.match(depthGate(ev({ articles: 0, sources: 0 })), /only 0 articles/);
});

test("a single-source story is refused however voluminous", () => {
  assert.match(depthGate(ev({ articles: 40, sources: 1 })),
    /only 1 distinct sources.*single-source stories are not filmable/s);
});

test("a one-day flash is refused — durability is the long-form question", () => {
  const flash = ev({ first_activity_at: NOW - 3600_000, last_activity_at: NOW });
  assert.match(depthGate(flash, { now: NOW }), /a flash, not a story/);
});

test("a qualifying event passes", () => {
  assert.equal(depthGate(ev(), { now: NOW }), null);
});

test("corroboration outranks volume in the score", () => {
  const wireFlood = ev({ articles: 60, sources: 2 });
  const corroborated = ev({ articles: 12, sources: 9 });
  assert.ok(depthScore(corroborated) > depthScore(wireFlood),
    "nine sources on twelve articles must beat two sources on sixty");
});

// ── Demand ──────────────────────────────────────────────────────────────────

test("demand phrases are searchable, not headlines verbatim", () => {
  const p = demandPhrases(ev({ title: "Iran Declares: Strait CLOSED!" }));
  assert.ok(p[0] && !/[:!]/.test(p[0]), "punctuation stripped for a search phrase");
  assert.equal(p[0], "iran declares strait closed");
});

test("DEMAND IS A HARD GATE — a dead phrase is skipped, never forced", async () => {
  const g = await demandGate(ev(), { demandFn: demandDead, min: 6 });
  assert.equal(g.ok, false);
  assert.match(g.reason, /nobody searches for this/);
});

test("the best-performing phrase wins, not the first", async () => {
  const e = ev({ title: "obscure headline", keys: ["strait of hormuz"] });
  const g = await demandGate(e, {
    demandFn: async (p) => ({ breadth: p === "strait of hormuz" ? 30 : 2, top: [] }),
    min: 6,
  });
  assert.equal(g.ok, true);
  assert.equal(g.phrase, "strait of hormuz", "the entity phrasing beat the headline");
});

test("a failing demand lookup does not crash selection", async () => {
  const g = await demandGate(ev(), { demandFn: async () => { throw new Error("network"); } });
  assert.equal(g.ok, false);
  assert.match(g.reason, /every demand lookup failed/);
});

// ── Selection ───────────────────────────────────────────────────────────────

test("selects the deepest qualifying topic and reports why the rest lost", async () => {
  const events = [
    ev({ id: "shallow", title: "thin", articles: 3, sources: 1 }),
    ev({ id: "deep", title: "deep story", articles: 30, sources: 9 }),
    ev({ id: "flash", title: "flash", first_activity_at: NOW - 3600_000, last_activity_at: NOW }),
  ];
  const { selected, rejected } = await selectLongformTopics({
    listEvents: () => events, demandFn: demandOk, limit: 1, now: NOW,
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, "deep");
  assert.equal(selected[0].demand.breadth, 20);
  const reasons = rejected.map((r) => `${r.id}: ${r.reason}`).join("\n");
  assert.match(reasons, /shallow: only 3 articles/);
  assert.match(reasons, /flash: .*a flash, not a story/);
});

test("an already-filmed event is never selected twice", async () => {
  const { selected, rejected } = await selectLongformTopics({
    listEvents: () => [ev({ id: "done" })],
    demandFn: demandOk, alreadyFilmed: new Set(["done"]), now: NOW,
  });
  assert.equal(selected.length, 0);
  assert.match(rejected[0].reason, /already filmed/);
});

test("demand is checked only for topics that already passed depth", async () => {
  // Each demand check is several network round trips; a shallow story would be
  // skipped regardless of how well it searches.
  const checked = [];
  await selectLongformTopics({
    listEvents: () => [
      ev({ id: "shallow", title: "thin", articles: 2, sources: 1 }),
      ev({ id: "deep", title: "deep" }),
    ],
    demandFn: async (p) => { checked.push(p); return { breadth: 20, top: [] }; },
    limit: 1, now: NOW,
  });
  assert.equal(checked.length, 1, "only the deep candidate was demand-checked");
  assert.match(checked[0], /deep/);
});

test("nothing qualifying returns empty rather than lowering the bar", async () => {
  const { selected } = await selectLongformTopics({
    listEvents: () => [ev({ articles: 2, sources: 1 })], demandFn: demandOk, now: NOW,
  });
  assert.deepEqual(selected, [], "an empty cycle is correct; a forced film is not");
});
