/**
 * Intake is the first gate, and its failure mode would be silent: a parser that
 * quietly labelled everything "unknown" would let candidates with no rights lane
 * into the ledger, where the next phase would assume somebody upstream had
 * checked. So the refusals get as much attention here as the matches.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePostUrl, PLATFORMS, FETCH_CLOSED_PLATFORMS,
  requiresPosterSuppliedFile, IntakeRefusedError,
} from "./incidentIntake.js";

/** node:assert's throws() returns undefined; these tests inspect the refusal. */
function caught(fn, Type) {
  try { fn(); } catch (err) {
    if (Type) assert.ok(err instanceof Type, `expected ${Type.name}, got ${err?.name}: ${err?.message}`);
    return err;
  }
  assert.fail("expected a throw, got none");
}

test("every named platform has at least one URL shape that parses to it", () => {
  // Without this, a platform could sit in PLATFORMS with no matcher behind it —
  // named in the docs, unreachable in practice.
  const samples = {
    bluesky:   "https://bsky.app/profile/alice.bsky.social/post/3kabc",
    mastodon:  "https://mastodon.social/@alice/109252123456789012",
    reddit:    "https://www.reddit.com/r/pics/comments/abc123/a_slug_here/",
    x:         "https://x.com/alice/status/1234567890",
    instagram: "https://www.instagram.com/reel/Cx1y2z3/",
    tiktok:    "https://www.tiktok.com/@alice/video/7300000000000000000",
    youtube:   "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  };
  assert.deepEqual(
    Object.keys(samples).sort(), [...PLATFORMS].sort(),
    "PLATFORMS and the sample set have drifted apart"
  );
  for (const [platform, url] of Object.entries(samples)) {
    assert.equal(parsePostUrl(url).platform, platform, `${url} should parse as ${platform}`);
  }
});

// ─── Canonicalisation: the dedupe is only real if variants collapse ──────────

test("twitter.com and x.com, any case, any tracking params, are one candidate", () => {
  const variants = [
    "https://x.com/alice/status/1234567890",
    "https://twitter.com/alice/status/1234567890",
    "https://www.twitter.com/alice/status/1234567890?s=20&t=abcdef",
    "https://mobile.x.com/Alice/status/1234567890",
    "https://m.x.com/ALICE/status/1234567890#anchor",
  ];
  const canon = variants.map((v) => parsePostUrl(v).canonicalUrl);
  assert.equal(
    new Set(canon).size, 1,
    `these should collapse to one post_url but produced: ${[...new Set(canon)].join(" | ")}`
  );
  assert.equal(canon[0], "https://x.com/alice/status/1234567890");
});

test("a reddit slug is decoration — two slugs for one post collapse", () => {
  const a = parsePostUrl("https://www.reddit.com/r/pics/comments/abc123/a_slug/");
  const b = parsePostUrl("https://reddit.com/r/pics/comments/abc123/a_completely_different_slug/?utm_source=x");
  assert.equal(a.canonicalUrl, b.canonicalUrl);
});

test("youtu.be, /shorts/ and /watch?v= are one video", () => {
  const canon = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
  ].map((u) => parsePostUrl(u).canonicalUrl);
  assert.equal(new Set(canon).size, 1, `variants did not collapse: ${[...new Set(canon)].join(" | ")}`);
});

test("two genuinely different posts do NOT collapse", () => {
  // The mirror of the tests above: over-eager canonicalisation would silently
  // merge distinct candidates, which loses one of them.
  const a = parsePostUrl("https://x.com/alice/status/1111111111").canonicalUrl;
  const b = parsePostUrl("https://x.com/alice/status/2222222222").canonicalUrl;
  const c = parsePostUrl("https://x.com/bob/status/1111111111").canonicalUrl;
  assert.equal(new Set([a, b, c]).size, 3);
});

// ─── Poster identity ────────────────────────────────────────────────────────

test("the handle is taken from the URL where the URL carries it", () => {
  assert.equal(parsePostUrl("https://x.com/AliceX/status/1").posterHandle, "alicex");
  assert.equal(parsePostUrl("https://www.tiktok.com/@AliceT/video/7300000000000000000").posterHandle, "alicet");
  assert.equal(
    parsePostUrl("https://bsky.app/profile/alice.bsky.social/post/3k").posterHandle,
    "alice.bsky.social"
  );
});

test("a mastodon handle is fully qualified — a bare @user is ambiguous across instances", () => {
  const a = parsePostUrl("https://mastodon.social/@alice/109252123456789012");
  const b = parsePostUrl("https://infosec.exchange/@alice/109252123456789012");
  assert.equal(a.posterHandle, "alice@mastodon.social");
  assert.equal(b.posterHandle, "alice@infosec.exchange");
  assert.notEqual(a.canonicalUrl, b.canonicalUrl, "same @user on two instances is two people");
});

