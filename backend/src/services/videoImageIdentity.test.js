import test from "node:test";
import assert from "node:assert/strict";
import { imageIdentity, sameImage, dedupeByIdentity } from "./videoImageIdentity.js";

// Every URL below was collected from a live news page on 2026-08-30.

test("size variants of one photograph share an identity", () => {
  assert.ok(sameImage(
    "https://th-i.thgim.com/public/incoming/i6x1tv/article71405976.ece/alternates/LANDSCAPE_1200/2026-08-24T184219Z_1.jpg",
    "https://th-i.thgim.com/public/incoming/i6x1tv/article71405976.ece/alternates/LANDSCAPE_320/2026-08-24T184219Z_1.jpg"));
  assert.ok(sameImage("https://static.dw.com/image/77474131_605.jpg", "https://static.dw.com/image/77474131_1004.webp"));
  assert.ok(sameImage(
    "https://image.cnbcfm.com/api/v1/image/108352868-1787334273233-x.jpg?v=1&w=1920",
    "https://image.cnbcfm.com/api/v1/image/108352868-1787334273233-x.jpg?v=1&w=750"));
});

test("CROPS of one master share an identity — the case aHash cannot see", () => {
  // Measured: these two hashed 27 bits apart against a 5-bit threshold, so the
  // perceptual layer reports two pictures and the video shows one twice.
  assert.ok(sameImage(
    "https://i.guim.co.uk/img/media/02353dc915b654c004a1aa413898c0e0fccd91b3/0_0_3749_3000/master/3749.jpg?width=1200",
    "https://i.guim.co.uk/img/media/02353dc915b654c004a1aa413898c0e0fccd91b3/1200_0_2549_3000/master/2549.jpg?width=620"));
});

test("a thumbnailer that wraps the original resolves TO the original", () => {
  const a = "https://th-thumbnailer.cdn-si-edu.com/fWksp9pk1vNJwqnGrw5bb2HyDwQ=/fit-in/1600x0/filters:focal(1x1:2x2)/https://tf.si-cdn.com/x/y.jpg";
  const b = "https://th-thumbnailer.cdn-si-edu.com/gws7x9JymWKrpZ940GrtMQUvH1w=/600x400/filters:focal(1x1:2x2)/https://tf.si-cdn.com/x/y.jpg";
  assert.equal(imageIdentity(a), "https://tf.si-cdn.com/x/y.jpg");
  assert.ok(sameImage(a, b));
});

test("DIFFERENT photographs keep different identities", () => {
  assert.ok(!sameImage("https://static.dw.com/image/77474131_605.jpg", "https://static.dw.com/image/99999999_605.jpg"));
  assert.ok(!sameImage(
    "https://image.cnbcfm.com/api/v1/image/108352868-1787334273233-x.jpg?v=1",
    "https://image.cnbcfm.com/api/v1/image/108173451-1752770193821-IMG_8083.jpg?v=1"));
  assert.ok(!sameImage("https://a.example/one.jpg", "https://a.example/two.jpg"));
});

test("dedupe keeps the FIRST occurrence, never re-ranks", () => {
  // The caller's order carries meaning — search rank, or the card cascade's
  // upscale-then-original preference. Choosing the largest here would overrule
  // a decision that was made deliberately upstream.
  const out = dedupeByIdentity([
    "https://static.dw.com/image/77474131_605.jpg",
    "https://static.dw.com/image/77474131_1004.webp",
    "https://static.dw.com/image/88888888_605.jpg",
  ]);
  assert.deepEqual(out, ["https://static.dw.com/image/77474131_605.jpg", "https://static.dw.com/image/88888888_605.jpg"]);
});

test("garbage in is its own identity rather than a throw", () => {
  // An unparseable URL dedupes against nothing and costs one fetch, which is
  // the safe failure: the hash layer behind this still catches it.
  for (const v of [null, undefined, "", "   ", "not a url", 42]) {
    assert.doesNotThrow(() => imageIdentity(v));
  }
  assert.equal(imageIdentity(""), "");
  assert.equal(dedupeByIdentity([null, "", "https://a/b.jpg"]).length, 1);
});
