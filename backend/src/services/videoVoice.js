/**
 * videoVoice.js — one TTS call per slide caption, cached by content.
 *
 * The provider is ElevenLabs (code default) or self-hosted Kokoro, chosen by
 * VIDEO_TTS_PROVIDER alone — see "Provider" below. Both return the same
 * { buf, words } shape, so nothing downstream knows which one spoke.
 *
 * DELIBERATELY NOT ttsService.generateTts. That function is reused by the three
 * legacy generators and every one of its behaviours is wrong here:
 *   - it caches at `AUDIO_DIR/<articleId>.mp3`, one file per ARTICLE, so the
 *     second caption of a video would overwrite the first;
 *   - it picks a provider by first-key-wins (OpenAI before ElevenLabs), so a
 *     prod OPENAI_API_KEY would silently override the ElevenLabs ruling;
 *   - it falls back to Google Translate TTS and finally to SILENCE, and a
 *     silent slide has no duration — which is the one thing this pipeline
 *     cannot degrade past, because slide duration IS audio duration.
 * The ElevenLabs HTTP call itself is the good part and is mirrored here:
 * eleven_turbo_v2, the same voice settings, the same error shape.
 *
 * HARD FAILURE, per §6.2. Every path either returns real audio or throws.
 * There is no silent fallback and no null-on-failure, because a null would be
 * indistinguishable from "TTS not configured" — which is exactly how the
 * legacy path degrades, and how a partial video would reach an upload.
 *
 * CACHE KEYED ON CONTENT, not on identity. sha1(caption + voiceId + modelId +
 * settings) means: the regeneration retry re-voices an unchanged caption for
 * free; a changed caption gets new audio; and a voice-settings change
 * invalidates everything without a manual purge. Audio is the one per-video
 * cost that is not near-zero, so this is the cache that actually matters.
 *
 * PERSISTENT, WITH ITS SWEEPER IN THE SAME COMMIT — the CARDS_DIR rule. The
 * cache only earns its keep by surviving across runs, so it cannot be
 * ephemeral; a 7-day sweep matches the article prune, after which the article
 * that produced the caption is gone anyway.
 */

import { createHash } from "crypto";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { logger } from "./logger.js";
import { getFFmpegPath } from "./videoGenerator.js";
import { applyPronunciations } from "./ttsPronunciations.js";

const BACKEND_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

// ─── Voice direction ────────────────────────────────────────────────────────
//
// EVERY DEFAULT BELOW IS TODAY'S VALUE. An unset environment produces
// byte-identical audio to the pre-change code, which is the whole point: this
// merges inert and the TTS cache survives it untouched. The knobs exist so a
// documentary read can be dialled in from `.env` and restarted, rather than
// through a deploy.
//
// ⚠️ ALL FIVE ARE IN THE CACHE KEY (see cacheKeyFor). Changing any one of them
// invalidates every cached clip at once — by design, so a tuning change can
// never be served stale audio, but it means the first run after the change
// re-synthesises every caption at full price. VIDEO_VOICE_MODEL is the
// expensive one to change twice over: the model also carries its own
// per-character rate, so switching tiers re-buys the whole corpus at the NEW
// price. VIDEO_VOICE_GAP_MS is deliberately outside the key — see below.

/**
 * A number from the environment, in which ZERO MEANS ZERO.
 *
 * `Number.parseFloat(x) || fallback` is wrong for every setting here: it reads
 * a deliberate `0` as "unset" and quietly serves the default instead. Stability
 * 0 is a legitimate choice — it is ElevenLabs' most expressive setting and the
 * one a documentary read is most likely to reach for — so that idiom would
 * silently refuse the single most likely edit to this file.
 *
 * Unset and empty fall through to the default. Unparseable or out-of-range
 * falls back LOUDLY: ElevenLabs answers an out-of-range setting with a 422 at
 * synthesis time, one caption into a render, and §6.2 makes that a lost article.
 * A warned fallback at import is the cheaper failure.
 */
export function envNumber(name, fallback, { min, max } = {}) {
  const raw = process.env[name];
  // Number("") is 0, so the empty case has to be caught before the parse.
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    logger.warn(`🔊 ${name}="${raw}" is not a number — falling back to ${fallback}`);
    return fallback;
  }
  if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
    logger.warn(`🔊 ${name}=${n} is outside the accepted range [${min}, ${max}] — falling back to ${fallback}`);
    return fallback;
  }
  return n;
}

// VIDEO_VOICE_ID takes precedence, ELEVENLABS_VOICE_ID stays honoured beneath
// it. The older name is read by ttsService too and may be set somewhere this
// branch cannot see; silently dropping it would repoint the voice as a side
// effect of adding a knob.
export const VOICE_ID  = process.env.VIDEO_VOICE_ID
  || process.env.ELEVENLABS_VOICE_ID
  || "21m00Tcm4TlvDq8ikWAM";  // Rachel
