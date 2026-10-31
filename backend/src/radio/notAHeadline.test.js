import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikePromo } from "./notAHeadline.js";

test("promos and calls to action are not headlines", () => {
  for (const t of [
    "Watch Latest Business News on Bloomberg",   // aired on 30 Oct 2026
    "Watch latest business news on Bloomberg",
    "Watch live coverage",
    "Watch Live",
    "Watch live: SpaceX launch",
    "Listen to the full episode",
    "Watch Trump's speech in full",
    "Stream the latest episodes now",
    "Latest Business News",
    "Top headlines on CNBC",
    "Today's news",
    "Breaking news this morning",
    "Markets wrap: live on Bloomberg TV",
    "Subscribe to our newsletter",
    "",
    null,
  ]) assert.equal(looksLikePromo(t), true, String(t));
});

test("real headlines stay, including ones that use the same words", () => {
  for (const t of [
    "Binance is trying to recover $6.3bn stolen in a hack linked to North Korea",
    "Watch: Rocket booster lands on drone ship",
    "Watch the moment the bridge collapses",
    "Bloomberg says it will cut 200 jobs in its TV division",
    "Fed's Musalem says more rate hikes will be needed soon to tame inflation",
    "Latest news on the Gaza ceasefire talks in Cairo",
    "Top Fed official warns on inflation",
    "CNN anchor leaves network after 20 years",
    "Live updates: Hurricane makes landfall in Florida",
    "Breaking: Earthquake strikes off Japan",
    "Streaming services lose subscribers as prices rise",
    "Watchdog fines bank over news leak",
  ]) assert.equal(looksLikePromo(t), false, t);
});

test("1 Nov: features with no news story behind them are not headlines", () => {
  for (const t of [
    "Pointed! Bloomberg's Weekly News Quiz For Risk-Takers",   // aired as a headline on 1 Nov 2026
    "The Atlantic's weekly news quiz",
    "Take our news quiz: how closely did you follow the week?",
    "Can you name every country that borders China?",
    "Test your knowledge of the year in tech",
    "Today's crossword answers",
    "Wordle hints for Sunday",
    "Your horoscope for the week",
    "The Morning Briefing: what you need to know",
    "Weekly Digest: the stories that mattered",
    "Podcast: The economics of tariffs",
    "Episode 214: Inside the Fed",
    "Best Black Friday deals on laptops",
    "Top 10 gifts for the holidays",
    "Amazon promo codes for November",
    "Five easy weeknight recipes",
    "Sponsored: How one company is changing logistics",
    "Photos of the week",
    "The week in pictures",
    "What to watch this weekend",
    "How to watch the Artemis launch",
  ]) assert.equal(looksLikePromo(t), true, t);
});

test("1 Nov: real stories that share a word with a feature stay", () => {
  for (const t of [
    "Fed officials signal patience ahead of the next rate decision",
    "Senate passes stopgap spending bill hours before shutdown",
    "Quarterly profit at Toyota falls on tariff costs",
    "Episcopal church elects first woman bishop in Ghana",
    "Puzzling drop in exports worries Beijing",
    "Supreme Court weighs case on podcasts' liability for defamation",
    "Bestselling author dies at 81",
    "Retailers brace for weaker holiday shopping season",
    "Watchdog fines bank over news leak",
  ]) assert.equal(looksLikePromo(t), false, t);
});
