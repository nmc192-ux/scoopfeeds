// Storyboard — "What Happens If The Strait Of Hormuz Closes"
//
// 73 beats, 7 chapters. Authored to the STORY SPINE in script.md:
//
//   THROUGH-LINE OBJECT — the ship that cannot move. It returns in every
//   chapter and escalates: one vessel on open water (1) → the exit shutting
//   (42) → two thousand hulls at anchor (44) → nine ships abandoned (61) →
//   a count nobody can close (66). The dotgrid at 44 and the bars at 66 are
//   deliberately the same visual family, so the last one reads as the first
//   one having gone wrong.
//
//   THE QUESTION is asked on card 2 and answered on card 73. Nothing in
//   between answers it: every chapter offers a candidate — a price (20), an
//   insurance rate (26), a pipeline (34) — and card 28/36 explicitly sets each
//   aside.
//
//   THE REVEAL is 66-68. Four institutional counts of the same population,
//   side by side, that cannot all be true; then the agency's own sentence.
//
// Neutrality: dates and declarations only, attributed. No card assigns
// responsibility for the war.

import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const _HERE = path.dirname(fileURLToPath(import.meta.url));
const DOC = (f) => path.join(_HERE, "out/docs", f);

/** AI-generated environment stills. NO synthetic humans — see references/sourcing.md. */
export const PHOTOS = {
  P_ANCHOR_CHAIN: "anchor chain taut into flat water, nothing else in frame",
  P_EMPTY_BRIDGE: "empty ship's bridge at dusk, instruments lit, no one aboard",
  P_MOORING:      "mooring rope on a bollard, harbour water beyond",
  P_RADAR:        "radar screen, dense cluster of contacts, no labels",
  P_GALLEY:       "ship's galley, single mug, tinned food on a steel counter",
};

/** Real footage. Pexels License — provenance in out/footage/LICENSES.md. */
export const FOOTAGE = {
  1:  { file: "F_TANKER_SEA",   in: 1 },
  5:  { file: "F_SEA_NIGHT",    in: 1 },
  42: { file: "F_SHIP_ANCHOR",  in: 1 },
  // 4:43 used the Hamburg container terminal under narration about ships
  // "sitting at anchor for months". A working port is the OPPOSITE of the
  // claim - ships at a berth are being handled, not stranded. F_PORT_CRANES is
  // retired from the film rather than moved: nothing in this script is about a
  // functioning port.
  47: { file: "F_ANCHORAGE",    in: 1 },
  57: { file: "F_DECK_WALK",    in: 1, grade: "people" },
  71: { file: "F_HORIZON",      in: 3 },
};

/** Pull stock into the film's palette. Faces get the gentler grade. */
export const GRADES = {
  default:
    "eq=saturation=0.42:contrast=1.14:brightness=-0.10:gamma=0.94," +
    "colorbalance=rs=-0.06:gs=0.02:bs=-0.08:rm=-0.03:gm=0.03:bm=-0.06,vignette=PI/4.2",
  people:
    "eq=saturation=0.62:contrast=1.10:brightness=-0.07:gamma=0.96," +
    "colorbalance=rs=-0.03:gs=0.02:bs=-0.05:rm=-0.02:gm=0.02:bm=-0.04,vignette=PI/4.6",
  // Sea and steel go muddy under the default grade; this holds the blue-grey.
  marine:
    "eq=saturation=0.30:contrast=1.22:brightness=-0.12:gamma=0.92," +
    "colorbalance=rs=-0.08:gs=0.00:bs=0.04:rm=-0.04:gm=0.01:bm=0.03,vignette=PI/3.9",
  warm:
    "eq=saturation=0.38:contrast=1.28:brightness=-0.14:gamma=0.88," +
    "colorbalance=rs=0.03:gs=0.04:bs=-0.10:rm=0.04:gm=0.03:bm=-0.09,vignette=PI/3.6",
};
for (const k of [1, 5, 42, 47, 71]) FOOTAGE[k].grade = "marine";

/**
 * Source screenshots. Geometry is measured by capture-measured.mjs — the crop
 * IS the container element and highlights are per-line DOM Range rects, so
 * nothing here is hand-positioned.
 *
 * Optional on purpose: the film builds without them so the pipeline is not
 * blocked on a site being reachable. A missing doc degrades that beat to a
 * card rather than failing the build.
 */
