import test from "node:test";
import assert from "node:assert/strict";
import { searchEventImages, buildQueries, PUBLISHER_DOMAINS } from "./videoWebImageSearch.js";

const QUIET = { info() {}, warn() {} };

// SELF-CONTAINED. These passed standalone and failed in the full suite because
// they leaned on a key exported on the command line — the tier returns [] with
// no key, so every assertion about its behaviour needs one present.
let PREV;
test.before(() => { PREV = process.env.SERPER_API_KEY; process.env.SERPER_API_KEY = "test-key"; });
test.after(() => { if (PREV === undefined) delete process.env.SERPER_API_KEY; else process.env.SERPER_API_KEY = PREV; });
const reply = (images) => async () => ({ ok: true, json: async () => ({ images }) });
const img = (imageUrl, link, title = "t") => ({ imageUrl, link, title });

test("the query pairs the headline's event with the beat's subject", () => {
  // Neither alone works: "ballot box" finds stock, "Iceland referendum" finds
  // the story but not the beat.
  const qs = buildQueries("ballot box", { headline: "Iceland votes on EU talks", days: 14 });
  assert.equal(qs.length, 2);
  assert.match(qs[0].q, /Iceland votes on EU talks ballot box/);
  assert.equal(qs[0].tbs, null, "the open query carries no date restriction");
  assert.equal(qs[1].tbs, "qdr:d14");
  assert.deepEqual(buildQueries("", { headline: "" }), []);
});

test("BOTH queries run and their results are unioned", async () => {
  // Measured: date restriction alone REDUCED publisher share on four of ten
  // stories, because social republishes fastest. The union is what works.
  const calls = [];
  const _fetch = async (_u, opts) => {
    const body = JSON.parse(opts.body); calls.push(body.tbs || "open");
    return { ok: true, json: async () => ({ images: [img(`https://cdn/${body.tbs || "open"}.jpg`, "https://reuters.com/a")] }) };
  };
  const out = await searchEventImages("ballot box", { headline: "Iceland", days: 7, _fetch, _log: QUIET });
  assert.deepEqual(calls, ["open", "qdr:d7"]);
  assert.equal(out.length, 2);
});

test("social platforms are excluded outright — the date-restriction lesson", async () => {
  const _fetch = reply([
    img("https://cdn/a.jpg", "https://www.instagram.com/p/x"),
    img("https://cdn/b.jpg", "https://facebook.com/y"),
    img("https://cdn/c.jpg", "https://x.com/z"),
    img("https://cdn/d.jpg", "https://reuters.com/article"),
  ]);
  const out = await searchEventImages("raid", { headline: "West Bank", _fetch, _log: QUIET });
  assert.equal(out.length, 1);
  assert.equal(out[0].host, "reuters.com");
});

test("licensing platforms are excluded — a watermarked comp is not a picture", async () => {
  const _fetch = reply([
    img("https://cdn/a.jpg", "https://www.reutersconnect.com/item"),
    img("https://media.gettyimages.com/b.jpg", "https://news.example/story"),
    img("https://cdn/c.jpg", "https://bbc.com/news"),
  ]);
  const out = await searchEventImages("raid", { headline: "West Bank", _fetch, _log: QUIET });
  assert.deepEqual(out.map((o) => o.host), ["bbc.com"]);
});

test("confidence comes from the SOURCE, and low candidates are KEPT", async () => {
  // Gating on the publisher list cost real photographs from time.com, the New
  // Yorker and the Moscow Times. The domain ranks; it does not admit.
  const _fetch = reply([
    img("https://cdn/a.jpg", "https://someblog.example/post"),
    img("https://cdn/b.jpg", "https://www.reuters.com/world"),
  ]);
  const out = await searchEventImages("gold", { headline: "Russia", _fetch, _log: QUIET });
  assert.equal(out.length, 2, "a generic hit is low confidence, not excluded");
  assert.equal(out[0].confidence, "high", "publishers sort first");
  assert.equal(out[0].host, "reuters.com");
  assert.equal(out[1].confidence, "low");
});

test("domains carrying their own TLD match — the regex bug that under-reported by 13%", () => {
  // The first version tested `host` against a pattern ending in "\\.", so
  // ft.com, ap.org, time.com and sky.com could never match.
  for (const h of ["time.com", "ft.com", "ap.org", "sky.com", "fool.com", "inc.com", "reuters.com", "bbc.co.uk"]) {
    assert.ok(PUBLISHER_DOMAINS.test(`${h}.`), `${h} should read as a publisher`);
  }
  assert.ok(!PUBLISHER_DOMAINS.test("someblog.example."));
});

test("a crop or size variant is dropped BEFORE it is ever fetched", async () => {
  const _fetch = reply([
    img("https://i.guim.co.uk/img/media/abc123/0_0_3749_3000/master/3749.jpg?width=1200", "https://theguardian.com/a"),
    img("https://i.guim.co.uk/img/media/abc123/1200_0_2549_3000/master/2549.jpg?width=620", "https://theguardian.com/a"),
    img("https://static.dw.com/image/77474131_605.jpg", "https://dw.com/b"),
    img("https://static.dw.com/image/77474131_1004.webp", "https://dw.com/b"),
  ]);
  const out = await searchEventImages("gas", { headline: "EU", _fetch, _log: QUIET });
  assert.equal(out.length, 2, "two photographs, four URLs");
});

test("a failing search costs the beat its picture, never the video", async () => {
  assert.deepEqual(await searchEventImages("x", { headline: "y", _fetch: async () => { throw new Error("network"); }, _log: QUIET }), []);
  assert.deepEqual(await searchEventImages("x", { headline: "y", _fetch: async () => ({ ok: false, status: 429, text: async () => "" }), _log: QUIET }), []);
  assert.deepEqual(await searchEventImages("x", { headline: "y", _fetch: reply(null), _log: QUIET }), []);
});

test("no key means the tier is silently absent", async () => {
  const prev = process.env.SERPER_API_KEY;
  try {
    delete process.env.SERPER_API_KEY;
    assert.deepEqual(await searchEventImages("x", { headline: "y", _fetch: reply([img("https://c/a.jpg", "https://bbc.com/1")]), _log: QUIET }), []);
  } finally { if (prev) process.env.SERPER_API_KEY = prev; }
});

test("dimensions are NOT returned — the reported ones are thumbnails", async () => {
  // Gating on Serper's width/height discarded the actual AP photograph of
  // Federer's induction (reported 599x399) and the BBC one (865x487). The
  // caller fetches and measures instead.
  const _fetch = reply([{ imageUrl: "https://cdn/a.jpg", link: "https://apnews.com/x", title: "t", imageWidth: 599, imageHeight: 399 }]);
  const out = await searchEventImages("federer", { headline: "Hall of Fame", _fetch, _log: QUIET });
  assert.equal(out.length, 1);
  assert.equal(out[0].imageWidth, undefined);
  assert.equal(out[0].imageHeight, undefined);
});
