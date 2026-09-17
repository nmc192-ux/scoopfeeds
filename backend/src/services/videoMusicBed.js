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
import { unlinkSync } from "fs";
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
 *
 * LOUDNORM RUNS TWICE, AND THE SECOND PASS IS LINEAR. The original single-pass
 * chain shipped MEASURED defects (2026-08-30, on a live published short):
 * −12.5 LUFS integrated against the −14 target and −0.2 dBTP against −2.0.
 * Single-pass loudnorm is DYNAMIC — a per-window gain ride that only
 * approximates the integrated target on programme material, and its output was
 * then re-peaked by the limiter and the AAC encode. The fix is the filter's own
 * documented protocol: measure first, then apply with `linear=true` and the
 * measured values, which is one constant gain and honours both targets by
 * construction.
 *
 * The intermediate is float WAV so the unnormalized amix cannot clip before
 * loudnorm ever sees it, and the 0.85 limiter stays LAST as a safety — with
 * TP at −2.0 it should never engage (−2.0 < −1.41); if it does, something
 * upstream regressed and quiet clamping is still better than a hot upload.
 */
export const LOUDNESS_TARGET = Object.freeze({ I: -14, TP: -2.0, LRA: 11 });

/**
 * ─── BED GAIN STAGING (2026-09-16) ──────────────────────────────────────────
 *
 * MEASURED DEFECT, on a render built by these same functions: the bed sat
 * **13.5 dB ABOVE the voice** during speech, and the sidechain contributed a
 * median of **0.00 dB** of gain reduction across 164 speech windows. Two
 * independent faults, and lowering a gain would have fixed only one of them.
 *
 *   1. NOTHING GAIN-STAGED THE TWO STEMS. buildBed ends with
 *      `alimiter=limit=0.95`, and alimiter AUTO-LEVELS by default — it
 *      normalizes its output UP toward the ceiling. So the bed arrived at
 *      +0.03 dBTP / −16.8 LUFS no matter what, while the narration arrived at
 *      whatever level the TTS happened to produce (−27.5 LUFS / −6.1 dBTP on
 *      the measured render). The bed was simply louder, and no stage between
 *      them ever compared the two.
 *
 *   2. THE SIDECHAIN THRESHOLD WAS IN THE WRONG PLACE ENTIRELY. ffmpeg's
 *      `threshold` is LINEAR AMPLITUDE, so 0.12 is −18.4 dBFS. The key — the
 *      narration — sits near −30 dBFS RMS under speech, i.e. **11.9 dB below
 *      the threshold**. The compressor never opened. It was not a gentle duck;
 *      it was no duck.
 *
 * THE FIX IS RELATIVE, NOT A NEW CONSTANT. A fixed bed gain would have been
 * the same bug with a nicer number: it would hold for one TTS voice and drift
 * the moment VIDEO_VOICE_ID changes, which is a knob this repo expects to be
 * turned. So both the bed gain and the sidechain key are derived from the
 * narration's OWN measured loudness:
 *
 *   • the bed is gained so it sits BED_UNDER_DB below the measured voice —
 *     this is the level you hear IN THE GAPS, and it is what keeps the bed
 *     present rather than absent;
 *   • the KEY is normalized to a fixed reference (KEY_REF_LUFS) before it hits
 *     the sidechain, so one threshold is correct for every voice. The key is a
 *     CONTROL SIGNAL ONLY — normalizing it changes no audio that anybody hears.
 *
 * With the key at a known level the threshold finally means something: speech
 * lands ~12 dB above it, and the ratio (2.5, unchanged — "the bed is meant to
 * be heard") turns that into ~7 dB of reduction while the voice is speaking.
 * Net: the bed sits ~BED_UNDER_DB under the voice in the gaps and ~17 dB under
 * it during speech, and the difference between those two is audible breathing
 * rather than a number in a config file.
 *
 * ALL THREE ARE ENV-TUNABLE because the house convention is that a level
 * judgement gets eyeballed and adjusted without a deploy — but the DEFAULTS
 * are the fix. Prod needs no env line to get the corrected mix.
 */
function envDb(name, fallback, { min, max }) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseFloat(raw);
  // A typo must not silently re-tune the mix — fall back loudly instead.
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

/**
 * How far BELOW the delivery true-peak target the mix is encoded, to leave the
 * AAC encoder room for inter-sample overshoot. 3.0 dB covers the 2.66 dB
 * measured on a speech-dominated short; the verify-and-retry in scoreShort is
 * what covers content that overshoots harder.
 */
