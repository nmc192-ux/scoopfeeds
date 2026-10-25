/**
 * mediaCheckers.js - the real checkers behind contentSafety.assertMediaSafe (#218).
 *
 *   ffprobeProbe          ffprobe: duration, video?, audio?
 *   ffmpegFrameSampler    ONE ffmpeg pass that keeps a frame whenever 1 s has passed since the last
 *                         kept frame OR the scene score is over the threshold; times read from showinfo
 *   claudeVisionCheck     `claude -p` (DrJ's subscription, like programme/writer.js) reads the frames
 *                         in batches and returns safe / unsafe / unsure per frame
 *   whisperTranscriber    the openai-whisper CLI, JSON output
 *   claudeTranscriptCheck `claude -p` reads the transcript
 *   soundEvents           NOT PROVIDED: no sound-event classifier is installed. contentSafety refuses
 *                         any item with sound until one is (THRESHOLDS.soundEventsRequired).
 *
 * The ffmpeg pieces are measured in contentSafety.test.js when ffmpeg is on PATH. The Claude and whisper
 * pieces are UNVERIFIED until run on the Mac.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { CATEGORIES } from "./contentSafety.js";

const FFMPEG = () => process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = () => process.env.FFPROBE_PATH || "ffprobe";

export function ffprobeProbe(file) {
  const r = spawnSync(FFPROBE(), ["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${(r.stderr || "").slice(-300)}`);
  const j = JSON.parse(r.stdout);
  const types = (j.streams || []).map((s) => s.codec_type);
  return { durationSec: Number(j.format?.duration), hasVideo: types.includes("video"), hasAudio: types.includes("audio") };
}

/** The sampling filter: a frame when >= everySec since the last kept one, or on a scene change. */
export function samplerFilter({ everySec = 1, sceneThreshold = 0.3, width = 512 } = {}) {
  // isnan(prev_selected_t): the very first frame. gte(t - prev_selected_t, everySec): the 1/s floor.
  // The 1/s term is set a frame short (everySec - 0.02) so rounding never lets a gap run over everySec.
  const every = Math.max(0.05, everySec - 0.02);
  return `select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${every})+gt(scene\\,${sceneThreshold})',showinfo,scale=${width}:-2`;
}

export function buildSamplerArgs(file, outDir, opts = {}) {
  return ["-hide_banner", "-nostats", "-i", file, "-an", "-vf", samplerFilter(opts), "-fps_mode", "vfr", "-q:v", "4", path.join(outDir, "f%06d.jpg")];
}

/** showinfo prints one line per KEPT frame, in output order: read pts_time from each. */
export function parseShowinfoTimes(stderr) {
  return [...String(stderr).matchAll(/Parsed_showinfo[^\n]*?pts_time:\s*([\d.]+)/g)].map((m) => Number(m[1]));
}

export function ffmpegFrameSampler({ workDir = null } = {}) {
  return (file, opts = {}) => {
    const dir = workDir ? fs.mkdtempSync(path.join(workDir, "frames-")) : fs.mkdtempSync(path.join(os.tmpdir(), "safety-frames-"));
    const r = spawnSync(FFMPEG(), buildSamplerArgs(file, dir, opts), { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`ffmpeg sampling failed: ${(r.stderr || "").slice(-300)}`);
    const times = parseShowinfoTimes(r.stderr);
    const files = fs.readdirSync(dir).filter((f) => /^f\d+\.jpg$/.test(f)).sort();
    if (files.length !== times.length) throw new Error(`sampler wrote ${files.length} frames but logged ${times.length} times`);
    return files.map((f, i) => ({ t: times[i], path: path.join(dir, f) }));
  };
}

// ── Claude (subscription, never the API key) ──

function extractJson(s) {
  const a = String(s).indexOf("{"), b = String(s).lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no JSON object in the reply");
  return JSON.parse(String(s).slice(a, b + 1));
}

export function runClaude({ system, prompt, model = "sonnet", tools = "", addDir = null, timeoutMs = 10 * 60_000, bin = "claude" }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const args = ["-p", "--model", model, "--output-format", "json", "--tools", tools, "--strict-mcp-config", "--system-prompt", system];
    if (tools) args.push("--allowedTools", tools);
    if (addDir) args.push("--add-dir", addDir);
    const ch = spawn(bin, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => { ch.kill("SIGKILL"); reject(new Error(`claude timed out after ${timeoutMs / 1000} s`)); }, timeoutMs);
    ch.stdout.on("data", (d) => { out += d; });
    ch.stderr.on("data", (d) => { err += d; });
    ch.on("error", (e) => { clearTimeout(t); reject(e); });
    ch.on("close", (code) => {
      clearTimeout(t);
      try {
        const env1 = JSON.parse(out);
        if (env1.is_error) return reject(new Error(`claude error: ${String(env1.result).slice(0, 300)}`));
        resolve(extractJson(env1.result));
      } catch (e) { reject(new Error(`claude exit ${code}: ${e.message}; stderr: ${err.slice(-300)}`)); }
    });
    ch.stdin.end(prompt);
  });
}

