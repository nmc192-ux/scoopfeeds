/**
 * ttsService.js — text-to-speech with multi-provider fallback.
 *
 * Priority:
 *   1. OpenAI TTS (OPENAI_API_KEY + OPENAI_TTS_VOICE)   — best quality
 *   2. ElevenLabs  (ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID) — premium
 *   3. Google Cloud TTS (GOOGLE_TTS_KEY)                — free tier 1M chars/mo
 *   4. "silent" — returns null; caller renders a text-only video
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

export function isTtsConfigured() {
  return Boolean(
    process.env.OPENAI_API_KEY   ||
    process.env.ELEVENLABS_API_KEY ||
    process.env.GOOGLE_TTS_KEY
  );
}

export function ttsProvider() {
  if (process.env.OPENAI_API_KEY)    return "openai";
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs";
  if (process.env.GOOGLE_TTS_KEY)    return "google";
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
  } catch (err) {
    logger.warn(`ttsService(${provider}): ${err.message} — falling back to silent`);
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