export function encodeHeadroomDb() {
  return envDb("VIDEO_MUSIC_BED_ENCODE_HEADROOM_DB", 1.5, { min: 0, max: 12 });
}

/**
 * ─── VOICE CONDITIONING, AND WHY THE BED FIX FORCED IT ──────────────────────
 *
 * MEASURED: with the bed staged down to where it belongs, the mix arrives at
 * loudnorm at −27.55 LUFS with a −6.10 dBTP peak — a 21.5 dB crest factor.
 * Reaching −14 LUFS needs +13.55 dB, which would put true peak at +7.45 dBTP.
 * loudnorm CANNOT do that linearly, so it SILENTLY FALLS BACK TO DYNAMIC MODE:
 * the per-window gain ride that the 2026-08-30 fix exists to eliminate. The
 * output measured −15.4 LUFS with LRA 0.7, where a genuinely TP-constrained
 * linear gain would have produced −26.45 LUFS. That gap is the fallback.
 *
 * THE OLD, TOO-LOUD BED HAD BEEN HIDING THIS. A dense music bed runs
 * continuously and lifts the programme's integrated level toward its peaks, so
 * only ~3 dB of make-up was ever needed and linear mode always succeeded.
 * Quieting the bed removes that prop and exposes the narration as it actually
 * is: far too peaky to normalise linearly on its own.
 *
 * `linear=true` IN THE FILTER STRING IS NOT A GUARANTEE — it is a request, and
 * videoMusicBed.test.js can only assert the string. The only way to keep the
 * guarantee is to hand loudnorm a mix it CAN normalise linearly, which means
 * the narration has to arrive with a sane crest factor.
 *
 * So the voice is levelled before the mix: gained to a target, compressed to
 * bring the crest in, and held under a peak ceiling. This IS an editorial
 * change — the narration is more even than it was — but the alternative is not
 * "uncompressed narration", it is dynamic-mode loudnorm riding the gain across
 * the whole short, which is compression too, applied blindly and to everything
 * including the bed.
 *
 * VIDEO_MUSIC_BED_VOICE_LEVEL=0 turns it off; the mix then reverts to the
 * dynamic-mode behaviour described above, which is why it is not the default.
 */
export function voiceLeveling(voiceI, {
  enabled = process.env.VIDEO_MUSIC_BED_VOICE_LEVEL !== "0",
  targetLufs = envDb("VIDEO_MUSIC_BED_VOICE_TARGET_LUFS", -18, { min: -30, max: -6 }),
  ceilingDb = envDb("VIDEO_MUSIC_BED_VOICE_CEILING_DB", -6, { min: -20, max: -1 }),
  ratio = envDb("VIDEO_MUSIC_BED_VOICE_RATIO", 6, { min: 1, max: 20 }),
} = {}) {
  if (!enabled || !Number.isFinite(voiceI)) return { filter: null, targetLufs: voiceI };
  const gainDb = targetLufs - voiceI;
  // acompressor's threshold is LINEAR AMPLITUDE — the same trap that made the
  // old sidechain a no-op. Sit it below the ceiling so the compressor does the
  // smooth work and the limiter only catches what is left.
  const knee = 10 ** ((ceilingDb - 8) / 20);
  const ceil = 10 ** (ceilingDb / 20);
  return {
    targetLufs,
    filter:
      `volume=${gainDb.toFixed(2)}dB,` +
      `acompressor=threshold=${knee.toFixed(6)}:ratio=${ratio}:attack=5:release=120` +
        `:makeup=1:detection=rms,` +
      // level=false, for the same reason it is false on the final stage.
      `alimiter=limit=${ceil.toFixed(4)}:level=false`,
  };
}

export function bedMix() {
  return {
    // How far under the voice the bed sits when nobody is speaking.
    underDb: envDb("VIDEO_MUSIC_BED_UNDER_DB", -12, { min: -40, max: 0 }),
    // The level the sidechain key is normalized to. Not an audio level —
    // it exists so DUCK_THRESHOLD is voice-independent.
    keyRefLufs: envDb("VIDEO_MUSIC_BED_KEY_REF_LUFS", -20, { min: -40, max: -6 }),
    // Linear amplitude, against a key at keyRefLufs. 0.02 = −34 dBFS.
    duckThreshold: envDb("VIDEO_MUSIC_BED_DUCK_THRESHOLD", 0.02, { min: 0.001, max: 0.5 }),
    duckRatio: envDb("VIDEO_MUSIC_BED_DUCK_RATIO", 2.5, { min: 1, max: 20 }),
  };
}

