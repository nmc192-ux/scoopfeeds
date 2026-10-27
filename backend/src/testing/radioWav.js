/**
 * Synthetic programme audio for radio tests (#273): WAVs with the same 44-byte header as assemble.js's WavWriter,
 * and a programme hour whose part actually sounds like a mixed hour to the listen-back (bed at full level in music
 * slots, ducked 18 dB under voiced lines in spoken slots, the endcard fading to silence at the end).
 *
 * Levels are square waves (+A, -A, ...), so a window's RMS is exactly A. A low sample rate (200 Hz by default for a
 * whole hour) keeps a 75-minute part at ~3.6 MB; the listen-back reads the rate from the header like any other WAV.
 */
import fs from "node:fs";
import path from "node:path";
import { buildClock } from "../radio/programme/clock.js";

export const amp = (db) => Math.round(32768 * Math.pow(10, db / 20));

/** Write interleaved 16-bit frames with WavWriter's header. `bits` only changes what the header claims. */
export function writeWav(file, samples, { rate = 44100, channels = 2, bits = 16 } = {}) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * (bits / 8), 28); h.writeUInt16LE(channels * (bits / 8), 32); h.writeUInt16LE(bits, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
  return file;
}

/**
 * Render [from, to) of a programme (epoch ms) as stereo 16-bit samples.
 * @param {object} o
 * @param {object[]} o.slots  { id, kind, start, end, noBed?, silentFrom? }
 * @param {object[]} o.lines  { slot, at, end }
 * @param {(t:number, a:number, slot:object)=>number} [o.fx]  change the amplitude at time t (faults for tests)
 */
export function renderProgramme({ slots, lines = [], from, to, rate = 44100, bedDb = -16, duckDb = -18, voiceDb = -16, fx = null }) {
  const n = Math.round(((to - from) / 1000) * rate);
  const out = new Int16Array(n * 2);
  const full = amp(bedDb), ducked = amp(bedDb + duckDb), voice = amp(voiceDb);
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  const bySlot = new Map();
  for (const l of lines) { if (!bySlot.has(l.slot)) bySlot.set(l.slot, []); bySlot.get(l.slot).push(l); }
  let si = 0;
  for (let i = 0; i < n; i++) {
    const t = from + (i / rate) * 1000;
    while (si < sorted.length - 1 && t >= sorted[si].end) si++;
    const s = sorted[si];
    let a = 0;
    if (s && t >= s.start && t < s.end) {
      if (s.kind === "spoken" || s.kind === "breaking") {
        a = s.noBed ? 0 : ducked;
        if ((bySlot.get(s.id) || []).some((l) => t >= l.at && t < l.end)) a += voice;
      } else if (s.kind === "endcard") {
        const silentFrom = s.silentFrom ?? (s.end - s.start > 30_000 ? s.end - 30_000 : s.end);
        a = t < silentFrom ? full : 0;
      } else a = full;
      if (fx) a = fx(t, a, s);
    }
    const x = Math.max(-32768, Math.min(32767, i % 2 ? -a : a));
    out[2 * i] = x; out[2 * i + 1] = x;
  }
  return out;
}

/** Lines across a spoken slot: from 3.4 s in (after a sting), `secs` long with `gap` between, ending 1 s before the slot. */
export function linesFor(slot, { secs = 4, gap = 0.9, lead = 3.4 } = {}) {
  const out = [];
  for (let t = slot.start + lead * 1000, k = 1; t + secs * 1000 <= slot.end - 1000; t += (secs + gap) * 1000, k++) out.push({ slot: slot.id, id: `l${k}`, at: t, end: t + secs * 1000 });
  return out;
}

/**
 * A whole produced hour on disk: the clock's slots, line timings for every spoken slot, and one part from the
 * countdown to the end of the endcard. Returns the programme fields to merge into programme.json.
 */
export function writeHourAudio(dir, H, { file = "part-countdown.wav", rate = 200, slots = null, fx = null } = {}) {
  const sl = slots || buildClock(H).map(({ id, kind, start, end, title }) => ({ id, kind, start, end, title: title || null }));
  const lines = sl.filter((s) => s.kind === "spoken").flatMap((s) => linesFor(s));
  const from = sl[0].start, to = sl.at(-1).end;
  writeWav(path.join(dir, file), renderProgramme({ slots: sl, lines, from, to, rate, fx }), { rate });
  return { audio: [{ file, from }], slots: sl, lines, endsAt: to };
}
