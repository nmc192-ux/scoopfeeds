// videoMusicBed.js — procedural score bed for the automated shorts.
//
// PORTED from .claude/skills/video-factory/engine/music.mjs (the long-form
// engine's v4 bed), which was tuned against a Vox reference recording. The
// SYNTHESIS is verbatim — voices, detune, Haas delay, the mix chain, the
// compand curve, the loudnorm→limiter order. Those parameters were measured
// in, not guessed, and they do not get re-tuned here:
//
//   • Stereo width comes from L/R detune (~2.6 cents) plus an 11ms Haas delay
//     on the right arp, with two independent noise seeds for the hats. The v2
//     bed's side channel measured -91 dB (mono in effect); the Vox reference
//     swings -33..-47 dB.
//   • Low end stays mono — spreading bass just thins it.
//   • The limiter is LAST. Single-pass loudnorm only approximates its
//     true-peak ceiling; with the limiter before it, make-up gain pushed a
//     wide bed to +0.25 dBFS.
//   • The final ceiling is 0.85 (≈ -1.4 dBFS) because AAC overshoots on
//     decode: a 0.94 ceiling still measured +0.86 dBFS in the encoded file.
//
// What is NOT ported verbatim is the ARRANGEMENT. The long-form gates assume
// six named chapters over ~7 minutes; a 60–100s short has a different shape:
// cold open → evidence build → the turn → kicker. deriveShortArc() maps the
// spec's card types onto that shape. Two deliberate choices:
//
//   • THE TURN STRIPS THE MUSIC TO 0.40. Same move as the long-form (and as
//     Vox under an interview): the argument landing is what the pull-back
//     makes audible. If the spec has no `turn` card, the arc just builds.
//   • RISERS/BOOMS ONLY AT PHASE CHANGES — at most three per short (build,
//     turn, kicker), never per slide. A gesture every slide at shorts pacing
//     is a metronome, which is the exact failure the long-form docs record
//     for v1 of the drift.
//
// Ships DARK behind VIDEO_MUSIC_BED_ENABLED (checked by the caller, not
// here). A bed failure must never cost a video — the caller falls back to
// the unscored file.

import { execFile } from "child_process";
import { promisify } from "util";

const execFileP = promisify(execFile);

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

/** Piecewise-linear envelope as an ffmpeg expression over `t`. */
export function envelope(points) {
  let expr = String(points[points.length - 1][1]);
  for (let i = points.length - 2; i >= 0; i--) {
    const [t0, v0] = points[i], [t1, v1] = points[i + 1];
    const lerp = `(${v0}+(${v1 - v0})*(t-${f(t0)})/${f(Math.max(0.01, t1 - t0))})`;
    expr = `if(lt(t,${f(t1)}),${lerp},${expr})`;
  }
  return expr;
}

/**
 * Map the short's slides onto the bed's arc and phase times.
 *
 * `slides` — [{ t: cardType }] in play order; `starts` — each slide's start
 * second in the final file (from the same audio durations the assembler used —
 * derived, not re-modelled, per the long-form lesson that nothing downstream
 * gets to re-model the timeline).
 *
 * Returns { arc, sections } for buildBed. Sections are the phase-change times
 * used for gates, risers and booms: at most { build, turn, kicker }.
 */
export function deriveShortArc(slides, starts, total) {
  const R = 2;                        // ramp seconds (shorts move faster than films)
  const idx = (t) => slides.findIndex((s) => s.t === t);
  const turnI = idx("turn");
  const kickerI = idx("kicker");
  // First evidence slide: the one after the title.
  const buildI = slides.length > 1 ? 1 : 0;

  const at = (i) => (i >= 0 && i < starts.length ? starts[i] : null);
  const build = at(buildI);
  const turn = at(turnI);
  const kicker = at(kickerI);

  const arc = [[0, 0.55]];            // cold open: restrained, let the hook land
  if (build != null && build > R) arc.push([build - R, 0.55], [build, 0.75]);
  if (turn != null) {
    arc.push([turn - R, 0.95], [turn, 0.40]);          // THE TURN — strip it
    const rebuildAt = kicker != null && kicker > turn ? kicker : Math.min(turn + 8, total - 4);
    arc.push([rebuildAt - R, 0.40], [rebuildAt, 0.90]);
  } else {
    arc.push([Math.max(0, total * 0.6), 0.95]);        // no turn: plain build
    if (kicker != null) arc.push([kicker - R, 0.95], [kicker, 0.90]);
  }
  arc.push([total, 0.85]);
  // Clamp + sort: a malformed spec (turn before slide 1, kicker missing) must
  // degrade to a monotonic envelope, never to a negative-time ffmpeg expr.
  const clamped = arc.map(([t, v]) => [Math.min(Math.max(t, 0), total), v])
    .sort((a, b) => a[0] - b[0]);

  const sections = [build, turn, kicker].filter((x) => x != null && x > 1 && x < total - 1);
  return { arc: clamped, sections, phases: { build, turn, kicker } };
}

