#!/usr/bin/env node
/**
 * frames.mjs — a contact sheet of a video, for agents to LOOK at with Read.
 *   node sixty/tools/frames.mjs <video> <out.jpg> [--every 3] [--max 30] [--cols 6]
 * Frames are labelled with their time. 240 px wide so a sheet stays readable.
 * (Homebrew ffmpeg has no drawtext, so labelling/tiling is PIL in the render venv.)
 */
import "./env.mjs";
import { execFileSync } from "child_process";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const [video, out, ...rest] = process.argv.slice(2);
if (!video || !out) { console.error("usage: frames.mjs <video> <out.jpg> [--every s] [--max n] [--cols n]"); process.exit(1); }
const opt = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? Number(rest[i + 1]) : d; };
const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], { encoding: "utf8" }));
let every = opt("every", Math.max(1, dur / 24)); const max = opt("max", 30), cols = opt("cols", 6);
if (dur / every > max) every = dur / max;

const tmp = mkdtempSync(path.join(tmpdir(), "sixty-frames-"));
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", `fps=1/${every.toFixed(4)},scale=240:-2`, path.join(tmp, "f%04d.jpg")]);
const files = readdirSync(tmp).filter((f) => f.endsWith(".jpg")).sort().slice(0, max);
const py = `
import sys, json
from PIL import Image, ImageDraw
files, every, cols, out = json.loads(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
ims = [Image.open(f).convert('RGB') for f in files]
w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (w * cols, h * rows))
for i, im in enumerate(ims):
    d = ImageDraw.Draw(im); t = i * every + every / 2
    d.rectangle((0, 0, 64, 18), fill=(0, 0, 0)); d.text((4, 3), f'{t:5.1f}s', fill=(255, 230, 0))
    S.paste(im, ((i % cols) * w, (i // cols) * h))
S.save(out, quality=85)`;
execFileSync(process.env.SHOT_ENGINE_PYTHON, ["-c", py, JSON.stringify(files.map((f) => path.join(tmp, f))), String(every), String(cols), out]);
rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify({ sheet: out, duration: +dur.toFixed(2), frames: files.length, every_s: +every.toFixed(2) }));
