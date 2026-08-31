/**
 * mkstoryboard.mjs — author storyboard.json against the schema, then validate.
 *
 * Every beat is a card or a piece of media. Cards are authored EXPLICITLY below,
 * keyed by the beat number they land on; every other beat defaults to footage,
 * so a beat can never be silently missing. The footage keys are names, not
 * files — acquisition fills the table later (Section 4 of the brief).
 *
 * THE SIX DATA FRAMES, and where the brief's spec met the engine:
 *
 *  D1  beats 31-34, four `bars` cards. The brief wants lime to move from bar to
 *      bar as each cohort is narrated; `bars` marks ONE bar `hot` and makes it
 *      the payoff, so this is four cards over four beats rather than one card
 *      animating four times. Same picture, and it cuts on the narration.
 *      The tertiles/quartiles footnote rides `src` on all four — the brief
 *      makes it mandatory on the frame, so it is on every frame, not just one.
 *
 *  D2  beats 50 and 54, two `decay` cards. The second is the payoff of the
 *      whole film: the curve and the half-life mark land at 50, and `beyond`
 *      is withheld until 54, where the narration says "by the time that needle
 *      went in". Splitting it across two beats is what lets the sample marker
 *      arrive ON the line about the sample rather than eight seconds early.
 *
 *  D3  beats 78-80, `bars`, climbing with the kitchen scale.
 *  D4  beat 86, `split` — the NOT PUBLISHED panel.
 *  D5  beat 88, `ledger` with `muted` — the greyed ghost rows. NOT a `doc`
 *      card; see the note at that beat.
 *  D6  beat 98, `stat`.
 *
 * WORD ANCHORS. Five cards carry `revealOn`, so their payoff lands on a word
 * instead of at ~30% of the line: the sample arrow on "that needle went in",
 * the CLSA bar on "Fifty-seven", the 30 g bar on "about a pint", the NOT
 * PUBLISHED stamp on "tell you what it means", and the sweetener ledger on
 * "now xylitol". Each degrades to the old proportional timing if the take
 * carries no alignment — see engine/wordTimings.mjs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { validateStoryboard } = await import(
  "/home/user/scoopfeeds/backend/src/services/longform/longformStoryboardSchema.js");

const beats = JSON.parse(readFileSync(path.join(HERE, "beats.json"), "utf8"));

const SRC_ESC = "ESC CONGRESS 2026";
const SRC_EHJ = "EUR HEART J 2024;45:2439–2452";
const SRC_NM = "NATURE MEDICINE 2023;29:710–718";
// MANDATORY ON THE D1 FRAME, per the brief, and said aloud at beat 35-37.
const D1_FOOTNOTE = "COMPARISON GROUPS DIFFER — TERTILES AND QUARTILES. ILLUSTRATIVE, NOT A META-ANALYSIS.";

/** The five-cohort bar set. `hotKey` picks the bar lime lands on. */
const COHORTS = [
  { key: "eryClev", label: "Erythritol — Cleveland, 3yr", value: 80, display: "+80%" },
  { key: "eryBerl", label: "Erythritol — Berlin, 3yr", value: 121, display: "+121%" },
  { key: "xylVal", label: "Xylitol — validation, 3yr", value: 57, display: "+57%" },
  { key: "xylClsa", label: "Xylitol — CLSA, 6yr", value: 57, display: "+57%" },
  { key: "xylEpic", label: "Xylitol — EPIC-Norfolk, 30yr", value: 18, display: "+18%" },
];
const d1 = (hotKey, kicker, revealOn) => ({
  card: "bars", kicker, ...(revealOn ? { revealOn } : {}), title: "Five cohorts. Two sugar alcohols. Same direction.",
  items: COHORTS.map((c) => ({ ...c, key: undefined, ...(c.key === hotKey ? { hot: true } : {}) }))
    .map(({ label, value, display, hot }) => (hot ? { label, value, display, hot } : { label, value, display })),
  src: D1_FOOTNOTE,
});

