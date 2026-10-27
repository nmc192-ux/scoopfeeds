/**
 * listenBack.js - the pre-air listen-back (#273, newsroom plan Stage 3): before an hour airs, listen to the audio
 * that was actually mixed.
 *
 * Three checks, slot by slot, on the part files programme.json points at:
 *   dead air          a run of windows quieter than -50 dBFS for more than 4 s. The silence the endcard fades into
 *                     at the very end of the programme is exempt (it is meant); nothing else is.
 *   speech over bed   in a spoken slot, the median level inside the voiced lines must be at least 10 dB above the
 *                     median level in the gaps between them (and after the last one), where only the bed plays.
 *                     The lead-in before the first line is not used: the sting and the bed's ramp sit there.
 *                     A no-bed slot (#201 sensitive developing story) passes this by definition.
 *   clipping          more than 100 samples at or past +/-32 600 in a slot, or a peak above -0.1 dBFS anywhere.
 *
 * Anything that cannot be measured is a FAILURE, as everywhere in airCheck: a part that cannot be read, a header
 * that is not 16-bit PCM, a part shorter than the slots it carries, a slot no part covers, a spoken slot without
 * line timings (programme.json `lines`, written by produce.mjs from assemble's placed lines).
 *
 * Mapping a slot to audio: programme.audio is a timeline. Entry i plays its file from `from_i` until the next
 * entry's `from`; the file's sample 0 is at `origin ?? from` (a splice resumes a part mid-file, #195; a repeat cut
 * to music loops a stretch of a music slot, #249). A slot can therefore span several entries; each stretch is read
 * from the right file at the right offset. For an ordinary hour this is "the part with the greatest from <= slot
 * start", as the issue states.
 *
 * Reading: every sample of every slot is read, in 4 MB chunks with fs.readSync (synchronous, so airCheck stays
 * synchronous; a 75-minute part is ~800 MB and is never loaded whole). No sampling and no caps: the measured time
 * for a full 75-minute 44.1 kHz stereo part is recorded on #273.
 * Pure JS, no ffmpeg: the gate runs the same in CI as on the Mac.
 */
import fs from "node:fs";
import path from "node:path";

export const LISTEN_RULES = Object.freeze({
  winSec: 0.1,              // analysis window; fine enough to see the 0.45 s gaps between lines
  silenceDbfs: -50,         // a window below this is silent
  maxSilenceSec: 4,         // dead air: a silent run longer than this
  minSpeechOverBedDb: 10,   // speech median at least this far above the gap (bed) median; the mix aims for ~18 dB
  clipLevel: 32_600,        // |sample| at or above this counts as clipped
  maxClippedSamples: 100,   // per slot
  maxPeakDbfs: -0.1,        // overall
  edgeSec: 0.1,             // margin inside a line or a gap before a window counts as speech or bed
});

const FULL = 32_768;
const CHUNK = 1 << 22;
const FLOOR_DB = -120;

/** RIFF/WAVE header of a 16-bit PCM file: walks the chunks, does not assume 44 bytes. Throws on anything else. */
export function readWavInfo(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(12);
    if (fs.readSync(fd, head, 0, 12, 0) < 12 || head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a RIFF/WAVE file");
    let pos = 12, fmt = null, data = null;
    const ch = Buffer.alloc(8);
    while (pos + 8 <= size && !data) {
      fs.readSync(fd, ch, 0, 8, pos);
      const id = ch.toString("ascii", 0, 4), len = ch.readUInt32LE(4);
      if (id === "fmt ") {
        if (len < 16) throw new Error("fmt chunk too short");
        const f = Buffer.alloc(Math.min(len, 40));
        fs.readSync(fd, f, 0, f.length, pos + 8);
        let format = f.readUInt16LE(0);
        if (format === 0xfffe && f.length >= 26) format = f.readUInt16LE(24);   // WAVE_FORMAT_EXTENSIBLE: the sub-format
        fmt = { format, channels: f.readUInt16LE(2), rate: f.readUInt32LE(4), bits: f.readUInt16LE(14) };
      } else if (id === "data") data = { dataOffset: pos + 8, dataBytes: len };
      pos += 8 + len + (len & 1);
    }
    if (!fmt) throw new Error("no fmt chunk");
    if (fmt.format !== 1) throw new Error(`audio format ${fmt.format} is not PCM`);
    if (fmt.bits !== 16) throw new Error(`${fmt.bits}-bit audio, only 16-bit PCM can be measured`);
    if (!(fmt.channels >= 1) || !(fmt.rate > 0)) throw new Error("bad channel count or sample rate");
    if (!data) throw new Error("no data chunk");
    const have = size - data.dataOffset;
    if (data.dataBytes > have) throw new Error(`truncated: the header says ${data.dataBytes} bytes of audio, the file holds ${have}`);
    return { rate: fmt.rate, channels: fmt.channels, bits: 16, dataOffset: data.dataOffset, dataBytes: data.dataBytes };
  } finally { fs.closeSync(fd); }
}

const toDb = (meanSq) => (meanSq > 0 ? Math.max(FLOOR_DB, 10 * Math.log10(meanSq / (FULL * FULL))) : FLOOR_DB);

