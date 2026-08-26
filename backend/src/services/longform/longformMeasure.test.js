/**
 * longformMeasure.test.js — the ffmpeg side of the gate (#79/#80).
 *
 * The parsers are tested against RECORDED ffmpeg output rather than a live
 * render, so the suite is fast and does not depend on a file that only exists
 * after a build. The module itself was verified end-to-end against a real
 * rendered film, which correctly failed four gates (mono audio, 59s duration,
 * no sub-2s shots, no Shorts) — all true of that fixture.
 *
 * THE PROPERTY UNDER TEST IS THAT NOTHING DEFAULTS. Every failure path must
 * produce `measured: false`, because qcVerdict turns that into a refusal and
 * has no way to express "we didn't check" that reads as a pass. A parser that
 * returns a plausible number when ffmpeg said nothing is how an unchecked film
 * ships.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { measureRhythm, measureSrt, measureFilm } from "./longformMeasure.js";
import { qcVerdict } from "./longformQcGate.js";

const TMP = mkdtempSync(path.join(os.tmpdir(), "measure-"));
const write = (name, body) => { const f = path.join(TMP, name); writeFileSync(f, body); return f; };

// ── SRT ─────────────────────────────────────────────────────────────────────

const GOOD_SRT = `1
00:00:01,000 --> 00:00:09,070
First line.

2
00:00:09,370 --> 00:00:14,270
Second line.
`;

test("a well-formed SRT yields cue count and last cue", () => {
  const m = measureSrt(write("good.srt", GOOD_SRT));
  assert.equal(m.measured, true);
  assert.equal(m.value.cues, 2);
  assert.equal(m.value.lastCueSecs, 9.37);
});

test("a MALFORMED timestamp is caught explicitly, not silently under-counted", () => {
  // The bug fixed in #98 emitted `00:00:28,1000`. Such a cue does not match a
  // strict pattern, so a naive parser reports FEWER cues rather than a
  // problem — and a short-but-plausible count would pass the gate.
  const bad = GOOD_SRT + "\n3\n00:00:28,1000 --> 00:00:30,000\nThird.\n";
  const m = measureSrt(write("bad.srt", bad));
  assert.equal(m.measured, false);
  assert.match(m.why, /malformed timestamp\(s\) — 4-digit milliseconds/);
});

test("a missing or empty SRT is unmeasured, never zero", () => {
  assert.equal(measureSrt(path.join(TMP, "nope.srt")).measured, false);
  assert.equal(measureSrt(write("empty.srt", "")).measured, false);
});

// ── Rhythm ──────────────────────────────────────────────────────────────────

test("rhythm is read from the shot PLAN, and both metrics come out", () => {
  const f = write("shots.json", JSON.stringify(
    [1.5, 3, 4, 5, 9].map((s) => ({ seconds: s }))));
  const r = measureRhythm(f);
  assert.equal(r.median.value, 4);
  assert.equal(r.under2s.value, 0.2, "one of five shots is under 2s");
});

test("an absent or unparseable shot plan makes BOTH rhythm gates unmeasured", () => {
  for (const f of [path.join(TMP, "none.json"), write("junk.json", "{not json")]) {
    const r = measureRhythm(f);
    assert.equal(r.median.measured, false);
    assert.equal(r.under2s.measured, false);
  }
});

// ── Nothing defaults ────────────────────────────────────────────────────────

test("A MISSING FILM MAKES EVERY GATE UNMEASURED — and therefore fails", () => {
  return measureFilm({ ffmpegPath: "/nonexistent/ffmpeg", film: path.join(TMP, "nope.mp4") })
    .then((m) => {
      for (const [k, v] of Object.entries(m)) {
        if (k === "shorts") { assert.deepEqual(v, []); continue; }
        assert.equal(v.measured, false, `${k} must be unmeasured, not defaulted`);
        assert.ok(v.why, `${k} must say why`);
      }
      const verdict = qcVerdict(m);
      assert.equal(verdict.pass, false, "an unmeasurable film can never pass");
      assert.ok(verdict.failures.every((f) => f.measured === "UNVERIFIED"));
    });
});

test("a broken ffmpeg produces unmeasured gates rather than throwing", async () => {
  // A probe that explodes must not abort the others — one broken measurement
  // would otherwise hide the state of every remaining gate.
  const film = write("fake.mp4", "not a video");
  const m = await measureFilm({ ffmpegPath: "/nonexistent/ffmpeg", film,
    srtPath: write("s.srt", GOOD_SRT), shotsJsonPath: path.join(TMP, "none.json") });
  assert.equal(m.loudness.measured, false);
  assert.equal(m.srt.measured, true, "the SRT still measured — one bad probe does not hide the rest");
});

test("a Short that cannot be measured fails by name, not by omission", async () => {
  const m = await measureFilm({ ffmpegPath: "/nonexistent/ffmpeg",
    film: write("f2.mp4", "x"), shortFiles: [path.join(TMP, "missing_short.mp4")] });
  assert.equal(m.shorts.length, 1, "the Short must appear as a failure, not vanish from the list");
  assert.equal(m.shorts[0].measured, false);
  assert.equal(m.shorts[0].name, "missing_short.mp4");
});
