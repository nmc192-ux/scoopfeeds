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
