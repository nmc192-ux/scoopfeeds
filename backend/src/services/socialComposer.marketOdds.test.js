/**
 * #205 — market odds stay out of social captions while SITE_MARKET_ODDS is off.
 *
 * The site (#181) and the newsletter hide odds behind SITE_MARKET_ODDS; the Instagram
 * feed and Bluesky composers used to splice in socialCaptionEnricher's
 * "📊 Markets price this at N% … Source: Polymarket" line regardless. These tests pin
 * that the same switch now governs them, and that with odds hidden a market-bound
 * article's captions are exactly the no-market captions.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { composeAllPlatforms, _setRiCalloutForTest } from "./socialComposer.js";
import { realityIndexCallout } from "../realityIndex/generation/socialCaptionEnricher.js";
import { marketOddsEnabled } from "../config/marketOdds.js";

const HOUR = 60 * 60 * 1000;
const MARKET_LINE = "📊 Markets price this at 62% (market-implied probability, Polymarket).";

function article(over = {}) {
  return {
    id: "market-bound-article",
    title: "Senate panel advances health funding package",
    description: "The bill cleared committee with bipartisan support after weeks of negotiation.",
    category: "politics",
    source_name: "The Hill",
    published_at: Date.now() - 12 * HOUR,
    tags: JSON.stringify(["us-politics"]),
    ...over,
  };
}

function withOdds(value, fn) {
  const prev = process.env.SITE_MARKET_ODDS;
  if (value === undefined) delete process.env.SITE_MARKET_ODDS; else process.env.SITE_MARKET_ODDS = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.SITE_MARKET_ODDS; else process.env.SITE_MARKET_ODDS = prev;
  }
}

const marketText = /Polymarket|Markets price this|market-implied|Market YES moved/;

test.afterEach(() => _setRiCalloutForTest());

test("odds hidden (default): Instagram feed and Bluesky carry no market line for a market-bound article", () => {
  let calls = 0;
  _setRiCalloutForTest(() => { calls++; return MARKET_LINE; });
  for (const v of [undefined, "", "false", "1", "TRUE"]) {
    const out = withOdds(v, () => composeAllPlatforms(article()).platforms);
    assert.doesNotMatch(out.instagram_feed.caption, marketText, `instagram_feed with SITE_MARKET_ODDS=${v}`);
    assert.doesNotMatch(out.bluesky.caption, marketText, `bluesky with SITE_MARKET_ODDS=${v}`);
    assert.equal(out.instagram_feed.meta.realityIndex, "absent");
  }
  assert.equal(calls, 0, "the callout (and its DB read) is not even attempted while odds are hidden");
});

test("odds hidden: captions are byte-identical to an article with no market", () => {
  const noMarket = withOdds(undefined, () => { _setRiCalloutForTest(() => null); return composeAllPlatforms(article()); });
  const bound    = withOdds(undefined, () => { _setRiCalloutForTest(() => MARKET_LINE); return composeAllPlatforms(article()); });
  assert.deepEqual(bound.platforms, noMarket.platforms);
});

test("no market: captions are the same with odds on or off (nothing else changed)", () => {
  _setRiCalloutForTest(() => null);
  const off = withOdds(undefined, () => composeAllPlatforms(article()).platforms);
  const on  = withOdds("true", () => composeAllPlatforms(article()).platforms);
  assert.deepEqual(on, off);
});

test("odds on (stop-list item 6, DrJ only): the gate is what removed the line", () => {
  _setRiCalloutForTest(() => MARKET_LINE);
  const out = withOdds("true", () => composeAllPlatforms(article()).platforms);
  assert.match(out.instagram_feed.caption, /Markets price this at 62%/);
  assert.match(out.bluesky.caption, /Markets price this at 62%/);
});

test("other platforms never carry the callout", () => {
  _setRiCalloutForTest(() => MARKET_LINE);
  const out = withOdds("true", () => composeAllPlatforms(article()).platforms);
  for (const [name, p] of Object.entries(out)) {
    if (name === "instagram_feed" || name === "bluesky") continue;
    const text = JSON.stringify(p);
    assert.doesNotMatch(text, marketText, `${name} must not carry market odds`);
  }
});

test("the enricher itself returns null while odds are hidden, for any caller", () => {
  withOdds(undefined, () => assert.equal(realityIndexCallout("any-article"), null));
  withOdds("false", () => assert.equal(realityIndexCallout("any-article"), null));
});

test("marketOddsEnabled: only the literal \"true\" turns odds on", () => {
  assert.equal(marketOddsEnabled({}), false);
  assert.equal(marketOddsEnabled({ SITE_MARKET_ODDS: "1" }), false);
  assert.equal(marketOddsEnabled({ SITE_MARKET_ODDS: "TRUE" }), false);
  assert.equal(marketOddsEnabled({ SITE_MARKET_ODDS: "true" }), true);
});
