/**
 * shotSound.js — the shot engine's sound (shot-engine brief, Phase 5).
 *
 * THE BED LIBRARY (DrJ, 24 Sep 2026). Eight instrumental beds generated ONCE
 * with ElevenLabs Music — 3 neutral/driving, 3 tense/serious, 2 hopeful —
 * restrained news-documentary underscore, each checked for vocals by
 * speech-to-text. They live under <data>/music-library with a manifest; only
 * beds DrJ has APPROVED and that passed the vocal check are ever used. Within
 * a group the least recently used plays next. The procedural synth bed
 * (videoMusicBed.buildBed) is the fallback when a group has no approved bed.
 *
 * TONE PICKS THE GROUP, from the story itself (headline, summary, captions):
 *   grief  — deaths, disasters, grief: a VERY LOW tense bed, or none; never driving
 *   tense  — conflict, crime, crisis
 *   hopeful — science, recovery, good news
 *   neutral — everything else (the default news bed)
 * Grief is checked first and wins: a story with both a breakthrough and a
 * death count is a grief story.
 */

import path from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import { execFile } from "child_process";
import { logger } from "../logger.js";
import { isExplicitHarmHeadline } from "../editorialSensitivity.js";
import { getFFmpegPath } from "../videoGenerator.js";
import { buildBed, deriveShortArc } from "../videoMusicBed.js";
import { ENGINE_DIR, enginePython } from "./shotVideo.js";

export const GROUPS = Object.freeze(["neutral", "tense", "hopeful"]);

const GRIEF = /\b(dead|deaths?|died|dies|killed|kills?|killing|fatal(?:ities|ity)?|victims?|bodies|body of|funerals?|mourn(?:s|ing|ers)?|grief|grieving|massacre|casualt(?:y|ies)|drown(?:ed|ing)?|earthquake|tsunami|landslide|avalanche|wildfire|hurricane|cyclone|typhoon|flood(?:s|ing|ed)?|disaster|tragedy|missing presumed)\b/i;
const TENSE = /\b(war|wars|conflict|attack(?:s|ed)?|strikes?|missiles?|drones?|troops|military|army|invasion|sanctions?|tariffs?|crackdown|protests?|riots?|coup|crisis|crises|threat(?:s|ens|ened)?|tension|standoff|arrest(?:ed|s)?|charged|indict(?:ed|ment)|convict(?:ed|ion)|fraud|scam|smuggl\w*|traffick\w*|poach\w*|cartel|gang|corruption|scandal|lawsuit|trial|prison|jail|hack(?:ed|ers?)?|breach|espionage|spy|nuclear)\b/i;
const HOPEFUL = /\b(breakthrough|discover(?:y|ed|ies)|scientists?|research(?:ers)?|study finds|vaccine|cure[sd]?|treatment|recover(?:y|ed|ing)|rebuil\w*|restor\w*|record high|milestone|launch(?:ed|es)?|renewable|solar|conservation|rescued|reunited|celebrat\w*|award|wins?|won|peace deal|ceasefire holds)\b/i;

/**
 * The story's tone → { group, level }. `level` is "low" for grief — the bed is
 * cut 10 dB further under the voice and the hits are dropped (mix.py).
 */
export function toneFor(article = {}, spec = {}) {
  const text = [article.title, article.description, ...(spec.slides || []).map((s) => s.caption)].filter(Boolean).join(" \n ");
  if (isExplicitHarmHeadline(article.title || "") || GRIEF.test(text)) return { group: "tense", level: "low", why: "grief" };
  if (TENSE.test(text)) return { group: "tense", level: "normal", why: "tense" };
  if (HOPEFUL.test(text)) return { group: "hopeful", level: "normal", why: "hopeful" };
  return { group: "neutral", level: "normal", why: "neutral" };
}

// ─── The library ─────────────────────────────────────────────────────────────
export const libraryDir = () => path.join(process.env.SCOOP_PERSISTENT_DATA_DIR || path.resolve("data"), "music-library");

export function loadLibrary(dir = libraryDir()) {
  const f = path.join(dir, "manifest.json");
  if (!existsSync(f)) return [];
  try {
    const m = JSON.parse(readFileSync(f, "utf8"));
    // One bad entry drops ITSELF, never the library: a bed with no file used to
    // make path.join throw, and the catch below discarded every bed.
    return (m.beds || []).filter((b) => b && !b.failed && b.approved === true && b.vocalFree === true &&
      typeof b.file === "string" && b.file && existsSync(path.join(dir, b.file)));
  } catch { return []; }
}

function readUsage(dir) {
  try { return JSON.parse(readFileSync(path.join(dir, "usage.json"), "utf8")); } catch { return {}; }
}

