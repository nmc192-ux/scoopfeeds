/**
 * presenters.js - two presenters, one male and one female, on the free local Kokoro voices (#284, wave 1 of #281).
 *
 * Off unless RADIO_DUO is literally "1": with it off nothing here runs and an hour is voiced exactly as before
 * (one voice, VIDEO_TTS_KOKORO_VOICE, on every line).
 *
 * With it on, castSegments() marks who reads each checked line, after checks.js and before assemble.js voices it:
 *   - every segment opens with the lead presenter (A);
 *   - the presenters alternate STORIES within a segment: the first story is A's, the second B's, and so on. A story
 *     is a run of lines with the same `story` id (or, in The News, Compared, the same `outlet`); every other line
 *     (open, close, markets, weather, crypto, projections, ballot lines) is the lead's;
 *   - at most ONE handover line per segment, mechanical, read by A just before B first speaks: "Over to you, <B>."
 *     No chit-chat, no opinion: it is a fixed sentence, not model text;
 *   - the sign-off names both presenters ("I'm <A>." / "And I'm <B>.").
 * Each cast line carries `speaker` ("A" | "B"), `presenter` (the name) and `voice` (the Kokoro voice id);
 * assemble.js passes `voice` to the voicer and the name to programme.json `lines` for the on-screen name tag.
 *
 * Names live in presenters.json (one config file). Voices: RADIO_VOICE_A (default bm_george, the voice the radio
 * has used since October) and RADIO_VOICE_B (default bf_emma). The defaults are UNVERIFIED by ear from the cloud
 * build: pick them on the Mac with presenterSamples.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PRESENTERS_FILE = path.join(HERE, "presenters.json");
export const DEFAULT_VOICE_A = "bm_george";
export const DEFAULT_VOICE_B = "bf_emma";
export const HANDOVER_ID = "handover";

/** RADIO_DUO is on only when it is literally "1". */
export const duoOn = (env = process.env) => String(env.RADIO_DUO ?? "").trim() === "1";

/**
 * The cast, or null when the duo is off. Throws when the config is unusable (a missing name, the same voice twice):
 * a duo that is not two voices must not air as one.
 */
export function loadPresenters(env = process.env, { file = PRESENTERS_FILE } = {}) {
  if (!duoOn(env)) return null;
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  const voiceA = String(env.RADIO_VOICE_A || "").trim() || DEFAULT_VOICE_A;
  const voiceB = String(env.RADIO_VOICE_B || "").trim() || DEFAULT_VOICE_B;
  const cast = {
    A: { key: "A", name: String(cfg?.A?.name || "").trim(), voice: voiceA },
    B: { key: "B", name: String(cfg?.B?.name || "").trim(), voice: voiceB },
  };
  for (const k of ["A", "B"]) if (!cast[k].name) throw new Error(`presenters.json: presenter ${k} has no name`);
  if (cast.A.name === cast.B.name) throw new Error("presenters.json: the two presenters have the same name");
  if (voiceA === voiceB) throw new Error(`RADIO_DUO=1 but RADIO_VOICE_A and RADIO_VOICE_B are the same voice (${voiceA})`);
  return cast;
}

const mark = (l, p) => ({ ...l, speaker: p.key, presenter: p.name, voice: p.voice });
const unitOf = (l) => (l.story ? `s:${l.story}` : l.outlet ? `o:${l.outlet}` : null);

/** Cast one segment's lines (see the header). Pure; the input is not changed. */
export function castLines(lines, cast, { segment = null } = {}) {
  const { A, B } = cast;
  const owner = new Map();
  let units = 0, handedOver = false;
  const out = [];
  for (const l of lines || []) {
    const u = unitOf(l);
    let p = A;
    if (u) {
      if (!owner.has(u)) owner.set(u, units++ % 2 === 0 ? A : B);
      p = owner.get(u);
    }
    if (p === B && !handedOver && out.length) {
      out.push(mark({ id: HANDOVER_ID, story: null, text: `Over to you, ${B.name}.`, mechanical: true }, A));
      handedOver = true;
    }
    out.push(mark(l, p));
  }
  if (segment === "signoff" && out.length) {
    out.push(mark({ id: "name-a", story: null, text: `I'm ${A.name}.`, mechanical: true }, A));
    out.push(mark({ id: "name-b", story: null, text: `And I'm ${B.name}.`, mechanical: true }, B));
  }
  return out;
}

/**
 * Cast every checked segment of the produced slots. With no cast (RADIO_DUO off) it returns `segments` itself,
 * untouched, so the hour is byte-for-byte what it was.
 */
export function castSegments(segments, slots, cast, { log = () => {} } = {}) {
  if (!cast) return segments;
  const bySlot = new Map((slots || []).map((s) => [s.id, s]));
  const out = {};
  let b = 0, handovers = 0;
  for (const [id, seg] of Object.entries(segments || {})) {
    const lines = castLines(seg?.lines || [], cast, { segment: bySlot.get(id)?.segment || null });
    b += lines.filter((l) => l.speaker === "B").length;
    handovers += lines.filter((l) => l.id === HANDOVER_ID).length;
    out[id] = { ...seg, lines };
  }
  log(`presenters: ${cast.A.name} (${cast.A.voice}) and ${cast.B.name} (${cast.B.voice}); ${b} line(s) for ${cast.B.name}, ${handovers} handover(s)`);
  return out;
}

/** The writer's note when two presenters read the hour: casting and handovers are added after it writes. */
export const DUO_WRITER_NOTE = "Two presenters read this hour; who reads each line, and the handover between them, are added for you after you write. Do not write handovers, greetings between presenters, presenter names or banter.";
