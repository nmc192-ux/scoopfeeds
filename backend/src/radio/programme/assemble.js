/**
 * assemble.js - voice the checked lines, lay them out on the clock, mix the programme
 * audio and write the screen's cue sheet.
 *
 * Audio: ONE continuous 44.1 kHz stereo WAV per produced part, starting at its first
 * slot's start. The playout swaps its audio feeder to that file at that moment and reads
 * it in real time, so every sound lands on its second without per-cue switching:
 *   bed      the daypart bed, continuous; full in music blocks, -18 dB under speech,
 *            silent under idents and the film, faded out at the end
 *   voice    each line normalised to -16 LUFS, placed at its computed start
 *   sonic    Signal idents and stings from brand/sonic, at -16 LUFS-ish (-2 dB)
 *   film     the Short's own sound in its slot (a Short cut from a published long-form film, #216)
 * Screen: cues [{ at, scene, data }] with absolute epoch-ms times; the screen plays them
 * by its own clock (see screen/scoopfeeds-radio-programme.html).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storyIndex } from "./factPack.js";
import { boardData, boardPages } from "./electionDesk.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BOARD_PAGE_MIN_SEC = 8;   // #197: shortest time one election-board page stays up
export const SONIC_DIR = path.join(HERE, "../brand/sonic");
export const RATE = 44100;

const GAP_LINE = 0.45, GAP_STORY = 0.9, LEAD_IN = 1.0, LEAD_IN_STING = 3.4, TAIL = 1.0;
const DUCK_DB = -18, SONIC_DB = -2;
const dbToGain = (db) => Math.pow(10, db / 20);

// ─── voice ──────────────────────────────────────────────────────────────────

/** Fake voice for tests and dry runs: a quiet, speech-length tone (words / 2.45 s). */
export function fakeVoice(dir) {
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  return async (text) => {
    const secs = Math.max(1.2, String(text).split(/\s+/).length / 2.45);
    const f = path.join(dir, `fake-${++n}.wav`);
    run(["-f", "lavfi", "-i", `sine=frequency=${180 + (n % 7) * 30}:duration=${secs.toFixed(2)}`, "-af", "volume=-12dB,tremolo=f=4:d=0.7", "-ac", "2", "-ar", String(RATE), f]);
    return { path: f, durationSecs: secs };
  };
}

/** Real voice: the prod Kokoro path (videoVoice.voiceCaption), so pronunciation overrides apply. */
export async function kokoroVoice() {
  const { voiceCaption } = await import("../../services/videoVoice.js");
  return async (text) => { const r = await voiceCaption(text); return { path: r.path, durationSecs: r.durationSecs }; };
}

// ─── layout ─────────────────────────────────────────────────────────────────

/** Place a slot's lines on its timeline; drop story lines from the end until it fits (the closing line is kept). */
export function layoutSlot(slot, lines) {
  let use = lines.slice();
  for (;;) {
    let t = slot.startSec + (slot.sting ? LEAD_IN_STING : LEAD_IN);
    const placed = use.map((l, i) => {
      const at = t; t += l.secs + (i < use.length - 1 ? (l.story && !use[i + 1]?.outlet ? GAP_STORY : GAP_LINE) : 0);
      return { ...l, atSec: at, endSec: at + l.secs };
    });
    if (!placed.length || placed.at(-1).endSec <= slot.endSec - TAIL) return { placed, dropped: lines.length - use.length };
    const closeIdx = use.findIndex((l) => l.id === "close");
    const cut = [...use.keys()].reverse().find((i) => i !== closeIdx && i > 0);
    if (cut == null) return { placed: [], dropped: lines.length };
    use.splice(cut, 1);
  }
}

// ─── ffmpeg helpers ─────────────────────────────────────────────────────────

