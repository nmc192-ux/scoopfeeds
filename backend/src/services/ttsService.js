/**
 * ttsService.js — text-to-speech with multi-provider fallback.
 *
 * Priority (highest quality wins, most expensive first):
 *   1. OpenAI TTS              (OPENAI_API_KEY + OPENAI_TTS_VOICE)         — best quality, paid
 *   2. ElevenLabs              (ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID)  — premium, paid
 *   3. Google Cloud TTS        (GOOGLE_TTS_KEY)                            — free tier 1M chars/mo, key-gated
 *   4. Google Translate TTS    (no key required)                           — same backend gTTS Python lib uses;
 *                                                                            standard (non-neural) voice but
 *                                                                            crisp and free with no signup
 *   5. "silent"                — returns null; caller renders a text-only video
 *
 * The Google Translate path means TTS is "always configured" out of the box:
 * with zero env vars set, every video still gets narration. Set
 * TTS_DISABLE_FREE=1 to opt out (forces silent fallback when no key-gated
 * provider is configured — useful for ops who'd rather see no audio than
 * the standard Google voice).
 *
 * Usage:
 *   const audioPath = await generateTts(script, articleId);
 *   // audioPath is an absolute path to a WAV/MP3 on disk, or null if silent.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR    = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.join(process.env.SCOOP_PERSISTENT_DATA_DIR, "audio")
  : path.join(__dirname, "../../data/audio");
try {
  if (!existsSync(AUDIO_DIR)) mkdirSync(AUDIO_DIR, { recursive: true });
} catch (e) {
  console.error("[ttsService] Could not create AUDIO_DIR:", AUDIO_DIR, e.message);
}

// ─── Provider checks ────────────────────────────────────────────────────────

// Google Translate TTS is opt-out: any deploy gets a free narration unless
// the operator explicitly disables it via TTS_DISABLE_FREE=1.
function freeTtsEnabled() {
  return process.env.TTS_DISABLE_FREE !== "1";
}

export function isTtsConfigured() {
  return Boolean(
    process.env.OPENAI_API_KEY   ||
    process.env.ELEVENLABS_API_KEY ||
    process.env.GOOGLE_TTS_KEY    ||
    freeTtsEnabled()
  );
}

export function ttsProvider() {
  if (process.env.OPENAI_API_KEY)    return "openai";
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs";
  if (process.env.GOOGLE_TTS_KEY)    return "google";
  if (freeTtsEnabled())              return "gtranslate";
  return "silent";
}

// ─── OpenAI TTS ─────────────────────────────────────────────────────────────

async function openaiTts(text, outputPath) {
  const voice = process.env.OPENAI_TTS_VOICE || "alloy"; // alloy|echo|fable|onyx|nova|shimmer
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",        // tts-1 (fast/cheap) or tts-1-hd (better quality)
      input: text.slice(0, 4096),
      voice,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI TTS ${res.status}: ${body.slice(0, 200)}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(outputPath, buffer);
  return outputPath;
}

// ─── ElevenLabs TTS ─────────────────────────────────────────────────────────

async function elevenLabsTts(text, outputPath) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text: text.slice(0, 5000),
      model_id: "eleven_turbo_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.05 },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS ${res.status}: ${body.slice(0, 200)}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(outputPath, buffer);
  return outputPath;
}

// ─── Google Cloud TTS ───────────────────────────────────────────────────────

async function googleTts(text, outputPath) {
  const key = process.env.GOOGLE_TTS_KEY;
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: text.slice(0, 5000) },
        voice: { languageCode: "en-US", ssmlGender: "NEUTRAL", name: "en-US-Neural2-C" },
        audioConfig: { audioEncoding: "MP3", speakingRate: 1.05, pitch: 0 },
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google TTS ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const buf  = Buffer.from(json.audioContent, "base64");
  require("fs").writeFileSync(outputPath, buf);
  return outputPath;
}

// ─── Google Translate TTS (no key required) ────────────────────────────────
//
// Google Translate's "speak" widget (the speaker icon next to translations)
// is backed by a public TTS endpoint. The Python `gTTS` library has used
// this for ~10 years; it's stable, free, and needs no signup.
//
// Endpoint:
//   GET https://translate.google.com/translate_tts
//     ?ie=UTF-8&tl=en&q=<text>&client=tw-ob
//   → 200 OK, content-type: audio/mpeg, body = MP3 (24kHz mono)
//
// Length limit: ~200 chars per request. Long scripts are split on sentence
// boundaries and the resulting MP3 chunks are concatenated (MP3 streams
// concatenate cleanly at the byte level).
//
// Voice: standard (non-neural). Sounds dated next to OpenAI/ElevenLabs but
// is perfectly clear for short news narration. Language configurable via
// GTTS_LANG (defaults to "en"). For Urdu narration set GTTS_LANG=ur.
const GTTS_ENDPOINT  = "https://translate.google.com/translate_tts";
const GTTS_MAX_CHARS = 190; // gTTS truncates around 200; tight margin

// Sentence-aware splitter — keeps clauses intact when chunking long scripts.
function chunkForFreeTts(text, max = GTTS_MAX_CHARS) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return [cleaned];

  const out = [];
  let buf = "";
  const pieces = cleaned.split(/(?<=[.!?])\s+/);
  for (const piece of pieces) {
    if (piece.length > max) {
      if (buf) { out.push(buf); buf = ""; }
      let rest = piece;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(" ", max);
        if (cut < max * 0.5) cut = max;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) buf = rest;
      continue;
    }
    if ((buf + " " + piece).trim().length > max) {
      if (buf) out.push(buf);
      buf = piece;
    } else {
      buf = (buf ? buf + " " : "") + piece;
    }
  }
  if (buf) out.push(buf);
  return out.filter(Boolean);
}

async function gtranslateTts(text, outputPath) {
  const lang   = process.env.GTTS_LANG || "en";
  const chunks = chunkForFreeTts(text);
  const buffers = [];
  for (let i = 0; i < chunks.length; i++) {
    const u =
      `${GTTS_ENDPOINT}?ie=UTF-8&tl=${encodeURIComponent(lang)}` +
      `&q=${encodeURIComponent(chunks[i])}&client=tw-ob`;
    const res = await fetch(u, {
      // The Translate endpoint returns a generic block page if the UA
      // doesn't look browser-ish. Mimic Chrome.
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer":    "https://translate.google.com/",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Google Translate TTS chunk ${i + 1}/${chunks.length} → ${res.status}: ${body.slice(0, 200)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error(`Google Translate TTS returned empty body for chunk ${i + 1}`);
    buffers.push(buf);
    // Tiny pacing delay between chunks — keeps us off Google's bot-detection
    // radar when chunks > 1.
    if (i + 1 < chunks.length) await new Promise(r => setTimeout(r, 250));
  }
  writeFileSync(outputPath, Buffer.concat(buffers));
  return outputPath;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate TTS audio for `text` and write to disk.
 * Returns the absolute path to the MP3 file, or null if no TTS is configured.
 */
