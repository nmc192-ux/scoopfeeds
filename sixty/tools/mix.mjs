#!/usr/bin/env node
/**
 * mix.mjs — score a silent 60 · render: approved bed + ducking + cut SFX (prod
 * mix.py, verbatim), then the 60 · stopwatch tick, then AAC — re-measured AFTER
 * the encode, with the same corrective trim the shot engine uses.
 *
 *   node sixty/tools/mix.mjs --video silent.mp4 --narration narration.wav --plan plan.json \
 *        --title "..." --summary "..." --out final.mp4 [--tick-db -34]
 *
 * Tone (and so the bed group) comes from prod toneFor(): grief → very low tense
 * bed, never driving. Cuts come from the plan (every shot start; punch = hit).
 */
import "./env.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { execFile } from "child_process";

const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const video = arg("video"), narration = arg("narration"), planPath = arg("plan"), out = arg("out");
if (!video || !narration || !planPath || !out) { console.error("usage: mix.mjs --video --narration --plan --out [--title --summary --tick-db]"); process.exit(1); }
const tickDb = Number(arg("tick-db", "-34"));

const { toneFor, pickBed, measure } = await import("../../backend/src/services/shots/shotSound.js");
const { ENGINE_DIR, enginePython } = await import("../../backend/src/services/shots/shotVideo.js");

const run = (bin, args) => new Promise((res, rej) => execFile(bin, args, { maxBuffer: 32 << 20, timeout: 10 * 60 * 1000 },
  (e, o, se) => (e ? rej(new Error(`${path.basename(bin)}: ${String(se || e.message).slice(-400)}`)) : res(String(o)))));

const plan = JSON.parse(readFileSync(planPath, "utf8"));
const total = plan.total;
const work = path.join(path.dirname(out), "mixwork");
mkdirSync(work, { recursive: true });

const article = { title: arg("title", ""), description: arg("summary", "") };
const spec = { slides: (plan.captions || []).map((c) => ({ caption: c })) };
const tone = toneFor(article, spec);
const lib = tone.level === "none" ? null : pickBed(tone.group, { record: process.argv.includes("--record-bed") });

// Soundbites (playbook rule 2): the speaker's own audio goes INTO the voice stem at its slot
// (narration.wav is silent there), so mix.py ducks the bed under them exactly as under narration.
const voicePath = arg("voice", path.join(path.dirname(narration), "voice.json"));
let voiceStem = narration, soundbites = [];
if (existsSync(voicePath)) {
  soundbites = JSON.parse(readFileSync(voicePath, "utf8")).lines.filter((l) => l.kind === "soundbite" && l.audio);
  if (soundbites.length) {
    voiceStem = path.join(work, "voice-with-soundbites.wav");
    const ins = soundbites.flatMap((b) => ["-i", b.audio]);
    const fl = soundbites.map((b, i) => `[${i + 1}:a]adelay=${Math.round(b.start * 1000)}|${Math.round(b.start * 1000)}[s${i}]`);
    const mixIn = ["[0:a]", ...soundbites.map((_, i) => `[s${i}]`)].join("");
    await run("ffmpeg", ["-v", "error", "-y", "-i", narration, ...ins, "-filter_complex",
      `${fl.join(";")};${mixIn}amix=inputs=${soundbites.length + 1}:normalize=0:duration=first[v]`, "-map", "[v]", "-c:a", "pcm_s16le", voiceStem]);
  }
}

const cuts = plan.shots.filter((s, i) => i > 0).map((s) => ({ t: s.t0, kind: s.kind, turn: !!s.turn }));
const mixWav = path.join(work, "mix.wav");
const cfg = path.join(work, "mix.json");
writeFileSync(cfg, JSON.stringify({ narration: voiceStem, bed: lib?.path || null, bed_level: tone.level, cuts, total, out: mixWav }));
const first = JSON.parse((await run(enginePython(), [path.join(ENGINE_DIR, "mix.py"), cfg])).trim().split("\n").pop());

// The stopwatch tick: a 3 kHz click, 20 ms decaying, once per second for the whole film.
const tickWav = path.join(work, "tick.wav");
const amp = Math.pow(10, tickDb / 20).toFixed(5);
await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
  `aevalsrc='${amp}*sin(2*PI*3000*t)*exp(-mod(t\\,1)*250)*lt(mod(t\\,1)\\,0.02)':s=48000:d=${total}`,
  "-ac", "2", tickWav]);
const withTick = path.join(work, "mix-tick.wav");
await run("ffmpeg", ["-v", "error", "-y", "-i", mixWav, "-i", tickWav, "-filter_complex",
  "[0:a][1:a]amix=inputs=2:normalize=0:duration=first[a]", "-map", "[a]", "-c:a", "pcm_s16le", withTick]);

const encode = (gainDb) => run("ffmpeg", ["-v", "error", "-y", "-i", video, "-i", withTick, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
  ...(gainDb ? ["-af", `volume=${gainDb.toFixed(2)}dB`] : []), "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
  "-t", String(total), "-movflags", "+faststart", out]);
await encode(0);
let m = await measure(out);
let trim = 0;
if (Number.isFinite(m.TP) && m.TP > -1.0) { trim = -(m.TP + 1.3); await encode(trim); m = await measure(out); }

const sound = { tone: tone.why, group: tone.group, level: tone.level, bed: lib ? `library:${lib.id}` : "none",
  soundbites: soundbites.map((b) => ({ id: b.id, at: b.start, secs: b.secs })), firstPass: first, after_aac: m, trimDb: +trim.toFixed(2), tickDb, meetsBar: Math.abs(m.I + 14) <= 1 && m.TP <= -1 };
writeFileSync(path.join(path.dirname(out), "sound.json"), JSON.stringify(sound, null, 1));
console.log(JSON.stringify(sound));
