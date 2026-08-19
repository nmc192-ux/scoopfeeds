// Procedural score bed, v4 — stereo, arranged, and with AUDIBLE section changes.
//
// v3 changed only the LEVEL per chapter. The Vox verticals change the
// INSTRUMENTATION: sections sound different, and transitions are marked with
// risers into each chapter and a low boom as it lands. v4 gates components per
// chapter (kick/hats absent early, present through the data chapters, stripped
// for the turn) and adds those transition gestures, so a chapter change is
// heard, not just measured.
//
// v1 was a 46 BPM drone: inaudible and it dragged.
// v2 fixed tempo and level but had two defects measured against the Vox
// reference (ScreenRecording 2026-08-17):
//   • MONO. Our bed's side channel measured -91 dB — literally zero width.
//     Vox's swings between -33 and -47 dB. On headphones that difference alone
//     reads as "big production" vs "small production".
//   • FLAT. Vox's bed never stops, but its presence moves ~14 dB across the
//     film: restrained at the open, full through the data stretch, almost gone
//     under the interview, rebuilt for the close. Ours played one loop at one
//     intensity for nine minutes. Sidechain ducking is sentence-level; this is
//     the story-level arc that was missing.
//
// v3 adds both. Width comes from detuned L/R doubles plus an 11ms Haas offset
// on the right arp; bass and kick stay centred (low frequencies smeared across
// the stereo field just sound weak). The arc is a piecewise envelope keyed to
// the real chapter boundaries, computed from takes.json so it cannot drift out
// of sync with an edit.

import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { ffmpegPath, P, loadStoryboard, projectSlug } from "./_deps.mjs";
const { STORYBOARD, TITLE_SEGMENT } = await loadStoryboard();
const SLUG = projectSlug();

const FFMPEG = ffmpegPath;
const execFileP = promisify(execFile);


const ff = (args) => execFileP(FFMPEG, ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", ...args],
  { maxBuffer: 1 << 26 });

const SR = 48000;
const BPM = 112;
const BEAT = 60 / BPM;
const S16 = BEAT / 4;
const S8 = BEAT / 2;
const CHORD = BEAT * 8;
const HAAS = 0.011;          // right-side delay; classic width without phasing
const DETUNE = 1.0015;       // ~2.6 cents — beats slowly, never sounds out of tune

const f = (n) => n.toFixed(6);

const cycle4 = (step, a, b, c, d) => {
  const m = `mod(floor(t/${f(step)}),4)`;
  return `if(eq(${m},0),${a},if(eq(${m},1),${b},if(eq(${m},2),${c},${d})))`;
};

/**
 * Chapter start times, read from the ARTIFACTS build.mjs emitted — the SRT for
 * beat starts, the film header for the total.
 *
 * This function used to model the timeline from take durations plus fixed
 * gaps, under a comment claiming it measured "the same way build.mjs lays the
 * film out". That was false the moment readability holds existed: build
 * extended 42 cards by +52.3s, the model knew nothing about it, and every
 * chapter boom drifted earlier — cumulatively, up to ~50s by the outro. Same
 * bug class as shorts.mjs recomputing its cut points. The SRT is the timeline;
 * nothing downstream gets to model it.
 */
export function chapterTimes() {
  const toS = (x) => {
    const m = x.match(/(\d+):(\d+):(\d+),(\d+)/);
    return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
  };
  const cues = readFileSync(P(`out/${SLUG}.srt`), "utf8").trim().split(/\n\n+/)
    .map((b) => toS(b.split("\n")[1].split(" --> ")[0]));
  const CH = Object.entries(STORYBOARD)
    .filter(([, v]) => v.card === "chapter").map(([k]) => +k).sort((a, b) => a - b);
  const shots = JSON.parse(readFileSync(P("out/shots.json"), "utf8"));
  const outroLen = shots[shots.length - 1].seconds;
  const total = shots.reduce((a, x) => a + x.seconds, 0);
  return {
    open: 0,
    chapters: CH.map((id) => cues[id - 1]),
    outro: total - outroLen,
    total,
  };
}

/** Piecewise-linear envelope as an ffmpeg expression over `t`. */
function envelope(points) {
  let expr = String(points[points.length - 1][1]);
  for (let i = points.length - 2; i >= 0; i--) {
    const [t0, v0] = points[i], [t1, v1] = points[i + 1];
    const lerp = `(${v0}+(${v1 - v0})*(t-${f(t0)})/${f(Math.max(0.01, t1 - t0))})`;
    expr = `if(lt(t,${f(t1)}),${lerp},${expr})`;
  }
  return expr;
}

/**
 * The arrangement. Values are gain multipliers, not dB.
 *
 * The turn (Ch5) drops to 0.40 on purpose — that chapter is the film's
 * argument landing, and pulling the music back is what makes it land. It is
 * the same move Vox makes under their interview.
 */
