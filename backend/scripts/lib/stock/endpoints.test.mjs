/**
 * endpoints.test.mjs — the §2a record, pinned.
 *
 * Run: cd backend && node --test "scripts/lib/stock/*.test.mjs"
 *
 * These constants were verified against the providers' own documentation by a
 * human, off-container, on 27 Aug 2026 — and the verification caught a real
 * error: the first draft pointed at https://api.pexels.com/videos/search, the
 * path the docs mark for deprecation.
 *
 * A verified constant is only verified until someone edits it. These tests make
 * an edit visible: change a URL and the diff has to change an assertion that
 * says, in words, that it was checked against a doc page on a date. That is a
 * cheap prompt to go and re-read the page.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { assertEndpointsVerified, PEXELS, PIXABAY, verification, verifiedAgainstDocs } from "./endpoints.mjs";

test("§2a is closed, and the record says who closed it and when", () => {
  assert.equal(verifiedAgainstDocs, true);
  assert.equal(verification.by, "DrJ");
  assert.equal(verification.date, "2026-08-27");
  assert.match(verification.method, /off-container/,
    "the record must keep saying this was NOT verified by the authoring session");
  assert.doesNotThrow(() => assertEndpointsVerified());
});

test("the Pexels endpoint is the /v1/ path the docs name", () => {
  assert.equal(PEXELS.url, "https://api.pexels.com/v1/videos/search");
  assert.equal(PEXELS.doc, "https://www.pexels.com/api/documentation/#videos-search");
});

test("the deprecated Pexels path does not appear anywhere in the endpoint record", () => {
  // "Video endpoints are now available at https://api.pexels.com/v1/videos/. The
  //  https://api.pexels.com/videos/ endpoints will be deprecated in the future."
  // The old path is exactly what a port from someone else's client reintroduces.
  const serialised = JSON.stringify(PEXELS);
  assert.ok(!/api\.pexels\.com\/videos\//.test(serialised),
    "the deprecated https://api.pexels.com/videos/ path is back in the endpoint record");
});

test("the Pixabay endpoint and its auth style are as documented", () => {
  assert.equal(PIXABAY.url, "https://pixabay.com/api/videos/");
  assert.equal(PIXABAY.doc, "https://pixabay.com/api/docs/#api_search_videos");
  assert.match(PIXABAY.auth, /query parameter/);
});

test("the absence of a Pixabay orientation filter is recorded, not assumed", () => {
  // Image search has one; video search does not. Portrait selection is therefore
  // dimension-based, and that is a consequence of this fact rather than a choice.
  assert.equal(PIXABAY.hasOrientationFilter, false);
  assert.ok(!PIXABAY.params.includes("orientation"));
});

test("Pixabay's 24-hour cache requirement is recorded as a licence term", () => {
  // The cache in providers.mjs is compliance, not optimisation: the API terms
  // require that requests be cached for 24 hours and forbid systematic mass
  // downloads. Losing this constant is how it gets deleted as dead weight.
  assert.equal(PIXABAY.cacheHours, 24);
});

test("the rate limits are recorded in the units the docs use", () => {
  // Pexels is per HOUR, Pixabay is per 60 SECONDS. Confusing the two is how a
  // tool ends up hammering one provider while crawling for the other.
  assert.equal(PEXELS.rateLimit.perHour, 200);
  assert.equal(PEXELS.rateLimit.perMonth, 20000);
  assert.equal(PIXABAY.rateLimit.requests, 100);
  assert.equal(PIXABAY.rateLimit.perSeconds, 60);
});

test("Pexels rate-limit headers are recorded as absent on a 429", () => {
  // X-Ratelimit-* comes back on 2xx only. Nothing may plan a backoff around
  // headers that are missing exactly when the backoff would be needed — which is
  // part of why a 429 stops the run instead of waiting.
  assert.equal(PEXELS.rateLimit.headersOn429, false);
});

test("the documented request bounds are recorded", () => {
  assert.equal(PEXELS.perPageMax, 80);
  assert.equal(PIXABAY.perPageMin, 3);
  assert.equal(PIXABAY.perPageMax, 200);
  assert.equal(PIXABAY.queryMaxChars, 100);
});

test("every endpoint carries the doc URL it was checked against", () => {
  for (const [name, provider] of [["PEXELS", PEXELS], ["PIXABAY", PIXABAY]]) {
    assert.match(provider.doc, /^https:\/\//, `${name} must cite a doc URL (§2a)`);
    assert.match(provider.url, /^https:\/\//, `${name} must use https`);
  }
});
