/**
 * filmPlayout.js — how a planned film or Short reaches air (#203). Films play through the ENCODER,
 * never the browser: on air on 13 Oct an A-Eye episode played inside the captured page stuttered
 * because the page could not decode HD in real time. The fix (PR #168, efa9a23) decodes the cue's
 * file in its own real-time ffmpeg, sends its frames instead of the screen capture, and plays its
 * sound through the audio feeder seeked to the same offset. This module gives that playout:
 *
 *   planToCues / cueAt     what is on air at an instant, and how far into its file
 *   buildFilmFrameArgs     the video side (same arguments as #168's buildMediaFrameArgs)
 *   buildFilmAudioArgs     the audio side, as PCM for the feeder, gained to the playout's -16 LUFS
 *   buildRehearsalArgs     one film + Shorts back to back through the playout's encode settings
 *                          into a file, each item's sound padded/trimmed to its own picture so a
 *                          clip whose audio runs long or is missing cannot push later items out of sync
 *
 * Nothing here is imported by the live playout yet: PR #168 (issue #193) owns the programme-mode
 * playout, and it is not merged. Kept in its own file so it does not conflict with that PR.
 */
import { VIDEO, AUDIO, loudnessFilter } from "./playout/ffmpegArgs.js";

const FRAME = `fps=${VIDEO.fps},scale=${VIDEO.width}:${VIDEO.height}:force_original_aspect_ratio=decrease,` +
  `pad=${VIDEO.width}:${VIDEO.height}:(ow-iw)/2:(oh-ih)/2:color=0x111111`;

/** Films and Shorts from a planDay() plan as air cues (promos are overlays, returned apart). */
export function planToCues(plan) {
  const cues = plan.filter((p) => p.type === "film" || p.type === "short").map((p) => ({
    id: p.id, kind: p.type, file: p.file, durationSec: p.durationSec, startMs: p.at, endMs: p.at + p.durationSec * 1000,
  })).sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].startMs < cues[i - 1].endMs) throw new Error(`cue ${cues[i].id} starts before ${cues[i - 1].id} ends`);
  }
  const overlays = plan.filter((p) => p.type === "promo").map((p) => ({ at: p.at, filmId: p.filmId, text: p.text }));
  return { cues, overlays };
}

/** The cue on air at `nowMs` and the offset into its file, or null between cues (the screen is on air). */
export function cueAt(cues, nowMs) {
  for (const c of cues) if (nowMs >= c.startMs && nowMs < c.endMs) return { cue: c, ssSec: (nowMs - c.startMs) / 1000 };
  return null;
}

