/**
 * ttsPronunciations.test.js — the audio says the right thing; the caption keeps
 * the original spelling.
 *
 * The Kokoro fixtures below are REAL: the adapter sent the respelled text to
 * Kokoro-FastAPI v0.9.0 (voice bm_george, 2026-09-27) and these are the
 * timestamps it returned, rounded to 4 dp. Kokoro's phonemes for the
 * respellings, from /dev/phonemize: "Shee" → ʃˈiː, "ee-on" → ˈiːˌɒn (against
 * "Xi" → zˌI and "E.ON" → ˌiːˌQˈɛn, which were the bugs).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { mkdirSync, rmSync } from "fs";
import os from "os";
import path from "path";

const TMP = path.join(os.tmpdir(), `tts-pron-test-${process.pid}`);
process.env.VIDEO_TTS_CACHE_DIR = path.join(TMP, "tts");
mkdirSync(process.env.VIDEO_TTS_CACHE_DIR, { recursive: true });

const { PRONUNCIATIONS, applyPronunciations, _internals: pron } = await import("./ttsPronunciations.js");
const { cacheKeyFor, alignKokoroWords, _internals } = await import("./videoVoice.js");

test.after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

const stamps = (rows) => rows.map(([word, start_time, end_time]) => ({ word, start_time, end_time }));
const XI_CAPTION = "Xi Jinping arrived in Moscow on Monday.";
const XI_STAMPS = stamps([["Shee", 0.0491, 0.2866], ["Jinping", 0.2866, 0.9241], ["arrived", 0.9241, 1.5366], ["in", 1.5366, 1.6991], ["Moscow", 1.6991, 2.3616], ["on", 2.3616, 2.5741], ["Monday", 2.5741, 3.3491], [".", 3.3491, 3.5491]]);
const EON_CAPTION = "E.ON, the German utility, said profits would fall.";
const EON_STAMPS = stamps([["ee-on", 0.0182, 0.5432], [",", 0.5432, 0.5932], ["the", 0.5932, 0.7307], ["German", 0.7307, 1.1182], ["utility", 1.1182, 1.8682], [",", 1.8682, 1.9932], ["said", 1.9932, 2.2432], ["profits", 2.2432, 2.7182], ["would", 2.7182, 2.9307], ["fall", 2.9307, 3.6682], [".", 3.6682, 3.8432]]);

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k];
  }
  try { return await fn(); }
  finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const KOKORO = { VIDEO_TTS_PROVIDER: "kokoro", VIDEO_TTS_KOKORO_VOICE: undefined, VIDEO_TTS_KOKORO_SPEED: undefined };

/** Run the real Kokoro adapter against a canned reply; returns what was SENT and what came back. */
async function throughAdapter(caption, reply) {
  const real = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (_url, opts) => {
    sent = JSON.parse(opts.body).input;
    return { ok: true, status: 200, json: async () => ({ audio: Buffer.alloc(4096, 5).toString("base64"), audio_format: "audio/mpeg", timestamps: reply }) };
  };
  try {
    const { words } = await withEnv(KOKORO, () => _internals.kokoro(caption));
    return { sent, words };
  } finally { globalThis.fetch = real; }
}

// ─── The list ───────────────────────────────────────────────────────────────

test("the list starts with Xi → Shee and E.ON → ee-on", () => {
  const map = Object.fromEntries(PRONUNCIATIONS.map((p) => [p.word, p.say]));
  assert.equal(map.Xi, "Shee");
  assert.equal(map["E.ON"], "ee-on");
});

test("every entry is usable: one written word, a non-empty respelling", () => {
  for (const p of PRONUNCIATIONS) {
    assert.ok(typeof p.word === "string" && p.word.trim() && !/\s/.test(p.word.trim()), `bad word: ${JSON.stringify(p)}`);
    assert.ok(typeof p.say === "string" && p.say.trim(), `bad say: ${JSON.stringify(p)}`);
  }
  assert.equal(pron.compile(PRONUNCIATIONS).length, PRONUNCIATIONS.length, "an entry on the list is being silently skipped");
});

test("a two-word entry is skipped, not half-applied (the mapper matches one word at a time)", () => {
  assert.equal(pron.compile([{ word: "Xi Jinping", say: "Shee Jinping" }]).length, 0);
  assert.equal(pron.compile([{ word: "", say: "x" }, { word: "X", say: "" }, null]).length, 0);
});

// ─── The respelling ─────────────────────────────────────────────────────────

test("Xi Jinping is SENT as \"Shee Jinping\"", () => {
  assert.equal(applyPronunciations(XI_CAPTION), "Shee Jinping arrived in Moscow on Monday.");
  assert.equal(applyPronunciations("President Xi's visit"), "President Shee's visit");
});