const RULE_BRIEF = `You enforce one absolute broadcast rule: no footage, image or audio that SHOWS or PLAYS sexual content, violence, abuse (physical or otherwise), harm to animals, gore or the aftermath of injuries, or anything of the same kind. Categories: ${CATEGORIES.join(", ")}. Reporting such a story in neutral words is allowed; showing or playing it is not. When in doubt, answer "unsure" - unsure is treated as a refusal.`;

export const VISION_SYSTEM = `${RULE_BRIEF}
You will be given image file paths. Read every one with the Read tool. Reply with JSON only:
{"frames":[{"file":"<path>","verdict":"safe|unsafe|unsure","categories":[],"note":"<short>"}]}
One entry per file, in the order given. "safe" means none of the categories is visible at all.`;

export function claudeVisionCheck({ batch = 20, model = "sonnet", run = runClaude } = {}) {
  return async (frames) => {
    const out = [];
    for (let i = 0; i < frames.length; i += batch) {
      const chunk = frames.slice(i, i + batch);
      const dir = path.dirname(chunk[0].path);
      const reply = await run({ system: VISION_SYSTEM, prompt: chunk.map((f) => f.path).join("\n"), model, tools: "Read", addDir: dir });
      const byFile = new Map((reply.frames || []).map((r) => [path.resolve(String(r.file)), r]));
      for (const f of chunk) {
        const r = byFile.get(path.resolve(f.path));
        out.push(r ? { t: f.t, verdict: r.verdict, categories: r.categories || [], note: r.note || "" } : { t: f.t, verdict: null, note: "no verdict returned for this frame" });
      }
    }
    return out;
  };
}

export const TRANSCRIPT_SYSTEM = `${RULE_BRIEF}
You will be given the transcript of a clip's audio, with timestamps. Judge whether the AUDIO itself plays such content (for example sounds of a sexual act, screaming under attack, abuse being shouted at someone, an animal being hurt), not whether a story is reported in words. Reply with JSON only:
{"verdict":"safe|unsafe|unsure","categories":[],"at":<seconds or null>,"note":"<short>"}`;

export function claudeTranscriptCheck({ model = "sonnet", run = runClaude } = {}) {
  return async (tr) => {
    const body = (tr.segments?.length ? tr.segments.map((s) => `[${Number(s.start).toFixed(1)}-${Number(s.end).toFixed(1)}] ${s.text}`).join("\n") : tr.text) || "(no speech)";
    return run({ system: TRANSCRIPT_SYSTEM, prompt: body, model });
  };
}

/** openai-whisper CLI (`pip install openai-whisper`). UNVERIFIED: which transcriber the Mac has is not known. */
export function whisperTranscriber({ bin = "whisper", model = "base", workDir = null } = {}) {
  return (file) => {
    const dir = fs.mkdtempSync(path.join(workDir || os.tmpdir(), "safety-asr-"));
    const r = spawnSync(bin, [file, "--model", model, "--output_format", "json", "--output_dir", dir, "--fp16", "False"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new Error(`whisper not runnable: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`whisper failed: ${(r.stderr || "").slice(-300)}`);
    const jf = fs.readdirSync(dir).find((f) => f.endsWith(".json"));
    if (!jf) throw new Error("whisper wrote no JSON");
    const j = JSON.parse(fs.readFileSync(path.join(dir, jf), "utf8"));
    return { text: String(j.text || ""), segments: (j.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text })) };
  };
}

/** The default checker set for the Mac. soundEvents is deliberately absent (see the header). */
export function defaultCheckers({ workDir = null } = {}) {
  return {
    probe: ffprobeProbe,
    sampleFrames: ffmpegFrameSampler({ workDir }),
    vision: claudeVisionCheck(),
    transcribe: whisperTranscriber({ workDir }),
    checkTranscript: claudeTranscriptCheck(),
  };
}