const RECTS_PATH = path.join(_HERE, "out/docs/rects.json");
const RECTS = existsSync(RECTS_PATH) ? JSON.parse(readFileSync(RECTS_PATH, "utf8")) : {};
const mkDoc = (key, eyebrow, src) => (RECTS[key] ? {
  card: "doc", image: DOC(key + ".png"),
  imgW: RECTS[key].w, imgH: RECTS[key].h, rects: RECTS[key].rects, eyebrow, src,
} : null);

export const DOCS = {
  un_seafarers: mkDoc("un_seafarers",
    "The finding · UN News / International Maritime Organization · 31 Mar 2026",
    "IMO — 20,000 seafarers stranded aboard some 2,000 ships"),
  gcaptain_rescue: mkDoc("gcaptain_rescue",
    "The evacuation · gCaptain · 5 Jul 2026",
    "IMO evacuation plan rescinded — ~2,900 taken out aboard 136 ships"),
  ohchr_abandoned: mkDoc("ohchr_abandoned",
    "The finding · UN Human Rights Office · July 2026",
    "OHCHR — Stranded Hormuz seafarers abandoned for months at sea"),
};

const CH = {
  1: "The narrowest place in the world economy",
  2: "The part everyone covered",
  3: "There is no way around",
  4: "The ships stopped",
  5: "The people on them",
  6: "Nobody can count them",
  7: "The answer",
};

const SRC_IMO   = "International Maritime Organization, via UN News · 31 March 2026";
const SRC_OHCHR = "UN Human Rights Office · press briefing note, July 2026";
const SRC_GCAP  = "gCaptain · 5 July 2026 · IMO figures";
const SRC_FLOW  = "Transit volumes: ~20m barrels/day · ~25% of seaborne oil · ~20% of global LNG";
const SRC_PRICE = "Brent crude · March 2026 · largest single-month increase on record";
const SRC_INS   = "War-risk premiums · marine insurance market, March 2026";
const SRC_PIPE  = "Saudi East–West and UAE Habshan–Fujairah pipelines · CNBC, Mar–May 2026";

export const TITLE_SEGMENT = {
  after: 5,
  seconds: 3.2,
  spec: {
    card: "title", kicker: "ScoopFeeds · Long-form",
    lines: ["WHAT HAPPENS IF", "THE STRAIT OF", "HORMUZ CLOSES"],
    sub: "For forty years it was a hypothetical. On 4 March 2026 it stopped being one — and the answer was not a price.",
  },
};