// Same precedence shape as the voice id: the new name wins, the old one is
// still honoured beneath it. Without this knob the stage-1 model comparison
// could be listened to but not acted on — choosing the winner would need a code
// change, which is the thing every other setting on this page avoids.
//
// NOT VALIDATED against a list. ElevenLabs adds and retires models faster than
// this file gets edited, and an allowlist would reject the next good one while
// claiming to protect you. A bad id fails loudly at the first synthesis with a
// 4xx that names it, and §6.2 turns that into a skipped article rather than a
// bad video.
//
// ⚠️ MEASURED 2026-08-11: `eleven_v3` accepts `speed` and IGNORES it (0.7 and
// 1.2 produced 7.00s both times on the same caption). Slide duration IS audio
// duration (§5), so on that model VIDEO_VOICE_SPEED silently stops steering
// anything. turbo_v2, multilingual_v2, turbo_v2_5 and flash_v2_5 all honour it.
export const MODEL_ID  = process.env.VIDEO_VOICE_MODEL
  || process.env.ELEVENLABS_MODEL_ID
  || "eleven_turbo_v2";

// Mirrors ttsService's tuning, which is what the channel already sounds like.
//
// KEY ORDER IS LOAD-BEARING. cacheKeyFor digests JSON.stringify(VOICE_SETTINGS),
// and JSON.stringify preserves insertion order — so reordering these three
// lines would invalidate the entire cache while changing nothing audible.
// Ranges are ElevenLabs': stability and similarity 0–1, speed 0.7–1.2.
export const VOICE_SETTINGS = Object.freeze({
  stability:        envNumber("VIDEO_VOICE_STABILITY",  0.5,  { min: 0, max: 1 }),
  similarity_boost: envNumber("VIDEO_VOICE_SIMILARITY", 0.75, { min: 0, max: 1 }),
  speed:            envNumber("VIDEO_VOICE_SPEED",      1.05, { min: 0.7, max: 1.2 }),
});

// ─── Provider: ElevenLabs or self-hosted Kokoro ─────────────────────────────
//
// ONE EXPLICIT SWITCH, never a first-key-wins chain (that is ttsService's bug,
// described at the top of this file). VIDEO_TTS_PROVIDER names the provider;
// nothing else can change it. The code default is "elevenlabs", so merging this
// changes nothing until the env line is written.
//
// Kokoro (Kokoro-82M, Apache 2.0) runs as the `tts` compose service on our own
// box — docker-compose.production.yml. It is reachable only on the internal
// Docker network, at http://tts:8880.
//
// Read at CALL TIME, like voiceGapSecs, so a test can flip it; prod reads it
// once per recreate like every other env var.
//
// THE LONGFORM FILMS DO NOT COME THROUGH HERE. longform/engine/narrate.mjs has
// its own ElevenLabs call and reads VIDEO_VOICE_ID — which is exactly why Kokoro
// has its own VIDEO_TTS_KOKORO_* names instead of reusing that one.

export function voiceProvider() {
  const raw = String(process.env.VIDEO_TTS_PROVIDER ?? "").trim().toLowerCase();
  if (!raw || raw === "elevenlabs") return "elevenlabs";
  if (raw === "kokoro") return "kokoro";
  logger.warn(`🔊 VIDEO_TTS_PROVIDER="${process.env.VIDEO_TTS_PROVIDER}" is not kokoro|elevenlabs — using elevenlabs`);
  return "elevenlabs";
}

/** Everything the Kokoro call needs. Read per call, so a recreate is all a change takes. */
export function kokoroConfig() {
  return {
    url: String(process.env.VIDEO_TTS_KOKORO_URL || "http://tts:8880").trim().replace(/\/+$/, ""),
    voice: String(process.env.VIDEO_TTS_KOKORO_VOICE || "").trim() || "bm_george",
    speed: envNumber("VIDEO_TTS_KOKORO_SPEED", 1.0, { min: 0.5, max: 2 }),
    // Longer than ElevenLabs' 30s: this runs on the same 2-vCPU box as the
    // render, and one core synthesising a long caption while ffmpeg holds the
    // other is slower than a hosted API. Still bounded — a hung tts container
    // must cost one video, not the render job's 10-minute lock.
    timeoutMs: envNumber("VIDEO_TTS_KOKORO_TIMEOUT_MS", 60000, { min: 1000, max: 300000 }),
  };
}

/**
 * The OPT-IN second provider when Kokoro fails. Default: none — a failed Kokoro
 * call skips the video. A silent fallback to ElevenLabs would hide a broken
 * Kokoro behind a bill (or, with no credits, behind a 401 that names the wrong
 * provider).
 */
export function fallbackProvider() {
  const raw = String(process.env.VIDEO_TTS_FALLBACK ?? "").trim().toLowerCase();
  return voiceProvider() === "kokoro" && raw === "elevenlabs" ? "elevenlabs" : null;
}

/**
 * What the design keys fold in, so a Kokoro render can never be mistaken for an
 * ElevenLabs one. NULL FOR ELEVENLABS ON PURPOSE: the default keeps every
 * fingerprint byte-identical to the pre-Kokoro code.
 */
