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

export const VOICE_ID  = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";  // Rachel
export const MODEL_ID  = process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2";
// Mirrors ttsService's tuning, which is what the channel already sounds like.
export const VOICE_SETTINGS = Object.freeze({ stability: 0.5, similarity_boost: 0.75, speed: 1.05 });

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
