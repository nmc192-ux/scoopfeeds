/**
 * storyboardSchema.test.js — the storyboard-as-data contract (#77).
 *
 * Named .test.js so it runs in the standard backend suite.
 *
 * THE LOAD-BEARING TEST IS THE GOLDEN ROUND-TRIP. Everything else here checks
 * that bad data is rejected; the golden test checks the thing that would sink
 * the design — whether JSON can carry a REAL film at all. It takes the shipped
 * 70-card hormuz-strait storyboard, converts it to the JSON representation,
 * runs it back through the interpreter, and requires the result to match what
 * importing the authored module produces. If the representation cannot express
 * a real film, we learn it here rather than after a generator is built on top.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { validateStoryboard, validateSpine, CARD_TYPES, CARD_SPECS } from "./longformStoryboardSchema.js";
import { interpretStoryboard, moduleToDoc } from "./storyboardInterpreter.js";

const TMP = mkdtempSync(path.join(os.tmpdir(), "sbschema-"));
const P = (...a) => path.join(TMP, ...a);

/** A minimal valid film, used as the base for rejection cases. */
const ok = (over = {}) => ({
  beats: {
    1: { card: "statement", lines: ["THE QUESTION"] },
    2: { card: "stat", figure: "$1,240", unit: "BN", label: "The cost." },
    3: { card: "chapter", n: "01", name: "THE MECHANISM" },
    4: { card: "ledger", rows: [{ who: "IMO", what: "Declared it closed." }] },
    5: { card: "statement", lines: ["THE ANSWER"] },
  },
  ...over,
});

// ── Structure ───────────────────────────────────────────────────────────────

test("a well-formed storyboard validates clean", () => {
  assert.deepEqual(validateStoryboard(ok()), []);
});

test("beats must be contiguous and start at 1", () => {
  const gap = ok({ beats: { 1: { card: "outro" }, 3: { card: "outro" } } });
  assert.match(validateStoryboard(gap).join("\n"), /not contiguous: 1 → 3/);
  const late = ok({ beats: { 4: { card: "outro" }, 5: { card: "outro" } } });
  assert.match(validateStoryboard(late).join("\n"), /must start at 1/);
});

test("a beat is exactly one thing — never both a card and media", () => {
  const both = ok({ beats: { 1: { card: "outro", footage: "F_SEA" } } });
  assert.match(validateStoryboard(both).join("\n"), /is both card and footage/);
  const neither = ok({ beats: { 1: { kicker: "ORPHAN" } } });
  assert.match(validateStoryboard(neither).join("\n"), /neither a card nor media/);
});

// ── Cards ───────────────────────────────────────────────────────────────────

test("an unknown card type is rejected, listing the known ones", () => {
  const errs = validateStoryboard(ok({ beats: { 1: { card: "montage" } } }));
  assert.match(errs.join("\n"), /unknown card type "montage"/);
  assert.match(errs.join("\n"), /statement/, "the message must list what IS valid");
});

test("every card type's required fields are enforced", () => {
  for (const card of CARD_TYPES) {
    const { req } = CARD_SPECS[card];
    if (!req.length) continue;               // outro/map carry no unguarded field
    const errs = validateStoryboard(ok({ beats: { 1: { card } } }));
    for (const f of req) {
      assert.match(errs.join("\n"), new RegExp(`missing required field "${f}"`),
        `${card} must require ${f}`);
    }
  }
});

test("a typo'd field is rejected rather than silently ignored", () => {
  // The failure this prevents: `lable:` renders a card with no label at all,
  // and nothing complains until someone watches the film.
  const errs = validateStoryboard(ok({
    beats: { 1: { card: "stat", figure: "1", label: "x", lable: "typo" } },
  }));
  assert.match(errs.join("\n"), /unknown field "lable"/);
});

test("field SHAPES are checked, not just presence", () => {
  const bad = ok({ beats: {
    1: { card: "statement", lines: "not an array" },
    2: { card: "ledger", rows: [{ who: "only-who" }] },
    3: { card: "bars", items: [{ label: "A", value: "not a number", display: "A" }] },
  } });
  const j = validateStoryboard(bad).join("\n");
  assert.match(j, /"lines" must be a non-empty array of strings/);
  assert.match(j, /"rows" must be a non-empty array of \{ who, what \}/);
  assert.match(j, /"items" must be a non-empty array/);
});