export function voiceIdentity(provider = voiceProvider()) {
  return provider === "kokoro" ? `kokoro|${kokoroConfig().voice}` : null;
}

/** Fold the voice identity into a hex fingerprint, keeping its length. Identity-less = unchanged. */
export function withVoiceIdentity(fingerprint, identity = voiceIdentity()) {
  if (!identity) return fingerprint;
  return createHash("sha1").update(String(fingerprint)).update("|").update(identity)
    .digest("hex").slice(0, String(fingerprint).length);
}

/**
 * Trailing silence after each caption, in seconds. Default 0 — inert.
 *
 * DELIBERATELY NOT IN THE CACHE KEY, because it is not in the MP3. The gap is
 * added where SLIDE_TAIL_SECS already is — in the slide's timing and in the
 * `apad` that pads the audio stream to match — so re-pacing the channel is free
 * rather than a full re-synthesis of every caption. The result on screen is
 * identical either way: the slide holds, in silence, for this long after the
 * narration ends.
 *
 * Read at CALL TIME, not at import, so it is runtime-flippable on a restart
 * like the other pacing levers in videoAutopost.
 *
 * Capped at 5s. Slide duration is audio duration (§5) and every millisecond
 * here is multiplied by the slide count — 400ms across 8 slides is 3.2s of
 * video, and a fat-fingered `4000` would be 32s of silence in a 90s film.
 */
export function voiceGapSecs() {
  return envNumber("VIDEO_VOICE_GAP_MS", 0, { min: 0, max: 5000 }) / 1000;
}

export const TTS_CACHE_DIR = process.env.VIDEO_TTS_CACHE_DIR
  ? path.resolve(process.env.VIDEO_TTS_CACHE_DIR)
  : (process.env.SCOOP_PERSISTENT_DATA_DIR
      ? path.join(path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR), "tts-cache")
      : path.join(BACKEND_ROOT, "data", "tts-cache"));

export const TTS_RETENTION_MS =
  Number.parseInt(process.env.VIDEO_TTS_RETENTION_DAYS || "7", 10) * 24 * 60 * 60 * 1000;

const TIMEOUT_MS = Number.parseInt(process.env.VIDEO_TTS_TIMEOUT_MS || "30000", 10);

export class VoiceError extends Error {
  constructor(message, { caption = null, status = null } = {}) {
    super(message);
    this.name = "VoiceError";
    this.caption = caption;
    this.status = status;
  }
}

/**
 * Can the selected provider be called at all? Kokoro needs no key — its URL has
 * a default — so whether the service is actually UP is a runtime question,
 * answered by probeTtsService at worker boot and by each call's own timeout.
 */
export function isVoiceConfigured() {
  if (voiceProvider() === "kokoro") return true;
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

/** Why isVoiceConfigured() is false, in words the cycle log can print. */
export function voiceConfigProblem() {
  return isVoiceConfigured() ? null : `ELEVENLABS_API_KEY is not set (VIDEO_TTS_PROVIDER=${voiceProvider()})`;
}

// Bump only if the Kokoro MODEL (not the server image) ever changes: the weights
// decide the audio, and the key must move with them.
const KOKORO_MODEL = "kokoro-82m-v1.0";

/**
 * sha1(caption + voice + model + settings) — content, never identity.
 *
 * TWO KEY SPACES, ONE DIRECTORY. The ElevenLabs material below is UNCHANGED
 * byte for byte (pinned by "THE CACHE DIGEST IS UNCHANGED"), so flipping back to
 * ElevenLabs finds its 7-day cache intact. Kokoro digests its own material, led
 * by the literal "kokoro", so the two can never collide on the same caption.
 */
export function cacheKeyFor(caption, provider = voiceProvider()) {
  if (provider === "kokoro") {
    const k = kokoroConfig();
    const h = createHash("sha1")
      .update(String(caption))
      .update("|kokoro|").update(KOKORO_MODEL)
      .update("|").update(k.voice)
      .update("|").update(JSON.stringify({ speed: k.speed }));
    // The respelled text (ttsPronunciations.js) decides the audio, so it is in
    // the key — but ONLY when it differs. A caption the list does not touch
    // keeps its existing key, so editing the list re-voices just the captions
    // it affects.
    const spoken = applyPronunciations(caption);
    if (spoken !== String(caption)) h.update("|said:").update(spoken);
    return h.digest("hex").slice(0, 24);
  }
  return createHash("sha1")
    .update(String(caption))
    .update("|").update(VOICE_ID)
    .update("|").update(MODEL_ID)
    .update("|").update(JSON.stringify(VOICE_SETTINGS))
    .digest("hex")
    .slice(0, 24);
}

// ─── Duration ───────────────────────────────────────────────────────────────

let _ffprobe;   // undefined = unresolved, null = genuinely absent

/**
 * Find ffprobe, or report that there is none.
 *
 * The bundled @ffmpeg-installer package ships ffmpeg ONLY — there is no
 * ffprobe in it — so on a dev Mac without system ffmpeg this resolves to null
 * and the parse fallback is the real path. The container has system ffmpeg 5.1
 * and therefore a real ffprobe. Both must work, so both are exercised.
 */
export function getFFprobePath() {
  if (_ffprobe !== undefined) return _ffprobe;
  try {
    const found = execFileSync("sh", ["-c", "command -v ffprobe || true"], { encoding: "utf8" }).trim();
    if (found) { _ffprobe = found; return _ffprobe; }
  } catch { /* fall through */ }
  // Sibling of the resolved ffmpeg, when that is a system install.
  const ff = getFFmpegPath();
  if (ff) {
    const sibling = path.join(path.dirname(ff), "ffprobe");
    if (existsSync(sibling)) { _ffprobe = sibling; return _ffprobe; }
  }
  _ffprobe = null;
  return _ffprobe;
}

/** Which duration path is live. Logged at startup so it is never a surprise. */
export function durationMethod() {
  return getFFprobePath() ? "ffprobe" : "ffmpeg-stderr";
}

/**
 * Audio duration in seconds. ffprobe when present, otherwise parsed from
 * `ffmpeg -i` stderr — ffmpeg prints "Duration: 00:00:04.18" and exits
 * non-zero because no output was requested, which is expected, not an error.
 */
/** The word-timing sidecar for a cache key. One file per clip, beside the mp3. */
export function wordsPathFor(key) {
  return path.join(TTS_CACHE_DIR, `${key}.words.json`);
}

/** Read a sidecar, tolerating every way it can be absent or corrupt. */
export function readWordsSidecar(file) {
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    // A truncated sidecar (killed mid-write) must degrade to "no timings", not
    // take the video down for a file that is pure enhancement.
    return null;
  }
}

