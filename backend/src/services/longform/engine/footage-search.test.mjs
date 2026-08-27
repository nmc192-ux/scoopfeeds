/**
 * footage-search.test.mjs — the Pexels video tier.
 *
 * Run: cd backend && node --test src/services/longform/engine/footage-search.test.mjs
 *
 * This file had NO tests before. It is deliberately small: it pins the two
 * things that were worth checking while fixing the endpoint, and nothing else.
 * The other tiers (DVIDS, NASA, Wikimedia, Archive.org, YouTube CC) are left
 * alone — they answer a different question (archive footage with provenance)
 * and are not what this change touched.
 *
 * WHAT IT PINS
 *
 * 1. The endpoint. Pexels moved its video endpoints under /v1/ and put the old
 *    path on notice. The old path still answers TODAY, so nothing here proves
 *    the new one works against the live API — these tests stub fetch. They
 *    prove only that the URL this code builds is the documented one.
 *
 * 2. The rendition choice. Ranking by the `quality` string would be a live bug:
 *    in Pexels' own example payload a 1280x720 file and a 4096x2160 file are
 *    BOTH quality "hd", and an "hls" entry carries width: null, height: null.
 *    The selector here ranks on numeric dimensions and never reads `quality` —
 *    these tests hold it that way.
 */

import test from "node:test";
import assert from "node:assert/strict";

process.env.PEXELS_API_KEY ||= "test-key";
const { searchFootage } = await import("./footage-search.mjs");

/**
 * A Pexels video whose renditions are ordered to punish the obvious mistakes:
 * the hls entry is first, the largest file is labelled "hd" but is NOT the one
 * that should be chosen, and the file that SHOULD be chosen is labelled "sd".
 */
const VIDEO = {
  id: 857195,
  url: "https://www.pexels.com/video/aerial-view-of-a-container-port-857195/",
  duration: 14,
  user: { id: 417, name: "Ruvim Miksanskiy" },
  video_files: [
    { id: 1, quality: "hls", file_type: "video/mp4", width: null, height: null, link: "https://player.example/stream.m3u8" },
    { id: 2, quality: "hd", file_type: "video/mp4", width: 1280, height: 720, link: "https://player.example/hd-720.mp4" },
    { id: 3, quality: "hd", file_type: "video/mp4", width: 4096, height: 2160, link: "https://player.example/hd-4k.mp4" },
    { id: 4, quality: "sd", file_type: "video/mp4", width: 1920, height: 1080, link: "https://player.example/sd-1080.mp4" },
  ],
};

/** Stub every outbound call; only the Pexels video search answers with anything. */
function stubFetch(videos) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const body = u.includes("videos/search") ? { videos } : {};
    return { ok: true, status: 200, json: async () => body, text: async () => "" };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const pexelsVideo = (results) => results.find((r) => r.source === "Pexels" && r.download && !r.mediaKind);

// ─── The endpoint ───────────────────────────────────────────────────────────

test("video search goes to the /v1/ path, not the one Pexels has put on notice", async () => {
  const { calls, restore } = stubFetch([VIDEO]);
  try {
    await searchFootage(["container port"]);
  } finally { restore(); }

  const videoCalls = calls.filter((u) => u.includes("videos/search"));
  assert.equal(videoCalls.length, 1, "exactly one video search per query");
  assert.ok(
    videoCalls[0].startsWith("https://api.pexels.com/v1/videos/search?"),
    `video search must use the /v1/ path; got ${videoCalls[0]}`
  );
});

test("the deprecated video path is not requested", async () => {
  // https://api.pexels.com/videos/search still answers today, so this is
  // pre-emptive: the assertion is about which URL we build, not about the old
  // one having stopped working.
  const { calls, restore } = stubFetch([VIDEO]);
  try {
    await searchFootage(["container port"]);
  } finally { restore(); }

  for (const u of calls) {
    assert.ok(!/api\.pexels\.com\/videos\//.test(u), `deprecated Pexels video path requested: ${u}`);
  }
});

test("photo search was always /v1/ and is left alone", async () => {
  // The asymmetry between the two calls in this file is what made the stale
  // video path easy to miss; keeping the photo path pinned keeps them honest.
  const { calls, restore } = stubFetch([]);
  try {
    await searchFootage(["container port"]);
  } finally { restore(); }

  assert.ok(calls.some((u) => u.startsWith("https://api.pexels.com/v1/search?")), "photo search should still be /v1/search");
});

// ─── The rendition choice ───────────────────────────────────────────────────

test("the rendition is chosen by DIMENSIONS — `quality` is never read", async () => {
  // The file that must win is labelled "sd"; a "hd"-labelled 4K file sits in the
  // same array. Any selector that trusts the quality string fails here.
  const { restore } = stubFetch([VIDEO]);
  let candidate;
  try {
    candidate = pexelsVideo(await searchFootage(["container port"]));
  } finally { restore(); }

  assert.ok(candidate, "a Pexels video candidate should have been produced");
  assert.equal(candidate.download, "https://player.example/sd-1080.mp4",
    "the smallest rendition still meeting 1920 wide wins, whatever it is labelled");
  assert.equal(candidate.width, 1920);
  assert.equal(candidate.height, 1080);
});

test("an hls rendition is never chosen — its width and height are null", async () => {
  // `null >= 1920` is false, so the width floor already excludes it. This holds
  // that accident in place: a candidate with null dimensions would flow into the
  // acquisition rules that sort on width, and portrait-vs-landscape would stop
  // meaning anything.
  const hlsFirst = {
    ...VIDEO,
    video_files: [VIDEO.video_files[0], VIDEO.video_files[3]],
  };
  const { restore } = stubFetch([hlsFirst]);
  let candidate;
  try {
    candidate = pexelsVideo(await searchFootage(["container port"]));
  } finally { restore(); }

  assert.equal(candidate.download, "https://player.example/sd-1080.mp4");
  assert.ok(Number.isFinite(candidate.width) && candidate.width > 0, "no null-dimension rendition may reach a candidate");
});

test("a video with nothing at 1920 wide is skipped rather than downgraded", async () => {
  // The floor is a floor. Emitting a 720p candidate because nothing better
  // exists would put it in front of a human as though it qualified.
  const tooSmall = { ...VIDEO, video_files: [VIDEO.video_files[0], VIDEO.video_files[1]] };
  const { restore } = stubFetch([tooSmall]);
  let candidate;
  try {
    candidate = pexelsVideo(await searchFootage(["container port"]));
  } finally { restore(); }

  assert.equal(candidate, undefined, "a sub-1920 result contributes no candidate at all");
});

test("provenance and attribution survive the search", async () => {
  // Pexels is its own `platform` tier — approved for unattended use on the basis
  // that the platform vouches for its own catalogue. It must never arrive as
  // `declared`, which is the tier that still needs a human to check ownership.
  const { restore } = stubFetch([VIDEO]);
  let candidate;
  try {
    candidate = pexelsVideo(await searchFootage(["container port"]));
  } finally { restore(); }

  assert.equal(candidate.provenance, "platform");
  assert.equal(candidate.contributor, "Ruvim Miksanskiy");
  assert.equal(candidate.attribution, "Ruvim Miksanskiy / Pexels");
  assert.equal(candidate.url, VIDEO.url, "the human-facing page URL, not the file");
});