/** D2. `withBeyond` withholds the sample marker until the line about it. */
const d2 = (withBeyond) => ({
  card: "decay",
  kicker: "PLASMA XYLITOL AFTER A 30 g DRINK",
  title: withBeyond ? "It is gone long before the blood is drawn." : "Thirteen minutes.",
  peak: 1000, baseline: 1, halfLife: 13, xMax: 360,
  yAxis: [{ at: 1000, label: "1,000×" }, { at: 500, label: "500×" }, { at: 1, label: "BASELINE" }],
  xAxis: [{ at: 0, label: "DRINK" }, { at: 120, label: "2 HRS" }, { at: 240, label: "4 HRS" }, { at: 360, label: "6 HRS" }],
  marks: [{ at: 13, label: "Half-life ≈ 13 min" }],
  ...(withBeyond ? { beyond: { label: "BLOOD SAMPLE TAKEN — 12 HRS" } } : {}),
  ...(withBeyond ? { note: "The cohorts sampled after an overnight fast." } : {}),
  // The arrow lands ON the words about the needle, not at 30% of the line.
  ...(withBeyond ? { revealOn: "that needle went in" } : {}),
  src: SRC_EHJ,
});

const CARDS = {
  // ── cold open ──
  4: { card: "stat", kicker: "THE STUDY", figure: "17,710", label: "People, in two population cohorts, followed for up to thirty years.", src: SRC_ESC, roll: true },
  6: { card: "statement", kicker: "WHAT THE COVERAGE MISSED", lines: ["ONE DETAIL", "CHANGES", "WHAT IT MEANS"] },

  // ── ch 1 ──
  7: { card: "statement", kicker: "BEFORE WE START", lines: ["NOT MEDICAL ADVICE"] },
  12: { card: "stat", kicker: "DIETARY VS ENDOGENOUS", figure: "1,000×", label: "More xylitol is added to food than your body makes.", src: SRC_EHJ, roll: true },
  13: { card: "title", kicker: "ESC CONGRESS 2026 · MUNICH", lines: ["THE XYLITOL", "STUDY"], sub: "Presented 29 August 2026 by a team from the Charité, Berlin." },
  18: { card: "stat", kicker: "CLSA · 6-YEAR FOLLOW-UP", figure: "+57%", label: "Higher risk of death, heart attack or stroke — top versus bottom quartile.", src: SRC_ESC },
  19: { card: "stat", kicker: "EPIC-NORFOLK · 30-YEAR FOLLOW-UP", figure: "+18%", label: "The same direction, over thirty years.", src: SRC_ESC },
  21: { card: "statement", kicker: "WHY IT MATTERS", lines: ["MORE IN THE BLOOD,", "MORE EVENTS.", "THAT IS A DOSE-RESPONSE."] },

  // ── ch 2 ──
  22: { card: "chapter", n: "02", name: "Why this one is harder to dismiss" },
  25: { card: "ledger", kicker: "WHAT CHANGED", title: "The 2024 study, and this one.",
        rows: [
          { who: "2024", what: "≈3,300 cardiac patients · 3 years" },
          { who: "2026", what: "17,710 general population · up to 30 years", hot: true },
        ], src: SRC_ESC },

  // ── ch 3 — D1 ──
  29: { card: "chapter", n: "03", name: "Five cohorts, two sweeteners, one direction" },
  31: d1("eryBerl", "ERYTHRITOL · NATURE MEDICINE 2023"),
  32: d1("xylVal", "XYLITOL · EUROPEAN HEART JOURNAL 2024"),
  33: d1("xylClsa", "XYLITOL · ESC CONGRESS 2026", "Fifty-seven"),
  34: d1(null, "FIVE COHORTS"),
  // WORDS, NOT "≠". Anton's not-equal glyph is drawn as an equals sign, so this
  // card rendered "TERTILES = QUARTILES" — the opposite of the caveat it exists
  // to make. engine/confusables.mjs now refuses the character outright.
  37: { card: "statement", kicker: "READ THE CHART CAREFULLY", lines: ["TERTILES", "ARE NOT", "QUARTILES"], src: D1_FOOTNOTE },

  // ── ch 4 ──
  41: { card: "chapter", n: "04", name: "Clotting, not cholesterol" },
  44: { card: "stat", kicker: "THE INTERVENTIONAL ARM", figure: "30 g", label: "Xylitol in a drink, given to ten healthy volunteers.", src: SRC_EHJ },
  // The script says "within thirty minutes", so the frame carries that number
  // rather than an arrow — the brief's rule is that every spoken number gets a
  // frame behind it, and "↑" is not the number he said.
  45: { card: "stat", kicker: "TIME TO EFFECT", figure: "30", unit: "MIN", label: "Several measures of platelet stickiness had risen.", src: SRC_EHJ },
  46: { card: "stat", kicker: "ERYTHRITOL · 20 VOLUNTEERS", figure: "1,000×", label: "Levels rose over a thousandfold, from one sugar-free soda.", src: SRC_NM },

  // ── ch 5 — D2, the turn ──
  48: { card: "chapter", n: "05", name: "The thirteen minutes nobody reported" },
  50: d2(false),
  51: { card: "stat", kicker: "HALF-LIFE IN BLOOD", figure: "13", unit: "MIN", label: "Back to baseline within four to six hours.", src: SRC_EHJ },
  53: { card: "statement", kicker: "WHEN THE BLOOD WAS TAKEN", lines: ["AFTER AN", "OVERNIGHT FAST"] },
  54: d2(true),
  57: { card: "quote", text: "The plasma levels in their observational cohort represent variations in endogenous production, and not food intake.",
        who: "Witkowski et al.", role: "European Heart Journal, 2024 — the authors' own words" },
  61: { card: "statement", kicker: "THE OPEN QUESTION", lines: ["MARKER,", "OR CAUSE?"] },

  // ── ch 6 ──
  63: { card: "chapter", n: "06", name: "The argument back — and a disclosure" },
  71: { card: "stat", kicker: "A SEPARATE DOUBLE-BLINDED STUDY", figure: "7 g", label: "Dietary xylitol produced no detectable rise in blood levels.", src: "EUR HEART J COMMENTARY, 2024" },
  75: { card: "statement", kicker: "DISCLOSURE", lines: ["THE SENIOR AUTHOR HOLDS", "PATENTS WITH HIS INSTITUTION", "ON CARDIOVASCULAR DIAGNOSTICS"], src: SRC_NM },

  // ── ch 7 — D3, D4, D5 ──
  77: { card: "chapter", n: "07", name: "Your packet, and the gap on the label" },
  78: { card: "bars", kicker: "THE DOSE LADDER", title: "What is actually in the things you buy.",
        items: [{ label: "One piece of gum", value: 1, display: "0.2–1 g" }], src: "FDA · MERCK VETERINARY MANUAL · ESC" },
  79: { card: "bars", kicker: "THE DOSE LADDER", title: "What is actually in the things you buy.",
        items: [{ label: "One piece of gum", value: 1, display: "0.2–1 g" },
                { label: "Dental dose, per day", value: 10, display: "5–10 g" }], src: "DENTAL CONSENSUS" },
  80: { card: "bars", kicker: "THE DOSE LADDER", title: "What is actually in the things you buy.",
        items: [{ label: "One piece of gum", value: 1, display: "0.2–1 g" },
                { label: "Dental dose, per day", value: 10, display: "5–10 g" },
                { label: "The study's test dose", value: 30, display: "30 g", hot: true }],
        src: "≈ A PINT OF XYLITOL-SWEETENED ICE CREAM — THE RESEARCHERS' OWN COMPARISON",
        revealOn: "about a pint" },
  86: { card: "split", kicker: "THE NUMBER THAT ISN'T THERE", title: "Fifty-seven per cent more than what?",
        left: { label: "Relative risk increase — top vs bottom quartile", figure: "+57%" },
        right: { label: "Events per 1,000 people", stamp: "NOT PUBLISHED" },
        note: "Without the underlying event rate, nobody can convert this into your risk.",
        revealOn: "tell you what it means", src: SRC_ESC },
  // D5. NOT a `doc` card. `doc` captures a WEB DOCUMENT with phrase highlights
  // (capture-measured.mjs, Chromium, local-only) — but the brief's D5 has
  // "Ground: none (real label footage)", i.e. the graphic sits OVER footage of
  // a real panel, which in this engine means a card beside footage beats, not a
  // screenshot. The brief's own description of the frame — the line splitting
  // into "stacked ghost rows — xylitol / erythritol / sorbitol / maltitol — all
  // greyed, all unlabelled" — is precisely what `ledger` renders when no row is
  // hot and every `what` is empty. Modelling it as `doc` also made the beat
  // un-renderable anywhere without Chromium, for no gain.
  88: { card: "ledger", kicker: "WHAT THE PANEL DOES NOT TELL YOU", title: "Sugar alcohols are not required to be listed individually.",
        rows: [{ who: "Xylitol", what: "" }, { who: "Erythritol", what: "" },
               { who: "Sorbitol", what: "" }, { who: "Maltitol", what: "" }],
        muted: true, src: "NIH" },
  92: { card: "statement", kicker: "THE PUBLIC HEALTH PROBLEM", lines: ["YOU CANNOT MEASURE", "AN EXPOSURE YOU ARE", "NOT PERMITTED TO SEE"] },

  // ── ch 8 — D6 ──
  93: { card: "chapter", n: "08", name: "The part that isn't debated" },
  94: { card: "statement", kicker: "NOT DEBATED", lines: ["XYLITOL IS", "SEVERELY TOXIC", "TO DOGS"] },
  96: { card: "stat", kicker: "HYPOGLYCAEMIA THRESHOLD", figure: "0.1", unit: "g/kg", label: "Onset within ten to sixty minutes.", src: "FDA · MERCK VETERINARY MANUAL" },
  98: { card: "stat", kicker: "A 10 kg DOG", figure: "≈1 g", label: "One or two pieces of gum.", src: "FDA · MERCK VETERINARY MANUAL" },

  // ── ch 9 ──
  103: { card: "chapter", n: "09", name: "How I actually read it" },
  105: { card: "statement", kicker: "WHAT IS ESTABLISHED", lines: ["ASSOCIATION —", "NOT YET CAUSATION"] },
  114: { card: "ledger", kicker: "EVERY ONE ARRIVED AS THE SAFE ANSWER", title: "Still being studied, decades later.",
         rows: [{ who: "Saccharin", what: "" }, { who: "Aspartame", what: "" }, { who: "Sucralose", what: "" },
                { who: "Erythritol", what: "" }, { who: "Xylitol", what: "", hot: true }],
         revealOn: "now xylitol" },
  115: { card: "statement", kicker: "", lines: ['"SUGAR FREE" TELLS YOU', "WHAT ISN'T IN IT."] },
};

