/**
 * longformThumbnail.test.js — the house rules, as refusals (#78).
 *
 * house-style.md §Thumbnail is specific and every rule in it is a check that
 * FAILS here. A thumbnail that breaks the standard should stop the film, not
 * ship quietly and be discovered at 168px by a viewer who scrolls past.
 *
 * The renderer itself was verified by generating a real 1280x720 PNG (46 KB)
 * and a 168px review copy from an actual rendered film, and LOOKING at both.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  validateThumbSpec, renderThumbnail, W, H, MAX_BYTES, REVIEW_WIDTH, MAX_HEADLINE_LINES,
} from "./longformThumbnail.js";

const ok = (over = {}) => ({ lines: ["SEVEN WEEKS", "OF SILENCE"], accent: "NOBODY SAW IT",
                             sub: "DR Congo", plateFrom: "/tmp/footage.mp4", ...over });

test("the house dimensions and limits are what the standard says", () => {
  assert.equal(W, 1280); assert.equal(H, 720);
  assert.equal(MAX_BYTES, 2 * 1024 * 1024, "YouTube rejects a larger file outright");
  assert.equal(REVIEW_WIDTH, 168, "the size a thumbnail is actually judged at");
  assert.equal(MAX_HEADLINE_LINES, 2);
});

test("a compliant spec validates clean", () => {
  assert.deepEqual(validateThumbSpec(ok()), []);
});

test("MORE THAN TWO ANTON LINES IS REFUSED — it does not survive the downscale", () => {
  const errs = validateThumbSpec(ok({ lines: ["ONE", "TWO", "THREE"] }));
  assert.match(errs.join("\n"), /3 headline lines \(max 2\)/);
  assert.match(errs.join("\n"), /does not survive the downscale to 168px/);
});

test("over-long lines are refused — legibility at 168px is the constraint", () => {
  assert.match(validateThumbSpec(ok({ lines: ["A HEADLINE FAR TOO LONG TO READ SMALL"] })).join("\n"),
    /shrink below legibility at 168px/);
  assert.match(validateThumbSpec(ok({ accent: "AN ACCENT LINE THAT IS MUCH TOO LONG" })).join("\n"),
    /too long for the lime line/);
});

test("a thumbnail with no type is refused", () => {
  assert.match(validateThumbSpec(ok({ lines: [] })).join("\n"), /no headline lines/);
  assert.match(validateThumbSpec(ok({ lines: ["", "  "] })).join("\n"), /lines\[0\] is empty/);
});

test("THE PLATE MAY NOT BE THE FILM ITSELF", () => {
  // A card-based film's own frames are type on a dark ground, so a plate taken
  // from one puts text under text. Found by doing exactly this in testing.
  const film = "/tmp/out/f.mp4";
  assert.match(validateThumbSpec(ok({ plateFrom: film, film })).join("\n"),
    /take the plate from footage/);
  assert.deepEqual(validateThumbSpec(ok({ plateFrom: "/tmp/out/footage/F_A.mp4", film })), []);
  assert.match(validateThumbSpec(ok({ plateFrom: null })).join("\n"), /no plateFrom/);
});

test("a missing source frame is named, not a raw ffmpeg failure", async () => {
  await assert.rejects(
    () => renderThumbnail({
      spec: ok({ plateFrom: "/tmp/definitely-not-here.mp4" }),
      outDir: "/tmp", ffmpegPath: "/bin/true", fontsDir: "/tmp",
      satori: async () => "", Resvg: class {},
    }),
    /source frame not found at/);
});

test("a spec violation stops the render before any ffmpeg runs", async () => {
  let ran = false;
  await assert.rejects(
    () => renderThumbnail({
      spec: ok({ lines: ["A", "B", "C"] }),
      outDir: "/tmp", ffmpegPath: "/bin/true", fontsDir: "/tmp",
      satori: async () => { ran = true; return ""; }, Resvg: class {},
    }),
    /violates house-style.md/);
  assert.equal(ran, false, "nothing is rendered for a spec that cannot ship");
});

test("every required dependency is named when absent", async () => {
  for (const missing of ["outDir", "ffmpegPath", "fontsDir", "satori", "Resvg"]) {
    const args = { spec: ok(), outDir: "/tmp", ffmpegPath: "/bin/true", fontsDir: "/tmp",
                   satori: async () => "", Resvg: class {} };
    delete args[missing];
    await assert.rejects(() => renderThumbnail(args), new RegExp(`${missing} is required`));
  }
});