test("where the URL does not carry the poster, the handle is null rather than guessed", () => {
  for (const url of [
    "https://www.reddit.com/r/pics/comments/abc123/slug/",
    "https://www.instagram.com/p/Cx1y2z3/",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  ]) {
    assert.equal(parsePostUrl(url).posterHandle, null, `${url} must not invent a handle`);
  }
});

// ─── Media type is stated, never assumed ────────────────────────────────────

test("media type is only claimed where the URL actually states it", () => {
  assert.equal(parsePostUrl("https://www.tiktok.com/@a/video/7300000000000000000").mediaType, "video");
  assert.equal(parsePostUrl("https://www.instagram.com/reel/Cx1y2z3/").mediaType, "video");
  assert.equal(parsePostUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ").mediaType, "video");
  // An Instagram /p/ may be a photo, a carousel or a video. Unknown is correct.
  assert.equal(parsePostUrl("https://www.instagram.com/p/Cx1y2z3/").mediaType, "unknown");
  assert.equal(parsePostUrl("https://x.com/a/status/1").mediaType, "unknown");
  assert.equal(parsePostUrl("https://bsky.app/profile/a.b/post/3k").mediaType, "unknown");
});

// ─── Refusals ───────────────────────────────────────────────────────────────

test("an unrecognised host is refused, not stored as unknown", () => {
  const err = caught(() => parsePostUrl("https://some-random-blog.example/post/42"), IntakeRefusedError);
  assert.equal(err.reason, "unknown-platform");
  assert.match(err.message, /lane/i, "the refusal should explain why an unnamed lane is refused");
});

test("a profile page, a bare host and a search page are not posts", () => {
  for (const url of [
    "https://x.com/alice",
    "https://x.com/alice/status/not-a-number",
    "https://bsky.app/profile/alice.bsky.social",
    "https://www.tiktok.com/@alice",
    "https://www.reddit.com/r/pics/",
    "https://www.youtube.com/",
    "https://www.instagram.com/alice/",
  ]) {
    assert.throws(() => parsePostUrl(url), IntakeRefusedError, `${url} should not parse as a post`);
  }
});

test("link shorteners are refused with the reason, not silently followed", () => {
  for (const url of ["https://vm.tiktok.com/ZMabc/", "https://t.co/abc123", "https://redd.it/abc123"]) {
    const err = caught(() => parsePostUrl(url), IntakeRefusedError);
    assert.equal(err.reason, "shortener", `${url} should be refused as a shortener`);
  }
});

test("garbage, empty input and non-web schemes are refused distinctly", () => {
  assert.equal(caught(() => parsePostUrl(""), IntakeRefusedError).reason, "empty");
  assert.equal(caught(() => parsePostUrl("   "), IntakeRefusedError).reason, "empty");
  assert.equal(caught(() => parsePostUrl(null), IntakeRefusedError).reason, "empty");
  assert.equal(caught(() => parsePostUrl("not a url at all"), IntakeRefusedError).reason, "unparseable");
  assert.equal(caught(() => parsePostUrl("file:///etc/passwd"), IntakeRefusedError).reason, "bad-protocol");
  assert.equal(caught(() => parsePostUrl("javascript:alert(1)"), IntakeRefusedError).reason, "bad-protocol");
});

test("the mastodon shape does not swallow every /@handle/ path on the web", () => {
  // The numeric status id is what keeps this matcher from claiming vanity URLs.
  assert.throws(() => parsePostUrl("https://example.com/@alice/about"), IntakeRefusedError);
  assert.throws(() => parsePostUrl("https://example.com/@alice/123/extra"), IntakeRefusedError);
  assert.throws(() => parsePostUrl("https://example.com/@alice"), IntakeRefusedError);
});

// ─── The fetch-lane fact, kept beside the parser ────────────────────────────

test("the closed-fetch platforms are exactly the ones grounding found closed", () => {
  assert.deepEqual([...FETCH_CLOSED_PLATFORMS].sort(), ["instagram", "tiktok", "x", "youtube"]);
  for (const p of FETCH_CLOSED_PLATFORMS) assert.ok(requiresPosterSuppliedFile(p), p);
  // Bluesky, Mastodon and Reddit are the open lanes the repo already calls.
  for (const p of ["bluesky", "mastodon", "reddit"]) {
    assert.equal(requiresPosterSuppliedFile(p), false, `${p} is an open lane`);
  }
});

test("a closed fetch lane does not stop a candidate existing — it only changes acquisition", () => {
  // The distinction the engine must never lose: we may record and verify an X
  // post; we just may not take the file ourselves.
  const parsed = parsePostUrl("https://x.com/alice/status/1234567890");
  assert.equal(parsed.platform, "x");
  assert.ok(requiresPosterSuppliedFile(parsed.platform));
});

test("the URL as pasted is preserved alongside the canonical one", () => {
  const pasted = "https://twitter.com/alice/status/1234567890?s=20";
  const parsed = parsePostUrl(pasted);
  assert.equal(parsed.sourceUrl, pasted);
  assert.notEqual(parsed.sourceUrl, parsed.canonicalUrl);
});
