/**
 * chapters.mjs — YouTube chapter timestamps, derived from the BUILT film.
 *
 *   node chapters.mjs        # after build.mjs has written out/<slug>.srt
 *
 * WHY THIS EXISTS. publish.json shipped the brief's ESTIMATED chapter times
 * (00:38, 02:05, 03:05 …). Those came from a target runtime of 10:45-11:30;
 * the narration actually measured 12:52.9, so every one of them was wrong by a
 * growing margin — the last chapter by well over a minute. A wrong chapter mark
 * in a published description is not a rounding error to a viewer, it is a link
 * that lands in the middle of a different argument.
 *
 * So the timestamps come from the SRT build.mjs writes, which carries the real
 * per-beat voice placement including lead-in, the title segment, readability
 * holds and chapter tails — none of which a word count can predict.
 *
 * REFUSES RATHER THAN GUESSES. If the SRT's cue count does not match the beat
 * count, the index-to-beat mapping this relies on is not safe, and emitting
 * plausible-looking timestamps would be worse than emitting none.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SLUG = JSON.parse(readFileSync(path.join(HERE, "project.json"), "utf8")).slug;
const srtPath = path.join(HERE, `out/${SLUG}.srt`);

if (!existsSync(srtPath)) {
  console.error(`no ${path.relative(HERE, srtPath)} — run build.mjs first.`);
  process.exit(1);
}

/** "00:01:23,450 --> …" → seconds. */
const cueStarts = [...readFileSync(srtPath, "utf8")
  .matchAll(/^(\d\d):(\d\d):(\d\d),(\d{3}) -->/gm)]
  .map((m) => (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000);

const sb = JSON.parse(readFileSync(path.join(HERE, "storyboard.json"), "utf8"));
const beatIds = Object.keys(sb.beats).map(Number).sort((a, b) => a - b);

if (cueStarts.length !== beatIds.length) {
  console.error(
    `refusing: the SRT has ${cueStarts.length} cues but the storyboard has ${beatIds.length} beats.\n` +
    `Chapter marks are derived by index, so a mismatch means every timestamp after the\n` +
    `first divergence would be wrong. Fix the mismatch rather than trusting this output.`);
  process.exit(1);
}

const mmss = (s) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const two = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
};

// YouTube requires the first chapter at 00:00, and this film opens straight
// into the cold open rather than on a divider — so the opener is named here
// rather than invented from a card that does not exist.
const rows = [["00:00", "I've been giving this advice for years"]];
for (const [i, id] of beatIds.entries()) {
  const b = sb.beats[String(id)];
  if (b.card !== "chapter") continue;
  rows.push([mmss(cueStarts[i]), b.name]);
}

console.log(`\nCHAPTERS — from out/${SLUG}.srt (${mmss(cueStarts[cueStarts.length - 1])} last cue)\n`);
for (const [t, name] of rows) console.log(`${t}  ${name}`);
console.log(`\nPaste into publish.json's youtube.description, replacing the estimated block.`);
console.log(`${rows.length} chapters. YouTube needs at least 3, the first at 00:00.\n`);
