/**
 * musicTestLibrary.js — test support: a temporary music library whose files carry complete, matching
 * manifest entries (#208), so tests exercise the real provenance gate instead of bypassing it.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MANIFEST_FILE } from "./musicManifest.js";

export function ccEntry(rel, body, over = {}) {
  const name = path.basename(rel).replace(/\.[^.]+$/, "");
  return {
    file: rel, title: `Track ${name}`, artist: `Artist ${name}`, licence: "Creative Commons Attribution 4.0",
    credit: `Track ${name} by Artist ${name} is licensed under a Creative Commons Attribution 4.0 licence. https://creativecommons.org/licenses/by/4.0/`,
    downloaded: "2026-10-24", sha256: crypto.createHash("sha256").update(body).digest("hex"), source: "YouTube Audio Library", ...over,
  };
}

/**
 * @param {Record<string, string[]>} files  daypart -> file names
 * @param {{ manifest?: boolean, entry?: (rel:string, body:string) => object|null, prefix?: string }} o
 *   manifest:false writes no manifest; entry() may override or return null to leave a file unmanifested.
 */
export function makeMusicLibrary(files, { manifest = true, entry = null, prefix = "radio-music-" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const tracks = [];
  for (const [part, names] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, part), { recursive: true });
    for (const n of names) {
      const body = `audio ${part}/${n}`;
      fs.writeFileSync(path.join(dir, part, n), body);
      if (n.endsWith(".norm.mp3")) continue;   // a loudness copy airs under its original's entry
      const rel = `${part}/${n}`;
      const e = entry ? entry(rel, body) : ccEntry(rel, body);
      if (e) tracks.push(e);
    }
  }
  if (manifest) fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify({ tracks }, null, 1));
  return dir;
}
