// Narration stage. One ElevenLabs take per beat, cached on disk.
//
// Voice, model and settings mirror backend/src/services/videoVoice.js so the
// long-form sounds like the channel's 60-100s clips. The single deliberate
// deviation is speed: 1.05 → 1.00, clip pacing → documentary pacing.
//
// Durations are measured by decoding with the bundled ffmpeg (no ffprobe in
// this tree) and parsing the final reported time.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { ffmpegPath, P, ENV_FILES } from "./_deps.mjs";

const FFMPEG = ffmpegPath;
const execFileP = promisify(execFile);

const AUDIO_DIR = P("out/audio");

// ── env ──────────────────────────────────────────────────────────────────
function loadEnv() {
  for (const f of ENV_FILES) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const VOICE_ID = process.env.VIDEO_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const MODEL_ID = process.env.VIDEO_VOICE_MODEL || "eleven_turbo_v2";
const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75, speed: 1.0 };

/**
 * Duration by decoding to null and taking the last reported time.
 * ffmpeg writes progress to stderr on BOTH the success and failure paths, so
 * one call covers both — resolve and reject just carry stderr differently.
 */
export async function measureDuration(file) {
  const { stderr } = await execFileP(FFMPEG, ["-hide_banner", "-i", file, "-f", "null", "-"])
    .catch((e) => ({ stderr: String(e.stderr || "") }));
  const times = [...String(stderr).matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
  if (!times.length) throw new Error(`could not measure ${file}`);
  const t = times[times.length - 1];
  return (+t[1]) * 3600 + (+t[2]) * 60 + (+t[3]);
}

async function synth(text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 256) throw new Error(`returned ${buf.length} bytes — not audio`);
  return buf;
}

// build.mjs's fixed "outro" card is BRAND COPY, not project text — render.mjs
// hard-codes "SCOOPFEEDS / SUBSCRIBE FOR THE NEXT ONE / scoopfeeds.com" and
// ignores whatever spec it's given. Its narration must therefore be equally
// fixed, and build.mjs requires out/audio/outro.mp3 to exist unconditionally.
// Nothing else in the pipeline produced that file — it was synthesised by hand
// for the first two videos, which is exactly the kind of undocumented step
// that makes a "reusable engine" not actually reusable. Synth it here, always.
const OUTRO_LINE =
  "If you want the next one, subscribe. The full sourced dossier is at scoopfeeds dot com.";

async function main() {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not set");
  mkdirSync(AUDIO_DIR, { recursive: true });
  const beats = JSON.parse(readFileSync(P("beats.json"), "utf8"));

  const out = [];
  let synthed = 0, cached = 0;
  for (const b of [...beats, { id: "outro", text: OUTRO_LINE }]) {
    const file = path.join(AUDIO_DIR, typeof b.id === "number"
      ? `b${String(b.id).padStart(2, "0")}.mp3` : `${b.id}.mp3`);
    // THE CACHE IS KEYED ON THE BEAT'S TEXT, NOT ITS NUMBER. Takes are named
    // b01.mp3, b02.mp3 … and the cache used to be a bare existsSync on that
    // path — so editing beat 12's line, or inserting a beat and shifting every
    // number after it, silently kept the OLD audio under the new number. The
    // film then narrates one script while showing the cards of another, and
    // nothing in the build reports a problem. That failure has already cost one
    // review cycle. A sidecar holds the text each take was synthesised from;
    // any difference re-synthesises.
    const sidecar = file.replace(/\.mp3$/, ".txt");
    const stale = existsSync(file) && (!existsSync(sidecar)
      || readFileSync(sidecar, "utf8") !== b.text);
    if (!existsSync(file) || stale) {
      writeFileSync(file, await synth(b.text));
      writeFileSync(sidecar, b.text);
      synthed++;
      process.stdout.write(stale ? "!" : ".");
    } else {
      cached++;
      process.stdout.write("·");
    }
    out.push({ id: b.id, file, text: b.text, dur: await measureDuration(file) });
  }
  process.stdout.write("\n");

  const total = out.reduce((a, x) => a + x.dur, 0);
  writeFileSync(P("takes.json"), JSON.stringify(out, null, 2));

  const mins = Math.floor(total / 60);
  console.log(`synthesised ${synthed}, cached ${cached}   (. new  ! text changed  · reused)`);
  console.log(`narration total: ${mins}m${(total % 60).toFixed(1)}s across ${out.length} takes`);
  const longest = [...out].sort((a, b) => b.dur - a.dur).slice(0, 3);
  console.log("longest takes:", longest.map((x) => `b${x.id}=${x.dur.toFixed(1)}s`).join(" "));
  const shortest = [...out].sort((a, b) => a.dur - b.dur).slice(0, 3);
  console.log("shortest takes:", shortest.map((x) => `b${x.id}=${x.dur.toFixed(1)}s`).join(" "));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
