/**
 * beds.js - the music beds an hour (or a developing bulletin, #201) is mixed over: the first CLEARED bed of each
 * daypart (#208), measured once; with no cleared bed, the procedural bed. Moved out of produce.mjs unchanged so
 * bulletin.mjs mixes over exactly the same beds.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { listBeds, listFiles, bedEntry, DAYPARTS } from "../musicLibrary.js";
import { loadManifest } from "../musicManifest.js";
import { ensureProceduralBed } from "../proceduralBed.js";
import { measureIntegrated } from "../playout/loudness.js";
import { durationSecs } from "./assemble.js";

/**
 * 1 Nov 2026: a bed is looped under the whole hour, so a track's silent tail (Atlantean Twilight ends in 7.3 s below
 * -50 dB) came round every ~3 minutes as dead air, on air since 25 Oct and refused by the listen-back (#273) from
 * 31 Oct. The loop now runs on a copy with the near-silent start and end removed (below LOOP_TRIM_DB, which sits
 * under the quietest the ducked bed is mixed at), with a short fade at each end so the seam does not click. The
 * credit, the loudness and the manifest entry stay the original file's. Cached per file size + mtime; a copy that
 * cannot be made leaves the original in the loop and says so, and the listen-back still judges the result.
 */
export const LOOP_TRIM_DB = -40;
export function loopCopy(file, musicDir, { log = () => {} } = {}) {
  let st; try { st = fs.statSync(file); } catch { return { file, len: durationSecs(file) }; }
  const dir = path.join(musicDir, ".loop-cache");
  const out = path.join(dir, `${path.basename(file).replace(/\.[^.]+$/, "")}-${st.size}-${Math.round(st.mtimeMs)}.flac`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(dir, { recursive: true });
    const trim = `silenceremove=start_periods=1:start_threshold=${LOOP_TRIM_DB}dB:start_silence=0.05`;
    const af = `${trim},areverse,${trim},afade=t=in:d=0.3,areverse,afade=t=in:d=0.3`;
    const tmp = out + ".tmp.flac";
    const r = spawnSync(process.env.FFMPEG || "ffmpeg", ["-v", "error", "-y", "-i", file, "-vn", "-af", af, "-c:a", "flac", tmp], { encoding: "utf8" });
    if (r.status !== 0 || !fs.existsSync(tmp)) { log(`bed loop: could not trim ${path.basename(file)} (${String(r.stderr || r.error?.message).slice(-200)}); looping the original`); return { file, len: durationSecs(file) }; }
    fs.renameSync(tmp, out);
  }
  const len = durationSecs(out), orig = durationSecs(file);
  if (!(len > 10)) { log(`bed loop: trimmed ${path.basename(file)} is ${len} s; looping the original`); return { file, len: orig }; }
  if (orig - len >= 1) log(`bed loop: ${path.basename(file)} loops on ${len.toFixed(1)} of ${orig.toFixed(1)} s (silent start/end removed)`);
  return { file: out, len };
}

/** @returns {Promise<{ beds: object, bedFor: (daypart: string) => object }>} throws when there is no bed at all */
export async function loadBeds(musicDir, { log = () => {} } = {}) {
  const manifest = loadManifest(musicDir);
  const beds = {};
  for (const d of DAYPARTS) {
    const f = listBeds(d, musicDir, { manifest, onRefused: (why) => log(`music refused: ${why}`) })[0];
    if (f) {
      const loop = loopCopy(f, musicDir, { log });
      beds[d] = { file: f, lufs: (await measureIntegrated(f)) ?? -16, len: loop.len, loopFile: loop.file, entry: bedEntry(f, musicDir, manifest) };
    }
  }
  if (!Object.keys(beds).length) {
    const refused = DAYPARTS.reduce((n, d) => n + listFiles(d, musicDir).length, 0);
    let f; try { f = ensureProceduralBed(musicDir); } catch (e) { throw new Error(`no cleared music bed under ${musicDir} and ${e.message}`); }
    beds.procedural = { file: f, lufs: (await measureIntegrated(f)) ?? -16, len: durationSecs(f), entry: null };
    log(`no cleared music bed (${refused} file(s) without a complete manifest entry): the procedural bed carries the hour`);
  }
  const anyBed = Object.values(beds)[0];
  log(`beds: ${Object.entries(beds).map(([d, b]) => `${d}=${path.basename(b.file)} ${b.lufs} LUFS`).join(", ")}`);
  return { beds, bedFor: (d) => beds[d] || anyBed };
}