/** Footage default per chapter — acquisition resolves these to files. */
const CHAPTER_FOOTAGE = {
  "COLD OPEN": "F_GUM_PACKET_HAND",
  "CH 1 — WHAT THEY FOUND": "F_LAB_TUBES_RACK",
  "CH 2 — WHY THIS ONE IS HARDER TO DISMISS": "F_CROWD_STREET_SLOMO",
  "CH 3 — THE PATTERN": "F_KETO_SHELF",
  "CH 4 — WHY CLOTTING, NOT CHOLESTEROL": "F_DROPLET_COLLISION_MACRO",
  "CH 5 — THE THIRTEEN MINUTES": "F_STOPWATCH_MACRO",
  "CH 6 — THE ARGUMENT BACK": "F_IV_DRIP_BAG",
  "CH 7 — YOUR PACKET, AND THE THING NOBODY CAN CHECK": "F_KITCHEN_SCALE_POWDER",
  "CH 8 — THE PART THAT ISN'T DEBATED": "F_DOG_KITCHEN_COUNTER",
  "CH 9 — HOW I READ IT": "F_GUM_PACKET_HAND",
};

/**
 * Footage that is about THIS beat rather than this chapter. The chapter default
 * is a bed; these are the shots the narration actually names, so they override.
 * D5's real Nutrition Facts panel lives here (Tier 2 #22): the ghost-row card at
 * 88 is the graphic, and 89-90 are the label itself under the lines about it.
 */
