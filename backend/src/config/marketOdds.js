/**
 * The one switch for market odds on every reader-facing and outward surface (#181, #205).
 *
 * SITE_MARKET_ODDS hides Reality Index / Truth Gap / market-implied probabilities on the
 * site (/api/site-config), in the newsletter (digest.js), and in social captions
 * (socialComposer.js → socialCaptionEnricher.js). Off unless literally "true".
 * Turning it on is stop-list item 6 (docs/engine/full-throttle.md): DrJ only.
 *
 * Read at call time, so tests can toggle it and a restart picks up a change.
 */
export function marketOddsEnabled(env = process.env) {
  return env.SITE_MARKET_ODDS === "true";
}