test("dangling media references are caught", () => {
  const j = validateStoryboard(ok({
    beats: { 1: { photo: "P_GHOST" }, 2: { card: "doc", docKey: "D_GHOST" } },
    photos: {}, docs: {},
  })).join("\n");
  assert.match(j, /photo "P_GHOST" is not in storyboard.photos/);
  assert.match(j, /docKey "D_GHOST" is not in storyboard.docs/);
});

test("a tweet card must name a statement that is actually archived", () => {
  const doc = ok({ beats: { 1: { card: "tweet", statementId: "1900000000000000001" } } });
  assert.deepEqual(validateStoryboard(doc, { statementIds: ["1900000000000000001"] }), []);
  assert.match(
    validateStoryboard(doc, { statementIds: ["999"] }).join("\n"),
    /not in the evidence archive — capture it first/);
});

test("a map needs a registry variant or inline geo, never neither", () => {
  assert.match(validateStoryboard(ok({ beats: { 1: { card: "map" } } })).join("\n"),
    /needs "variant" \(registry\) or "geo" \(inline data\)/);
  assert.deepEqual(validateStoryboard(ok({ beats: { 1: { card: "map", variant: "hormuz" } } })), []);
});

// ── Shorts and reveal ───────────────────────────────────────────────────────

test("a Short may not open on a chapter divider", () => {
  const doc = ok({ shorts: [{ name: "a", from: 3, to: 5, title: "T", hook: "H" }] });
  assert.match(validateStoryboard(doc).join("\n"),
    /opens on chapter divider beat 3 — a Short must open on content/);
});

test("Short boundaries must exist and run forwards", () => {
  const j = validateStoryboard(ok({ shorts: [
    { name: "a", from: 4, to: 2, title: "T", hook: "H" },
    { name: "b", from: 1, to: 99, title: "T", hook: "H" },
  ] })).join("\n");
  assert.match(j, /"to" \(2\) must be after "from" \(4\)/);
  assert.match(j, /"to" beat 99 does not exist/);
});

