#!/usr/bin/env node
/**
 * broadcastText.mjs — the copy for the 24/7 stream, which is set by hand in YouTube Studio and X Media Studio
 * (the 24/7 stream is not created through the API). Prints, and writes beside the music:
 *   ~/scoopfeeds-radio/youtube-247-description.txt   the YouTube description
 *   ~/scoopfeeds-radio/x-247-broadcast.txt           the X broadcast text
 * and, with --site-page, the full credits page (every cleared track's verbatim credit) for scoopfeeds.com.
 * Re-run after the music library or its manifest changes (#208, docs/radio/music.md).
 *
 * Credits are never cut (DrJ, 25 Oct 2026). With RADIO_MUSIC_CREDITS_URL set, the 24/7 description and the X
 * text carry a short "Music credits: <link>" line; without it they list every credit, and if that does not fit
 * the script exits 1 instead of writing a truncated attribution.
 *
 *   node src/radio/safety/broadcastText.mjs [--music-dir ~/scoopfeeds-radio/music]
 *        [--site-page ../frontend/public/radio/music-credits.html]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { clearedTracks } from "../musicLibrary.js";
import { creditLines } from "../musicManifest.js";
import { withCredits, xBroadcastText } from "./broadcastCopy.js";
import { creditsPageHtml } from "./creditsPage.js";

const HOME = os.homedir();
const tilde = (p) => path.resolve(String(p).replace(/^~/, HOME));
const { values: v } = parseArgs({ options: { "music-dir": { type: "string" }, "site-page": { type: "string" } } });
const BASE = tilde(process.env.RADIO_BASE_DIR || "~/scoopfeeds-radio");
const dir = tilde(v["music-dir"] || process.env.RADIO_MUSIC_DIR || path.join(BASE, "music"));
const creditsUrl = String(process.env.RADIO_MUSIC_CREDITS_URL || "").trim() || null;

const tracks = clearedTracks(dir);
const credits = creditLines(tracks);

if (v["site-page"]) {
  const page = tilde(v["site-page"]);
  fs.mkdirSync(path.dirname(page), { recursive: true });
  fs.writeFileSync(page, creditsPageHtml(tracks));
  console.log(`── credits page: ${page} (${credits.length} track(s)) ──`);
}

let yt, x;
try {
  // 24/7: with a credits page, the link alone (the library grows); without one, every credit or nothing
  const listAll = !creditsUrl;
  yt = withCredits("ScoopFeeds Radio: world news around the clock, compared across outlets. Every newsroom, one stream. https://scoopfeeds.com", credits, { creditsUrl, listAll });
  x = xBroadcastText({ title: "ScoopFeeds Radio LIVE · The news, compared", credits, creditsUrl, listAll });
} catch (e) {
  console.error(`${e.message}\nGenerate the credits page (--site-page), publish it, and set RADIO_MUSIC_CREDITS_URL to its address.`);
  process.exit(1);
}
fs.mkdirSync(BASE, { recursive: true });
fs.writeFileSync(path.join(BASE, "youtube-247-description.txt"), yt + "\n");
fs.writeFileSync(path.join(BASE, "x-247-broadcast.txt"), x + "\n");
console.log(`── YouTube (${credits.length} credited track(s), ${yt.length} chars) ──\n${yt}\n\n── X (${x.length} chars) ──\n${x}`);
