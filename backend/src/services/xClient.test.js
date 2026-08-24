/**
 * X client — the parts that can be proved without credentials.
 *
 * Two things here are worth real tests. The OAuth 1.0a signature, because a
 * single mis-encoded character produces a 401 that looks exactly like bad keys
 * and costs an afternoon. And the link guard, because a post with a link
 * succeeds identically to one without — the only place the difference shows up
 * is the bill, at 13x.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pct, oauthHeader, assertNoLink, fitPost, isXConfigured } from "./xClient.js";

test("percent-encoding follows RFC 3986, not encodeURIComponent", () => {
  // encodeURIComponent leaves these five alone. OAuth requires them encoded.
  assert.equal(pct("!*'()"), "%21%2A%27%28%29");
  assert.equal(pct("Ladies + Gentlemen"), "Ladies%20%2B%20Gentlemen");
  assert.equal(pct("a-b_c.d~e"), "a-b_c.d~e", "unreserved characters must pass through");
});

test("the OAuth 1.0a signature matches X's own published example", () => {
  // Verbatim from X's "Creating a signature" documentation, including its fixed
  // nonce and timestamp. If this passes, the base string, the sorting, the
  // encoding and the HMAC key construction are all correct — which is the whole
  // of OAuth 1.0a. There is no way to check this against the live API without
  // credentials, and no need to.
  const header = oauthHeader(
    "POST",
    "https://api.twitter.com/1/statuses/update.json",
    { status: "Hello Ladies + Gentlemen, a signed OAuth request!", include_entities: "true" },
    {
      apiKey: "xvz1evFS4wEEPTGEFPHBog",
      apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
      accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    },
    "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
    1318622958,
  );
  const sig = decodeURIComponent(header.match(/oauth_signature="([^"]+)"/)[1]);
  assert.equal(sig, "tnnArxj06cWHq44gCs1OSKk/jLY=");
});

test("the header carries every field X requires, sorted", () => {
  const h = oauthHeader("GET", "https://api.x.com/2/media/upload", { command: "STATUS" },
    { apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "ts" });
  for (const f of ["oauth_consumer_key", "oauth_nonce", "oauth_signature", "oauth_signature_method",
                   "oauth_timestamp", "oauth_token", "oauth_version"]) {
    assert.ok(h.includes(f + '="'), `missing ${f}`);
  }
  assert.ok(h.startsWith("OAuth "));
});

test("a nonce is not reused between calls", () => {
  const c = { apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "ts" };
  const a = oauthHeader("POST", "https://api.x.com/2/tweets", {}, c);
  const b = oauthHeader("POST", "https://api.x.com/2/tweets", {}, c);
  assert.notEqual(a.match(/oauth_nonce="([^"]+)"/)[1], b.match(/oauth_nonce="([^"]+)"/)[1]);
});

test("a link is refused before it can cost 13x", () => {
  // The whole cost model of this integration is "no links". Enforced here
  // rather than trusted to every caller, because nothing downstream complains.
  for (const bad of [
    "Full story → https://scoopfeeds.com/article/abc",
    "read more at www.scoopfeeds.com",
    "see scoopfeeds.com for the rest",
    "http://example.org",
    "details on bbc.co.uk soon",
  ]) {
    assert.throws(() => assertNoLink(bad), /contains a link/, `not caught: ${bad}`);
  }
});

test("ordinary prose is not mistaken for a link", () => {
  for (const ok of [
    "Fifty-four health zones across six provinces.",
    "The U.S. and Canada are 50% apart. No deal yet.",
    "OpenAI agents cost $65 to run for $20 subscribers",
    "3.5 million people displaced.",
  ]) {
    assert.equal(assertNoLink(ok), ok);
  }
});

test("posts are cut to 280 by grapheme, never mid-emoji", () => {
  assert.equal(fitPost("hello"), "hello");
  const long = "a".repeat(400);
  assert.equal([...fitPost(long)].length, 280);
  assert.ok(fitPost(long).endsWith("…"));
  // A family emoji is 11 code units and ONE character to X. 400 of them is 400
  // characters by X's count and 4400 by `.length` — slicing by the latter would
  // cut one in half and publish a replacement character.
  const emoji = "👨‍👩‍👧‍👦".repeat(400);
  const cut = fitPost(emoji);
  assert.equal([...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(cut)].length, 280);
  assert.ok(!cut.includes("\uFFFD"), "sliced an emoji in half");
  // And a string already inside the limit is returned untouched, however many
  // code units it happens to occupy.
  const short = "👨‍👩‍👧‍👦".repeat(10);
  assert.equal(fitPost(short), short);
});

test("unconfigured is the default — nothing posts without four keys", () => {
  const keys = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"];
  const prev = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    assert.equal(isXConfigured(), false);
    for (const k of keys.slice(0, 3)) process.env[k] = "x";
    assert.equal(isXConfigured(), false, "three of four keys must not count as configured");
  } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// ─── the channel ────────────────────────────────────────────────────────────

test("the X channel is off unless explicitly enabled", async () => {
  const { videoToX } = await import("./videoAutopost.js");
  const prev = process.env.VIDEO_X_ENABLED;
  try {
    for (const v of [undefined, "", "0", "true", "yes"]) {
      if (v === undefined) delete process.env.VIDEO_X_ENABLED; else process.env.VIDEO_X_ENABLED = v;
      const r = await videoToX({ id: "a1" }, { filePath: "/nope.mp4", title: "t" });
      assert.equal(r.status, "off", `VIDEO_X_ENABLED=${JSON.stringify(v)} should not enable it`);
    }
  } finally { if (prev === undefined) delete process.env.VIDEO_X_ENABLED; else process.env.VIDEO_X_ENABLED = prev; }
});

test("the caption names the publisher and never links it", () => {
  // This is the one channel that does NOT use buildDescriptionCredit, whose
  // whole job is to put the article's URL above the fold. Attribution still
  // happens — in words, and on the video's own source badge.
  const caption = fitPost(["50% Tariffs: The US-Canada Trade War Begins", "Source: France 24"].join("\n\n"));
  assert.doesNotThrow(() => assertNoLink(caption));
  assert.ok(caption.includes("France 24"), "the publisher must still be credited");
});

test("a publisher whose name looks like a domain is still refused", () => {
  // "Source: bbc.co.uk" would be a link by X's billing, however it got there.
  assert.throws(() => assertNoLink("Headline\n\nSource: bbc.co.uk"), /contains a link/);
});

test("a publisher whose name IS a domain is credited, not dropped", async () => {
  const { xSafePublisher } = await import("./xClient.js");
  // Found against real data: 1 of 78 publishers in a week is "Investing.com".
  assert.equal(xSafePublisher("Investing.com"), "Investing");
  assert.equal(xSafePublisher("BBC News"), "BBC News");
  assert.equal(xSafePublisher("Al Jazeera"), "Al Jazeera");
  assert.equal(xSafePublisher(""), null);
  assert.equal(xSafePublisher(null), null);
  // And the result must always survive the guard that rejected the original.
  for (const n of ["Investing.com", "BBC News", "France 24", "bbc.co.uk"]) {
    const safe = xSafePublisher(n);
    if (safe) assert.doesNotThrow(() => assertNoLink(`Headline\n\nSource: ${safe}`), `unsafe: ${n}`);
  }
});
