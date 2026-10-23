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
 */
import fs from "node:fs";
import path from "node:path";
import { hasValidClearance } from "../safety/contentSafety.js";

export const AIR_RULES = Object.freeze({
  minKeptShare: 0.6,       // at least 60 % of the written lines survived the fact checks
  minHourStories: 3,       // The Hour reads at least three stories
  minCues: 20,
  minPartBytes: 1_000_000, // a part file under 1 MB is not an hour of audio
});

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const lineCount = (segs) => Object.values(segs || {}).reduce((n, s) => n + (Array.isArray(s?.lines) ? s.lines.length : 0), 0);

/**
 * @param {string} dir   the producer's --out directory
 * @param {{ hourStart: number, rules?: object }} want
 * @returns {{ ok: boolean, problems: string[], stats: object }}
 */
export function airCheck(dir, { hourStart, rules = AIR_RULES } = {}) {
  const problems = [];
  const stats = {};
  const need = (f) => { const p = path.join(dir, f); if (!fs.existsSync(p)) { problems.push(`${f} missing`); return null; } try { return readJson(p); } catch (e) { problems.push(`${f} unreadable: ${e.message}`); return null; } };

  const prog = need("programme.json");
  const raw = need("segments.raw.json");
  const kept = need("segments.json");

  if (prog) {
    if (prog.hourStart !== hourStart) problems.push(`programme is for ${new Date(prog.hourStart).toISOString()}, not ${new Date(hourStart).toISOString()}`);
    stats.cues = prog.cues?.length || 0;
    if (stats.cues < rules.minCues) problems.push(`only ${stats.cues} cues`);
    if (!Array.isArray(prog.audio) || !prog.audio.length) problems.push("no audio parts");
    for (const a of prog.audio || []) {
      const f = path.join(dir, a.file);
      const size = fs.existsSync(f) ? fs.statSync(f).size : 0;
      if (size < rules.minPartBytes) problems.push(`audio ${a.file} ${size ? `is only ${size} bytes` : "missing"}`);
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
    const hour = Object.entries(kept).find(([id]) => id === "the-hour")?.[1];
    stats.hourStories = (hour?.lines || []).filter((l) => /^s\d/.test(l.id || "") && l.story).length;
    if (stats.hourStories < rules.minHourStories) problems.push(`The Hour has only ${stats.hourStories} checked stories`);
  }

  return { ok: problems.length === 0, problems, stats };
}
