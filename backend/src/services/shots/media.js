/**
 * media.js — probe and sample remote media for the shot resolver.
 *
 * Nothing here downloads a whole file. ffprobe reads the header over HTTP, and
 * each sampled frame is one ffmpeg seek (a few range requests), queued through
 * commons.politely so Wikimedia sees one request at a time, 1.5–4 s apart.
 *
 * VERIFIED BY CONTENT. ffprobe must report a real video stream with a real
 * duration; an HTML error page served under a .webm name fails here, which is
 * the brief's "error pages arrive as HTML saved under the media filename".
 */

import { execFile } from "child_process";
import { getFFmpegPath } from "../videoGenerator.js";
import { getFFprobePath } from "../videoVoice.js";
import { politely, UA } from "./commons.js";

// Brief: 1 frame per 3–12 s. At most MAX_FRAMES frames per clip; a clip longer
// than MAX_FRAMES * 12 s is sampled over its first MAX_FRAMES * 12 s only, and
// the result says so (coveredSecs) — never a silent cap.
export const MIN_SPACING_S = 3;
export const MAX_SPACING_S = 12;
export const MAX_FRAMES = 16;

function run(bin, args, { timeout = 60000, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 64 * 1024 * 1024, encoding: binary ? "buffer" : "utf8" }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${bin.split("/").pop()} failed: ${String(stderr || err.message).slice(0, 200)}`));
      resolve(stdout);
    });
  });
}

/** { ok, duration, width, height, codec } for a remote or local video. */
export async function probeVideo(url, { deps = {} } = {}) {
  const probe = deps.ffprobe || getFFprobePath();
  if (!probe) return { ok: false, reason: "no ffprobe" };
  try {
    const out = await politely(() => run(probe, ["-v", "error", "-user_agent", UA, "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,width,height:format=duration,format_name", "-of", "json", url], { timeout: 30000 }));
    const j = JSON.parse(out);
    const s = j.streams?.[0];
    const duration = Number(j.format?.duration);
    if (!s || !(duration > 0)) return { ok: false, reason: "no video stream / duration (HTML error page?)" };
    return { ok: true, duration, width: s.width, height: s.height, codec: s.codec_name, format: j.format?.format_name };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/** The sample times for a clip of `duration` seconds. */
export function sampleTimes(duration) {
  const spacing = Math.min(MAX_SPACING_S, Math.max(MIN_SPACING_S, duration / MAX_FRAMES));
  const times = [];
  for (let t = Math.min(1, duration / 2); t < duration - 0.5 && times.length < MAX_FRAMES; t += spacing) times.push(Number(t.toFixed(2)));
  return { times, spacing, coveredSecs: Math.min(duration, times.length * spacing) };
}

/** One JPEG frame at `t` seconds, 360 px tall. */
export async function frameAt(url, t, { height = 360, deps = {} } = {}) {
  const ff = deps.ffmpeg || getFFmpegPath();
  const buf = await politely(() => run(ff, ["-v", "error", "-user_agent", UA, "-ss", String(t), "-i", url,
    "-frames:v", "1", "-vf", `scale=-2:${height}`, "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-"], { binary: true, timeout: 60000 }));
  return buf?.length > 1000 ? buf : null;
}

/** Sample a clip into frames for the vision check. */
export async function sampleFrames(url, duration, { deps = {} } = {}) {
  const { times, spacing, coveredSecs } = sampleTimes(duration);
  const frames = [];
  for (const t of times) {
    try { const jpeg = await frameAt(url, t, { deps }); if (jpeg) frames.push({ t, jpeg }); }
    catch { /* a single failed seek costs one frame, not the clip */ }
  }
  return { frames, spacing, coveredSecs, duration };
}
