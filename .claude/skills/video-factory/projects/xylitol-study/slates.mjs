/**
 * slates.mjs — placeholder clips, so the ASSEMBLY can be proven before hours
 * are spent curating real footage.
 *
 *   node slates.mjs           # write a slate for every key that has no file
 *   node slates.mjs --force   # overwrite existing slates too
 *
 * WHY. This film has 71 footage beats over 28 distinct keys, and acquiring them
 * is the long pole: footage-search.mjs ranks candidates by provenance and a
 * human picks each one. Meanwhile build.mjs cannot run at all without files, so
 * every remaining assembly bug — timing, the SRT, chapter marks, the real
 * runtime — stays hidden behind that work. Two such bugs have already surfaced
 * only at build time, each after narration had been paid for.
 *
 * So: generate obviously-fake clips, run the build, learn what it teaches, and
 * replace them one at a time as real footage arrives.
 *
 * IT NEVER OVERWRITES A REAL CLIP. Without --force, a key that already has a
 * file is skipped, so acquisition and slates can coexist while the library is
 * filled in. That is the property that makes this safe to leave lying around.
 *
 * A SLATE BUILD IS NOT A CUT OF THE FILM. Every slate is magenta, labelled with
 * its key, and stamped NOT FOR PUBLICATION, because the one thing that must
 * never happen is a placeholder reaching a viewer. Nothing here publishes, and
 * publish.json's null publishAt values keep publishing shut regardless.
 */
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "../../../../../backend");
const { ffmpegPath } = await import(path.join(BACKEND, "src/services/longform/engine/_deps.mjs"));
const { interpretStoryboard } = await import(
  path.join(BACKEND, "src/services/longform/storyboardInterpreter.js"));

const FORCE = process.argv.includes("--force");
const FONT = path.join(BACKEND, "assets/fonts/Anton-Regular.ttf");
const OUT = path.join(HERE, "out/footage");
mkdirSync(OUT, { recursive: true });

const doc = JSON.parse(readFileSync(path.join(HERE, "storyboard.json"), "utf8"));
const { FOOTAGE } = interpretStoryboard(doc, { P: (p) => p, loadStatement: null });
const keys = [...new Set(Object.values(FOOTAGE).map((f) => f.file))].sort();

// Long enough that build.mjs's -stream_loop never has to wrap inside one shot.
const SECONDS = 20;
const esc = (t) => String(t).replace(/[\\':]/g, (c) => `\\${c}`);

/**
 * Keys awaiting real material, which must NOT announce themselves on screen.
 *
 * A magenta card reading PLACEHOLDER — NOT FOR PUBLICATION is the right thing
 * for a key nobody has sourced yet: it is loud, it is unmistakable in a review
 * cut, and it cannot be mistaken for a finished shot.
 *
 * It is the WRONG thing for a beat that is deliberately fenced off. Those beats
 * are waiting on the actual congress, the actual paper, the actual headlines —
 * a decision, not an oversight — and the film is watchable while they wait. A
 * caption still runs over them and the narration still carries the line, so a
 * plain dark frame reads as an intentional cut to black. A magenta card
 * shouting its own filename reads as a broken render, and makes the whole cut
 * unwatchable for the sake of two beats.
 *
 * Kept in step with acquire.mjs's NO_STOCK by name. Duplicated deliberately:
 * these two scripts run independently, and importing one into the other to
 * share two strings would couple a placeholder generator to a downloader.
 */
const FENCED = new Set(["F_ESC_CONGRESS_FLOOR", "F_HEADLINES_SCROLL"]);

let made = 0, kept = 0, dark = 0;
for (const key of keys) {
  const file = path.join(OUT, `${key}.mp4`);
  if (existsSync(file) && !FORCE) { kept++; process.stdout.write("·"); continue; }
  const fenced = FENCED.has(key);
  // Near-black, not pure black: it matches the film's own base colour, so the
  // cut reads as the frame the caption sits on rather than as dropped signal.
  const bg = fenced ? "0x090706" : "0x8B1A5A";
  const vf = fenced
    ? null
    : [
        `drawtext=fontfile=${FONT}:text='${esc(key)}':fontcolor=white:fontsize=58`
          + `:x=(w-text_w)/2:y=(h-text_h)/2-60`,
        `drawtext=fontfile=${FONT}:text='${esc("PLACEHOLDER - NOT FOR PUBLICATION")}':fontcolor=white`
          + `:fontsize=34:x=(w-text_w)/2:y=(h-text_h)/2+40`,
      ].join(",");
  execFileSync(ffmpegPath, [
    "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=${bg}:s=1920x1080:d=${SECONDS}:r=30`,
    ...(vf ? ["-vf", vf] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
    "-pix_fmt", "yuv420p", file,
  ]);
  made++; if (fenced) dark++;
  process.stdout.write(fenced ? "▪" : ".");
}
process.stdout.write("\n");

console.log(`\n${keys.length} distinct footage keys`);
console.log(`  ${made} slate(s) written, ${kept} existing file(s) left alone${FORCE ? " (--force overwrote)" : ""}`);
if (dark) {
  console.log(`  ${dark} fenced key(s) written as PLAIN DARK frames, not labelled placeholders:`);
  for (const k of keys.filter((k) => FENCED.has(k))) console.log(`      ${k}`);
  console.log(`  Those beats keep their narration and captions and cut to black until they`);
  console.log(`  have real material. They never announce themselves on screen.`);
}
if (kept && !FORCE) console.log(`  '·' is a file that already existed — real footage is never clobbered.`);
console.log(`\n  These are PLACEHOLDERS. A build over them proves the assembly, the SRT and`);
console.log(`  the real runtime — it is not a cut of the film, and must not be published.\n`);
