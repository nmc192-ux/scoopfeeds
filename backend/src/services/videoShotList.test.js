import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shotListErrors, anchorIndex, subjectIsSpecific, SHOT_KINDS, SOURCE_INTENTS, KIND_INTENTS,
  MAX_PUNCH_SHOTS, MAX_AVG_SHOT_SECS,
} from "./videoShotList.js";
import { validateSpec } from "./videoSpecSchema.js";
import { buildSpecPrompt } from "./videoSpecWriter.js";

const S = (anchor, kind = "photo", subject = "Pituffik Space Base", source_intent = "photo") =>
  ({ anchor, kind, subject, source_intent });
// ~20 words: at 150 wpm that is 8.0 s, so three shots is 2.7 s each.
const CAP = "The pact was signed at the UN on Tuesday, and it lets America open two new bases in Greenland.";
const card = (shots, caption = CAP) => ({ t: "turn", caption, shots });

test("anchors are found as whole words, in order, from a position", () => {
  assert.equal(anchorIndex(CAP, "The pact"), 0);
  assert.equal(anchorIndex(CAP, "at the UN"), 4);
  assert.equal(anchorIndex(CAP, "Tuesday,"), 8, "punctuation does not matter");
  assert.equal(anchorIndex(CAP, "the pact", 1), -1, "searching after the first occurrence finds none");
  assert.equal(anchorIndex(CAP, "new bases in Greenland"), 15);
  assert.equal(anchorIndex(CAP, "Nuuk"), -1);
});

test("a well-formed shot list passes and reports its stats", () => {
  const r = shotListErrors([card([S("The pact was"), S("at the UN", "clip", "UN General Assembly hall", "footage"),
    S("open two new", "map", "Greenland", "map")])]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.shots, 3);
  assert.ok(r.stats.avgShotSecs <= MAX_AVG_SHOT_SECS);
});

test("an anchor not verbatim in the caption fails loudly", () => {
  const r = shotListErrors([card([S("The pact was"), S("at the United Nations")])]);
  assert.ok(r.errors.some((e) => /not verbatim in the caption/.test(e)), r.errors.join("\n"));
});

test("anchors must run in order, and the first one opens the caption", () => {
  const r1 = shotListErrors([card([S("The pact was"), S("open two new", "map", "Greenland", "map"), S("at the UN")])]);
  assert.ok(r1.errors.some((e) => /out of order/.test(e)), r1.errors.join("\n"));
  const r2 = shotListErrors([card([S("signed at the")])]);
  assert.ok(r2.errors.some((e) => /opening words/.test(e)), r2.errors.join("\n"));
});

test("closed sets: kind and source_intent, and they must fit each other", () => {
  const r = shotListErrors([card([S("The pact was", "drone"), S("at the UN", "photo", "UN", "vibes"),
    S("open two new", "satellite", "Greenland", "stock")])]);
  assert.ok(r.errors.some((e) => /unknown kind "drone"/.test(e)));
  assert.ok(r.errors.some((e) => /unknown source_intent "vibes"/.test(e)));
  assert.ok(r.errors.some((e) => /"satellite" shot cannot have source_intent "stock"/.test(e)));
});

test("subject is one noun phrase, never a sentence or a hedge", () => {
  const r = shotListErrors([card([S("The pact was", "photo", "Trump or Frederiksen"),
    S("at the UN", "photo", "the moment when the three leaders held up the signed pact")])]);
  assert.ok(r.errors.some((e) => /hedges/.test(e)));
  assert.ok(r.errors.some((e) => /noun phrase, not a sentence/.test(e)));
});

test("at most three shots per card, and a card with none is an error", () => {
  const r = shotListErrors([card([S("The pact was"), S("signed at the"), S("on Tuesday, and"), S("it lets America")]), card([])]);
  assert.ok(r.errors.some((e) => /4 shots/.test(e)));
  assert.ok(r.errors.some((e) => /missing "shots"/.test(e)));
});

test(`no more than ${MAX_PUNCH_SHOTS} punctuation cards per video`, () => {
  const p = (cap) => card([S(cap.split(" ").slice(0, 2).join(" "), "punch", "NOT A SALE", "card")], cap);
  const r = shotListErrors([p("Not a sale."), p("No end date."), p("Here is the turn.")]);
  assert.ok(r.errors.some((e) => /3 punctuation cards/.test(e)), r.errors.join("\n"));
});

test("average shot length over 3 s is REPORTED, never refused — the renderer sub-cuts", () => {
  const r = shotListErrors([card([S("The pact was")])]);   // 20 words / 1 shot = 8 s
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /estimated average shot length 7\.[0-9]s is over 3s/.test(w)), r.warnings.join("\n"));
  assert.ok(r.warnings.some((w) => /report only, nothing was refused/.test(w)));
});

