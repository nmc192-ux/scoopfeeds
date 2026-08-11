/**
 * videoVoice.js — one ElevenLabs call per slide caption, cached by content.
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

export function isVoiceConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

/** sha1(caption + voice + model + settings) — content, never identity. */
export function cacheKeyFor(caption) {
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

async function elevenLabs(caption) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text: String(caption).slice(0, 5000),
      model_id: MODEL_ID,
      voice_settings: { ...VOICE_SETTINGS },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new VoiceError(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`, { caption, status: res.status });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 256) throw new VoiceError(`ElevenLabs returned ${buf.length} bytes — not audio`, { caption });
  return buf;
}

/**
 * Voice one caption. Returns { path, durationSecs, cached, key }.
 * Throws VoiceError on any failure — never returns silence.
 */
export async function voiceCaption(caption, { slideIndex = -1 } = {}) {
  const text = String(caption || "").trim();
  if (!text) throw new VoiceError(`slide ${slideIndex}: empty caption — every card must carry its narration line`);
  if (!isVoiceConfigured()) throw new VoiceError("ELEVENLABS_API_KEY is not set");

  if (!existsSync(TTS_CACHE_DIR)) mkdirSync(TTS_CACHE_DIR, { recursive: true });
  const key = cacheKeyFor(text);
  const file = path.join(TTS_CACHE_DIR, `${key}.mp3`);

  if (existsSync(file) && statSync(file).size > 256) {
    const durationSecs = probeDurationSecs(file);
    logger.info(`🔊 voice slide ${slideIndex}: CACHE HIT ${key} (${durationSecs.toFixed(2)}s) "${text.slice(0, 48)}"`);
    return { path: file, durationSecs, cached: true, key };
  }

  const t0 = Date.now();
  const buf = await elevenLabs(text);
  writeFileSync(file, buf);
  const durationSecs = probeDurationSecs(file);
  logger.info(
    `🔊 voice slide ${slideIndex}: CACHE MISS ${key} — synthesised ${(buf.length / 1024).toFixed(0)}KB / ` +
    `${durationSecs.toFixed(2)}s in ${Date.now() - t0}ms "${text.slice(0, 48)}"`
  );
  return { path: file, durationSecs, cached: false, key };
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
      if (now - st.mtimeMs > retentionMs) { bytes += st.size; unlinkSync(p); removed++; }
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

export const _internals = { elevenLabs, BACKEND_ROOT };
