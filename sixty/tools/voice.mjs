#!/usr/bin/env node
/**
 * voice.mjs — narrate a 60 · script with the prod voice path (Kokoro, pronunciation
 * overrides, word timings: videoVoice.voiceCaption + shotVideo.buildTimeline/
 * buildNarration, verbatim), with SOUNDBITES (playbook rule 2): a line of kind
 * "soundbite" is not narrated — the speaker's own audio plays there.
 *
 *   node sixty/tools/voice.mjs <script.json> <outdir> [--total 60]
 *
 * script.json: { lines: [{ id, text }, { id, kind: "soundbite", media: ["M2"], in, out, speaker, title, text }] }
 *   Soundbite media resolve through register.json (next to script.json) → media[].local.
 *   The clip must have been transcribed first (sixty/tools/transcribe.mjs <file>): its
 *   word timings become the captions there, and `text` must match what was said.
 * Writes <outdir>/narration.wav (narration only, SILENT under soundbites), soundbite audio
 * <outdir>/sb-<id>.wav, and <outdir>/voice.json:
 *   { narrationSecs, total, fits, lines: [{id, kind, start, secs, src?, in?, out?, audio?}], words }
 * Exit 2 = does not fit in 57.4 s; 3 = a soundbite cannot be resolved/transcribed.
 */
import "./env.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { execFileSync } from "child_process";

const [scriptPath, outdir, ...rest] = process.argv.slice(2);
if (!scriptPath || !outdir) { console.error("usage: voice.mjs <script.json> <outdir> [--total 60]"); process.exit(1); }
const total = Number(rest[rest.indexOf("--total") + 1]) || 60.0;
const END_CARD = 2.6;
const fail = (code, msg) => { console.error(msg); process.exit(code); };

const { voiceCaption } = await import("../../backend/src/services/videoVoice.js");
const { buildTimeline, buildNarration } = await import("../../backend/src/services/shots/shotVideo.js");

const dir = path.dirname(path.resolve(scriptPath));
const script = JSON.parse(readFileSync(scriptPath, "utf8"));
const reg = existsSync(path.join(dir, "register.json")) ? JSON.parse(readFileSync(path.join(dir, "register.json"), "utf8")) : { media: [] };
mkdirSync(outdir, { recursive: true });

const slides = [], audio = [], meta = [];
for (const [i, l] of script.lines.entries()) {
  if (l.kind === "soundbite") {
    const mid = (l.media || [])[0];
    const m = (reg.media || []).find((x) => x.id === mid);
    const src = m?.local ? path.resolve(dir, m.local) : null;
    if (!src || !existsSync(src)) fail(3, `soundbite ${l.id}: media ${mid} has no local file`);
    const a = Math.max(0, Number(l.in)), b = Number(l.out);
    if (!(b > a)) fail(3, `soundbite ${l.id}: needs in < out (source seconds)`);
    const tf = `${src}.words.json`;
    if (!existsSync(tf)) fail(3, `soundbite ${l.id}: transcribe first — node sixty/tools/transcribe.mjs ${src}`);
    const tr = JSON.parse(readFileSync(tf, "utf8"));
    const words = tr.words.filter((w) => w.s >= a - 0.05 && w.e <= b + 0.05).map((w) => ({ word: w.w, start: +(w.s - a).toFixed(3), end: +(w.e - a).toFixed(3) }));
    const sb = path.join(outdir, `sb-${l.id}.wav`);
    // The speaker at roughly the narration's level; mix.py normalises the whole voice stem after.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(a), "-to", String(b), "-i", src, "-vn", "-ac", "2", "-ar", "48000",
      "-af", "loudnorm=I=-17:TP=-3:LRA=11", "-c:a", "pcm_s16le", sb]);
    const silent = path.join(outdir, `gap-${l.id}.wav`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(b - a), "-c:a", "pcm_s16le", silent]);
    slides.push({ caption: words.map((w) => w.word).join(" ") || l.text });
    audio.push({ path: silent, durationSecs: b - a, words });
    meta.push({ id: l.id, kind: "soundbite", src, in: a, out: b, audio: sb, speaker: l.speaker, title: l.title, heard: words.map((w) => w.word).join(" ") });
  } else {
    const r = await voiceCaption(String(l.text).trim(), { slideIndex: i });
    slides.push({ caption: String(l.text).trim() });
    audio.push(r);
    meta.push({ id: l.id, kind: "narration", timed: !!r.words });
  }
}
const tl = buildTimeline(slides, audio);
const out = path.join(outdir, "narration.wav");
await buildNarration(audio, slides, total, out);
const lines = meta.map((m, i) => ({ ...m, start: +tl.starts[i].toFixed(3), secs: +audio[i].durationSecs.toFixed(3) }));
const report = { narrationSecs: +tl.narrationSecs.toFixed(3), total, endCardFrom: +(total - END_CARD).toFixed(3),
  fits: tl.narrationSecs <= total - END_CARD, soundbiteSecs: +lines.filter((l) => l.kind === "soundbite").reduce((n, l) => n + l.secs, 0).toFixed(2),
  lines, words: tl.words };
writeFileSync(path.join(outdir, "voice.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ narration: out, narrationSecs: report.narrationSecs, soundbiteSecs: report.soundbiteSecs, fits: report.fits, words: tl.words.length }));
process.exit(report.fits ? 0 : 2);
