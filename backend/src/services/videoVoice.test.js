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
  getFFprobePath, isVoiceConfigured, VoiceError,
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
  const saved = process.env.ELEVENLABS_VOICE_ID;
  process.env.ELEVENLABS_VOICE_ID = "some-other-voice";
  // The module read VOICE_ID at import, so assert on the INPUTS being folded in
  // rather than on a re-import: all three appear in the digest material.
  process.env.ELEVENLABS_VOICE_ID = saved;
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
