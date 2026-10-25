/**
 * repeat.js - the overnight repeat (#195): the strongest recent produced hour, moved to a new hour, ready for a
 * fresh The Hour to be spliced in at the top (produce.mjs --from the-hour --to markets-1).
 *
 * Media files are hard-linked where the filesystem allows (a programme part is ~800 MB of WAV), else copied;
 * everything else is copied.
 * Only hours that were PRODUCED (not repeats) and passed their air check are candidates.
 *
 * Markets (#249): the repeated hour's Markets Now lines are re-checked at the REPEAT's air time
 * (marketsClock.recheckRepeatedMarkets). A slot with a stale line, or whose lines cannot be read, is cut to the
 * hour's own music bed (cutSlotToMusic). Chosen over regenerating Markets Now in the splice because it needs no
 * writer call (a repeat is the cost guard's fallback), adds no producing time, and works from the repeated hour's
 * real slot times rather than the repeat hour's clock, which can differ after The Hour. The source hour's
 * segments.json and pack.json are kept as repeat-source-*.json, because the splice run overwrites both, so that
 * airCheck can re-check every Markets slot left on air.
 */
import fs from "node:fs";
import path from "node:path";
import { recheckRepeatedMarkets } from "./marketsClock.js";
import { elementsForKind } from "./grid.js";

const HOUR = 3_600_000;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

/** Score of a produced hour from its air check: how much of the writing survived, times how full The Hour was. */
export function hourScore(check) {
  const st = check?.stats || {};
  if (!check?.ok) return -1;
  return (Number(st.keptShare) || 0) * Math.min(5, Number(st.hourStories) || 0) + Math.min(1, (Number(st.cues) || 0) / 1000);
}

/**
 * The strongest produced hour that aired (or was ready to) in the `windowH` hours before `beforeMs`.
 * Reads <airDir>/<stamp>/status.json, written by the rolling orchestrator. Newer wins a tie.
 * @returns {{ dir: string, hourStart: number, score: number } | null}
 */
export function pickStrongest(airDir, beforeMs, { windowH = 18 } = {}) {
  let best = null;
  let names = [];
  try { names = fs.readdirSync(airDir); } catch { return null; }
  for (const name of names) {
    const dir = path.join(airDir, name);
    const st = readJson(path.join(dir, "status.json"));
    if (!st || st.decision !== "produced" || !st.check?.ok) continue;
    if (!(st.hourStart < beforeMs && st.hourStart >= beforeMs - windowH * HOUR)) continue;
    if (!fs.existsSync(path.join(dir, "programme.json"))) continue;
    const score = hourScore(st.check);
    if (!best || score > best.score || (score === best.score && st.hourStart > best.hourStart)) best = { dir, hourStart: st.hourStart, score };
  }
  return best;
}

/** Every absolute time in a programme, shifted so the hour starts at `newHourStart`. Pure. */
export function retimeProgramme(prog, newHourStart) {
  const d = newHourStart - prog.hourStart;
  const sh = (x) => (Number.isFinite(x) ? x + d : x);
  const cue = (c) => {
    const data = c.data ? { ...c.data } : c.data;
    if (data) {
      for (const k of ["target", "t0"]) if (Number.isFinite(data[k])) data[k] = sh(data[k]);
      if (data.next && Number.isFinite(data.next.at)) data.next = { ...data.next, at: sh(data.next.at) };
      // asOf (when the market figures were fetched) is a real time, not a programme time: it stays as it was
    }
    return { ...c, at: sh(c.at), data };
  };
  return {
    ...prog,
    hourStart: newHourStart,
    endsAt: sh(prog.endsAt),
    audio: (prog.audio || []).map((a) => ({ ...a, from: sh(a.from), ...(Number.isFinite(a.origin) ? { origin: sh(a.origin) } : {}) })),
    cues: (prog.cues || []).map(cue),
    slots: (prog.slots || []).map((s) => ({ ...s, start: sh(s.start), end: sh(s.end) })),
    repeatOf: { hourStart: prog.hourStart, hour: new Date(prog.hourStart).toISOString() },
  };
}

/**
 * Splice a freshly produced stretch [cut, resumeAt) into a programme (produce.mjs --from X --to Y). At `resumeAt`
 * the playout switches back to whichever part was playing there, seeking from that part's own `origin`, so the
 * rest of the hour plays exactly as before. Cues are replaced inside the stretch only. Pure.
 */