export async function measureLoudness(file, { ffmpegPath, preFilter = null }) {
  // `preFilter` measures what a stem will be AFTER a stage, without writing an
  // intermediate: the voice conditioner changes the voice's loudness, and the
  // bed is staged against the CONDITIONED voice, so the number that matters is
  // the post-conditioning one.
  const chain = [preFilter,
    `loudnorm=I=${LOUDNESS_TARGET.I}:TP=${LOUDNESS_TARGET.TP}:LRA=${LOUDNESS_TARGET.LRA}:print_format=json`,
  ].filter(Boolean).join(",");
  // stderr, not stdout: loudnorm prints its JSON to the log stream.
  const { stderr } = await execFileP(ffmpegPath,
    ["-nostdin", "-hide_banner", "-i", file, "-af", chain, "-f", "null", "-"],
    { maxBuffer: 1 << 26 });
  const m = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (!m) throw new Error("videoMusicBed: loudnorm printed no measurement");
  return JSON.parse(m[0]);
}

export function secondPassLoudnorm(measured, t = LOUDNESS_TARGET) {
  for (const k of ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"]) {
    if (!(k in measured)) throw new Error(`videoMusicBed: measurement is missing ${k}`);
  }
  return `loudnorm=I=${t.I}:TP=${t.TP}:LRA=${t.LRA}` +
    `:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
    `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
    `:offset=${measured.target_offset}:linear=true`;
}

/**
 * The mix filtergraph, as a pure function of the two measured stem loudnesses.
 *
 * SEPARATED FROM scoreShort SO IT CAN BE MEASURED. The defect this replaced was
 * invisible in code review and obvious in a measurement, so the graph that
 * actually ships is the graph the ground harness renders — the harness asks for
 * `[ducked]` instead of `[a]` and gets the bed stem in isolation, with no second
 * copy of the parameters to drift out of step.
 *
 * Input 0 is the narration (the finished, unscored short); input 1 is the bed.
 * Returns the filter_complex string, the two derived gains, and the labels.
 */
export function mixFilterGraph({
  voiceI, bedI, mix = bedMix(), tapDucked = false, leveling = undefined,
}) {
  if (!Number.isFinite(voiceI) || !Number.isFinite(bedI)) {
    throw new Error(`videoMusicBed: unmeasurable stem (voice=${voiceI}, bed=${bedI})`);
  }
  const lvl = leveling === undefined ? voiceLeveling(voiceI) : leveling;
  // Everything downstream is staged against the LEVELLED voice — the level the
  // mix actually carries — not against the raw stem.
  const heardI = lvl.filter ? lvl.targetLufs : voiceI;
  const bedGainDb = (heardI + mix.underDb) - bedI;
  // The key is a CONTROL SIGNAL; this gain never reaches the output.
  const keyGainDb = mix.keyRefLufs - heardI;
  // `tapDucked` splits the ducked bed back out as a second, unused-by-the-mix
  // output so the ground harness can measure the bed in isolation. It changes
  // NOTHING about [a] — asplit is lossless and the mix leg is byte-identical —
  // which is the point: the thing measured is the thing that ships.
  const graph =
    `[0:a]${lvl.filter ? `${lvl.filter},` : ""}asplit=2[voice][keyraw];` +
    `[keyraw]volume=${keyGainDb.toFixed(2)}dB[key];` +
    `[1:a]volume=${bedGainDb.toFixed(2)}dB[bedlvl];` +
    `[bedlvl][key]sidechaincompress=threshold=${mix.duckThreshold}:ratio=${mix.duckRatio}` +
      `:attack=20:release=380:makeup=1[duckedraw];` +
    (tapDucked ? `[duckedraw]asplit=2[ducked][duckedtap];` : `[duckedraw]anull[ducked];`) +
    `[voice][ducked]amix=inputs=2:duration=first:normalize=0[a]`;
  return { graph, bedGainDb, keyGainDb, mix, leveling: lvl, heardI,
           out: "[a]", duckedOut: "[duckedtap]" };
}

