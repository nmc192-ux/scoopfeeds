/**
 * facebookClient.test.js — the page-feed video upload, and the fallback it refuses.
 *
 * Every other function in this client degrades: photo → photo-by-URL → link
 * post. postReelToFacebook does the same, which is why a "success" from it may
 * be the suppressed link share it was supposed to replace, and why a prod
 * snapshot showed no evidence it ever uploaded a video at all.
 *
 * postVideoToFacebook must not do that. The cross-post exists because Facebook
 * demotes YouTube links; silently posting one on failure would defeat the
 * feature while reporting success. So the test that matters is the NEGATIVE
 * one: on any error it throws, and no second request is made.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = mkdtempSync(path.join(os.tmpdir(), "fbclient-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = TMP;
process.env.FACEBOOK_PAGE_ID = "1126859220500685";
process.env.FACEBOOK_PAGE_TOKEN = "test-token-not-real";

const { postVideoToFacebook, isFacebookConfigured } = await import("./facebookClient.js");

const MP4 = path.join(TMP, "video.mp4");
writeFileSync(MP4, Buffer.alloc(50_000, 1));

/** Record every fetch and reply with a scripted response. */
function stubFetch(responses) {
  const calls = [];
  const real = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (k) => (k.toLowerCase() === "x-business-use-case-usage" ? r.buc || null : null) },
      text: async () => JSON.stringify(r.body ?? {}),
    };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test("the client is configured from env", () => {
  assert.equal(isFacebookConfigured(), true);
});

test("a successful upload POSTs multipart to /{page-id}/videos and returns the id", async () => {
  const { calls, restore } = stubFetch([{ status: 200, body: { id: "708090" } }]);
  try {
    const out = await postVideoToFacebook({ filePath: MP4, title: "T", description: "D" });
    assert.equal(out.id, "708090");
    assert.match(out.url, /facebook\.com\/1126859220500685\/videos\/708090/);

    assert.equal(calls.length, 1, "exactly one request");
    assert.match(calls[0].url, /\/1126859220500685\/videos$/);
    assert.equal(calls[0].init.method, "POST");
    assert.ok(calls[0].init.body instanceof FormData, "must be multipart, not a query string");
    assert.ok(calls[0].init.body.get("source"), "the MP4 bytes go in `source`");
    assert.equal(calls[0].init.body.get("title"), "T");
    assert.equal(calls[0].init.body.get("description"), "D");
    assert.equal(calls[0].init.body.get("published"), "true");
  } finally { restore(); }
});

test("the version pin is current, not the expired v19.0", async () => {
  // v19.0 expired 2026-05-21. Meta does not hard-fail an expired version — it
  // silently routes to the oldest live one, so this drifts without an error and
  // nothing else in the system would notice.
  const { calls, restore } = stubFetch([{ status: 200, body: { id: "1" } }]);
  try {
    await postVideoToFacebook({ filePath: MP4 });
    assert.ok(!calls[0].url.includes("/v19.0/"), "v19.0 is expired");
    assert.match(calls[0].url, /graph\.facebook\.com\/v2[0-9]\./, "expected a v2x pin");
  } finally { restore(); }
});

test("A META ERROR THROWS — there is NO link fallback", async () => {
  // The requirement in one assertion: one request, then an exception. A second
  // request would mean it degraded to /feed with a link, which is exactly the
  // suppressed post this feature exists to avoid.
  const { calls, restore } = stubFetch([
    { status: 403, body: { error: { message: "(#200) Permissions error", code: 200 } } },
  ]);
  try {
    await assert.rejects(
      () => postVideoToFacebook({ filePath: MP4, title: "T" }),
      /facebook \/videos → 403.*Permissions error/,
    );
    assert.equal(calls.length, 1, "a second request would be a fallback — there must not be one");
    assert.ok(!calls.some((c) => c.url.includes("/feed")), "must never fall back to a link post");
  } finally { restore(); }
});

test("a 200 with no id is a failure, not a success", async () => {
  const { calls, restore } = stubFetch([{ status: 200, body: { nonsense: true } }]);
  try {
    await assert.rejects(() => postVideoToFacebook({ filePath: MP4 }), /returned no id/);
    assert.equal(calls.length, 1);
  } finally { restore(); }
});

test("a missing file throws before any network call", async () => {
  const { calls, restore } = stubFetch([{ status: 200, body: { id: "1" } }]);
  try {
    await assert.rejects(
      () => postVideoToFacebook({ filePath: path.join(TMP, "nope.mp4") }),
      /file not found/,
    );
    assert.equal(calls.length, 0, "no credential should leave the process for a file we do not have");
  } finally { restore(); }
});

test("an implausibly small file is refused rather than uploaded", async () => {
  const tiny = path.join(TMP, "tiny.mp4");
  writeFileSync(tiny, "x");
  const { calls, restore } = stubFetch([{ status: 200, body: { id: "1" } }]);
  try {
    await assert.rejects(() => postVideoToFacebook({ filePath: tiny }), /implausibly small/);
    assert.equal(calls.length, 0);
  } finally { restore(); }
});

test("a file past the single-request ceiling names the resumable API rather than a bigger number", async () => {
  // Renders were ~1.9 MB when this was written. If they ever grow two orders of
  // magnitude, the fix is Meta's Resumable Upload API, not FACEBOOK_VIDEO_MAX_MB.
  const saved = process.env.FACEBOOK_VIDEO_MAX_MB;
  process.env.FACEBOOK_VIDEO_MAX_MB = "0.01";   // 10 KB — the 50 KB fixture exceeds it
  const fresh = await import(`./facebookClient.js?ceiling=${Date.now()}`);
  const { calls, restore } = stubFetch([{ status: 200, body: { id: "1" } }]);
  try {
    await assert.rejects(() => fresh.postVideoToFacebook({ filePath: MP4 }), /Resumable Upload API/);
    assert.equal(calls.length, 0);
  } finally {
    restore();
    if (saved === undefined) delete process.env.FACEBOOK_VIDEO_MAX_MB;
    else process.env.FACEBOOK_VIDEO_MAX_MB = saved;
  }
});

test("the BUC usage header is read on every call and does not break the upload", async () => {
  // Throttling arrives as error 80001 with this header; it is logged rather
  // than branched on, so the only failure mode worth pinning is that a
  // malformed header cannot take the upload down with it.
  const { restore } = stubFetch([{ status: 200, body: { id: "5" }, buc: "not-json{{" }]);
  try {
    const out = await postVideoToFacebook({ filePath: MP4 });
    assert.equal(out.id, "5");
  } finally { restore(); }
});
