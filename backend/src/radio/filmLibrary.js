/**
 * filmLibrary.js — catalogue of published ScoopFeeds films, episodes and Shorts for the radio
 * channel (#203). Selection only: nothing here plays anything, and nothing re-enables the
 * automated Shorts loop. It lists files that are already published.
 *
 * Layout under $RADIO_FILMS_DIR (default $SCOOP_PERSISTENT_DATA_DIR/radio/films), one folder per
 * series, one sidecar per video:
 *
 *   a-eye/ep03.mp4  +  a-eye/ep03.json   { "title", "publishedAt", "durationSec" }
 *
 * A Short carries the library id of the long-form film it was cut from (#216, DrJ 23 Oct 2026):
 *
 *   a-eye/ep03-short1.mp4  +  .json   { "title", "publishedAt", "durationSec", "parentFilm": "a-eye/ep03" }
 *
 * Until the ScoopFeeds 60 question is resolved, ONLY Shorts cut from a published long-form film may air:
 *  - everything in scoopfeeds-60 is skipped unless RADIO_ALLOW_SF60 is literally "1" (default off; lifting it
 *    is DrJ's call);
 *  - any other Short (a parentFilm sidecar, or anything of SHORT_MAX_SEC or less) airs only when its parentFilm
 *    names a film that is itself in the library and published. No link, or a parent that is missing or not
 *    published yet, is skipped with the reason. Length alone never makes a video eligible.
 *
 * The sidecar is written by the publish step (or by hand). A video with no sidecar, no
 * duration, or no parseable publish date is REPORTED as skipped, never guessed at: an unknown
 * length would break the grid. A sidecar whose publishedAt is in the future (a scheduled upload
 * that has not gone out yet) is skipped too: the channel plays only what is already published.
 *
 * importFilm() writes that layout from a publish folder: it links (or copies) the finished video
 * into the series folder and writes the sidecar, with the duration MEASURED by ffprobe, never
 * typed in. The channel's own uploads are imported the same way once their files are local.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const SERIES = Object.freeze({
  "a-eye": "A-Eye",
  "the-invisible-hand": "The Invisible Hand",
  "the-record": "The Record",
  "the-body-politic": "The Body Politic",
  "people": "People",
  "peace-and-war": "Peace & War",
  "scoopfeeds-60": "ScoopFeeds 60",
});
export const SHORTS_SERIES = "scoopfeeds-60";
export const SHORT_MAX_SEC = 60;
const VIDEO = /\.(mp4|mov|mkv|m4v)$/i;
const PARENT_ID = /^[a-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** RADIO_ALLOW_SF60: ScoopFeeds 60 airs only when this is literally "1" (#216). Default off. */
export function allowSf60(env = process.env) {
  return env.RADIO_ALLOW_SF60 === "1";
}

/**
 * Why a Short may not air, or null when it may (#216). `filmIds` are the published films in the library;
 * `unpublished` the ids skipped because their publishedAt is still in the future.
 */
export function shortIneligibility(item, { filmIds, unpublished = new Set(), env = process.env }) {
  if (item.series === SHORTS_SERIES) {
    return allowSf60(env) ? null : "ScoopFeeds 60 may not air until DrJ lifts it (RADIO_ALLOW_SF60 is not 1; #216)";
  }
  if (!item.parentFilm) return "Short has no parentFilm link; only Shorts cut from a published long-form film may air (#216)";
  if (unpublished.has(item.parentFilm)) return `parent film ${item.parentFilm} is not published yet`;
  if (!filmIds.has(item.parentFilm)) return `parent film ${item.parentFilm} is not a film in the library`;
  return null;
}

export function filmsDir() {
  if (process.env.RADIO_FILMS_DIR) return process.env.RADIO_FILMS_DIR;
  const base = process.env.SCOOP_PERSISTENT_DATA_DIR || path.resolve("data");
  return path.join(base, "radio", "films");
}

/** @returns {{ items: object[], skipped: {file:string, reason:string}[] }} */
export function loadLibrary(dir = filmsDir(), { now = Date.now(), env = process.env } = {}) {
  const items = [];
  const skipped = [];
  const unpublished = new Set();
  let series;
  try { series = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()); }
  catch { return { items, skipped }; }

  for (const s of series) {
    let files;
    try { files = fs.readdirSync(path.join(dir, s.name)).filter((n) => VIDEO.test(n) && !n.startsWith(".")); }
    catch { continue; }
    for (const f of files.sort()) {
      const file = path.join(dir, s.name, f);
      const sidecar = file.replace(VIDEO, ".json");
      let meta;
      try { meta = JSON.parse(fs.readFileSync(sidecar, "utf8")); }
      catch { skipped.push({ file, reason: "no readable sidecar json" }); continue; }
      const durationSec = Number(meta.durationSec);
      const publishedAt = Date.parse(meta.publishedAt);
      if (!(durationSec > 0)) { skipped.push({ file, reason: "sidecar has no durationSec" }); continue; }
      if (!Number.isFinite(publishedAt)) { skipped.push({ file, reason: "sidecar has no valid publishedAt" }); continue; }
      if (publishedAt > now) { unpublished.add(`${s.name}/${f.replace(VIDEO, "")}`); skipped.push({ file, reason: "publishedAt is in the future (not published yet)" }); continue; }
      if (!meta.title) { skipped.push({ file, reason: "sidecar has no title" }); continue; }
      items.push({
        id: `${s.name}/${f.replace(VIDEO, "")}`,
        series: s.name,
        seriesName: SERIES[s.name] || s.name,
        title: String(meta.title),
        durationSec,
        publishedAt,
        file,
        ...(meta.parentFilm ? { parentFilm: String(meta.parentFilm) } : {}),
        // everything in ScoopFeeds 60 is a Short, whatever its length (YouTube Shorts run to 3 min); so is
        // anything with a parentFilm link; a sub-minute clip filed under a film series is a Short too, never
        // a film, and must not take a grid slot
        kind: s.name === SHORTS_SERIES || meta.parentFilm || durationSec <= SHORT_MAX_SEC ? "short" : "film",
      });
    }
  }
  // #216: a Short stays in the library only if it may air; the rest are reported with the reason
  const filmIds = new Set(items.filter((i) => i.kind === "film").map((i) => i.id));
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind !== "short") continue;
    const reason = shortIneligibility(items[i], { filmIds, unpublished, env });
    if (reason) { skipped.push({ file: items[i].file, reason }); items.splice(i, 1); }
  }
  items.sort((a, b) => b.publishedAt - a.publishedAt || a.id.localeCompare(b.id));
  return { items, skipped };
}

