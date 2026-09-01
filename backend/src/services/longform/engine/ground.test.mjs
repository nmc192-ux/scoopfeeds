// ground.test.mjs — the generated backplate a card may sit on.
//
// Run:  node --test backend/src/services/longform/engine/ground.test.mjs
//
// Three properties, in order of how much damage getting them wrong does:
//
//   1. NO LEAK. `_ground` is module-level state in render.mjs, set immediately
//      before the card builder runs and cleared immediately after. That is only
//      safe because builders are synchronous. If that ever stops being true —
//      or if someone returns early past the clear — the NEXT card silently
//      inherits a backplate it never asked for, and a film ships with grounds
//      on the wrong shots. Nothing about the output would look broken, which is
//      what makes it worth a test rather than a comment.
//
//   2. A MISSING GROUND IS EXACTLY FLAT. §7.4 rule 5 says a ground that cannot
//      be produced falls back to flat near-black. "Falls back" has to mean
//      pixel-identical to a card that never named a ground, not merely similar:
//      the grounds live outside the repo (CDN URLs in grounds.json), so on any
//      machine that has not fetched them, EVERY grounded card takes this path.
//      That is the common case, not the edge case.
//
//   3. A PRESENT GROUND ACTUALLY REACHES THE PIXELS. The scrim is deliberately
//      heavy (0.86), so "the ground is applied" and "the frame looks unchanged"
//      are easy to confuse by eye. Hashes cannot confuse them.
//
// The ground is resolved through P() — i.e. relative to process.cwd() — so this
// file chdir's into a temp project. That is process-wide, which is fine here
// because node:test runs each file in its own process, but it is why this lives
// in a file of its own rather than in cards.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = mkdtempSync(path.join(os.tmpdir(), "ground-"));
const PROJECT = path.join(TMP, "project");
mkdirSync(path.join(PROJECT, "out/grounds"), { recursive: true });
process.chdir(PROJECT);

// DYNAMIC import, and the chdir above must precede it. _deps.mjs freezes
// PROJECT = process.cwd() at module-evaluation time, so a static `import` —
// hoisted above every statement in this file — would capture the backend
// directory and every ground here would resolve to a path that does not exist.
// The tests would then pass the two fallback assertions and fail the one that
// matters, which is exactly what happened when this was written with a static
// import. Nothing to fix in the engine: a build runs from its project dir, and
// freezing the root once is what makes P() stable for the whole run.
const { renderCard } = await import("./render.mjs");

const render = async (spec, name, p = 1) => {
  const f = path.join(TMP, `${name}.png`);
  await renderCard(spec, f, p);
  return { hash: createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 16), file: f };
};

const STAT = { card: "stat", kicker: "THE NUMBER", figure: "$1,240", unit: "BN",
  label: "What the closure cost in ninety days.", src: "Fixture" };

// A real 1920x1080 PNG to stand in for a generated backplate. Rendering one of
// the engine's own cards is the cheapest way to get a genuine image of exactly
// the right dimensions without committing a binary fixture.
const seed = await render({ ...STAT, figure: "0" }, "seed");
copyFileSync(seed.file, path.join(PROJECT, "out/grounds/HG-TEST.png"));

test("a card that names no ground renders on flat near-black", async () => {
  const a = await render(STAT, "plain-a");
  const b = await render(STAT, "plain-b");
  assert.equal(a.hash, b.hash, "the render is not deterministic; every other assertion here is void");
});

test("a ground that is not on disk falls back to EXACTLY the flat card", async () => {
  const plain = await render(STAT, "fallback-plain");
  const missing = await render({ ...STAT, ground: "HG-NOT-FETCHED" }, "fallback-missing");
  assert.equal(missing.hash, plain.hash,
    "a missing ground must be pixel-identical to no ground — this is the path every "
    + "machine without the fetched grounds takes, so it is the film's normal render");
});

test("a ground that IS on disk changes the frame", async () => {
  const plain = await render(STAT, "present-plain");
  const grounded = await render({ ...STAT, ground: "HG-TEST" }, "present-grounded");
  assert.notEqual(grounded.hash, plain.hash,
    "the ground resolved to a real file and still did not reach the pixels");
});

test("a ground does not leak into the next card", async () => {
  const plain = await render(STAT, "leak-baseline");
  await render({ ...STAT, ground: "HG-TEST" }, "leak-grounded");
  const after = await render(STAT, "leak-after");
  assert.equal(after.hash, plain.hash,
    "the card rendered after a grounded one inherited its backplate — module-level "
    + "_ground was not cleared, and a film would ship grounds on unnamed shots");
});

// This is what the `finally` in renderCard is for. A builder that throws
// half-way is the case where an ordinary `_ground = null` after the call would
// be skipped, leaving the backplate armed for whatever renders next. A map with
// an unknown variant and no geo throws inside the builder, offline.
test("a ground does not leak when the card builder throws", async () => {
  const plain = await render(STAT, "throw-plain");
  await assert.rejects(
    () => render({ card: "map", ground: "HG-TEST", variant: "no-such-variant" }, "throw"),
    /unknown variant/,
    "this card is supposed to fail inside the builder — if it stopped doing so, "
    + "this test silently stopped exercising the finally",
  );
  const after = await render(STAT, "throw-after");
  assert.equal(after.hash, plain.hash, "_ground survived a throwing builder");
});