const FOOTAGE_AT = {
  2: "F_SUPERMARKET_AISLE", 5: "F_HEADLINES_SCROLL", 9: "F_BIRCH_FOREST",
  16: "F_CENTRIFUGE_SPINNING", 17: "F_SCIENTIST_PIPETTE",
  23: "F_HOSPITAL_CORRIDOR", 27: "F_CROWD_STREET_SLOMO",
  30: "F_POURING_SWEETENER", 43: "F_NARROW_PIPE_INTERIOR", 44: "F_STIRRING_GLASS",
  52: "F_EMPTY_BREAKFAST_TABLE", 55: "F_BLOOD_DRAW_VIAL", 62: "F_SMOKE_ALARM_CEILING",
  68: "F_IV_DRIP_BAG", 72: "F_DENTIST_CHAIR", 73: "F_TOOTHBRUSH_MACRO",
  81: "F_BAKING_MIXING_BOWL", 82: "F_ICE_CREAM_TUB",
  89: "F_NUTRITION_LABEL_MACRO", 90: "F_NUTRITION_LABEL_MACRO",
  99: "F_HANDBAG_ON_CHAIR", 100: "F_VET_EXAMINING_DOG",
  110: "F_TOOTHBRUSH_MACRO", 113: "F_SUPERMARKET_AISLE",
};

