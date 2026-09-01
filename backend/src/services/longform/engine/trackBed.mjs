// A real music track as the score bed, in place of the procedural one.
//
//   node trackBed.mjs <track.mp3> [seconds]      → writes out/bed.wav
//
// WHY THIS EXISTS. music.mjs synthesises its bed from oscillators. It is a
// genuinely careful piece of work — stereo width, a chapter-keyed intensity
// arc — and it still sounds synthesised, because it is. A film that wants to
// read as young and modern needs a track somebody actually wrote.
//
// The seam it plugs into is already there: music.mjs's scoreFilm(filmIn, bed,
// filmOut) ducks ANY bed under the voice. So this module only has to turn one
// track into a bed of exactly the right length and level; the ducking, the
// loudness normalisation and the limiter are unchanged and shared.
//
// ── Where the track comes from ──────────────────────────────────────────────
//
// Pixabay Music, downloaded by hand. This is worth stating plainly because the
// obvious assumption is wrong: Pixabay's public API covers images and videos,
// NOT music. There is no documented music search endpoint to automate, so a
// script that claimed to fetch a track "from the Pixabay API" would be
// inventing one. Download the mp3 from pixabay.com/music/ and pass its path.
//
// Pixabay's Content Licence permits commercial use without attribution, which
// is why it is the right library here — but the licence rides with the FILE,
// not with this code, so the chosen track is recorded in the film's provenance
// like any other asset.

import { existsSync, statSync } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { ffmpegPath, P } from "./_deps.mjs";

const exec = promisify(execFile);
const ff = (args) => exec(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args]);

/**
 * Seconds of audio in a file.
 *
 * PARSED FROM `ffmpeg -i`, NOT FROM ffprobe. The bundled @ffmpeg-installer
 * package ships the ffmpeg binary ALONE — there is no sibling ffprobe — so
 * deriving one from the other by string-replacing the filename produces a
 * spawn ENOENT on exactly the machines that have no system ffmpeg, which is
 * the case this engine bundles a binary for in the first place. build.mjs
 * already reads durations this way; this is the same method, not a second one.
 */
export async function audioDuration(file) {
  if (!existsSync(file)) throw new Error(`no such audio file: ${file}`);
  // `ffmpeg -i` with no output is an error exit by design: it prints the
  // stream info and stops. The duration is in that output either way.
  const text = await exec(ffmpegPath, ["-hide_banner", "-i", file])
    .then((r) => `${r.stderr || ""}${r.stdout || ""}`)
    .catch((e) => `${e.stderr || ""}${e.stdout || ""}`);
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
  const d = m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
  if (!(d > 0)) throw new Error(`could not read a duration from ${file}`);
  return d;
}

export const BED_DEFAULTS = {
  xfade: 4,      // seconds of crossfade at each loop seam
  fadeIn: 2,
  fadeOut: 6,    // long enough to land under the closing line rather than stop
  headroom: -16, // LUFS for the bed itself; scoreFilm's loudnorm does the rest
};

/**
 * How many times a track must repeat to cover the film, and where it is cut.
 *
 * Kept pure and exported because the off-by-one here is the kind that only
 * shows up 12 minutes into a render: one repeat too few leaves silence under
 * the last chapter, which is exactly where the film is trying to land.
 *
 * @returns {{repeats:number, totalRaw:number, xfade:number}}
 */
export function loopPlan(trackSeconds, filmSeconds, { xfade = BED_DEFAULTS.xfade } = {}) {
  if (!(trackSeconds > 0)) throw new Error("loopPlan: track duration must be positive");
  if (!(filmSeconds > 0)) throw new Error("loopPlan: film duration must be positive");
  // A crossfade of `xfade` costs that much length at every join, so N copies
  // yield N*track - (N-1)*xfade. Solve for the smallest N covering the film.
  const eff = Math.max(0.1, trackSeconds - xfade);
  const repeats = Math.max(1, Math.ceil((filmSeconds - xfade) / eff));
  return { repeats, totalRaw: repeats * trackSeconds - (repeats - 1) * xfade, xfade };
}

/**
 * Build the bed: loop the track past the film's length, crossfading each seam,
 * then trim to exact length and fade the ends.
 *
 * A HARD LOOP SEAM IS THE TELL. Butt-joining a track to itself puts a click and
 * an abrupt phrase restart at a predictable interval, and once a listener hears
 * it they hear it every time. acrossfade costs a few seconds per join and
 * removes the artefact entirely.
 */
export async function bedFromTrack(track, filmSeconds, out, opt = {}) {
  const o = { ...BED_DEFAULTS, ...opt };
  if (!existsSync(track)) throw new Error(`music track not found: ${track}`);
  const dur = await audioDuration(track);
  const { repeats, xfade } = loopPlan(dur, filmSeconds, o);

  const args = [];
  for (let i = 0; i < repeats; i++) args.push("-i", track);

  let chain = "";
  if (repeats === 1) {
    chain = `[0:a]anull[loop];`;
  } else {
    // Fold left: ((0 x 1) x 2) x 3 … Each acrossfade consumes `xfade` seconds.
    let cur = "0:a";
    for (let i = 1; i < repeats; i++) {
      const lbl = i === repeats - 1 ? "loop" : `x${i}`;
      chain += `[${cur}][${i}:a]acrossfade=d=${xfade}:c1=tri:c2=tri[${lbl}];`;
      cur = lbl;
    }
  }
  const fadeOutAt = Math.max(0, filmSeconds - o.fadeOut);
  // ORDER MATTERS, AND apad IS NOT DECORATIVE.
  //
  // The obvious order — trim to length, fade, then normalise — silently
  // produces a SHORT bed. Single-pass loudnorm keeps a lookahead buffer and
  // this engine's bundled ffmpeg (a 2018 build) does not flush it: measured on
  // a 47s request, a correct 52s loop came out at 43.69s. That is 3.3s of
  // silence at the end of every film, landing exactly under the closing line,
  // and nothing upstream looks wrong.
  //
  // So: normalise the whole loop FIRST and let it eat whatever it eats, apad to
  // guarantee the stream cannot run out, and only then trim to the exact length.
  // The trim is last, so the bed is exactly as long as the film by construction
  // rather than by arithmetic. Fades go after the trim so the fade-out lands on
  // the real end.
  chain += `[loop]loudnorm=I=${o.headroom}:TP=-3:LRA=11,apad,`
    + `atrim=0:${filmSeconds.toFixed(3)},asetpts=PTS-STARTPTS,`
    + `afade=t=in:st=0:d=${o.fadeIn},`
    + `afade=t=out:st=${fadeOutAt.toFixed(3)}:d=${o.fadeOut}[a]`;

  await ff([...args, "-filter_complex", chain, "-map", "[a]",
    "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", out]);
  return { out, trackSeconds: dur, repeats, bytes: statSync(out).size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const track = process.argv[2];
  if (!track) {
    console.error("usage: node trackBed.mjs <track.mp3> [seconds]\n\n"
      + "Download the track from pixabay.com/music/ first — Pixabay's API does not\n"
      + "serve music, so there is nothing to automate here.");
    process.exit(1);
  }
  const seconds = Number(process.argv[3] || 0)
    || await audioDuration(P("out/xylitol-study.mp4"));
  const r = await bedFromTrack(path.resolve(track), seconds, P("out/bed.wav"));
  console.log(`bed: ${(seconds / 60).toFixed(1)} min from a ${r.trackSeconds.toFixed(0)}s track `
    + `× ${r.repeats} → ${r.out}`);
}
