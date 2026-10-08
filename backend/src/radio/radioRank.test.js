/**
 * radioRank.test.js — ScoopFeeds Radio ranking: multi-outlet beats single-outlet,
 * audience weights, and the caps (≤2 per publisher, ≤1 sport) across all slots.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { groupArticles, rankStories, pickSlots, attribution, jaccard, titleTokens, displayCategory } from "./radioRank.js";
import { weightOf, regionOf, isIndianOutlet } from "./sourceRegions.js";

const NOW = Date.UTC(2026, 9, 8, 15, 0, 0);
let n = 0;
const art = (title, source, extra = {}) => ({
  id: `a${++n}`, title, source_name: source, category: "international", credibility: 8,
  fetched_at: NOW - 10 * 60_000, ...extra,
});

test("audience weights: US 1.5, UK/EU 1.2, Gulf/ME 1.2, others and unknown 1.0", () => {
  assert.equal(weightOf("NPR News"), 1.5);
  assert.equal(weightOf("Bloomberg Markets"), 1.5);       // global-tagged, placed by override
  assert.equal(weightOf("BBC News"), 1.2);
  assert.equal(weightOf("Euronews"), 1.2);                // region "eu" in config
  assert.equal(weightOf("Al Jazeera"), 1.2);
  assert.equal(weightOf("Arab News"), 1.2);               // region "sa"
  assert.equal(weightOf("The Hindu"), 1.0);
  assert.equal(weightOf("Some Outlet Nobody Configured"), 1.0);
  assert.equal(regionOf("Some Outlet Nobody Configured"), "other");
  assert.equal(isIndianOutlet("The Hindu"), true);
  assert.equal(isIndianOutlet("BBC News"), false);
});

test("title grouping: same story from different outlets groups; different stories do not", () => {
  const a = titleTokens("Earthquake of magnitude 7.1 strikes off coast of Japan, tsunami warning issued");
  const b = titleTokens("Magnitude 7.1 earthquake strikes off Japan coast; tsunami warning issued - BBC News");
  const c = titleTokens("Fed holds interest rates steady as inflation cools");
  assert.ok(jaccard(a, b) >= 0.5, `expected same-story overlap ≥ 0.5, got ${jaccard(a, b)}`);
  assert.ok(jaccard(a, c) < 0.5);
});

test("RANKING: a story covered by several outlets beats one covered by a single outlet", () => {
  const multi = ["NPR News", "BBC News", "Al Jazeera"].map((s) =>
    art("Magnitude 7.1 earthquake strikes off Japan coast, tsunami warning issued", s));
  const single = [art("Small town opens new library after decade of fundraising", "NPR News", { fetched_at: NOW - 60_000 })];
  const ranked = rankStories(groupArticles([...single, ...multi]), { now: NOW });
  assert.equal(ranked[0].outlets.length, 3);
  assert.ok(ranked[0].score > ranked[1].score);
  assert.match(attribution(ranked[0].outlets), /^Reported by NPR News and (BBC News|Al Jazeera)$/);
});

test("RANKING: US-weighted coverage beats the same outlet count from elsewhere; recency breaks ties", () => {
  const us = ["NPR News", "CNBC"].map((s) => art("Senate passes stopgap spending bill to avert shutdown", s));
  const other = ["The Hindu", "Daily Nation"].map((s) => art("Monsoon floods displace thousands across southern districts", s));
  const ranked = rankStories(groupArticles([...other, ...us]), { now: NOW });
  assert.equal(ranked[0].lead.title, us[0].title);
  assert.equal(ranked[0].score, 3.0);
  assert.equal(ranked[1].score, 2.0);
});

test("RANKING: an outlet counts once per story however many items it files", () => {
  const flood = Array.from({ length: 6 }, () => art("Markets slide as oil prices jump on supply fears", "Investing.com"));
  const ranked = rankStories(groupArticles(flood), { now: NOW });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].score, 1.0);
});

test("CAPS: ten BBC Sport stories → at most 1 sport item and at most 2 BBC items across every slot", () => {
  const titles = ["Arsenal beat Chelsea in derby", "Djokovic wins Shanghai final", "England name squad for autumn tests",
    "Hamilton fastest in Austin practice", "Celtic sack manager after cup exit", "Ryder Cup captain announced",
    "Liverpool sign defender on loan", "Cricket: Root hits double century", "Boxing title fight set for December",
    "Wimbledon to trial new scheduling"];
  const sport = titles.map((t, i) => art(t, "BBC Sport", { category: "sports", fetched_at: NOW - i * 60_000 }));
  const news = ["Fed holds rates steady as inflation cools", "Wildfire forces evacuations in California hills",
    "EU agrees new rules for AI chatbots", "WHO approves malaria vaccine for wider use", "NASA delays moon lander test",
    "Apple unveils cheaper laptop line", "Oil prices climb on supply worries", "Senate passes stopgap spending bill",
    "Study links sleep loss to heart risk", "Volcano eruption grounds flights in Iceland"].map((t, i) =>
    art(t, ["CNBC", "LA Times", "Politico Europe", "WHO News", "NASA News", "The Verge", "MarketWatch", "The Hill",
      "STAT News", "Euronews"][i], {
      category: ["business", "local", "politics", "health", "science", "tech", "business", "politics", "health", "international"][i],
      fetched_at: NOW - 30 * 60_000,
    }));
  const ranked = rankStories(groupArticles([...sport, ...news]), { now: NOW });
  const { headline, also, music } = pickSlots(ranked);
  const all = [headline, ...also, ...music].filter(Boolean);
  assert.ok(all.filter((s) => s.sport).length <= 1, "more than one sport item aired");
  assert.ok(all.filter((s) => s.lead.source_name === "BBC Sport").length <= 2, "more than two BBC Sport items aired");
  const perPub = new Map();
  for (const s of all) perPub.set(s.lead.source_name, (perPub.get(s.lead.source_name) || 0) + 1);
  for (const [pub, c] of perPub) assert.ok(c <= 2, `${pub} appears ${c} times`);
  assert.equal(also.length, 5, `alsoThisHour has ${also.length} items`);
  assert.ok(music.length >= 4 && music.length <= 6, `music rotator has ${music.length} items`);
});

test("MUSIC: a sensitive (tragedy) story never goes in the music rotator", () => {
  const ranked = rankStories(groupArticles([
    art("Ferry disaster: dozens killed off coast", "BBC News"),
    ...["business", "tech", "health", "science", "politics"].map((c, i) =>
      art(`Unrelated ${c} story number ${i} about quarterly figures`, ["CNBC", "The Verge", "STAT News", "NASA News", "Politico"][i], { category: c })),
  ]), { now: NOW });
  ranked.find((s) => /Ferry/.test(s.lead.title)).sensitive = true;
  const { music } = pickSlots(ranked);
  assert.ok(music.every((s) => !s.sensitive));
});

test("display categories map onto the rotator's six", () => {
  assert.equal(displayCategory("computer-science"), "Tech");
  assert.equal(displayCategory("public-health"), "Health");
  assert.equal(displayCategory("environment"), "Science");
  assert.equal(displayCategory("whatever"), "World");
});

import { pickSlots as _pick, topicOf } from "./radioRank.js";
test("TOPIC CAP: at most one crypto item across headline + also + music", () => {
  const mk = (i, title, cat = "business") => ({ score: 10 - i, outlets: ["BBC News"], last: i, sport: false, sensitive: false, lead: { id: `x${i}`, title, category: cat, source_name: `Pub${i}` }, articles: [] });
  const ranked = [
    mk(0, "Bitcoin jumps past record high"), mk(1, "Ethereum rallies as ETF inflows grow"), mk(2, "Crypto exchange halts withdrawals"),
    mk(3, "Fed holds rates"), mk(4, "EU passes chip act", "politics"), mk(5, "Malaria vaccine approved", "health"),
    mk(6, "Moon lander delayed", "science"), mk(7, "Laptop line unveiled", "tech"), mk(8, "Floods hit region", "international"),
  ];
  const { headline, also, music } = _pick(ranked);
  const aired = [headline, ...also, ...music].filter(Boolean);
  assert.equal(aired.filter((s) => topicOf(s) === "crypto").length, 1);
});
