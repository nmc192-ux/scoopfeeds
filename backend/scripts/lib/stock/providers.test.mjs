/**
 * providers.test.mjs — the ported provider clients.
 *
 * Run: cd backend && node --test "scripts/lib/stock/*.test.mjs"
 *
 * ⚠️ THE FIXTURES BELOW ARE NOT CAPTURED RESPONSES. The brief (§9) asks for
 * "a real captured Pexels/Pixabay response shape", and these are not that: the
 * egress proxy in the environment this was written in blocks both providers, so
 * no live response could be captured and no documented shape could be read. They
 * encode what the port EXPECTS, which makes them a regression net for the port's
 * own logic and nothing more. If the real payload differs, these tests will
 * happily keep passing while the tool fails — so re-capture them against a real
 * response as part of closing §2a, and treat the shape as unverified until then.
 *
 * What they DO cover honestly: given a payload of this shape, the highest-quality
 * rendition is selected; a Cloudflare interstitial and a 429 stop with a named
 * reason rather than a JSON parse error; and a payload missing what the port
 * needs produces a refusal, not an entry full of nulls.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  apiKeys, isCloudflareChallenge, makeKeyRotator, makeSearchCache, normalisePexels, normalisePixabay,
  pickPexelsRendition, pickPixabayRendition, ProviderError, searchPexels, searchPixabay,
} from "./providers.mjs";

// ─── Fixtures (UNVERIFIED — see the header) ─────────────────────────────────

const PEXELS_VIDEO = {
  id: 857195,
  width: 3840,
  height: 2160,
  duration: 14,
  url: "https://www.pexels.com/video/aerial-view-of-a-container-port-857195/",
  user: { id: 417, name: "Ruvim Miksanskiy" },
  video_files: [
    { id: 1, quality: "sd", file_type: "video/mp4", width: 640, height: 360, link: "https://player.example/sd.mp4" },
    { id: 2, quality: "hd", file_type: "video/mp4", width: 1920, height: 1080, link: "https://player.example/hd.mp4" },
    { id: 3, quality: "uhd", file_type: "video/mp4", width: 3840, height: 2160, link: "https://player.example/uhd.mp4" },
  ],
};

const PIXABAY_HIT = {
  id: 125,
  pageURL: "https://pixabay.com/videos/id-125/",
  duration: 12,
  tags: "container port, cranes, night",
  user: "Coverr-Free-Footage",
  videos: {
    large: { url: "https://cdn.example/large.mp4", width: 1920, height: 1080, size: 6000000 },
    medium: { url: "https://cdn.example/medium.mp4", width: 1280, height: 720, size: 3000000 },
    small: { url: "https://cdn.example/small.mp4", width: 640, height: 360, size: 1000000 },
    tiny: { url: "", width: 0, height: 0, size: 0 },
  },
};

/** A duck-typed Response — the house style for fetch stubs in this repo. */
const response = (body, { status = 200, contentType = "application/json" } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => (k.toLowerCase() === "content-type" ? contentType : null) },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

// ─── Rendition selection ────────────────────────────────────────────────────

test("the highest-resolution Pexels rendition wins, not the first or last listed", () => {
  const picked = pickPexelsRendition(PEXELS_VIDEO);
  assert.equal(picked.link, "https://player.example/uhd.mp4");
  assert.equal(picked.width, 3840);
});

test("Pexels renditions that are not mp4 are passed over", () => {
  const withMov = {
    ...PEXELS_VIDEO,
    video_files: [
      { id: 9, file_type: "video/quicktime", width: 4096, height: 2160, link: "https://player.example/big.mov" },
      { id: 2, file_type: "video/mp4", width: 1920, height: 1080, link: "https://player.example/hd.mp4" },
    ],
  };
  // The .mov is larger; it is still the wrong container to hand ffmpeg here.
  assert.equal(pickPexelsRendition(withMov).link, "https://player.example/hd.mp4");
});

test("the largest usable Pixabay rendition wins and empty ones are ignored", () => {
  const picked = pickPixabayRendition(PIXABAY_HIT);
  assert.equal(picked.url, "https://cdn.example/large.mp4");
  assert.equal(picked.width, 1920);
});

