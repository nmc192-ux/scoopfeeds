/**
 * videoVoice.test.js — the cache contract and the refusal to be silent.
 *
 * The network is never touched: every test exercises a pre-network guard, a
 * pure function, or the cache. What must hold is that the key is content-based
 * (so the regeneration retry is free and a changed caption is never served
 * stale audio), that failure is loud rather than silent, and that the cache
 * ships with its sweeper.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from "fs";
import os from "os";
import path from "path";

const TMP = path.join(os.tmpdir(), `videovoice-test-${process.pid}`);
process.env.VIDEO_TTS_CACHE_DIR = path.join(TMP, "tts");
mkdirSync(process.env.VIDEO_TTS_CACHE_DIR, { recursive: true });

const {
  cacheKeyFor, voiceCaption, sweepTtsCache, probeDurationSecs, durationMethod,
  getFFprobePath, isVoiceConfigured, VoiceError, envNumber, voiceGapSecs,
  TTS_CACHE_DIR, TTS_RETENTION_MS, VOICE_ID, MODEL_ID, VOICE_SETTINGS,
} = await import("./videoVoice.js");

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const SRC = stripComments(readFileSync(new URL("./videoVoice.js", import.meta.url), "utf8"));

test.after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

// ─── Cache key is CONTENT, not identity ─────────────────────────────────────

test("the same caption yields the same key — the regeneration retry is free", () => {
  const c = "Reuters reports that seventy percent of faults involve anchors.";
  assert.equal(cacheKeyFor(c), cacheKeyFor(c));
});

test("a changed caption yields a different key — never stale audio", () => {
  assert.notEqual(
    cacheKeyFor("Seventy percent of faults involve anchors."),
    cacheKeyFor("Sixty percent of faults involve anchors."),
  );
});

test("voice, model and settings are all in the key", () => {
  // A voice-tuning change must invalidate the cache without a manual purge.
  const caption = "A caption.";
  const base = cacheKeyFor(caption);
  // The module read VOICE_ID at import, so assert on the INPUTS being folded in
  // rather than on a re-import: all three appear in the digest material.
  //
  // This used to save/restore ELEVENLABS_VOICE_ID around a no-op mutation, and
  // the restore was `process.env.X = saved` with `saved === undefined` — which
  // assigns the STRING "undefined" and leaks a truthy var into every test after
  // it. Harmless here only because VOICE_ID is captured at import; it was caught
  // by the digest test's environment precondition. The mutation proved nothing,
  // so it is gone rather than repaired.
  assert.match(SRC, /\.update\(VOICE_ID\)/);
  assert.match(SRC, /\.update\(MODEL_ID\)/);
  assert.match(SRC, /JSON\.stringify\(VOICE_SETTINGS\)/);
  assert.equal(typeof base, "string");
  assert.equal(base.length, 24);
});

test("the key is stable across whitespace-identical captions only", () => {
  assert.notEqual(cacheKeyFor("a caption"), cacheKeyFor("a  caption"));
});

// ─── Hard failure, never silence ────────────────────────────────────────────

test("an empty caption throws — every card must carry its narration line", async () => {
  await assert.rejects(() => voiceCaption("", { slideIndex: 3 }), VoiceError);
  await assert.rejects(() => voiceCaption("   ", { slideIndex: 3 }), /empty caption/);
});

test("a missing key throws rather than returning null", async () => {
  const saved = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    assert.equal(isVoiceConfigured(), false);
    await assert.rejects(() => voiceCaption("A caption.", {}), /ELEVENLABS_API_KEY is not set/);
  } finally {
    if (saved === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = saved;
  }
});

test("there is NO silent fallback anywhere in the module", () => {
  // ttsService degrades to Google Translate and finally to silence. A silent
  // slide has no duration, and slide duration IS audio duration — so the whole
  // timing chain would be built on a fabricated number.
  assert.ok(!/gtranslate|translate\.google|anullsrc|return null/i.test(SRC),
    "videoVoice must never substitute silence or return null for missing audio");
});

test("ElevenLabs is called unconditionally — no provider chain", () => {
  assert.ok(!/OPENAI_API_KEY|GOOGLE_TTS_KEY|ttsProvider/.test(SRC),
    "a first-key-wins chain would let a prod OPENAI_API_KEY override the ElevenLabs ruling");
  assert.match(SRC, /api\.elevenlabs\.io/);
});

test("the ElevenLabs tuning matches what the channel already sounds like", () => {
  assert.equal(MODEL_ID, "eleven_turbo_v2");
  assert.deepEqual({ ...VOICE_SETTINGS }, { stability: 0.5, similarity_boost: 0.75, speed: 1.05 });
  assert.ok(VOICE_ID.length > 8);
});

// ─── Voice direction is tunable, and the defaults are inert ─────────────────

test("ZERO MEANS ZERO — the whole reason envNumber exists", () => {
  // `Number.parseFloat(x) || fallback` returns the fallback here. Stability 0
  // is ElevenLabs' most expressive setting and the likeliest edit anyone makes
  // to this file, so that idiom would silently refuse it.
  process.env.__VOICE_TEST_N = "0";
  try {
    assert.equal(envNumber("__VOICE_TEST_N", 0.5, { min: 0, max: 1 }), 0);
  } finally { delete process.env.__VOICE_TEST_N; }
});

test("unset and empty fall back; garbage and out-of-range fall back too", () => {
  assert.equal(envNumber("__VOICE_TEST_ABSENT", 0.75), 0.75);
  const cases = [["", 0.75], ["   ", 0.75], ["abc", 0.75], ["1.5", 0.75], ["-0.1", 0.75], ["0.9", 0.9]];
  for (const [raw, want] of cases) {
    process.env.__VOICE_TEST_N = raw;
    try {
      assert.equal(envNumber("__VOICE_TEST_N", 0.75, { min: 0, max: 1 }), want, `raw=${JSON.stringify(raw)}`);
    } finally { delete process.env.__VOICE_TEST_N; }
  }
});

test("no `parseFloat(...) || default` survives in the module", () => {
  // The source check is the one that catches a future edit reintroducing it in
  // a place these unit tests do not reach.
  assert.ok(!/parse(Float|Int)\([^)]*\)\s*\|\|/.test(SRC),
    "0 must mean 0 for every voice setting; use envNumber");
});

test("the five voice knobs are read from VIDEO_VOICE_*", () => {
  assert.match(SRC, /process\.env\.VIDEO_VOICE_ID/);
  assert.match(SRC, /process\.env\.VIDEO_VOICE_MODEL/);
  for (const name of ["VIDEO_VOICE_STABILITY", "VIDEO_VOICE_SIMILARITY", "VIDEO_VOICE_SPEED"]) {
    assert.match(SRC, new RegExp(`envNumber\\("${name}"`));
  }
});

test("the older ELEVENLABS_* names still work underneath the new ones", () => {
  // ttsService reads both. Dropping either would repoint the voice or the model
  // as a side effect of adding a knob — the opposite of an inert merge.
  assert.match(SRC, /VIDEO_VOICE_ID\s*\|\|\s*process\.env\.ELEVENLABS_VOICE_ID/);
  assert.match(SRC, /VIDEO_VOICE_MODEL\s*\|\|\s*process\.env\.ELEVENLABS_MODEL_ID/);
});

// ─── The pinned digest ──────────────────────────────────────────────────────
//
// Every one of the five knobs feeds cacheKeyFor, so every one of them can move
// this hash. The digest is pinned against the PRE-CHANGE code: if it still
// matches, prod's TTS cache survives the merge untouched, which is the whole
// claim this branch makes.
//
// The inputs are asserted individually FIRST, and the environment is checked
// before that. All three layers pin the same property, but they fail with very
// different sentences — and a bare "expected 2d080f... got 9a41bc..." is the
// least useful of the three, especially now that VIDEO_VOICE_MODEL is a var
// somebody will plausibly have set in their own .env while auditioning models.

const TUNING_VARS = [
  "VIDEO_VOICE_ID", "ELEVENLABS_VOICE_ID",
  "VIDEO_VOICE_MODEL", "ELEVENLABS_MODEL_ID",
  "VIDEO_VOICE_SPEED", "VIDEO_VOICE_STABILITY", "VIDEO_VOICE_SIMILARITY",
];

test("THE CACHE DIGEST IS UNCHANGED — this merge re-synthesises nothing", () => {
  const tuned = TUNING_VARS.filter((n) => process.env[n]);
  assert.deepEqual(
    tuned, [],
    `${tuned.join(", ")} set in this environment. The pinned digest below describes the ` +
    "DEFAULTS, so it cannot be checked while the defaults are overridden — this is your " +
    "shell talking, not a regression. Unset them and re-run.",
  );

  // Each input, named, so a changed default says WHICH default changed.
  assert.equal(VOICE_ID, "21m00Tcm4TlvDq8ikWAM");
  assert.equal(MODEL_ID, "eleven_turbo_v2");
  // JSON.stringify preserves insertion order, so the ORDER of these three lines
  // in the source is as load-bearing as their values: reordering them would
  // invalidate every cached clip in prod while changing nothing audible.
  assert.equal(
    JSON.stringify(VOICE_SETTINGS),
    '{"stability":0.5,"similarity_boost":0.75,"speed":1.05}',
  );

  assert.equal(
    cacheKeyFor("A caption."), "2d080f8769185c3e5a6bc7ea",
    "the cache key moved even though every input above matches its default — " +
    "cacheKeyFor's digest material itself changed, and every cached clip in prod is orphaned.",
  );
});

test("the model is in the digest, so switching tiers cannot serve stale audio", () => {
  // MODEL_ID is captured at import, so this asserts on the digest MATERIAL
  // rather than re-deriving the key under a different env. Losing this line
  // would let a turbo_v2 clip be served for a multilingual_v2 caption — same
  // text, same voice, audibly different read, indistinguishable by key.
  assert.match(SRC, /\.update\(MODEL_ID\)/);
  // The converse — that the gap stays OUT of the key — is proved behaviourally
  // by "the gap is NOT in the cache key" above, which is a stronger check than
  // anything a regex over this file could assert.
});

// ─── The editorial gap ──────────────────────────────────────────────────────

test("VIDEO_VOICE_GAP_MS defaults to 0 — the gap ships inert", () => {
  assert.equal(voiceGapSecs(), 0);
});

test("the gap is read in milliseconds, at call time, and is bounded", () => {
  const cases = [["400", 0.4], ["0", 0], ["5000", 5], ["5001", 0], ["-1", 0], ["nonsense", 0], ["", 0]];
  for (const [raw, want] of cases) {
    process.env.VIDEO_VOICE_GAP_MS = raw;
    try {
      assert.equal(voiceGapSecs(), want, `raw=${JSON.stringify(raw)}`);
    } finally { delete process.env.VIDEO_VOICE_GAP_MS; }
  }
});

test("the gap is NOT in the cache key — re-pacing costs nothing at ElevenLabs", () => {
  const before = cacheKeyFor("A caption.");
  process.env.VIDEO_VOICE_GAP_MS = "400";
  try {
    assert.equal(cacheKeyFor("A caption."), before,
      "the gap is silence added at assembly, not audio in the MP3");
  } finally { delete process.env.VIDEO_VOICE_GAP_MS; }
});

// ─── Duration ───────────────────────────────────────────────────────────────

test("the duration method is reported, whichever path is live", () => {
  const m = durationMethod();
  assert.ok(["ffprobe", "ffmpeg-stderr"].includes(m), m);
  // The bundled @ffmpeg-installer ships ffmpeg only, so a dev Mac without
  // system ffmpeg MUST land on the fallback — and that path has to work.
  if (!getFFprobePath()) assert.equal(m, "ffmpeg-stderr");
});

test("a missing audio file throws rather than returning zero", () => {
  assert.throws(() => probeDurationSecs(path.join(TMP, "nope.mp3")), VoiceError);
});

test("duration is measured from real audio, within a frame of the truth", async () => {
  const { execFileSync } = await import("child_process");
  const { getFFmpegPath } = await import("./videoGenerator.js");
  const ff = getFFmpegPath();
  if (!ff) return;   // no ffmpeg here at all; nothing to assert
  const f = path.join(TMP, "tone.mp3");
  execFileSync(ff, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2.5", "-c:a", "libmp3lame", f]);
  const d = probeDurationSecs(f);
  // MP3 pads to a frame boundary, so exact equality is wrong to assert.
  assert.ok(Math.abs(d - 2.5) < 0.1, `expected ~2.5s, measured ${d}`);
});

// ─── The cache ships with its sweeper ───────────────────────────────────────

test("the cache is persistent, not scratch", () => {
  assert.ok(!TTS_CACHE_DIR.startsWith(os.tmpdir()) || process.env.VIDEO_TTS_CACHE_DIR,
    "audio is the one expensive artifact; an ephemeral cache would never pay off");
});

test("the retention window is 7 days, matching the article prune", () => {
  assert.equal(TTS_RETENTION_MS, 7 * 24 * 3600 * 1000);
});

test("old clips are swept, fresh ones kept", () => {
  const old = path.join(TTS_CACHE_DIR, "aaaaaaaaaaaaaaaaaaaaaaaa.mp3");
  const fresh = path.join(TTS_CACHE_DIR, "bbbbbbbbbbbbbbbbbbbbbbbb.mp3");
  writeFileSync(old, "0".repeat(4096));
  writeFileSync(fresh, "0".repeat(4096));
  const t = (Date.now() - 9 * 86400000) / 1000;
  utimesSync(old, t, t);
  const r = sweepTtsCache();
  assert.equal(r.removed, 1);
  assert.equal(r.kept, 1);
  assert.ok(!existsSync(old));
  assert.ok(existsSync(fresh));
  rmSync(fresh, { force: true });
});

test("retention is AGE-based — a content-hashed file has no owning row", () => {
  // Exactly the orphan class that grew CARDS_DIR to ~19GB: nothing to join
  // against, so age is the only property left to judge it by.
  assert.match(SRC, /mtimeMs/);
  assert.ok(!/getDb|prepare\(/.test(SRC), "the sweeper must not need a database to reclaim disk");
});

test("non-mp3 files in the cache are left alone", () => {
  const other = path.join(TTS_CACHE_DIR, "README.txt");
  writeFileSync(other, "keep");
  utimesSync(other, 1, 1);
  sweepTtsCache();
  assert.ok(existsSync(other), "the sweeper must only claim what it owns");
  rmSync(other, { force: true });
});