// ─── Subject specificity (DrJ, 24 Sep 2026) ────────────────────────────────

test("specific subjects pass: names, places, organisations, documents, vessels, products, precise objects", () => {
  for (const sub of ["Mette Frederiksen", "Pituffik Space Base", "Bhotekoshi River", "2026 Global Gender Gap Report",
    "USS Gerald R. Ford", "iPhone 17", "Indian coast guard", "sea cucumber", "glacial lake outburst", "Xi Jinping"]) {
    assert.equal(subjectIsSpecific(sub, { outlets: ["DW English"] }), true, sub);
  }
});

test("generic subjects and outlet names fail — the exact ones the first dry run emitted", () => {
  for (const sub of ["money", "ocean", "fishery", "prison", "tech executives", "police patrol", "trade deficit",
    "Money", "the government", "DW English", "DW", "The Hill", "Artificial intelligence"]) {
    assert.equal(subjectIsSpecific(sub, { outlets: ["DW English", "The Hill"] }), false, sub);
  }
});

test("a generic subject is refused on picture kinds and allowed on count and graphic", () => {
  const cap = "The trade topped two hundred million dollars last year, and it is still growing fast.";
  const bad = shotListErrors([card([S("The trade topped", "photo", "money", "photo")], cap)]);
  assert.ok(bad.errors.some((e) => /"money" is too generic for a photo shot/.test(e)), bad.errors.join("\n"));
  for (const k of ["satellite", "map", "clip", "quote", "headline"]) {
    const intent = KIND_INTENTS[k][0];
    const r = shotListErrors([card([S("The trade topped", k, "ocean", intent)], cap)]);
    assert.ok(r.errors.some((e) => /too generic/.test(e)), `${k}: ${r.errors.join(" | ")}`);
  }
  for (const k of ["count", "graphic"]) {
    const r = shotListErrors([card([S("The trade topped", k, "money", "data")], cap)]);
    assert.ok(!r.errors.some((e) => /too generic/.test(e)), `${k} should allow a generic subject`);
  }
});

test("the outlet's own name is refused as a picture subject", () => {
  const r = shotListErrors([card([S("The pact was", "headline", "DW English", "card")])], { outlets: ["DW English"] });
  assert.ok(r.errors.some((e) => /"DW English" is too generic/.test(e)), r.errors.join("\n"));
});

// ─── The schema only asks when the flag asks ───────────────────────────────

const TEXT = "Reuters reported that 70 percent of cable faults involve anchors.";
const base = () => {
  const slides = [
    { t: "title", lines: [["THE CABLES", "white"]], caption: "Five hundred cables carry almost everything we send. Reported by Reuters." },
    { t: "diagram", nodes: [["SHORE", "landing"], ["TRUNK", "deep water"]], caption: "Each route runs from a landing station on the shore out to a deep trunk line." },
    { t: "turn", lines: [["NOT SABOTAGE", "white"]], caption: "But most breaks come from something far more ordinary than an attack at sea." },
    { t: "diagram", nodes: [["ANCHOR", "dragged"], ["CABLE", "cut"]], caption: "A dragged anchor near the shore is enough to cut a cable clean through." },
    { t: "turn", lines: [["SLOW FIX", "white"]], caption: "And the repair takes weeks, because only a few ships in the world can do it." },
    { t: "kicker", top: "ONE ANCHOR", bottom: "A WHOLE COAST", caption: "The next outage will come from a ship that never knew what lay beneath it." },
  ];
  const beats = slides.slice(1, -1).map((c, i) => ({ kind: ["mechanism", "turn", "mechanism", "consequence"][i], beat: "b", evidence: "70 percent of cable faults" }));
  return { beats, slides };
};

test("with shotList off, a spec without shots validates exactly as before", () => {
  const v = validateSpec(base(), { allowedSources: ["Reuters"], sourceText: TEXT });
  assert.equal(v.ok, true, v.errors.join("\n"));
  assert.equal(v.stats.shots, undefined);
});

test("with shotList on, the same spec is rejected for missing shots — and passes once they are there", () => {
  const off = validateSpec(base(), { allowedSources: ["Reuters"], sourceText: TEXT, shotList: true });
  assert.equal(off.ok, false);
  assert.ok(off.errors.some((e) => /missing "shots"/.test(e)));

  const s = base();
  for (const c of s.slides) {
    const w = c.caption.split(" ");
    c.shots = [0, 5, 10].filter((i) => i < w.length - 1)
      .map((i) => S(w.slice(i, i + 2).join(" "), "graphic", "cable route", "data"));
  }
  const on = validateSpec(s, { allowedSources: ["Reuters"], sourceText: TEXT, shotList: true });
  assert.equal(on.ok, true, on.errors.join("\n"));
  assert.equal(on.stats.shots.shots, s.slides.reduce((n, c) => n + c.shots.length, 0));
  assert.equal(on.spec.slides[1].shots.length, 3, "shots survive pruning");
  assert.equal(on.stats.slides, 6, "card count unchanged");
  assert.equal(on.stats.beats, 4, "beat count unchanged");
});

