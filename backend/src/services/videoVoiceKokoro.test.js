/**
 * videoVoiceKokoro.test.js — the Kokoro provider, the switch, and the contract
 * that nothing downstream can tell which provider spoke.
 *
 * The network is never touched: fetch is replaced per test. The fixture below
 * is REAL — the `timestamps` array Kokoro-FastAPI v0.9.0 returned from
 * /dev/captioned_speech for KOKORO_CAPTION with voice bm_george (sandbox,
 * 2026-09-26), rounded to 4 dp. It is what makes the mapping tests honest: the
 * normaliser's rewrites ("$83" → "eighty-three … dollars", "2027" → "twenty
 * twenty-seven", "E.ON" → "E-ON", punctuation as tokens, a start of -0.0015)
 * are the server's, not a guess at them.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { execFileSync, execFile } from "child_process";
import os from "os";
import path from "path";

const TMP = path.join(os.tmpdir(), `videovoice-kokoro-test-${process.pid}`);
process.env.VIDEO_TTS_CACHE_DIR = path.join(TMP, "tts");
mkdirSync(process.env.VIDEO_TTS_CACHE_DIR, { recursive: true });

const {
  voiceProvider, kokoroConfig, fallbackProvider, voiceIdentity, withVoiceIdentity,
  isVoiceConfigured, cacheKeyFor, alignKokoroWords, wordsFromAlignment, voiceCaption,
  VoiceError, ttsUsageSnapshot, ttsSpendSince, probeTtsService, logTtsReachability,
  TTS_CACHE_DIR, _internals,
} = await import("./videoVoice.js");
const { getFFmpegPath } = await import("./videoGenerator.js");

test.after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

const KOKORO_CAPTION = "E.ON, the German utility, raised $83 million — up 24% since 2027. Is NATO ready?";
const KOKORO_STAMPS = [["E-ON", -0.0015, 0.5485], [",", 0.5485, 0.5985], ["the", 0.5985, 0.736], ["German", 0.736, 1.1235], ["utility", 1.1235, 1.8735], [",", 1.8735, 2.011], ["raised", 2.011, 2.461], ["eighty-three", 2.461, 3.111], ["million", 3.111, 3.4985], ["dollars", 3.4985, 4.1985], ["—", 4.1985, 4.2735], ["up", 4.2735, 4.4735], ["twenty-four", 4.4735, 4.9735], ["percent", 4.9735, 5.486], ["since", 5.486, 5.7235], ["twenty", 5.7235, 6.0485], ["twenty-seven", 6.0485, 7.0735], [".", 7.0735, 7.1735], ["Is", 7.1735, 7.3735], ["NATO", 7.3735, 7.8235], ["ready", 7.8235, 8.4985], ["?", 8.4985, 8.6735]]
  .map(([word, start_time, end_time]) => ({ word, start_time, end_time }));

/** Run fn with env vars set (undefined = unset), restoring exactly afterwards. */
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k];
  }
  try { return await fn(); }
  finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

/**
 * A request that never answers — only its AbortSignal can end it. It holds a
 * timer the way a real hung socket holds a handle: AbortSignal.timeout's own
 * timer is unref'd, so without one the event loop would empty mid-test.
 */
const hang = (opts) => new Promise((_, rej) => {
  const keep = setInterval(() => {}, 1000);
  opts.signal.addEventListener("abort", () => { clearInterval(keep); rej(opts.signal.reason); });
});

async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

const KOKORO = { VIDEO_TTS_PROVIDER: "kokoro", VIDEO_TTS_FALLBACK: undefined, VIDEO_TTS_KOKORO_VOICE: undefined, VIDEO_TTS_KOKORO_SPEED: undefined };