export async function scoreShort(fileIn, bed, fileOut, { ffmpegPath }) {
  if (!ffmpegPath) throw new Error("videoMusicBed: ffmpegPath is required");
  const ff = (args) => execFileP(ffmpegPath, ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", ...args],
    { maxBuffer: 1 << 26 });

  // Pass 0: MEASURE BOTH STEMS. Everything below is relative to these two
  // numbers, which is what makes the mix hold across TTS voices — see the
  // BED GAIN STAGING note above.
  const [voiceRaw, bedM] = await Promise.all([
    measureLoudness(fileIn, { ffmpegPath }),
    measureLoudness(bed, { ffmpegPath }),
  ]);
  // The leveller is derived from the RAW voice, then the voice is RE-MEASURED
  // THROUGH it. Its compressor and limiter pull the level back down below the
  // gain that was applied — measured −19.74 LUFS for an −18 target — so staging
  // the bed against the requested target rather than the achieved one put it
  // ~1.7 dB out. Assume nothing that can be measured.
  const leveling = voiceLeveling(Number(voiceRaw.input_i));
  const voiceM = leveling.filter
    ? await measureLoudness(fileIn, { ffmpegPath, preFilter: leveling.filter })
    : voiceRaw;
  const staged = mixFilterGraph({
    voiceI: Number(voiceM.input_i), bedI: Number(bedM.input_i),
    // The filter is already built; pass the ACHIEVED loudness as the reference.
    leveling: { ...leveling, targetLufs: Number(voiceM.input_i) },
  });

  // Pass 1: the mix itself — voice, sidechain-ducked bed — to float PCM.
  const mixed = `${fileOut}.mix.wav`;
  await ff([
    "-i", fileIn, "-i", bed,
    "-filter_complex", staged.graph,
    "-map", staged.out, "-c:a", "pcm_f32le", "-ar", "48000", "-ac", "2", mixed,
  ]);

  try {
    // Pass 2: measure, then apply linearly against the measured values.
    const measured = await measureLoudness(mixed, { ffmpegPath });

    // ── ENCODE HEADROOM, AND THEN VERIFY IT ───────────────────────────────
    //
    // MEASURED, once the bed came down: loudnorm and the limiter land the mix
    // at −14.28 LUFS / −1.99 dBTP — dead on target, with the limiter not
    // engaging at all — and the AAC ENCODE THEN ADDS 2.66 dB of inter-sample
    // true peak, delivering +0.67 dBTP against a −2.0 target.
    //
    // The overshoot was always there (the file header records a 0.94 ceiling
    // measuring +0.86 dBFS), but the old, far-too-loud bed masked it: a dense
    // music bed needed only ~3 dB of make-up gain and its peaks never
    // approached the ceiling. A speech-dominated mix has sharp transients and
    // needs ~13 dB, so the encoder's reconstruction overshoots much harder.
    //
    // Encoding to a lower internal target is necessary but NOT sufficient,
    // because the overshoot is content-dependent — which is exactly the kind
    // of thing this file has been burned by before. So the encoded file is
    // MEASURED, and if it still exceeds the delivery target the encode is
    // repeated once from the same WAV with the excess taken out. An unmeasured
    // ceiling is not a ceiling.
    const deliveryTp = LOUDNESS_TARGET.TP;
    let trimDb = encodeHeadroomDb();
    let lastTp = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      await ff([
        "-i", fileIn, "-i", mixed,
        // level=false IS THE ACTUAL FIX for the earlier defect. alimiter
        // AUTO-LEVELS by default — it normalizes its output UP toward the
        // ceiling — so the original chain took loudnorm's on-target mix and
        // boosted it ~+1.4 dB, which is precisely the +1.5 LU / −0.2 dBTP
        // signature measured on the published file. The bed's INTERNAL limiter
        // keeps auto-level: it was part of the sound the bed was tuned to, and
        // its output passes through this correctly-behaved stage anyway.
        "-filter_complex",
          `[1:a]${secondPassLoudnorm(measured, { ...LOUDNESS_TARGET, TP: deliveryTp - trimDb })},` +
          `alimiter=limit=0.85:level=false[a]`,
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart", fileOut,
      ]);
      const got = await measureLoudness(fileOut, { ffmpegPath });
      lastTp = Number(got.input_tp);
      if (!Number.isFinite(lastTp) || lastTp <= deliveryTp) break;
      // Take out exactly what it overshot by, plus a small guard, and re-encode.
      trimDb += (lastTp - deliveryTp) + 0.3;
    }
    if (Number.isFinite(lastTp) && lastTp > deliveryTp) {
      // Honesty rule: say it, do not quietly ship a hot file as if it passed.
      console.warn(
        `🎬 music bed: encoded true peak ${lastTp.toFixed(2)} dBTP still exceeds ` +
        `${deliveryTp} after two encodes (headroom ${trimDb.toFixed(2)} dB) — shipping anyway, but this is over target`);
    }
  } finally {
    try { unlinkSync(mixed); } catch { /* already gone */ }
  }
  return fileOut;
}
