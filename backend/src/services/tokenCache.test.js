/**
 * tokenCache.test.js — the clock semantics of the shared freshness test.
 *
 * `now` is a parameter precisely so these can move the clock across expiry
 * without mocking Date, which keeps them working on every Node the repo builds
 * on rather than only where node:test's timer mocks exist.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { isTokenFresh, TOKEN_EXPIRY_SKEW_MS } from "./tokenCache.js";

const T0 = 1_700_000_000_000;
const tok = (expiresAt, accessToken = "ya29.abc") => ({ accessToken, expiresAt });

test("a token well inside its window is fresh", () => {
  assert.equal(isTokenFresh(tok(T0 + 3600_000), { now: T0 }), true);
});

test("ADVANCING THE CLOCK PAST expiresAt makes the same object stale", () => {
  // The one that matters. The object does not change; only `now` moves. A cache
  // that answers `if (_cached) return _cached` cannot tell these two apart.
  const t = tok(T0 + 3600_000);
  assert.equal(isTokenFresh(t, { now: T0 }), true);
  assert.equal(isTokenFresh(t, { now: T0 + 3600_000 + 1 }), false);
});

test("the skew retires a token BEFORE its true expiry", () => {
  // A token that dies mid-request has already failed. An upload is a resumable
  // PUT, so the margin covers the transfer, not just the round trip.
  const t = tok(T0 + TOKEN_EXPIRY_SKEW_MS + 1000);
  assert.equal(isTokenFresh(t, { now: T0 }), true);
  assert.equal(isTokenFresh(t, { now: T0 + 2000 }), false,
    "inside the skew window it must already be considered stale");
});

test("exactly at the skew boundary is stale, not fresh", () => {
  const t = tok(T0 + TOKEN_EXPIRY_SKEW_MS);
  assert.equal(isTokenFresh(t, { now: T0 }), false);
});

test("a missing expiry is NOT treated as 'never expires'", () => {
  // Guessing wrong here surfaces as an unattributable 401 much later. Clients
  // whose credentials genuinely have no expiry should not use this at all.
  assert.equal(isTokenFresh({ accessToken: "x" }, { now: T0 }), false);
  assert.equal(isTokenFresh({ accessToken: "x", expiresAt: null }, { now: T0 }), false);
  assert.equal(isTokenFresh({ accessToken: "x", expiresAt: "soon" }, { now: T0 }), false);
  assert.equal(isTokenFresh({ accessToken: "x", expiresAt: NaN }, { now: T0 }), false);
});

test("a missing or empty access token is never fresh", () => {
  assert.equal(isTokenFresh(null, { now: T0 }), false);
  assert.equal(isTokenFresh(undefined, { now: T0 }), false);
  assert.equal(isTokenFresh({ expiresAt: T0 + 3600_000 }, { now: T0 }), false);
  assert.equal(isTokenFresh({ accessToken: "", expiresAt: T0 + 3600_000 }, { now: T0 }), false);
});

// ─── The pattern, not the token ─────────────────────────────────────────────
//
// youtubeClient's expiry bug was found from a symptom; tiktokClient's identical
// one was found by looking for the SHAPE. tiktokClient has no cheap export to
// drive — uploadToTikTok is a multi-step publish — so its regression guard is
// here, at the source level, alongside youtube's.
//
// The files are NAMED rather than discovered, because a rule like "any client
// mentioning expiresAt must use isTokenFresh" has a real exception and would
// flag it: threadsClient's loadToken() must be able to return an EXPIRED token,
// since its refresh endpoint authenticates with the token being replaced. A
// discovered rule would push a correct client into the wrong shape. Add a file
// here when a client starts caching an expiring credential in module scope.

import { readFileSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const EXPIRING_TOKEN_CLIENTS = ["youtubeClient.js", "tiktokClient.js"];

for (const file of EXPIRING_TOKEN_CLIENTS) {
  test(`${file} expiry-checks its in-memory cache, not just the disk read`, () => {
    const src = readFileSync(path.join(HERE, file), "utf8");

    assert.match(src, /import \{[^}]*isTokenFresh[^}]*\} from "\.\/tokenCache\.js"/,
      `${file} caches an expiring credential and must share the one freshness test`);

    // The exact shape that shipped: a bare truthiness return of the module-scope
    // entry, which pins the first token this process ever fetched.
    const bare = /if\s*\(\s*_?cached\s*\)\s*return\s+_?cached\s*;/.exec(src);
    assert.equal(bare, null,
      `${file} returns its module-scope cache without checking expiry — this is the bug ` +
      `that made the worker 401 on every upload while a throwaway container succeeded. ` +
      `Use isTokenFresh(_cached).`);
  });
}
