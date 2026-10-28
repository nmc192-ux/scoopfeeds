/**
 * airCheck.js - is a produced programme fit to go on air unattended?
 *
 * The gate the auto-air run passes before it starts the playout. Anything it cannot measure is a FAILURE,
 * not a pass: a missing file, an unreadable report, a wrong hour. When it fails, nothing goes out and the
 * 24/7 music radio keeps the channel.
 *
 * A film or feature in the hour needs a valid content-safety clearance (safety/contentSafety.js, #218).
 * autoair.mjs drops an uncleared film or feature before producing, so normally this never fires; it is
 * the second lock.
 *
 * Markets (#245): a Markets Now line that reads a closed (last-session) row as today's move fails the hour.
 * checkSegments drops such lines, so normally this never fires either; it is the second lock. If the hour has
 * Markets lines but pack.json is missing or was never checked for closed rows, that is unmeasured: a failure.
 *
 * Weather (#247): a kept weather line that says Fahrenheit, or whose text cannot be read, fails the hour.
 *
 * Repeats (#249): a repeat airs the repeated hour's own Markets Now audio, which segments.json (the splice run's)
 * does not hold. prepareRepeat re-checks those lines at the repeat's air time and cuts a stale slot to music; here
 * every Markets slot still spoken is re-checked again from repeat-source-*.json. A repeat with no re-check record,
 * or a slot whose lines or pack cannot be read, is unmeasured: a failure.
 *
 * Listen-back (#273): once every audio part exists and is big enough, the mixed audio itself is listened to
 * (listenBack.js): dead air, speech buried under the bed, clipping. A part that cannot be read or a spoken slot with
 * no line timings is unmeasured: a failure. It has no flag: it only ever refuses an hour.
 *
 * Crypto (#283): the hour's Crypto state (programme.json `crypto`, written by produce.mjs and repeat.js) is reported in
 * `stats.crypto`, and every hour without a Crypto segment on air gets a note saying why ("crypto: feed unavailable
 * (...)"). A missing Crypto segment never refuses an hour, with one exception: a repeat whose stale Crypto could not be
 * cut to music and was not replaced by a fresh one. A grid hour with no record at all is reported as "unmeasured".
 */
import fs from "node:fs";
import path from "node:path";
import { hasValidClearance } from "../safety/contentSafety.js";
import { weatherProblems } from "./weatherUnits.js";
import { staleMarketLine, recheckRepeatedMarkets, isMarketsSlot } from "./marketsClock.js";
import { REPEAT_SOURCE_SEGMENTS, REPEAT_SOURCE_PACK } from "./repeat.js";
import { listenBack, LISTEN_RULES } from "./listenBack.js";

export const AIR_RULES = Object.freeze({
  minKeptShare: 0.6,       // at least 60 % of the written lines survived the fact checks
  minHourStories: 3,       // The Hour reads at least three stories
  minRoundupLines: 2,      // #198: the election special's round-up: its opening line and at least one more
  minCues: 20,
  minPartBytes: 1_000_000, // a part file under 1 MB is not an hour of audio
});

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
// mechanical lines (the station ID) are not written by the model, so they do not count toward the kept share
const lineCount = (segs) => Object.values(segs || {}).reduce((n, s) => n + (Array.isArray(s?.lines) ? s.lines.filter((l) => !l?.mechanical).length : 0), 0);

/**
 * @param {string} dir   the producer's --out directory
 * @param {{ hourStart: number, rules?: object, listenRules?: object }} want
 * @returns {{ ok: boolean, problems: string[], stats: object, notes: string[] }}  notes never refuse an hour
 */