export function probeDurationSecs(filePath) {
  if (!existsSync(filePath)) throw new VoiceError(`audio file missing: ${filePath}`);

  const probe = getFFprobePath();
  if (probe) {
    const out = execFileSync(probe, [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1", filePath,
    ], { encoding: "utf8", timeout: 15000 }).trim();
    const secs = Number.parseFloat(out);
    if (Number.isFinite(secs) && secs > 0) return secs;
    throw new VoiceError(`ffprobe returned no usable duration for ${filePath}: ${JSON.stringify(out)}`);
  }

  const ff = getFFmpegPath();
  if (!ff) throw new VoiceError("neither ffprobe nor ffmpeg is available to measure audio duration");
  let stderr = "";
  try {
    execFileSync(ff, ["-hide_banner", "-i", filePath], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    stderr = String(err.stderr || "");
  }
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) throw new VoiceError(`could not parse a duration out of ffmpeg for ${filePath}`);
  const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  if (!(secs > 0)) throw new VoiceError(`parsed a non-positive duration for ${filePath}`);
  return secs;
}

// ─── Synthesis ──────────────────────────────────────────────────────────────

/**
 * Group ElevenLabs' PER-CHARACTER alignment into words.
 *
 * The API returns one start/end per character, which is the wrong grain for
 * anything on screen: a phrase changes on a WORD. Grouping here, once, at write
 * time means every consumer reads the same derivation rather than each inventing
 * its own — and it keeps the sidecar small, which matters at 12 videos a day.
 *
 * A word's start is its first character's start and its end is its last
 * character's end. Whitespace delimits and belongs to no word.
 */
export function wordsFromAlignment(alignment) {
  const chars = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(ends)) return null;
  if (chars.length !== starts.length || chars.length !== ends.length) return null;

  const words = [];
  let cur = null;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) { if (cur) { words.push(cur); cur = null; } continue; }
    if (!cur) cur = { word: "", start: starts[i], end: ends[i] };
    cur.word += ch;
    cur.end = ends[i];
  }
  if (cur) words.push(cur);
  return words.length ? words : null;
}

/** A word reduced to what can be compared across spellings: "E.ON," and "E-ON" are both "eon". */
const normWord = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/**
 * Map Kokoro's SPOKEN tokens back onto the caption's OWN words.
 *
 * Kokoro times the text after its normaliser has rewritten it, so the tokens
 * are not the caption. Measured on v0.9.0: "$83 million" comes back as
 * `eighty-three` `million` `dollars`, "2027" as `twenty` `twenty-seven`, "E.ON"
 * as `E-ON`, and every punctuation mark as a token of its own. ElevenLabs'
 * `alignment` indexes the text we SENT, and every consumer is built on that:
 * shotVideo.anchorTime needs exactly one entry per whitespace word of the
 * caption (else it scales the cut and warns), and the burned captions DISPLAY
 * `word` — so they must say "$83", not "eighty-three".
 *
 * So the output is the ElevenLabs shape exactly: one { word, start, end } per
 * whitespace-separated caption word, in the caption's spelling, seconds from
 * the clip's start.
 *
 *   1. ANCHOR. The longest common subsequence of normalised caption words and
 *      normalised tokens (a word may also equal up to four tokens joined, for a
 *      name the normaliser splits). Monotonic and globally optimal, so a common
 *      word like "the" cannot be matched to a later "the" and steal a span.
 *   2. FILL. The caption words between two anchors share the time of the
 *      tokens between them — "$83" takes `eighty-three` — split by character
 *      weight. Punctuation-only words ("—") get zero length at the gap's start.
 *   3. ABSORB. Tokens with no caption word to own them (the `dollars` the
 *      normaliser added after "million") extend the previous word, which is
 *      where they are heard.
 *
 * RESPELLINGS. `say` maps one caption word to what Kokoro was actually sent
 * for it (ttsPronunciations.js: "Xi" → "Shee"). Anchoring compares Kokoro's
 * tokens against THAT, while the output keeps the caption's own word — so the
 * audio says "Shee" and the caption still reads "Xi", timed directly.
 *
 * @returns {{ words: Array, matched: number } | null}
 */
