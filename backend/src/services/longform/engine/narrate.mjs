// Narration stage. One ElevenLabs take per beat, cached on disk.
//
// Voice, model and settings mirror backend/src/services/videoVoice.js so the
// long-form sounds like the channel's 60-100s clips. The single deliberate
// deviation is speed: 1.05 → 1.00, clip pacing → documentary pacing.
//
// Durations are measured by decoding with the bundled ffmpeg (no ffprobe in
// this tree) and parsing the final reported time.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { ffmpegPath, P, ENV_FILES } from "./_deps.mjs";
import { wordsFromAlignment } from "./wordTimings.mjs";

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
// OVERRIDABLE, WITH THE SHIPPED VALUES AS DEFAULTS. These were hardcoded, so a
// brief specifying "stability 0.45" described a setting no film could actually
// reach — the number was unreachable rather than wrong, which is worse, because
// it reads as configuration. Defaults are unchanged, so every existing film
// narrates identically; a project that wants a different voice sets the env.
const num = (v, dflt) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : dflt);
const VOICE_SETTINGS = {
  stability: num(process.env.VIDEO_VOICE_STABILITY, 0.5),
  similarity_boost: num(process.env.VIDEO_VOICE_SIMILARITY, 0.75),
  speed: num(process.env.VIDEO_VOICE_SPEED, 1.0),
};

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

/**
 * Synthesise one take, asking for the character alignment alongside the audio.
 *
 * `/with-timestamps` returns JSON — base64 audio plus three parallel character
 * arrays — instead of an audio stream. wordTimings.mjs turns those into words,
 * which is what lets a card element land on a WORD rather than at a fixed
 * fraction of the line (see build.mjs's revealAt).
 *
 * IT DEGRADES, IT DOES NOT FAIL. The alignment is an enhancement: a model or
 * account without the endpoint still has to produce a film. On any failure of
 * the timestamps call we fall back to the plain endpoint and return no words,
 * and the caller then keeps the proportional timing this engine has always
 * used. The one thing we never do is invent timings — no words file is a
 * truthful "unmeasured", and a fabricated one is not.
 *
 * @returns {{buf: Buffer, words: {word,start,end}[]|null}}
 */
async function synth(text) {
  const body = JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS });
  const headers = {
    "xi-api-key": process.env.ELEVENLABS_API_KEY,
    "Content-Type": "application/json",
  };

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps`,
      { method: "POST", headers: { ...headers, Accept: "application/json" }, body });
    if (res.ok) {
      const json = await res.json();
      const buf = Buffer.from(String(json.audio_base64 || ""), "base64");
      if (buf.length >= 256) {
        // normalized_alignment matches the text as SPOKEN (numbers expanded);
        // alignment matches the text as WRITTEN, which is what an author's
        // anchor phrase is copied from. Prefer the written one.
        const words = wordsFromAlignment(json.alignment || json.normalized_alignment);
        return { buf, words: words.length ? words : null };
      }
    }
    process.stdout.write("t");   // timestamps unavailable — see the legend
  } catch { process.stdout.write("t"); }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: { ...headers, Accept: "audio/mpeg" },
    body,
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 256) throw new Error(`returned ${buf.length} bytes — not audio`);
  return { buf, words: null };
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
  let synthed = 0, cached = 0, timed = 0;
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
    // The words file rides with the take: written when the take is, removed
    // when the take is re-synthesised without an alignment. It can therefore
    // never describe a DIFFERENT take than the mp3 beside it, which is the
    // same trap the .txt sidecar above exists to close.
    const wordsFile = file.replace(/\.mp3$/, ".words.json");
    if (!existsSync(file) || stale) {
      const { buf, words } = await synth(b.text);
      writeFileSync(file, buf);
      writeFileSync(sidecar, b.text);
      if (words) writeFileSync(wordsFile, JSON.stringify(words));
      else if (existsSync(wordsFile)) rmSync(wordsFile);
      if (words) timed++;
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
  console.log(`synthesised ${synthed}, cached ${cached}   (. new  ! text changed  · reused  t no timestamps)`);
  console.log(`word timings: ${timed}/${synthed} new take(s) carry an alignment` + (timed < synthed ? " — the rest fall back to proportional reveal timing" : ""));
  console.log(`narration total: ${mins}m${(total % 60).toFixed(1)}s across ${out.length} takes`);
  const longest = [...out].sort((a, b) => b.dur - a.dur).slice(0, 3);
  console.log("longest takes:", longest.map((x) => `b${x.id}=${x.dur.toFixed(1)}s`).join(" "));
  const shortest = [...out].sort((a, b) => a.dur - b.dur).slice(0, 3);
  console.log("shortest takes:", shortest.map((x) => `b${x.id}=${x.dur.toFixed(1)}s`).join(" "));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
