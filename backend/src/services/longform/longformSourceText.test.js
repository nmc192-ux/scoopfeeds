/**
 * longformSourceText.test.js — the corpus ladder and the candidate walk (#78).
 *
 * The fetcher is injected, so every rule runs offline. The properties that
 * matter, in DrJ's framing: THE LOOP MUST NOT GO QUIET because the top story
 * has thin sources — a thin topic loses to the next candidate, never kills
 * the cycle, and stays eligible for when its story has grown.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  assembleSourceCorpus, makeSourceGate, distinctSourcesFirst,
  MIN_SOURCE_CHARS, MIN_CORPUS_SOURCES, TRANCHES,
} from "./longformSourceText.js";
import { selectLongformTopics } from "./longformTopicSelector.js";

/** Distinct long bodies — real articles differ; wire copies are made explicitly. */
// WORDS MUST BE LONG ENOUGH TO JUDGE. textSimilarity's content-word set
// ignores short tokens (its own docstring warns that a phrase with no word
// over four characters cannot be judged), so synthetic bodies built from
// 4-char tokens silently disable the wire-copy dedup they are meant to test.
const body = (seed, chars = 3000) => {
  const words = [];
  let x = seed;
  for (let i = 0; words.join(" ").length < chars; i++) {
    x = (x * 48271) % 2147483647;
    words.push(`storyword${(x % 9973)}${i % 9 === 0 ? "." : ""}`);
  }
  return `Article ${seed}. ` + words.join(" ");
};
const art = (i, over = {}) => ({
  title: `Story ${i}`, source_name: `Source${i}`, url: `https://s${i}/a`, content: "teaser", ...over });

// ── Ordering ────────────────────────────────────────────────────────────────

test("distinct sources are fetched before a second article from any one source", () => {
  const out = distinctSourcesFirst([
    art(1, { source_name: "Reuters" }), art(2, { source_name: "Reuters" }),
    art(3, { source_name: "AP" }), art(4, { source_name: "BBC" }),
  ]);
  assert.deepEqual(out.map((a) => a.source_name).slice(0, 3), ["Reuters", "AP", "BBC"],
    "one from each source first — corroboration is what the depth gate selected for");
});

// ── The ladder ──────────────────────────────────────────────────────────────

test("the ladder stops as soon as the floor is met — no wasted fetches", async () => {
  let fetches = 0;
  const r = await assembleSourceCorpus({
    articles: Array.from({ length: 40 }, (_, i) => art(i)),
    fetchFullText: async (a) => { fetches++; return { text: body(Number(a.title.slice(6)) + 1), origin: "fetched" }; },
    floor: 8000,
  });
  assert.equal(r.ok, true);
  assert.ok(r.totalChars >= 8000);
  assert.ok(fetches <= 4, `met the floor in ${fetches} fetches — must not fetch all 40`);
});

test("the ladder WIDENS through tranches when early articles are thin", async () => {
  // First 12 articles are teasers; the riches sit deeper in the list.
  const r = await assembleSourceCorpus({
    articles: Array.from({ length: 40 }, (_, i) => art(i)),
    fetchFullText: async (a) => {
      const i = Number(a.title.slice(6));
      return i < 12 ? { text: "thin teaser" } : { text: body(i + 1) };
    },
    floor: 8000,
  });
  assert.equal(r.ok, true, "widening past the first tranche found the rich articles");
  assert.equal(r.thin, 12, "the thin ones are counted, not silently dropped");
});

test("WIRE COPIES ARE DEDUPED — forty copies of one story are one source", async () => {
  const wire = body(7, 4000);
  const r = await assembleSourceCorpus({
    articles: Array.from({ length: 10 }, (_, i) => art(i)),
    fetchFullText: async () => ({ text: wire }),
    floor: 8000,
  });
  assert.equal(r.ok, false, "ten copies of a 4k story must NOT clear an 8k floor");
  assert.equal(r.fetched, 1);
  assert.equal(r.duplicates, 9);
  assert.match(r.reason, /9 wire duplicate\(s\)/);
});

test("a failed fetch falls back to stored content and never aborts the ladder", async () => {
  const r = await assembleSourceCorpus({
    articles: [art(1, { content: body(1, 4500) }), art(2)],
    fetchFullText: async (a) => {
      if (a.title === "Story 1") throw new Error("timeout");
      return { text: body(2, 4500) };
    },
    floor: 8000, minSources: 2,   // this test is about fetch-fallback, not the source floor
  });
  assert.equal(r.ok, true, "one dead fetch must not sink a topic whose other sources are fine");
});

test("the failure reason says the topic STAYS ELIGIBLE — thin today, rich tomorrow", async () => {
  const r = await assembleSourceCorpus({
    articles: [art(1)], fetchFullText: async () => ({ text: body(1, 1000) }), floor: 8000 });
  assert.match(r.reason, /stays eligible and may be richer next cycle/);
});

test("what the prompts consume is attributed, and the grounding text is the raw corpus", async () => {
  const r = await assembleSourceCorpus({
    articles: [art(1, { source_name: "Reuters", title: "The Strait Closes" })],
    fetchFullText: async () => ({ text: body(3, 9000) }), floor: 8000 });
  assert.deepEqual(r.sources, ["Reuters — The Strait Closes"]);
  assert.ok(r.sourceText.startsWith("Article 3."), "the grounding screen checks figures against this");
});

