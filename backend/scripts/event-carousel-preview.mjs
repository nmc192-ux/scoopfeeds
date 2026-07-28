#!/usr/bin/env node
/**
 * event-carousel-preview — generate (or show cached) carousel copy for ONE
 * event and print it. Nothing is posted and no card is rendered.
 *
 * This is the single live run the build plan calls for: it exercises the real
 * Gemini path through llmQueue, the real grounding validator, and the real
 * event_carousel_copy cache, so the copy can be read by a human before any of
 * it reaches Instagram.
 *
 *   node scripts/event-carousel-preview.mjs --slug <event-slug>
 *   node scripts/event-carousel-preview.mjs --id <event-id>
 *   node scripts/event-carousel-preview.mjs --top        # highest-source qualifying event
 *   node scripts/event-carousel-preview.mjs --top --dry  # show inputs only, no LLM call
 *
 * --dry prints the context bundle and the exact prompt WITHOUT calling the
 * model, so the payload can be inspected before spending a call.
 *
 * Re-running for the same event does NOT re-call the model: a successful row
 * in event_carousel_copy is returned from cache (that is the whole point of
 * the table). Use a different event, or let the dossier change, to force a
 * fresh generation.
 */

import "../src/config/env.js";
import { getDb } from "../src/models/database.js";
import { listQualifyingEvents, coverageForEvent, carouselBar } from "../src/realityIndex/dal/eventsDao.js";
import { ensureEventCarouselCopy, readCachedCopy, __test__ } from "../src/realityIndex/generation/eventCarouselCopy.js";

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? (argv[i + 1] ?? true) : null; };
const has  = (name) => argv.includes(name);

function pickEvent(db) {
  const slug = flag("--slug");
  const id   = flag("--id");
  if (typeof slug === "string") return db.prepare("SELECT * FROM events WHERE slug = ?").get(slug);
  if (typeof id === "string")   return db.prepare("SELECT * FROM events WHERE id = ?").get(id);
  if (has("--top")) {
    const top = listQualifyingEvents({ limit: 1 })[0];
    return top ? db.prepare("SELECT * FROM events WHERE id = ?").get(top.id) : null;
  }
  return null;
}

const db = getDb();
const event = pickEvent(db);
if (!event) {
  console.error("No event selected. Use --slug <s>, --id <i>, or --top.");
  console.error(`Bar in effect: ${JSON.stringify(carouselBar())}`);
  process.exit(1);
}

const coverage = coverageForEvent(event.id);
console.log("──────────────────────────────────────────────────────────────");
console.log(`EVENT     ${event.title}`);
console.log(`slug      ${event.slug}`);
console.log(`category  ${event.category}   status: ${event.status}`);
console.log(`coverage  ${coverage.articles} articles · ${coverage.sources} sources   (bar: ${JSON.stringify(carouselBar())})`);
console.log(`summary   ${event.summary || "(none)"}`);
console.log("──────────────────────────────────────────────────────────────");

const ctx = __test__.buildContext(db, event);
console.log(`\nCONTEXT BUNDLE — ${ctx.snippets.length} snippets, ~${Math.round(ctx.corpus.length / 4)} tokens of source text`);
ctx.snippets.forEach((s, i) => console.log(`  [${i + 1}] ${s.slice(0, 140)}${s.length > 140 ? "…" : ""}`));

if (has("--dry")) {
  console.log("\n--- PROMPT (dry run — no LLM call made) ---\n");
  console.log(__test__.buildPrompt(ctx));
  process.exit(0);
}

const cachedBefore = readCachedCopy(event.id);
if (cachedBefore) console.log("\n(cached copy already exists — this run will NOT call the model)");

const copy = await ensureEventCarouselCopy(event.id);

if (!copy) {
  console.log("\nRESULT: REFUSED — no carousel copy. This event would fall back to the");
  console.log("3-slide article carousel. See the log line above for the reason.");
  process.exit(0);
}

console.log("\n=== SLIDE 4 — THE DETAILS ===");
copy.details.forEach(d => console.log(`  - ${d}   (${d.length} chars)`));
console.log("\n=== SLIDE 5 — THE NUMBERS ===");
copy.figures.forEach(f => {
  console.log(`  ${f.value}  —  ${f.label}`);
  console.log(`      grounded in: "${f.source_sentence}"`);
});
console.log("\n=== SLIDE 6 — WHY IT MATTERS ===");
console.log(`  ${copy.why_it_matters}   (${copy.why_it_matters.length} chars)`);
console.log("\nEvery figure above was substring-verified against the source text shown at the top.");