/**
 * Levels of [fromSec, toSec) of a 16-bit PCM WAV: per-window RMS dBFS (channels averaged to mono), the peak dBFS of
 * any channel, and how many samples reached `clipLevel`. Reads in chunks; throws when the file is shorter than toSec.
 * @returns {{ windows: number[], winSec: number, peakDbfs: number, clipped: number }}
 */
export function windowStats(file, { fromSec, toSec, winSec = 0.4, clipLevel = LISTEN_RULES.clipLevel, info = null } = {}) {
  const w = info || readWavInfo(file);
  const frameBytes = 2 * w.channels;
  const totalFrames = Math.floor(w.dataBytes / frameBytes);
  const f0 = Math.round(fromSec * w.rate), f1 = Math.round(toSec * w.rate);
  if (!(f0 >= 0) || !(f1 > f0)) throw new Error(`bad range ${fromSec}-${toSec} s`);
  if (f1 > totalFrames) throw new Error(`the part holds ${(totalFrames / w.rate).toFixed(1)} s of audio, the programme needs it to ${toSec.toFixed(1)} s`);
  const perWin = Math.max(1, Math.round(winSec * w.rate));
  const nWin = Math.ceil((f1 - f0) / perWin);
  const sum = new Float64Array(nWin), cnt = new Uint32Array(nWin);
  let peak = 0, clipped = 0;
  const buf = Buffer.allocUnsafeSlow(CHUNK - (CHUNK % frameBytes));
  const s16 = new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1);
  const fd = fs.openSync(file, "r");
  try {
    let frame = f0;
    while (frame < f1) {
      const want = Math.min(f1 - frame, buf.length / frameBytes);
      const got = fs.readSync(fd, buf, 0, want * frameBytes, w.dataOffset + frame * frameBytes);
      const frames = Math.floor(got / frameBytes);
      if (frames <= 0) throw new Error(`read stopped at ${(frame / w.rate).toFixed(1)} s`);
      const C = w.channels;
      for (let i = 0; i < frames; i++) {
        let m = 0;
        for (let c = 0; c < C; c++) {
          const x = s16[i * C + c]; const a = x < 0 ? -x : x;
          if (a > peak) peak = a;
          if (a >= clipLevel) clipped++;
          m += x;
        }
        m /= C;
        const k = ((frame + i - f0) / perWin) | 0;
        sum[k] += m * m; cnt[k]++;
      }
      frame += frames;
    }
  } finally { fs.closeSync(fd); }
  const windows = new Array(nWin);
  for (let k = 0; k < nWin; k++) windows[k] = toDb(cnt[k] ? sum[k] / cnt[k] : 0);
  return { windows, winSec: perWin / w.rate, peakDbfs: peak ? 20 * Math.log10(peak / FULL) : FLOOR_DB, clipped };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const r1 = (x) => Math.round(x * 10) / 10;
