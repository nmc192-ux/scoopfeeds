#!/usr/bin/env node
/**
 * transcribe.mjs — word-timed transcript of a media file, free and local (whisper.cpp,
 * small.en). For soundbites: the writer quotes EXACT words, and the film's captions
 * follow the speaker's own timings.
 *
 *   node sixty/tools/transcribe.mjs <media> [--from s --to s]
 * Writes <media>.words.json  { model, from, to, text, words: [{ w, s, e }] }  (times in the
 * SOURCE file's clock) and prints the text. Whisper can mishear: a quote used on screen must
 * also match a published transcript or the fact-checker's listening note.
 */
import "./env.mjs";
import { HOME } from "./env.mjs";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const [media, ...rest] = process.argv.slice(2);
if (!media) { console.error("usage: transcribe.mjs <media> [--from s --to s]"); process.exit(1); }
const opt = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? Number(rest[i + 1]) : d; };
const from = opt("from", 0), to = opt("to", null);
const model = path.join(HOME, "models/ggml-small.en.bin");

const tmp = mkdtempSync(path.join(tmpdir(), "sixty-stt-"));
const wav = path.join(tmp, "a.wav");
execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from), ...(to ? ["-to", String(to)] : []), "-i", media,
  "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
execFileSync("whisper-cli", ["-m", model, "-f", wav, "-ml", "1", "-sow", "-ojf", "-of", path.join(tmp, "out"), "-np"], { stdio: ["ignore", "ignore", "pipe"] });
const j = JSON.parse(readFileSync(path.join(tmp, "out.json"), "utf8"));
const words = (j.transcription || []).map((seg) => ({
  w: String(seg.text).trim(), s: +(from + seg.offsets.from / 1000).toFixed(2), e: +(from + seg.offsets.to / 1000).toFixed(2),
})).filter((x) => x.w && !/^\[.*\]$/.test(x.w));
const text = words.map((x) => x.w).join(" ").replace(/\s+([,.!?;:])/g, "$1");
writeFileSync(`${media}.words.json`, JSON.stringify({ model: "whisper.cpp small.en", from, to, text, words }, null, 1));
rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify({ words: words.length, out: `${media}.words.json` }));
console.log(text);