/** Video side: decoded in real time from ssSec, letter/pillarboxed onto 1920x1080, MJPEG frames on stdout. */
export function buildFilmFrameArgs({ file, ssSec = 0 }) {
  return ["-hide_banner", "-loglevel", "error", "-re", "-ss", Math.max(0, ssSec).toFixed(3), "-i", file, "-an",
    "-vf", `${FRAME},format=yuvj420p`, "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "3", "pipe:1"];
}

/**
 * Audio side: the film's own sound from ssSec, at real time, raw s16le stereo on stdout. Gained the way the
 * feeder gains a bed: a fixed gain from the film's measured loudness (`lufs`, playout/loudness.js), falling back
 * to single-pass loudnorm only when unmeasured, so a film does not pump and starts with no loudnorm look-ahead.
 */
export function buildFilmAudioArgs({ file, ssSec = 0, lufs = null }) {
  return ["-hide_banner", "-loglevel", "error", "-re", "-ss", Math.max(0, ssSec).toFixed(3), "-i", file, "-vn",
    "-af", loudnessFilter(lufs),
    "-f", "s16le", "-ar", String(AUDIO.rate), "-ac", "2", "pipe:1"];
}

/**
 * One ffmpeg that plays `items` back to back and encodes them exactly as the playout does (H.264 High CBR,
 * 2 s GOP, AAC 44.1 kHz). Each item: { file, videoSec (its picture's length, measured), hasAudio }.
 * This checks the cut points and lip-sync of the items themselves; air pacing (1x, from the programme clock) is the
 * live playout's job (PR #168), not this file render's.
 */
export function buildRehearsalArgs({ items, out }) {
  if (!items.length) throw new Error("nothing to rehearse");
  const a = ["-hide_banner", "-loglevel", "warning", "-y"];
  const parts = [];
  let input = 0;
  items.forEach((it, i) => {
    if (!(it.videoSec > 0)) throw new Error(`item ${i} has no measured picture length`);
    const d = it.videoSec.toFixed(3);
    a.push("-i", it.file);
    const v = input++;
    parts.push(`[${v}:v:0]${FRAME},format=yuv420p,trim=duration=${d},setpts=PTS-STARTPTS,setsar=1[v${i}]`);
    if (it.hasAudio) {
      parts.push(`[${v}:a:0]aresample=${AUDIO.rate},aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${d},asetpts=PTS-STARTPTS[a${i}]`);
    } else {
      a.push("-f", "lavfi", "-t", d, "-i", `anullsrc=r=${AUDIO.rate}:cl=stereo`);
      parts.push(`[${input++}:a:0]asetpts=PTS-STARTPTS[a${i}]`);
    }
  });
  const pairs = items.map((_, i) => `[v${i}][a${i}]`).join("");
  parts.push(`${pairs}concat=n=${items.length}:v=1:a=1[vc][ac]`);
  parts.push(`[ac]loudnorm=I=${AUDIO.targetLufs}:TP=${AUDIO.truePeakDb}:LRA=11,aresample=${AUDIO.rate}[ao]`);
  a.push("-filter_complex", parts.join(";"), "-map", "[vc]", "-map", "[ao]");
  a.push(
    "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(VIDEO.fps),
    "-b:v", `${VIDEO.bitrateK}k`, "-minrate", `${VIDEO.bitrateK}k`, "-maxrate", `${VIDEO.bitrateK}k`, "-bufsize", `${VIDEO.bitrateK * 2}k`,
    "-x264-params", `nal-hrd=cbr:force-cfr=1:keyint=${VIDEO.gop}:min-keyint=${VIDEO.gop}:scenecut=0`,
    "-g", String(VIDEO.gop), "-keyint_min", String(VIDEO.gop), "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", `${AUDIO.bitrateK}k`, "-ar", String(AUDIO.rate), "-ac", "2",
    "-movflags", "+faststart", out,
  );
  return a;
}

/** Item boundaries in the rehearsal output, in seconds: where each item should start. */
export function rehearsalBoundaries(items) {
  const starts = [];
  let t = 0;
  for (const it of items) { starts.push(t); t += it.videoSec; }
  return { starts, totalSec: t };
}

/**
 * Pair marker times found in picture (flash onsets) with those found in sound (beep onsets) and return the
 * worst offset. Used by the rehearsal self-test; an unmatched marker is reported, not ignored.
 */
export function pairMarkers(videoTimes, audioTimes, { windowSec = 0.5 } = {}) {
  const pairs = [];
  const unmatched = [];
  const used = new Set();
  for (const vt of videoTimes) {
    let best = -1;
    for (let j = 0; j < audioTimes.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(audioTimes[j] - vt) <= windowSec && (best < 0 || Math.abs(audioTimes[j] - vt) < Math.abs(audioTimes[best] - vt))) best = j;
    }
    if (best < 0) unmatched.push({ video: vt });
    else { used.add(best); pairs.push({ video: vt, audio: audioTimes[best], offsetSec: audioTimes[best] - vt }); }
  }
  audioTimes.forEach((at, j) => { if (!used.has(j)) unmatched.push({ audio: at }); });
  const worstSec = pairs.reduce((m, p) => Math.max(m, Math.abs(p.offsetSec)), 0);
  return { pairs, unmatched, worstSec };
}
