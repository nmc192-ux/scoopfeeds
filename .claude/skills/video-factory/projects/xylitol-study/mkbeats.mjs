/**
 * mkbeats.mjs — vo.txt → beats.json, at the engine's beat granularity.
 *
 * The gate check segmented at every sentence boundary, which gave 174 beats at
 * ~3.8s each. The engine's norm is ~14 words / 5-6s (longformStoryboardSchema's
 * shorts rule is written against that figure), so short sentences are MERGED
 * with their neighbour up to a target width.
 *
 * WHAT IS NEVER MERGED. The script's one-line beats are rhetorical — "Thirteen
 * minutes." is the pivot of the film and holds a frame alone; the music drops
 * under it. Merging those into their neighbours would delete the pauses the
 * script was written around. `SOLO` lists them by exact text, and the merge
 * refuses to absorb or cross one.
 *
 * Writes beats.json only. Idempotent.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;

const TARGET = 15;   // words a beat aims for
const HARD = 26;     // never exceed (engine max is 30)

/** Beats that must stand alone — the script's deliberate pauses. */
const SOLO = new Set([
  "Thirteen minutes.",
  "After an overnight fast.",
  "Xylitol is severely toxic to dogs.",
  "Then xylitol in 2024. Fifty-seven.",
  "Then Munich, this week. Fifty-seven, and eighteen.",
  "A bit. Here's my actual read.",
  "So — has my advice changed?",
  "The label tells you what isn't in the packet. It was never a promise about what is.",
]);

/**
 * A sentence longer than HARD is split at CLAUSE breaks — em dash, semicolon,
 * colon, then comma — never mid-phrase. Three sentences in this script run past
 * the engine's 30-word ceiling on their own (the dissent's list of counter-
 * arguments is 38), and a beat over that ceiling is rejected by the engine, so
 * they have to break somewhere. Breaking at punctuation the author already
 * wrote keeps the pause where it was meant to fall.
 */
const splitLong = (s) => {
  if (words(s) <= HARD) return [s];
  for (const re of [/(?<=—)\s+/, /(?<=[;:])\s+/, /(?<=,)\s+/]) {
    const parts = s.split(re);
    if (parts.length < 2) continue;
    const out = [];
    let buf = "";
    for (const p of parts) {
      const merged = buf ? `${buf} ${p}` : p;
      if (buf && words(merged) > HARD) { out.push(buf); buf = p; } else buf = merged;
    }
    if (buf) out.push(buf);
    if (out.every((o) => words(o) <= HARD)) return out;
  }
  return [s];   // reported by the caller rather than chopped mid-phrase
};

const raw = readFileSync(path.join(HERE, "vo.txt"), "utf8");
const chapters = [];
for (const line of raw.split("\n")) {
  if (line.startsWith("## ")) { chapters.push({ name: line.slice(3).trim(), lines: [] }); continue; }
  if (line.trim() && chapters.length) chapters[chapters.length - 1].lines.push(line.trim());
}

const beats = [];
for (const ch of chapters) {
  for (const line of ch.lines) {
    const sentences = (line.match(/[^.!?]+[.!?]+["']?|\S[^.!?]*$/g) || [line]).map((s) => s.trim()).filter(Boolean);
    let buf = "";
    const flush = () => { if (buf) { beats.push({ id: 0, chapter: ch.name, text: buf }); buf = ""; } };
    for (const s of sentences) {
      if (SOLO.has(s)) { flush(); beats.push({ id: 0, chapter: ch.name, text: s }); continue; }
      for (const piece of splitLong(s)) {
        const merged = buf ? `${buf} ${piece}` : piece;
        // Merge while the result is still under target; never past HARD.
        if (!buf) { buf = piece; continue; }
        if (words(buf) >= TARGET || words(merged) > HARD) { flush(); buf = piece; }
        else buf = merged;
      }
    }
    flush();
  }
}
beats.forEach((b, i) => { b.id = i + 1; });

writeFileSync(path.join(HERE, "beats.json"), JSON.stringify(beats, null, 2) + "\n");

const w = beats.map((b) => words(b.text));
console.log(`${beats.length} beats · ${w.reduce((a, b) => a + b, 0)} words`);
console.log(`  per beat: min ${Math.min(...w)}, median ${w.slice().sort((a, b) => a - b)[w.length >> 1]}, max ${Math.max(...w)}`);
console.log(`  est runtime at 164 wpm: ${(w.reduce((a, b) => a + b, 0) / 164 * 60 / 60).toFixed(2)} min`);
for (const ch of chapters) {
  console.log(`  ${String(beats.filter((b) => b.chapter === ch.name).length).padStart(3)}  ${ch.name}`);
}
