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

export function filmsDir() {
  if (process.env.RADIO_FILMS_DIR) return process.env.RADIO_FILMS_DIR;
  const base = process.env.SCOOP_PERSISTENT_DATA_DIR || path.resolve("data");
  return path.join(base, "radio", "films");
}

/** @returns {{ items: object[], skipped: {file:string, reason:string}[] }} */
export function loadLibrary(dir = filmsDir(), { now = Date.now() } = {}) {
  const items = [];
  const skipped = [];
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
      if (publishedAt > now) { skipped.push({ file, reason: "publishedAt is in the future (not published yet)" }); continue; }
      if (!meta.title) { skipped.push({ file, reason: "sidecar has no title" }); continue; }
      items.push({
        id: `${s.name}/${f.replace(VIDEO, "")}`,
        series: s.name,
        seriesName: SERIES[s.name] || s.name,
        title: String(meta.title),
        durationSec,
        publishedAt,
        file,
        // everything in ScoopFeeds 60 is a Short, whatever its length (YouTube Shorts run to 3 min); a
        // sub-minute clip filed under a film series is a teaser, not a film, and must not take a grid slot
        kind: s.name === SHORTS_SERIES || durationSec <= SHORT_MAX_SEC ? "short" : "film",
      });
    }
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
 * @param {{ file: string, series: string, title: string, publishedAt: string, name?: string, copy?: boolean,
 *           dir?: string, durationSec?: number, probe?: (f: string) => number }} o
 */
export function importFilm({ file, series, title, publishedAt, name, copy = false, dir = filmsDir(), durationSec, probe = probeDurationSec }) {
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
  const sidecar = { title: String(title), publishedAt: new Date(Date.parse(publishedAt)).toISOString(), durationSec: Math.round(measured * 1000) / 1000, source: path.resolve(file) };
  fs.writeFileSync(target.replace(VIDEO, ".json"), JSON.stringify(sidecar, null, 2) + "\n");
  return { target, sidecar };
}