// Real MP3 bytes, so voiceCaption's duration probe runs for real. Null when
// this machine has no ffmpeg at all; the tests that need it then skip.
let MP3 = null;
{
  const ff = getFFmpegPath();
  if (ff) {
    const f = path.join(TMP, "tone.mp3");
    try {
      execFileSync(ff, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=1.5", "-ar", "24000", "-c:a", "libmp3lame", f]);
      MP3 = readFileSync(f);
    } catch { MP3 = null; }
  }
}
const kokoroReply = (stamps = KOKORO_STAMPS, audio = MP3 || Buffer.alloc(4096, 5)) => ({
  ok: true, status: 200,
  json: async () => ({ audio: Buffer.from(audio).toString("base64"), audio_format: "audio/mpeg", timestamps: stamps }),
});

// ─── The provider switch ────────────────────────────────────────────────────

test("the code default is ElevenLabs — merging this changes nothing until the env line", async () => {
  await withEnv({ VIDEO_TTS_PROVIDER: undefined }, () => assert.equal(voiceProvider(), "elevenlabs"));
  await withEnv({ VIDEO_TTS_PROVIDER: "" }, () => assert.equal(voiceProvider(), "elevenlabs"));
});

test("VIDEO_TTS_PROVIDER=kokoro selects Kokoro, case- and space-insensitively", async () => {
  for (const v of ["kokoro", "Kokoro", " KOKORO "]) {
    await withEnv({ VIDEO_TTS_PROVIDER: v }, () => assert.equal(voiceProvider(), "kokoro", v));
  }
});

test("an unknown provider falls back to the default, loudly, rather than inventing one", async () => {
  await withEnv({ VIDEO_TTS_PROVIDER: "openai" }, () => assert.equal(voiceProvider(), "elevenlabs"));
});

test("Kokoro defaults: bm_george, speed 1.0, http://tts:8880, a bounded timeout", async () => {
  await withEnv({ VIDEO_TTS_KOKORO_VOICE: undefined, VIDEO_TTS_KOKORO_SPEED: undefined, VIDEO_TTS_KOKORO_URL: undefined, VIDEO_TTS_KOKORO_TIMEOUT_MS: undefined }, () => {
    const k = kokoroConfig();
    assert.equal(k.voice, "bm_george");
    assert.equal(k.speed, 1.0);
    assert.equal(k.url, "http://tts:8880");
    assert.ok(k.timeoutMs >= 1000 && k.timeoutMs <= 300000);
  });
  await withEnv({ VIDEO_TTS_KOKORO_VOICE: "bm_lewis", VIDEO_TTS_KOKORO_SPEED: "0.9", VIDEO_TTS_KOKORO_URL: "http://x:1/" }, () => {
    assert.deepEqual([kokoroConfig().voice, kokoroConfig().speed, kokoroConfig().url], ["bm_lewis", 0.9, "http://x:1"]);
  });
});

test("Kokoro needs no API key — ELEVENLABS_API_KEY decides nothing when Kokoro is selected", async () => {
  await withEnv({ ...KOKORO, ELEVENLABS_API_KEY: undefined }, () => assert.equal(isVoiceConfigured(), true));
  await withEnv({ VIDEO_TTS_PROVIDER: undefined, ELEVENLABS_API_KEY: undefined }, () => assert.equal(isVoiceConfigured(), false));
});

test("the fallback is OFF unless VIDEO_TTS_FALLBACK=elevenlabs, and only means anything under Kokoro", async () => {
  await withEnv({ ...KOKORO }, () => assert.equal(fallbackProvider(), null));
  await withEnv({ ...KOKORO, VIDEO_TTS_FALLBACK: "elevenlabs" }, () => assert.equal(fallbackProvider(), "elevenlabs"));
  await withEnv({ VIDEO_TTS_PROVIDER: undefined, VIDEO_TTS_FALLBACK: "elevenlabs" }, () => assert.equal(fallbackProvider(), null));
});

// ─── Two cache key spaces ───────────────────────────────────────────────────

test("a Kokoro clip and an ElevenLabs clip of the same caption can never share a key", async () => {
  await withEnv({ ...KOKORO }, () => {
    assert.notEqual(cacheKeyFor("A caption.", "kokoro"), cacheKeyFor("A caption.", "elevenlabs"));
    assert.equal(cacheKeyFor("A caption."), cacheKeyFor("A caption.", "kokoro"), "the selected provider is the default");
  });
});

test("the ElevenLabs key is byte-identical to the pre-Kokoro digest, whatever the provider", async () => {
  // Same pin as videoVoice.test.js "THE CACHE DIGEST IS UNCHANGED": flipping
  // back to ElevenLabs finds its 7-day cache where it left it.
  await withEnv({ ...KOKORO }, () => assert.equal(cacheKeyFor("A caption.", "elevenlabs"), "2d080f8769185c3e5a6bc7ea"));
});

test("the Kokoro voice and speed are in the Kokoro key", async () => {
  const base = await withEnv({ ...KOKORO }, () => cacheKeyFor("A caption.", "kokoro"));
  const voice = await withEnv({ ...KOKORO, VIDEO_TTS_KOKORO_VOICE: "bm_lewis" }, () => cacheKeyFor("A caption.", "kokoro"));
  const speed = await withEnv({ ...KOKORO, VIDEO_TTS_KOKORO_SPEED: "1.1" }, () => cacheKeyFor("A caption.", "kokoro"));
  assert.equal(new Set([base, voice, speed]).size, 3);
});

// ─── The fingerprint ────────────────────────────────────────────────────────

test("withVoiceIdentity: unchanged for ElevenLabs, changed (same length, hex) for Kokoro", async () => {
  const fp = "0123456789ab";
  await withEnv({ VIDEO_TTS_PROVIDER: undefined }, () => {
    assert.equal(voiceIdentity(), null);
    assert.equal(withVoiceIdentity(fp), fp);
  });
  await withEnv({ ...KOKORO }, () => {
    assert.equal(voiceIdentity(), "kokoro|bm_george");
    const k = withVoiceIdentity(fp);
    assert.notEqual(k, fp);
    assert.match(k, /^[0-9a-f]{12}$/);
  });
  const george = await withEnv({ ...KOKORO }, () => withVoiceIdentity(fp));
  const lewis = await withEnv({ ...KOKORO, VIDEO_TTS_KOKORO_VOICE: "bm_lewis" }, () => withVoiceIdentity(fp));
  assert.notEqual(george, lewis, "the voice is in the identity, not just the provider");
});

/** Import a module in a fresh process under `env` and print one export. */
function exportUnder(env, mod, name) {
  const code = `import(${JSON.stringify(new URL(mod, import.meta.url).href)}).then((m) => { process.stdout.write(String(m.${name})); process.exit(0); })`;
  const childEnv = { ...process.env, ...env };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete childEnv[k];
  return new Promise((res, rej) => execFile(process.execPath, ["--input-type=module", "-e", code],
    { env: childEnv, timeout: 60000 }, (e, out, err) => (e ? rej(new Error(String(err).slice(-400))) : res(out.trim()))));
}

test("VIDEO_BUILDER_FINGERPRINT changes with the provider, and not otherwise", async () => {
  const off = { VIDEO_TTS_PROVIDER: undefined, VIDEO_TTS_KOKORO_VOICE: undefined };
  const a = await exportUnder(off, "./videoSlideRenderer.js", "VIDEO_BUILDER_FINGERPRINT");
  const b = await exportUnder({ ...off, VIDEO_TTS_PROVIDER: "elevenlabs" }, "./videoSlideRenderer.js", "VIDEO_BUILDER_FINGERPRINT");
  const k = await exportUnder({ ...off, VIDEO_TTS_PROVIDER: "kokoro" }, "./videoSlideRenderer.js", "VIDEO_BUILDER_FINGERPRINT");
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.equal(a, b, "explicit elevenlabs is the default — the key must not move");
  assert.notEqual(a, k, "a Kokoro render must never share a design key with an ElevenLabs one");
  assert.match(k, /^[0-9a-f]{12}$/);
});

test("the shot engine's design key folds the voice in the same way", () => {
  const src = readFileSync(new URL("./shots/shotProduce.js", import.meta.url), "utf8");
  assert.match(src, /SHOT_BUILDER_FINGERPRINT = withVoiceIdentity\(/);
});

// ─── The word mapping ───────────────────────────────────────────────────────

test("ONE ENTRY PER CAPTION WORD, in the caption's spelling — the shape every consumer reads", () => {
  const { words } = alignKokoroWords(KOKORO_CAPTION, KOKORO_STAMPS);
  const raw = KOKORO_CAPTION.trim().split(/\s+/);
  // shotVideo.anchorTime uses exact timings only when these two counts agree.
  assert.equal(words.length, raw.length);
  assert.deepEqual(words.map((w) => w.word), raw, "captions display w.word — it must say \"$83\", not \"eighty-three\"");
  for (const w of words) {
    assert.deepEqual(Object.keys(w), ["word", "start", "end"]);
    assert.ok(w.start >= 0 && w.end >= w.start, JSON.stringify(w));
  }
  for (let i = 1; i < words.length; i++) assert.ok(words[i].start >= words[i - 1].start, `non-monotonic at ${i}`);
});

test("the shape is IDENTICAL to what the ElevenLabs adapter produces", () => {
  // Same caption through ElevenLabs' character-alignment grouping, with dummy
  // times: the keys, the count and the words must match exactly.
  const chars = [...KOKORO_CAPTION];
  const el = wordsFromAlignment({
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => i * 0.05),
    character_end_times_seconds: chars.map((_, i) => i * 0.05 + 0.05),
  });
  const ko = alignKokoroWords(KOKORO_CAPTION, KOKORO_STAMPS).words;
  assert.deepEqual(ko.map((w) => w.word), el.map((w) => w.word));
  assert.deepEqual(ko.map((w) => Object.keys(w)), el.map((w) => Object.keys(w)));
  assert.ok(ko.every((w) => typeof w.start === "number" && typeof w.end === "number"));
});

const byWord = (words) => Object.fromEntries(words.map((w) => [w.word, w]));
// Times are rounded to the millisecond, so compare to the fixture within 1.5 ms.
const near = (got, want, what = "") => assert.ok(
  got.length === want.length && got.every((g, i) => Math.abs(g - want[i]) <= 0.0015),
  `${what} expected ~${JSON.stringify(want)}, got ${JSON.stringify(got)}`);

test("\"$83 million\": $83 takes \"eighty-three\", million keeps its own time and absorbs \"dollars\"", () => {
  const w = byWord(alignKokoroWords(KOKORO_CAPTION, KOKORO_STAMPS).words);
  near([w["$83"].start, w["$83"].end], [2.461, 3.111], "$83");
  near([w.million.start, w.million.end], [3.111, 4.1985], "the added \"dollars\" is heard at the end of \"million\":");
});

test("\"24%\" spans \"twenty-four percent\"", () => {
  const w = byWord(alignKokoroWords(KOKORO_CAPTION, KOKORO_STAMPS).words);
  near([w["24%"].start, w["24%"].end], [4.4735, 5.486], "24%");
});

test("\"2027.\" spans \"twenty twenty-seven\" and ends where the words end", () => {
  const w = byWord(alignKokoroWords(KOKORO_CAPTION, KOKORO_STAMPS).words);
  near([w["2027."].start, w["2027."].end], [5.7235, 7.0735], "2027.");
  near([w.Is.start], [7.1735], "Is");
});

test("\"E.ON,\" matches Kokoro's \"E-ON\", and the clip's -0.0015 start is clamped to 0", () => {
  const w = byWord(alignKokoroWords(KOKORO_CAPTION, KOKORO_STAMPS).words);
  near([w["E.ON,"].start, w["E.ON,"].end], [0, 0.5485], "E.ON,");
});

test("a caption ending in punctuation: the last word is timed, the trailing \"?\" token is dropped", () => {
  const { words } = alignKokoroWords(KOKORO_CAPTION, KOKORO_STAMPS);
  const last = words[words.length - 1];
  assert.equal(last.word, "ready?");
  near([last.start, last.end], [7.8235, 8.4985], "ready?");
});

test("a punctuation-only caption word (\"—\") gets zero length and never steals a spoken span", () => {
  const w = byWord(alignKokoroWords(KOKORO_CAPTION, KOKORO_STAMPS).words);
  assert.equal(w["—"].start, w["—"].end);
  assert.ok(w["—"].start >= w.million.start && w["—"].start <= w.up.start);
});

test("every plain word is anchored directly — only the rewritten ones are placed", () => {
  const { words, matched } = alignKokoroWords(KOKORO_CAPTION, KOKORO_STAMPS);
  // $83, —, 24%, 2027. are the four the normaliser rewrote; everything else anchors.
  assert.equal(matched, words.length - 4);
});

test("a common word cannot be matched to a LATER occurrence and steal the span", () => {
  // "a" appears twice; the first is spoken as part of the normalised number.
  const caption = "Up 5% a year, a record";
  const stamps = [["Up", 0, 0.2], ["five", 0.2, 0.5], ["percent", 0.5, 0.9], ["a", 0.9, 1.0], ["year", 1.0, 1.3], [",", 1.3, 1.4], ["a", 1.4, 1.5], ["record", 1.5, 2.0]]
    .map(([word, start_time, end_time]) => ({ word, start_time, end_time }));
  const w = alignKokoroWords(caption, stamps).words;
  assert.deepEqual(w.map((x) => [x.word, x.start]), [["Up", 0], ["5%", 0.2], ["a", 0.9], ["year,", 1], ["a", 1.4], ["record", 1.5]]);
});

test("a name the normaliser splits into several tokens still anchors (joined match)", () => {
  const stamps = [["X", 0, 0.2], ["R", 0.2, 0.4], ["P", 0.4, 0.6], ["rallied", 0.6, 1.2]]
    .map(([word, start_time, end_time]) => ({ word, start_time, end_time }));
  const { words, matched } = alignKokoroWords("XRP rallied", stamps);
  assert.equal(matched, 2);
  assert.deepEqual([words[0].start, words[0].end], [0, 0.6]);
});

test("no usable timestamps → null (no timings), never a throw", () => {
  assert.equal(alignKokoroWords("A caption.", null), null);
  assert.equal(alignKokoroWords("A caption.", []), null);
  assert.equal(alignKokoroWords("A caption.", [{ word: ".", start_time: 0, end_time: 0.1 }]), null);
  assert.equal(alignKokoroWords("", KOKORO_STAMPS), null);
});

// ─── The adapter: request, shape, failure ───────────────────────────────────

test("the adapter asks /dev/captioned_speech for NON-STREAMED mp3 with timestamps, in the configured voice", async () => {
  const calls = [];
  await withEnv({ ...KOKORO, VIDEO_TTS_KOKORO_URL: "http://tts:8880" }, () => withFetch(async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body), signal: opts.signal });
    return kokoroReply();
  }, async () => {
    const { buf, words } = await _internals.kokoro(KOKORO_CAPTION);
    assert.ok(buf.length > 256);
    assert.equal(words.length, KOKORO_CAPTION.split(/\s+/).length);
  }));
  assert.equal(calls.length, 1, "one call — no plain-endpoint retry against the same server");
  assert.equal(calls[0].url, "http://tts:8880/dev/captioned_speech");
  assert.deepEqual(
    { ...calls[0].body, input: undefined },
    { model: "kokoro", input: undefined, voice: "bm_george", speed: 1, response_format: "mp3", stream: false, return_timestamps: true },
  );
  assert.ok(calls[0].signal instanceof AbortSignal, "every call carries a timeout signal");
});

