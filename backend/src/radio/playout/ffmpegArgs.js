/**
 * ffmpegArgs.js - the ffmpeg command line for the playout.
 *
 * Video arrives on stdin as a pipe of JPEG frames (the capture paces them at 30 fps);
 * audio is the daypart's music bed, looped, gained to -16 LUFS integrated.
 * Output follows YouTube's live-encoder guidance for 1080p30: H.264 High, yuv420p,
 * ~4.5 Mbps CBR (nal-hrd=cbr), keyframe every 2 s (GOP 60, no scene-cut keyframes),
 * AAC-LC 128 kbps 44.1 kHz stereo.
 */
import path from "node:path";

export const VIDEO = Object.freeze({ width: 1920, height: 1080, fps: 30, bitrateK: 4500, gop: 60 });
export const AUDIO = Object.freeze({ bitrateK: 128, rate: 44100, targetLufs: -16, truePeakDb: -3.0 });

/** Linear-gain filter that lands a bed measured at `measuredLufs` on the target, with a peak limiter. */
export function loudnessFilter(measuredLufs, { targetLufs = AUDIO.targetLufs, truePeakDb = AUDIO.truePeakDb } = {}) {
  const limit = Math.pow(10, truePeakDb / 20).toFixed(4);
  if (!Number.isFinite(measuredLufs)) {
    // Unmeasured bed: fall back to single-pass loudnorm rather than guessing a gain.
    return `loudnorm=I=${targetLufs}:TP=${truePeakDb}:LRA=11`;
  }
  const gain = (targetLufs - measuredLufs).toFixed(2);
  return `volume=${gain}dB,alimiter=limit=${limit}:level=disabled`;
}

/**
 * Live targets take the bed as raw PCM on fd 3 (`audioPipe`), produced by a separate "feeder" ffmpeg (buildFeederArgs),
 * so the bed can be swapped at a daypart change without restarting this encoder or dropping the RTMP connection.
 * @param {{ target: {kind:"file",path:string}|{kind:"segments",dir:string,segmentSec:number,keep:number}|{kind:"rtmp",url:string}, bed: string, bedLufs: number,
 *           seconds?: number|null }} o
 */
export function buildFfmpegArgs({ target, bed, bedLufs, seconds = null, audioPipe = false }) {
  const a = ["-hide_banner", "-loglevel", "warning", "-y"];
  // input 0: JPEG frames on stdin, stamped by arrival time (the capture writes them at 30 Hz)
  a.push("-use_wallclock_as_timestamps", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-i", "pipe:0");
  if (audioPipe) {
    // input 1: already gained/limited raw PCM from the feeder, arriving in real time
    a.push("-thread_queue_size", "512", "-f", "s16le", "-ar", String(AUDIO.rate), "-ac", "2", "-i", "pipe:3");
  } else {
    // input 1: the bed, looped forever, read at 1x so audio and wallclock-stamped video stay in step
    a.push("-re", "-stream_loop", "-1", "-i", bed);
  }
  a.push("-map", "0:v:0", "-map", "1:a:0");
  a.push("-vf", `fps=${VIDEO.fps},scale=${VIDEO.width}:${VIDEO.height}:flags=bicubic,format=yuv420p`);
  if (!audioPipe) a.push("-af", loudnessFilter(bedLufs));
  a.push(
    "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-r", String(VIDEO.fps),
    "-b:v", `${VIDEO.bitrateK}k`, "-minrate", `${VIDEO.bitrateK}k`, "-maxrate", `${VIDEO.bitrateK}k`,
    "-bufsize", `${VIDEO.bitrateK * 2}k`,
    "-x264-params", `nal-hrd=cbr:force-cfr=1:keyint=${VIDEO.gop}:min-keyint=${VIDEO.gop}:scenecut=0`,
    "-g", String(VIDEO.gop), "-keyint_min", String(VIDEO.gop), "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", `${AUDIO.bitrateK}k`, "-ar", String(AUDIO.rate), "-ac", "2",
  );
  if (seconds) a.push("-t", String(seconds));
  if (target.kind === "file") a.push("-movflags", "+faststart", target.path);
  else if (target.kind === "segments") {
    a.push("-f", "segment", "-segment_format", "mpegts", "-segment_time", String(target.segmentSec),
      "-segment_wrap", String(target.keep), "-reset_timestamps", "1", path.join(target.dir, "seg-%02d.ts"));
  } else a.push("-f", "flv", target.url);
  return a;
}

/** The feeder: the bed looped at real time, gained to -16 LUFS + limited, as raw s16le stereo PCM on stdout. */
export function buildFeederArgs({ bed, bedLufs }) {
  return ["-hide_banner", "-loglevel", "error", "-re", "-stream_loop", "-1", "-i", bed, "-vn",
    "-af", loudnessFilter(bedLufs), "-f", "s16le", "-ar", String(AUDIO.rate), "-ac", "2", "pipe:1"];
}

export const LIVE_PICTURE = Object.freeze({ fps: 15, width: 1280, height: 720, q: 4 });

/**
 * The live feeder (#202): ONE ffmpeg reads an official feed at real time and writes
 *   stdout (fd 1): its sound as -16 LUFS raw s16le stereo PCM, the same format as the bed feeder, so it
 *                  can take over the encoder's audio pipe with no restart;
 *   fd 3:          its picture as JPEG frames for the screen (live/pictureHub.js).
 * One reader for both keeps sound and picture from the same segment. Nothing is written to disk.
 */
export function buildLiveFeederArgs({ mediaUrl, httpHeaders = {} }) {
  const a = ["-hide_banner", "-loglevel", "error", "-rw_timeout", "15000000"];
  const h = Object.entries(httpHeaders || {}).filter(([k]) => /^(user-agent|referer|origin)$/i.test(k));
  if (h.length) a.push("-headers", h.map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n");
  a.push("-re", "-i", mediaUrl,
    "-map", "0:a:0", "-vn", "-af", `aresample=async=1,loudnorm=I=${AUDIO.targetLufs}:TP=${AUDIO.truePeakDb}:LRA=11`,
    "-f", "s16le", "-ar", String(AUDIO.rate), "-ac", "2", "pipe:1",
    "-map", "0:v:0", "-an",
    "-vf", `fps=${LIVE_PICTURE.fps},scale=${LIVE_PICTURE.width}:${LIVE_PICTURE.height}:force_original_aspect_ratio=decrease`,
    "-c:v", "mjpeg", "-q:v", String(LIVE_PICTURE.q), "-f", "image2pipe", "pipe:3");
  return a;
}