export const STORYBOARD = {
  // ── COLD OPEN ──────────────────────────────────────────────────────────
  1: { footage: "F_TANKER_SEA" },

  // THE QUESTION. Deliberately unanswered until 73.
  2: { card: "statement", lines: ["WHAT HAPPENS IF", "THE STRAIT OF HORMUZ", "*CLOSES?"] },

  3: { card: "ledger", kicker: "Where the question lived", title: "For forty years, only here",
       rows: [
         { who: "WAR GAME", what: "A scenario run by navies and never executed." },
         { who: "TEXTBOOK", what: "A chapter on chokepoints in every energy course." },
         { who: "RISK REPORT", what: "A line item nobody expected to need." },
       ] },

  4: { card: "stat", kicker: "The day it stopped being hypothetical", figure: "4 MAR", unit: "2026",
       label: "Iran declared the Strait of Hormuz closed." },

  5: { footage: "F_SEA_NIGHT" },

  // ── CHAPTER 01 ─────────────────────────────────────────────────────────
  6:  { card: "chapter", n: "01", name: "The narrowest place\nin the world economy" },

  // A viewer who cannot picture the chokepoint cannot feel any number about
  // it. This was the single biggest gap in the first cut.
  7:  { card: "map", variant: "hormuz", kicker: "Shipping lanes at the narrowest point",
        title: "Two miles wide, in each direction",
        note: "Everything leaving the Persian Gulf by sea passes through that gap.",
        src: "Schematic · not to scale" },

  8:  { card: "statement", lines: ["EVERY BARREL THAT LEAVES", "THE GULF BY SEA", "*GOES THROUGH IT."] },

  9:  { card: "stat", kicker: "In a normal year", figure: "20M", unit: "BARRELS / DAY",
        label: "Through a gap two miles wide.", src: SRC_FLOW },

  10: { card: "dotgrid", kicker: "All the oil that moves by sea, anywhere",
        title: "Out of every hundred barrels", total: 100, out: 25,
        label: "A quarter of it passes this one bend of water.", src: SRC_FLOW },

  11: { card: "stat", kicker: "Liquefied natural gas", figure: "~20%", unit: "OF WORLD SUPPLY",
        label: "Sails the same two-mile gap.", src: SRC_FLOW },

  12: { card: "bars", kicker: "Crude leaving the strait · by destination",
        title: "It is overwhelmingly an Asian supply line",
        items: [
          { label: "Asia", value: 84, display: "84%", hot: true },
          { label: "Everywhere else", value: 16, display: "16%" },
        ], src: SRC_FLOW },

  13: { card: "stat", kicker: "China", figure: "~1/3", unit: "OF ITS OIL",
        label: "Arrives through this single bend of water.", src: SRC_FLOW },

  14: { card: "bars", kicker: "Europe · gas supply from Qatar",
        title: "Europe is on the same route",
        items: [{ label: "Via Hormuz, from Qatar", value: 13, display: "12–14%", hot: true }],
        src: SRC_FLOW },

  15: { card: "statement", lines: ["NOT A SYMBOL.", "*A BOTTLENECK."] },

  // ── CHAPTER 02 ─────────────────────────────────────────────────────────
  16: { card: "chapter", n: "02", name: "The part\neveryone covered" },

  17: { card: "ledger", kicker: "What happened, and when", title: "Two dates",
        rows: [
          { who: "28 FEB 2026", what: "American and Israeli strikes hit Iran." },
          { who: "4 MAR 2026", what: "Iran declared the Strait of Hormuz closed.", hot: true },
        ] },

  18: { card: "statement", lines: ["IT WAS REPORTED EVERYWHERE,", "BECAUSE IT WAS THE", "*EASIEST PART TO MEASURE."] },

  19: { card: "stat", kicker: "Brent crude · 8 March 2026", figure: "$100", unit: "A BARREL",
        label: "The first time in four years.", src: SRC_PRICE },

  // Bars say "bigger". A line says "when, and how fast" - which is the actual
  // claim about March 2026. Plotted points are the reported reference values
  // only; we do not have (and do not imply) a continuous daily series.
  20: { card: "linechart", kicker: "Brent crude · 2026", title: "Then it kept going",
        points: [
          { label: "Before the strikes", v: 78, display: "~$78" },
          { label: "8 March", v: 100, display: "$100" },
          { label: "Peak", v: 126, display: "$126", hot: true },
        ], yMin: 60, yMax: 140,
        note: "Three reported reference points — not a continuous series.",
        src: SRC_PRICE },

  21: { card: "statement", lines: ["THE LARGEST SINGLE-MONTH", "RISE IN THE PRICE OF OIL", "*EVER RECORDED."] },

  22: { card: "statement", lines: ["THEN CAME THE NUMBER", "THE SHIPPING INDUSTRY", "*ACTUALLY WATCHES."] },

  23: { card: "equation", kicker: "War-risk insurance",
        numerator: "THE ODDS IT SINKS", denominator: "THE VALUE OF THE HULL",
        result: "THE PREMIUM",
        note: "What it costs to promise that a ship will arrive." },

  24: { card: "stat", kicker: "Before the war · per transit", figure: "0.125%", unit: "OF HULL VALUE",
        label: "One eighth of one percent to cross.", src: SRC_INS },

  25: { card: "bars", kicker: "War-risk premium · within nine days",
        title: "Then it went up four to sixfold",
        items: [
          { label: "Before", value: 1, display: "1×" },
          { label: "After", value: 5, display: "4–6×", hot: true },
        ], src: SRC_INS },

  26: { card: "stat", kicker: "Largest tankers · per crossing", figure: "$250K", unit: "PER TRANSIT",
        label: "To make one journey through the strait.", src: SRC_INS },

  27: { card: "statement", lines: ["AND THIS IS USUALLY", "WHERE THE COVERAGE", "*ENDED."] },

  // The pivot. Candidate answer #1 set aside.
  28: { card: "title", lines: ["A PRICE IS WHAT", "HAPPENS TO A BARREL.", "*NOT TO A SHIP."] },

  // ── CHAPTER 03 ─────────────────────────────────────────────────────────
  29: { card: "chapter", n: "03", name: "There is\nno way around" },

  30: { card: "statement", lines: ["WHY KEEP USING A WATERWAY", "*A NAVY CAN CLOSE?"] },

  31: { card: "map", variant: "saudi", kicker: "Saudi Arabia",
        title: "East–West: across the country to the Red Sea",
        note: "Built to leave the Gulf without entering the strait at all.",
        src: SRC_PIPE },

  32: { card: "map", variant: "uae", kicker: "United Arab Emirates",
        title: "Habshan–Fujairah: to a port outside the strait",
        note: "Loading beyond the chokepoint entirely.",
        src: SRC_PIPE },

  33: { card: "statement", lines: ["BOTH BUILT FOR", "EXACTLY THIS.", "*BOTH REAL."] },

  // The killer chart — candidate answer #2 set aside.
  34: { card: "bars", kicker: "Daily capacity · million barrels",
        title: "The bypasses against the problem",
        items: [
          { label: "Bypass capacity available", value: 4.5, display: "3.5–5.5m" },
          { label: "Normally through the strait", value: 20, display: "20m", hot: true },
        ], src: SRC_PIPE },

  35: { card: "dotgrid", kicker: "If every bypass ran flat out",
        title: "Out of every hundred barrels", total: 100, out: 25,
        label: "About a quarter could go around. The rest cannot.", src: SRC_PIPE },

  36: { card: "statement", lines: ["THE BYPASSES ARE REAL.", "THEY CARRY ABOUT", "*A QUARTER OF IT."] },

  37: { card: "stat", kicker: "UAE second line · fast-tracked", figure: "2027", unit: "EXPECTED",
        label: "Not help you can use this year.", src: SRC_PIPE },

  // ── CHAPTER 04 ─────────────────────────────────────────────────────────
  38: { card: "chapter", n: "04", name: "The ships\nstopped" },

  39: { card: "statement", lines: ["A SHIP IS NOT A TRUCK.", "IT CANNOT PULL OVER", "*AND WAIT."] },

  40: { card: "map", variant: "hormuz", pin: "ONE WAY OUT",
        kicker: "Once a vessel is inside the Gulf",
        title: "There is one way in, and it is the way out",
        note: "No back door. No overland route. One exit — and it shut." },

  41: { card: "statement", lines: ["ONE EXIT.", "*AND IT WAS SHUT."] },

  42: { footage: "F_SHIP_ANCHOR" },

  43: { card: "statement", lines: ["THEY DROPPED ANCHOR.", "*AND THEY STAYED THERE."] },

  // Through-line escalation: one hull becomes two thousand.
  44: { card: "dotgrid", kicker: "Counted by the IMO · end of March 2026",
        title: "Vessels stopped inside the Gulf", total: 100, out: 100,
        label: "About two thousand ships, at anchor, waiting.", src: SRC_IMO },

  45: { card: "ledger", kicker: "What was sitting there", title: "Every class of ship at once",
        rows: [
          { who: "OIL TANKERS", what: "Crude and refined product, loaded and unable to sail." },
          { who: "GAS CARRIERS", what: "LNG bound for Europe and Asia." },
          { who: "BULK CARRIERS", what: "Grain, ore, cement." },
          { who: "CONTAINER SHIPS", what: "Everything else." },
        ] },

  46: { card: "stat", kicker: "And, among them", figure: "6", unit: "CRUISE LINERS",
        label: "Carrying passengers.", src: SRC_IMO },

  47: { footage: "F_PORT_CRANES" },

  // ── CHAPTER 05 ─────────────────────────────────────────────────────────
  48: { card: "chapter", n: "05", name: "The people\non them" },

  49: { card: "statement", lines: ["THOSE TWO THOUSAND SHIPS", "*WERE NOT EMPTY."] },

  50: { card: "stat", kicker: "IMO · 31 March 2026", figure: "20,000", unit: "SEAFARERS",
        label: "Stranded aboard, inside an active war zone.", src: SRC_IMO },

  51: { card: "statement", lines: ["THE AGENCY'S SAFETY DIRECTOR", "PUT IT IN", "*ONE SENTENCE."] },

  // Show the artifact, don't just cite it. The highlight is measured onto the
  // exact sentence by capture-measured.mjs.
  52: { doc: "un_seafarers" },

  53: { card: "statement", lines: ["IT IS WORTH BEING PRECISE", "ABOUT WHO", "*THESE PEOPLE ARE."] },

  54: { card: "statement", lines: ["NOT, MOSTLY, FROM THE", "COUNTRIES ARGUING", "*OVER THE STRAIT."] },

  55: { card: "ledger", kicker: "Where the crews are from", title: "Five countries, no seat at the table",
        rows: [
          { who: "INDIA", what: "" },
          { who: "THE PHILIPPINES", what: "" },
          { who: "INDONESIA", what: "" },
          { who: "UKRAINE", what: "" },
          { who: "ROMANIA", what: "" },
        ] },

  56: { card: "dotgrid", kicker: "Filipino seafarers · share of world crews",
        title: "Out of every hundred sailors", total: 100, out: 30,
        label: "Close to a third of the people who move world trade." },

  57: { footage: "F_DECK_WALK" },

  58: { card: "title", lines: ["MORE THAN A THOUSAND", "EMAILS. ASKING, MOSTLY,", "*TO BE BROUGHT HOME."] },

  // ── CHAPTER 06 ─────────────────────────────────────────────────────────
  59: { card: "chapter", n: "06", name: "Nobody\ncan count them" },

  60: { doc: "ohchr_abandoned" },

  61: { card: "ledger", kicker: SRC_OHCHR, title: "Abandoned where they lay",
        rows: [
          { who: "9 SHIPS", what: "Abandoned by their owners at Iranian ports.", hot: true },
          { who: "93 CREW", what: "Left aboard them.", hot: true },
        ], src: SRC_OHCHR },

  62: { card: "ledger", kicker: "What ran out", title: "Without reliable supply of",
        rows: [
          { who: "FOOD", what: "" },
          { who: "WATER", what: "" },
          { who: "MEDICINE", what: "" },
          { who: "WAGES", what: "Unpaid for months.", hot: true },
        ], src: SRC_OHCHR },

  63: { doc: "gcaptain_rescue" },

  64: { card: "statement", lines: ["THEN THE PLAN", "WAS PAUSED.", "*IT HAS NOT RESTARTED."] },

  65: { card: "statement", lines: ["AND HERE THE NUMBERS", "STOP AGREEING", "*WITH ONE ANOTHER."] },

  // ── THE REVEAL ─────────────────────────────────────────────────────────
  // Same visual family as 44 on purpose: the count that was solid has come apart.
  66: { card: "bars", kicker: "Seafarers stranded · four institutional counts",
        title: "Of the same people, in the same year",
        items: [
          { label: "March · UN News / IMO", value: 20000, display: "20,000", hot: true },
          { label: "War total · IMO's own figure", value: 11000, display: "11,000" },
          { label: "July · still stranded", value: 8000, display: "8,000" },
          { label: "August · still stranded", value: 6000, display: "6,000" },
        ], src: "Sources disagree. All four are reported figures; we do not choose between them." },

  67: { card: "statement", lines: ["THOSE CANNOT ALL BE TRUE.", "AND WE WILL NOT PRETEND", "*TO KNOW WHICH IS."] },

  // The line the film is remembered by.
  68: { card: "title", lines: ["MANY OTHERS ARE", "*UNACCOUNTED FOR."],
        sub: "— the phrase the agency itself keeps using" },

  // ── CHAPTER 07 ─────────────────────────────────────────────────────────
  69: { card: "chapter", n: "07", name: "The\nanswer" },

  // THE ANSWER. Callback to card 2.
  70: { card: "statement", lines: ["THE HONEST ANSWER", "IS NOT A PRICE.", "*THE PRICE RECOVERED."] },

  71: { footage: "F_HORIZON" },

  72: { card: "ledger", kicker: "What is still true", title: "Still at anchor",
        rows: [
          { who: "INSIDE A WAR", what: "That is not theirs." },
          { who: "FOR COMPANIES", what: "That in some cases stopped replying." },
          { who: "FROM COUNTRIES", what: "With no seat at the table.", hot: true },
        ] },

  // card:"title", NOT "outro". The outro renderer draws the fixed ScoopFeeds
  // sign-off and ignores whatever it is given, and build.mjs appends one of
  // those automatically — so authoring this beat as "outro" printed the
  // wordmark twice and threw away the film's actual closing lines.
  73: { card: "title", lines: ["NOBODY HAS A NUMBER", "FOR THEM."],
        sub: "That is what closed means. It was never a question about oil." },
};

