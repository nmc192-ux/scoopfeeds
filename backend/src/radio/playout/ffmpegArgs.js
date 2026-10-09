/**
 * ffmpegArgs.js - the ffmpeg command line for the playout.
 *
 * Video arrives on stdin as a pipe of JPEG frames (the capture paces them at 30 fps);
 * audio is the daypart's music bed, looped, gained to -16 LUFS integrated.
 * Output follows YouTube's live-encoder guidance for 1080p30: H.264 High, yuv420p,
 * ~4.5 Mbps CBR (nal-hrd=cbr), keyframe every 2 s (GOP 60, no scene-cut keyframes),
 * AAC-LC 128 kbps 44.1 kHz stereo.
 */
export const VIDEO = Object.freeze({ width: 1920, height: 1080, fps: 30, bitrateK: 4500, gop: 60 });
export const AUDIO = Object.freeze({ bitrateK: 128, rate: 44100, targetLufs: -16, truePeakDb: -1.5 });

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
 * @param {{ target: {kind:"file",path:string}|{kind:"rtmp",url:string}, bed: string, bedLufs: number,
 *           seconds?: number|null }} o
 */
export function buildFfmpegArgs({ target, bed, bedLufs, seconds = null }) {
  const a = ["-hide_banner", "-loglevel", "warning", "-y"];
  // input 0: JPEG frames on stdin, stamped by arrival time (the capture writes them at 30 Hz)
  a.push("-use_wallclock_as_timestamps", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-i", "pipe:0");
  // input 1: the bed, looped forever, read at 1x so audio and wallclock-stamped video stay in step
  a.push("-re", "-stream_loop", "-1", "-i", bed);
  a.push("-map", "0:v:0", "-map", "1:a:0");
  a.push("-vf", `fps=${VIDEO.fps},scale=${VIDEO.width}:${VIDEO.height}:flags=bicubic,format=yuv420p`);
  a.push("-af", loudnessFilter(bedLufs));
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
  else a.push("-f", "flv", target.url);
  return a;
}