/** The v4 bed. Synthesis verbatim from the long-form engine. */
export async function buildBed(seconds, out, { arc = null, sections = [], phases = {}, ffmpegPath }) {
  if (!ffmpegPath) throw new Error("videoMusicBed: ffmpegPath is required");
  const ff = (args) => execFileP(ffmpegPath, ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", ...args],
    { maxBuffer: 1 << 26 });

  const gate = (pts) => envelope(pts);
  const R2 = 0.4;
  const { build, turn, kicker } = phases;
  // Generalized gating: kick+hats absent in the cold open, present through the
  // build, stripped at the turn, back for the kicker. Arp2 joins at the build.
  const kickGate = build != null
    ? gate([[0, 0], [build - R2, 0], [build, 1],
            ...(turn != null ? [[turn - R2, 1], [turn, 0]] : []),
            ...(kicker != null ? [[kicker - R2, turn != null ? 0 : 1], [kicker, 1]] : []),
            [seconds, turn != null && kicker == null ? 0 : 1]])
    : "1";
  const hatGate = build != null
    ? gate([[0, 0], [build + (turn != null ? (turn - build) / 2 : 4) - R2, 0],
            [build + (turn != null ? (turn - build) / 2 : 4), 1],
            ...(turn != null ? [[turn - R2, 1], [turn, 0], [seconds, 0]] : [[seconds, 1]])])
    : "1";
  const arp2Gate = build != null
    ? gate([[0, 0], [build - R2, 0], [build, 1], [seconds, 1]])
    : "1";
  const d = seconds.toFixed(2);

  const arpL = `0.30*sin(2*PI*(${cycle4(S16, "220", "261.63", "329.63", "440")})*t)*exp(-13*mod(t,${f(S16)}))`;
  const arpR = `0.30*sin(2*PI*(${cycle4(S16, `220*${DETUNE}`, `261.63*${DETUNE}`, `329.63*${DETUNE}`, `440*${DETUNE}`)})*(t-${f(HAAS)}))*exp(-13*mod(t-${f(HAAS)},${f(S16)}))`;

  const a2 = (mul, off) =>
    `0.10*sin(2*PI*(${cycle4(S16, `440*${mul}`, `523.25*${mul}`, `659.26*${mul}`, `880*${mul}`)})*(t+${f(off)}))*exp(-18*mod(t+${f(off)},${f(S16)}))`;
  const arp2L = `(${arp2Gate})*` + a2(1, S8);
  const arp2R = `(${arp2Gate})*` + a2(1 / DETUNE, S8 + HAAS);

  const bass = `0.62*sin(2*PI*(${cycle4(CHORD, "55", "43.65", "65.41", "49")})*t)*(0.30+0.70*exp(-3.2*mod(t,${f(BEAT)})))`;
  const kick = `(${kickGate})*0.55*sin(2*PI*50*t)*exp(-17*mod(t,${f(BEAT)}))`;

  const padL = `0.05*(sin(2*PI*220*t)+sin(2*PI*329.63*t))*(0.55+0.45*sin(2*PI*t/17))`;
  const padR = `0.05*(sin(2*PI*${220 * DETUNE}*t)+sin(2*PI*${329.63 * DETUNE}*t))*(0.55+0.45*sin(2*PI*t/19))`;

  const hatEnv = `(${hatGate})*0.34*exp(-55*mod(t+${f(S8)},${f(S8)}))`;
  const arcExpr = arc ? envelope(arc) : "1";

  const riserEnv = sections.length ? sections.map((T) =>
    `if(between(t,${f(T - 2.6)},${f(T)}),pow((t-${f(T - 2.6)})/2.6,2),0)`).join("+") : "0";
  const boomExpr = sections.length ? sections.map((T) =>
    `if(gte(t,${f(T)}),0.85*sin(2*PI*46*(t-${f(T)}))*exp(-4.5*(t-${f(T)})),0)`).join("+") : "0";

  // Shorts are 60–100s; a 6s outro fade eats too much of that. 4s, and never
  // more than 8% of the piece.
  const fadeOut = Math.min(4, seconds * 0.08);

  await ff([
    "-f", "lavfi", "-i", `aevalsrc='${arpL}':s=${SR}:d=${d}`,
    "-f", "lavfi", "-i", `aevalsrc='${arpR}':s=${SR}:d=${d}`,
    "-f", "lavfi", "-i", `aevalsrc='${arp2L}':s=${SR}:d=${d}`,
    "-f", "lavfi", "-i", `aevalsrc='${arp2R}':s=${SR}:d=${d}`,
    "-f", "lavfi", "-i", `aevalsrc='${bass}':s=${SR}:d=${d}`,
    "-f", "lavfi", "-i", `aevalsrc='${kick}':s=${SR}:d=${d}`,
    "-f", "lavfi", "-i", `aevalsrc='${padL}':s=${SR}:d=${d}`,
    "-f", "lavfi", "-i", `aevalsrc='${padR}':s=${SR}:d=${d}`,
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
      `volume=volume='${arcExpr}':eval=frame,` +
      `afade=t=in:st=0:d=3,afade=t=out:st=${(seconds - fadeOut).toFixed(2)}:d=${fadeOut.toFixed(2)},` +
      `volume=1.30,alimiter=limit=0.95,` +
      `aformat=sample_fmts=fltp:channel_layouts=stereo[out]`,
    "-map", "[out]", "-t", d,
    "-c:a", "pcm_s16le", out,
  ]);
  return out;
}

/**
 * Mix the bed under the finished short, ducked by the narration.
 * Gentle ratio (2.5): the bed is meant to be heard — it steps back under
 * speech, it does not disappear. Video stream is copied untouched.
 */
export async function scoreShort(fileIn, bed, fileOut, { ffmpegPath }) {
  if (!ffmpegPath) throw new Error("videoMusicBed: ffmpegPath is required");
  const ff = (args) => execFileP(ffmpegPath, ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", ...args],
    { maxBuffer: 1 << 26 });
  await ff([
    "-i", fileIn, "-i", bed,
    "-filter_complex",
      `[0:a]asplit=2[voice][key];` +
      `[1:a][key]sidechaincompress=threshold=0.12:ratio=2.5:attack=20:release=380:makeup=1[ducked];` +
      `[voice][ducked]amix=inputs=2:duration=first:normalize=0,` +
      `loudnorm=I=-14:TP=-2.0:LRA=11,alimiter=limit=0.85[a]`,
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", fileOut,
  ]);
  return fileOut;
}
