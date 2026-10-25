/**
 * musicLibrary.js — choose the music bed for a ScoopFeeds Radio break (R2: selection only, no playback).
 *
 * Beds live in $SCOOP_PERSISTENT_DATA_DIR/radio/music/{morning,markets,evening,overnight}/
 * (on the Mac: ~/scoopfeeds-radio/music/). PROVENANCE GATE (#208): a bed is listed only when
 * <music dir>/manifest.json clears it (musicManifest.js: YouTube Audio Library, Creative Commons
 * attribution, sha256 matching). Anything else, including every AI-generated bed, is refused.
 * With no cleared bed at all, the station falls back to the procedural bed (proceduralBed.js:
 * synthesised by ffmpeg, no AI model, no licence) — never to an unmanifested file. normalizeMusic.mjs writes a
 * loudness-normalised `<name>.norm.mp3` beside each one; when a .norm.mp3 exists it is
 * what gets picked, and its un-normalised original is skipped.
 *
 * DAYPART BY US EASTERN TIME (radio is US-first), computed with Intl in
 * America/New_York, so EST/EDT and both DST changes are handled by the platform's tz data:
 *   05:00–09:30 morning · 09:30–16:00 markets · 16:00–24:00 evening · 00:00–05:00 overnight
 *
 * NEVER THE SAME FILE TWICE IN A ROW: the last pick is remembered (per process, or
 * passed in) and excluded when anything else is available.
 */
import fs from "node:fs";
import path from "node:path";
import { loadManifest, clearBed, screenCredit } from "./musicManifest.js";

export const DAYPARTS = ["morning", "markets", "evening", "overnight"];
const AUDIO = /\.(mp3|m4a|aac|wav|ogg|flac)$/i;

export function musicDir() {
  const base = process.env.SCOOP_PERSISTENT_DATA_DIR || path.resolve("data");
  return path.join(base, "radio", "music");
}

/** Minutes since local midnight in America/New_York for the given instant. */
export function easternMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour").value);
  const m = Number(parts.find((p) => p.type === "minute").value);
  return h * 60 + m;
}

/** "morning" | "markets" | "evening" | "overnight" for the given instant. */
export function daypartAt(date = new Date()) {
  const t = easternMinutes(date);
  if (t >= 5 * 60 && t < 9 * 60 + 30) return "morning";
  if (t >= 9 * 60 + 30 && t < 16 * 60) return "markets";
  if (t >= 16 * 60) return "evening";
  return "overnight";
}

/** Every audio file in a daypart folder: .norm.mp3 when present, else the original. NO provenance check. */
export function listFiles(daypart, dir = musicDir()) {
  let names;
  try { names = fs.readdirSync(path.join(dir, daypart)).filter((n) => AUDIO.test(n) && !n.startsWith(".")); }
  catch { return []; }
  const norm = new Set(names.filter((n) => n.endsWith(".norm.mp3")));
  return names
    .filter((n) => n.endsWith(".norm.mp3") || !norm.has(n.replace(/\.[^.]+$/, "") + ".norm.mp3"))
    .sort()
    .map((n) => path.join(dir, daypart, n));
}

/**
 * The beds that may AIR in a daypart: listFiles() filtered by the manifest. `onRefused(why)` hears each
 * refusal (the playout logs them once). `manifest` is injectable; by default it is read fresh each call.
 */
export function listBeds(daypart, dir = musicDir(), { manifest = loadManifest(dir), onRefused = null } = {}) {
  return listFiles(daypart, dir).filter((f) => {
    const c = clearBed(f, dir, manifest);
    if (!c.ok) onRefused?.(c.why);
    return c.ok;
  });
}

/** The manifest entry behind an airing bed, or null (procedural bed, programme audio, unmanifested). */
export function bedEntry(file, dir = musicDir(), manifest = loadManifest(dir)) {
  if (!file) return null;
  const c = clearBed(file, dir, manifest);
  return c.ok ? c.entry : null;
}

/** "Music: Artist – Track" for an airing bed, or null when it has no credit to show. */
export const bedCredit = (file, dir = musicDir(), manifest) => screenCredit(bedEntry(file, dir, manifest));

/** Every cleared track in the library (all dayparts): what the 24/7 radio may air, for the broadcast credits. */
export function clearedTracks(dir = musicDir(), manifest = loadManifest(dir)) {
  const out = [];
  for (const d of DAYPARTS) for (const f of listBeds(d, dir, { manifest })) { const e = bedEntry(f, dir, manifest); if (e) out.push(e); }
  return out;
}

let lastPick = null;

/**
 * Pick a bed for the instant `now` (any Date; its Eastern time decides the daypart).
 * @param {Date} [now]
 * @param {{ dir?: string, last?: string|null, random?: () => number }} [opts]
 * @returns {string|null} absolute path, or null when the daypart's folder is empty
 */
export function pickBed(now = new Date(), { dir = musicDir(), last = lastPick, random = Math.random } = {}) {
  const beds = listBeds(daypartAt(now), dir);
  if (!beds.length) return null;
  const pool = beds.length > 1 ? beds.filter((b) => b !== last) : beds;
  const pick = pool[Math.floor(random() * pool.length) % pool.length];
  lastPick = pick;
  return pick;
}