/** "26:15", "-05:00": a time relative to the top of the hour. */
export function mmss(ms) {
  const neg = ms < 0, t = Math.round(Math.abs(ms) / 1000);
  return `${neg ? "-" : ""}${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
const SPOKEN = new Set(["spoken", "breaking"]);

/**
 * @param {string} dir   the programme directory (part files are relative to it)
 * @param {object} prog  programme.json
 * @returns {{ problems: string[], stats: object }}  every problem starts with "listen-back:"
 */
export function listenBack(dir, prog, rules = LISTEN_RULES) {
  const t0 = Date.now();
  const problems = [];
  const P = (m) => problems.push(`listen-back: ${m}`);
  const stats = { slots: 0, speechOverBedDbMin: null, longestSilenceSec: 0, clipped: 0, peakDbfs: null, ms: 0 };
  const slots = (Array.isArray(prog?.slots) ? prog.slots : []).filter((s) => Number.isFinite(s?.start) && Number.isFinite(s?.end) && s.end > s.start).sort((a, b) => a.start - b.start);
  if (!slots.length) { P("programme.json has no slot list, so the mixed audio cannot be checked (unmeasured)"); return { problems, stats }; }
  const audio = (Array.isArray(prog.audio) ? prog.audio : []).filter((a) => a && a.file && Number.isFinite(a.from)).sort((a, b) => a.from - b.from);
  if (!audio.length) { P("no audio parts to listen to (unmeasured)"); return { problems, stats }; }
  const H = Number.isFinite(prog.hourStart) ? prog.hourStart : slots[0].start;
  const hasLines = Array.isArray(prog.lines);
  if (!hasLines && slots.some((s) => SPOKEN.has(s.kind))) P("programme.json has no line timings (lines), so speech above the bed cannot be measured (unmeasured)");
  const sensitive = new Set((prog.inserts || []).filter((i) => i?.sensitive).map((i) => i.id));
  const infos = new Map();
  const infoOf = (file) => {
    if (!infos.has(file)) { try { infos.set(file, { info: readWavInfo(path.join(dir, file)) }); } catch (e) { infos.set(file, { error: e.code === "ENOENT" ? "missing" : e.message }); } }
    return infos.get(file);
  };
  const win = rules.winSec;
  let peak = -Infinity;

  // dead air runs across slot boundaries; the run is reported against the slot it starts in
  let run = null, lastEnd = null;
  const closeRun = () => {
    if (!run) return;
    let len = run.n * win;
    // the endcard's fade into silence at the very end of the programme is meant: that part of the run is exempt
    if (run.endcard && run.reachesEnd) len = Math.max(0, (run.endcard.start - run.t) / 1000);
    if (len > rules.maxSilenceSec + 1e-9) P(`${run.slot}: ${r1(len)} s of dead air at ${mmss(run.t - H)}`);
    stats.longestSilenceSec = Math.max(stats.longestSilenceSec, r1(len));
    run = null;
  };

  for (const slot of slots) {
    if (lastEnd != null && slot.start !== lastEnd) closeRun();   // a hole in the slot list is not one continuous stretch
    lastEnd = slot.end;
    // the stretches of audio that play during this slot
    const spans = [];
    if (slot.start < audio[0].from) { P(`${slot.id}: no audio part covers ${mmss(slot.start - H)} to ${mmss(Math.min(slot.end, audio[0].from) - H)} (unmeasured)`); closeRun(); continue; }
    for (let i = 0; i < audio.length; i++) {
      const a = audio[i], next = audio[i + 1]?.from ?? Infinity;
      const s0 = Math.max(slot.start, a.from), s1 = Math.min(slot.end, next);
      if (s1 > s0) spans.push({ a, s0, s1 });
    }
    const wins = [];   // { t, db }
    let clipped = 0, bad = false;
    for (const { a, s0, s1 } of spans) {
      const inf = infoOf(a.file);
      if (inf.error) { P(`${slot.id}: audio ${a.file} ${inf.error === "missing" ? "is missing" : `cannot be read: ${inf.error}`} (unmeasured)`); bad = true; break; }
      const origin = Number.isFinite(a.origin) ? a.origin : a.from;
      try {
        const r = windowStats(path.join(dir, a.file), { fromSec: (s0 - origin) / 1000, toSec: (s1 - origin) / 1000, winSec: win, clipLevel: rules.clipLevel, info: inf.info });
        const step = r.winSec * 1000;
        r.windows.forEach((db, k) => wins.push({ t: s0 + k * step, db, end: Math.min(s1, s0 + (k + 1) * step) }));
        clipped += r.clipped; peak = Math.max(peak, r.peakDbfs);
      } catch (e) { P(`${slot.id}: audio ${a.file}: ${e.message} (unmeasured)`); bad = true; break; }
    }
    if (bad) { closeRun(); continue; }
    stats.slots++;
    stats.clipped += clipped;
    if (clipped > rules.maxClippedSamples) P(`${slot.id}: ${clipped} clipped samples (at most ${rules.maxClippedSamples})`);

    // dead air
    for (const w of wins) {
      if (w.db < rules.silenceDbfs) {
        if (!run) run = { t: w.t, slot: slot.id, n: 0, endcard: null, reachesEnd: false };
        run.n++;
        if (slot.kind === "endcard") { run.endcard ||= slot; run.reachesEnd = w.end >= slot.end - 1; }
        else { run.endcard = null; run.reachesEnd = false; }
      } else closeRun();
    }

    // speech above the bed
    if (SPOKEN.has(slot.kind) && hasLines && !(slot.noBed || sensitive.has(slot.id))) {
      const lines = prog.lines.filter((l) => l && l.slot === slot.id && Number.isFinite(l.at) && Number.isFinite(l.end) && l.end > l.at).sort((a, b) => a.at - b.at);
      if (!lines.length) { P(`${slot.id}: no voiced lines recorded for this spoken slot, so speech above the bed cannot be measured (unmeasured)`); continue; }
      const e = rules.edgeSec * 1000;
      const speech = [], bed = [];
      for (const w of wins) {
        if (w.t < lines[0].at) continue;   // lead-in: sting and the bed's ramp
        if (lines.some((l) => w.t >= l.at + e && w.end <= l.end - e)) speech.push(w.db);
        else if (!lines.some((l) => w.t < l.end + e && w.end > l.at - e) && w.end <= slot.end - e) bed.push(w.db);
      }
      if (!speech.length || !bed.length) { P(`${slot.id}: no ${speech.length ? "gap between lines" : "voiced window"} long enough to measure speech above the bed (unmeasured)`); continue; }
      const over = r1(median(speech) - median(bed));
      stats.speechOverBedDbMin = stats.speechOverBedDbMin == null ? over : Math.min(stats.speechOverBedDbMin, over);
      if (over < rules.minSpeechOverBedDb) P(`${slot.id}: speech only ${over} dB above the bed (need ${rules.minSpeechOverBedDb} dB)`);
    }
  }
  closeRun();
  stats.peakDbfs = Number.isFinite(peak) ? r1(peak) : null;
  if (Number.isFinite(peak) && peak > rules.maxPeakDbfs) P(`peak ${r1(peak)} dBFS (at most ${rules.maxPeakDbfs} dBFS)`);
  stats.ms = Date.now() - t0;
  return { problems, stats };
}