test("a result with no usable rendition yields null rather than a broken entry", () => {
  assert.equal(pickPexelsRendition({ video_files: [] }), null);
  assert.equal(pickPexelsRendition({}), null);
  assert.equal(pickPixabayRendition({ videos: {} }), null);
  assert.equal(normalisePexels({ id: 1, video_files: [] }), null);
});

// ─── Normalisation and provenance ───────────────────────────────────────────

test("a Pexels result carries its creator, source URL and licence through", () => {
  const n = normalisePexels(PEXELS_VIDEO);
  assert.equal(n.provider, "pexels");
  assert.equal(n.providerId, "857195", "the id is a STRING — the dedupe key is compared as one");
  assert.equal(n.creator, "Ruvim Miksanskiy");
  assert.equal(n.sourceUrl, PEXELS_VIDEO.url);
  assert.equal(n.license, "Pexels License");
  assert.equal(n.width, 3840);
  assert.equal(n.durationSec, 14);
  assert.equal(n.downloadUrl, "https://player.example/uhd.mp4");
});

test("Pixabay's comma-joined tag string becomes a real list", () => {
  const n = normalisePixabay(PIXABAY_HIT);
  assert.deepEqual(n.tags, ["container port", "cranes", "night"]);
  assert.equal(n.creator, "Coverr-Free-Footage");
  assert.equal(n.sourceUrl, "https://pixabay.com/videos/id-125/");
});

test("the normalised dimensions are the RENDITION's, not the result's headline pair", () => {
  // Pexels reports a top-level width/height that need not match the file we take.
  // Grading the headline pair while downloading a different rendition is how a
  // library ends up full of clips that are softer than the manifest claims.
  const hdOnly = { ...PEXELS_VIDEO, video_files: [PEXELS_VIDEO.video_files[1]] };
  const n = normalisePexels(hdOnly);
  assert.equal(hdOnly.width, 3840, "the result still claims UHD");
  assert.equal(n.width, 1920, "but the rendition we can actually download is HD");
  assert.equal(n.height, 1080);
});

// ─── Failure modes stop cleanly, with a named reason ────────────────────────

test("a Cloudflare interstitial is recognised as itself, not as broken JSON", () => {
  assert.equal(isCloudflareChallenge("<html><title>Just a moment...</title>", "text/html"), true);
  assert.equal(isCloudflareChallenge("<div id=cf-browser-verification>", "text/html"), true);
  assert.equal(isCloudflareChallenge('{"hits":[]}', "application/json"), false,
    "a JSON body is never a challenge, whatever words are in it");
});

test("a 429 stops the run with a named reason instead of hammering the free tier", async () => {
  const fetchImpl = async () => response("rate limited", { status: 429, contentType: "text/plain" });
  await assert.rejects(
    () => searchPixabay({ query: "ports", key: "k", fetchImpl }),
    (e) => {
      assert.ok(e instanceof ProviderError);
      assert.equal(e.reason, "rate-limited");
      assert.match(e.message, /429/);
      return true;
    }
  );
});

test("a Cloudflare challenge served to Pixabay reports the challenge, not a parse error", async () => {
  const fetchImpl = async () =>
    response("<html><title>Just a moment...</title></html>", { status: 403, contentType: "text/html" });
  await assert.rejects(
    () => searchPixabay({ query: "ports", key: "k", fetchImpl }),
    (e) => {
      assert.equal(e.reason, "cloudflare-challenge");
      return true;
    }
  );
});

test("a rejected key is reported as a key problem, not a network one", async () => {
  const fetchImpl = async () => response("Unauthorized", { status: 401, contentType: "text/plain" });
  await assert.rejects(
    () => searchPexels({ query: "ports", key: "bad", fetchImpl }),
    (e) => {
      assert.equal(e.reason, "unauthorized");
      return true;
    }
  );
});