test("TIMEOUT: a hung Kokoro costs this video, names the wait, and never reaches ElevenLabs", async () => {
  const urls = [];
  await withEnv({ ...KOKORO, VIDEO_TTS_KOKORO_TIMEOUT_MS: "1000", ELEVENLABS_API_KEY: "present-but-must-not-be-used" },
    () => withFetch((url, opts) => {
      urls.push(String(url));
      return hang(opts);
    }, async () => {
      const t0 = Date.now();
      await assert.rejects(() => voiceCaption("A caption that will time out.", { slideIndex: 0 }),
        (err) => err instanceof VoiceError && /^kokoro failed: timeout after 1000ms/.test(err.message));
      assert.ok(Date.now() - t0 < 5000, "the timeout must actually bound the call");
    }));
  assert.ok(urls.every((u) => !u.includes("elevenlabs")), "no silent fallback to ElevenLabs");
});

test("UNREACHABLE and HTTP errors fail the same way: \"kokoro failed: <reason>\"", async () => {
  await withEnv({ ...KOKORO }, async () => {
    await withFetch(async () => { const e = new TypeError("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; },
      () => assert.rejects(() => voiceCaption("Unreachable caption.", {}), /kokoro failed: http:\/\/tts:8880 unreachable — ECONNREFUSED/));
    await withFetch(async () => ({ ok: false, status: 500, text: async () => "model not loaded" }),
      () => assert.rejects(() => voiceCaption("Erroring caption.", {}), /kokoro failed: HTTP 500: model not loaded/));
    await withFetch(async () => kokoroReply(KOKORO_STAMPS, Buffer.alloc(10)),
      () => assert.rejects(() => voiceCaption("Tiny audio caption.", {}), /kokoro failed: decoded 10 bytes/));
  });
});

test("a failed Kokoro call logs \"🔊 kokoro failed: <reason>\" — the line the ops grep reads", () => {
  const src = readFileSync(new URL("./videoVoice.js", import.meta.url), "utf8");
  assert.match(src, /logger\.warn\(`🔊 kokoro failed: \$\{reason\}`\)/);
});

test("OPT-IN fallback: ElevenLabs voices the caption, and the clip is filed under ElevenLabs' key", async (t) => {
  if (!MP3) return t.skip("no ffmpeg on this machine");
  const caption = "Fallback caption, filed honestly.";
  const urls = [];
  const r = await withEnv({ ...KOKORO, VIDEO_TTS_FALLBACK: "elevenlabs", ELEVENLABS_API_KEY: "k" },
    () => withFetch(async (url) => {
      urls.push(String(url));
      if (String(url).includes("tts:8880")) return { ok: false, status: 503, text: async () => "down" };
      if (String(url).includes("/with-timestamps")) return { ok: true, status: 200, json: async () => ({ audio_base64: MP3.toString("base64"), alignment: null }) };
      throw new Error(`unexpected ${url}`);
    }, () => voiceCaption(caption, { slideIndex: 0 })));
  assert.equal(r.provider, "elevenlabs");
  assert.ok(urls[0].includes("tts:8880") && urls[1].includes("api.elevenlabs.io"));
  const elKey = await withEnv({ ...KOKORO }, () => cacheKeyFor(caption, "elevenlabs"));
  const koKey = await withEnv({ ...KOKORO }, () => cacheKeyFor(caption, "kokoro"));
  assert.equal(r.key, elKey);
  assert.ok(existsSync(path.join(TTS_CACHE_DIR, `${elKey}.mp3`)));
  assert.ok(!existsSync(path.join(TTS_CACHE_DIR, `${koKey}.mp3`)), "an ElevenLabs clip must never sit under the Kokoro key");
});

// ─── End to end through voiceCaption: cache, sidecar, spend ────────────────

test("voiceCaption under Kokoro: mp3 + word sidecar cached; the second call is a free cache hit", async (t) => {
  if (!MP3) return t.skip("no ffmpeg on this machine");
  let calls = 0;
  await withEnv({ ...KOKORO }, () => withFetch(async () => { calls++; return kokoroReply(); }, async () => {
    const first = await voiceCaption(KOKORO_CAPTION, { slideIndex: 1 });
    assert.equal(first.cached, false);
    assert.equal(first.provider, "kokoro");
    assert.ok(first.path.endsWith(".mp3") && existsSync(first.path));
    assert.ok(Math.abs(first.durationSecs - 1.5) < 0.15, `duration probed from the file: ${first.durationSecs}`);
    assert.equal(first.words.length, KOKORO_CAPTION.split(/\s+/).length);
    const again = await voiceCaption(KOKORO_CAPTION, { slideIndex: 1 });
    assert.equal(again.cached, true);
    assert.deepEqual(again.words, first.words, "the sidecar round-trips");
  }));
  assert.equal(calls, 1);
});

test("SPEND: Kokoro reads $0.00 with its characters; ElevenLabs reads characters only, never a made-up $", async (t) => {
  if (!MP3) return t.skip("no ffmpeg on this machine");
  const caption = "Spend accounting caption.";
  await withEnv({ ...KOKORO }, async () => {
    const snap = ttsUsageSnapshot();
    assert.equal(ttsSpendSince(snap), "tts kokoro $0.00 (0 chars)");
    await withFetch(async () => kokoroReply(), () => voiceCaption(caption, {}));
    assert.equal(ttsSpendSince(snap), `tts kokoro $0.00 (${caption.length} chars)`);
    await voiceCaption(caption, {});   // cache hit — free, not counted
    assert.equal(ttsSpendSince(snap), `tts kokoro $0.00 (${caption.length} chars)`);
  });
  await withEnv({ VIDEO_TTS_PROVIDER: undefined }, () => {
    const s = ttsSpendSince(ttsUsageSnapshot());
    assert.equal(s, "tts elevenlabs 0 chars");
    assert.ok(!s.includes("$"));
  });
});

// ─── Boot-time reachability ─────────────────────────────────────────────────

test("probeTtsService answers, never throws — up, down, or hung", async () => {
  await withEnv({ VIDEO_TTS_KOKORO_URL: "http://tts:8880" }, async () => {
    const up = await withFetch(async (url) => { assert.equal(String(url), "http://tts:8880/health"); return { ok: true, status: 200 }; }, () => probeTtsService());
    assert.equal(up.ok, true);
    const down = await withFetch(async () => { const e = new TypeError("fetch failed"); e.cause = { code: "ENOTFOUND" }; throw e; }, () => probeTtsService());
    assert.deepEqual([down.ok, down.error], [false, "ENOTFOUND"]);
    const hung = await withFetch((_, o) => hang(o),
      () => probeTtsService({ timeoutMs: 50 }));
    assert.deepEqual([hung.ok, hung.error], [false, "timeout after 50ms"]);
  });
});

test("the boot line is an ERROR only when Kokoro is selected and unreachable", async () => {
  const lines = [];
  const log = { info: (m) => lines.push(["info", m]), error: (m) => lines.push(["error", m]) };
  const down = async () => { throw new TypeError("fetch failed"); };
  await withEnv({ ...KOKORO }, () => withFetch(down, () => logTtsReachability({ log })));
  await withEnv({ VIDEO_TTS_PROVIDER: undefined }, () => withFetch(down, () => logTtsReachability({ log })));
  await withEnv({ ...KOKORO }, () => withFetch(async () => ({ ok: true, status: 200 }), () => logTtsReachability({ log })));
  assert.equal(lines[0][0], "error");
  assert.match(lines[0][1], /provider=kokoro voice=bm_george .* UNREACHABLE/);
  assert.deepEqual(lines[1][0], "info");
  assert.match(lines[1][1], /provider=elevenlabs .* not in use/);
  assert.match(lines[2][1], /provider=kokoro voice=bm_george · tts service http:\/\/tts:8880 reachable/);
});