test("E.ON is SENT as \"ee-on\" — with a comma after it, at a sentence end, or mid-sentence", () => {
  assert.equal(applyPronunciations("E.ON, the utility"), "ee-on, the utility");
  assert.equal(applyPronunciations("Shares in E.ON."), "Shares in ee-on.");
  assert.equal(applyPronunciations("E.ON said"), "ee-on said");
});

test("only the whole word is touched — never a lookalike", () => {
  for (const s of ["Xinhua reports", "Pope Pius XI", "a maxi dress", "xi", "E.ONX", "E.ON.X", "EON", "Xi2"]) {
    assert.equal(applyPronunciations(s), s, s);
  }
});

test("text with nothing on the list comes back unchanged", () => {
  const s = "The CDC reports 5,105 confirmed cases — up 24% since 2027.";
  assert.equal(applyPronunciations(s), s);
});

// ─── THE POINT: audio respelled, captions untouched ─────────────────────────

test("\"Xi\": Kokoro is sent \"Shee\", the CAPTION still shows \"Xi\", timed directly", async () => {
  const r = await throughAdapter(XI_CAPTION, XI_STAMPS);
  assert.equal(r.sent, "Shee Jinping arrived in Moscow on Monday.");
  assert.deepEqual(r.words.map((w) => w.word), XI_CAPTION.split(/\s+/), "the caption keeps its own spelling");
  assert.equal(r.words[0].word, "Xi");
  assert.deepEqual([r.words[0].start, r.words[0].end], [0.049, 0.287], "Xi takes the time Kokoro spent saying \"Shee\"");
});

test("\"E.ON,\": Kokoro is sent \"ee-on,\", the CAPTION still shows \"E.ON,\", timed directly", async () => {
  const r = await throughAdapter(EON_CAPTION, EON_STAMPS);
  assert.equal(r.sent, "ee-on, the German utility, said profits would fall.");
  assert.deepEqual(r.words.map((w) => w.word), EON_CAPTION.split(/\s+/));
  assert.equal(r.words[0].word, "E.ON,");
  assert.deepEqual([r.words[0].start, r.words[0].end], [0.018, 0.543]);
});

test("the respelled words are ANCHORED, not guessed: every caption word is timed directly", () => {
  const say = (w) => applyPronunciations(w);
  const xi = alignKokoroWords(XI_CAPTION, XI_STAMPS, { say });
  assert.equal(xi.matched, xi.words.length);
  const eon = alignKokoroWords(EON_CAPTION, EON_STAMPS, { say });
  assert.equal(eon.matched, eon.words.length);
  // Without the respelling the mapper cannot see that "Shee" is "Xi", and has
  // to place it between its neighbours instead.
  assert.equal(alignKokoroWords(XI_CAPTION, XI_STAMPS).matched, xi.words.length - 1);
});

// ─── The cache ──────────────────────────────────────────────────────────────

test("a caption the list does not touch keeps its Kokoro key — editing the list re-voices only what it affects", async () => {
  // Pinned from the code merged in #154, before the list existed.
  await withEnv(KOKORO, () => assert.equal(cacheKeyFor("A caption.", "kokoro"), "b9a40a700242b7abba2ddf93"));
});

test("a caption the list DOES touch gets a new key, so an old mispronounced clip is never served", async () => {
  // 50a01af6… is this caption's key under #154 — the one that may hold a
  // cached "Zye Jinping" in prod. The respelling must move it.
  await withEnv(KOKORO, () => {
    const k = cacheKeyFor(XI_CAPTION, "kokoro");
    assert.notEqual(k, "50a01af68a5761ad0e806c54");
    assert.equal(k, "482a4dbe7beb109b02884376");
  });
});

test("the ElevenLabs path never reads the list — its key and its request are unchanged", async () => {
  await withEnv({ VIDEO_TTS_PROVIDER: undefined }, () => {
    const el = createHash("sha1").update(XI_CAPTION).update("|").update("21m00Tcm4TlvDq8ikWAM")
      .update("|").update("eleven_turbo_v2").update("|").update('{"stability":0.5,"similarity_boost":0.75,"speed":1.05}')
      .digest("hex").slice(0, 24);
    // Only meaningful with the voice defaults; the digest test in videoVoice.test.js guards those.
    if (!process.env.VIDEO_VOICE_ID && !process.env.ELEVENLABS_VOICE_ID && !process.env.VIDEO_VOICE_MODEL) {
      assert.equal(cacheKeyFor(XI_CAPTION, "elevenlabs"), el);
    }
  });
  const real = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (_u, opts) => { body = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ audio_base64: Buffer.alloc(4096, 1).toString("base64"), alignment: null }) }; };
  try { await _internals.elevenLabs(XI_CAPTION); } finally { globalThis.fetch = real; }
  assert.equal(body.text, XI_CAPTION, "ElevenLabs is sent the caption as written");
});
