// Alignment check — every beat's narration beside the card that plays over it.
//
// WHY THIS EXISTS. Cards live in storyboard.mjs keyed by beat number; narration
// lives in beats.json keyed by beat number. Nothing enforced that key N in one
// described key N in the other. A chapter divider inserted on a beat that
// carried a content line pushed every later card one beat behind, and at ~7s a
// beat that reads to a viewer as the voice running five to seven seconds ahead
// of the picture. The build reported nothing: both files were internally valid.
//
// This prints the pairing so a human can read it, and fails on the structural
// errors a human should not have to catch:
//   · a beat with no card, or a card with no beat
//   · a footage/insert key pointing at a beat that is not a footage beat
//   · a cached narration take whose text no longer matches its beat
//
// It cannot know whether card 9 is ABOUT line 9 — that judgement stays human.
// Run it after any script edit, before narrate.

import { readFileSync, existsSync } from "fs";
import path from "path";
import { P, loadStoryboard } from "./_deps.mjs";

const { STORYBOARD, FOOTAGE, INSERTS, DOCS, TITLE_SEGMENT } = await loadStoryboard();
const beats = JSON.parse(readFileSync(P("beats.json"), "utf8"));

const problems = [];
const beatIds = new Set(beats.map((b) => b.id));
const cardIds = new Set(Object.keys(STORYBOARD).map(Number));

for (const id of beatIds) if (!cardIds.has(id)) problems.push(`beat ${id} has narration but no card`);
for (const id of cardIds) if (!beatIds.has(id)) problems.push(`card ${id} has no narration — it will never be shown`);
for (const id of Object.keys(FOOTAGE).map(Number)) {
  if (!STORYBOARD[id]) problems.push(`FOOTAGE[${id}] has no card entry`);
  else if (!STORYBOARD[id].footage) problems.push(`FOOTAGE[${id}] but card ${id} is "${STORYBOARD[id].card || "doc"}", not a footage beat`);
}
for (const id of Object.keys(INSERTS).map(Number)) {
  if (!FOOTAGE[id]) problems.push(`INSERTS[${id}] but beat ${id} has no main footage`);
}

const describe = (v) => {
  if (!v) return "—";
  if (v.footage) return `footage ${v.footage}`;
  if (v.doc) return `doc ${v.doc}`;
  const bits = [v.card];
  if (v.card === "chapter") bits.push(`${v.n} ${String(v.name).replace(/\n/g, " ")}`);
  else if (v.lines) bits.push(String(v.lines.join(" ")).replace(/\*/g, ""));
  else if (v.figure) bits.push(`${v.figure} ${v.unit || ""}`.trim());
  else if (v.title) bits.push(v.title);
  else if (v.numerator) bits.push(`${v.numerator} / ${v.denominator}`);
  return bits.join(" · ");
};

const W = process.stdout.columns && process.stdout.columns > 120 ? process.stdout.columns : 150;
const half = Math.floor((W - 8) / 2);
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t.padEnd(n));

console.log(`\nALIGNMENT — ${beats.length} beats\n`);
console.log(`  ${clip("NARRATION", half)}  ${clip("CARD", half)}`);
console.log(`  ${"─".repeat(half)}  ${"─".repeat(half)}`);
let staleTakes = 0;
for (const b of beats) {
  console.log(`${String(b.id).padStart(3)} ${clip(b.text, half)}  ${clip(describe(STORYBOARD[b.id]), half)}`);
  if (TITLE_SEGMENT && TITLE_SEGMENT.after === b.id) {
    console.log(`    ${clip("", half)}  ${clip("↳ TITLE CARD", half)}`);
  }
  const take = P(`out/audio/b${String(b.id).padStart(2, "0")}.mp3`);
  const side = take.replace(/\.mp3$/, ".txt");
  if (existsSync(take) && (!existsSync(side) || readFileSync(side, "utf8") !== b.text)) staleTakes++;
}

console.log();
if (staleTakes) console.log(`  ${staleTakes} cached take(s) no longer match their beat — narrate will re-synthesise them.`);
if (problems.length) {
  console.log(`\n  ${problems.length} STRUCTURAL PROBLEM(S):`);
  for (const p of problems) console.log(`    ✗ ${p}`);
  process.exit(1);
}
console.log("  ✓ every beat has a card, every card has a beat, footage keys line up.");
console.log("  Read the two columns above — the pairing itself is not machine-checkable.\n");