// ── THE WALK: a thin topic loses to the next candidate, never the cycle ─────

test("THE CYCLE DOES NOT GO QUIET: a thin top candidate loses to the next one", async () => {
  const events = [
    { id: "thin", slug: "thin", title: "Deep but thin sources", summary: "s",
      articles: 30, sources: 9, first_activity_at: 0, last_activity_at: 10 * 86400000 },
    { id: "rich", slug: "rich", title: "Slightly shallower but rich", summary: "s",
      articles: 20, sources: 8, first_activity_at: 0, last_activity_at: 10 * 86400000 },
  ];
  const { selected, rejected } = await selectLongformTopics({
    listEvents: () => events,
    demandFn: async () => ({ breadth: 30, top: [] }),
    sourceGate: async (ev) => ev.id === "thin"
      ? { ok: false, reason: "source corpus is 2000 chars (floor 8000)" }
      : { ok: true, corpus: { sources: ["S — t"], sourceText: "text", totalChars: 9000 } },
    limit: 1, now: 11 * 86400000,
  });
  assert.equal(selected.length, 1, "the cycle still produced a topic");
  assert.equal(selected[0].id, "rich", "the WALK: rank 2 wins when rank 1 cannot be grounded");
  assert.ok(selected[0].sourceCorpus, "the corpus rides on the topic so nothing fetches twice");
  assert.match(rejected.find((r) => r.id === "thin").reason, /floor 8000/);
});

test("only when the WHOLE shortlist fails does selection come up empty", async () => {
  const events = [1, 2, 3].map((i) => ({
    id: `e${i}`, slug: `e${i}`, title: `T${i}`, summary: "s",
    articles: 20, sources: 8, first_activity_at: 0, last_activity_at: 10 * 86400000 }));
  const { selected, rejected } = await selectLongformTopics({
    listEvents: () => events,
    demandFn: async () => ({ breadth: 30, top: [] }),
    sourceGate: async () => ({ ok: false, reason: "thin" }),
    limit: 1, now: 11 * 86400000,
  });
  assert.equal(selected.length, 0);
  assert.equal(rejected.length, 3, "every candidate was TRIED — the cycle did not stop at the first");
});

test("without a sourceGate, selection behaves exactly as before", async () => {
  const events = [{ id: "e", slug: "e", title: "T", summary: "s",
    articles: 20, sources: 8, first_activity_at: 0, last_activity_at: 10 * 86400000 }];
  const { selected } = await selectLongformTopics({
    listEvents: () => events, demandFn: async () => ({ breadth: 30, top: [] }),
    limit: 1, now: 11 * 86400000,
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].sourceCorpus, undefined);
});

// ── The gate factory ────────────────────────────────────────────────────────

test("makeSourceGate refuses an event whose articles cannot even be listed", async () => {
  const gate = makeSourceGate({ fetchArticles: async () => [], fetchFullText: async () => ({ text: "" }) });
  const r = await gate({ title: "T" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no articles could be listed/);
});

test("defaults are sane and env-tunable", () => {
  assert.equal(MIN_SOURCE_CHARS(), 8000);
  assert.deepEqual([...TRANCHES], [12, 24, 40]);
  process.env.LONGFORM_MIN_SOURCE_CHARS = "12000";
  try { assert.equal(MIN_SOURCE_CHARS(), 12000); }
  finally { delete process.env.LONGFORM_MIN_SOURCE_CHARS; }
});

test("ONE LONG ARTICLE CANNOT CLEAR THE FLOOR ALONE — sources measure trust", async () => {
  // Found on the first real run: a single 9,940-char OpenAI blog post met the
  // char floor by itself and the ladder stopped — selecting a topic whose
  // entire grounding was one party's own account of events.
  const r = await assembleSourceCorpus({
    articles: [art(1, { source_name: "OpenAI Blog" })],
    fetchFullText: async () => ({ text: body(1, 12000) }),
    floor: 8000, minSources: 3,
  });
  assert.equal(r.ok, false, "12k chars from one source is one account, not a corpus");
  assert.equal(r.distinctSources, 1);
  assert.match(r.reason, /one party's account is not a corpus/);
});

test("the ladder keeps fetching past the char floor until sources are met too", async () => {
  let fetches = 0;
  const r = await assembleSourceCorpus({
    articles: [art(1), art(2), art(3), art(4)],
    fetchFullText: async (a) => { fetches++; return { text: body(Number(a.title.slice(6)) + 1, 9000) }; },
    floor: 8000, minSources: 3,
  });
  assert.equal(r.ok, true);
  assert.equal(r.distinctSources, 3, "kept going past the char floor to reach three sources");
  assert.equal(fetches, 3, "and stopped the moment BOTH floors were met");
});

test("MIN_CORPUS_SOURCES is env-tunable and floors at 1", () => {
  assert.equal(MIN_CORPUS_SOURCES(), 3);
  process.env.LONGFORM_MIN_CORPUS_SOURCES = "5";
  try { assert.equal(MIN_CORPUS_SOURCES(), 5); }
  finally { delete process.env.LONGFORM_MIN_CORPUS_SOURCES; }
});