export function intensityPoints(m) {
  const c = m.chapters;   // [ch1..ch6] start times
  const R = 4;            // ramp seconds either side of a change
  return [
    [0, 0.55],                       // cold open: restrained, let $70 land
    [12, 0.72],
    [c[0] - R, 0.72], [c[0], 0.88],  // Ch1 the reveal
    [c[1] - R, 0.88], [c[1], 0.78],  // Ch2 mechanism — don't fight the explanation
    [c[2] - R, 0.78], [c[2], 1.00],  // Ch3 the money — fullest
    [c[3] - R, 1.00], [c[3], 1.00],  // Ch4 still building
    [c[4] - R, 1.00], [c[4], 0.40],  // Ch5 THE TURN — strip it
    [c[4] + 24, 0.40],
    [c[5] - R, 0.55], [c[5], 0.92],  // Ch6 rebuild
    [m.outro - R, 0.92], [m.outro, 0.80],
    [m.total, 0.80],
  ];
}

export async function buildBed(seconds, out, { arc = null, chapters = null } = {}) {
  // Component gates. 0.4s ramps: instant enough to read as an arrangement
  // change, soft enough not to click.
  const gate = (pts) => envelope(pts);
  const c = chapters;
  const R2 = 0.4;
  const kickGate = c ? gate([[0,0],[c[0]-R2,0],[c[0],1],[c[3+1]-R2,1],[c[4],0],[c[4]+24,0],[c[4]+24+2,0.0],[c[5]-R2,0],[c[5],1],[seconds,1]]) : "1";
  const hatGate  = c ? gate([[0,0],[c[2]-R2,0],[c[2],1],[c[4]-R2,1],[c[4],0],[c[5]-R2,0],[c[5],1],[seconds,1]]) : "1";
  const arp2Gate = c ? gate([[0,0],[c[1]-R2,0],[c[1],1],[seconds,1]]) : "1";
  const d = seconds.toFixed(2);

  // Voices. L and R are detuned against each other; the right arp is also
  // delayed by HAAS, which is what actually opens the image.
  const arpL = `0.30*sin(2*PI*(${cycle4(S16, "220", "261.63", "329.63", "440")})*t)*exp(-13*mod(t,${f(S16)}))`;
  const arpR = `0.30*sin(2*PI*(${cycle4(S16, `220*${DETUNE}`, `261.63*${DETUNE}`, `329.63*${DETUNE}`, `440*${DETUNE}`)})*(t-${f(HAAS)}))*exp(-13*mod(t-${f(HAAS)},${f(S16)}))`;

  const a2 = (mul, off) =>
    `0.10*sin(2*PI*(${cycle4(S16, `440*${mul}`, `523.25*${mul}`, `659.26*${mul}`, `880*${mul}`)})*(t+${f(off)}))*exp(-18*mod(t+${f(off)},${f(S16)}))`;
  const arp2L = `(${arp2Gate})*` + a2(1, S8);
  const arp2R = `(${arp2Gate})*` + a2(1 / DETUNE, S8 + HAAS);

  // Centre: bass and kick. Low end stays mono — spreading it just thins it.
  const bass = `0.62*sin(2*PI*(${cycle4(CHORD, "55", "43.65", "65.41", "49")})*t)*(0.30+0.70*exp(-3.2*mod(t,${f(BEAT)})))`;
  const kick = `(${kickGate})*0.55*sin(2*PI*50*t)*exp(-17*mod(t,${f(BEAT)}))`;

  const padL = `0.05*(sin(2*PI*220*t)+sin(2*PI*329.63*t))*(0.55+0.45*sin(2*PI*t/17))`;
  const padR = `0.05*(sin(2*PI*${220 * DETUNE}*t)+sin(2*PI*${329.63 * DETUNE}*t))*(0.55+0.45*sin(2*PI*t/19))`;

  const hatEnv = `(${hatGate})*0.34*exp(-55*mod(t+${f(S8)},${f(S8)}))`;
  const arcExpr = arc ? envelope(arc) : "1";

  // Risers: filtered noise swelling for 2.6s INTO each chapter, cut at the bar.
  const riserEnv = c ? c.map((T) =>
    `if(between(t,${f(T - 2.6)},${f(T)}),pow((t-${f(T - 2.6)})/2.6,2),0)`).join("+") : "0";
  // Booms: a 46 Hz thump AT each chapter start, 1.2s decay.
  const boomExpr = c ? c.map((T) =>
    `if(gte(t,${f(T)}),0.85*sin(2*PI*46*(t-${f(T)}))*exp(-4.5*(t-${f(T)})),0)`).join("+") : "0";

  await ff([
    "-f", "lavfi", "-i", `aevalsrc='${arpL}':s=${SR}:d=${d}`,
    "-f", "lavfi", "-i", `aevalsrc='${arpR}':s=${SR}:d=${d}`,
    "-f", "lavfi", "-i", `aevalsrc='${arp2L}':s=${SR}:d=${d}`,
    "-f", "lavfi", "-i", `aevalsrc='${arp2R}':s=${SR}:d=${d}`,
    "-f", "lavfi", "-i", `aevalsrc='${bass}':s=${SR}:d=${d}`,
    "-f", "lavfi", "-i", `aevalsrc='${kick}':s=${SR}:d=${d}`,
    "-f", "lavfi", "-i", `aevalsrc='${padL}':s=${SR}:d=${d}`,
    "-f", "lavfi", "-i", `aevalsrc='${padR}':s=${SR}:d=${d}`,
    // Two independent noise seeds — decorrelated hats are free stereo width.
    "-f", "lavfi", "-i", `anoisesrc=c=white:r=${SR}:d=${d}:a=0.5:seed=11`,
    "-f", "lavfi", "-i", `anoisesrc=c=white:r=${SR}:d=${d}:a=0.5:seed=97`,
    "-f", "lavfi", "-i", `anoisesrc=c=pink:r=${SR}:d=${d}:a=0.6:seed=41`,
    "-f", "lavfi", "-i", `aevalsrc='${boomExpr}':s=${SR}:d=${d}`,
    "-filter_complex",
      `[8:a]highpass=f=7000,volume=volume='${hatEnv}':eval=frame[hatL];` +
      `[9:a]highpass=f=7000,volume=volume='${hatEnv}':eval=frame[hatR];` +
      `[10:a]highpass=f=500,lowpass=f=4000,volume=volume='0.5*(${riserEnv})':eval=frame[riser];` +
      `[4:a][5:a][11:a][riser]amix=inputs=4:duration=first:normalize=0[centre];` +
      `[centre]asplit=2[cL][cR];` +
      `[0:a][2:a][6:a][hatL][cL]amix=inputs=5:duration=first:normalize=0[L];` +
      `[1:a][3:a][7:a][hatR][cR]amix=inputs=5:duration=first:normalize=0[R];` +
      `[L][R]amerge=inputs=2,` +
      `volume=0.5,lowpass=f=7600,highpass=f=34,` +
      `compand=attacks=0.005:decays=0.30:points=-70/-70|-40/-26|-18/-13|0/-7,` +
      // The arrangement. Applied before the fades so the tails still work.
      `volume=volume='${arcExpr}':eval=frame,` +
      `afade=t=in:st=0:d=3,afade=t=out:st=${(seconds - 6).toFixed(2)}:d=6,` +
      `volume=1.30,alimiter=limit=0.95,` +
      `aformat=sample_fmts=fltp:channel_layouts=stereo[out]`,
    "-map", "[out]", "-t", d,
    "-c:a", "pcm_s16le", out,
  ]);
  return out;
}