test("the reveal must name a real beat — music.mjs cannot resolve undefined", () => {
  assert.deepEqual(validateStoryboard(ok({ reveal: 4 })), []);
  assert.match(validateStoryboard(ok({ reveal: 99 })).join("\n"), /is not one of the film's beats/);
});

// ── The STORY SPINE's mechanical parts ──────────────────────────────────────

test("the spine's four elements are required, and its timing is checked", () => {
  const bare = validateSpine(ok()).join("\n");
  for (const f of ["throughLine", "question", "reveal", "escalation"]) {
    assert.match(bare, new RegExp(`spine.${f}: missing`));
  }
  const full = (over) => validateSpine(ok({
    spine: { throughLine: "the ship", question: "what if", reveal: "the count",
             escalation: "each chapter raises", ...over },
  }));
  assert.deepEqual(full({ questionBeat: 1, answerBeat: 5 }), [],
    "question early, answer last → clean");
  assert.match(full({ questionBeat: 4, answerBeat: 5 }).join("\n"),
    /is not early .* the debt must be created up front/s);
  assert.match(full({ questionBeat: 1, answerBeat: 2 }).join("\n"),
    /is not late .* answering early leaves the viewer owed nothing/s);
});

// ── THE GOLDEN TEST ─────────────────────────────────────────────────────────

const HORMUZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../.claude/skills/video-factory/projects/hormuz-strait/storyboard.mjs");

test("GOLDEN: a real 70-card film round-trips through the JSON representation", async (t) => {
  if (!existsSync(HORMUZ)) return t.skip(`fixture absent: ${HORMUZ}`);
  const mod = await import(pathToFileURL(HORMUZ).href);

  // 1. The authored module converts to the JSON representation…
  const doc = moduleToDoc(mod);
  const errs = validateStoryboard(doc);
  assert.deepEqual(errs, [],
    `a REAL shipped film must validate against the schema. Problems:\n  ${errs.join("\n  ")}`);

  // 2. …and the interpreter reproduces what the module exports.
  const out = interpretStoryboard(doc, { P, strict: false });
  const authoredIds = Object.keys(mod.STORYBOARD).map(Number).sort((a, b) => a - b);
  const interpretedIds = Object.keys(out.STORYBOARD).map(Number).sort((a, b) => a - b);
  assert.deepEqual(interpretedIds, authoredIds, "every beat must survive the round trip");

  for (const id of authoredIds) {
    const a = mod.STORYBOARD[id], b = out.STORYBOARD[id];
    if (a.doc) { assert.equal(b.doc, a.doc, `beat ${id}: doc reference lost`); continue; }
    if (a.footage) { assert.equal(b.footage, a.footage, `beat ${id}: footage lost`); continue; }
    if (a.photo) { assert.equal(b.photo, a.photo, `beat ${id}: photo lost`); continue; }
    assert.equal(b.card, a.card, `beat ${id}: card type changed`);
    for (const [k, v] of Object.entries(a)) {
      assert.deepEqual(b[k], v, `beat ${id} (${a.card}): field "${k}" did not survive`);
    }
  }

  // 3. The grades the film relies on are all present.
  for (const g of Object.keys(mod.GRADES || {})) {
    assert.ok(out.GRADES[g], `grade "${g}" missing from the interpreter's palette`);
  }
  assert.equal(out.BEAT_COUNT, authoredIds.length);
});

test("the interpreter refuses invalid data rather than rendering part of it", () => {
  assert.throws(
    () => interpretStoryboard({ beats: { 1: { card: "montage" } } }, { P }),
    /invalid storyboard/);
});

test("a tweet beat cannot be interpreted without the evidence archive", () => {
  const doc = ok({ beats: { 1: { card: "tweet", statementId: "42" } } });
  assert.throws(
    () => interpretStoryboard(doc, { P, strict: false }),
    /needs loadStatement to resolve "42"/);
  const out = interpretStoryboard(doc, { P, strict: false,
    loadStatement: (id) => ({ id, text: "archived words" }) });
  assert.equal(out.STORYBOARD[1].statement.text, "archived words");
  assert.equal(out.STORYBOARD[1].statementId, undefined, "the id is replaced by the record");
});

test("a numeric chapter n is coerced to a padded string — satori refuses a numeric text child", () => {
  const doc = { beats: { 1: { card: "chapter", n: 1, name: "The Phantom Think Tank" } } };
  const out = interpretStoryboard(doc, { P, strict: false });
  assert.equal(out.STORYBOARD[1].n, "01",
    "n: 1 fails the whole build inside satori; n: \"01\" is also the house numeral style");
});

test("a present geo must parse — a region-code string satisfied variant-or-geo and died in the build", () => {
  const badGeo = ok({ beats: { 1: { card: "map", geo: "AU-NSW" } } });
  assert.match(validateStoryboard(badGeo).join("\n"), /geo geo: not an object/,
    "a region-code string is not the mapGeo grammar");
});

test("a doc beat may reference a CAPTURED key before its table row exists — the row is merged after validation", () => {
  const withRoster = ok({ beats: { 1: { card: "doc", docKey: "DOC_REUTERS_1" } } });
  assert.deepEqual(validateStoryboard(withRoster, { docKeys: ["DOC_REUTERS_1"] }), []);
  assert.match(validateStoryboard(withRoster, { docKeys: [] }).join("\n"),
    /not a captured document/, "with an empty roster the same beat is refused");
  assert.match(validateStoryboard(withRoster).join("\n"),
    /not in storyboard.docs/, "no roster at all: the hand-authored rule still applies");
});

test("a photo beat may reference an ACQUIRED key before its table row exists, and ken is in/out only", () => {
  const doc = ok({ beats: { 1: { photo: "P_STREET_1", ken: "in" } } });
  assert.deepEqual(validateStoryboard(doc, { photoKeys: ["P_STREET_1"] }), []);
  assert.match(validateStoryboard(doc, { photoKeys: [] }).join("\n"), /not an acquired photo/);
  const badKen = ok({ beats: { 1: { photo: "P_STREET_1", ken: "zoom" } } });
  assert.match(validateStoryboard(badKen, { photoKeys: ["P_STREET_1"] }).join("\n"),
    /the only moves are "in" and "out"/);
});

// ── decay and split (the xylitol film's D2 and D4) ───────────────────────────
//
// Both cards were added because the film needed a claim the existing types
// could not make. `decay` draws a computed exponential curve on a REAL time
// axis — linechart plots authored points at index spacing, which would have
// drawn "13 minutes" and "12 hours" the same distance apart. `split` shows a
// figure beside a panel stamped NOT PUBLISHED, so a card can say a number is
// missing. The tests below pin the ways each can be authored into a lie.

const decay = (over = {}) => ok({
  beats: { 1: { card: "decay", peak: 1000, baseline: 1, halfLife: 13, xMax: 360, ...over } },
});

test("decay: a well-formed curve validates", () => {
  assert.deepEqual(validateStoryboard(decay({
    xAxis: [{ at: 0, label: "DRINK" }, { at: 240, label: "4 HRS" }],
    yAxis: [{ at: 1000, label: "1,000×" }],
    marks: [{ at: 13, label: "Half-life" }],
    beyond: { label: "SAMPLE AT 12 HRS" },
  })), []);
});

test("decay: a curve that would rise is refused", () => {
  // peak below baseline draws a line going UP and labels it a decay.
  assert.match(validateStoryboard(decay({ peak: 1, baseline: 1000 })).join("\n"),
    /peak \(1\) must be above baseline \(1000\)/);
});

test("decay: halfLife must be positive — zero divides the curve into NaN", () => {
  assert.match(validateStoryboard(decay({ halfLife: 0 })).join("\n"),
    /"halfLife" must be a positive number/);
});

test("decay: an annotation past the axis is refused, and told about `beyond`", () => {
  // Pinned at the axis edge, a 12-hour sample would render as if it happened
  // at 6 hours — the exact opposite of the point the card exists to make.
  const errs = validateStoryboard(decay({ marks: [{ at: 720, label: "SAMPLE" }] }));
  assert.match(errs.join("\n"), /outside the axis \(0–360\)/);
  assert.match(errs.join("\n"), /use "beyond"/, "the message must name the supported way");
});

test("decay: x ticks too close together are refused before they overprint", () => {
  // This is the "DRISKMIN" case: DRINK at 0 and 13 MIN at 13 on a 360 axis
  // rendered the two labels on top of each other.
  const errs = validateStoryboard(decay({
    xAxis: [{ at: 0, label: "DRINK" }, { at: 13, label: "13 MIN" }],
  }));
  assert.match(errs.join("\n"), /"DRINK" and "13 MIN" are 13 apart/);
  assert.match(errs.join("\n"), /overprint/);
});

test("decay: ticks given out of order are still compared as neighbours", () => {
  const errs = validateStoryboard(decay({
    xAxis: [{ at: 300, label: "5 HRS" }, { at: 0, label: "DRINK" }, { at: 310, label: "OOPS" }],
  }));
  assert.match(errs.join("\n"), /"5 HRS" and "OOPS" are 10 apart/);
});

test("split: a panel carries a figure OR a stamp, never both and never neither", () => {
  const panels = (left, right) => validateStoryboard(ok({
    beats: { 1: { card: "split", left, right } },
  })).join("\n");

  assert.equal(panels({ label: "Relative", figure: "+57%" },
                      { label: "Absolute", stamp: "NOT PUBLISHED" }), "");
  // Both: the author meant one of them and the renderer silently picks.
  assert.match(panels({ label: "x", figure: "+57%", stamp: "NOT PUBLISHED" },
                      { label: "y", stamp: "NONE" }), /exactly one of figure\/stamp/);
  // Neither: an empty panel with no explanation of why it is empty.
  assert.match(panels({ label: "x" }, { label: "y", stamp: "NONE" }),
    /exactly one of figure\/stamp/);
  // A panel with no label at all.
  assert.match(panels({ figure: "+57%" }, { label: "y", stamp: "NONE" }),
    /exactly one of figure\/stamp/);
});
