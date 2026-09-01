/**
 * gatecheck.mjs — run the VERBATIM script through the editorial gates it
 * bypasses (brief §0.2).
 *
 * A hand-authored script never touches writeVideoSpec, so none of the gates
 * that would have judged a generated one ever run. The brief's instruction is
 * to run the text through them as a standalone check and report violations
 * before rendering, rather than silently skipping them.
 *
 * WHICH GATES ACTUALLY APPLY. The four named in the brief (motive, sourcing,
 * caption floor, hanging question) live in videoSpecSchema.js, which is the
 * DAILY SHORTS system. Three transfer to long-form prose unchanged and are run
 * below. The caption-length pair does NOT: it measures the rendered width of a
 * burned-in subtitle band on a 60-100s clip, and long-form beats are narration
 * lines under a different renderer. Long-form's own beat rule (MAX_BEAT_WORDS)
 * is applied in its place, and the character stats are printed for information
 * rather than asserted.
 *
 * Read-only. Writes nothing, publishes nothing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// PATHS ARE DERIVED, NEVER BAKED. A project directory sits five levels under
// the repo root, so the backend is derived from this file's own location. These
// scripts had an absolute /home/... path from the machine they were written on
// and worked on exactly that machine — the regression deployment.test.js exists
// to catch, reproduced in the project layer where no test was looking.
const BACKEND = path.resolve(HERE, "../../../../../backend");

const {
  motiveVerdict, unsupportedIntensifiers, TRAILING_QUESTION,
  CAPTION_MIN_CHARS, CAPTION_MAX_CHARS, KICKER_BANNED_PHRASES,
} = await import(`${BACKEND}/src/services/videoSpecSchema.js`);
const { MIN_WORDS, MAX_WORDS, MIN_BEATS, MAX_BEAT_WORDS, wordCount } =
  await import(`${BACKEND}/src/services/longform/longformScriptWriter.js`);

const sourceText = readFileSync(path.join(HERE, "sources.txt"), "utf8");
const raw = readFileSync(path.join(HERE, "vo.txt"), "utf8");

// ── segment into beats ──────────────────────────────────────────────────────
// Sentence boundaries first; a sentence longer than MAX_BEAT_WORDS is split at
// its clause breaks (em dash, semicolon, colon) rather than mid-phrase.
const chapters = [];
for (const line of raw.split("\n")) {
  if (line.startsWith("## ")) { chapters.push({ name: line.slice(3).trim(), lines: [] }); continue; }
  if (line.trim() && chapters.length) chapters[chapters.length - 1].lines.push(line.trim());
}

const splitLong = (s) => {
  if (wordCount(s) <= MAX_BEAT_WORDS) return [s];
  const parts = s.split(/(?<=[—;:,])\s+/);
  const out = [];
  let buf = "";
  for (const p of parts) {
    const merged = buf ? `${buf} ${p}` : p;
    if (wordCount(merged) > MAX_BEAT_WORDS && buf) { out.push(buf); buf = p; }
    else buf = merged;
  }
  if (buf) out.push(buf);
  return out;
};

const beats = [];
for (const ch of chapters) {
  for (const line of ch.lines) {
    const sentences = line.match(/[^.!?]+[.!?]+["']?|\S[^.!?]*$/g) || [line];
    for (const s of sentences) for (const b of splitLong(s.trim())) {
      if (b) beats.push({ id: beats.length + 1, chapter: ch.name, text: b });
    }
  }
}

// ── run the gates ───────────────────────────────────────────────────────────
const problems = [];
const notes = [];
const totalWords = wordCount(beats.map((b) => b.text).join(" "));

// 1. Long-form script shape.
if (totalWords < MIN_WORDS) problems.push(`SCRIPT LENGTH: ${totalWords} words is under MIN_WORDS (${MIN_WORDS})`);
if (totalWords > MAX_WORDS) problems.push(`SCRIPT LENGTH: ${totalWords} words is over MAX_WORDS (${MAX_WORDS})`);
if (beats.length < MIN_BEATS) problems.push(`BEATS: ${beats.length} is under MIN_BEATS (${MIN_BEATS})`);
for (const b of beats) {
  if (wordCount(b.text) > MAX_BEAT_WORDS) {
    problems.push(`BEAT ${b.id} is ${wordCount(b.text)} words (max ${MAX_BEAT_WORDS}): "${b.text.slice(0, 70)}…"`);
  }
}

// 2. THE MOTIVE GATE. The brief's stance rule — never attribute motive to
//    researchers, outlets or manufacturers — is exactly what this checks.
for (const b of beats) {
  const v = motiveVerdict(b.text, sourceText);
  if (v.verdict === "fired") {
    problems.push(`MOTIVE (beat ${b.id}): unattributed "${v.motive}" — "${b.text.slice(0, 90)}…"`);
  } else if (v.verdict === "exempt_attribution" || v.verdict === "exempt_reported") {
    notes.push(`motive ok (beat ${b.id}): "${v.motive}" — ${v.verdict}${v.by ? ` via "${v.by}"` : ""}`);
  }
}

// 3. UNSUPPORTED INTENSIFIERS — a word the script leans on that the sources
//    never use is the script raising the temperature on its own.
const bad = unsupportedIntensifiers(beats.map((b) => b.text), sourceText);
for (const stem of bad) problems.push(`INTENSIFIER: "${stem}" appears in the script but nowhere in the sources`);

// 4. THE CLOSER. A question on the final card can never be answered.
const closer = beats[beats.length - 1];
if (TRAILING_QUESTION.test(closer.text)) {
  problems.push(`CLOSER ends on a question: "${closer.text}"`);
}
for (const phrase of KICKER_BANNED_PHRASES) {
  if (closer.text.toLowerCase().includes(String(phrase).toLowerCase())) {
    problems.push(`CLOSER contains banned phrase "${phrase}"`);
  }
}

// 5. Caption length, REPORTED not enforced — see the header.
const lens = beats.map((b) => b.text.length);
const under = lens.filter((l) => l < CAPTION_MIN_CHARS).length;
const over = lens.filter((l) => l > CAPTION_MAX_CHARS).length;

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\nGATE CHECK — verbatim script, ${beats.length} beats, ${totalWords} words\n`);
console.log(`  beats            ${beats.length} (min ${MIN_BEATS})`);
console.log(`  words            ${totalWords} (${MIN_WORDS}-${MAX_WORDS})`);
console.log(`  longest beat     ${Math.max(...beats.map((b) => wordCount(b.text)))} words (max ${MAX_BEAT_WORDS})`);
console.log(`  shorts caption band, FYI only: ${under} beat(s) under ${CAPTION_MIN_CHARS} chars, ${over} over ${CAPTION_MAX_CHARS}`);
console.log(`  closer           "${closer.text}"`);
if (notes.length) {
  console.log(`\n  ${notes.length} motive marker(s) present and cleared:`);
  for (const n of notes) console.log(`    · ${n}`);
}
if (problems.length) {
  console.log(`\n  ${problems.length} VIOLATION(S):`);
  for (const p of problems) console.log(`    ✗ ${p}`);
} else {
  console.log(`\n  ✓ no violations.`);
}
console.log();