/**
 * Mix the bed under a finished film, ducked by the narration.
 * Gentle ratio (2.5): this bed is meant to be heard. It steps back under
 * speech, it does not disappear.
 */
export async function scoreFilm(filmIn, bed, filmOut) {
  await ff([
    "-i", filmIn, "-i", bed,
    "-filter_complex",
      `[0:a]asplit=2[voice][key];` +
      `[1:a][key]sidechaincompress=threshold=0.12:ratio=2.5:attack=20:release=380:makeup=1[ducked];` +
      // Limiter LAST. With it before loudnorm, loudnorm's make-up gain pushed
      // the wider v3 bed to +0.25 dBFS — single-pass loudnorm only approximates
      // its TP ceiling, so it cannot be the final stage.
      `[voice][ducked]amix=inputs=2:duration=first:normalize=0,` +
      // 0.85 ≈ -1.4 dBFS. AAC overshoots on decode, so a 0.94 ceiling still
      // measured +0.86 dBFS in the encoded file; lossy delivery needs the room.
      `loudnorm=I=-14:TP=-2.0:LRA=11,alimiter=limit=0.85[a]`,
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", filmOut,
  ]);
  return filmOut;
}

async function main() {
  const m = chapterTimes();
  const seconds = Number(process.argv[2] || m.total);
  const arc = intensityPoints(m);
  console.log("chapters at:", m.chapters.map((x) => x.toFixed(0) + "s").join(", "));
  console.log("arc points :", arc.length, "| turn drops to 0.40 at", m.chapters[4].toFixed(0) + "s");
  const bed = await buildBed(seconds, P("out/bed.wav"), { arc, chapters: m.chapters });
  console.log("bed:", bed);
  const scored = await scoreFilm(P(`out/${SLUG}.mp4`), bed, P(`out/${SLUG}-scored.mp4`));
  console.log("scored:", scored);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
