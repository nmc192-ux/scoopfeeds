/**
 * The reverse-search client, with fetch stubbed against real Vision response
 * shapes. The live API is NOT exercised here — there is no key in CI and there
 * is no key in the container this was written in, so the network path is
 * reported as unverified rather than faked green.
 *
 * What IS pinned here is the part that would fail silently: an unconfigured
 * client returning null rather than an empty array, and an HTTP error being an
 * error rather than "no pages found".
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  makeReverseSearch, reverseSearchConfigured, searchWebDetection,
  normaliseWebDetection, webContext, ReverseSearchError,
} from "./incidentReverseSearch.js";

/** A real-shaped webDetection block. */
const WEB = {
  webEntities: [
    { entityId: "/m/01", score: 0.9, description: "Flood" },
    { entityId: "/m/02", score: 0.4, description: "Bridge" },
    { entityId: "/m/03", score: 0.1 },
  ],
  fullMatchingImages: [{ url: "https://cdn.example/a.jpg" }, { url: "https://cdn.example/b.jpg" }],
  partialMatchingImages: [{ url: "https://cdn.example/crop.jpg" }],
  pagesWithMatchingImages: [
    {
      url: "https://news.example/story",
      pageTitle: "Flooding hits the valley",
      fullMatchingImages: [{ url: "https://cdn.example/a.jpg" }],
      partialMatchingImages: [],
    },
    { url: "https://archive.example/2019/flood" },
  ],
  bestGuessLabels: [{ label: "flood footage" }],
};

const okResponse = (web) => ({
  ok: true, status: 200,
  json: async () => ({ responses: [{ webDetection: web }] }),
});

const withKey = (fn) => {
  const prev = process.env.GOOGLE_VISION_API_KEY;
  process.env.GOOGLE_VISION_API_KEY = "test-key";
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.GOOGLE_VISION_API_KEY;
    else process.env.GOOGLE_VISION_API_KEY = prev;
  }
};

// ─── Configuration ──────────────────────────────────────────────────────────

test("with no key the factory returns null, NOT a stub that resolves to []", () => {
  const prev = process.env.GOOGLE_VISION_API_KEY;
  delete process.env.GOOGLE_VISION_API_KEY;
  try {
    assert.equal(reverseSearchConfigured(), false);
    assert.equal(
      makeReverseSearch(), null,
      'an empty-array stub would read as "we looked and found nothing" when the truth is "we did not look"'
    );
  } finally {
    if (prev !== undefined) process.env.GOOGLE_VISION_API_KEY = prev;
  }
});

test("a blank or whitespace key is not a key", () => {
  const prev = process.env.GOOGLE_VISION_API_KEY;
  try {
    for (const v of ["", "   "]) {
      process.env.GOOGLE_VISION_API_KEY = v;
      assert.equal(reverseSearchConfigured(), false, `"${v}" must not count as configured`);
    }
  } finally {
    if (prev === undefined) delete process.env.GOOGLE_VISION_API_KEY;
    else process.env.GOOGLE_VISION_API_KEY = prev;
  }
});

test("with a key the factory returns a callable", () => {
  withKey(() => {
    assert.equal(reverseSearchConfigured(), true);
    assert.equal(typeof makeReverseSearch(), "function");
  });
});

// ─── Normalisation ──────────────────────────────────────────────────────────

test("pages, full matches and partial matches all surface, deduplicated by url", () => {
  const pages = normaliseWebDetection(WEB);
  const urls = pages.map((p) => p.url);
  assert.equal(new Set(urls).size, urls.length, "a url appearing in two sections must appear once");
  assert.ok(urls.includes("https://news.example/story"));
  assert.ok(urls.includes("https://archive.example/2019/flood"));
  assert.ok(urls.includes("https://cdn.example/crop.jpg"));
});

test("match type is preserved — a crop is not the same evidence as an exact match", () => {
  const pages = normaliseWebDetection(WEB);
  assert.equal(pages.find((p) => p.url === "https://news.example/story").matchType, "page");
  assert.equal(pages.find((p) => p.url === "https://cdn.example/crop.jpg").matchType, "partial");
  assert.equal(pages.find((p) => p.url === "https://cdn.example/b.jpg").matchType, "full");
});

test("NO page carries a date — the limitation is structural, not an oversight", () => {
  // If a future change starts synthesising a date here, this fails. The check
  // above it is built on the premise that no date is available from this route.
  for (const page of normaliseWebDetection(WEB)) {
    for (const key of Object.keys(page)) {
      assert.ok(
        !/date|time|crawl|published|seen/i.test(key),
        `page carries "${key}" — this route has no date data, so any date here is invented`
      );
    }
  }
});

