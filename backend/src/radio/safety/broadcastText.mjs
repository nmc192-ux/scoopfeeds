#!/usr/bin/env node
/**
 * broadcastText.mjs — the description for the 24/7 stream, which is set by hand in YouTube Studio and X
 * Media Studio (the 24/7 stream is not created through the API). Prints, and writes beside the music:
 *   ~/scoopfeeds-radio/youtube-247-description.txt   the YouTube description: disclosure + every cleared track's credit
 *   ~/scoopfeeds-radio/x-247-broadcast.txt           the X broadcast text
 * Re-run after the music library or its manifest changes (#208, docs/radio/safety.md).
 *
 *   node src/radio/safety/broadcastText.mjs [--music-dir ~/scoopfeeds-radio/music]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { clearedTracks } from "../musicLibrary.js";
import { creditLines } from "../musicManifest.js";
import { withDisclosure, xBroadcastText } from "./disclosure.js";

const HOME = os.homedir();
const tilde = (p) => path.resolve(String(p).replace(/^~/, HOME));
const { values: v } = parseArgs({ options: { "music-dir": { type: "string" } } });
const BASE = tilde(process.env.RADIO_BASE_DIR || "~/scoopfeeds-radio");
const dir = tilde(v["music-dir"] || process.env.RADIO_MUSIC_DIR || path.join(BASE, "music"));

const credits = creditLines(clearedTracks(dir));
const yt = withDisclosure("ScoopFeeds Radio: world news around the clock, compared across outlets. Every newsroom, one stream. https://scoopfeeds.com", credits);
const x = xBroadcastText({ title: "ScoopFeeds Radio LIVE · The news, compared", credits });
fs.mkdirSync(BASE, { recursive: true });
fs.writeFileSync(path.join(BASE, "youtube-247-description.txt"), yt + "\n");
fs.writeFileSync(path.join(BASE, "x-247-broadcast.txt"), x + "\n");
console.log(`── YouTube (${credits.length} credited track(s)) ──\n${yt}\n\n── X ──\n${x}`);