export function spliceProgramme(prog, { cut, resumeAt, partFile, cues }) {
  const old = prog.audio || [];
  const covering = old.filter((a) => a.from <= resumeAt).at(-1);
  const after = old.filter((a) => a.from >= resumeAt);
  const resume = covering && !after.some((a) => a.from === resumeAt) ? [{ file: covering.file, from: resumeAt, origin: covering.origin ?? covering.from }] : [];
  return {
    ...prog,
    audio: [...old.filter((a) => a.from < cut), { file: partFile, from: cut }, ...resume, ...after],
    cues: [...(prog.cues || []).filter((c) => c.at < cut), ...cues.filter((c) => c.at >= cut && c.at < resumeAt), ...(prog.cues || []).filter((c) => c.at >= resumeAt)],
  };
}

// ── #249: cut a repeated Markets Now slot to the hour's own music ─────────────
const DONOR_HEAD_MS = 4_000;   // past a music slot's sting (3 s) and its 0.8 s ramp up from the ducked bed
const DONOR_TAIL_MS = 1_000;
const DONOR_MIN_MS = 10_000;

/** The longest music slot whose audio sits inside one part, outside `avoid`; null when the hour has none. Pure. */
export function musicDonor(prog, avoid = []) {
  const audio = [...(prog.audio || [])].sort((a, b) => a.from - b.from);
  const cands = (prog.slots || []).filter((s) => s.kind === "music" && !s.cut && Number.isFinite(s.start) && Number.isFinite(s.end)
    && !avoid.some((w) => s.start < w.end && w.start < s.end)).map((s) => {
    const covering = audio.filter((a) => a.from <= s.start).at(-1);
    if (!covering || audio.some((a) => a.from > s.start && a.from < s.end)) return null;
    const from = s.start + DONOR_HEAD_MS, to = s.end - DONOR_TAIL_MS;
    return to - from >= DONOR_MIN_MS ? { slot: s, file: covering.file, origin: covering.origin ?? covering.from, from, to } : null;
  }).filter(Boolean);
  return cands.sort((a, b) => (b.to - b.from) - (a.to - a.from) || a.from - b.from)[0] || null;
}

/**
 * Replace slot `id` with music: its audio plays a stretch of a music slot of the same hour (looped if the slot is
 * longer), then the hour resumes in step at the slot's end; its cues become one music scene; "next" pointers to it
 * move to the following titled slot. Pure.
 * @returns {{ ok: true, prog } | { ok: false, why: string }}
 */
export function cutSlotToMusic(prog, id, { why = "cut", avoid = [] } = {}) {
  const slot = (prog.slots || []).find((s) => s.id === id);
  if (!slot) return { ok: false, why: `no slot ${id}` };
  const d = musicDonor(prog, [slot, ...avoid]);
  if (!d) return { ok: false, why: "the hour has no music slot to cut to" };
  const old = [...(prog.audio || [])].sort((a, b) => a.from - b.from);
  const fill = [];
  for (let t = slot.start; t < slot.end; t += Math.min(slot.end - t, d.to - d.from)) fill.push({ file: d.file, from: t, origin: t - (d.from - d.origin) });
  const resumeFrom = old.filter((a) => a.from <= slot.end).at(-1);
  const resume = resumeFrom && !old.some((a) => a.from === slot.end) ? [{ file: resumeFrom.file, from: slot.end, origin: resumeFrom.origin ?? resumeFrom.from }] : [];
  const audio = [...old.filter((a) => a.from < slot.start || a.from >= slot.end), ...fill, ...resume].sort((a, b) => a.from - b.from);

  const next = (prog.slots || []).filter((s) => s.start >= slot.end && s.title && s.kind !== "music").sort((a, b) => a.start - b.start)[0];
  const nextData = next ? { next: { title: next.title, at: next.start } } : {};
  const credit = (prog.cues || []).find((c) => c.scene === "music" && c.at >= d.slot.start && c.at < d.slot.end && c.data?.credit)?.data.credit;
  const cues = (prog.cues || [])
    .filter((c) => !(c.at >= slot.start && c.at < slot.end))
    .filter((c) => !(c.scene === "title" && c.data?.kicker === "Next" && slot.title && c.data?.title === slot.title && c.at < slot.start && c.at >= slot.start - 180_000))
    .map((c) => {
      if (c.data?.next?.at !== slot.start) return c;
      const { next: _gone, ...data } = c.data;
      return { ...c, data: { ...data, ...nextData } };
    });
  cues.push({ at: slot.start, scene: "music", data: { ...(credit ? { credit } : {}), ...nextData } });
  cues.sort((a, b) => a.at - b.at);
  const slots = prog.slots.map((s) => (s === slot ? { ...s, kind: "music", title: null, cut: why, ...(s.elements ? { elements: elementsForKind({ kind: "music" }) } : {}) } : s));
  return { ok: true, prog: { ...prog, audio, cues, slots }, donor: d.slot.id };
}

