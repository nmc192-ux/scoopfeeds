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
/**
 * RTMP dead-link detection. rwTimeoutMs: a socket write that makes no progress this long fails the mux. Measured end to end
 * through a blackholed loopback link: detection 5.2 s at 5 s, 7.2-7.3 s at 7 s. 7 rather than 5 so a ~5.6 s upload stall (seen
 * in the Phase C test, connection survived) does not force a reconnect. Once the write fails, ffmpeg spends ~10 s more retrying
 * the trailer and file close against the dead socket, so playout.js reacts to the error line itself (isFatalMuxError).
 */
export const RTMP = Object.freeze({ rwTimeoutMs: 7000 });
/**
 * RADIO_PLAYOUT_QUALITY=720p: a fallback for a weak uplink, 1280x720 at 2.5 Mbps (YouTube's 720p30 range is 1.5-4 Mbps).
 * Anything else is the default 1080p30 at 4.5 Mbps. The page is still captured at 1920x1080 and scaled down.
 */
export function outputQuality(env = process.env) {
  return String(env.RADIO_PLAYOUT_QUALITY || "").trim().toLowerCase() === "720p"
    ? { width: 1280, height: 720, bitrateK: 2500 }
    : { width: VIDEO.width, height: VIDEO.height, bitrateK: VIDEO.bitrateK };
}
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
  const q = outputQuality();
  a.push("-vf", `fps=${VIDEO.fps},scale=${q.width}:${q.height}:flags=bicubic,format=yuv420p`);
  if (!audioPipe) a.push("-af", loudnessFilter(bedLufs));
  a.push(
    "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-r", String(VIDEO.fps),
    "-b:v", `${q.bitrateK}k`, "-minrate", `${q.bitrateK}k`, "-maxrate", `${q.bitrateK}k`,
    "-bufsize", `${q.bitrateK * 2}k`,
    "-x264-params", `nal-hrd=cbr:force-cfr=1:keyint=${VIDEO.gop}:min-keyint=${VIDEO.gop}:scenecut=0`,
    "-g", String(VIDEO.gop), "-keyint_min", String(VIDEO.gop), "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", `${AUDIO.bitrateK}k`, "-ar", String(AUDIO.rate), "-ac", "2",
  );
  if (seconds) a.push("-t", String(seconds));
  if (target.kind === "file") a.push("-movflags", "+faststart", target.path);
  else if (target.kind === "segments") {
    a.push("-f", "segment", "-segment_format", "mpegts", "-segment_time", String(target.segmentSec),
      "-segment_wrap", String(target.keep), "-reset_timestamps", "1", path.join(target.dir, "seg-%02d.ts"));
  } else if (target.kind === "multi") {
    // #207: one encode, FLV on stdout; live/fanout.js relays it to each destination with its own process and reconnect
    a.push("-flvflags", "no_duration_filesize", "-f", "flv", "pipe:1");
  } else a.push("-rw_timeout", String(RTMP.rwTimeoutMs * 1000), "-f", "flv", target.url);
  return a;
}

/**
 * One destination's relay (#207): FLV in on stdin, copied (no re-encode) to that destination's RTMP URL, with the same
 * dead-link timeout as the single-output path. A relay that dies takes only its own destination down.
 */
export function buildRelayArgs({ url }) {
  return ["-hide_banner", "-loglevel", "warning", "-f", "flv", "-i", "pipe:0", "-map", "0", "-c", "copy",
    "-rw_timeout", String(RTMP.rwTimeoutMs * 1000), "-f", "flv", url];
}

/** The feeder: the bed looped at real time, gained to -16 LUFS + limited, as raw s16le stereo PCM on stdout. */
export function buildFeederArgs({ bed, bedLufs, ssSec = null }) {
  // ssSec: a programme part (produced audio), read ONCE from that position instead of looped
  const input = ssSec == null ? ["-stream_loop", "-1", "-i", bed] : ["-ss", Math.max(0, ssSec).toFixed(3), "-i", bed];
  return ["-hide_banner", "-loglevel", "error", "-re", ...input, "-vn",
    "-af", loudnessFilter(bedLufs), "-f", "s16le", "-ar", String(AUDIO.rate), "-ac", "2", "pipe:1"];
}

/**
 * A film or episode played by the ENCODER, not the browser: decoded in real time from `ssSec` and re-encoded as JPEG frames
 * on stdout, which the playout's pacing writer sends instead of the screen capture. Letter/pillarboxed onto 1920x1080 ink.
 * (Playing the video inside the captured page stuttered on air on 13 Oct: the page could not decode HD fast enough.)
 */
export function buildMediaFrameArgs({ file, ssSec = 0 }) {
  return ["-hide_banner", "-loglevel", "error", "-re", "-ss", Math.max(0, ssSec).toFixed(3), "-i", file, "-an",
    "-vf", `fps=${VIDEO.fps},scale=${VIDEO.width}:${VIDEO.height}:force_original_aspect_ratio=decrease,pad=${VIDEO.width}:${VIDEO.height}:(ow-iw)/2:(oh-ih)/2:color=0x111111,format=yuvj420p`,
    "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "3", "pipe:1"];
}

/** Split a growing buffer of concatenated JPEGs into whole frames. Returns { frames, rest }. */
export function splitJpegs(buf) {
  const frames = [];
  let i = 0;
  for (;;) {
    const soi = buf.indexOf(Buffer.from([0xff, 0xd8]), i);
    if (soi < 0) return { frames, rest: Buffer.alloc(0) };
    const eoi = buf.indexOf(Buffer.from([0xff, 0xd9]), soi + 2);
    if (eoi < 0) return { frames, rest: buf.subarray(soi) };
    frames.push(buf.subarray(soi, eoi + 2));
    i = eoi + 2;
  }
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