/**
 * IMAGERY ONLY — never a text card.
 *
 * Cutting an image into a slide mid-read and returning to it leaves the viewer
 * time to read neither half; ten of these was the loudest complaint on the last
 * film. Every key below is a footage beat.
 */
export const INSERTS = {
  // Every footage beat gets a brief cutaway to a DIFFERENT clip. This is the
  // rhythm fix qc.mjs asked for: 76 shots and only one under-2s cut measured
  // 6.02s median / 1% under 2s against a <=6s / >=8% target — every shot was a
  // long card hold, because a beat can host at most one insert (build.mjs takes
  // INSERTS[id][0] only) and five of six imagery beats had none. All six clips
  // are already downloaded; this reuses them rather than sourcing more.
  1:  [{ at: 0.58, dur: 1.3, footage: "F_SEA_NIGHT" }],
  5:  [{ at: 0.55, dur: 1.3, footage: "F_TANKER_SEA" }],
  42: [{ at: 0.55, dur: 1.4, footage: "F_PORT_CRANES" }],
  47: [{ at: 0.55, dur: 1.3, footage: "F_SHIP_ANCHOR" }],
  57: [{ at: 0.55, dur: 1.4, footage: "F_HORIZON" }],
  // 71's insert sits EARLY (0.30, not 0.55). At 0.55 the return to the horizon
  // lasted only MIN_PIECE (~1.1s) before the cut to the closing card — a flash,
  // which is what read as an abrupt jolt at 7:20. Early placement leaves a
  // ~2.5s settle on the final image while keeping the cutaway's rhythm.
  71: [{ at: 0.30, dur: 1.3, footage: "F_DECK_WALK" }],
};