/**
 * #249: re-check every repeated Markets Now slot at the repeat's air time; cut a stale or unmeasurable one to music.
 * Records the result in `prog.repeatMarkets` (airCheck refuses a repeat without it). Pure.
 */
export function recheckRepeatMarkets(prog, segments, pack, { now = Date.now() } = {}) {
  const verdicts = recheckRepeatedMarkets(prog.slots, segments, pack);
  let out = prog;
  const record = [];
  for (const v of verdicts) {
    const row = { id: v.id, airAt: v.airAt, measured: v.measured, ...(v.why ? { why: v.why } : {}), ...(v.measured ? { lines: v.lines } : {}), stale: v.stale };
    if (v.measured && !v.stale.length) { record.push({ ...row, action: "kept" }); continue; }
    const reason = v.measured ? `stale at the repeat's air time: ${v.stale[0]}` : `unmeasured: ${v.why}`;
    const c = cutSlotToMusic(out, v.id, { why: `#249 repeated Markets Now ${reason}`, avoid: verdicts.map((x) => ({ start: x.start, end: x.end })) });
    if (c.ok) { out = c.prog; record.push({ ...row, action: "cut to music", donor: c.donor }); }
    else record.push({ ...row, action: `not cut (${c.why}); airCheck refuses the hour` });
  }
  return { ...out, repeatMarkets: { checkedAt: now, slots: record } };
}

const SKIP = new Set(["status.json", "autoair.log", "rolling.log", "playout.log", "writer.json", "produce.log", "refresh.log"]);

export const REPEAT_SOURCE_SEGMENTS = "repeat-source-segments.json", REPEAT_SOURCE_PACK = "repeat-source-pack.json";

/**
 * Link (or copy) a produced hour into `dstDir`, retime its programme to `newHourStart`, and re-check its Markets Now
 * at the new air time (#249).
 */
export function prepareRepeat(srcDir, dstDir, newHourStart, { now = Date.now() } = {}) {
  const prog = readJson(path.join(srcDir, "programme.json"));
  if (!prog) throw new Error(`no readable programme.json in ${srcDir}`);
  fs.mkdirSync(dstDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    if (SKIP.has(name) || name === "programme.json" || name.startsWith("repeat-source-")) continue;
    const from = path.join(srcDir, name), to = path.join(dstDir, name);
    if (!fs.statSync(from).isFile()) continue;
    try { fs.rmSync(to, { force: true }); } catch { /* */ }
    // Only media is hard-linked: produce.mjs rewrites the JSON files in place, which through a link would change the
    // source hour too. Media parts are only ever replaced by rename (or written under a new name), never in place.
    if (/\.(wav|webm|mp4|mov|m4v)$/i.test(name)) { try { fs.linkSync(from, to); continue; } catch { /* other device: copy */ } }
    fs.copyFileSync(from, to);
  }
  // #249: the splice run rewrites segments.json and pack.json; keep the repeated hour's own for the re-check
  const srcSegments = readJson(path.join(srcDir, "segments.json")), srcPack = readJson(path.join(srcDir, "pack.json"));
  for (const [name, data] of [[REPEAT_SOURCE_SEGMENTS, srcSegments], [REPEAT_SOURCE_PACK, srcPack]]) {
    const f = path.join(dstDir, name);
    fs.rmSync(f, { force: true });
    if (data) fs.writeFileSync(f, JSON.stringify(data, null, 1));
  }
  const moved = recheckRepeatMarkets(retimeProgramme(prog, newHourStart), srcSegments, srcPack, { now });
  const pf = path.join(dstDir, "programme.json");
  fs.writeFileSync(pf + ".tmp", JSON.stringify(moved, null, 1));
  fs.renameSync(pf + ".tmp", pf);
  return moved;
}