/** The least recently used approved bed in the group, or null. Records the use. */
export function pickBed(group, { dir = libraryDir(), now = Date.now(), record = true } = {}) {
  const beds = loadLibrary(dir).filter((b) => b.group === group);
  if (!beds.length) return null;
  const usage = readUsage(dir);
  const pick = [...beds].sort((a, b) => (usage[a.id] || 0) - (usage[b.id] || 0) || a.id.localeCompare(b.id))[0];
  if (record) {
    usage[pick.id] = now;
    try { mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, "usage.json"), JSON.stringify(usage)); } catch { /* rotation is best effort */ }
  }
  return { ...pick, path: path.join(dir, pick.file) };
}

// ─── The mix ─────────────────────────────────────────────────────────────────

function run(bin, args, { timeout = 10 * 60 * 1000, cwd } = {}) {
  return new Promise((res, rej) => execFile(bin, args, { timeout, cwd, maxBuffer: 16 * 1024 * 1024 },
    (e, out, err) => (e ? rej(new Error(`${path.basename(bin)}: ${String(err || e.message).slice(-400)}`)) : res(String(out)))));
}

/** Integrated loudness and TRUE peak (ebur128, 4x oversampled) of a file. */
export async function measure(file) {
  const out = await run("sh", ["-c", `"${getFFmpegPath()}" -hide_banner -nostats -i "${file}" -af ebur128=peak=true -f null - 2>&1 || true`]);
  const s = out.slice(out.lastIndexOf("Summary"));
  return { I: Number(/I:\s*(-?[\d.]+)/.exec(s)?.[1]), TP: Number(/Peak:\s*(-?[\d.]+)/.exec(s)?.[1]) };
}

/**
 * Score a silent video: bed (library or synth), ducking, SFX, -14 LUFS / TP -2,
 * then AAC — and re-measured AFTER the encode, because that is where the bar is
 * (-14 +/-1 LUFS, true peak <= -1 dBTP). Returns { path, sound }.
 */
export async function scoreShotVideo({ silent, narration, total, cuts, slides, starts, article, spec, out, work, bedEnabled = true }) {
  const tone = toneFor(article, spec);
  let bed = null, bedSource = "none";
  if (bedEnabled && tone.level !== "none") {
    const lib = pickBed(tone.group);
    if (lib) { bed = lib.path; bedSource = `library:${lib.id}`; }
    else {
      try {
        const synth = path.join(work, "synth-bed.wav");
        const { arc, sections, phases } = deriveShortArc(slides, starts, total);
        await buildBed(total, synth, { arc, sections, phases, ffmpegPath: getFFmpegPath() });
        if (existsSync(synth) && statSync(synth).size > 10_000) { bed = synth; bedSource = "synth-fallback"; }
      } catch (err) { logger.warn(`🎵 synth bed failed — scoring without a bed: ${String(err.message).slice(0, 120)}`); }
    }
  }
  const mixWav = path.join(work, "mix.wav");
  const cfg = path.join(work, "mix.json");
  writeFileSync(cfg, JSON.stringify({ narration, bed, bed_level: tone.level, cuts, total, out: mixWav }));
  const first = JSON.parse((await run("nice", ["-n", "10", enginePython(), path.join(ENGINE_DIR, "mix.py"), cfg], { cwd: ENGINE_DIR })).trim().split("\n").pop());

  const ff = getFFmpegPath();
  const encode = (gainDb) => run(ff, ["-v", "error", "-y", "-i", silent, "-i", mixWav, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
    ...(gainDb ? ["-af", `volume=${gainDb.toFixed(2)}dB`] : []), "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-shortest", "-movflags", "+faststart", out]);
  await encode(0);
  let m = await measure(out);
  // AAC can overshoot the true peak it was handed. If it lands above -1 dBTP,
  // pull the whole mix down by the overshoot plus a margin and encode once more.
  let trim = 0;
  if (Number.isFinite(m.TP) && m.TP > -1.0) {
    trim = -(m.TP + 1.3);
    await encode(trim);
    m = await measure(out);
  }
  const sound = { tone: tone.why, group: tone.group, level: tone.level, bed: bedSource, firstPass: first, after_aac: m, trimDb: +trim.toFixed(2),
    meetsBar: Math.abs(m.I + 14) <= 1 && m.TP <= -1 };
  logger.info(`🎵 shot sound [${article.id}]: ${tone.why} → ${bedSource}${tone.level === "low" ? " (very low)" : ""} · ` +
    `${m.I} LUFS · TP ${m.TP} dBTP after AAC${trim ? ` (trimmed ${trim.toFixed(1)} dB)` : ""} · ${sound.meetsBar ? "meets" : "MISSES"} the bar`);
  return { path: out, sound };
}