export function alignKokoroWords(caption, stamps, { say = (w) => w } = {}) {
  const raw = String(caption ?? "").trim().split(/\s+/).filter(Boolean);
  if (!raw.length || !Array.isArray(stamps)) return null;
  const toks = stamps
    .map((t) => ({ n: normWord(t?.word), s: Math.max(0, Number(t?.start_time)), e: Math.max(0, Number(t?.end_time)) }))
    .filter((t) => t.n && Number.isFinite(t.s) && Number.isFinite(t.e) && t.e >= t.s);
  if (!toks.length) return null;

  const W = raw.map((w) => normWord(say(w))), n = W.length, m = toks.length, MAXJOIN = 4;
  // How many tokens starting at j join to caption word i (0 = no match).
  const span = (i, j) => {
    if (!W[i]) return 0;
    let acc = "";
    for (let k = 0; k < MAXJOIN && j + k < m; k++) {
      acc += toks[j + k].n;
      if (acc === W[i]) return k + 1;
      if (!W[i].startsWith(acc)) return 0;
    }
    return 0;
  };
  // LCS table, filled from the end so the walk below reads forwards.
  const best = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const k = span(i, j);
      best[i][j] = Math.max(best[i + 1][j], best[i][j + 1], k ? 1 + best[i + 1][j + k] : 0);
    }
  }
  const anchors = [];   // { i, a, b } — caption word i owns tokens a..b
  for (let i = 0, j = 0; i < n && j < m;) {
    const k = span(i, j);
    if (k && best[i][j] === 1 + best[i + 1][j + k]) { anchors.push({ i, a: j, b: j + k - 1 }); i++; j += k; }
    else if (best[i][j] === best[i + 1][j]) i++;
    else j++;
  }

  const words = raw.map((word) => ({ word, start: 0, end: 0 }));
  const put = (i, s, e) => { words[i].start = s; words[i].end = Math.max(s, e); };
  for (const a of anchors) put(a.i, toks[a.a].s, toks[a.b].e);

  // Gaps, including before the first anchor and after the last.
  const bounds = [{ i: -1, b: -1 }, ...anchors, { i: n, a: m }];
  for (let g = 0; g + 1 < bounds.length; g++) {
    const L = bounds[g], R = bounds[g + 1];
    const gapWords = []; for (let i = L.i + 1; i < R.i; i++) gapWords.push(i);
    const t0 = L.b + 1, t1 = R.a - 1;                     // unmatched tokens between
    const weights = gapWords.map((i) => W[i].length);
    const total = weights.reduce((x, y) => x + y, 0);
    const from = t0 <= t1 ? toks[t0].s : (L.b >= 0 ? toks[L.b].e : toks[0].s);
    const to = t0 <= t1 ? toks[t1].e : (R.a < m ? toks[R.a].s : toks[m - 1].e);
    if (!total) {
      // Nobody in the gap can own the tokens: the previous word does (ABSORB).
      if (t0 <= t1 && L.i >= 0) words[L.i].end = Math.max(words[L.i].end, toks[t1].e);
      for (const i of gapWords) put(i, from, from);
      continue;
    }
    let t = from;
    gapWords.forEach((i, x) => {
      const d = ((to - from) * weights[x]) / total;
      put(i, t, t + d); t += d;
    });
  }
  const r3 = (x) => +x.toFixed(3);
  return { words: words.map((w) => ({ word: w.word, start: r3(w.start), end: r3(w.end) })), matched: anchors.length };
}

/**
 * Synthesise one caption, WITH per-word timings when the API will give them.
 *
 * `/with-timestamps` returns JSON — base64 audio plus a per-character alignment
 * — where the plain endpoint returns raw MP3 bytes. The decoded audio is the
 * same audio, so nothing downstream changes: probeDurationSecs still reads the
 * file, and the cache still holds an .mp3 at the same path.
 *
 * IT FALLS BACK TO THE PLAIN ENDPOINT ON ANY FAILURE, and that is the whole
 * safety argument for shipping this. Every short we publish goes through this
 * function; a timestamps endpoint that 404s, rate-limits, or changes its
 * response shape must cost us word timings, never the video. Losing the audio
 * to gain a text-timing feature would be a bad trade at any success rate.
 *
 * @returns {Promise<{buf: Buffer, words: Array|null}>}
 */
