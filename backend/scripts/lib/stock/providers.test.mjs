/**
 * providers.test.mjs — the ported provider clients.
 *
 * Run: cd backend && node --test "scripts/lib/stock/*.test.mjs"
 *
 * ⚠️ THE FIXTURES BELOW ARE DOC-DERIVED, NOT LIVE-CAPTURED. They are built from
 * the example payloads published in the providers' own documentation, read
 * off-container by DrJ on 27 Aug 2026 (the authoring session cannot reach either
 * host). That is a real improvement on the previous draft, which encoded only
 * what the port expected — but it is still not a captured response, and a doc
 * example can lag or simplify the live payload.
 *
 * STILL TO DO: re-capture these from a real response after the first acceptance
 * run, and replace these fixtures with what actually came back.
 *
 * The traps below are the documented ones, and each has its own test because
 * each would produce a WORKING tool that quietly does the wrong thing:
 *   - Pexels "quality" is not resolution: a 1280×720 and a 4096×2160 file are
 *     both quality "hd" in the docs' own example.
 *   - a Pexels "hls" entry carries width: null and height: null.
 *   - Pixabay returns `large` even when there is no large version, with an empty
 *     url and size 0 — the key's presence proves nothing.
 *   - Pixabay has no top-level width/height; dimensions are per-rendition only.
 *   - Pixabay's `user` is a username STRING; Pexels' is an object.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  apiKeys, isCloudflareChallenge, makeKeyRotator, makeSearchCache, normalisePexels, normalisePixabay,
  pickPexelsRendition, pickPixabayRendition, ProviderError, searchPexels, searchPixabay,
} from "./providers.mjs";

// ─── Fixtures (UNVERIFIED — see the header) ─────────────────────────────────

/**
 * Pexels video object. NOTE the deliberate ordering: the `hls` entry comes first
 * with null dimensions, the first "hd" entry is only 1280×720, and the largest
 * file — also "hd" — is LAST. A selector that trusts `quality` or takes the first
 * match picks 720p here while a 4K file sits in the same array.
 */
const PEXELS_VIDEO = {
  id: 857195,
  width: 4096,
  height: 2160,
  duration: 14,
  url: "https://www.pexels.com/video/aerial-view-of-a-container-port-857195/",
  image: "https://images.pexels.com/videos/857195/free-video-857195.jpg",
  user: { id: 417, name: "Ruvim Miksanskiy", url: "https://www.pexels.com/@digitech" },
  video_files: [
    { id: 1, quality: "hls", file_type: "video/mp4", width: null, height: null, fps: null, link: "https://player.example/stream.m3u8" },
    { id: 2, quality: "hd", file_type: "video/mp4", width: 1280, height: 720, fps: 25, link: "https://player.example/hd-720.mp4" },
    { id: 3, quality: "sd", file_type: "video/mp4", width: 640, height: 360, fps: 25, link: "https://player.example/sd-360.mp4" },
    { id: 4, quality: "hd", file_type: "video/mp4", width: 4096, height: 2160, fps: 25, link: "https://player.example/hd-4k.mp4" },
  ],
  video_pictures: [{ id: 1, picture: "https://images.pexels.com/pic-0.png", nr: 0 }],
};

/** Pixabay video hit. `user` is a string, and there is no top-level width/height. */
const PIXABAY_HIT = {
  id: 125,
  pageURL: "https://pixabay.com/videos/id-125/",
  type: "film",
  tags: "container port, cranes, night",
  duration: 12,
  videos: {
    large: { url: "https://cdn.example/large.mp4", width: 3840, height: 2160, size: 24000000, thumbnail: "https://cdn.example/large.jpg" },
    medium: { url: "https://cdn.example/medium.mp4", width: 1920, height: 1080, size: 6000000, thumbnail: "https://cdn.example/medium.jpg" },
    small: { url: "https://cdn.example/small.mp4", width: 1280, height: 720, size: 3000000, thumbnail: "https://cdn.example/small.jpg" },
    tiny: { url: "https://cdn.example/tiny.mp4", width: 960, height: 540, size: 1000000, thumbnail: "https://cdn.example/tiny.jpg" },
  },
  views: 4462, downloads: 1464, likes: 18, comments: 0,
  user_id: 1281706, user: "Coverr-Free-Footage",
  userImageURL: "https://cdn.pixabay.com/user/2017/user.jpg",
};