test("a missing key refuses before reaching the network", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return response({ videos: [] }); };
  await assert.rejects(
    () => searchPexels({ query: "ports", key: null, fetchImpl }),
    (e) => { assert.equal(e.reason, "no-key"); return true; }
  );
  assert.equal(called, false, "no request should have been attempted");
});

test("a payload of the wrong shape is a refusal, not an empty result set", async () => {
  // An empty list and "the endpoint returned something we do not understand" must
  // not look the same — the second is how an unverified endpoint announces itself.
  const fetchImpl = async () => response({ unexpected: true });
  await assert.rejects(
    () => searchPexels({ query: "ports", key: "k", fetchImpl }),
    (e) => { assert.equal(e.reason, "bad-response"); return true; }
  );
});

test("a genuinely empty result set is NOT an error", async () => {
  const fetchImpl = async () => response({ videos: [] });
  assert.deepEqual(await searchPexels({ query: "nothing", key: "k", fetchImpl }), []);
});

// ─── Requests carry what the contract says they carry ───────────────────────

test("Pexels is asked for portrait explicitly and authorised by bare header", async () => {
  let seenUrl;
  let seenInit;
  const fetchImpl = async (url, init) => { seenUrl = url; seenInit = init; return response({ videos: [] }); };
  await searchPexels({ query: "container port", orientation: "portrait", key: "K123", fetchImpl });
  assert.equal(seenUrl.searchParams.get("orientation"), "portrait");
  assert.equal(seenUrl.searchParams.get("query"), "container port");
  assert.equal(seenInit.headers.Authorization, "K123", "no Bearer prefix — see endpoints.mjs");
});

test("Pixabay carries the key as a query parameter and asks for no orientation", async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return response({ hits: [] }); };
  await searchPixabay({ query: "cargo ship", key: "K456", fetchImpl });
  assert.equal(seenUrl.searchParams.get("key"), "K456");
  assert.equal(seenUrl.searchParams.get("q"), "cargo ship");
  assert.equal(seenUrl.searchParams.get("orientation"), null,
    "Pixabay video search has no orientation filter — dimensions decide instead");
});

test("wrapping a search in the repo's retry helper does not defeat the 429 stop", async () => {
  // The requirement is "stop-and-report on 429 rather than hammering" (§3a), and
  // stock-acquire wraps every search in withNetworkRetry. If that helper treated
  // a 429 as transient, the tool would retry into a provider that has already
  // said stop — so the composition is pinned here, not just the unit behaviour.
  const { withNetworkRetry } = await import("../../../src/services/httpRetry.js");
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return response("rate limited", { status: 429, contentType: "text/plain" });
  };
  await assert.rejects(
    () => withNetworkRetry(() => searchPexels({ query: "ports", key: "k", fetchImpl }),
      { label: "pexels", attempts: 3, baseDelayMs: 1 }),
    (e) => {
      assert.equal(e.reason, "rate-limited", "the ProviderError must survive the wrapper intact");
      return true;
    }
  );
  assert.equal(calls, 1, "a 429 must be requested exactly once");
});

// ─── Key rotation and caching ───────────────────────────────────────────────

test("a comma-separated key list rotates; a single key is simply reused", () => {
  const rotate = makeKeyRotator(apiKeys("a, b ,c"));
  assert.deepEqual([rotate(), rotate(), rotate(), rotate()], ["a", "b", "c", "a"]);
  const single = makeKeyRotator(apiKeys("only"));
  assert.deepEqual([single(), single()], ["only", "only"]);
  assert.equal(makeKeyRotator(apiKeys(""))(), null);
  assert.deepEqual(apiKeys(undefined), []);
});

test("an identical query is not sent twice in one run", async () => {
  const cache = makeSearchCache();
  let calls = 0;
  const run = async () => { calls++; return ["result"]; };
  assert.deepEqual(await cache("pexels:portrait:ports", run), ["result"]);
  assert.deepEqual(await cache("pexels:portrait:ports", run), ["result"]);
  assert.equal(calls, 1, "classes share query words and the free tiers are small");
  await cache("pexels:portrait:ships", run);
  assert.equal(calls, 2, "a different query still goes out");
});