async function elevenLabs(caption) {
  const text = String(caption).slice(0, 5000);
  const body = JSON.stringify({ text, model_id: MODEL_ID, voice_settings: { ...VOICE_SETTINGS } });
  const headers = {
    "xi-api-key": process.env.ELEVENLABS_API_KEY,
    "Content-Type": "application/json",
  };

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps`, {
      method: "POST",
      headers: { ...headers, Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const buf = Buffer.from(String(json?.audio_base64 || ""), "base64");
    if (buf.length < 256) throw new Error(`decoded ${buf.length} bytes — not audio`);
    // normalized_alignment is aligned to the SPOKEN normalisation ("$5" spoken
    // as "five dollars"), so its characters do not correspond to the text we
    // hold. `alignment` is the one that indexes the caption we sent.
    return { buf, words: wordsFromAlignment(json?.alignment) };
  } catch (err) {
    logger.warn(
      `🔊 with-timestamps unavailable (${String(err.message).slice(0, 80)}) — falling back to plain audio. ` +
      `The video is unaffected; this clip simply has no word timings.`
    );
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: { ...headers, Accept: "audio/mpeg" },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const b = await res.text().catch(() => "");
    throw new VoiceError(`ElevenLabs ${res.status}: ${b.slice(0, 300)}`, { caption, status: res.status });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 256) throw new VoiceError(`ElevenLabs returned ${buf.length} bytes — not audio`, { caption });
  return { buf, words: null };
}

/**
 * Kokoro, via Kokoro-FastAPI's /dev/captioned_speech — the endpoint that
 * returns word timestamps. `stream: false` is REQUIRED: the endpoint streams
 * by default, and a stream is a sequence of JSON chunks, not one document.
 * The non-stream reply is `{ audio: base64, audio_format, timestamps: [{ word,
 * start_time, end_time }] }`, seconds (kokoro-fastapi v0.9.0,
 * api/src/routers/development.py).
 *
 * MP3, so the cache holds an honest `.mp3` the sweeper knows. Kokoro writes it
 * at 24 kHz; nothing downstream cares — both render paths resample to 48 kHz
 * and the duration is probed from the file.
 *
 * UNLIKE the ElevenLabs path there is no plain-endpoint retry: the same server
 * answers both, so a second call to a broken Kokoro only doubles the wait.
 * Timings that fail to map cost the captions, never the audio.
 *
 * @returns {Promise<{buf: Buffer, words: Array|null}>}
 */
async function kokoro(caption) {
  const k = kokoroConfig();
  const text = String(caption).slice(0, 5000);
  // Kokoro hears the respelled text; the caption keeps its own spelling.
  const spoken = applyPronunciations(text);
  let res;
  try {
    res = await fetch(`${k.url}/dev/captioned_speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model: "kokoro", input: spoken, voice: k.voice, speed: k.speed,
        response_format: "mp3", stream: false, return_timestamps: true,
      }),
      signal: AbortSignal.timeout(k.timeoutMs),
    });
  } catch (err) {
    // AbortSignal.timeout rejects with a TimeoutError whose message does not say
    // how long it waited; the operator needs the number.
    if (err?.name === "TimeoutError") throw new Error(`timeout after ${k.timeoutMs}ms (${k.url})`);
    throw new Error(`${k.url} unreachable — ${String(err?.cause?.code || err?.message || err)}`);
  }
  if (!res.ok) {
    const b = await res.text().catch(() => "");
    const e = new Error(`HTTP ${res.status}: ${b.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  const json = await res.json();
  const buf = Buffer.from(String(json?.audio || ""), "base64");
  if (buf.length < 256) throw new Error(`decoded ${buf.length} bytes — not audio`);
  let words = null;
  try {
    const aligned = alignKokoroWords(text, json?.timestamps, { say: (w) => applyPronunciations(w) });
    if (aligned) {
      words = aligned.words;
      const guessed = words.length - aligned.matched;
      // Expected for numbers, symbols and punctuation-only words — the normaliser
      // rewrites them — not a fault. A caption where MOST words are placed is.
      if (guessed) logger.info(`🔊 kokoro: ${aligned.matched}/${words.length} words timed directly, ${guessed} placed between them (words the normaliser rewrote)`);
    } else {
      logger.warn(`🔊 kokoro returned audio but no usable timestamps — this clip has no word timings`);
    }
  } catch (err) {
    logger.warn(`🔊 kokoro word mapping failed (${String(err.message).slice(0, 80)}) — this clip has no word timings`);
  }
  return { buf, words };
}

/**
 * The selected provider, and the only fallback there is: the opt-in one.
 * Every failure is named in the log before anything else happens.
 */
async function synthesise(text) {
  if (voiceProvider() !== "kokoro") return { ...(await elevenLabs(text)), provider: "elevenlabs" };
  try {
    return { ...(await kokoro(text)), provider: "kokoro" };
  } catch (err) {
    const reason = String(err?.message || err).slice(0, 240);
    logger.warn(`🔊 kokoro failed: ${reason}`);
    if (fallbackProvider() === "elevenlabs") {
      logger.warn("🔊 VIDEO_TTS_FALLBACK=elevenlabs — voicing this caption with ElevenLabs instead");
      return { ...(await elevenLabs(text)), provider: "elevenlabs" };
    }
    throw new VoiceError(`kokoro failed: ${reason}`, { caption: text, status: err?.status ?? null });
  }
}

// ─── Spend ──────────────────────────────────────────────────────────────────
//
// Characters actually synthesised, per provider, since the process started.
// The cycle snapshots it at entry and prints the difference on its summary line
// (videoAutopost `finish`). Kokoro is $0 — it runs on our own box. ElevenLabs
// is reported in CHARACTERS ONLY: the per-character rate depends on the plan,
// and an invented dollar figure would be worse than none. Cache hits cost
// nothing and are not counted. Per-process by design: voice runs in the same
// worker process as the cycle that reads it.
const usage = { elevenlabs: { calls: 0, chars: 0 }, kokoro: { calls: 0, chars: 0 } };

export function ttsUsageSnapshot() {
  return JSON.parse(JSON.stringify(usage));
}

/** The cycle-log segment: "tts kokoro $0.00 (812 chars)" / "tts elevenlabs 812 chars". */
export function ttsSpendSince(snapshot = { elevenlabs: { chars: 0, calls: 0 }, kokoro: { chars: 0, calls: 0 } }) {
  const d = (p) => ({ calls: usage[p].calls - (snapshot?.[p]?.calls || 0), chars: usage[p].chars - (snapshot?.[p]?.chars || 0) });
  const fmt = (p, x) => (p === "kokoro" ? `tts kokoro $0.00 (${x.chars} chars)` : `tts elevenlabs ${x.chars} chars`);
  const active = voiceProvider();
  const parts = [];
  for (const p of ["kokoro", "elevenlabs"]) {
    const x = d(p);
    if (p === active || x.calls > 0) parts.push(fmt(p, x));
  }
  return parts.join(" · ");
}

/**
 * Can this process reach the tts service? One GET of /health with a short
 * timeout; never throws. The worker logs the answer once at boot, whatever the
 * provider, so "Kokoro is up" is known BEFORE the env is flipped to it.
 */
export async function probeTtsService({ timeoutMs = 5000 } = {}) {
  const { url } = kokoroConfig();
  const t0 = Date.now();
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: res.ok, url, ms: Date.now() - t0, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    const why = err?.name === "TimeoutError" ? `timeout after ${timeoutMs}ms` : String(err?.cause?.code || err?.message || err);
    return { ok: false, url, ms: Date.now() - t0, error: why };
  }
}

/** The boot line. Loud (error) only when Kokoro is the SELECTED provider and is down. */
export async function logTtsReachability({ log = logger } = {}) {
  const provider = voiceProvider();
  const who = provider === "kokoro" ? `provider=kokoro voice=${kokoroConfig().voice}` : "provider=elevenlabs";
  const r = await probeTtsService();
  if (r.ok) log.info(`🔊 tts: ${who} · tts service ${r.url} reachable (${r.ms}ms)`);
  else if (provider === "kokoro") log.error(`🔊 tts: ${who} · tts service ${r.url} UNREACHABLE (${r.error}) — every Short will skip until it is up`);
  else log.info(`🔊 tts: ${who} · tts service ${r.url} unreachable (${r.error}) — not in use`);
  return r;
}

/**
 * Voice one caption. Returns { path, durationSecs, cached, key, words, provider }.
 * Throws VoiceError on any failure — never returns silence.
 */
export async function voiceCaption(caption, { slideIndex = -1 } = {}) {
  const text = String(caption || "").trim();
  if (!text) throw new VoiceError(`slide ${slideIndex}: empty caption — every card must carry its narration line`);
  if (!isVoiceConfigured()) throw new VoiceError(`voice not configured: ${voiceConfigProblem()}`);

  if (!existsSync(TTS_CACHE_DIR)) mkdirSync(TTS_CACHE_DIR, { recursive: true });
  const provider = voiceProvider();
  let key = cacheKeyFor(text, provider);
  let file = path.join(TTS_CACHE_DIR, `${key}.mp3`);
  let wordsFile = wordsPathFor(key);

  if (existsSync(file) && statSync(file).size > 256) {
    const durationSecs = probeDurationSecs(file);
    // A CLIP CACHED BEFORE THIS EXISTED HAS NO SIDECAR, and that is a normal
    // state for the whole retention window after deploy — not a fault. It is
    // reported rather than silent, because "the feature does nothing" and "every
    // clip was a pre-timestamp cache hit" look identical from the outside and
    // the second one resolves itself in seven days.
    const words = readWordsSidecar(wordsFile);
    logger.info(
      `🔊 voice slide ${slideIndex}: CACHE HIT ${key} (${durationSecs.toFixed(2)}s) ` +
      `${words ? `${words.length} word timings` : "NO word timings — cached before timestamps"} ` +
      `"${text.slice(0, 48)}"`
    );
    return { path: file, durationSecs, cached: true, key, words, provider };
  }

  const t0 = Date.now();
  const { buf, words, provider: spoke } = await synthesise(text);
  // Cached under the key of the provider that ACTUALLY spoke. With the opt-in
  // fallback, an ElevenLabs clip filed under the Kokoro key would be served as
  // Kokoro forever after — the old/new mixing the separate key spaces prevent.
  if (spoke !== provider) {
    key = cacheKeyFor(text, spoke);
    file = path.join(TTS_CACHE_DIR, `${key}.mp3`);
    wordsFile = wordsPathFor(key);
  }
  usage[spoke].calls++;
  usage[spoke].chars += text.length;
  writeFileSync(file, buf);
  // Written AFTER the audio, and never allowed to fail the clip: the sidecar is
  // an enhancement, the mp3 is the product.
  if (words) {
    try { writeFileSync(wordsFile, JSON.stringify(words)); }
    catch (err) { logger.warn(`🔊 could not write word timings for ${key}: ${err.message}`); }
  }
  const durationSecs = probeDurationSecs(file);
  logger.info(
    `🔊 voice slide ${slideIndex}: CACHE MISS ${key} — ${spoke} synthesised ${(buf.length / 1024).toFixed(0)}KB / ` +
    `${durationSecs.toFixed(2)}s in ${Date.now() - t0}ms ` +
    `${words ? `+ ${words.length} word timings` : "(no word timings)"} "${text.slice(0, 48)}"`
  );
  return { path: file, durationSecs, cached: false, key, words, provider: spoke };
}

/**
 * Voice every caption of a spec, in order. Sequential rather than parallel:
 * ElevenLabs rate-limits per key, and a 429 mid-video would fail the whole
 * article for a reason that has nothing to do with the article.
 */
export async function voiceSpec(slides, { articleId = "?" } = {}) {
  const out = [];
  let hits = 0, misses = 0;
  for (let i = 0; i < slides.length; i++) {
    const r = await voiceCaption(slides[i].caption, { slideIndex: i });
    r.cached ? hits++ : misses++;
    out.push(r);
  }
  const total = out.reduce((s, r) => s + r.durationSecs, 0);
  logger.info(
    `🔊 voiceSpec [${articleId}]: ${slides.length} captions — ${hits} cached, ${misses} synthesised, ` +
    `${total.toFixed(1)}s of audio`
  );
  return out;
}

// ─── Sweeper — shipped with the cache, not after it ─────────────────────────

/**
 * Delete cache entries older than the retention window.
 *
 * Age-based on mtime, deliberately not usage-based: a content-hashed file has
 * no owning row to consult, which is precisely the orphan class that grew
 * CARDS_DIR to ~19GB. Seven days matches the article prune — past that, the
 * article whose caption produced this audio is itself gone.
 */
export function sweepTtsCache({ retentionMs = TTS_RETENTION_MS, now = Date.now() } = {}) {
  if (!existsSync(TTS_CACHE_DIR)) return { removed: 0, bytes: 0, kept: 0 };
  let removed = 0, bytes = 0, kept = 0;
  for (const entry of readdirSync(TTS_CACHE_DIR)) {
    if (!entry.endsWith(".mp3")) continue;
    const p = path.join(TTS_CACHE_DIR, entry);
    try {
      const st = statSync(p);
      if (now - st.mtimeMs > retentionMs) {
        bytes += st.size; unlinkSync(p); removed++;
        // THE SIDECAR GOES WITH ITS CLIP. This function's own header explains
        // why content-hashed files with no owning row are the orphan class that
        // grew CARDS_DIR to ~19GB; a sidecar the sweeper does not know about is
        // that same bug, newly planted.
        const w = wordsPathFor(entry.replace(/\.mp3$/, ""));
        try { if (existsSync(w)) { bytes += statSync(w).size; unlinkSync(w); } } catch { /* best effort */ }
      }
      else kept++;
    } catch (err) {
      logger.warn(`🔊 sweepTtsCache: could not sweep ${p}: ${err.message}`);
    }
  }
  if (removed > 0) {
    logger.info(
      `🔊 sweepTtsCache: deleted ${removed} clip(s) older than ${(retentionMs / 86400000).toFixed(0)}d, ` +
      `${(bytes / 1048576).toFixed(1)} MB reclaimed, ${kept} kept`
    );
  }
  return { removed, bytes, kept };
}

export const _internals = { elevenLabs, kokoro, synthesise, BACKEND_ROOT };
