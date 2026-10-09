/**
 * radioGrouping.test.js — embedding-based story grouping, the entity rule, one-story-one-slot,
 * and the hard-news music filter. Namespace import on purpose: each test fails on its own
 * (not the whole file) against a build that predates these exports.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "./radioRank.js";

const NOW = Date.UTC(2026, 9, 12, 15, 0, 0);
let n = 0;
const art = (title, source, extra = {}) => ({
  id: `g${++n}`, title, source_name: source, category: "international", credibility: 8,
  fetched_at: NOW - 10 * 60_000, ...extra,
});
// unit vector at angle θ from e0 in the (e0,e1) plane → cosine to e0 is cos θ
const DIMS = 768;
const vecAt = (cos) => { const v = new Float64Array(DIMS); v[0] = cos; v[1] = Math.sqrt(1 - cos * cos); return v; };
const e0 = () => { const v = new Float64Array(DIMS); v[0] = 1; return v; };

const DIESEL_A = "Trump agrees deal with Putin for Russia to release diesel";
const DIESEL_B = "Trump announces deal with Putin to release Russian diesel";

// Two headlines about one event that share NO words, so only a vector can join them.
const FUEL_A = "Kremlin and Washington reach accord on fuel exports";
const FUEL_B = "Oil products shipments cleared under Moscow-US pact";

test("GROUPING: cosine ≥ 0.82 joins differently-worded stories; Jaccard alone does not", () => {
  const a = art(FUEL_A, "NPR News"), b = art(FUEL_B, "BBC News");
  assert.ok(R.jaccard(R.titleTokens(a.title), R.titleTokens(b.title)) < R.JACCARD_MIN, "fixture must defeat Jaccard");
  assert.ok(!R.sameStoryTitles(a.title, b.title), "fixture must defeat the entity rule");
  const vectors = new Map([[a.id, e0()], [b.id, vecAt(0.9)]]);
  assert.equal(R.groupArticles([a, b], { mode: "cosine", vectors }).length, 1);
  assert.equal(R.groupArticles([a, b], { mode: "jaccard", vectors }).length, 2, "jaccard mode must ignore vectors");
  const far = new Map([[a.id, e0()], [b.id, vecAt(0.7)]]);
  assert.equal(R.groupArticles([a, b], { mode: "cosine", vectors: far }).length, 2, "cosine 0.7 < 0.82 stays apart");
  assert.equal(R.COSINE_MIN, 0.82);
});

test("GROUPING: in cosine mode a pair with an unembedded member falls back to title Jaccard", () => {
  const e = art("Fed holds interest rates steady as inflation cools", "CNBC");
  const same = art("Fed holds interest rates steady, inflation cools", "Reuters");          // no vector, high Jaccard
  const other = art("Volcano eruption grounds flights across Iceland", "Euronews");           // no vector, unrelated
  const vectors = new Map([[e.id, e0()]]);
  const groups = R.groupArticles([e, same, other], { mode: "cosine", vectors });
  assert.equal(groups.length, 2);
  assert.ok(groups.some((g) => g.length === 2 && g.includes(g.find((x) => x.id === e.id)) && g.some((x) => x.id === same.id)));
});

test("MODE: auto uses cosine only at ≥ 80% coverage; RADIO_GROUP_MODE forces either way; junk means auto", () => {
  assert.equal(R.chooseGroupMode(100, 79, "auto").mode, "jaccard");
  assert.equal(R.chooseGroupMode(100, 80, "auto").mode, "cosine");
  assert.equal(R.chooseGroupMode(100, 80, "auto").coverage, 0.8);
  assert.equal(R.chooseGroupMode(100, 0, "cosine").mode, "cosine");
  assert.equal(R.chooseGroupMode(100, 100, "jaccard").mode, "jaccard");
  assert.equal(R.chooseGroupMode(0, 0, "auto").mode, "jaccard", "no candidates is not coverage");
  assert.equal(R.groupModeSetting("COSINE"), "cosine");
  assert.equal(R.groupModeSetting("jaccard"), "jaccard");
  assert.equal(R.groupModeSetting("banana"), "auto");
  assert.equal(R.groupModeSetting(undefined), "auto");
  assert.equal(R.groupModeSetting(""), "auto");
});

test("ENTITY RULE: rewordings Jaccard misses are merged; same names, different news are not", () => {
  const a = DIESEL_A;
  const b = "Trump announces deal with Putin, a landmark diplomatic breakthrough after months of talks, to release Russian diesel exports";
  assert.ok(R.jaccard(R.titleTokens(a), R.titleTokens(b)) < R.JACCARD_MIN, "fixture must defeat Jaccard");
  assert.equal(R.sameStoryTitles(a, b), true);
  const x = art(a, "NPR News"), y = art(b, "BBC News");
  assert.equal(R.groupArticles([x, y], { mode: "jaccard" }).length, 1, "entity rule applies in jaccard mode too");
  assert.equal(R.sameStoryTitles("Trump meets Putin in Alaska summit", "Trump threatens Putin with new sanctions"), false);
  assert.equal(R.sameStoryTitles("Fed holds rates", "Fed cuts rates"), false, "too few key terms to merge");
  assert.equal(R.sameStoryTitles("Diesel prices rise as supply falls", "Diesel prices rise as winter nears"), false, "no shared name");
});

test("NO DUPLICATES ON AIR: the two diesel headlines never take two slots", () => {
  const mk = (i, title, source, cat = "international") => ({ score: 10 - i, outlets: [source, "Other"], last: 100 - i, sport: false, sensitive: false,
    lead: { id: `d${i}`, title, category: cat, source_name: source }, articles: [{ id: `d${i}`, title, category: cat, source_name: source }] });
  const ranked = [
    mk(0, DIESEL_A, "NPR News"), mk(1, DIESEL_B, "BBC News"),
    mk(2, "Fed holds rates", "CNBC", "business"), mk(3, "EU passes chip act", "Politico", "politics"), mk(4, "Malaria vaccine approved", "WHO", "health"),
    mk(5, "Moon lander delayed", "NASA", "science"), mk(6, "Laptop line unveiled", "The Verge", "tech"), mk(7, "Floods hit coastal region", "Euronews"),
  ];
  const { headline, also, music } = R.pickSlots(ranked);
  const aired = [headline, ...also, ...music].filter(Boolean);
  assert.equal(aired.filter((s) => /diesel/i.test(s.lead.title)).length, 1, aired.map((s) => s.lead.title).join(" | "));
  assert.equal(headline.lead.title, DIESEL_A, "the higher-ranked copy is the one that airs");
});

test("NO DUPLICATES ON AIR: cosine ≥ 0.82 between stories with unrelated wording also blocks the second slot", () => {
  const story = (i, title, vec) => { const a = { id: `c${i}`, title, category: "international", source_name: `Pub${i}`, _vec: vec };
    return { score: 10 - i, outlets: [`Pub${i}`, "Other"], last: 100 - i, sport: false, sensitive: false, lead: a, articles: [a] }; };
  const ranked = [story(0, FUEL_A, e0()), story(1, FUEL_B, vecAt(0.9)), story(2, "Volcano eruption grounds flights across Iceland", vecAt(0.1)),
    story(3, "WHO approves malaria vaccine for wider use", vecAt(0.2)), story(4, "NASA delays moon lander test", vecAt(0.3))];
  const { headline, also, music } = R.pickSlots(ranked);
  const titles = [headline, ...also, ...music].filter(Boolean).map((s) => s.lead.title);
  assert.equal(titles.filter((t) => t === FUEL_A || t === FUEL_B).length, 1, titles.join(" | "));
});

// ── music = hard news ──────────────────────────────────────────────────────
const HN_PAPER = "Reciprocal sum of prime-prefix-free numbers converges, paper argues";
const STARGATE = "Amazon's Stargate series is back in development with WandaVision creator";

test("MUSIC INELIGIBLE: the Hacker News paper and the Gizmodo Stargate item", () => {
  const hn = R.rankStories(R.groupArticles([art(HN_PAPER, "Hacker News", { category: "tech" })]), { now: NOW })[0];
  const gz = R.rankStories(R.groupArticles([art(STARGATE, "Gizmodo", { category: "tech" })]), { now: NOW })[0];
  assert.equal(R.musicIneligible(hn), true);
  assert.equal(R.musicIneligible(gz), true);
  assert.equal(R.musicIneligibleReason(hn), "aggregator");
  assert.equal(R.musicIneligibleReason(gz), "entertainment");
  // academic wording alone, from a non-aggregator, single source
  const ac = R.rankStories(R.groupArticles([art("New proof shows sum converges, paper argues", "Quanta Magazine", { category: "science" })]), { now: NOW })[0];
  assert.equal(R.musicIneligibleReason(ac), "academic");
  // ordinary hard news is eligible
  const ok = R.rankStories(R.groupArticles([art("Fed holds interest rates steady as inflation cools", "CNBC", { category: "business" })]), { now: NOW })[0];
  assert.equal(R.musicIneligible(ok), false);
});

test("MUSIC: the paper and the Stargate item never reach the rotator, even when they rank first", () => {
  const hard = ["Fed holds interest rates steady as inflation cools|business", "EU passes sweeping chip act|politics", "WHO approves malaria vaccine for wider use|health",
    "NASA delays crewed moon lander test|science", "Wildfire forces evacuations across hills|international", "Chipmaker unveils new data-centre processor|tech"];
  const rows = [art(HN_PAPER, "Hacker News", { category: "tech" }), art(STARGATE, "Gizmodo", { category: "tech" })];
  hard.forEach((h, i) => { const [t, c] = h.split("|"); rows.push(art(t, ["CNBC", "Politico", "WHO News", "NASA News", "LA Times", "The Verge"][i], { category: c })); rows.push(art(t, ["MarketWatch", "Euronews", "STAT News", "Space.com", "Reuters World", "Wired"][i], { category: c })); });
  const ranked = R.rankStories(R.groupArticles(rows), { now: NOW });
  // make the two junk items outrank everything, so only the filter can keep them out
  for (const s of ranked) if (s.outlets.length < 2) s.score = 99;
  ranked.sort((a, b) => b.score - a.score);
  const { music } = R.pickSlots(ranked, { alsoCount: 0 });
  const titles = music.map((s) => s.lead.title);
  assert.ok(!titles.includes(HN_PAPER) && !titles.includes(STARGATE), titles.join(" | "));
  assert.ok(music.length >= 4, `rotator should still fill from hard news, got ${music.length}`);
});

test("MUSIC: stories with ≥ 2 outlets are chosen before single-source ones; a quiet hour is short, not padded with junk", () => {
  const multi = ["Fed holds interest rates steady as inflation cools|business", "EU passes sweeping chip act|politics"].flatMap((h, i) => {
    const [t, c] = h.split("|"); return [art(t, ["CNBC", "Politico"][i], { category: c }), art(t, ["MarketWatch", "Euronews"][i], { category: c })]; });
  const singles = ["Volcano eruption grounds flights across Iceland|international", "Researchers unveil battery that charges in minutes|science", "City council approves new bus lanes|local"]
    .map((h, i) => { const [t, c] = h.split("|"); return art(t, ["Euronews", "Nature News", "Local Voice"][i], { category: c }); });
  const junk = [art(HN_PAPER, "Hacker News", { category: "tech" }), art(STARGATE, "Gizmodo", { category: "tech" })];
  const ranked = R.rankStories(R.groupArticles([...singles, ...junk, ...multi]), { now: NOW });
  for (const s of ranked) if (s.outlets.length < 2) s.score = 99;                  // singles outrank the multi-outlet stories
  ranked.sort((a, b) => b.score - a.score);
  const { music } = R.pickSlots(ranked, { alsoCount: 0 });
  const firstSingle = music.findIndex((s) => s.outlets.length < 2);
  const lastMulti = music.map((s) => s.outlets.length >= 2).lastIndexOf(true);
  assert.ok(lastMulti >= 1, "both multi-outlet stories aired");
  assert.ok(firstSingle === -1 || firstSingle > lastMulti, `single-source before multi-outlet: ${music.map((s) => `${s.outlets.length}:${s.lead.title}`).join(" | ")}`);
  assert.ok(music.every((s) => s.lead.title !== HN_PAPER && s.lead.title !== STARGATE));
  assert.equal(music.length, 5, "2 multi-outlet + 3 eligible single-source; the 2 ineligible are left out, not used as padding");
});