/** The documented degenerate case: `large` present, but empty. */
const PIXABAY_HIT_NO_LARGE = {
  ...PIXABAY_HIT,
  id: 126,
  videos: {
    ...PIXABAY_HIT.videos,
    large: { url: "", width: 0, height: 0, size: 0, thumbnail: "" },
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

test("the highest-resolution Pexels rendition wins — `quality` is NOT resolution", () => {
  // THE TRAP. In the docs' own example a 1280x720 file and a 4096x2160 file are
  // BOTH quality "hd". Ranking "hd" over "sd" and taking the first match yields
  // 720p while a 4K file sits two entries further down the same array.
  const picked = pickPexelsRendition(PEXELS_VIDEO);
  assert.equal(picked.link, "https://player.example/hd-4k.mp4");
  assert.equal(picked.width, 4096);

  const firstHd = PEXELS_VIDEO.video_files.find((f) => f.quality === "hd");
  assert.equal(firstHd.width, 1280, "the fixture must keep a smaller 'hd' entry ahead of the big one");
  assert.notEqual(picked.id, firstHd.id, "picking the first 'hd' is exactly the bug this guards");
});

test("an hls entry is skipped — its width and height are null", () => {
  // Number(null) is 0, so the dimension filter would drop it anyway; it is also
  // excluded by name, and a manifest row of width 0 must never be possible.
  const hlsOnly = { ...PEXELS_VIDEO, video_files: [PEXELS_VIDEO.video_files[0]] };
  assert.equal(pickPexelsRendition(hlsOnly), null, "an hls-only result yields nothing usable");
  assert.notEqual(pickPexelsRendition(PEXELS_VIDEO).quality, "hls");
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

test("the largest usable Pixabay rendition wins", () => {
  const picked = pickPixabayRendition(PIXABAY_HIT);
  assert.equal(picked.url, "https://cdn.example/large.mp4");
  assert.equal(picked.width, 3840);
});

test("a Pixabay hit with an EMPTY large falls back instead of downloading nothing", () => {
  // THE TRAP. When no large version exists the key is still returned, with an
  // empty url and size 0. Reading videos.large.url unconditionally yields "",
  // and the download silently fetches nothing.
  assert.equal(PIXABAY_HIT_NO_LARGE.videos.large.url, "", "the key is present but empty");
  const picked = pickPixabayRendition(PIXABAY_HIT_NO_LARGE);
  assert.equal(picked.url, "https://cdn.example/medium.mp4");
  assert.equal(picked.width, 1920);

  const n = normalisePixabay(PIXABAY_HIT_NO_LARGE);
  assert.equal(n.downloadUrl, "https://cdn.example/medium.mp4");
  assert.ok(n.width > 0 && n.height > 0, "a zero-dimension entry must never reach the manifest");
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
  assert.equal(n.width, 4096);
  assert.equal(n.durationSec, 14);
  assert.equal(n.downloadUrl, "https://player.example/hd-4k.mp4");
});

test("Pixabay's comma-joined tag string becomes a real list", () => {
  const n = normalisePixabay(PIXABAY_HIT);
  assert.deepEqual(n.tags, ["container port", "cranes", "night"]);
  assert.equal(n.sourceUrl, "https://pixabay.com/videos/id-125/");
});

test("provenance is read from the right place for each provider", () => {
  // Pixabay's `user` is a username STRING and the source is pageURL; Pexels'
  // `user` is an OBJECT and the source is `url`. Reading user.name from a
  // Pixabay hit yields undefined, and an unattributable clip is refused at the
  // manifest — so this would surface as a confusing acquisition failure.
  assert.equal(typeof PIXABAY_HIT.user, "string");
  assert.equal(typeof PEXELS_VIDEO.user, "object");
  assert.equal(normalisePixabay(PIXABAY_HIT).creator, "Coverr-Free-Footage");
  assert.equal(normalisePexels(PEXELS_VIDEO).creator, "Ruvim Miksanskiy");
});

test("Pixabay dimensions come from the rendition — there is no top-level pair", () => {
  assert.equal(PIXABAY_HIT.width, undefined, "the documented hit carries no top-level width");
  assert.equal(PIXABAY_HIT.height, undefined);
  const n = normalisePixabay(PIXABAY_HIT);
  assert.equal(n.width, 3840, "so the dimensions must come from the chosen rendition");
  assert.equal(n.height, 2160);
});

test("the normalised dimensions are the RENDITION's, not the result's headline pair", () => {
  // Pexels reports a top-level width/height that need not match the file we take.
  // Grading the headline pair while downloading a different rendition is how a
  // library ends up full of clips that are softer than the manifest claims.
  const hdOnly = { ...PEXELS_VIDEO, video_files: [PEXELS_VIDEO.video_files[1]] };
  const n = normalisePexels(hdOnly);
  assert.equal(hdOnly.width, 4096, "the result still claims 4K at the top level");
  assert.equal(n.width, 1280, "but the rendition we can actually download is 720p");
  assert.equal(n.height, 720);
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

test("Pexels goes to the /v1/ path, not the deprecated one", async () => {
  // The first draft of endpoints.mjs used https://api.pexels.com/videos/search,
  // which the docs mark for deprecation. That near-miss is what the §2a gate
  // caught, and this pins the corrected path so it cannot drift back.
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return response({ videos: [] }); };
  await searchPexels({ query: "ports", key: "k", fetchImpl });
  assert.equal(seenUrl.origin + seenUrl.pathname, "https://api.pexels.com/v1/videos/search");
});

test("Pexels is asked for portrait 4K up front and authorised by bare header", async () => {
  let seenUrl;
  let seenInit;
  const fetchImpl = async (url, init) => { seenUrl = url; seenInit = init; return response({ videos: [] }); };
  await searchPexels({ query: "container port", orientation: "portrait", size: "large", key: "K123", fetchImpl });
  assert.equal(seenUrl.searchParams.get("orientation"), "portrait");
  assert.equal(seenUrl.searchParams.get("size"), "large", "provider-side filtering is what saves the quota");
  assert.equal(seenUrl.searchParams.get("query"), "container port");
  assert.equal(seenInit.headers.Authorization, "K123", "no Bearer prefix — see endpoints.mjs");
});

test("Pexels per_page is clamped to the documented maximum", async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return response({ videos: [] }); };
  await searchPexels({ query: "ports", perPage: 500, key: "k", fetchImpl });
  assert.equal(seenUrl.searchParams.get("per_page"), "80");
});

test("Pixabay carries the key as a query parameter and asks for no orientation", async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return response({ hits: [] }); };
  await searchPixabay({ query: "cargo ship", minHeight: 2160, key: "K456", fetchImpl });
  assert.equal(seenUrl.searchParams.get("key"), "K456");
  assert.equal(seenUrl.searchParams.get("q"), "cargo ship");
  assert.equal(seenUrl.searchParams.get("min_height"), "2160", "the 4K pass filters provider-side");
  assert.equal(seenUrl.searchParams.get("video_type"), "film");
  assert.equal(seenUrl.searchParams.get("safesearch"), "true");
  assert.equal(seenUrl.searchParams.get("orientation"), null,
    "confirmed 2026-08-27: video search has no orientation filter — dimensions decide instead");
});

test("an over-long Pixabay query is refused rather than silently truncated", async () => {
  // q is capped at 100 characters; sending more would return results for a query
  // nobody wrote, which is worse than an error.
  let called = false;
  const fetchImpl = async () => { called = true; return response({ hits: [] }); };
  await assert.rejects(
    () => searchPixabay({ query: "x".repeat(101), key: "k", fetchImpl }),
    (e) => { assert.equal(e.reason, "bad-request"); return true; }
  );
  assert.equal(called, false);
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