function run(args, { input } = {}) {
  const r = spawnSync(process.env.FFMPEG || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr).slice(-400)}`);
  return r.stdout;
}

/** Decode any audio to interleaved stereo Float32 at RATE. */
export function decode(file, { ss = 0, t = null, loop = false, af = null } = {}) {
  const args = [];
  if (loop) args.push("-stream_loop", "-1");
  if (ss) args.push("-ss", String(ss));
  args.push("-i", file);
  if (t != null) args.push("-t", String(t));
  if (af) args.push("-af", af);
  args.push("-vn", "-ac", "2", "-ar", String(RATE), "-f", "f32le", "pipe:1");
  const buf = run(args);
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

export function durationSecs(file) {
  const r = spawnSync(process.env.FFPROBE || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  const d = Number(String(r.stdout).trim());
  if (!Number.isFinite(d)) throw new Error(`cannot read duration of ${file}`);
  return d;
}

function addInto(dst, src, atSample, gain = 1) {
  const start = Math.max(0, atSample * 2);
  const n = Math.min(src.length, dst.length - start);
  for (let i = 0; i < n; i++) dst[start + i] += src[i] * gain;
}

class WavWriter {
  constructor(file) { this.file = file; this.fd = fs.openSync(file, "w"); this.bytes = 0; fs.writeSync(this.fd, Buffer.alloc(44)); }
  write(f32) {
    const b = Buffer.alloc(f32.length * 2);
    for (let i = 0; i < f32.length; i++) {
      let x = f32[i]; const a = Math.abs(x);
      if (a > 0.89) x = Math.sign(x) * (0.89 + 0.11 * Math.tanh((a - 0.89) / 0.11));   // soft limit above -1 dBFS
      b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x * 32767))), i * 2);
    }
    fs.writeSync(this.fd, b); this.bytes += b.length;
  }
  close() {
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + this.bytes, 4); h.write("WAVE", 8); h.write("fmt ", 12);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(RATE, 24);
    h.writeUInt32LE(RATE * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(this.bytes, 40);
    fs.writeSync(this.fd, h, 0, 44, 0); fs.closeSync(this.fd);
  }
}

// ─── the build ──────────────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {object[]} o.slots      clock slots to produce (contiguous)
 * @param {object} o.segments     checked segments by slot id
 * @param {object} o.pack         fact pack
 * @param {number} o.hourStart    epoch ms of H
 * @param {(daypart:string)=>{file:string,lufs:number}} o.bedFor
 * @param {string|null} o.film    path to an eligible Short (filmLibrary.resolveHourShort) or null
 * @param {Function} o.voice      (text) => {path, durationSecs}
 * @param {string} o.outWav
 */
/**
 * #247: the weather map follows the presenter. Each voiced weather line names a city; the map moves to it when
 * the line starts, in the order the lines are read. A line that names no pack city adds no step; the same city
 * twice in a row is one step.
 * @returns {{ atSec: number, city: string }[]}
 */
export function weatherFocus(lines, cities) {
  const names = (cities || []).map((w) => w.city).filter(Boolean);
  const out = [];
  for (const l of lines || []) {
    const text = String(l.text || "").toLowerCase();
    let best = null, pos = Infinity;
    for (const n of names) { const i = text.indexOf(n.toLowerCase()); if (i >= 0 && (i < pos || (i === pos && n.length > best.length))) { best = n; pos = i; } }
    if (best && out.at(-1)?.city !== best) out.push({ atSec: l.atSec, city: best });
  }
  return out;
}

export async function assemble({ slots, segments, pack, hourStart, bedFor, defaultDaypart = "markets", film = null, filmUrl = "/media/film.mp4", feature = null, featureUrl = "/programme/feature.webm", voice, outWav, log = () => {}, seriesCards = [], creditFor = () => null }) {
  const idx = storyIndex(pack);
  // #208: a music scene carries the airing bed's "Music: Artist – Track" credit (none for the procedural bed)
  const md = (s, extra = {}) => { const c = creditFor(bedFor(s.daypart || defaultDaypart)?.file); return c ? { ...extra, credit: c } : extra; };
  const cues = [];
  const at = (sec) => Math.round(hourStart + sec * 1000);
  const report = { dropped: {}, voicedSecs: 0 };
  const voiced = {};

  // 1 · voice every line, then lay out each spoken slot
  for (const s of slots.filter((x) => x.kind === "spoken")) {
    const lines = [];
    for (const l of segments[s.id]?.lines || []) {
      try { const v = await voice(l.text); lines.push({ ...l, file: v.path, secs: v.durationSecs }); }
      catch (e) { log(`voice failed for ${s.id}/${l.id}: ${e.message}`); }
    }
    const { placed, dropped } = layoutSlot(s, lines);
    if (dropped) report.dropped[s.id] = dropped;
    voiced[s.id] = placed;
    report.voicedSecs += placed.reduce((n, l) => n + l.secs, 0);
  }

  // 2 · cues
  const headline = (id) => idx.get(id)?.headline || "";
  // the first outlet's own summary, verbatim (never model text), credited on screen
  const ledeOf = (id) => { const o = (idx.get(id)?.outlets || []).find((x) => x.description && x.description.length > 40); return o ? { text: o.description.slice(0, 240).replace(/\s+\S*$/, o.description.length > 240 ? "…" : ""), source: o.source } : null; };
  const outletsOf = (id) => (idx.get(id)?.outlets || []).map((o) => o.source);
  for (const s of slots) {
    if (s.sting) cues.push({ at: at(s.startSec), scene: "sting", overlay: true, data: {} });
    const t0 = s.startSec + (s.sting ? 2.6 : 0);
    switch (s.kind) {
      case "countdown": cues.push({ at: at(s.startSec), scene: "countdown", data: { target: hourStart } }); break;
      case "ident": cues.push({ at: at(s.startSec), scene: "ident", data: { mode: s.mode, t0: at(s.startSec) } }); break;
      case "music": cues.push({ at: at(t0), scene: "music", data: md(s, s.nextTitle ? { next: { title: s.nextTitle, at: at(s.nextAt) } } : {}) }); break;
      case "film": cues.push({ at: at(t0), scene: film ? "film" : "music", data: film ? { src: filmUrl, title: s.title, t0: at(s.startSec) } : md(s) }); break;
      case "feature": cues.push({ at: at(s.startSec + 2.6), scene: feature ? "feature" : "music", data: feature ? { src: featureUrl, title: s.title, t0: at(s.startSec + 2.6) } : md(s) }); break;
      case "series": cues.push({ at: at(s.startSec), scene: "series", data: { title: s.title, cards: seriesCards } }); break;
      case "endcard": cues.push({ at: at(s.startSec), scene: "endcard", data: {} }); break;
      case "spoken": {
        const lines = voiced[s.id] || [];
        const seg = segments[s.id] || {};
        if (!lines.length) { cues.push({ at: at(t0), scene: "music", data: md(s) }); break; }   // nothing survived: headlines and music
        const storyLines = lines.filter((l) => l.story && !l.outlet);
        if (s.segment === "markets") { cues.push({ at: at(t0), scene: "markets", data: { title: s.title, rows: pack.markets, asOf: pack.builtAt } }); break; }
        if (s.segment === "crypto") { cues.push({ at: at(t0), scene: "markets", data: { title: s.title, rows: pack.crypto || [], asOf: pack.builtAt, note: "Prices from CoinGecko. 24-hour change." } }); break; }
        if (s.segment === "weather") { cues.push({ at: at(t0), scene: "weather", data: { title: s.title, cities: pack.weather, focus: weatherFocus(lines, pack.weather).map((f) => ({ at: at(f.atSec), city: f.city })) } }); break; }
        if (s.segment === "signoff") { cues.push({ at: at(t0), scene: "signoff", data: {} }); break; }
        if (s.segment === "compared") {
          const picks = (seg.outlets || []).map((src) => idx.get(seg.story)?.outlets.find((o) => o.source === src)).filter(Boolean).slice(0, 4);
          const cards = picks.map((o) => ({ source: o.source, title: o.title }));
          for (const l of lines) {
            if (l.id === "intro") cues.push({ at: at(l.atSec), scene: "compared", data: { title: s.title, headline: headline(seg.story), cards, active: -1 } });
            else if (l.outlet) cues.push({ at: at(l.atSec), scene: "compared", data: { title: s.title, headline: headline(seg.story), cards, active: cards.findIndex((c) => c.source === l.outlet) } });
            else if (["gap", "agree", "watch"].includes(l.id)) cues.push({ at: at(l.atSec), scene: "known", data: { title: s.title, headline: headline(seg.story), label: { gap: "What some leave out", agree: "What every outlet agrees on", watch: "What to watch" }[l.id], text: l.text } });
          }
          if (!cues.some((c) => c.at >= at(s.startSec) && c.scene === "compared")) cues.push({ at: at(t0), scene: "compared", data: { title: s.title, headline: headline(seg.story), cards, active: -1 } });
          break;
        }
        if (s.segment === "midterms") {   // #197: title, ballot cards, story cards, then the board (earn-render: only with an attributed item)
          const board = boardData(pack.election), mark = cues.length;
          cues.push({ at: at(t0), scene: "title", data: { kicker: "ScoopFeeds Radio", title: s.title, items: storyLines.map((l) => headline(l.story)).filter(Boolean) } });
          for (const l of lines.filter((x) => /^b\d+$/.test(x.id || ""))) cues.push({ at: at(l.atSec), scene: "known", data: { kicker: s.title, title: s.title, headline: "What's on the ballot, 3 November", label: "On the ballot", text: l.text } });
          storyLines.forEach((l, i) => cues.push({ at: at(l.atSec), scene: "story", data: { kicker: s.title, n: i + 1, of: storyLines.length, headline: headline(l.story), outlets: outletsOf(l.story).slice(0, 4), lede: ledeOf(l.story) } }));
          if (board) {   // the board is paged (26 px floor): every page gets an equal share from the first projection line to the slot's end
            const first = lines.find((l) => /^p\d+$/.test(l.id || "")) || lines.find((l) => l.id === "close") || lines.at(-1);
            const pages = boardPages(board), end = s.endSec - 1;
            const start = Math.max(t0 + 6, Math.min(first.atSec, end - pages.length * BOARD_PAGE_MIN_SEC));
            const step = (end - start) / pages.length;
            if (step < BOARD_PAGE_MIN_SEC) console.warn(`⚠ election board: ${pages.length} pages get ${step.toFixed(1)} s each (under ${BOARD_PAGE_MIN_SEC} s)`);
            // the board holds the screen to the end of the slot: a story card after it starts would hide a page
            for (let k = cues.length - 1; k >= mark; k--) if (cues[k].at >= at(start)) cues.splice(k, 1);
            pages.forEach((pg, i) => cues.push({ at: at(start + i * step), scene: "election", data: { page: pg, builtAt: board.builtAt } }));
          }
          const lastEnd = lines.at(-1).endSec;
          const nextSlot = slots.slice(slots.indexOf(s) + 1).find((x) => x.title);
          if (!board && s.endSec - lastEnd > 12) cues.push({ at: at(lastEnd + 2), scene: "music", data: nextSlot ? { next: { title: nextSlot.title, at: at(nextSlot.startSec) } } : {} });
          break;
        }
        if (s.segment === "developing") {   // #201: one card, the BREAKING banner, the outlets' own headline and lede
          const id = seg.story || storyLines[0]?.story || lines.find((l) => l.story)?.story;
          cues.push({ at: at(s.startSec), scene: "story", data: { banner: s.banner || "Breaking", kicker: s.title || "Developing story", n: 1, of: 1, headline: headline(id), outlets: outletsOf(id).slice(0, 4), lede: ledeOf(id) } });
          break;
        }
        // the-hour, half, desks: a title card, then one card per story
        cues.push({ at: at(t0), scene: "title", data: { kicker: "ScoopFeeds Radio", title: s.title, items: storyLines.map((l) => headline(l.story)).filter(Boolean) } });
        storyLines.forEach((l, i) => cues.push({ at: at(l.atSec), scene: "story", data: { kicker: s.title, n: i + 1, of: storyLines.length, headline: headline(l.story), outlets: outletsOf(l.story).slice(0, 4), lede: ledeOf(l.story) } }));
        const close = lines.find((l) => l.id === "close");
        const nextSlot = slots.slice(slots.indexOf(s) + 1).find((x) => x.title);
        if (close && nextSlot) cues.push({ at: at(close.atSec), scene: "title", data: { kicker: "Next", title: nextSlot.title, items: [] } });
        // a segment that runs short hands the rest of its slot to headlines and music, never a frozen card
        const lastEnd = lines.at(-1).endSec;
        if (s.endSec - lastEnd > 12) cues.push({ at: at(lastEnd + 2), scene: "music", data: md(s, nextSlot ? { next: { title: nextSlot.title, at: at(nextSlot.startSec) } } : {}) });
      }
    }
  }
  cues.sort((a, b) => a.at - b.at);

  // 3 · audio, slot by slot, into one WAV
  const w = new WavWriter(outWav);
  const bedPos = new Map();
  let prevLevel = 0;
  const sonic = (name) => path.join(SONIC_DIR, name);
  const filmAudio = film ? decode(film, { af: "loudnorm=I=-16:TP=-3:LRA=11" }) : null;
  const featureSlot = slots.find((x) => x.kind === "feature");
  for (const s of slots) {
    const n = Math.round(s.lenSec * RATE);
    const buf = new Float32Array(n * 2);
    const bed = bedFor(s.daypart || defaultDaypart);
    const full = dbToGain(-16 - bed.lufs);
    // #201: a sensitive developing story is read with no music bed under it (`noBed`)
    const level = s.noBed ? 0 : s.kind === "spoken" ? full * dbToGain(DUCK_DB) : (s.kind === "ident" || (s.kind === "film" && film) || (s.kind === "feature" && feature)) ? 0 : full;
    const pos = bedPos.get(bed.file) || 0;
    if (level > 0 || prevLevel > 0) {
      const b = decode(bed.file, { ss: pos % Math.max(1, bed.len - 1), t: s.lenSec, loop: true });
      const ramp = Math.round(0.8 * RATE);
      for (let i = 0; i < n; i++) {
        let g = i < ramp ? prevLevel + (level - prevLevel) * (i / ramp) : level;
        if (s.kind === "endcard") {
          const t = s.startSec + i / RATE;
          if (t >= s.silentFrom) g = 0; else if (t >= s.fadeFrom) g *= (s.silentFrom - t) / (s.silentFrom - s.fadeFrom);
        }
        buf[2 * i] += (b[2 * i] || 0) * g; buf[2 * i + 1] += (b[2 * i + 1] || 0) * g;
      }
    }
    bedPos.set(bed.file, pos + s.lenSec);
    prevLevel = level;
    if (s.kind === "ident") addInto(buf, decode(sonic(s.mode === "top" ? "signal-top.wav" : "signal-id.wav")), 0, dbToGain(SONIC_DB));
    if (s.sting) addInto(buf, decode(sonic("signal-sting.wav")), 0, dbToGain(SONIC_DB));
    if (s.kind === "film" && filmAudio) addInto(buf, filmAudio.subarray(0, n * 2), 0, 1);
    // the feature starts 2.6 s in, after the sting; its sound is decoded for this slot only (a 12-minute episode is ~250 MB as float)
    if (s === featureSlot && feature) addInto(buf, decode(feature, { t: s.lenSec - 2.6, af: "loudnorm=I=-16:TP=-3:LRA=11" }), Math.round(2.6 * RATE), 1);
    for (const l of voiced[s.id] || []) addInto(buf, decode(l.file, { af: "loudnorm=I=-16:TP=-2:LRA=7" }), Math.round((l.atSec - s.startSec) * RATE), 1);
    w.write(buf);
    log(`mixed ${s.id} (${s.kind}, ${s.lenSec} s)`);
  }
  w.close();
  return { cues, report, voiced, lines: placedLines(voiced, hourStart) };
}

/**
 * #273: where every voiced line sits, in epoch ms, for the listen-back (programme.json `lines`). The mix is
 * unchanged; this is only the layout it already used.
 * @returns {{ slot: string, id: string, at: number, end: number }[]}
 */
export function placedLines(voiced, hourStart) {
  return Object.entries(voiced || {}).flatMap(([slot, placed]) => (placed || []).map((l) => ({
    slot, id: l.id ?? null, at: Math.round(hourStart + l.atSec * 1000), end: Math.round(hourStart + l.endSec * 1000),
  })));
}
