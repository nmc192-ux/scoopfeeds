#!/usr/bin/env node
/**
 * normalizeMusic.mjs — one-off: loudness-normalise ScoopFeeds Radio music beds.
 *
 * For every audio file under $SCOOP_PERSISTENT_DATA_DIR/radio/music/{morning,markets,evening,overnight}/
 * that is not itself a .norm.mp3, writes `<name>.norm.mp3` beside it with ffmpeg's
 * loudnorm at −16 LUFS integrated, −1.5 dBTP true peak (LRA 11), 48 kHz, 192 kbps.
 * Skips a file whose .norm.mp3 is newer than it. Never touches the original.
 *
 * The host has no ffmpeg — run it in the worker image:
 *   docker run --rm -v scoopfeeds_scoop_data:/var/lib/scoop -e SCOOP_PERSISTENT_DATA_DIR=/var/lib/scoop \
 *     scoopfeeds-worker node /app/backend/src/radio/normalizeMusic.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DAYPARTS, musicDir } from "./musicLibrary.js";

const dry = process.argv.includes("--dry-run");
const AUDIO = /\.(mp3|m4a|aac|wav|ogg|flac)$/i;
const root = musicDir();
let done = 0, skipped = 0, failed = 0;

for (const part of DAYPARTS) {
  const dir = path.join(root, part);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir).filter((n) => AUDIO.test(n) && !n.endsWith(".norm.mp3"))) {
    const src = path.join(dir, name);
    const out = path.join(dir, name.replace(/\.[^.]+$/, "") + ".norm.mp3");
    if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) { skipped++; continue; }
    console.log(`${dry ? "[dry] " : ""}${part}/${name} → ${path.basename(out)}`);
    if (dry) continue;
    const tmp = `${out}.tmp.mp3`;
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src,
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k", tmp],
      { stdio: ["ignore", "inherit", "inherit"] });
    if (r.status === 0) { fs.renameSync(tmp, out); done++; }
    else { fs.rmSync(tmp, { force: true }); failed++; console.error(`  ✖ ffmpeg exit ${r.status} for ${name}`); }
  }
}
console.log(`normalised ${done}, already current ${skipped}, failed ${failed}${dry ? " (dry run)" : ""}`);
process.exit(failed ? 1 : 0);
