/**
 * longformMeasure.js — the ffmpeg side of the QC gate (#79/#80).
 *
 * `longformQcGate.qcVerdict()` decides; this file MEASURES. They are separate
 * because the decision must be testable without a video file, and the
 * measurement must be verifiable against a real one.
 *
 * THE CONTRACT IS `{ measured, value }`, AND `measured:false` FAILS.
 *
 * Every function here returns that shape, and every failure path returns
 * `measured: false` with a reason rather than a plausible-looking default.
 * That is the whole point: qcVerdict has no way to express "we didn't check"
 * that reads as a pass, so a measurement that cannot be taken becomes a
 * refusal instead of silence. An ffmpeg invocation that returns nothing
 * parseable is exactly the case where a default would ship an unchecked film.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync } from "fs";

const execFileP = promisify(execFile);

/** Run ffmpeg and return combined output; never throws. */
async function ff(ffmpegPath, args) {
  try {
    const { stdout, stderr } = await execFileP(
      ffmpegPath, ["-hide_banner", ...args], { maxBuffer: 1 << 26 });
    return `${stdout || ""}${stderr || ""}`;
  } catch (e) {
    // ffmpeg exits non-zero for several benign analysis cases, and its output
    // is on stderr either way — so the output is used, not the exit code.
    return `${e.stdout || ""}${e.stderr || ""}`;
  }
}

const unmeasured = (why) => ({ measured: false, why });

/** Integrated loudness (LUFS) via loudnorm's analysis pass. */
export async function measureLoudness(ffmpegPath, film) {
  const out = await ff(ffmpegPath, ["-i", film, "-af", "loudnorm=print_format=json", "-f", "null", "-"]);
  const m = out.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (!m) return unmeasured("loudnorm printed no JSON block");
  try {
    const v = parseFloat(JSON.parse(m[0]).input_i);
    return Number.isFinite(v) ? { measured: true, value: v } : unmeasured("input_i was not a number");
  } catch (e) { return unmeasured(`loudnorm JSON did not parse: ${e.message}`); }
}

/**
 * Worst flat factor — the clipping gate.
 *
 * NOT true peak. A decoded AAC legitimately overshoots the encoder's input
 * peak, so a correctly mastered file reads positive dBTP and would fail a gate
 * it should never be subject to. astats' flat factor judges actual clipping.
 */
