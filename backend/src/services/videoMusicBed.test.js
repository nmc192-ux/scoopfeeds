// Tests for the pure parts of the score bed: arc derivation and envelope
// construction. The ffmpeg render itself is exercised by the long-form engine
// daily; what is new here — and what can silently produce a broken filter
// expression — is the mapping from a short's slide list to arc/sections.
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { deriveShortArc, envelope } from "./videoMusicBed.js";

const slides = (types) => types.map((t) => ({ t }));

test("turn strips the arc to 0.40 and rebuilds", () => {
  const s = slides(["title", "stat", "bars", "turn", "kicker"]);
  const starts = [0, 12, 30, 48, 66];
  const { arc, phases } = deriveShortArc(s, starts, 80);
  assert.equal(phases.turn, 48);
  assert.equal(phases.kicker, 66);
  const drop = arc.find(([t, v]) => t === 48 && v === 0.40);
  assert.ok(drop, "turn drop present at the turn slide's start");
  const rebuild = arc.find(([t, v]) => t === 66 && v === 0.90);
  assert.ok(rebuild, "kicker rebuilds");
});

test("no turn card degrades to a plain build, never throws", () => {
  const s = slides(["title", "stat", "stat", "kicker"]);
  const { arc, phases } = deriveShortArc(s, [0, 10, 25, 50], 62);
  assert.equal(phases.turn, null);
  assert.ok(arc.every(([t]) => t >= 0 && t <= 62), "all times within the piece");
  for (let i = 1; i < arc.length; i++) assert.ok(arc[i][0] >= arc[i - 1][0], "monotonic");
});

test("sections exclude phases at the very edges", () => {
  // a turn in the final second must not schedule a riser that starts before 0
  // or a boom that never decays — edge phases are dropped from sections.
  const s = slides(["title", "turn"]);
  const { sections } = deriveShortArc(s, [0, 59.5], 60);
  assert.ok(!sections.includes(59.5), "turn at the tail is not a section gesture");
});

test("single-slide spec produces a valid flat arc", () => {
  const { arc, sections } = deriveShortArc(slides(["title"]), [0], 30);
  assert.ok(arc.length >= 2);
  assert.equal(sections.length, 0);
});

test("envelope compiles to nested if() with numeric endpoints", () => {
  const e = envelope([[0, 0.5], [10, 1.0], [20, 0.4]]);
  assert.ok(e.startsWith("if(lt(t,"), "piecewise structure");
  assert.ok(e.includes("0.4"), "final value is the expression fallback");
  assert.ok(!/NaN|undefined|null/.test(e), "no non-numeric leakage");
});

test("malformed starts are clamped into range", () => {
  const s = slides(["title", "turn", "kicker"]);
  const { arc } = deriveShortArc(s, [0, -5, 500], 60);
  assert.ok(arc.every(([t]) => t >= 0 && t <= 60), "clamped");
});

// ─── The loudness chain (fixed 2026-08-30) ─────────────────────────────────
//
// Shipped defect, measured on a live published short: −12.5 LUFS / −0.2 dBTP
// against the chain's own −14 / −2.0 targets. Root cause was alimiter's
// auto-level default boosting loudnorm's on-target output back up ~+1.4 dB.

test("secondPassLoudnorm builds a LINEAR pass from the measured values", async () => {
  const { secondPassLoudnorm, LOUDNESS_TARGET } = await import("./videoMusicBed.js");
  const f = secondPassLoudnorm({
    input_i: "-11.2", input_tp: "-0.3", input_lra: "4.9", input_thresh: "-21.5", target_offset: "0.1",
  });
  assert.match(f, /linear=true/, "the second pass must be linear — dynamic mode is the defect");
  assert.match(f, /measured_I=-11\.2/);
  assert.match(f, /measured_thresh=-21\.5/);
  assert.match(f, new RegExp(`I=${LOUDNESS_TARGET.I}:TP=${LOUDNESS_TARGET.TP}`));
  // Missing measurements throw rather than silently normalizing from nothing.
  assert.throws(() => secondPassLoudnorm({ input_i: "-11" }), /missing input_tp/);
});

test("the final limiter must never auto-level — that WAS the shipped defect", async () => {
  const src = readFileSync(new URL("./videoMusicBed.js", import.meta.url), "utf8");
  const scoreBody = src.slice(src.indexOf("export async function scoreShort"));
  const finalLimiters = [...scoreBody.matchAll(/alimiter=[^,\[\]`]*/g)].map((m) => m[0]);
  assert.ok(finalLimiters.length >= 1, "scoreShort no longer has a safety limiter at all");
  for (const l of finalLimiters) {
    assert.match(l, /level=false/,
      `${l} — alimiter auto-levels by default, boosting the on-target mix ~+1.4 dB (the −12.5 LUFS defect)`);
  }
});
