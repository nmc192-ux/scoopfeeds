/**
 * mapStore.js — where the election map state lives and the flag that shows it (#204).
 *
 * $SCOOP_PERSISTENT_DATA_DIR/radio/election-map.json, written atomically (same helper
 * as the radio state). Dark behind RADIO_ELECTION_MAP_ENABLED=true (and RADIO_ENABLED,
 * which gates every radio route).
 */
import fs from "node:fs";
import path from "node:path";
import { radioDir, writeJsonAtomic } from "../radioState.js";
import { buildMapState } from "./mapState.js";

export function electionMapEnabled() {
  return String(process.env.RADIO_ELECTION_MAP_ENABLED || "").trim().toLowerCase() === "true";
}

export const mapStatePath = () => path.join(radioDir(), "election-map.json");

export function readMapState(file = mapStatePath()) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/** Build from the pack's items (+ optional counts) and write. Returns the state. */
export function writeMapState(input, file = mapStatePath()) {
  const state = buildMapState(input);
  writeJsonAtomic(file, state);
  return state;
}
