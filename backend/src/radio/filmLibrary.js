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
 * length would break the grid.
 */
import fs from "node:fs";
import path from "node:path";

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
export function loadLibrary(dir = filmsDir()) {
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
      if (!meta.title) { skipped.push({ file, reason: "sidecar has no title" }); continue; }
      items.push({
        id: `${s.name}/${f.replace(VIDEO, "")}`,
        series: s.name,
        seriesName: SERIES[s.name] || s.name,
        title: String(meta.title),
        durationSec,
        publishedAt,
        file,
        kind: s.name === SHORTS_SERIES && durationSec <= SHORT_MAX_SEC ? "short" : "film",
      });
    }
  }
  items.sort((a, b) => b.publishedAt - a.publishedAt || a.id.localeCompare(b.id));
  return { items, skipped };
}
