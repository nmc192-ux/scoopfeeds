/**
 * produceLongformFilm.test.js — the chain, and its refusals (#78/#80).
 *
 * Everything with a side effect is injected, so the whole chain runs here with
 * no model, no network, no filesystem and no ffmpeg.
 *
 * The two properties that matter:
 *   1. the stages run in an order where a refusal costs as little as possible
 *   2. an unimplemented stage THROWS BY NAME rather than degrading — a stub
 *      returning "no media" would produce a film of cards over silence and a
 *      LICENSES.md asserting empty provenance, which the disclosure chain
 *      would then faithfully derive a disclosure from
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  produceLongformFilm, missingCapabilities, NotImplementedError,
  MISSING_STAGES, UNWIRED_STAGES,
} from "./produceLongformFilm.js";

const TOPIC = { id: "e1", slug: "strait", title: "The strait", summary: "A summary." };
const SOURCES = ["IMO: the strait is closed.", "Losses reached 1,240 billion."];

const SCRIPT = {
  doc: { spine: { throughLine: "the ship", question: "q", reveal: "r", escalation: "e",
                  questionBeat: 1, answerBeat: 40 }, beats: [{ text: "A beat." }] },
  markdown: "# T\n\n1. A beat.\n",
};
const BOARD = { beats: { 1: { card: "statement", lines: ["X"] } },
                shorts: [{ title: "S1", hook: "H1" }] };
const CLIP = (key) => ({ key, licence: "pexels",
  url: `https://videos.pexels.com/video-files/${key}/x.mp4`, width: 1920, height: 1080 });

const ART = {
  film: "/tmp/f.mp4", srt: "/tmp/f.srt", shotsJson: "/tmp/shots.json",
  shortFiles: ["/tmp/01.mp4", "/tmp/02.mp4", "/tmp/03.mp4"],
};

/** A chain with everything supplied; `over` breaks one stage at a time. */
const deps = (over = {}) => ({
  writeScript: async () => SCRIPT,
  writeBoard: async () => BOARD,
  acquireMedia: async () => [CLIP("F_A"), CLIP("F_B")],
  makeThumbnail: async () => "/tmp/THUMB.png",
  render: async () => ART,
  measure: async () => ({
    loudness: { measured: true, value: -14 }, sideChannel: { measured: true, value: -38 },
    flatFactor: { measured: true, value: 0 }, medianShot: { measured: true, value: 5 },
    shortsUnder2s: { measured: true, value: 0.12 }, filmSeconds: { measured: true, value: 500 },
    srt: { measured: true, value: { cues: 70, lastCueSecs: 490 } },
    shorts: [1, 2, 3].map((i) => ({ measured: true, name: `0${i}.mp4`, seconds: 55, width: 1080, height: 1920 })),
  }),
  publish: async () => {},
  sources: SOURCES, sourceText: SOURCES.join(" "),
  now: Date.UTC(2026, 7, 26, 9, 0, 0),
  ...over,
});

// ── The missing stages are named, not faked ─────────────────────────────────

test("THE UNIMPLEMENTED STAGES ARE INSPECTABLE WITHOUT RUNNING ANYTHING", () => {
  const missing = missingCapabilities().map((m) => m.stage);
  assert.deepEqual(missing, [],
    "every stage has an implementation now — what remains is wiring, in UNWIRED_STAGES");
  assert.ok(UNWIRED_STAGES.makeThumbnail, "the thumbnail is implemented but needs a plate source");
  // "nobody wrote this" and "nobody plugged this in" must stay distinguishable.
  assert.ok(UNWIRED_STAGES.acquireMedia, "an implemented-but-unwired stage is listed separately");
  assert.match(UNWIRED_STAGES.acquireMedia, /DVIDS_API_KEY IS set on the VPS/);
  for (const why of Object.values(UNWIRED_STAGES)) {
    assert.ok(why.length > 40, "each gap must explain itself, not just be listed");
  }
});

test("acquireMedia THROWS BY NAME rather than returning nothing", async () => {
  // A stub returning "no media" would produce a film of cards over silence AND
  // a LICENSES.md asserting empty provenance — which the disclosure chain
  // would faithfully derive a disclosure from. Worse than failing.
  await assert.rejects(
    () => produceLongformFilm(TOPIC, deps({ acquireMedia: undefined })),
    (e) => e instanceof NotImplementedError && e.stage === "acquireMedia");
});