export async function measureFlatFactor(ffmpegPath, film) {
  const out = await ff(ffmpegPath, ["-i", film, "-af", "astats=metadata=1:reset=0", "-f", "null", "-"]);
  const vals = [...out.matchAll(/Flat factor:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  if (!vals.length) return unmeasured("astats printed no flat factor");
  return { measured: true, value: Math.max(...vals) };
}

/** Side-channel level (dB). A mono bed reads about -91. */
export async function measureSideChannel(ffmpegPath, film) {
  const out = await ff(ffmpegPath, [
    "-i", film, "-af", "aformat=channel_layouts=stereo,stereotools=mode=lr>ms,pan=mono|c0=c1,astats=metadata=1:reset=0",
    "-f", "null", "-"]);
  const m = out.match(/RMS level dB:\s*(-?[\d.]+|-inf)/);
  if (!m) return unmeasured("astats printed no RMS level for the side channel");
  if (m[1] === "-inf") return { measured: true, value: -120 };  // silent side = mono
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? { measured: true, value: v } : unmeasured("side-channel RMS was not a number");
}

/** Duration in seconds, from the container. */
export async function measureDuration(ffmpegPath, film) {
  const out = await ff(ffmpegPath, ["-i", film]);
  const m = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!m) return unmeasured("ffmpeg printed no Duration");
  return { measured: true, value: (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) };
}

/** Width and height, from the video stream. */
export async function measureDimensions(ffmpegPath, file) {
  const out = await ff(ffmpegPath, ["-i", file]);
  const m = out.match(/Video:.*?(\d{3,5})x(\d{3,5})/);
  if (!m) return unmeasured("ffmpeg printed no video dimensions");
  return { measured: true, value: { width: +m[1], height: +m[2] } };
}

/**
 * Shot rhythm, from the shot plan build.mjs emits.
 *
 * READ FROM THE PLAN, NOT RE-DERIVED. build.mjs extends shots for readability,
 * so shot lengths are not recoverable from narration durations — the same
 * reason the SRT is the timeline of record everywhere else.
 */
export function measureRhythm(shotsJsonPath) {
  if (!existsSync(shotsJsonPath)) return { median: unmeasured("no out/shots.json — rebuild"), under2s: unmeasured("no out/shots.json — rebuild") };
  let shots;
  try { shots = JSON.parse(readFileSync(shotsJsonPath, "utf8")); }
  catch (e) { const u = unmeasured(`shots.json did not parse: ${e.message}`); return { median: u, under2s: u }; }
  const lens = shots.map((s) => s.seconds).filter(Number.isFinite).sort((a, b) => a - b);
  if (!lens.length) { const u = unmeasured("shots.json contained no durations"); return { median: u, under2s: u }; }
  const mid = Math.floor(lens.length / 2);
  const median = lens.length % 2 ? lens[mid] : (lens[mid - 1] + lens[mid]) / 2;
  return {
    median: { measured: true, value: median },
    under2s: { measured: true, value: lens.filter((l) => l < 2).length / lens.length },
  };
}

/** Cue count and last cue time, from the SRT. */
export function measureSrt(srtPath) {
  if (!existsSync(srtPath)) return unmeasured("no SRT — the timeline of record is missing");
  const text = readFileSync(srtPath, "utf8");
  const cues = [...text.matchAll(/(\d{2}):(\d{2}):(\d{2}),(\d{3}) -->/g)]
    .map((m) => +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000);
  if (!cues.length) return unmeasured("SRT contained no well-formed cues");
  // A malformed timestamp would not match above, so a file with four-digit
  // milliseconds reads as having fewer cues than it does — check explicitly.
  const malformed = (text.match(/\d{2}:\d{2}:\d{2},\d{4,}/g) || []).length;
  if (malformed) return unmeasured(`SRT has ${malformed} malformed timestamp(s) — 4-digit milliseconds`);
  return { measured: true, value: { cues: cues.length, lastCueSecs: Math.max(...cues) } };
}

/**
 * Measure everything qcVerdict needs. Never throws; a step that cannot be
 * measured contributes a failing measurement rather than aborting the rest,
 * so one broken probe does not hide the state of every other gate.
 */
export async function measureFilm({ ffmpegPath, film, srtPath, shotsJsonPath, shortFiles = [] } = {}) {
  if (!existsSync(film)) {
    const u = unmeasured(`film not found at ${film}`);
    return { loudness: u, flatFactor: u, sideChannel: u, filmSeconds: u,
             medianShot: u, shortsUnder2s: u, srt: u, shorts: [] };
  }
  const [loudness, flatFactor, sideChannel, filmSeconds] = await Promise.all([
    measureLoudness(ffmpegPath, film),
    measureFlatFactor(ffmpegPath, film),
    measureSideChannel(ffmpegPath, film),
    measureDuration(ffmpegPath, film),
  ]);
  const rhythm = measureRhythm(shotsJsonPath);
  const shorts = [];
  for (const f of shortFiles) {
    const name = f.split("/").pop();
    if (!existsSync(f)) { shorts.push({ measured: false, name, why: "file not found" }); continue; }
    const [d, dim] = await Promise.all([measureDuration(ffmpegPath, f), measureDimensions(ffmpegPath, f)]);
    if (!d.measured || !dim.measured) {
      shorts.push({ measured: false, name, why: d.why || dim.why });
      continue;
    }
    shorts.push({ measured: true, name, seconds: d.value, width: dim.value.width, height: dim.value.height });
  }
  return {
    loudness, flatFactor, sideChannel, filmSeconds,
    medianShot: rhythm.median, shortsUnder2s: rhythm.under2s,
    srt: measureSrt(srtPath), shorts,
  };
}
