#!/usr/bin/env node
/**
 * voice.mjs — narrate a 60 · script with the prod voice path (Kokoro bm_george,
 * pronunciation overrides, word timings), reusing voiceSpec/buildTimeline/
 * buildNarration from the shot engine verbatim.
 *
 *   node sixty/tools/voice.mjs <script.json> <outdir> [--total 60]
 *
 * script.json: { lines: [{ id, text }] }  — one narration line per beat.
 * Writes <outdir>/narration.wav (padded to --total), <outdir>/voice.json:
 *   { narrationSecs, total, lines: [{id, start, secs}], words: [{w,s,e,slide}] }
 * Exit 2 if the narration does not fit (narrationSecs > total - endCard).
 */
import "./env.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";

const [scriptPath, outdir, ...rest] = process.argv.slice(2);
if (!scriptPath || !outdir) { console.error("usage: voice.mjs <script.json> <outdir> [--total 60]"); process.exit(1); }
const total = Number(rest[rest.indexOf("--total") + 1]) || 60.0;
const END_CARD = 2.6;

const { voiceSpec } = await import("../../backend/src/services/videoVoice.js");
const { buildTimeline, buildNarration } = await import("../../backend/src/services/shots/shotVideo.js");

const script = JSON.parse(readFileSync(scriptPath, "utf8"));
const slides = script.lines.map((l) => ({ caption: String(l.text).trim() }));
mkdirSync(outdir, { recursive: true });
const audio = await voiceSpec(slides, { articleId: "sixty" });
const tl = buildTimeline(slides, audio);
const out = path.join(outdir, "narration.wav");
await buildNarration(audio, slides, total, out);
const report = {
  narrationSecs: +tl.narrationSecs.toFixed(3), total, endCardFrom: +(total - END_CARD).toFixed(3),
  fits: tl.narrationSecs <= total - END_CARD,
  lines: script.lines.map((l, i) => ({ id: l.id, start: tl.starts[i], secs: +audio[i].durationSecs.toFixed(3), timed: !!audio[i].words })),
  words: tl.words,
};
writeFileSync(path.join(outdir, "voice.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ narration: out, narrationSecs: report.narrationSecs, fits: report.fits, words: tl.words.length }));
process.exit(report.fits ? 0 : 2);
