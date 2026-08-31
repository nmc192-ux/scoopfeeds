/**
 * rendercards.mjs — render EVERY card beat in the storyboard, and report.
 *
 * WHY. Narration cannot run in every environment (it needs an ElevenLabs key),
 * and build.mjs cannot run without narration, because beat durations come from
 * the measured takes. But the thing most likely to break a build is a CARD: a
 * field the renderer dereferences that the storyboard did not supply, a glyph
 * the font lacks, a layout that throws. Those are all reachable with satori
 * alone, so they can be caught here rather than on the machine doing the real
 * build.
 *
 * Renders each card at the entrance (p=0.2) and fully formed (p=1.0), because a
 * card can render at rest and still throw mid-animation.
 *
 * Read-only apart from out/cards/. Writes no film, publishes nothing.
 */
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = "/home/user/scoopfeeds/backend/src/services/longform/engine";
const { renderCard } = await import(`${ENGINE}/render.mjs`);
// THE ENGINE'S OWN WORD COUNT, not a reimplementation. Walking the spec's JSON
// counts its KEYS ("card", "kicker", "items", "label"...) and reported a 5-word
// stat card as nineteen words to read — which flagged 19 cards that are fine.
const { cardWords } = await import(`${ENGINE}/cardWords.mjs`);

const sb = JSON.parse(readFileSync(path.join(HERE, "storyboard.json"), "utf8"));
const beats = JSON.parse(readFileSync(path.join(HERE, "beats.json"), "utf8"));
const OUT = path.join(HERE, "out/cards");
mkdirSync(OUT, { recursive: true });

const cards = Object.entries(sb.beats)
  .filter(([, b]) => b.card)
  .map(([id, b]) => ({ id: Number(id), spec: b }))
  .sort((a, b) => a.id - b.id);

const failures = [];
let ok = 0;
for (const { id, spec } of cards) {
  for (const p of [0.2, 1.0]) {
    try {
      const suffix = p === 1 ? "" : "-enter";
      await renderCard(spec, path.join(OUT, `b${String(id).padStart(3, "0")}${suffix}.png`), p);
      ok++;
    } catch (e) {
      failures.push({ id, card: spec.card, p, err: String(e.message || e).split("\n")[0] });
    }
  }
  process.stdout.write(".");
}
process.stdout.write("\n");

const byType = {};
for (const c of cards) byType[c.spec.card] = (byType[c.spec.card] || 0) + 1;

console.log(`\n${cards.length} card beats · ${ok} renders ok · ${failures.length} failed`);
console.log(`  ${Object.entries(byType).sort().map(([k, v]) => `${k}×${v}`).join("  ")}`);
if (failures.length) {
  console.log(`\n  FAILURES:`);
  for (const f of failures) console.log(`    ✗ beat ${f.id} (${f.card}) @p=${f.p}: ${f.err}`);
  process.exit(1);
}

// Cards whose narration is much shorter than the card's own word count will be
// extended by build.mjs's readability hold (MAX_HOLD 1.8s). Worth knowing before
// the build, because a card that needs more hold than that is one a viewer
// cannot finish reading.
const READ_WPS = 3.0, MAX_HOLD = 1.8, WPS_SPOKEN = 164 / 60;
const tight = [];
for (const { id, spec } of cards) {
  const beat = beats.find((b) => b.id === id);
  if (!beat) continue;
  const spokenSecs = beat.text.trim().split(/\s+/).length / WPS_SPOKEN;
  const words = cardWords(spec);
  const needed = Math.max(1.4, words / READ_WPS);
  if (needed > spokenSecs + MAX_HOLD) tight.push({ id, card: spec.card, needed, spokenSecs });
}
if (tight.length) {
  console.log(`\n  ${tight.length} card(s) may out-run their narration even after the 1.8s hold:`);
  for (const t of tight) {
    console.log(`    · beat ${t.id} (${t.card}): ~${t.needed.toFixed(1)}s to read, ~${t.spokenSecs.toFixed(1)}s spoken`);
  }
  console.log(`    (estimate only — real durations come from the measured takes)`);
}
console.log(`\n  ✓ every card in the storyboard renders.\n`);