const doc = { beats: {}, footage: {}, shorts: [], reveal: 54 };
for (const b of beats) {
  doc.beats[String(b.id)] = CARDS[b.id]
    ? { ...CARDS[b.id] }
    : { footage: FOOTAGE_AT[b.id] || CHAPTER_FOOTAGE[b.chapter] };
}
// Strip the authoring-only `key` field d1() leaves behind, and drop empty kickers.
for (const b of Object.values(doc.beats)) {
  if (b.kicker === "") delete b.kicker;
}
for (const [id, b] of Object.entries(doc.beats)) {
  if (b.footage) doc.footage[id] = { file: `footage/${b.footage}.mp4` };
}
// The film uses no `doc` cards — see the D5 note above. Nothing to capture, so
// nothing here is waiting on Chromium.

doc.shorts = [
  { name: "13-minutes", from: 49, to: 55, title: "The 13 Minutes Nobody Reported", hook: "The study measured xylitol after an overnight fast. Its half-life is thirteen minutes." },
  { name: "dogs", from: 94, to: 100, title: "Xylitol and Dogs: The Part Nobody Argues About", hook: "One or two pieces of sugar-free gum can crash a ten-kilo dog's blood sugar." },
  { name: "label-gap", from: 88, to: 92, title: "You Are Not Allowed To Know How Much", hook: "Sugar alcohols are not required to be listed individually on the label." },
  { name: "five-cohorts", from: 30, to: 34, title: "Five Cohorts. Two Sweeteners. One Direction.", hook: "Two sugar alcohols, two continents, five cohorts — all pointing the same way." },
  { name: "dose", from: 78, to: 81, title: "One Gram Or Thirty?", hook: "The dose that moved platelets in a lab is not the dose in your pocket." },
];

const errs = validateStoryboard(doc);
if (errs.length) {
  console.log(`\n${errs.length} PROBLEM(S):`);
  for (const e of errs) console.log(`  ✗ ${e}`);
  process.exit(1);
}
writeFileSync(path.join(HERE, "storyboard.json"), JSON.stringify(doc, null, 2) + "\n");
const cards = Object.values(doc.beats).filter((b) => b.card);
const byType = {};
for (const c of cards) byType[c.card] = (byType[c.card] || 0) + 1;
console.log(`\n✓ storyboard validates — ${beats.length} beats, ${cards.length} cards, ${beats.length - cards.length} footage`);
console.log(`  ${Object.entries(byType).map(([k, v]) => `${k}×${v}`).join("  ")}`);
console.log(`  reveal at beat ${doc.reveal} · ${doc.shorts.length} shorts\n`);
