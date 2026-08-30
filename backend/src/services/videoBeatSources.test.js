import test from "node:test";
import assert from "node:assert/strict";
import {
  makeEntityImageFetcher, makeStockImageFetcher, searchPexelsPhotos, commonsFilePath,
} from "./videoBeatSources.js";

const BUF = { buf: Buffer.from("JPEGDATA"), mime: "image/jpeg" };

// Isolate every test from the on-disk 24h cache.
process.env.VIDEO_BEAT_CACHE_HOURS = "0";

test("the entity tier matches on an IDENTIFIER, never on text", async () => {
  // The reason it carries high confidence: P18 is the entity's designated
  // image. This path cannot return a picture of something else — only none.
  let asked = null;
  const fetchEntity = makeEntityImageFetcher({
    _fetchJson: async (u) => { asked = u; return { entities: { Q7747: { claims: { P18: [{ mainsnak: { datavalue: { value: "Putin.jpg" } } }] } } } }; },
    _fetchImage: async () => BUF,
  });
  const r = await fetchEntity({ qid: "Q7747", label: "Vladimir Putin" });
  assert.equal(r.credit, "Wikimedia Commons");
  assert.match(asked, /ids=Q7747/);
  assert.match(r.url, /Special:FilePath\/Putin\.jpg/);
  assert.equal(r.buf.toString(), "JPEGDATA");
});

test("no QID, no P18, or an unfetchable file all yield null rather than a guess", async () => {
  const noP18 = makeEntityImageFetcher({
    _fetchJson: async () => ({ entities: { Q1: { claims: {} } } }), _fetchImage: async () => BUF,
  });
  assert.equal(await noP18({ qid: "Q1" }), null);
  assert.equal(await noP18({}), null, "an entity with no QID is not resolvable");

  const badImage = makeEntityImageFetcher({
    _fetchJson: async () => ({ entities: { Q2: { claims: { P18: [{ mainsnak: { datavalue: { value: "X.jpg" } } }] } } } }),
    _fetchImage: async () => null,
  });
  assert.equal(await badImage({ qid: "Q2" }), null);
});

test("commons file paths are escaped, spaces included", () => {
  assert.match(commonsFilePath("Big Ben at night.jpg"), /Big_Ben_at_night\.jpg/);
  assert.match(commonsFilePath("a&b.jpg"), /a%26b\.jpg/);
});

// ─── Stock ──────────────────────────────────────────────────────────────────

test("stock puts every candidate through the REPLACED gate", async () => {
  // The provider returning a loosely-tagged result must not smuggle one past.
  const stock = makeStockImageFetcher({
    _search: async () => [
      { url: "https://s/1.jpg", alt: "Village fete cancelled", credit: "A / Pexels" },
      { url: "https://s/2.jpg", alt: "Snowy winter landscape at dusk", credit: "B / Pexels" },
    ],
    _fetchImage: async () => BUF,
  });
  const r = await stock("winter landscape");
  assert.equal(r.url, "https://s/2.jpg", "the first RELEVANT candidate wins, not the first candidate");
  assert.equal(r.credit, "B / Pexels");
});

test("ACCEPTANCE, at the source layer: the polar bear cannot get through here either", async () => {
  // The gate lives in videoImageRelevance, but this is the door it guards.
  const stock = makeStockImageFetcher({
    _search: async () => [{
      url: "https://s/pb.jpg",
      alt: "168th Refueling Wing performs Polar Bear Charge on Eielson Air Force Base",
      credit: "DVIDS",
    }],
    _fetchImage: async () => BUF,
  });
  assert.equal(await stock("a polar bear on ice"), null);
});

test("no candidate passing means no picture — never a fallback to the first one", async () => {
  const stock = makeStockImageFetcher({
    _search: async () => [{ url: "https://s/1.jpg", alt: "something else entirely", credit: "C" }],
    _fetchImage: async () => BUF,
  });
  assert.equal(await stock("gas pipeline"), null);
});

test("a search returning nothing is a miss, not an error", async () => {
  const stock = makeStockImageFetcher({ _search: async () => [], _fetchImage: async () => BUF });
  assert.equal(await stock("winter landscape"), null);
});

// ─── The Pexels client ──────────────────────────────────────────────────────

test("the Pexels client is LOCAL, not an import across the boundary test", async () => {
  // scripts/lib/stock/providers.mjs is a VIDEO client behind
  // stockLibraryBoundary.test.js, which forbids runtime code importing the
  // operator scripts. Crossing that boundary is its own commit; reaching for it
  // here to save fifteen lines would have made the crossing invisible.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("./videoBeatSources.js", import.meta.url), "utf8"));
  // IMPORTS, not mentions — the file explains in prose why it does not import
  // across the boundary, and that explanation must not trip its own guard.
  const imports = [...src.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const dynamic = [...src.matchAll(/await\s+import\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
  for (const spec of [...imports, ...dynamic]) {
    assert.ok(!/scripts\/(lib\/)?stock/.test(spec),
      `the runtime must not import the operator scripts — found "${spec}"`);
  }
  assert.ok(imports.length > 0, "the import scan found nothing, so it is not actually checking");
});

test("Pexels results are normalised, and no key means no search", async () => {
  const prev = process.env.PEXELS_API_KEY;
  try {
    delete process.env.PEXELS_API_KEY;
    assert.deepEqual(await searchPexelsPhotos("x", { _fetchJson: async () => ({}) }), []);

    process.env.PEXELS_API_KEY = "k";
    const out = await searchPexelsPhotos("winter", {
      _fetchJson: async () => ({ photos: [
        { src: { large2x: "https://p/1.jpg" }, alt: "winter road", photographer: "Ann Lee", width: 1080, height: 1920 },
        { src: {}, alt: "no url" },
      ] }),
    });
    assert.equal(out.length, 1, "a candidate with no usable rendition is dropped");
    assert.equal(out[0].credit, "Ann Lee / Pexels");
    assert.equal(out[0].alt, "winter road");
  } finally {
    if (prev === undefined) delete process.env.PEXELS_API_KEY; else process.env.PEXELS_API_KEY = prev;
  }
});
