/**
 * cardImagery.test.js — the rules that decide what photo goes on a card.
 *
 * THE FIXTURES THAT FORCED THIS MODULE, first. Three real prod cards, all
 * observed live on 2026-08-14:
 *
 *   - "Can Werro recover from heavy fall to challenge for 800m gold?"
 *     illustrated with a stock photo of a woman holding a globe.
 *   - "Donald Trump empowers US private companies to conduct cyber-attacks"
 *     illustrated with THE SAME globe photo.
 *   - "Israeli troops force families from homes amid settler terror campaign
 *     in West Bank" illustrated with a stock bar chart on a desk.
 *
 * The stock step is gone. What replaced it has two failure modes that are not
 * obvious from reading the code, and both are load-bearing enough to test:
 *
 *   1. The Accept header. Guardian / The Hill / ARY content-negotiate: ask for
 *      webp and they return webp for a URL ending in `.jpg`. Satori cannot
 *      embed webp, so we throw it away. Measured over 68 live prod articles,
 *      advertising webp made 50% of ALL fetches unusable. There is no error
 *      anywhere when this regresses — the photo rate just halves.
 *
 *   2. Thumbnail size. The Guardian ships a SIGNED `?width=140` URL that
 *      cannot be upscaled (the `s=` signature covers the query). It is a
 *      perfectly valid 3KB JPEG, so the old byte-size guard passed it, and it
 *      looks like mush across a 1200px card. Dimensions, not bytes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  readImageDimensions, MIN_PHOTO_WIDTH, MIN_PHOTO_HEIGHT, IMAGE_FETCH_ACCEPT,
} from "./cardRenderer.js";
import { isSensitiveHeadline, TRAGEDY_KEYWORDS } from "./editorialSensitivity.js";

// ─── The Accept header ──────────────────────────────────────────────────────

test("THE 50% BUG: the image Accept header never advertises webp or avif", () => {
  assert.doesNotMatch(IMAGE_FETCH_ACCEPT, /webp/i,
    "advertising webp makes Guardian/The Hill/ARY return webp for .jpg URLs, which satori cannot embed");
  assert.doesNotMatch(IMAGE_FETCH_ACCEPT, /avif/i);
  assert.match(IMAGE_FETCH_ACCEPT, /image\/jpeg/);
  assert.match(IMAGE_FETCH_ACCEPT, /image\/png/);
});

// ─── Dimension parsing ──────────────────────────────────────────────────────

// Minimal but real PNG: 8-byte signature + IHDR length/type + w/h.
function pngWith(width, height) {
  const b = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

// Minimal but real JPEG: SOI, an APP0/JFIF segment that must be SKIPPED, then
// SOF0. Segment lengths include their own 2 length bytes but not the marker —
// getting that wrong is exactly the off-by-two the parser has to survive, so
// the fixture is built to spec rather than approximated.
function jpegWith(width, height) {
  const APP0_LEN = 16;                                   // covers len + 14 payload
  const app0 = Buffer.concat([
    Buffer.from([0xFF, 0xE0]),
    (() => { const b = Buffer.alloc(2); b.writeUInt16BE(APP0_LEN); return b; })(),
    Buffer.concat([Buffer.from("JFIF\0"), Buffer.alloc(9)]),   // 14 bytes
  ]);
  const SOF_LEN = 11;                                    // len + precision + h + w + 4
  const sof0 = Buffer.alloc(2 + SOF_LEN);
  sof0.writeUInt8(0xFF, 0); sof0.writeUInt8(0xC0, 1);
  sof0.writeUInt16BE(SOF_LEN, 2);
  sof0.writeUInt8(8, 4);          // sample precision
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xFF, 0xD8]), app0, sof0]);
}

test("reads PNG dimensions from IHDR", () => {
  assert.deepEqual(readImageDimensions(pngWith(1600, 900)), { width: 1600, height: 900 });
});

test("reads JPEG dimensions from SOF0, skipping the APP0 segment", () => {
  assert.deepEqual(readImageDimensions(jpegWith(1200, 630)), { width: 1200, height: 630 });
});

test("THE GUARDIAN CASE: a signed 140px thumbnail is below the floor", () => {
  const { width } = readImageDimensions(jpegWith(140, 84));
  assert.ok(width < MIN_PHOTO_WIDTH,
    "the Guardian's ?width=140 signed thumb must be rejected — it cannot be upscaled and looks like mush on a 1200px card");
});

test("a full-size publisher hero clears the floor", () => {
  const d = readImageDimensions(jpegWith(1200, 675));
  assert.ok(d.width >= MIN_PHOTO_WIDTH && d.height >= MIN_PHOTO_HEIGHT);
});

test("garbage and truncated buffers return null rather than throwing", () => {
  assert.equal(readImageDimensions(null), null);
  assert.equal(readImageDimensions(Buffer.alloc(4)), null);
  assert.equal(readImageDimensions(Buffer.from("not an image at all!!")), null);
  // A JPEG whose segment length runs past the end must not read out of bounds.
  const truncated = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(readImageDimensions(truncated), null);
});

// ─── The editorial guard ────────────────────────────────────────────────────

test("THE WEST BANK CASE: a displacement headline suppresses the photo", () => {
  assert.equal(isSensitiveHeadline("Israeli troops force families from homes amid settler terror campaign in West Bank"), true);
});

test("deaths, crashes and shootings all suppress the photo", () => {
  for (const h of [
    "Six killed in Kabul bombing",
    "Veteran actor dies aged 88",
    "Bus crash leaves dozens injured",
    "Gunman opens fire in mall shooting",
    "Coroner rules death was accidental",
    "Nation mourns after massacre",
  ]) {
    assert.equal(isSensitiveHeadline(h), true, `expected sensitive: ${h}`);
  }
});

test("ordinary news keeps its photo", () => {
  for (const h of [
    "Senate panel advances health funding package",
    "Can Werro recover from heavy fall to challenge for 800m gold?",
    "Fossils show huge carbon emissions harm forests",
    "German economy posts modest quarterly growth",
  ]) {
    assert.equal(isSensitiveHeadline(h), false, `expected NOT sensitive: ${h}`);
  }
});

test("an empty headline takes the safe path", () => {
  // A card with no headline to judge is exactly when we should not be guessing.
  assert.equal(isSensitiveHeadline(""), true);
  assert.equal(isSensitiveHeadline(null), true);
  assert.equal(isSensitiveHeadline(undefined), true);
});

test("ONE regex, shared: the composer and the renderer cannot drift", () => {
  // socialComposer imports TRAGEDY_KEYWORDS from the same module the renderer's
  // guard uses. If someone re-inlines a second copy in either place, this is
  // the test that should have caught it.
  assert.ok(TRAGEDY_KEYWORDS instanceof RegExp);
  assert.equal(TRAGEDY_KEYWORDS.test("three killed"), true);
  assert.equal(TRAGEDY_KEYWORDS.test("three elected"), false);
});