// ─── The prompt ─────────────────────────────────────────────────────────────

const promptFor = () => buildSpecPrompt({
  article: { title: "T", description: "D", content: "C", source_name: "Reuters", category: "world" },
  allowedSources: ["Reuters"],
});
const withFlag = (v, fn) => {
  const saved = process.env.VIDEO_SHOT_ENGINE_ENABLED;
  if (v === undefined) delete process.env.VIDEO_SHOT_ENGINE_ENABLED; else process.env.VIDEO_SHOT_ENGINE_ENABLED = v;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.VIDEO_SHOT_ENGINE_ENABLED; else process.env.VIDEO_SHOT_ENGINE_ENABLED = saved;
  }
};

test("flag off: the prompt is byte-identical and never mentions shots", () => {
  const unset = withFlag(undefined, promptFor);
  const zero = withFlag("0", promptFor);
  assert.equal(unset, zero);
  assert.ok(!/"shots"/.test(unset));
});

test("flag on: the prompt asks for shots, names every kind and intent, and still states no length", () => {
  const p = withFlag("1", promptFor);
  assert.match(p, /"shots" — ON EVERY CARD/);
  for (const k of SHOT_KINDS) assert.match(p, new RegExp(`\\n\\s+${k}\\s`), `kind ${k} missing from the prompt`);
  for (const i of SOURCE_INTENTS) assert.ok(p.includes(i), `intent ${i} missing`);
  for (const [k, allowed] of Object.entries(KIND_INTENTS)) assert.ok(allowed.every((a) => p.includes(a)), k);
  assert.match(p, /never changes which beats you found, how many cards you emit, or a single word of any caption/);
  assert.match(p, /REAL PICTURE CHANGE/);
  assert.match(p, /SPECIFIC ENOUGH TO SEARCH FOR/);
  assert.ok(!/six to eight/i.test(p), "the padding pressure is gone");
  // The same length-signal guard the main prompt test runs, now with shots on.
  const banned = [
    /\bAT LEAST \d+ cards?\b/i, /\bAT MOST \d+ cards?\b/i, /\bemit \d+ cards?\b/i, /\bexactly \d+ cards?\b/i,
    /\b\d+\s*(?:to|-|–)\s*\d+\s*cards?\b/i, /\baim for (?:about |roughly )?\d+\s*(?:cards?|slides?|words?)\b/i,
    /\b\d+\s*seconds?\b/i, /\b\d+\s*slides?\b/i, /\b\d+\s*minutes?\b/i, /target duration/i, /maximum runtime/i,
    /\bshots? per (?:video|short)\b/i, /\baverage shot\b/i,
  ];
  for (const re of banned) assert.ok(!re.test(p), `length signal ${re} leaked: ${p.match(re)?.[0]}`);
});

test("tone: unknown or missing never rejects a spec — it warns, and the keyword rules decide", () => {
  const s = base();
  for (const c of s.slides) {
    const w = c.caption.split(" ");
    c.shots = [0, 5, 10].filter((i) => i < w.length - 1).map((i) => S(w.slice(i, i + 2).join(" "), "graphic", "cable route", "data"));
  }
  const none = validateSpec(s, { allowedSources: ["Reuters"], sourceText: TEXT, shotList: true });
  assert.equal(none.ok, true, none.errors.join("\n"));
  assert.ok(none.warnings.some((w) => /no "tone"/.test(w)));
  const bad = validateSpec({ ...s, tone: "cheerful" }, { allowedSources: ["Reuters"], sourceText: TEXT, shotList: true });
  assert.equal(bad.ok, true);
  assert.equal(bad.spec.tone, undefined, "an unknown tone is dropped, not passed to the music");
  const good = validateSpec({ ...s, tone: "grief" }, { allowedSources: ["Reuters"], sourceText: TEXT, shotList: true });
  assert.equal(good.spec.tone, "grief");
});

test("the tone instruction appears only with the shot engine on", () => {
  assert.ok(!/TOP-LEVEL "tone"/.test(withFlag(undefined, promptFor)));
  const p = withFlag("1", promptFor);
  assert.match(p, /TOP-LEVEL "tone"/);
  for (const t of ["grief", "tense", "hopeful", "neutral"]) assert.match(p, new RegExp(`"${t}"`));
  assert.match(p, /never changes a beat, a card or a word of any caption/);
  assert.match(p, /MARKETS, ECONOMY AND BUSINESS NEWS IS "neutral"/);
  assert.match(p, /Only a crash, a collapse or a panic/);
});
