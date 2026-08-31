// Assembly. Renders animated card sequences, cuts multiple shots per narration
// beat, concatenates, tops and tails the film.
//
// ─── The two problems this version fixes ─────────────────────────────────────
//
// Measured against Vox ("Why China's population is shrinking", 8:39):
//
//                       Vox     us (v1)
//   median shot         3.42s   7.69s
//   shots under 2s      21%     0%
//   static frames       38%     81%
//
// 1. PACING. v1 gave each narration beat exactly one visual, held for the
//    length of the sentence. Shot length was a mechanical function of sentence
//    length, so it clustered at ~7.7s — a metronome. Fixed by INSERTS (cutaways
//    inside long beats) and by splitting long photo beats into a wide shot and
//    a punch-in.
//
// 2. MOTION. v1 rendered two static states and crossfaded. Fixed by rendering
//    each card as a frame SEQUENCE. The frame still never pans — that rule from
//    video-pipeline.md §2 stands, and Vox doesn't pan either — but the CONTENT
//    now animates: bars grow, rules draw, elements arrive.
//
// Cards animate in two phases (see render.mjs): a fast entrance, then a payoff
// timed to ~45% through the spoken line. That preserves the reveal timing that
// fixed the "voice lagging the picture" problem.
//
// Every segment is encoded with identical codecs/rate so the concat demuxer can
// join them without re-encoding the whole film.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { execFile, spawnSync } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { renderCard, HAS_PAYOFF, PAYOFF_P } from "./render.mjs";
import { ffmpegPath, P, loadStoryboard, projectSlug } from "./_deps.mjs";
import { findAnchor, clampReveal } from "./wordTimings.mjs";
import { parallaxFilter, validateParallax, FG_HEIGHT_FRAC } from "./parallax.mjs";
import { srtTime } from "./srtTime.mjs";
import { loadStatement } from "./statement.mjs";
import { useAsset, licenseLines } from "./assetRegistry.mjs";
import { ASSETS } from "./_deps.mjs";
const { STORYBOARD, TITLE_SEGMENT, FOOTAGE, GRADES, INSERTS, DOCS } = await loadStoryboard();
const SLUG = projectSlug();

const FFMPEG = ffmpegPath;
const execFileP = promisify(execFile);



// Reported once per build, not once per beat: on a film whose takes predate
// word timings every anchored card would otherwise print the same line.
let warnedNoWordTimings = false;

const FPS = 30;
const TAIL = 0.38;
const CHAPTER_TAIL = 0.9;
const FADE_IN = 1.4;
const FADE_OUT = 2.6;
const OUTRO_TAIL = 1.1;

const ENTER_SECS = 1.20;    // entrance animation
const PAYOFF_SECS = 0.70;   // payoff animation
const MIN_PIECE = 1.1;      // never cut a fragment shorter than this
const CARD_SPLIT = 7.0;     // above this, a card is split into animate + held push
const PIECE_EPS = 0.02;     // float slack when testing piece lengths
// Silence before the first word. The film used to open with narration already
// running under a 1.4s video fade and a 0.8s audio fade, so the first line was
// half-swallowed and collided with the opening card. A held frame first lets
// both fades finish, then the voice enters clean.
const LEAD_IN = 1.0;
const READ_WPS = 3.0;       // display-type reading speed, words/second
const MAX_HOLD = 1.8;       // most we will extend a shot to make it readable

/** Every word that actually appears on a card. */
function cardWords(v) {
  const bits = [];
  if (v.lines) bits.push(...v.lines);
  for (const k of ["title", "label", "note", "figure", "name", "unit", "text", "who", "role"]) {
    if (v[k]) bits.push(String(v[k]));
  }
  if (v.items) v.items.forEach((i) => bits.push(i.label, i.display));
  if (v.rows) v.rows.forEach((r) => bits.push(r.who, r.what));
  if (v.stages) v.stages.forEach((x) => bits.push(x.name, x.sub || ""));
  return bits.join(" ").replace(/\*/g, "").split(/\s+/).filter(Boolean).length;
}

const ff = (args) => execFileP(FFMPEG, ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", ...args],
  { maxBuffer: 1 << 26 });

/** Ken Burns. `z0` lets a punch-in start already tight, so it reads as a new shot. */
function kenFilter(mode, frames, z0 = 1.0) {
  const Z = z0 + 0.16;
  const zin = `min(${z0}+(${(Z - z0).toFixed(4)}/${frames})*on,${Z})`;
  const zout = `max(${Z}-(${(Z - z0).toFixed(4)}/${frames})*on,${z0})`;
  const cx = `iw/2-(iw/zoom/2)`, cy = `ih/2-(ih/zoom/2)`;
  const map = {
    in: { z: zin, x: cx, y: cy },
    out: { z: zout, x: cx, y: cy },
    left: { z: `${Z}`, x: `(iw-iw/zoom)*(1-on/${frames})`, y: cy },
    right: { z: `${Z}`, x: `(iw-iw/zoom)*(on/${frames})`, y: cy },
  };
  const m = map[mode] || map.in;
  return `scale=2560:1440:force_original_aspect_ratio=increase,crop=2560:1440,`
    + `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${frames}:s=1920x1080:fps=${FPS},format=yuv420p`;
}