export async function generateTts(text, articleId) {
  if (!isTtsConfigured()) return null;

  const outputPath = path.join(AUDIO_DIR, `${articleId}.mp3`);
  // Return cached audio if available (same article re-run)
  if (existsSync(outputPath)) return outputPath;

  const provider = ttsProvider();
  try {
    if (provider === "openai")     return await openaiTts(text, outputPath);
    if (provider === "elevenlabs") return await elevenLabsTts(text, outputPath);
    if (provider === "google")     return await googleTts(text, outputPath);
    if (provider === "gtranslate") return await gtranslateTts(text, outputPath);
  } catch (err) {
    logger.warn(`ttsService(${provider}): ${err.message} — falling back to silent`);
    // Last-ditch fallback: if a paid provider failed (e.g. 401, rate limit),
    // try the free Google Translate path before giving up entirely.
    if (provider !== "gtranslate" && freeTtsEnabled()) {
      try { return await gtranslateTts(text, outputPath); }
      catch (e2) { logger.warn(`ttsService(gtranslate fallback): ${e2.message}`); }
    }
  }
  return null;
}

/**
 * Build a narration script for a short video (≤45 seconds at 130 wpm).
 * ~97 words = 45 seconds; we target ~80 words for a comfortable 35-second clip.
 */
export function buildVideoScript(article, bullets) {
  const source  = article.source_name || "Scoop";
  const cat     = (article.category || "").replace(/-/g, " ");
  const rawHead = String(article.title || "").replace(/['"]/g, "");

  // Truncate headline so it doesn't eat the whole script budget
  const headline = rawHead.length > 120 ? rawHead.slice(0, 117) + "…" : rawHead;

  const lines = [
    `${source} reports: ${headline}.`,
  ];

  for (const b of bullets.slice(0, 3)) {
    const clean = String(b).replace(/^[•–\-]+\s*/, "").replace(/['"]/g, "").trim();
    if (clean.length > 10) lines.push(clean + ".");
  }

  lines.push("For the full story, visit Scoop Feeds at scoopfeeds dot com.");

  return lines.join("  ");
}
