/**
 * beds.js - the music beds an hour (or a developing bulletin, #201) is mixed over: the first CLEARED bed of each
 * daypart (#208), measured once; with no cleared bed, the procedural bed. Moved out of produce.mjs unchanged so
 * bulletin.mjs mixes over exactly the same beds.
 */
import path from "node:path";
import { listBeds, listFiles, bedEntry, DAYPARTS } from "../musicLibrary.js";
import { loadManifest } from "../musicManifest.js";
import { ensureProceduralBed } from "../proceduralBed.js";
import { measureIntegrated } from "../playout/loudness.js";
import { durationSecs } from "./assemble.js";

/** @returns {Promise<{ beds: object, bedFor: (daypart: string) => object }>} throws when there is no bed at all */
export async function loadBeds(musicDir, { log = () => {} } = {}) {
  const manifest = loadManifest(musicDir);
  const beds = {};
  for (const d of DAYPARTS) {
    const f = listBeds(d, musicDir, { manifest, onRefused: (why) => log(`music refused: ${why}`) })[0];
    if (f) beds[d] = { file: f, lufs: (await measureIntegrated(f)) ?? -16, len: durationSecs(f), entry: bedEntry(f, musicDir, manifest) };
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
