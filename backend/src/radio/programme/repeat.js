/**
 * repeat.js - the overnight repeat (#195): the strongest recent produced hour, moved to a new hour, ready for a
 * fresh The Hour to be spliced in at the top (produce.mjs --from the-hour --to markets-1).
 *
 * Media files are hard-linked where the filesystem allows (a programme part is ~800 MB of WAV), else copied;
 * everything else is copied.
 * Only hours that were PRODUCED (not repeats) and passed their air check are candidates.
 */
import fs from "node:fs";
import path from "node:path";

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

const SKIP = new Set(["status.json", "autoair.log", "rolling.log", "playout.log", "writer.json", "produce.log", "refresh.log"]);

/** Link (or copy) a produced hour into `dstDir` and retime its programme to `newHourStart`. */
export function prepareRepeat(srcDir, dstDir, newHourStart) {
  const prog = readJson(path.join(srcDir, "programme.json"));
  if (!prog) throw new Error(`no readable programme.json in ${srcDir}`);
  fs.mkdirSync(dstDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    if (SKIP.has(name) || name === "programme.json") continue;
    const from = path.join(srcDir, name), to = path.join(dstDir, name);
    if (!fs.statSync(from).isFile()) continue;
    try { fs.rmSync(to, { force: true }); } catch { /* */ }
    // Only media is hard-linked: produce.mjs rewrites the JSON files in place, which through a link would change the
    // source hour too. Media parts are only ever replaced by rename (or written under a new name), never in place.
    if (/\.(wav|webm|mp4|mov|m4v)$/i.test(name)) { try { fs.linkSync(from, to); continue; } catch { /* other device: copy */ } }
    fs.copyFileSync(from, to);
  }
  const moved = retimeProgramme(prog, newHourStart);
  const pf = path.join(dstDir, "programme.json");
  fs.writeFileSync(pf + ".tmp", JSON.stringify(moved, null, 1));
  fs.renameSync(pf + ".tmp", pf);
  return moved;
}