test("a missing or malformed block yields no pages rather than throwing", () => {
  for (const bad of [null, undefined, {}, "nope", 42, []]) {
    assert.deepEqual(normaliseWebDetection(bad), []);
  }
});

test("entries without a url are dropped rather than becoming blank rows", () => {
  const pages = normaliseWebDetection({
    pagesWithMatchingImages: [{ pageTitle: "no url" }, { url: "" }, { url: "   " }, { url: "https://ok.example/1" }],
  });
  assert.deepEqual(pages.map((p) => p.url), ["https://ok.example/1"]);
});

test("labels and entities are kept apart from match evidence", () => {
  const ctx = webContext(WEB);
  assert.deepEqual(ctx.labels, ["flood footage"]);
  assert.equal(ctx.entities.length, 2, "entities without a description are dropped");
  assert.equal(ctx.entities[0].description, "Flood");
  // And they are not in `pages`, so they cannot be read as "it appeared here".
  assert.equal(normaliseWebDetection(WEB).some((p) => p.url === "Flood"), false);
});

// ─── The request ────────────────────────────────────────────────────────────

test("an https ref is sent as a uri; a local file is sent as base64", async (t) => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(JSON.parse(init.body)); return okResponse(WEB); };

  await searchWebDetection("https://example.com/a.jpg", { apiKey: "k", fetchImpl });
  assert.equal(seen[0].requests[0].image.source.imageUri, "https://example.com/a.jpg");

  const { mkdtempSync, writeFileSync, rmSync } = await import("fs");
  const { tmpdir } = await import("os");
  const path = (await import("path")).default;
  const dir = mkdtempSync(path.join(tmpdir(), "rs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = path.join(dir, "img.bin");
  writeFileSync(f, "hello");
  await searchWebDetection(f, { apiKey: "k", fetchImpl });
  assert.equal(seen[1].requests[0].image.content, Buffer.from("hello").toString("base64"));
});

test("WEB_DETECTION is the feature requested", async () => {
  let body = null;
  await searchWebDetection("https://e.example/a.jpg", {
    apiKey: "k",
    fetchImpl: async (u, init) => { body = JSON.parse(init.body); return okResponse(WEB); },
  });
  assert.equal(body.requests[0].features[0].type, "WEB_DETECTION");
});

test("an HTTP error is an ERROR, never an empty result set", async () => {
  // This is the failure that would turn into a false "no earlier appearance".
  for (const status of [400, 401, 403, 429, 500, 503]) {
    await assert.rejects(
      () => searchWebDetection("https://e.example/a.jpg", {
        apiKey: "k",
        fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }),
      }),
      (err) => err instanceof ReverseSearchError && err.code === `http-${status}`,
      `HTTP ${status} must reject`
    );
  }
});

test("an in-body API error is an error too", async () => {
  await assert.rejects(
    () => searchWebDetection("https://e.example/a.jpg", {
      apiKey: "k",
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ responses: [{ error: { message: "bad image" } }] }) }),
    }),
    (err) => err instanceof ReverseSearchError && err.code === "api-error"
  );
});

test("a network failure rejects rather than resolving empty", async () => {
  await assert.rejects(
    () => searchWebDetection("https://e.example/a.jpg", {
      apiKey: "k", fetchImpl: async () => { throw new Error("ECONNRESET"); },
    }),
    (err) => err instanceof ReverseSearchError && err.code === "request-failed"
  );
});

test("a successful call with genuinely no matches returns [], and the CHECK is what interprets it", async () => {
  const pages = await searchWebDetection("https://e.example/a.jpg", {
    apiKey: "k", fetchImpl: async () => okResponse({}),
  });
  assert.deepEqual(pages, []);
});

test("missing configuration and missing input reject distinctly", async () => {
  await assert.rejects(
    () => searchWebDetection("https://e.example/a.jpg", { apiKey: "", fetchImpl: async () => okResponse(WEB) }),
    (e) => e.code === "unconfigured"
  );
  await assert.rejects(
    () => searchWebDetection(null, { apiKey: "k", fetchImpl: async () => okResponse(WEB) }),
    (e) => e.code === "no-image"
  );
  await assert.rejects(
    () => searchWebDetection("/nope/missing.jpg", { apiKey: "k", fetchImpl: async () => okResponse(WEB) }),
    (e) => e.code === "no-file"
  );
});

test("the endpoint is the documented one", async () => {
  let url = null;
  await searchWebDetection("https://e.example/a.jpg", {
    apiKey: "k", fetchImpl: async (u) => { url = u; return okResponse(WEB); },
  });
  assert.ok(url.startsWith("https://vision.googleapis.com/v1/images:annotate?key="),
    `unexpected endpoint: ${url}`);
});
