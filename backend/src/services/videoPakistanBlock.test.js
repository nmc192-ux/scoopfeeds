/**
 * videoPakistanBlock.test.js — Rule 0 enforcement proof.
 *
 * The required fixture is the Geo News Bilawal/JAAC article from the
 * 2026-08-02 harness run. The contract these tests pin:
 *
 *   1. It is rejected at layer 1 (selection).
 *   2. Layers 2 and 3 would EACH catch it independently — i.e. with layer 1
 *      assumed absent, not merely as a chain.
 *   3. It trips multiple independent signal kinds, so no single term edit
 *      can quietly un-block it.
 *   4. There is no bypass: no env flag, no opts, no category shortcut.
 *   5. Over-blocking is correct behaviour and is asserted as such.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  scanTextForPakistan,
  pakistanMatches,
  isPakistanBlocked,
  filterAtSelection,
  checkPostGeneration,
  assertPublishAllowed,
  PakistanBlockError,
} from "./videoPakistanBlock.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

// The required fixture. Field values reconstructed from the 2026-08-02 harness
// run's identifying facts (Geo News · Bilawal · JAAC); the exact prod body is
// not needed because the contract is about the signals, which are here.
const GEO_BILAWAL_JAAC = {
  id: "fixture-geo-bilawal-jaac-2026-08-02",
  source_name: "Geo News",
  category: "pakistan",
  title: "Bilawal says PPP will resist JAAC in its current form",
  description: "PPP Chairman Bilawal Bhutto-Zardari addressed party workers on the proposed judicial appointments framework.",
  content: "Speaking in Karachi, Bilawal Bhutto-Zardari said the party would oppose the JAAC legislation in the National Assembly...",
  tags: "pakistan,politics,ppp",
};

const BENIGN = {
  id: "fixture-benign-eu-ai-act",
  source_name: "Reuters",
  category: "technology",
  title: "EU approves final text of updated AI liability rules",
  description: "The European Parliament voted to adopt revised liability provisions for high-risk AI systems.",
  content: "The vote in Strasbourg concludes a two-year negotiation between member states...",
  tags: "eu,ai,regulation",
};

// ─── The required fixture, layer by layer ───────────────────────────────────

test("layer 1: the Geo News Bilawal/JAAC article is rejected at selection", () => {
  const kept = filterAtSelection([GEO_BILAWAL_JAAC, BENIGN]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, BENIGN.id);
});

test("layer 2 catches it INDEPENDENTLY — as if layer 1 never ran", () => {
  // Handed straight to post-generation with a perfectly benign artifact:
  // the article rescan alone must block.
  const benignSpec = { slides: [{ t: "title", lines: [["AI RULES", "white"]], caption: "Europe finalises its liability rules." }] };
  const v = checkPostGeneration(GEO_BILAWAL_JAAC, [benignSpec]);
  assert.equal(v.blocked, true);
  assert.ok(v.matches.length > 0);
});

test("layer 3 catches it INDEPENDENTLY — assertPublishAllowed throws", () => {
  assert.throws(
    () => assertPublishAllowed(GEO_BILAWAL_JAAC, []),
    (err) => {
      assert.ok(err instanceof PakistanBlockError);
      assert.equal(err.name, "PakistanBlockError");
      assert.equal(err.articleId, GEO_BILAWAL_JAAC.id);
      assert.ok(err.matches.length > 0);
      return true;
    }
  );
});

test("the fixture trips MULTIPLE independent signal kinds — no single edit un-blocks it", () => {
  const matches = pakistanMatches(GEO_BILAWAL_JAAC);
  const kinds = new Set(matches.map(m => m.kind));
  // source (Geo News) + category (pakistan) + terms (bilawal, jaac, ppp, …)
  assert.ok(kinds.has("source"),   "source signal missing");
  assert.ok(kinds.has("category"), "category signal missing");
  assert.ok(kinds.has("term"),     "term signal missing");
  const signals = new Set(matches.map(m => m.signal));
  for (const expected of ["bilawal", "jaac", "ppp", "geo news", "pakistan"]) {
    assert.ok(signals.has(expected) || signals.has(`${expected}*`), `expected signal "${expected}" — got: ${[...signals].join(", ")}`);
  }
});

// ─── Independence of the layers from generated content ──────────────────────

test("layer 2 blocks on ARTIFACTS alone — a spec that surfaces Pakistan content from a clean-looking article", () => {
  // Article fields carry no signal; the generated spec does (a caption naming
  // Bilawal, a stat sourced to Geo News). Layer 2 must catch the artifact.
  const sneaky = { ...BENIGN, id: "fixture-artifact-drift" };
  const driftedSpec = {
    slides: [
      { t: "stat", value: 51, unit: "%", source: "Geo News", caption: "Bilawal announced the figure at a rally." },
    ],
  };
  const v = checkPostGeneration(sneaky, [driftedSpec]);
  assert.equal(v.blocked, true);
  assert.ok(v.matches.some(m => m.field.startsWith("artifact[")), "block must be attributed to the artifact");
});

test("layer 3 also scans artifacts", () => {
  assert.throws(
    () => assertPublishAllowed(BENIGN, ["Narration draft: as Bilawal told reporters..."]),
    PakistanBlockError
  );
});

// ─── Outlet field-scoping (2026-08-02: USC football false positive) ─────────

// Real-shape false positive: "the nation" appears in ordinary sports prose.
// Outlet identifiers are evidence in source_name, not in body text.
const USC_FOOTBALL = {
  id: "fixture-usc-football",
  source_name: "ESPN",
  category: "sports",
  title: "USC lands the nation's top quarterback recruit",
  description: "The commitment reshapes the recruiting board for the entire conference.",
  content: "The Trojans beat out half the nation for his signature. Coaches across the nation had tracked him since his sophomore year, and the dawn of the new signing period only intensified the race.",
  tags: "college football,recruiting",
};

test("the USC football story PASSES — 'the nation' in body text is English, not a masthead", () => {
  const v = isPakistanBlocked(USC_FOOTBALL);
  assert.equal(v.blocked, false, `unexpected matches: ${JSON.stringify(v.matches)}`);
  assert.equal(filterAtSelection([USC_FOOTBALL]).length, 1);
  assert.equal(checkPostGeneration(USC_FOOTBALL, [{ slides: [] }]).blocked, false);
  assert.doesNotThrow(() => assertPublishAllowed(USC_FOOTBALL, []));
});

test("the same outlet string in source_name DOES block", () => {
  const v = isPakistanBlocked({ ...USC_FOOTBALL, id: "fixture-nation-masthead", source_name: "The Nation" });
  assert.equal(v.blocked, true);
  assert.ok(v.matches.some(m => m.kind === "source" && m.signal === "the nation"));
});

test("outlet identifiers in ARTIFACTS are scoped to source-bearing keys", () => {
  // A caption mentioning "the nation" is prose → no block.
  const proseSpec = { slides: [{ t: "title", lines: [["RECRUITING", "white"]], caption: "The best quarterback in the nation picked USC." }] };
  assert.equal(checkPostGeneration(USC_FOOTBALL, [proseSpec]).blocked, false);

  // The same words in a stat card's `source` field → block.
  const sourcedSpec = { slides: [{ t: "stat", value: 5, source: "The Nation", caption: "Five stars in one class." }] };
  const v = checkPostGeneration(USC_FOOTBALL, [sourcedSpec]);
  assert.equal(v.blocked, true);
  assert.ok(v.matches.some(m => m.kind === "outlet" && m.field.includes(".source")));
});

test("an attribution card's outlet is treated as source-bearing", () => {
  const spec = { slides: [{ t: "attribution", outlet: "Dawn", headline: "A story", caption: "Based on Dawn reporting." }] };
  const v = checkPostGeneration(BENIGN, [spec]);
  assert.equal(v.blocked, true);
  assert.ok(v.matches.some(m => m.kind === "outlet" && m.signal === "dawn"));
});

test("the legacy plural sources-card shape is still caught", () => {
  // An artifact produced before the §3b rename must not slip past Rule 0.
  const spec = { slides: [{ t: "sources", items: [["Reuters", 4], ["Dawn", 2]], caption: "Two outlets covered this." }] };
  assert.equal(checkPostGeneration(BENIGN, [spec]).blocked, true);
});

test("the required fixture STILL blocks on all three layers after field-scoping", () => {
  assert.equal(filterAtSelection([GEO_BILAWAL_JAAC]).length, 0);
  assert.equal(checkPostGeneration(GEO_BILAWAL_JAAC, []).blocked, true);
  assert.throws(() => assertPublishAllowed(GEO_BILAWAL_JAAC, []), PakistanBlockError);
  // And still on more than one kind, so no single edit un-blocks it.
  const kinds = new Set(pakistanMatches(GEO_BILAWAL_JAAC).map(m => m.kind));
  assert.ok(kinds.size >= 3, `expected 3+ signal kinds, got ${[...kinds].join(", ")}`);
});

// ─── No bypass ──────────────────────────────────────────────────────────────

test("no env flag bypasses Rule 0 — D1's own override does nothing here", () => {
  const prev = process.env.VIDEO_ALLOW_PK_DOMESTIC;
  process.env.VIDEO_ALLOW_PK_DOMESTIC = "1";
  try {
    assert.equal(filterAtSelection([GEO_BILAWAL_JAAC]).length, 0);
    assert.equal(checkPostGeneration(GEO_BILAWAL_JAAC, []).blocked, true);
    assert.throws(() => assertPublishAllowed(GEO_BILAWAL_JAAC), PakistanBlockError);
  } finally {
    if (prev === undefined) delete process.env.VIDEO_ALLOW_PK_DOMESTIC;
    else process.env.VIDEO_ALLOW_PK_DOMESTIC = prev;
  }
});

test("no opts bypass — a force flag is ignored because no parameter exists to receive it", () => {
  // filterAtSelection takes one argument; anything else is discarded by the
  // language itself. Passing D1-style { force: true } changes nothing.
  const kept = filterAtSelection([GEO_BILAWAL_JAAC], { force: true });
  assert.equal(kept.length, 0);
});

test("no category shortcut — a 'world'-category Pakistan story is still blocked", () => {
  // D1 explicitly allowed this as globally relevant. Rule 0 blocks it.
  const global = {
    id: "fixture-global-category",
    source_name: "Reuters",
    category: "world",
    title: "Pakistan and India agree ceasefire along Line of Control",
    description: "Both militaries confirmed the agreement.",
  };
  const v = isPakistanBlocked(global);
  assert.equal(v.blocked, true);
  assert.equal(filterAtSelection([global]).length, 0);
});

// ─── Over-blocking is sanctioned ────────────────────────────────────────────

test("'dawn' in a headline no longer blocks — outlets are field-scoped (change 1)", () => {
  // This assertion INVERTED on 2026-08-02. It is not a narrowing of the term:
  // "Dawn" is still an absolute block in source_name. It is a correction of
  // where an outlet name is evidence at all — the same fix as the USC story.
  const solar = {
    id: "fixture-overblock-dawn",
    source_name: "Reuters",
    category: "science",
    title: "A new dawn for solar power as perovskite cells hit record efficiency",
  };
  assert.equal(isPakistanBlocked(solar).blocked, false);
  const fromDawn = { ...solar, id: "fixture-dawn-masthead", source_name: "Dawn" };
  const v = isPakistanBlocked(fromDawn);
  assert.equal(v.blocked, true);
  assert.ok(v.matches.some(m => m.kind === "source" && m.signal === "dawn"));
});

test("over-block is CORRECT: Indian Punjab and 'police nab suspect' both block", () => {
  assert.equal(isPakistanBlocked({ id: "x", title: "Punjabi harvest festival draws record crowds in Amritsar" }).blocked, true);
  assert.equal(isPakistanBlocked({ id: "y", title: "Police nab suspect in museum theft" }).blocked, true);
});

// ─── The benign path stays open ─────────────────────────────────────────────

test("a benign article passes all three layers", () => {
  assert.equal(isPakistanBlocked(BENIGN).blocked, false);
  assert.equal(filterAtSelection([BENIGN]).length, 1);
  assert.equal(checkPostGeneration(BENIGN, [{ slides: [] }]).blocked, false);
  assert.doesNotThrow(() => assertPublishAllowed(BENIGN, ["Plain narration about EU rules."]));
});

test("word boundaries hold — the matcher is broad, not sloppy", () => {
  // 'ary' must not fire inside ordinary words, 'isi' not inside 'crisis',
  // 'pti' not inside 'options'.
  const clean = { id: "z", title: "Canary Media covers the energy crisis and market options" };
  assert.equal(isPakistanBlocked(clean).blocked, false, JSON.stringify(pakistanMatches(clean)));
});

// ─── Determinism ────────────────────────────────────────────────────────────

test("the matcher is pure — identical input yields identical output", () => {
  const a = pakistanMatches(GEO_BILAWAL_JAAC);
  const b = pakistanMatches(GEO_BILAWAL_JAAC);
  assert.deepEqual(a, b);
  const s1 = scanTextForPakistan("Bilawal in Karachi");
  const s2 = scanTextForPakistan("Bilawal in Karachi");
  assert.deepEqual(s1, s2);
});