/** Duration in seconds of a media file, measured by ffprobe. Throws if it cannot be measured. */
export function probeDurationSec(file, { ffprobe = process.env.FFPROBE_PATH || "ffprobe", exec = execFileSync } = {}) {
  const out = exec(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  const sec = Number(String(out).trim());
  if (!(sec > 0)) throw new Error(`ffprobe could not measure a duration for ${file}`);
  return sec;
}

/**
 * Add one published video to the library: <dir>/<series>/<name>.<ext> + <name>.json.
 * A Short cut from a long-form film passes `parentFilm` (the film's library id, e.g. "a-eye/ep03").
 * @param {{ file: string, series: string, title: string, publishedAt: string, name?: string, copy?: boolean, parentFilm?: string,
 *           dir?: string, durationSec?: number, probe?: (f: string) => number }} o
 */
export function importFilm({ file, series, title, publishedAt, name, copy = false, dir = filmsDir(), durationSec, probe = probeDurationSec, parentFilm }) {
  if (parentFilm != null && !PARENT_ID.test(String(parentFilm))) throw new Error(`parentFilm "${parentFilm}" is not a library id like a-eye/ep03`);
  if (parentFilm != null && series === SHORTS_SERIES) throw new Error("a Short cut from a long-form film is filed under that film's series, not scoopfeeds-60");
  if (!SERIES[series]) throw new Error(`unknown series "${series}" (one of: ${Object.keys(SERIES).join(", ")})`);
  if (!title) throw new Error("title is required");
  if (!Number.isFinite(Date.parse(publishedAt))) throw new Error(`publishedAt "${publishedAt}" is not a date`);
  if (!VIDEO.test(file) || !fs.existsSync(file)) throw new Error(`not a video file: ${file}`);
  const measured = durationSec ?? probe(file);
  const base = (name || path.basename(file).replace(VIDEO, "")).replace(/[^a-z0-9._-]+/gi, "-");
  const ext = path.extname(file).toLowerCase();
  const target = path.join(dir, series, base + ext);
  // re-importing a file from its own library slot would delete it below before linking/copying it
  if (path.resolve(file) === path.resolve(target)) throw new Error(`${file} is already the library copy; import from the publish folder`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { force: true });
  if (copy) fs.copyFileSync(file, target); else fs.symlinkSync(path.resolve(file), target);
  const sidecar = { title: String(title), publishedAt: new Date(Date.parse(publishedAt)).toISOString(), durationSec: Math.round(measured * 1000) / 1000, source: path.resolve(file),
    ...(parentFilm != null ? { parentFilm: String(parentFilm) } : {}) };
  fs.writeFileSync(target.replace(VIDEO, ".json"), JSON.stringify(sidecar, null, 2) + "\n");
  return { target, sidecar };
}

/**
 * The Short for the hourly programme's film slot (#216). `p` is RADIO_AUTOAIR_FILM / --film: a file, or a
 * folder. Only a video that is an eligible Short in the film library may fill the slot; for a folder, the
 * newest eligible one in it. Anything else returns { item: null, reason } and the slot is filled by the
 * normal programme. Library files are symlinks to the publish folder, so both sides are compared by realpath.
 * @returns {{ item: object|null, reason: string|null }}
 */
export function resolveHourShort(p, { dir = filmsDir(), now = Date.now(), env = process.env } = {}) {
  if (!p) return { item: null, reason: "no film given" };
  if (!fs.existsSync(p)) return { item: null, reason: `${p} does not exist` };
  const real = (f) => { try { return fs.realpathSync(f); } catch { return path.resolve(f); } };
  const lib = loadLibrary(dir, { now, env });
  const shorts = new Map(lib.items.filter((i) => i.kind === "short").map((i) => [real(i.file), i]));
  const skippedBy = new Map(lib.skipped.map((s) => [real(s.file), s.reason]));
  const candidates = fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).filter((n) => VIDEO.test(n) && !n.startsWith(".")).map((n) => path.join(p, n))
    : [p];
  const ok = candidates.map((f) => shorts.get(real(f))).filter(Boolean).sort((a, b) => b.publishedAt - a.publishedAt || a.id.localeCompare(b.id));
  if (ok.length) return { item: ok[0], reason: null };
  if (candidates.length === 1) {
    const f = real(candidates[0]);
    const why = skippedBy.get(f) || (lib.items.some((i) => real(i.file) === f) ? "it is a full film, not a Short" : `not in the film library (${dir}); import it with filmCli.mjs import --parent <film id>`);
    return { item: null, reason: `${path.basename(candidates[0])}: ${why}` };
  }
  return { item: null, reason: `no eligible Short among ${candidates.length} video(s) in ${p}` };
}