/**
 * FOOTAGE FALLBACK.
 *
 * The six clips above are not in the repo — Pexels serves them only through its
 * API (no key configured here) and blocks direct page fetches with a 400. Rather
 * than fail the build or silently ship a film with no photography in it, any
 * missing clip degrades to a designed card and the console says which.
 *
 * Drop the six mp4s into out/footage/ (or set PEXELS_API_KEY and re-fetch) and
 * these substitutions disappear with no other edit.
 */
const FOOTAGE_FALLBACK = {
  1:  { card: "title", kicker: "ScoopFeeds · Long-form",
        lines: ["FOR FORTY YEARS,", "ONLY A HYPOTHETICAL."] },
  5:  { card: "statement", lines: ["THIS IS WHAT", "ACTUALLY HAPPENED.", "*AND IT IS NOT WHAT", "MOST PEOPLE WATCHED."] },
  42: { card: "statement", lines: ["SO THE SHIPS", "ALREADY INSIDE IT", "*SIMPLY STOPPED."] },
  47: { card: "stat", kicker: "Some of them", figure: "MONTHS", unit: "AT ANCHOR",
        label: "Still sitting where they stopped." },
  57: { card: "stat", kicker: "International Transport Workers' Federation", figure: "1,000+", unit: "EMAILS",
        label: "From crews aboard those ships.", src: SRC_IMO },
  71: { card: "statement", lines: ["THOUSANDS ARE STILL", "SITTING AT ANCHOR", "*INSIDE SOMEBODY", "ELSE'S WAR."] },
};

let _missing = [];
for (const [beat, spec] of Object.entries(FOOTAGE_FALLBACK)) {
  const key = STORYBOARD[beat]?.footage;
  if (!key) continue;
  if (!existsSync(path.join(_HERE, "out/footage", key + ".mp4"))) {
    STORYBOARD[beat] = spec;
    delete FOOTAGE[beat];
    _missing.push(`${beat}:${key}`);
  }
}
// Inserts pointing at absent media fail the same way — and that covers PHOTOS
// as well as footage. This film uses no AI-generated imagery at all (a
// deliberate choice for a story about a live war), so the environment stills in
// PHOTOS were never produced and every photo insert drops here.
const _have = (i) =>
  (i.footage && existsSync(path.join(_HERE, "out/footage", i.footage + ".mp4"))) ||
  (i.photo   && existsSync(path.join(_HERE, "out/photos",  i.photo  + ".png")));
for (const [beat, arr] of Object.entries(INSERTS)) {
  const kept = arr.filter(_have);
  if (kept.length) INSERTS[beat] = kept; else delete INSERTS[beat];
}
if (_missing.length) {
  console.log(`storyboard: ${_missing.length} footage clip(s) absent, using card fallbacks — ${_missing.join(", ")}`);
}