export function airCheck(dir, { hourStart, rules = AIR_RULES, listenRules = LISTEN_RULES } = {}) {
  const problems = [];
  const notes = [];
  const stats = {};
  const need = (f) => { const p = path.join(dir, f); if (!fs.existsSync(p)) { problems.push(`${f} missing`); return null; } try { return readJson(p); } catch (e) { problems.push(`${f} unreadable: ${e.message}`); return null; } };

  const prog = need("programme.json");
  const raw = need("segments.raw.json");
  const kept = need("segments.json");

  if (prog) {
    if (prog.hourStart !== hourStart) problems.push(`programme is for ${new Date(prog.hourStart).toISOString()}, not ${new Date(hourStart).toISOString()}`);
    stats.cues = prog.cues?.length || 0;
    if (stats.cues < rules.minCues) problems.push(`only ${stats.cues} cues`);
    const before = problems.length;
    if (!Array.isArray(prog.audio) || !prog.audio.length) problems.push("no audio parts");
    for (const a of prog.audio || []) {
      const f = path.join(dir, a.file);
      const size = fs.existsSync(f) ? fs.statSync(f).size : 0;
      if (size < rules.minPartBytes) problems.push(`audio ${a.file} ${size ? `is only ${size} bytes` : "missing"}`);
    }
    // #273: listen to what was mixed, but only once every part is there (otherwise it is already a failure)
    if (problems.length > before) problems.push("listen-back: not run, the audio parts failed the checks above (unmeasured)");
    else {
      try { const lb = listenBack(dir, prog, listenRules); problems.push(...lb.problems); stats.listenBack = lb.stats; }
      catch (e) { problems.push(`listen-back: failed: ${e.message} (unmeasured)`); }
    }
    stats.headlines = prog.headlines?.length || 0;
    if (prog.feature && prog.featurePath && !fs.existsSync(prog.featurePath)) problems.push(`feature file ${prog.featurePath} missing`);
    if (prog.film && prog.filmPath && !fs.existsSync(prog.filmPath)) problems.push(`film file ${prog.filmPath} missing`);
    // DrJ's media rule (#218): no film or feature airs without a content-safety clearance for that exact file.
    for (const [kind, name, p] of [["film", prog.film, prog.filmPath], ["feature", prog.feature, prog.featurePath]]) {
      if (!name && !p) continue;
      if (!p) { problems.push(`${kind} ${name} has no file path, so its content-safety clearance cannot be checked`); continue; }
      if (!fs.existsSync(p)) continue;   // reported above
      const c = hasValidClearance(p);
      if (!c.ok) problems.push(`${kind} ${path.basename(p)}: ${c.why} (DrJ's media rule, #218)`);
    }
  }

  if (raw && kept) {
    const written = lineCount(raw.segments || raw), survived = lineCount(kept);
    stats.linesWritten = written; stats.linesKept = survived;
    stats.keptShare = written ? Math.round((survived / written) * 100) / 100 : 0;
    if (!written) problems.push("the writer wrote nothing");
    else if (stats.keptShare < rules.minKeptShare) problems.push(`only ${Math.round(stats.keptShare * 100)} % of written lines passed the fact checks (need ${rules.minKeptShare * 100} %)`);
    if (prog?.election === "special") {
      // #198: the election night special has no The Hour; its round-up must say something beyond its opening line
      stats.roundupLines = (kept.roundup?.lines || []).length;
      if (stats.roundupLines < rules.minRoundupLines) problems.push(`the election round-up has only ${stats.roundupLines} checked lines`);
    } else {
      const hour = Object.entries(kept).find(([id]) => id === "the-hour")?.[1];
      stats.hourStories = (hour?.lines || []).filter((l) => /^s\d/.test(l.id || "") && l.story).length;
      if (stats.hourStories < rules.minHourStories) problems.push(`The Hour has only ${stats.hourStories} checked stories`);
    }
  }

  if (kept) problems.push(...marketsProblems(kept, () => need("pack.json")));
  if (kept) problems.push(...weatherProblems(kept));
  if (prog?.repeatOf) {
    const r = repeatMarketsProblems(prog, kept, () => ({ segments: need(REPEAT_SOURCE_SEGMENTS), pack: need(REPEAT_SOURCE_PACK) }));
    stats.repeatMarkets = r.stats;
    problems.push(...r.problems);
  }

  if (prog) {
    const c = cryptoReport(prog);
    stats.crypto = c.status;
    if (c.note) notes.push(c.note);
    if (c.problem) problems.push(c.problem);
  }

  return { ok: problems.length === 0, problems, stats, notes };
}

/** #283: the hour's Crypto state, for the air-check report. Pure. */
export function cryptoReport(prog) {
  const c = prog?.crypto;
  if (!c || typeof c.status !== "string") {
    // produce.mjs records the state in every full run since #283; a grid hour without it is unmeasured
    return prog?.grid ? { status: "unmeasured", note: "crypto: unmeasured (programme.json has no crypto record)" } : { status: "unmeasured", note: null };
  }
  if (c.status === "on air") return { status: c.status, note: null };
  if (c.status === "stale") return { status: c.status, note: c.why || null, problem: `repeat: ${c.why || "crypto: the repeated hour's stale Crypto is still on air"}` };
  return { status: c.status, note: c.why || `crypto: ${c.status}` };
}

/**
 * #245: every kept Markets Now line against the pack's closed rows. `loadPack` is called only when there are
 * Markets lines; a missing or unchecked pack is a failure, never a pass.
 */
export function marketsProblems(segments, loadPack) {
  const lines = Object.entries(segments || {}).filter(([id]) => /^markets/.test(id))
    .flatMap(([id, seg]) => (Array.isArray(seg?.lines) ? seg.lines : []).map((l) => ({ id, line: l })));
  if (!lines.length) return [];
  const pack = loadPack();
  if (!pack) return ["Markets Now lines cannot be checked for closed markets without pack.json"];
  if (!Number.isFinite(pack.marketsCheckedAt) || !Array.isArray(pack.markets)) return ["Markets Now: the pack was never checked for closed markets (unmeasured)"];
  return lines.map(({ id, line }) => { const why = staleMarketLine(line?.text, pack.markets); return why ? `${id}/${line?.id}: ${why}` : null; }).filter(Boolean);
}

/**
 * #249: a repeat's Markets Now slots that still air the repeated hour's audio, re-checked at the repeat's air time.
 * A slot produced fresh in the splice (in `kept`) is covered by marketsProblems instead.
 */
export function repeatMarketsProblems(prog, kept, loadSource) {
  const rm = prog?.repeatMarkets;
  if (!rm || !Number.isFinite(rm.checkedAt) || !Array.isArray(rm.slots) || !Array.isArray(prog.slots)) {
    return { problems: ["repeat: the repeated hour's Markets Now lines were never re-checked at the repeat's air time (unmeasured)"], stats: { checked: 0, cut: 0, measured: false } };
  }
  const cut = rm.slots.filter((s) => s.action === "cut to music").length;
  const onAir = prog.slots.filter((s) => isMarketsSlot(s) && s.kind === "spoken" && !(kept && Object.hasOwn(kept, s.id)));
  if (!onAir.length) return { problems: [], stats: { checked: 0, cut, measured: true } };
  const { segments, pack } = loadSource();
  const problems = recheckRepeatedMarkets(onAir, segments, pack)
    .flatMap((v) => (!v.measured ? [`repeat ${v.id}: ${v.why} (unmeasured)`] : v.stale.map((w) => `repeat ${v.id}/${w}`)));
  return { problems, stats: { checked: onAir.length, cut, measured: true } };
}