test("makeThumbnail throws by name too", async () => {
  await assert.rejects(
    () => produceLongformFilm(TOPIC, deps({ makeThumbnail: undefined })),
    (e) => e instanceof NotImplementedError && e.stage === "makeThumbnail");
});

test("a missing render function is named, not a TypeError", async () => {
  await assert.rejects(
    () => produceLongformFilm(TOPIC, deps({ render: undefined })),
    (e) => e instanceof NotImplementedError && e.stage === "render");
});

// ── Order: a refusal must cost as little as possible ────────────────────────

test("MEDIA IS ACQUIRED BEFORE THE STORYBOARD IS WRITTEN", async () => {
  // The storyboard references media KEYS. Written against media that was never
  // acquired, it produces dangling references the schema rejects — after
  // paying for the generation.
  const order = [];
  await produceLongformFilm(TOPIC, deps({
    acquireMedia: async () => { order.push("media"); return [CLIP("F_A")]; },
    writeBoard: async () => { order.push("board"); return BOARD; },
  }));
  assert.deepEqual(order, ["media", "board"]);
});

test("a null script abandons before any media is acquired", async () => {
  let acquired = false;
  await assert.rejects(
    () => produceLongformFilm(TOPIC, deps({
      writeScript: async () => null,
      acquireMedia: async () => { acquired = true; return []; },
    })), /script generation returned null/);
  assert.equal(acquired, false, "nothing is acquired for a film with no script");
});

test("a null storyboard abandons before rendering", async () => {
  let rendered = false;
  await assert.rejects(
    () => produceLongformFilm(TOPIC, deps({
      writeBoard: async () => null,
      render: async () => { rendered = true; return ART; },
    })), /storyboard generation returned null/);
  assert.equal(rendered, false);
});

test("media that fails the acquisition gate stops the chain, naming every problem", async () => {
  await assert.rejects(
    () => produceLongformFilm(TOPIC, deps({
      acquireMedia: async () => [
        { key: "F_AI", licence: "pexels", url: "https://content.pexels.com/aigc-bundle/1/x.mp4", width: 1920, height: 1080 },
        { key: "F_SMALL", licence: "pexels", url: "https://videos.pexels.com/video-files/2/x.mp4", width: 640, height: 360 },
      ],
    })),
    (e) => /media acquisition refused/.test(e.message)
        && /aigc-bundle/.test(e.message)
        && /below 1920×1080/.test(e.message));
});

// ── The full chain ──────────────────────────────────────────────────────────

test("a complete chain produces a passing verdict and a consistent plan", async () => {
  const out = await produceLongformFilm(TOPIC, deps());
  assert.equal(out.verdict.pass, true, JSON.stringify(out.verdict.failures));
  assert.equal(out.slug, "strait");
  assert.equal(out.privacyStatus, "private", "films go up private with a publishAt");
  assert.ok(out.publishAt, "and a slot");
  assert.equal(out.plan.syntheticContent, false, "no generated scenes were acquired");
  assert.equal(out.tiktok.isAigc, false, "and the sidecar agrees");
  assert.equal(out.plan.shorts.length, 3);
});

test("publish is NOT called during production — only the gate may call it", async () => {
  let published = false;
  const out = await produceLongformFilm(TOPIC, deps({ publish: async () => { published = true; } }));
  assert.equal(published, false, "producing a film must never publish it");
  await out.publish();
  assert.equal(published, true, "the returned closure is what publishIfPassed calls");
});

test("a generated scene flows through to BOTH disclosure surfaces", async () => {
  const out = await produceLongformFilm(TOPIC, deps({
    acquireMedia: async () => [CLIP("F_A"),
      { key: "G_SCALES", licence: "public-domain", url: "generated://x", width: 1920, height: 1080,
        synthetic: true, register: "object", note: "unequal scales" }],
  }));
  assert.match(String(out.plan.syntheticContent), /G_SCALES/);
  assert.equal(out.tiktok.isAigc, true);
  assert.deepEqual(out.verdict.failures.filter((f) => f.gate === "disclosure"), [],
    "a derived disclosure must satisfy its own gate");
});

test("a failing measurement yields a failing verdict, and publish stays unreachable", async () => {
  const d = deps();
  const out = await produceLongformFilm(TOPIC, {
    ...d,
    measure: async () => ({ ...(await d.measure()), loudness: { measured: false, why: "ffmpeg said nothing" } }),
  });
  assert.equal(out.verdict.pass, false);
  assert.ok(out.verdict.failures.some((f) => f.measured === "UNVERIFIED"));
});