const AENC = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"];
const VENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
  "-pix_fmt", "yuv420p", "-r", String(FPS)];

// NO PER-SEGMENT AUDIO — segments are video-only, deliberately.
//
// The first architecture sliced each beat's narration per shot (atrim from
// audioStart) and encoded it into that segment's own AAC stream. Every shot
// boundary was therefore an AAC re-encode boundary, and every within-beat cut
// (cutaway inserts, split footage beats) chopped the voice MID-WORD and glued
// the halves back with ~30ms of codec priming between them. Viewers heard the
// voice hiccup and die at cuts for no visible reason. An editor never cuts the
// VO when cutting to B-roll: the narration is ONE continuous track and the
// picture cuts over it — so takes are now placed once, at final mux, at each
// beat's measured start. audioStart survives on plan items only to mark which
// piece begins a beat (audioStart === 0).

/** Container-header duration — instant, ±5ms, all we need for VO placement. */
async function headerDur(file) {
  const { stderr } = await execFileP(FFMPEG, ["-hide_banner", "-nostdin", "-i", file])
    .catch((e) => ({ stderr: String(e.stderr || "") }));
  const m = String(stderr).match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (!m) throw new Error(`no duration in header of ${file}`);
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}

// A CLIP'S IN-POINT MUST STAY INSIDE THE CLIP. Now that main footage advances
// its in-point across a beat's cutaways, a long beat over a short source can ask
// for a second that does not exist; `-ss` past the end yields an empty input and
// the shot renders black. `-stream_loop -1` already loops the source, so wrapping
// the offset is the behaviour the flags were chosen for.
const _durCache = new Map();
function clipDuration(file) {
  if (_durCache.has(file)) return _durCache.get(file);
  const r = spawnSync(ffmpegPath, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec((r.stderr || "") + (r.stdout || ""));
  const d = m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0;
  _durCache.set(file, d);
  return d;
}

/** A still or footage shot. */
async function shotStill(p) {
  const { image, clip, grade, crop, ken, zoom0, punch, pan, seconds, out } = p;
  let clipIn = p.clipIn || 0;
  if (clip) {
    const d = clipDuration(clip);
    // Leave room for the shot itself before wrapping, not just for the seek.
    if (d > seconds && clipIn + seconds > d) clipIn = clipIn % Math.max(0.001, d - seconds);
    else if (d > 0 && clipIn >= d) clipIn = clipIn % d;
  }
  const frames = Math.max(2, Math.round(seconds * FPS));
  const args = [];
  let v;
  if (clip) {
    args.push("-stream_loop", "-1", "-ss", String(clipIn || 0), "-i", clip);
    // RETURNS TO A LOCKED-OFF CLIP NEED A DIFFERENT FRAMING, NOT A DIFFERENT
    // SECOND. `ken`/`zoom0` were read only on the image branch, so footage got
    // no reframing at all: a beat that cut away and came back replayed a
    // pixel-identical composition, and three of those inside nine seconds reads
    // as a stock loop however far the in-point has advanced. The punch is
    // cropped BEFORE the 1920x1080 normalise so a 2560-wide source spends its
    // real resolution on it rather than upscaling a downscale.
    const z = punch && punch > 1 ? punch : 0;
    const px = { l: "0", r: "iw-ow", c: "(iw-ow)/2" }[pan || "c"] ?? "(iw-ow)/2";
    v = `[0:v]${crop ? `crop=${crop},` : ``}`
      + (z ? `crop=floor(iw/${z}/2)*2:floor(ih/${z}/2)*2:${px}:(ih-oh)/2,` : ``)
      + `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,`
      + `fps=${FPS},${GRADES[grade] || GRADES.default},format=yuv420p,`
      + `trim=duration=${seconds},setpts=PTS-STARTPTS[v]`;
  } else if (p.fg) {
    // Two-layer parallax: bg keeps the house Ken Burns, fg is a cutout
    // drifting the other way — the relative motion is the depth cue.
    // Filter graph built in parallax.mjs so it is testable on its own.
    args.push("-loop", "1", "-framerate", String(FPS), "-i", image);
    // No -loop on the cutout: overlay's eof_action=repeat holds the single
    // decoded+scaled frame instead of re-decoding the PNG every output frame.
    args.push("-i", p.fg);
    const kenChain = kenFilter(ken || "in", frames, zoom0 || 1.0);
    const ph = p.parallaxPhase;
    v = parallaxFilter({
      kenChain, frames, seconds,
      dx: p.parallax?.shift, anchor: p.parallax?.anchor,
      fgH: p.parallax?.scale ? Math.round(1080 * FG_HEIGHT_FRAC * p.parallax.scale) : undefined,
      phaseStart: ph ? Math.round(ph.start * FPS) : 0,
      phaseTotal: ph ? Math.max(2, Math.round(ph.total * FPS)) : null,
    });
  } else {
    args.push("-loop", "1", "-framerate", String(FPS), "-i", image);
    const vf = ken ? kenFilter(ken, frames, zoom0 || 1.0) : `scale=1920:1080,format=yuv420p`;
    v = `[0:v]${vf},trim=duration=${seconds},setpts=PTS-STARTPTS[v]`;
  }
  args.push("-filter_complex", v,
    "-map", "[v]", "-an", "-t", String(seconds),
    ...VENC, "-movflags", "+faststart", out);
  await ff(args);
  return out;
}

/**
 * An animated card shot. Four spans concatenated:
 *   enter frames → hold → payoff frames → hold
 * Rendering only the moving spans keeps this to ~57 renders per card instead of
 * one render per frame of an eight-second shot.
 */
async function shotCard(p) {
  const { dir, seconds, revealAt, payoff, frozen, hadPayoff, out } = p;
  const enterN = Math.max(2, Math.round(ENTER_SECS * FPS));
  const payN = Math.max(2, Math.round(PAYOFF_SECS * FPS));

  // A card resumed after a cutaway is already finished animating — hold its
  // LAST frame (the payoff one, if it had a payoff), not its entrance frame.
  if (frozen) {
    const last = hadPayoff
      ? path.join(dir, `p${String(payN - 1).padStart(3, "0")}.png`)
      : path.join(dir, `e${String(enterN - 1).padStart(3, "0")}.png`);
    return shotStill({ ...p, image: last, ken: null, clip: null, fg: null, parallax: null });
  }

  const hold1 = Math.max(0.04, revealAt - ENTER_SECS);
  const hold2 = Math.max(0.04, seconds - revealAt - (payoff ? PAYOFF_SECS : 0));

  const args = ["-framerate", String(FPS), "-i", path.join(dir, "e%03d.png")];
  args.push("-loop", "1", "-framerate", String(FPS), "-t", hold1.toFixed(3), "-i", path.join(dir, `e${String(enterN - 1).padStart(3, "0")}.png`));
  let parts = 2;
  if (payoff) {
    args.push("-framerate", String(FPS), "-i", path.join(dir, "p%03d.png"));
    args.push("-loop", "1", "-framerate", String(FPS), "-t", hold2.toFixed(3), "-i", path.join(dir, `p${String(payN - 1).padStart(3, "0")}.png`));
    parts = 4;
  } else {
    args.push("-loop", "1", "-framerate", String(FPS), "-t", hold2.toFixed(3), "-i", path.join(dir, `e${String(enterN - 1).padStart(3, "0")}.png`));
    parts = 3;
  }
  const norm = (i, dur) => `[${i}:v]scale=1920:1080,format=yuv420p,setsar=1`
    + (dur ? `,trim=duration=${dur.toFixed(3)}` : ``) + `,setpts=PTS-STARTPTS[s${i}]`;
  const chains = [];
  for (let i = 0; i < parts; i++) chains.push(norm(i, i % 2 === 1 ? (i === 1 ? hold1 : hold2) : null));
  const labels = Array.from({ length: parts }, (_, i) => `[s${i}]`).join("");
  const filter = `${chains.join(";")};${labels}concat=n=${parts}:v=1:a=0,`
    + `trim=duration=${seconds.toFixed(3)},setpts=PTS-STARTPTS[v]`;

  args.push("-filter_complex", filter, "-map", "[v]", "-an",
    "-t", String(seconds), ...VENC, "-movflags", "+faststart", out);
  await ff(args);
  return out;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// srtTime lives in srtTime.mjs — build.mjs runs a film build on import, so
// nothing defined inside it is reachable from a test.

/** Render the frame sequence for one card into `dir`. */
async function renderCardFrames(spec, dir, payoff) {
  mkdirSync(dir, { recursive: true });
  const enterN = Math.max(2, Math.round(ENTER_SECS * FPS));
  for (let i = 0; i < enterN; i++) {
    const t = i / (enterN - 1);
    const p = payoff ? t * PAYOFF_P : t;
    await renderCard(spec, path.join(dir, `e${String(i).padStart(3, "0")}.png`), p);
  }
  if (!payoff) return enterN;
  const payN = Math.max(2, Math.round(PAYOFF_SECS * FPS));
  for (let i = 0; i < payN; i++) {
    const t = i / (payN - 1);
    await renderCard(spec, path.join(dir, `p${String(i).padStart(3, "0")}.png`), PAYOFF_P + t * (1 - PAYOFF_P));
  }
  return enterN + payN;
}

async function main() {
  mkdirSync(P("out/cards"), { recursive: true });
  mkdirSync(P("out/segments"), { recursive: true });
  rmSync(P("out/anim"), { recursive: true, force: true });
  mkdirSync(P("out/anim"), { recursive: true });

  const takes = JSON.parse(readFileSync(P("takes.json"), "utf8"));
  const byId = new Map(takes.map((t) => [t.id, t]));
  const CHAPTER_BEATS = new Set(
    Object.entries(STORYBOARD).filter(([, v]) => v.card === "chapter").map(([k]) => +k));

  // ── 1. animation frames for every card ──────────────────────────────────
  const cardJobs = Object.entries(STORYBOARD).filter(([, v]) => v.card || v.doc)
    .map(([id, v]) => ({ id: +id, spec: v.doc ? DOCS[v.doc] : v }));
  // NAMED FAILURE, NOT A TypeError. A storyboard without a TITLE_SEGMENT
  // (or with one missing `spec`) used to die here as "Cannot read properties
  // of null (reading 'spec')" — 300 lines into a build, naming nothing an
  // author could act on. Hit while rendering a real fixture film.
  if (!TITLE_SEGMENT?.spec) {
    throw new Error(
      "storyboard: TITLE_SEGMENT is missing or has no `spec`. Every film needs a title " +
      "card — export TITLE_SEGMENT = { after: <beat>, seconds: <n>, spec: { card: \"title\", ... } }.");
  }
  cardJobs.push({ id: "title", spec: TITLE_SEGMENT.spec });
  cardJobs.push({ id: "outro", spec: { card: "outro" } });

  const t0 = Date.now();
  let renders = 0;
  await pool(cardJobs, 6, async ({ id, spec }) => {
    const payoff = HAS_PAYOFF.has(spec.card);
    renders += await renderCardFrames(spec, P(`out/anim/${id}`), payoff);
  });
  console.log(`rendered ${renders} card frames across ${cardJobs.length} cards `
    + `in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // ── 2. running order, now with multiple shots per beat ──────────────────
  const plan = [];
  const held = [];
  const push = (o) => plan.push({ ...o, out: P(`out/segments/s${String(plan.length).padStart(3, "0")}.mp4`) });

  // BEAT_COUNT is derived, not hardcoded. This literally used to be `59` —
  // v2's beat count, left over from the film the engine was built for. Any
  // project with more beats silently lost everything past 59: cards never
  // rendered, and for a video whose ending lands in the last few beats, that
  // is losing the ending.
  const BEAT_COUNT = Math.max(...takes.map((t) => (typeof t.id === "number" ? t.id : 0)));
  // Provenance collected across the film, written to LICENSES.md below.
  const usedStatements = new Map();
  const usedAssets = new Map();

  for (let id = 1; id <= BEAT_COUNT; id++) {
    const v0 = STORYBOARD[id], take = byId.get(id), fo = FOOTAGE[id];
    const v = v0.doc ? { ...DOCS[v0.doc] } : v0;   // doc beats are cards
    const tail = CHAPTER_BEATS.has(id) ? CHAPTER_TAIL : TAIL;
    let seconds = +(take.dur + tail).toFixed(3);
    // The opening beat carries the lead-in silence inside itself, so the beat
    // still fully contains its own narration.
    const lead = id === 1 ? LEAD_IN : 0;
    if (lead) seconds = +(seconds + lead).toFixed(3);
    const isCard = !!v.card;
    const payoff = isCard && HAS_PAYOFF.has(v.card);
    const insList = (INSERTS[id] || []).slice().sort((a, b) => a.at - b.at);
    const ins = insList[0];

    // A statement beat resolves from the evidence ARCHIVE at plan time. The
    // storyboard names an id; loadStatement throws if it was never captured,
    // so a film cannot reach the renderer holding evidence that does not
    // exist. The card re-checks verbatim on every frame.
    if (v.card === "tweet" && v.statementId) {
      v.statement = loadStatement(v.statementId, { P });
      usedStatements.set(v.statementId, v.statement);
    }

    // Registry-backed cutouts resolve (and amortize) at plan time too — an
    // unregistered key names the registry here rather than dying in ffmpeg.
    if (v.parallax?.cutout) {
      const a = useAsset(ASSETS, "cutout", v.parallax.cutout);
      v.parallax = { ...v.parallax, resolvedFg: a.absPath };
      usedAssets.set(a.key, a);
    }

    // Parallax declarations are validated here, at plan time, so a bad beat
    // names itself before an hour of rendering — not during it. The validator
    // is shown the FOOTAGE-table entry too: footage arrives via FOOTAGE[id],
    // not only via the beat's own `footage` field, and a parallax silently
    // losing to the footage branch is exactly the failure this check exists
    // to catch. The cutout file is stat'ed now for the same reason — a typo'd
    // key otherwise dies mid-build as a raw ffmpeg "No such file".
    if (v.parallax) {
      const perrs = validateParallax({ ...v,
        footage: v.footage || (fo ? fo.file : undefined),
        parallax: { ...v.parallax, fg: v.parallax.fg || v.parallax.cutout } });
      if (perrs.length) throw new Error(`beat ${id}: ${perrs.join("; ")}`);
      const fgPath = v.parallax.resolvedFg || P(`out/photos/${v.parallax.fg}.png`);
      if (!existsSync(fgPath)) throw new Error(`beat ${id}: parallax cutout missing: ${fgPath}`);
    }
    const base = {
      beat: id, text: take.text, audio: take.file, audioLead: lead,
      image: v.photo ? P(`out/photos/${v.photo}.png`) : null,
      clip: fo ? P(`out/footage/${fo.file}.mp4`) : null,
      clipIn: fo ? fo.in : 0, grade: fo ? fo.grade : null, crop: fo ? fo.crop : null,
      ken: v.photo && !fo ? v.ken : null,
      fg: v.parallax ? (v.parallax.resolvedFg || P(`out/photos/${v.parallax.fg}.png`)) : null,
      parallax: v.parallax || null,
    };

    // MAIN FOOTAGE CONTINUES ACROSS ITS OWN CUTAWAYS. Every non-insert fragment
    // of a beat used to spread `base` verbatim, so `clipIn` stayed at `fo.in`
    // and the clip RESTARTED from the same second each time. A beat with two
    // cutaways therefore played main-A-main-B-main as the *identical* three
    // seconds of footage three times inside nine seconds, which reads as a
    // stock-library loop rather than as an edit. Advancing the in-point makes
    // the fragments one continuous shot interrupted by cutaways — the ordinary
    // grammar, and the thing a viewer stops noticing.
    // Wide, then two tighter framings offset to opposite sides — so the beat
    // reads as three angles on one scene rather than one shot played three
    // times. Kept modest (1.34 max) because most sources are 1080p and a harder
    // punch is visibly soft.
    const MAIN_FRAMING = [
      { punch: 1.0,  pan: "c" },
      { punch: 1.22, pan: "l" },
      { punch: 1.34, pan: "r" },
      { punch: 1.14, pan: "c" },
    ];
    let mainUsed = 0, mainNth = 0;
    const mainFrag = (extra) => {
      const fr = MAIN_FRAMING[mainNth % MAIN_FRAMING.length];
      const f = { ...base, kind: "still", ...extra,
                  clipIn: (fo ? fo.in : 0) + mainUsed,
                  // Parallax drift phase, in seconds of the WHOLE beat — the
                  // same continuity idea as clipIn advancing above.
                  parallaxPhase: v.parallax ? { start: mainUsed, total: seconds } : undefined,
                  punch: fo ? fr.punch : undefined, pan: fo ? fr.pan : undefined };
      mainUsed += extra.seconds;
      mainNth += 1;
      return f;
    };

    // Where the card's animation finishes; an insert must come after it.
    //
    // A card may declare `revealOn: "<phrase>"` to land its payoff on a WORD
    // rather than at a fixed ~30% of the line. That needs an alignment from
    // narrate.mjs, and there are three cases, kept distinct on purpose:
    //
    //   · anchor resolves          → use it, clamped to the same legal window
    //   · no words file            → proportional, and SAY SO once. The take
    //                                predates the feature or the account has no
    //                                timestamps endpoint; not an author error.
    //   · words file, no match     → THROW. The author wrote a phrase that is
    //                                not in the line they attached it to, and
    //                                falling back would silently ignore an
    //                                instruction that was given explicitly.
    let revealAt = payoff
      ? Math.min(Math.max(take.dur * 0.30, ENTER_SECS + 0.30), Math.max(ENTER_SECS + 0.30, take.dur - PAYOFF_SECS - 0.9))
      : ENTER_SECS;
    if (payoff && isCard && v.revealOn) {
      const wordsFile = String(take.file).replace(/\.mp3$/, ".words.json");
      if (!existsSync(wordsFile)) {
        if (!warnedNoWordTimings) {
          console.log("  word timings unavailable — revealOn anchors fall back to proportional timing");
          warnedNoWordTimings = true;
        }
      } else {
        const at = findAnchor(JSON.parse(readFileSync(wordsFile, "utf8")), v.revealOn);
        if (at == null) {
          throw new Error(
            `beat ${id}: revealOn ${JSON.stringify(v.revealOn)} does not occur in that beat's narration:\n` +
            `  "${take.text}"\n` +
            `An anchor names words the beat actually says. Fix the phrase or drop revealOn.`);
        }
        revealAt = clampReveal(at, take.dur, ENTER_SECS, PAYOFF_SECS);
      }
    }
    const animEnd = revealAt + (payoff ? PAYOFF_SECS : 0) + 0.35;

    // Extend the shot if the card cannot be read in the time it is fully formed.
    // The narration ends and the card simply holds a moment — which is the beat
    // a viewer needs to connect the words to the picture.
    if (isCard) {
      const formedAt = revealAt + (payoff ? PAYOFF_SECS : 0);
      const insDur = (INSERTS[id] || []).reduce((a, x) => a + x.dur, 0);
      const readable = seconds - formedAt - insDur;
      const needed = Math.max(1.4, cardWords(v) / READ_WPS);
      if (readable < needed) {
        const add = Math.min(MAX_HOLD, +(needed - readable).toFixed(2));
        seconds = +(seconds + add).toFixed(3);
        held.push({ id, add, words: cardWords(v) });
      }
    }

    const mkCard = (secs, aStart, first) => ({
      ...base, kind: "card", dir: P(`out/anim/${id}`), seconds: secs,
      audioStart: aStart, revealAt: first ? revealAt : 0.04,
      payoff: first && payoff, frozen: !first, hadPayoff: payoff,
    });

    if (ins) {
      const insSrc = ins.photo ? P(`out/photos/${ins.photo}.png`) : P(`out/footage/${ins.footage}.mp4`);
      let cut = seconds * ins.at;
      if (isCard) cut = Math.max(cut, animEnd);
      cut = Math.min(cut, seconds - ins.dur - MIN_PIECE);
      const after = +(seconds - cut - ins.dur).toFixed(3);
      // BOTH fragments are tested, WITH float slack, and the whole beat is
      // played un-split if either fails. The old code pushed the head and the
      // insert, then dropped the tail whenever `after < MIN_PIECE` — and the
      // clamp above lands `after` exactly ON MIN_PIECE, which in floating point
      // is 1.0999999. Two beats silently lost 0.72s each, so their narration
      // ran past their own visuals and overlapped the next card. Pieces must
      // always sum to `seconds`.
      if (cut >= MIN_PIECE - PIECE_EPS && after >= MIN_PIECE - PIECE_EPS) {
        if (isCard) {
          push(mkCard(cut, 0, true));
        } else {
          push(mainFrag({ seconds: cut, audioStart: 0 }));
        }
        push({
          beat: id, kind: "still", text: null, audio: take.file, audioStart: cut,
          seconds: ins.dur,
          image: ins.photo ? insSrc : null,
          clip: ins.footage ? insSrc : null,
          clipIn: ins.clipIn ?? (ins.footage === "F_CPU" ? 1 : 2),
          grade: ins.footage === "F_CABLES" ? "killblue" : null, crop: null,
          ken: ins.photo ? "in" : null, zoom0: 1.06,
        });
        // FURTHER INSERTS GO INSIDE THE TAIL. A beat used to get exactly one
        // cutaway ([0] was taken and the rest silently dropped), which left
        // long beats with a single cut and made the whole film metronomic —
        // 88 shots with a standard deviation of 1.24s and only 3% under two
        // seconds. Each extra insert splits the remaining tail again.
        let tailStart = cut + ins.dur, tailLeft = after;
        for (const extra of insList.slice(1)) {
          const rel = Math.min(Math.max(tailLeft * extra.at, MIN_PIECE),
                               tailLeft - extra.dur - MIN_PIECE);
          if (!(rel >= MIN_PIECE - PIECE_EPS)) continue;
          const src2 = extra.photo ? P(`out/photos/${extra.photo}.png`) : P(`out/footage/${extra.footage}.mp4`);
          if (isCard) push(mkCard(+rel.toFixed(3), tailStart, false));
          else push(mainFrag({ seconds: +rel.toFixed(3), audioStart: tailStart, zoom0: 1.06, ken: "in" }));
          push({ beat: id, kind: "still", text: null, audio: take.file,
                 audioStart: tailStart + rel, seconds: extra.dur,
                 image: extra.photo ? src2 : null, clip: extra.footage ? src2 : null,
                 clipIn: extra.clipIn ?? 3, grade: null, crop: null,
                 ken: extra.photo ? "in" : null, zoom0: 1.06 });
          tailStart += rel + extra.dur;
          tailLeft = +(tailLeft - rel - extra.dur).toFixed(3);
        }
        if (isCard) push(mkCard(+tailLeft.toFixed(3), tailStart, false));
        else push(mainFrag({ seconds: +tailLeft.toFixed(3), audioStart: tailStart, zoom0: 1.08, ken: "in" }));
        if (id === TITLE_SEGMENT.after) push({ kind: "title", beat: "title", seconds: TITLE_SEGMENT.seconds, text: null });
        continue;
      }
    }

    // No insert. Long photo beats still split: wide shot, then a punch-in.
    if (!isCard && !fo && seconds >= 6.5) {
      const a = +(seconds * 0.55).toFixed(3), b = +(seconds - a).toFixed(3);
      push(mainFrag({ seconds: a, audioStart: 0, ken: "out" }));
      push(mainFrag({ seconds: b, audioStart: a, ken: "in", zoom0: 1.10 }));
    } else if (isCard && seconds >= CARD_SPLIT) {
      // A LONG CARD IS STILL A STATIC FRAME. Cards animate in and then sit —
      // so a beat with 12 seconds of narration puts an unmoving image on screen
      // for nine of them. Ebola film beats ran 10-12.6s and the rhythm gates
      // failed at a 6.95s median with only 5% of shots under 2s.
      //
      // Split it: the card animates and completes in the first piece, then the
      // FINISHED card is held in a second piece with a slow push. Same
      // information, same reading time, but a cut and some motion where there
      // was a freeze. Uses the frozen-card path the insert logic already
      // relies on, so nothing new is being invented here.
      const a = +(seconds * 0.52).toFixed(3), b = +(seconds - a).toFixed(3);
      push(mkCard(a, 0, true));
      push({ ...mkCard(b, a, false), ken: "in", zoom0: 1.05 });
    } else if (isCard) {
      push(mkCard(seconds, 0, true));
    } else {
      push(mainFrag({ seconds, audioStart: 0 }));
    }

    if (id === TITLE_SEGMENT.after) {
      push({ kind: "title", beat: "title", seconds: TITLE_SEGMENT.seconds, text: null });
    }
  }
  push({
    kind: "card", beat: "outro", dir: P("out/anim/outro"), seconds: +(6.11 + OUTRO_TAIL).toFixed(3),
    audio: P("out/audio/outro.mp3"), audioStart: 0, revealAt: ENTER_SECS, payoff: false,
    text: "Scoopfeeds. Subscribe for the next one, or read the full sourced dossier at scoopfeeds.com.",
  });

  // ── 3. segments ─────────────────────────────────────────────────────────
  const t1 = Date.now(); let done = 0;
  await pool(plan, 5, async (p) => {
    if (p.kind === "card") await shotCard(p);
    else if (p.kind === "title") {
      await shotCard({ ...p, dir: P("out/anim/title"), audio: null, audioStart: 0, revealAt: ENTER_SECS, payoff: false, silent: true });
    } else await shotStill(p);
    if (++done % 25 === 0) process.stdout.write(`  ${done}/${plan.length}\n`);
  });
  if (held.length) console.log(`readability holds added to ${held.length} cards (+${held.reduce((a,h)=>a+h.add,0).toFixed(1)}s total)`);
  console.log(`built ${plan.length} shots in ${((Date.now() - t1) / 1000).toFixed(0)}s`);

  // ── 4. concat ───────────────────────────────────────────────────────────
  const listFile = P("out/concat.txt");
  writeFileSync(listFile, plan.map((p) => `file '${p.out}'`).join("\n") + "\n");
  const raw = P("out/_raw.mp4");
  await ff(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", raw]);
  const total = plan.reduce((a, p) => a + p.seconds, 0);

  // ── 5. continuous narration + top and tail ──────────────────────────────
  // Placement uses MEASURED segment durations, not planned seconds: each
  // segment encodes to whole frames, and 80+ roundings drift far enough to
  // desync a take placed by theory. Header durations are ±5ms, non-systematic.
  let cursor = 0;
  const voiced = [];
  for (const p of plan) {
    p.start = cursor;
    p.mdur = await headerDur(p.out);
    cursor += p.mdur;
    if (p.audio && p.audioStart === 0) voiced.push(p);
  }
  const totalV = cursor;
  console.log(`narration: ${voiced.length} takes placed on a single track over ${totalV.toFixed(2)}s of video`);

  const final = P(`out/${SLUG}.mp4`);
  const muxArgs = ["-i", raw];
  for (const p of voiced) muxArgs.push("-i", p.audio);
  const alines = voiced.map((p, i) => {
    const ms = Math.round((p.start + (p.audioLead || 0)) * 1000);
    return `[${i + 1}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${ms}|${ms}[a${i}]`;
  });
  const agraph = alines.join(";") + ";"
    + voiced.map((_, i) => `[a${i}]`).join("")
    + `amix=inputs=${voiced.length}:duration=longest:dropout_transition=0:normalize=0,`
    + `apad,atrim=duration=${totalV.toFixed(3)},`
    + `afade=t=in:st=0:d=0.8,afade=t=out:st=${(totalV - 2.2).toFixed(2)}:d=2.2,`
    + `loudnorm=I=-14:TP=-1.5:LRA=11[aout];`
    + `[0:v]fade=t=in:st=0:d=${FADE_IN},fade=t=out:st=${(totalV - FADE_OUT).toFixed(2)}:d=${FADE_OUT}[vout]`;
  await ff([...muxArgs, "-filter_complex", agraph,
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
    ...AENC, "-movflags", "+faststart", final]);

  // ── 6. SRT (one cue per beat, at measured starts) ────────────────────────
  let n = 0, srt = "", seen = new Set();
  for (const p of plan) {
    if (p.text && !seen.has(p.beat)) {
      seen.add(p.beat);
      const pieces = plan.filter((q) => q.beat === p.beat);
      const beatLen = pieces.reduce((a, q) => a + q.mdur, 0);
      // Cue starts where the VOICE starts, which on the opening beat is after
      // the lead-in silence. A caption that appears a second before the line is
      // spoken is simply wrong, and shorts.mjs cuts from these timings too.
      const voiceAt = p.start + (p.audioLead || 0);
      srt += `${++n}\n${srtTime(voiceAt)} --> ${srtTime(voiceAt + Math.max(0.8, beatLen - (p.audioLead || 0) - 0.3))}\n${p.text}\n\n`;
    }
  }
  writeFileSync(P(`out/${SLUG}.srt`), srt);

  // THE SHOT LIST IS AN ARTIFACT, NOT A DERIVATION.
  // qc.mjs used to infer shot rhythm from SRT cue spacing, which measures
  // BEATS — a beat holds several shots, so it reported a 7.39s median against a
  // film whose real median shot was 5.34s, and failed a gate the film passed.
  // Emit the plan so nothing downstream has to guess it. Same lesson as the SRT.
  // ── evidence provenance ───────────────────────────────────────────────
  // A rights or authenticity question must be answerable from the project
  // directory without re-deriving anything, so every statement quoted and
  // every registry asset used is appended to LICENSES.md in its existing
  // format. Written BEFORE shots.json so a crash mid-write still leaves the
  // trail for what was already planned.
  if (usedStatements.size || usedAssets.size) {
    const lic = P("out/footage/LICENSES.md");
    mkdirSync(path.dirname(lic), { recursive: true });
    const lines = ["", "## Evidence (#82)", ""];
    if (usedStatements.size) {
      lines.push("### Statements — verbatim, archived at capture time", "");
      for (const s of usedStatements.values()) {
        lines.push(`- **${s.id}** — @${s.handle}${s.name ? ` (${s.name})` : ""}`
          + `${s.createdAt ? `, posted ${String(s.createdAt).slice(0, 10)}` : ""}`
          + ` — archived ${String(s.fetchedAt).slice(0, 10)} — ${s.url}`
          + `${s.parent ? ` — reply to ${s.parent}` : ""}`);
      }
      lines.push("");
    }
    if (usedAssets.size) {
      lines.push("### Imagery — rights-clean registry assets", "");
      lines.push(...licenseLines([...usedAssets.values()]), "");
    }
    writeFileSync(lic, (existsSync(lic) ? readFileSync(lic, "utf8") : "") + lines.join("\n"));
    console.log(`   provenance: ${usedStatements.size} statement(s), ${usedAssets.size} asset(s) → out/footage/LICENSES.md`);
  }

  writeFileSync(P("out/shots.json"), JSON.stringify(
    plan.map((p) => ({ beat: p.beat, kind: p.kind, seconds: +p.seconds.toFixed(3) })), null, 1));

  // ── 7. report the numbers we are actually trying to move ────────────────
  const lens = plan.map((p) => p.seconds).sort((a, b) => a - b);
  const med = lens[Math.floor(lens.length / 2)];
  const mean = total / lens.length;
  const sd = Math.sqrt(lens.reduce((a, x) => a + (x - mean) ** 2, 0) / lens.length);
  console.log(`\nFINAL: ${final}`);
  console.log(`runtime : ${Math.floor(total / 60)}m${(total % 60).toFixed(1)}s`);
  console.log(`shots   : ${plan.length}   (was 69)`);
  console.log(`median  : ${med.toFixed(2)}s   (was 7.69s · Vox 3.42s)`);
  console.log(`mean    : ${mean.toFixed(2)}s`);
  console.log(`std dev : ${sd.toFixed(2)}s   (was 3.15s · Vox 7.45s)`);
  console.log(`under 2s: ${lens.filter((x) => x < 2).length} (${Math.round(100 * lens.filter((x) => x < 2).length / lens.length)}%)   (was 0% · Vox 21%)`);
  console.log(`TOTAL_SECONDS=${total.toFixed(2)}`);
}

main().catch((e) => { console.error("BUILD FAILED:", e.stack); process.exit(1); });
